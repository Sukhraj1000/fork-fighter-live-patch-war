import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  canonicalMockEventBatch,
  type GameMasterRequest,
  type ProposalResult,
} from '@fork-fighter/contracts'
import { afterEach, describe, expect, it } from 'vitest'

import {
  InMemoryMatchLogStore,
  JsonlMatchLogStore,
  MatchHost,
  createMatchServer,
  reconstructMatchReplay,
  type GameMasterAgent,
  type MatchServer,
  type ProposalValidator,
} from '../src/index.js'
import {
  ManualClock,
  dependencies,
  replaceAgent,
  telemetry,
} from './helpers.js'

const openServers: MatchServer[] = []

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(({ app }) => app.close()))
})

describe('match HTTP API', () => {
  it('reports the active runtime without exposing configuration secrets', async () => {
    const server = createMatchServer({
      provider: 'mock',
      dependencies: dependencies(),
    })
    openServers.push(server)

    const response = await server.app.inject({ method: 'GET', url: '/api/runtime' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      provider: 'mock',
      sandboxed: false,
      parallelGameMasters: 3,
      maxActivePatches: 1,
    })
  })

  it('creates and ends matches and ingests retry-safe telemetry and event batches', async () => {
    const logStore = new InMemoryMatchLogStore()
    const server = createMatchServer({
      dependencies: dependencies({ logStore }),
    })
    openServers.push(server)

    const created = await server.app.inject({
      method: 'POST',
      url: '/api/matches',
      payload: { matchId: 'match-api', autoStart: false },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().match).toMatchObject({
      matchId: 'match-api',
      status: 'running',
      patchIndex: 0,
    })

    const currentTelemetry = telemetry('match-api', {
      elapsedMs: 1_500,
      coresHeld: 1,
      coresBanked: 1,
      primaryObjectiveProgress: 1 / 3,
      lowRiskCoreRate: 1,
    })
    const acceptedTelemetry = await server.app.inject({
      method: 'POST',
      url: '/api/matches/match-api/telemetry',
      payload: currentTelemetry,
    })
    expect(acceptedTelemetry.statusCode).toBe(202)
    expect(acceptedTelemetry.json()).toMatchObject({
      accepted: true,
      duplicate: false,
    })

    const duplicateTelemetry = await server.app.inject({
      method: 'POST',
      url: '/api/matches/match-api/telemetry',
      payload: currentTelemetry,
    })
    expect(duplicateTelemetry.json().duplicate).toBe(true)

    const batch = { ...canonicalMockEventBatch, matchId: 'match-api' }
    const acceptedBatch = await server.app.inject({
      method: 'POST',
      url: '/api/matches/match-api/event-batches',
      payload: batch,
    })
    expect(acceptedBatch.statusCode).toBe(202)
    expect(acceptedBatch.json()).toEqual({
      accepted: true,
      duplicate: false,
      batchIndex: 0,
      nextBatchIndex: 1,
    })

    const duplicateBatch = await server.app.inject({
      method: 'POST',
      url: '/api/matches/match-api/event-batches',
      payload: batch,
    })
    expect(duplicateBatch.json().duplicate).toBe(true)

    const skippedBatch = await server.app.inject({
      method: 'POST',
      url: '/api/matches/match-api/event-batches',
      payload: { ...batch, batchIndex: 2 },
    })
    expect(skippedBatch.statusCode).toBe(409)
    expect(skippedBatch.json().error.code).toBe('batch_index_conflict')

    const ended = await server.app.inject({
      method: 'POST',
      url: '/api/matches/match-api/end',
    })
    expect(ended.statusCode).toBe(200)
    expect(ended.json().match.status).toBe('ended')

    const afterEnd = await server.app.inject({
      method: 'POST',
      url: '/api/matches/match-api/telemetry',
      payload: currentTelemetry,
    })
    expect(afterEnd.statusCode).toBe(409)
    expect(afterEnd.json().error.code).toBe('match_ended')
  })

  it('closes match-scoped agents exactly once when a match ends', async () => {
    const base = dependencies()
    const closed: string[] = []
    const host = new MatchHost({
      ...base,
      agents: base.agents.map((agent) => ({
        persona: agent.persona,
        propose: (request, signal) => agent.propose(request, signal),
        async closeMatch(matchId) {
          closed.push(`${agent.persona}:${matchId}`)
        },
      })),
    })

    await host.createMatch({ matchId: 'match-cleanup', autoStart: false })
    await host.endMatch('match-cleanup')
    await host.endMatch('match-cleanup')

    expect(closed.sort()).toEqual([
      'architect:match-cleanup',
      'auditor:match-cleanup',
      'gremlin:match-cleanup',
    ])
    await host.close()
  })

  it('returns contract errors without leaking request values', async () => {
    const secret = 'Do-not-leak'
    const server = createMatchServer({
      dependencies: dependencies({ secretValues: [secret] }),
    })
    openServers.push(server)
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/matches',
      payload: { matchId: secret, autoStart: false },
    })
    expect(response.statusCode).toBe(400)
    expect(response.body).not.toContain(secret)
  })
})

describe('patch cadence and dependency-injected agents', () => {
  it('returns a patch difficulty reservation when that patch expires', async () => {
    const clock = new ManualClock()
    const logStore = new InMemoryMatchLogStore()
    const host = new MatchHost(dependencies({ clock, logStore }))

    await host.createMatch({
      matchId: 'match-budget-replenishment',
      remainingDifficultyBudget: 1.25,
      autoStart: false,
    })
    await host.prepareNextPatch('match-budget-replenishment')
    const prepared = host.getSnapshot('match-budget-replenishment')
    const cost = prepared.pendingPatch?.proposal.mutation.difficultyCost
    const durationMs = prepared.pendingPatch?.proposal.mutation.durationMs
    expect(cost).toBeGreaterThan(0)
    expect(durationMs).toBeDefined()

    clock.advanceBy(2_000)
    await host.triggerPatchBoundary('match-budget-replenishment')
    expect(
      host.getSnapshot('match-budget-replenishment').context.remainingDifficultyBudget,
    ).toBeCloseTo(1.25 - cost!)

    clock.advanceBy(durationMs!)
    for (let attempt = 0; attempt < 10; attempt += 1) await Promise.resolve()
    expect(
      host.getSnapshot('match-budget-replenishment').context.remainingDifficultyBudget,
    ).toBe(1.25)
    await host.close()
  })

  it('logs proposal, rejection, selection, activation, expiry, and outcome', async () => {
    const clock = new ManualClock()
    const logStore = new InMemoryMatchLogStore()
    const validator: ProposalValidator = {
      async validate(proposal, context) {
        if (proposal.author === 'architect') {
          return {
            valid: false,
            proposalId: proposal.proposalId,
            checks: [
              {
                gate: 'invariant',
                status: 'failed',
                message: 'Fixture rejection.',
              },
            ],
            reasons: [
              {
                code: 'fixture-rejection',
                message: 'Fixture rejection.',
                path: ['mutation'],
              },
            ],
          }
        }
        return dependencies().validator.validate(proposal, context)
      },
    }
    const host = new MatchHost(
      dependencies({ clock, logStore, validator, cadenceMs: 2_000 }),
    )
    await host.createMatch({ matchId: 'match-cadence', autoStart: false })

    await host.prepareNextPatch('match-cadence')
    const prepared = host.getSnapshot('match-cadence')
    expect(prepared.pendingPatch?.patchIndex).toBe(1)
    expect(prepared.pendingPatch?.proposal.author).not.toBe('architect')

    clock.advanceBy(2_000)
    await host.triggerPatchBoundary('match-cadence')
    const active = host.getSnapshot('match-cadence').activePatches[0]
    expect(active?.patchIndex).toBe(1)

    await host.ingestEventBatch('match-cadence', {
      matchId: 'match-cadence',
      batchIndex: 0,
      fromTick: 0,
      toTick: 10,
      events: [
        {
          type: 'patch_effect_applied',
          tick: 10,
          atMs: 2_000,
          mutationId: active!.proposal.mutation.id,
          triggerId: active!.proposal.mutation.triggers[0]!.id,
          effect: active!.proposal.mutation.triggers[0]!.effects[0]!.type,
          affectedIds: ['fixture-entity'],
        },
        {
          type: 'patch_expired',
          tick: 10,
          atMs: 2_000,
          mutationId: active!.proposal.mutation.id,
          cleanedTags: ['fixture-cleanup'],
        },
      ],
    })

    const replay = reconstructMatchReplay(await host.readLog('match-cadence'))
    expect(replay.proposals).toHaveLength(3)
    expect(replay.rejections).toHaveLength(1)
    expect(replay.selections).toHaveLength(1)
    expect(replay.activations).toHaveLength(1)
    expect(replay.expiries).toHaveLength(1)
    expect(replay.outcomes).toHaveLength(1)
    expect(host.getSnapshot('match-cadence').recentOutcomes[0]).toMatchObject({
      status: 'expired',
      triggerActivations: 1,
      entitiesCleaned: 1,
    })
    await host.close()
  })

  it('keeps telemetry responsive while a proposal times out', async () => {
    const clock = new ManualClock()
    const base = dependencies({ clock })
    const missingAgent: GameMasterAgent = {
      persona: 'gremlin',
      propose(
        _request: GameMasterRequest,
        _signal: AbortSignal,
      ): Promise<ProposalResult> {
        return new Promise(() => undefined)
      },
    }
    const logStore = new InMemoryMatchLogStore()
    const host = new MatchHost({
      ...base,
      agents: replaceAgent(base.agents, missingAgent),
      logStore,
    })
    await host.createMatch({ matchId: 'match-slow', autoStart: false })

    const proposalRound = host.prepareNextPatch('match-slow')
    for (let attempt = 0; attempt < 30; attempt++) {
      await Promise.resolve()
    }
    expect(clock.pendingTimerCount).toBeGreaterThan(0)
    const ingest = await host.ingestTelemetry(
      'match-slow',
      telemetry('match-slow', { elapsedMs: 250, health: 90, recentDamage: 10 }),
    )
    expect(ingest.accepted).toBe(true)

    clock.advanceBy(500)
    await proposalRound
    const failures = (await host.readLog('match-slow')).filter(
      ({ type }) => type === 'proposal_failed',
    )
    expect(failures).toHaveLength(1)
    expect(failures[0]!.data).toMatchObject({
      persona: 'gremlin',
      error: { code: 'timeout' },
    })
    await host.close()
  })
})

describe('SSE and JSONL durability', () => {
  it('replays missed SSE events by Last-Event-ID without changing match state', async () => {
    const logStore = new InMemoryMatchLogStore()
    const host = new MatchHost(dependencies({ logStore }))
    await host.createMatch({ matchId: 'match-sse', autoStart: false })

    const firstResponse = new FakeSseResponse()
    host.subscribe('match-sse', firstResponse.asServerResponse())
    const snapshot = readSseEvent(firstResponse.contents)
    expect(snapshot.event).toBe('snapshot')
    const lastEventId = snapshot.id
    firstResponse.close()

    await host.ingestTelemetry(
      'match-sse',
      telemetry('match-sse', { elapsedMs: 10 }),
    )
    const beforeReconnect = await host.readLog('match-sse')

    const secondResponse = new FakeSseResponse()
    host.subscribe(
      'match-sse',
      secondResponse.asServerResponse(),
      lastEventId,
    )
    const replayed = readSseEvent(secondResponse.contents)
    expect(replayed.event).toBe('telemetry_ingested')
    expect(replayed.id).toBeGreaterThan(lastEventId)
    secondResponse.close()

    const afterReconnect = await host.readLog('match-sse')
    expect(afterReconnect).toEqual(beforeReconnect)
    await host.close()
  })

  it('writes newline-delimited logs with provider secrets redacted', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fork-fighter-server-'))
    const secret = 'daytona-secret-value'
    try {
      const base = dependencies({
        logStore: new JsonlMatchLogStore(directory),
        secretValues: [secret],
      })
      const leakingAgent: GameMasterAgent = {
        persona: 'gremlin',
        async propose(): Promise<ProposalResult> {
          throw new Error(`Bearer ${secret}`)
        },
      }
      const host = new MatchHost({
        ...base,
        agents: replaceAgent(base.agents, leakingAgent),
      })
      await host.createMatch({ matchId: 'match-jsonl', autoStart: false })
      await host.prepareNextPatch('match-jsonl')
      await host.close()

      const contents = await readFile(join(directory, 'match-jsonl.jsonl'), 'utf8')
      expect(contents).not.toContain(secret)
      const lines = contents.trim().split('\n')
      expect(lines.length).toBeGreaterThan(1)
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow()
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rotates match logs before one abandoned session can grow without bound', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fork-fighter-log-rotation-'))
    const store = new JsonlMatchLogStore(directory, {
      maxBytes: 700,
      maxFiles: 2,
    })
    try {
      for (let sequence = 1; sequence <= 40; sequence += 1) {
        await store.append({
          sequence,
          atMs: sequence,
          matchId: 'bounded-match',
          type: 'telemetry_ingested',
          data: { sample: 'x'.repeat(120), sequence },
        })
      }

      const files = (await readdir(directory)).filter((name) =>
        name.startsWith('bounded-match.jsonl'),
      )
      expect(files.sort()).toEqual([
        'bounded-match.jsonl',
        'bounded-match.jsonl.1',
      ])
      const sizes = await Promise.all(
        files.map(async (name) => (await stat(join(directory, name))).size),
      )
      expect(Math.max(...sizes)).toBeLessThanOrEqual(900)

      const retained = await store.read('bounded-match')
      expect(retained.at(-1)?.sequence).toBe(40)
      expect(retained.length).toBeLessThan(40)
    } finally {
      await store.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})

class FakeSseResponse extends EventEmitter {
  contents = ''

  write(chunk: string): boolean {
    this.contents += chunk
    return true
  }

  end(): this {
    this.emit('close')
    return this
  }

  close(): void {
    this.emit('close')
  }

  asServerResponse(): Parameters<MatchHost['subscribe']>[1] {
    return this as unknown as Parameters<MatchHost['subscribe']>[1]
  }
}

function readSseEvent(contents: string): {
  id: number
  event: string
  data: unknown
} {
  for (const block of contents.split('\n\n')) {
    if (block.length === 0 || block.startsWith(':')) continue
    const fields = Object.fromEntries(
      block.split('\n').map((line) => {
        const separator = line.indexOf(':')
        return [line.slice(0, separator), line.slice(separator + 1).trimStart()]
      }),
    )
    if (fields.id && fields.event && fields.data) {
      return {
        id: Number.parseInt(fields.id, 10),
        event: fields.event,
        data: JSON.parse(fields.data),
      }
    }
  }
  throw new Error('No SSE event found')
}
