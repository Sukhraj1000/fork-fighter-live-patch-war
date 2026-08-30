import {
  MUTATION_CAPABILITIES,
  MutationCapabilityReferenceSchema,
  MutationProposalSchema,
  type GameMasterPersona,
  type GameMasterRequest,
  type MutationDefinition,
  type ProposalResult,
  type ValidationCheck,
  type ValidationResult,
} from '@fork-fighter/contracts'

import type {
  GameMasterAgent,
  ProposalSelector,
  ProposalValidator,
  ValidatedProposal,
} from './types.js'

function mutationFor(
  persona: GameMasterPersona,
  patchIndex: number,
): MutationDefinition {
  const suffix = `${persona}-${patchIndex}`

  switch (persona) {
    case 'architect':
      return {
        id: `relay-contract-${suffix}`,
        title: 'Relay Contract',
        patchNote: 'Bank one extra core to unlock a score-rich relay contract.',
        author: persona,
        durationMs: 16_000,
        difficultyCost: 1,
        triggers: [
          {
            id: `contract-${patchIndex}`,
            type: 'onActivation',
            effects: [
              {
                type: 'adjustExtractionRequirement',
                additionalBankedCores: 1,
                tag: `relay-contract-${patchIndex}`,
              },
            ],
          },
        ],
        objective: {
          id: `contract-objective-${patchIndex}`,
          type: 'bankAdditionalCores',
          title: 'Close the Contract',
          description: 'Bank an additional core before the contract expires.',
          count: 1,
          reward: { type: 'grantScore', amount: 250 },
        },
        limits: { maxTriggerActivations: 1, maxSpawnedEntities: 1 },
        cleanup: [
          {
            type: 'restoreRulesByTag',
            tag: `relay-contract-${patchIndex}`,
            when: 'expiry',
          },
        ],
      }
    case 'gremlin':
      return {
        id: `debt-collector-${suffix}`,
        title: 'Debt Collector',
        patchNote: 'Safe core pickups dispatch a slow collector in pursuit.',
        author: persona,
        durationMs: 18_000,
        difficultyCost: 1.5,
        triggers: [
          {
            id: `safe-core-${patchIndex}`,
            type: 'onCoreCollected',
            coreRisk: 'safe',
            effects: [
              {
                type: 'spawnCollector',
                count: 1,
                spawnAt: 'collectedCore',
                speedMultiplier: 0.55,
                contactDamage: 10,
                tag: `debt-collector-${patchIndex}`,
              },
            ],
          },
        ],
        limits: { maxTriggerActivations: 4, maxSpawnedEntities: 4 },
        cleanup: [
          {
            type: 'removeEntitiesByTag',
            tag: `debt-collector-${patchIndex}`,
            when: 'expiry',
          },
        ],
      }
    case 'auditor':
      return {
        id: `risk-rebate-${suffix}`,
        title: 'Risk Rebate',
        patchNote: 'A bonus core appears away from the route you repeat most.',
        author: persona,
        durationMs: 14_000,
        difficultyCost: 0.5,
        triggers: [
          {
            id: `rebate-${patchIndex}`,
            type: 'onActivation',
            effects: [
              {
                type: 'spawnBonusCore',
                count: 1,
                spawnAt: 'awayFromMostUsedRoute',
                scoreMultiplier: 1.5,
                tag: `risk-rebate-${patchIndex}`,
              },
            ],
          },
        ],
        limits: { maxTriggerActivations: 1, maxSpawnedEntities: 1 },
        cleanup: [
          {
            type: 'removeEntitiesByTag',
            tag: `risk-rebate-${patchIndex}`,
            when: 'expiry',
          },
        ],
      }
  }
}

class DeterministicMockAgent implements GameMasterAgent {
  constructor(readonly persona: GameMasterPersona) {}

  async propose(
    request: GameMasterRequest,
    signal: AbortSignal,
  ): Promise<ProposalResult> {
    if (signal.aborted) {
      return {
        status: 'failed',
        requestId: request.requestId,
        latencyMs: 0,
        error: { code: 'timeout', message: 'Proposal deadline elapsed.' },
      }
    }

    const proposal = MutationProposalSchema.parse({
      proposalId: `proposal-${this.persona}-${request.context.patchIndex}`,
      requestId: request.requestId,
      author: this.persona,
      mutation: mutationFor(this.persona, request.context.patchIndex),
      summary:
        this.persona === 'architect'
          ? 'Adds a legible objective tradeoff.'
          : this.persona === 'gremlin'
            ? 'Counters repeated use of safe pickups.'
            : 'Offsets pressure with a recoverable reward.',
      expectedImpact:
        this.persona === 'architect'
          ? 'Creates a short strategic detour.'
          : this.persona === 'gremlin'
            ? 'Raises pressure without blocking extraction.'
            : 'Encourages route variety without a hard escalation.',
    })

    return {
      status: 'proposed',
      requestId: request.requestId,
      latencyMs: 0,
      proposal,
    }
  }
}

export function createDeterministicMockAgents(): readonly GameMasterAgent[] {
  return (['architect', 'gremlin', 'auditor'] as const).map(
    (persona) => new DeterministicMockAgent(persona),
  )
}

function check(
  gate: ValidationCheck['gate'],
  status: ValidationCheck['status'],
  message: string,
): ValidationCheck {
  return { gate, status, message }
}

export const deterministicMockValidator: ProposalValidator = {
  validate(proposal, context): ValidationResult {
    if (context.recentMutationIds.includes(proposal.mutation.id)) {
      return {
        valid: false,
        proposalId: proposal.proposalId,
        checks: [check('novelty', 'failed', 'Mutation was used recently.')],
        reasons: [
          {
            code: 'recent-mutation',
            message: 'Mutation was used recently.',
            path: ['mutation', 'id'],
          },
        ],
      }
    }

    if (proposal.mutation.difficultyCost > context.remainingDifficultyBudget) {
      return {
        valid: false,
        proposalId: proposal.proposalId,
        checks: [
          check('difficulty', 'failed', 'Mutation exceeds the remaining budget.'),
        ],
        reasons: [
          {
            code: 'difficulty-budget',
            message: 'Mutation exceeds the remaining difficulty budget.',
            path: ['mutation', 'difficultyCost'],
          },
        ],
      }
    }

    if (context.telemetry.challengeTrend === 'too_hard') {
      return {
        valid: false,
        proposalId: proposal.proposalId,
        checks: [
          check('difficulty', 'failed', 'A struggling run cannot be escalated.'),
        ],
        reasons: [
          {
            code: 'run-too-hard',
            message: 'No additional pressure while the run is too hard.',
            path: ['context', 'telemetry', 'challengeTrend'],
          },
        ],
      }
    }

    const score =
      context.telemetry.challengeTrend === 'too_easy'
        ? proposal.mutation.difficultyCost * 10
        : 10 - Math.abs(1 - proposal.mutation.difficultyCost)

    return {
      valid: true,
      proposalId: proposal.proposalId,
      score,
      checks: [
        check('schema', 'passed', 'Proposal matches the frozen contract.'),
        check('difficulty', 'passed', 'Mutation fits the current budget.'),
        check('novelty', 'passed', 'Mutation is not active or recent.'),
      ],
    }
  },
}

export const deterministicMockSelector: ProposalSelector = {
  select(candidates): ValidatedProposal | undefined {
    return [...candidates].sort(
      (left, right) =>
        right.validation.score - left.validation.score ||
        left.proposal.proposalId.localeCompare(right.proposal.proposalId),
    )[0]
  },
}

export const defaultCapabilities = MUTATION_CAPABILITIES

/** Capabilities implemented by the current safe mutation runtime. */
export const runtimeCapabilities = MutationCapabilityReferenceSchema.parse({
  ...MUTATION_CAPABILITIES,
  triggers: ['onCoreCollected'],
  effects: ['spawnCollector'],
  limits: {
    ...MUTATION_CAPABILITIES.limits,
    maxDurationMs: 30_000,
  },
})
