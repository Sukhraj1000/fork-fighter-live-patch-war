import {
  MutationProposalSchema,
  type GameMasterRequest,
  type MutationProposal,
} from '@fork-fighter/contracts'

function cycleKey(request: GameMasterRequest): string {
  return request.context.patchIndex.toString(36)
}

function difficultyCost(request: GameMasterRequest, target: number): number {
  const budget = request.context.remainingDifficultyBudget
  return Math.max(0.1, Math.min(target, Math.max(0.1, budget)))
}

export function createArchitectMockProposal(
  request: GameMasterRequest,
): MutationProposal {
  const cycle = cycleKey(request)
  const tag = `mock:architect:${cycle}:bonus`

  return MutationProposalSchema.parse({
    proposalId: `proposal:architect:${cycle}`,
    requestId: request.requestId,
    author: 'architect',
    mutation: {
      id: `mock:architect:${cycle}`,
      title: 'Risk Dividend',
      patchNote: 'A valuable bonus core opens on the risky route.',
      author: 'architect',
      durationMs: 20_000,
      difficultyCost: difficultyCost(request, 0.75),
      triggers: [
        {
          id: 'open-risk-dividend',
          type: 'onActivation',
          effects: [
            {
              type: 'spawnBonusCore',
              count: 1,
              spawnAt: 'riskyRoute',
              scoreMultiplier: 1.75,
              tag,
            },
          ],
        },
      ],
      objective: {
        id: 'claim-risk-dividend',
        type: 'collectRiskyCores',
        title: 'Claim the dividend',
        description: 'Collect one risky core before the blueprint expires.',
        count: 1,
        reward: { type: 'grantTime', amountMs: 3_000 },
      },
      limits: {
        maxTriggerActivations: 1,
        maxSpawnedEntities: 1,
      },
      cleanup: [
        {
          type: 'removeEntitiesByTag',
          tag,
          when: 'expiry',
        },
      ],
    },
    summary: 'Adds a coherent risk-reward detour with a timed side objective.',
    expectedImpact: 'Invites deliberate route planning without blocking extraction.',
  })
}

export function createGremlinMockProposal(
  request: GameMasterRequest,
): MutationProposal {
  const cycle = cycleKey(request)
  const telemetry = request.context.telemetry
  const repeatsRoute = telemetry.routeRepetition >= 0.5
  const tag = `mock:gremlin:${cycle}:${repeatsRoute ? 'hazard' : 'collector'}`

  const trigger = repeatsRoute
    ? {
        id: 'scramble-favourite-route',
        type: 'onActivation' as const,
        effects: [
          {
            type: 'relocateHazard' as const,
            hazard: 'nearest' as const,
            destination: 'mostUsedRoute' as const,
            maxDistance: 180,
            tag,
          },
        ],
      }
    : {
        id: 'tax-safe-cores',
        type: 'onCoreCollected' as const,
        coreRisk:
          telemetry.lowRiskCoreRate >= telemetry.highRiskCoreRate
            ? ('safe' as const)
            : ('any' as const),
        effects: [
          {
            type: 'spawnCollector' as const,
            count: 1,
            spawnAt: 'collectedCore' as const,
            speedMultiplier: 0.55,
            contactDamage: 8,
            tag,
          },
        ],
      }

  return MutationProposalSchema.parse({
    proposalId: `proposal:gremlin:${cycle}`,
    requestId: request.requestId,
    author: 'gremlin',
    mutation: {
      id: `mock:gremlin:${cycle}`,
      title: repeatsRoute ? 'Route Scrambler' : 'Safety Tax',
      patchNote: repeatsRoute
        ? 'The nearest hazard shifts onto the player\'s favourite route.'
        : 'Safe core pickups attract a slow debt collector.',
      author: 'gremlin',
      durationMs: 16_000,
      difficultyCost: difficultyCost(request, 1.25),
      triggers: [trigger],
      limits: {
        maxTriggerActivations: repeatsRoute ? 1 : 4,
        maxSpawnedEntities: repeatsRoute ? 1 : 4,
      },
      cleanup: [
        {
          type: repeatsRoute
            ? 'restoreEntitiesByTag'
            : 'removeEntitiesByTag',
          tag,
          when: 'expiry',
        },
      ],
    },
    summary: repeatsRoute
      ? 'Disrupts the route the player repeats most often.'
      : 'Adds bounded pursuit pressure to the player\'s safest pickups.',
    expectedImpact: 'Pushes the player to vary a comfortable strategy temporarily.',
  })
}

export function createAuditorMockProposal(
  request: GameMasterRequest,
): MutationProposal {
  const cycle = cycleKey(request)
  const trend = request.context.telemetry.challengeTrend
  const easesPressure = trend === 'too_hard'
  const multiplier = easesPressure ? 0.8 : trend === 'too_easy' ? 1.15 : 0.95
  const tag = `mock:auditor:${cycle}:damage`

  return MutationProposalSchema.parse({
    proposalId: `proposal:auditor:${cycle}`,
    requestId: request.requestId,
    author: 'auditor',
    mutation: {
      id: `mock:auditor:${cycle}`,
      title: easesPressure ? 'Damage Rebate' : 'Measured Liability',
      patchNote: easesPressure
        ? 'Incoming damage is reduced while the run recovers.'
        : 'Incoming damage is recalibrated with a small reversible adjustment.',
      author: 'auditor',
      durationMs: 15_000,
      difficultyCost: difficultyCost(request, easesPressure ? 0.25 : 0.5),
      triggers: [
        {
          id: 'apply-damage-audit',
          type: 'onActivation',
          effects: [
            {
              type: 'modifyRule',
              rule: 'damageTakenMultiplier',
              operation: 'multiply',
              value: multiplier,
              tag,
            },
          ],
        },
      ],
      limits: {
        maxTriggerActivations: 1,
        maxSpawnedEntities: 1,
      },
      cleanup: [
        {
          type: 'restoreRulesByTag',
          tag,
          when: 'expiry',
        },
      ],
    },
    summary: easesPressure
      ? 'Applies a temporary fairness correction for a struggling run.'
      : 'Applies a small reversible difficulty correction.',
    expectedImpact: easesPressure
      ? 'Creates recovery room without changing the primary objective.'
      : 'Keeps pressure near the target while preserving predictable rules.',
  })
}
