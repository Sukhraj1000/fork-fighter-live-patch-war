import {
  MutationProposalSchema,
  type GameMasterPersona,
  type GameMasterRequest,
  type GameState,
  type ProposalResult,
  type ValidationResult,
} from '@fork-fighter/contracts'
import {
  GAME_MASTER_PERSONAS,
  createDeterministicMockBrains,
  runAgentBrain,
  type AgentBrain,
  type GameMasterBrains,
} from '@fork-fighter/gm-orchestrator'
import {
  MutationRuntimeError,
  activateMutation,
  createMutationRuntimeState,
} from '@fork-fighter/mutation-runtime'
import {
  selectMutationProposal,
  validateMutationProposal,
} from '@fork-fighter/mutation-validator'

import {
  deterministicMockSelector,
  deterministicMockValidator,
} from './mock-dependencies.js'
import type {
  GameMasterAgent,
  ProposalSelector,
  ProposalValidator,
  ValidatedProposal,
} from './types.js'

export type GameStateLookup = (matchId: string) => GameState | undefined

function providerFailure(
  request: GameMasterRequest,
  code: 'timeout' | 'provider_unavailable',
  message: string,
): ProposalResult {
  return {
    status: 'failed',
    requestId: request.requestId,
    latencyMs: 0,
    error: { code, message },
  }
}

class AgentBrainAdapter implements GameMasterAgent {
  constructor(
    readonly persona: GameMasterPersona,
    readonly brain: AgentBrain & {
      closeMatch?: (matchId: string) => Promise<void>
      close?: () => Promise<void>
    },
  ) {}

  async propose(
    request: GameMasterRequest,
    signal: AbortSignal,
  ): Promise<ProposalResult> {
    if (signal.aborted) {
      return providerFailure(request, 'timeout', 'Proposal deadline elapsed.')
    }

    return Promise.race([
      runAgentBrain(this.brain, request),
      new Promise<ProposalResult>((resolve) => {
        signal.addEventListener(
          'abort',
          () => resolve(providerFailure(request, 'timeout', 'Proposal deadline elapsed.')),
          { once: true },
        )
      }),
    ])
  }

  async close(): Promise<void> {
    await this.brain.close?.()
  }

  async closeMatch(matchId: string): Promise<void> {
    await this.brain.closeMatch?.(matchId)
  }
}

function withConfiguredDuration(
  brain: AgentBrain,
  durationMs: number | undefined,
): AgentBrain {
  if (durationMs === undefined) return brain
  return {
    async propose(request) {
      const proposal = MutationProposalSchema.parse(await brain.propose(request))
      return MutationProposalSchema.parse({
        ...proposal,
        mutation: { ...proposal.mutation, durationMs },
      })
    },
  }
}

export function createMockGameMasterBrains(
  delayMs = 0,
  durationMs?: number,
): GameMasterBrains {
  const brains = createDeterministicMockBrains(
    Object.fromEntries(
      GAME_MASTER_PERSONAS.map((persona) => [persona, { delayMs }]),
    ),
  )
  return Object.fromEntries(
    GAME_MASTER_PERSONAS.map((persona) => [
      persona,
      withConfiguredDuration(brains[persona], durationMs),
    ]),
  ) as GameMasterBrains
}

export function adaptAgentBrains(brains: GameMasterBrains): readonly GameMasterAgent[] {
  return GAME_MASTER_PERSONAS.map(
    (persona) =>
      new AgentBrainAdapter(
        persona,
        brains[persona] as AgentBrain & {
          closeMatch?: (matchId: string) => Promise<void>
          close?: () => Promise<void>
        },
      ),
  )
}

function runtimeCapabilityRejection(
  validation: Extract<ValidationResult, { valid: true }>,
  proposalId: string,
  error: MutationRuntimeError,
): ValidationResult {
  return {
    valid: false,
    proposalId,
    checks: [
      ...validation.checks,
      {
        gate: 'capability',
        status: 'failed',
        message: 'The playable mutation runtime does not support this capability yet.',
      },
    ],
    reasons: [
      {
        code: `runtime-${error.code}`,
        message: 'The proposal is valid SDK data but is outside the playable runtime slice.',
        path: ['mutation'],
      },
    ],
  }
}

/**
 * Uses the full validator when a game state exists. Generic MatchHost clients
 * retain the lane-local validator, but live matches never bypass game-aware
 * validation or the mutation-runtime capability gate.
 */
export function createIntegratedValidator(
  gameStateFor: GameStateLookup,
): ProposalValidator {
  return {
    async validate(proposal, context): Promise<ValidationResult> {
      const gameState = gameStateFor(context.matchId)
      if (!gameState) {
        return deterministicMockValidator.validate(proposal, context)
      }

      const validation = validateMutationProposal({ proposal, context, gameState })
      if (!validation.valid) return validation

      try {
        activateMutation(createMutationRuntimeState(), proposal.mutation, {
          tick: gameState.tick,
          atMs: gameState.elapsedMs,
        })
      } catch (error) {
        if (error instanceof MutationRuntimeError) {
          return runtimeCapabilityRejection(validation, proposal.proposalId, error)
        }
        throw error
      }
      return validation
    },
  }
}

export function createIntegratedSelector(
  gameStateFor: GameStateLookup,
): ProposalSelector {
  return {
    async select(
      candidates: readonly ValidatedProposal[],
      context,
    ): Promise<ValidatedProposal | undefined> {
      const gameState = gameStateFor(context.matchId)
      if (!gameState) {
        return deterministicMockSelector.select(candidates, context)
      }
      const selection = selectMutationProposal({
        candidates: candidates.map(({ proposal }) => proposal),
        context,
        gameState,
      })
      if (!selection.selected) return undefined
      return candidates.find(
        ({ proposal }) => proposal.proposalId === selection.selected?.proposalId,
      )
    },
  }
}
