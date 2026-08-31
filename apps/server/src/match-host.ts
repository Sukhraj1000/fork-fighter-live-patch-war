import {
  GameEventBatchSchema,
  GameMasterRequestSchema,
  IdentifierSchema,
  MatchDirectorContextSchema,
  PatchOutcomeSchema,
  ProposalResultSchema,
  RunTelemetrySchema,
  ValidationResultSchema,
  type GameEventBatch,
  type GameMasterPersona,
  type MatchDirectorContext,
  type MutationProposal,
  type PatchOutcome,
  type ProposalHistoryEntry,
  type ProposalResult,
  type RunTelemetry,
  type ValidationResult,
} from '@fork-fighter/contracts'

import { redactForExternal } from './redaction.js'
import { MatchSseHub } from './sse.js'
import type {
  ActivePatch,
  AgentActivity,
  CreateMatchInput,
  EventBatchIngestResult,
  InternalMatchState,
  MatchHostDependencies,
  MatchLogEntry,
  MatchLogEventType,
  MatchSnapshot,
  PendingPatch,
  TelemetryIngestResult,
  ValidatedProposal,
} from './types.js'

export class MatchHostError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'MatchHostError'
  }
}

function initialTelemetry(matchId: string): RunTelemetry {
  return RunTelemetrySchema.parse({
    matchId,
    patchIndex: 0,
    elapsedMs: 0,
    health: 100,
    coresHeld: 0,
    coresBanked: 0,
    primaryObjectiveProgress: 0,
    recentDamage: 0,
    recentDeaths: 0,
    routeRepetition: 0,
    lowRiskCoreRate: 0,
    highRiskCoreRate: 0,
    activeMutationIds: [],
    recentPatchOutcomes: [],
    challengeTrend: 'on_target',
  })
}

function safeMessage(value: unknown): string {
  const message =
    value instanceof Error
      ? value.message
      : typeof value === 'string'
        ? value
        : 'Provider unavailable.'
  return (message.trim() || 'Provider unavailable.').slice(0, 200)
}

function cloneContextForPatch(
  state: InternalMatchState,
  patchIndex: number,
  now: number,
): MatchDirectorContext {
  const activeMutationIds = [...state.activePatches.keys()]
  return MatchDirectorContextSchema.parse({
    ...state.context,
    patchIndex,
    updatedAtMs: Math.max(state.context.updatedAtMs, now - state.createdAtMs),
    telemetry: {
      ...state.context.telemetry,
      patchIndex,
      activeMutationIds,
      recentPatchOutcomes: state.outcomes.slice(-12),
    },
  })
}

function proposalHistory(
  proposal: MutationProposal,
  patchIndex: number,
  result: ProposalHistoryEntry['result'],
  note: string,
): ProposalHistoryEntry {
  return {
    proposalId: proposal.proposalId,
    mutationId: proposal.mutation.id,
    persona: proposal.author,
    patchIndex,
    result,
    note: note.slice(0, 200),
  }
}

export class MatchHost {
  readonly #dependencies: MatchHostDependencies
  readonly #matches = new Map<string, InternalMatchState>()
  readonly #sse: MatchSseHub

  constructor(dependencies: MatchHostDependencies) {
    if (dependencies.cadenceMs <= 0) {
      throw new Error('cadenceMs must be positive')
    }
    if (!Number.isSafeInteger(dependencies.sseHistorySize) || dependencies.sseHistorySize < 1) {
      throw new Error('sseHistorySize must be a positive integer')
    }
    if (
      dependencies.proposalDeadlineMs <= 0 ||
      dependencies.proposalDeadlineMs > 20_000 ||
      dependencies.proposalDeadlineMs >= dependencies.cadenceMs
    ) {
      throw new Error(
        'proposalDeadlineMs must be positive, at most 20 seconds, and shorter than cadenceMs',
      )
    }
    const personas = dependencies.agents.map(({ persona }) => persona)
    if (
      personas.length !== 3 ||
      new Set(personas).size !== 3 ||
      !(['architect', 'gremlin', 'auditor'] as const).every((persona) =>
        personas.includes(persona),
      )
    ) {
      throw new Error('Exactly one architect, gremlin, and auditor agent is required')
    }
    this.#dependencies = dependencies
    this.#sse = new MatchSseHub(dependencies.sseHistorySize)
  }

  async createMatch(input: CreateMatchInput = {}): Promise<MatchSnapshot> {
    const matchId = IdentifierSchema.parse(
      input.matchId ?? `match-${this.#dependencies.idGenerator()}`,
    )
    if (this.#matches.has(matchId)) {
      throw new MatchHostError(
        'match_exists',
        409,
        'A match with that id already exists.',
      )
    }

    const now = this.#dependencies.clock.now()
    const telemetry = RunTelemetrySchema.parse(
      input.initialTelemetry ?? initialTelemetry(matchId),
    )
    if (telemetry.matchId !== matchId) {
      throw new MatchHostError(
        'match_id_mismatch',
        400,
        'Initial telemetry matchId must match the created match.',
      )
    }
    if (telemetry.patchIndex !== 0) {
      throw new MatchHostError(
        'invalid_patch_index',
        400,
        'Initial telemetry must use patchIndex 0.',
      )
    }

    const context = MatchDirectorContextSchema.parse({
      version: 1,
      matchId,
      patchIndex: 0,
      updatedAtMs: telemetry.elapsedMs,
      telemetry,
      remainingDifficultyBudget: input.remainingDifficultyBudget ?? 6,
      recentMutationIds: [],
      rejectedConceptIds: [],
    })
    const agents = new Map<GameMasterPersona, AgentActivity>()
    const histories = new Map<GameMasterPersona, ProposalHistoryEntry[]>()
    for (const { persona } of this.#dependencies.agents) {
      agents.set(persona, {
        persona,
        status: 'idle',
        updatedAtMs: now,
      })
      histories.set(persona, [])
    }

    const state: InternalMatchState = {
      matchId,
      status: 'running',
      createdAtMs: now,
      patchIndex: 0,
      context,
      agents,
      histories,
      activePatches: new Map(),
      outcomes: [],
      lastBatchIndex: -1,
      batchFingerprints: new Map(),
      sequence: 0,
      expiryTimers: new Map(),
      proposalRoundInFlight: false,
      ended: false,
      patchMetrics: new Map(),
    }
    this.#matches.set(matchId, state)
    await this.#record(state, 'match_created', {
      matchId,
      createdAtMs: now,
      cadenceMs: this.#dependencies.cadenceMs,
      proposalDeadlineMs: this.#dependencies.proposalDeadlineMs,
    })

    if (input.autoStart !== false) {
      this.#scheduleBoundary(state, now + this.#dependencies.cadenceMs)
      void this.prepareNextPatch(matchId).catch(() => undefined)
    }
    return this.getSnapshot(matchId)
  }

  getSnapshot(matchId: string): MatchSnapshot {
    const state = this.#getMatch(matchId)
    const snapshot: MatchSnapshot = {
      matchId: state.matchId,
      status: state.status,
      createdAtMs: state.createdAtMs,
      ...(state.endedAtMs === undefined ? {} : { endedAtMs: state.endedAtMs }),
      patchIndex: state.patchIndex,
      ...(state.nextPatchAtMs === undefined
        ? {}
        : { nextPatchAtMs: state.nextPatchAtMs }),
      context: state.context,
      agents: [...state.agents.values()],
      ...(state.pendingPatch === undefined
        ? {}
        : { pendingPatch: state.pendingPatch }),
      activePatches: [...state.activePatches.values()],
      recentOutcomes: state.outcomes.slice(-12),
      lastBatchIndex: state.lastBatchIndex,
    }
    return structuredClone(
      redactForExternal(
        snapshot,
        this.#dependencies.secretValues,
      ) as MatchSnapshot,
    )
  }

  sequenceFor(matchId: string): number {
    return this.#getMatch(matchId).sequence
  }

  subscribe(
    matchId: string,
    response: Parameters<MatchSseHub['subscribe']>[1],
    lastEventId?: number,
  ): void {
    const state = this.#getMatch(matchId)
    const { replayed, historyMissed } = this.#sse.subscribe(
      matchId,
      response,
      lastEventId,
    )
    if (lastEventId === undefined || historyMissed || replayed === 0) {
      this.#sse.writeSnapshot(response, state.sequence, this.getSnapshot(matchId))
    }
  }

  async ingestTelemetry(
    matchId: string,
    input: unknown,
  ): Promise<TelemetryIngestResult> {
    const state = this.#runningMatch(matchId)
    const parsed = RunTelemetrySchema.parse(input)
    if (parsed.matchId !== matchId) {
      throw new MatchHostError(
        'match_id_mismatch',
        400,
        'Telemetry matchId must match the route.',
      )
    }
    if (parsed.patchIndex !== state.patchIndex) {
      throw new MatchHostError(
        'patch_index_conflict',
        409,
        `Expected telemetry for patchIndex ${state.patchIndex}.`,
      )
    }

    const current = state.context.telemetry
    if (parsed.elapsedMs < current.elapsedMs) {
      throw new MatchHostError(
        'stale_telemetry',
        409,
        'Telemetry elapsedMs cannot move backwards.',
      )
    }
    const activeMutationIds = [...state.activePatches.keys()]
    const mergedOutcomeMap = new Map<string, PatchOutcome>()
    for (const outcome of [...parsed.recentPatchOutcomes, ...state.outcomes]) {
      mergedOutcomeMap.set(`${outcome.patchIndex}:${outcome.mutationId}`, outcome)
    }
    const telemetry = RunTelemetrySchema.parse({
      ...parsed,
      activeMutationIds,
      recentPatchOutcomes: [...mergedOutcomeMap.values()].slice(-12),
    })
    if (
      parsed.elapsedMs === current.elapsedMs &&
      JSON.stringify(telemetry) === JSON.stringify(current)
    ) {
      return { accepted: true, duplicate: true, telemetry: current }
    }
    state.context = MatchDirectorContextSchema.parse({
      ...state.context,
      updatedAtMs: telemetry.elapsedMs,
      telemetry,
    })
    await this.#record(state, 'telemetry_ingested', { telemetry })
    return { accepted: true, duplicate: false, telemetry }
  }

  async ingestEventBatch(
    matchId: string,
    input: unknown,
  ): Promise<EventBatchIngestResult> {
    const state = this.#runningMatch(matchId)
    const batch = GameEventBatchSchema.parse(input)
    if (batch.matchId !== matchId) {
      throw new MatchHostError(
        'match_id_mismatch',
        400,
        'Event batch matchId must match the route.',
      )
    }
    const fingerprint = JSON.stringify(batch)
    const priorFingerprint = state.batchFingerprints.get(batch.batchIndex)
    if (priorFingerprint !== undefined) {
      if (priorFingerprint !== fingerprint) {
        throw new MatchHostError(
          'batch_conflict',
          409,
          `Event batch ${batch.batchIndex} was already ingested with different data.`,
        )
      }
      return {
        accepted: true,
        duplicate: true,
        batchIndex: batch.batchIndex,
        nextBatchIndex: state.lastBatchIndex + 1,
      }
    }
    const expectedBatchIndex = state.lastBatchIndex + 1
    if (batch.batchIndex !== expectedBatchIndex) {
      throw new MatchHostError(
        'batch_index_conflict',
        409,
        `Expected event batch ${expectedBatchIndex}.`,
      )
    }

    state.lastBatchIndex = batch.batchIndex
    state.batchFingerprints.set(batch.batchIndex, fingerprint)
    if (state.batchFingerprints.size > 128) {
      const oldest = Math.min(...state.batchFingerprints.keys())
      state.batchFingerprints.delete(oldest)
    }
    state.latestEventBatch = batch
    await this.#record(state, 'event_batch_ingested', { batch })
    await this.#applyEventMetrics(state, batch)
    return {
      accepted: true,
      duplicate: false,
      batchIndex: batch.batchIndex,
      nextBatchIndex: batch.batchIndex + 1,
    }
  }

  async prepareNextPatch(matchId: string): Promise<void> {
    const state = this.#runningMatch(matchId)
    if (state.proposalRoundInFlight) {
      await this.#record(state, 'patch_cycle_skipped', {
        patchIndex: state.patchIndex + 1,
        reason: 'proposal_round_in_flight',
      })
      return
    }

    state.proposalRoundInFlight = true
    const targetPatchIndex = state.patchIndex + 1
    const activatesAtMs =
      state.nextPatchAtMs ??
      this.#dependencies.clock.now() + this.#dependencies.cadenceMs
    const context = cloneContextForPatch(
      state,
      targetPatchIndex,
      this.#dependencies.clock.now(),
    )

    try {
      await this.#record(state, 'patch_cycle_started', {
        patchIndex: targetPatchIndex,
        activatesAtMs,
      })
      const results = await Promise.all(
        this.#dependencies.agents.map(async (agent) => {
          const requestId = IdentifierSchema.parse(
            `request-${this.#dependencies.idGenerator()}`,
          )
          const request = GameMasterRequestSchema.parse({
            requestId,
            persona: agent.persona,
            requestedAtMs:
              this.#dependencies.clock.now() - state.createdAtMs,
            deadlineMs: this.#dependencies.proposalDeadlineMs,
            context,
            capabilities: this.#dependencies.capabilities,
            priorProposals: state.histories.get(agent.persona)?.slice(-8) ?? [],
          })
          await this.#setAgentStatus(state, agent.persona, 'drafting')
          const result = await this.#invokeAgent(agent, request)
          return { persona: agent.persona, result }
        }),
      )

      if (state.status !== 'running' || state.patchIndex + 1 !== targetPatchIndex) {
        return
      }

      const candidates: ValidatedProposal[] = []
      for (const { persona, result } of results) {
        if (result.status === 'failed') {
          await this.#record(state, 'proposal_failed', {
            persona,
            requestId: result.requestId,
            latencyMs: result.latencyMs,
            error: result.error,
          })
          await this.#setAgentStatus(
            state,
            persona,
            'failed',
            undefined,
            result.error.message,
          )
          continue
        }

        const proposal = result.proposal
        await this.#record(state, 'proposal_received', {
          patchIndex: targetPatchIndex,
          latencyMs: result.latencyMs,
          proposal,
        })
        await this.#setAgentStatus(
          state,
          persona,
          'proposed',
          proposal.proposalId,
        )
        const validation = await this.#validateProposal(proposal, context)
        if (!validation.valid) {
          await this.#record(state, 'proposal_rejected', {
            patchIndex: targetPatchIndex,
            proposalId: proposal.proposalId,
            author: proposal.author,
            checks: validation.checks,
            reasons: validation.reasons,
          })
          this.#rememberProposal(
            state,
            proposalHistory(
              proposal,
              targetPatchIndex,
              'rejected',
              validation.reasons[0]?.message ?? 'Proposal rejected.',
            ),
          )
          state.context = MatchDirectorContextSchema.parse({
            ...state.context,
            rejectedConceptIds: [
              ...state.context.rejectedConceptIds,
              proposal.mutation.id,
            ].slice(-16),
          })
          await this.#setAgentStatus(
            state,
            persona,
            'rejected',
            proposal.proposalId,
            validation.reasons[0]?.message,
          )
          continue
        }
        candidates.push({ proposal, validation })
      }

      let selected: ValidatedProposal | undefined
      try {
        selected = await this.#dependencies.selector.select(candidates, context)
      } catch {
        selected = undefined
      }
      if (
        selected &&
        !candidates.some(
          ({ proposal }) => proposal.proposalId === selected?.proposal.proposalId,
        )
      ) {
        selected = undefined
      }

      const onTime = this.#dependencies.clock.now() < activatesAtMs
      if (!selected || !onTime) {
        for (const candidate of candidates) {
          await this.#expireProposal(
            state,
            candidate.proposal,
            targetPatchIndex,
            onTime ? 'No proposal was selected.' : 'Proposal missed the patch boundary.',
          )
        }
        return
      }

      for (const candidate of candidates) {
        if (candidate.proposal.proposalId !== selected.proposal.proposalId) {
          await this.#expireProposal(
            state,
            candidate.proposal,
            targetPatchIndex,
            'Another valid proposal was selected.',
          )
        }
      }

      const pending: PendingPatch = {
        patchIndex: targetPatchIndex,
        proposal: selected.proposal,
        activatesAtMs,
      }
      state.pendingPatch = pending
      this.#rememberProposal(
        state,
        proposalHistory(
          selected.proposal,
          targetPatchIndex,
          'selected',
          'Selected for the next patch boundary.',
        ),
      )
      await this.#record(state, 'proposal_selected', {
        patchIndex: targetPatchIndex,
        proposalId: selected.proposal.proposalId,
        mutationId: selected.proposal.mutation.id,
        author: selected.proposal.author,
        score: selected.validation.score,
      })
      await this.#record(state, 'patch_scheduled', pending)
      await this.#setAgentStatus(
        state,
        selected.proposal.author,
        'selected',
        selected.proposal.proposalId,
      )
    } finally {
      state.proposalRoundInFlight = false
    }
  }

  async triggerPatchBoundary(matchId: string): Promise<void> {
    const state = this.#runningMatch(matchId)
    if (state.boundaryTimer !== undefined) {
      this.#dependencies.clock.clearTimeout(state.boundaryTimer)
      state.boundaryTimer = undefined
    }

    state.patchIndex += 1
    state.context = cloneContextForPatch(
      state,
      state.patchIndex,
      this.#dependencies.clock.now(),
    )
    const pending = state.pendingPatch
    state.pendingPatch = undefined
    if (pending?.patchIndex === state.patchIndex) {
      await this.#activatePatch(state, pending)
    } else {
      await this.#record(state, 'patch_cycle_skipped', {
        patchIndex: state.patchIndex,
        reason: 'no_ready_proposal',
      })
    }

    if (state.status === 'running') {
      this.#scheduleBoundary(
        state,
        this.#dependencies.clock.now() + this.#dependencies.cadenceMs,
      )
      void this.prepareNextPatch(matchId).catch(() => undefined)
    }
  }

  async endMatch(matchId: string): Promise<MatchSnapshot> {
    const state = this.#getMatch(matchId)
    if (state.status === 'ended') {
      return this.getSnapshot(matchId)
    }
    state.status = 'ended'
    state.ended = true
    state.endedAtMs = this.#dependencies.clock.now()
    state.pendingPatch = undefined
    if (state.boundaryTimer !== undefined) {
      this.#dependencies.clock.clearTimeout(state.boundaryTimer)
      state.boundaryTimer = undefined
    }
    for (const mutationId of [...state.activePatches.keys()]) {
      await this.#endPatch(state, mutationId, 'cancelled')
    }
    await this.#record(state, 'match_ended', {
      matchId,
      endedAtMs: state.endedAtMs,
      patchIndex: state.patchIndex,
    })
    await Promise.allSettled(
      this.#dependencies.agents.map((agent) => agent.closeMatch?.(matchId)),
    )
    const snapshot = this.getSnapshot(matchId)
    this.#sse.closeMatch(matchId)
    return snapshot
  }

  async readLog(matchId: string): Promise<readonly MatchLogEntry[]> {
    this.#getMatch(matchId)
    return this.#dependencies.logStore.read(matchId)
  }

  async close(): Promise<void> {
    for (const state of this.#matches.values()) {
      if (state.status === 'running') {
        await this.endMatch(state.matchId)
      }
    }
    this.#sse.close()
    await Promise.all(this.#dependencies.agents.map((agent) => agent.close?.()))
    await this.#dependencies.logStore.close?.()
  }

  async #invokeAgent(
    agent: MatchHostDependencies['agents'][number],
    request: Parameters<MatchHostDependencies['agents'][number]['propose']>[0],
  ): Promise<ProposalResult> {
    const controller = new AbortController()
    const startedAt = this.#dependencies.clock.now()
    let timeoutHandle: unknown
    const timeout = new Promise<ProposalResult>((resolve) => {
      timeoutHandle = this.#dependencies.clock.setTimeout(() => {
        controller.abort()
        resolve({
          status: 'failed',
          requestId: request.requestId,
          latencyMs: this.#dependencies.proposalDeadlineMs,
          error: { code: 'timeout', message: 'Proposal deadline elapsed.' },
        })
      }, this.#dependencies.proposalDeadlineMs)
    })

    const provider = Promise.resolve()
      .then(() => agent.propose(request, controller.signal))
      .then((value) => {
        const parsed = ProposalResultSchema.safeParse(value)
        if (
          !parsed.success ||
          parsed.data.requestId !== request.requestId ||
          (parsed.data.status === 'proposed' &&
            (parsed.data.proposal.requestId !== request.requestId ||
              parsed.data.proposal.author !== agent.persona))
        ) {
          return {
            status: 'failed' as const,
            requestId: request.requestId,
            latencyMs: Math.max(0, this.#dependencies.clock.now() - startedAt),
            error: {
              code: 'invalid_response' as const,
              message: 'Agent returned an invalid typed proposal response.',
            },
          }
        }
        return parsed.data
      })
      .catch((error: unknown): ProposalResult => ({
        status: 'failed',
        requestId: request.requestId,
        latencyMs: Math.max(0, this.#dependencies.clock.now() - startedAt),
        error: {
          code: 'provider_unavailable',
          message: safeMessage(error),
        },
      }))

    const result = await Promise.race([provider, timeout])
    if (timeoutHandle !== undefined) {
      this.#dependencies.clock.clearTimeout(timeoutHandle)
    }
    return ProposalResultSchema.parse(
      redactForExternal(result, this.#dependencies.secretValues),
    )
  }

  async #validateProposal(
    proposal: MutationProposal,
    context: MatchDirectorContext,
  ): Promise<ValidationResult> {
    try {
      const value = await this.#dependencies.validator.validate(proposal, context)
      const parsed = ValidationResultSchema.safeParse(value)
      if (!parsed.success || parsed.data.proposalId !== proposal.proposalId) {
        throw new Error('invalid validation response')
      }
      return parsed.data
    } catch {
      return ValidationResultSchema.parse({
        valid: false,
        proposalId: proposal.proposalId,
        checks: [
          {
            gate: 'schema',
            status: 'failed',
            message: 'Validator did not return a valid result.',
          },
        ],
        reasons: [
          {
            code: 'validator-unavailable',
            message: 'Proposal could not be validated safely.',
            path: [],
          },
        ],
      })
    }
  }

  async #expireProposal(
    state: InternalMatchState,
    proposal: MutationProposal,
    patchIndex: number,
    note: string,
  ): Promise<void> {
    this.#rememberProposal(
      state,
      proposalHistory(proposal, patchIndex, 'expired', note),
    )
    await this.#record(state, 'proposal_expired', {
      patchIndex,
      proposalId: proposal.proposalId,
      mutationId: proposal.mutation.id,
      author: proposal.author,
      note,
    })
  }

  #rememberProposal(
    state: InternalMatchState,
    history: ProposalHistoryEntry,
  ): void {
    const entries = state.histories.get(history.persona) ?? []
    entries.push(history)
    state.histories.set(history.persona, entries.slice(-8))
  }

  async #setAgentStatus(
    state: InternalMatchState,
    persona: GameMasterPersona,
    status: AgentActivity['status'],
    proposalId?: string,
    message?: string,
  ): Promise<void> {
    const activity: AgentActivity = {
      persona,
      status,
      ...(proposalId === undefined ? {} : { proposalId }),
      ...(message === undefined ? {} : { message }),
      updatedAtMs: this.#dependencies.clock.now(),
    }
    state.agents.set(persona, activity)
    await this.#record(state, 'agent_status', activity)
  }

  #scheduleBoundary(state: InternalMatchState, atMs: number): void {
    state.nextPatchAtMs = atMs
    state.boundaryTimer = this.#dependencies.clock.setTimeout(() => {
      void this.triggerPatchBoundary(state.matchId).catch(() => undefined)
    }, Math.max(0, atMs - this.#dependencies.clock.now()))
  }

  async #activatePatch(
    state: InternalMatchState,
    pending: PendingPatch,
  ): Promise<void> {
    const now = this.#dependencies.clock.now()
    const mutation = pending.proposal.mutation
    if (state.activePatches.size > 0) {
      await this.#record(state, 'patch_cycle_skipped', {
        patchIndex: pending.patchIndex,
        reason: 'active_patch_in_progress',
      })
      await this.#expireProposal(
        state,
        pending.proposal,
        pending.patchIndex,
        'Another validated patch is still active.',
      )
      return
    }
    const active: ActivePatch = {
      patchIndex: pending.patchIndex,
      proposal: pending.proposal,
      activatedAtMs: now,
      expiresAtMs: now + mutation.durationMs,
    }
    state.activePatches.set(mutation.id, active)
    state.context = MatchDirectorContextSchema.parse({
      ...state.context,
      remainingDifficultyBudget: Math.max(
        0,
        state.context.remainingDifficultyBudget - mutation.difficultyCost,
      ),
      recentMutationIds: [
        ...state.context.recentMutationIds.filter((id) => id !== mutation.id),
        mutation.id,
      ].slice(-16),
      telemetry: {
        ...state.context.telemetry,
        activeMutationIds: [...state.activePatches.keys()],
      },
    })
    state.patchMetrics.set(mutation.id, {
      activatedAtElapsedMs: Math.max(0, now - state.createdAtMs),
      health: state.context.telemetry.health,
      coresBanked: state.context.telemetry.coresBanked,
      score: 0,
      triggerActivations: 0,
      entitiesSpawned: 0,
      entitiesCleaned: 0,
    })
    await this.#record(state, 'patch_activated', {
      patchIndex: active.patchIndex,
      proposalId: pending.proposal.proposalId,
      mutation,
      activatedAtMs: active.activatedAtMs,
      expiresAtMs: active.expiresAtMs,
    })
    const timer = this.#dependencies.clock.setTimeout(() => {
      void this.#endPatch(state, mutation.id, 'expired').catch(() => undefined)
    }, mutation.durationMs)
    state.expiryTimers.set(mutation.id, timer)
  }

  async #endPatch(
    state: InternalMatchState,
    mutationId: string,
    status: PatchOutcome['status'],
  ): Promise<void> {
    const active = state.activePatches.get(mutationId)
    if (!active) return
    state.activePatches.delete(mutationId)
    const timer = state.expiryTimers.get(mutationId)
    if (timer !== undefined) {
      this.#dependencies.clock.clearTimeout(timer)
      state.expiryTimers.delete(mutationId)
    }
    const metrics = state.patchMetrics.get(mutationId)
    state.patchMetrics.delete(mutationId)
    const endedElapsedMs = Math.max(
      metrics?.activatedAtElapsedMs ?? 0,
      this.#dependencies.clock.now() - state.createdAtMs,
    )
    const outcome = PatchOutcomeSchema.parse({
      mutationId,
      patchIndex: active.patchIndex,
      author: active.proposal.author,
      status,
      activatedAtMs: metrics?.activatedAtElapsedMs ?? 0,
      endedAtMs: endedElapsedMs,
      triggerActivations: metrics?.triggerActivations ?? 0,
      entitiesSpawned: metrics?.entitiesSpawned ?? 0,
      entitiesCleaned: metrics?.entitiesCleaned ?? 0,
      healthDelta: state.context.telemetry.health - (metrics?.health ?? 0),
      coresBankedDelta:
        state.context.telemetry.coresBanked - (metrics?.coresBanked ?? 0),
      scoreDelta: 0,
      challengeTrend: state.context.telemetry.challengeTrend,
    })
    state.outcomes.push(outcome)
    state.outcomes = state.outcomes.slice(-12)
    state.context = MatchDirectorContextSchema.parse({
      ...state.context,
      remainingDifficultyBudget: Math.min(
        20,
        Number(
          (
            state.context.remainingDifficultyBudget +
            active.proposal.mutation.difficultyCost
          ).toFixed(2),
        ),
      ),
      telemetry: {
        ...state.context.telemetry,
        activeMutationIds: [...state.activePatches.keys()],
        recentPatchOutcomes: state.outcomes,
      },
    })
    if (status === 'expired') {
      await this.#record(state, 'patch_expired', {
        mutationId,
        patchIndex: active.patchIndex,
        expiredAtMs: this.#dependencies.clock.now(),
      })
    }
    await this.#record(state, 'patch_outcome', { outcome })
  }

  async #applyEventMetrics(
    state: InternalMatchState,
    batch: GameEventBatch,
  ): Promise<void> {
    for (const event of batch.events) {
      if (event.type === 'patch_effect_applied') {
        const metrics = state.patchMetrics.get(event.mutationId)
        if (metrics) {
          metrics.triggerActivations += 1
          if (
            event.effect === 'spawnCollector' ||
            event.effect === 'spawnBonusCore'
          ) {
            metrics.entitiesSpawned += event.affectedIds.length
          }
        }
      } else if (event.type === 'patch_expired') {
        const metrics = state.patchMetrics.get(event.mutationId)
        if (metrics) {
          metrics.entitiesCleaned += event.cleanedTags.length
        }
        await this.#endPatch(state, event.mutationId, 'expired')
      }
    }
  }

  async #record(
    state: InternalMatchState,
    type: MatchLogEventType,
    data: unknown,
  ): Promise<MatchLogEntry> {
    const entry: MatchLogEntry = {
      sequence: ++state.sequence,
      atMs: this.#dependencies.clock.now(),
      matchId: state.matchId,
      type,
      data: redactForExternal(data, this.#dependencies.secretValues),
    }
    await this.#dependencies.logStore.append(entry)
    this.#sse.publish(entry)
    return entry
  }

  #getMatch(matchId: string): InternalMatchState {
    const state = this.#matches.get(matchId)
    if (!state) {
      throw new MatchHostError('match_not_found', 404, 'Match not found.')
    }
    return state
  }

  #runningMatch(matchId: string): InternalMatchState {
    const state = this.#getMatch(matchId)
    if (state.status !== 'running') {
      throw new MatchHostError('match_ended', 409, 'Match has ended.')
    }
    return state
  }
}
