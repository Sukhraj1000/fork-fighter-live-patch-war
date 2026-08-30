import {
  GameMasterRequestSchema,
  MutationProposalSchema,
  ProposalResultSchema,
  type GameMasterRequest,
  type MutationProposal,
  type ProposalFailureCode,
  type ProposalResult,
} from '@fork-fighter/contracts'

import { GAME_MASTER_PERSONAS, type PersonaRecord } from '../personas/index.js'
import type { AgentBrain } from './agent-brain.js'
import type { GameMasterRequests } from './request-builder.js'

export type GameMasterBrains = PersonaRecord<AgentBrain>
export type GameMasterProposalResults = PersonaRecord<ProposalResult>

class ProposalTimeoutError extends Error {
  override readonly name = 'ProposalTimeoutError'
}

function latencySince(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt)
}

function failureResult(
  requestId: string,
  latencyMs: number,
  code: ProposalFailureCode,
  message: string,
): ProposalResult {
  return ProposalResultSchema.parse({
    status: 'failed',
    requestId,
    latencyMs,
    error: { code, message },
  })
}

function usesRequestedCapabilities(
  proposal: MutationProposal,
  request: GameMasterRequest,
): boolean {
  const { capabilities } = request
  const { mutation } = proposal

  if (
    mutation.durationMs > capabilities.limits.maxDurationMs ||
    mutation.triggers.length > capabilities.limits.maxTriggers ||
    mutation.limits.maxTriggerActivations >
      capabilities.limits.maxTriggerActivations ||
    mutation.limits.maxSpawnedEntities >
      capabilities.limits.maxSpawnedEntities
  ) {
    return false
  }

  if (
    mutation.objective !== undefined &&
    !capabilities.objectives.includes(mutation.objective.type)
  ) {
    return false
  }

  return mutation.triggers.every(
    (trigger) =>
      capabilities.triggers.includes(trigger.type) &&
      trigger.effects.length <= capabilities.limits.maxEffectsPerTrigger &&
      trigger.effects.every((effect) => {
        if (!capabilities.effects.includes(effect.type)) {
          return false
        }
        if (
          (effect.type === 'spawnCollector' ||
            effect.type === 'spawnBonusCore') &&
          effect.count > capabilities.limits.maxSpawnCountPerEffect
        ) {
          return false
        }
        return true
      }),
  )
}

function validateResponse(
  response: unknown,
  request: GameMasterRequest,
): MutationProposal | undefined {
  const parsed = MutationProposalSchema.safeParse(response)
  if (!parsed.success) {
    return undefined
  }

  const proposal = parsed.data
  if (
    proposal.requestId !== request.requestId ||
    proposal.author !== request.persona ||
    !usesRequestedCapabilities(proposal, request)
  ) {
    return undefined
  }

  return proposal
}

export async function runAgentBrain(
  brain: AgentBrain,
  untrustedRequest: GameMasterRequest,
): Promise<ProposalResult> {
  const request = GameMasterRequestSchema.parse(untrustedRequest)
  const startedAt = Date.now()

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new ProposalTimeoutError())
    }, request.deadlineMs)
  })

  try {
    const response = await Promise.race([
      Promise.resolve().then(() => brain.propose(request)),
      timeout,
    ])
    const proposal = validateResponse(response, request)

    if (proposal === undefined) {
      return failureResult(
        request.requestId,
        latencySince(startedAt),
        'invalid_response',
        'Agent response was not one typed MutationProposal.',
      )
    }

    return ProposalResultSchema.parse({
      status: 'proposed',
      requestId: request.requestId,
      latencyMs: latencySince(startedAt),
      proposal,
    })
  } catch (error) {
    if (error instanceof ProposalTimeoutError) {
      return failureResult(
        request.requestId,
        latencySince(startedAt),
        'timeout',
        `Agent provider did not respond within ${request.deadlineMs} ms.`,
      )
    }

    return failureResult(
      request.requestId,
      latencySince(startedAt),
      'provider_unavailable',
      'Agent provider was unavailable.',
    )
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle)
    }
  }
}

export async function proposeConcurrently(
  brains: GameMasterBrains,
  requests: GameMasterRequests,
): Promise<GameMasterProposalResults> {
  const results = await Promise.all(
    GAME_MASTER_PERSONAS.map(async (persona) => {
      const result = await runAgentBrain(brains[persona], requests[persona])
      return [persona, result] as const
    }),
  )

  return Object.fromEntries(results) as GameMasterProposalResults
}
