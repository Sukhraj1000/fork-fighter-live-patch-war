import type {
  ChallengeTrend,
  MatchDirectorContext,
  MutationDefinition,
} from '@fork-fighter/contracts'

import { retainSelectedMutation } from './context.js'

export interface LocalPolicyCandidate {
  conceptId: string
  priority: number
  allowedTrends: readonly ChallengeTrend[]
  minimumRouteRepetition?: number
  minimumLowRiskCoreRate?: number
  mutation: MutationDefinition
}

export type LocalPolicyDecision =
  | {
      action: 'apply'
      source: 'local_fixture'
      mutation: MutationDefinition
      reason: string
      context: MatchDirectorContext
    }
  | {
      action: 'hold'
      source: 'local_fixture'
      mutation: null
      reason: string
      context: MatchDirectorContext
    }

const routeTaxWithUpside: MutationDefinition = {
  id: 'route-tax-with-upside',
  title: 'Route Tax, With Upside',
  patchNote:
    'A hazard shadows the busiest route while a bonus core appears on the risky line.',
  author: 'gremlin',
  durationMs: 20_000,
  difficultyCost: 1.5,
  triggers: [
    {
      id: 'pressure-busiest-route',
      type: 'onInterval',
      everyMs: 8_000,
      effects: [
        {
          type: 'relocateHazard',
          hazard: 'leastActive',
          destination: 'mostUsedRoute',
          maxDistance: 120,
          tag: 'route-tax-hazard',
        },
        {
          type: 'spawnBonusCore',
          count: 1,
          spawnAt: 'riskyRoute',
          scoreMultiplier: 1.5,
          tag: 'route-tax-bonus',
        },
      ],
    },
  ],
  limits: {
    maxTriggerActivations: 2,
    maxSpawnedEntities: 2,
  },
  cleanup: [
    {
      type: 'restoreEntitiesByTag',
      tag: 'route-tax-hazard',
      when: 'expiry',
    },
    {
      type: 'removeEntitiesByTag',
      tag: 'route-tax-bonus',
      when: 'expiry',
    },
  ],
}

const safeCoreCollector: MutationDefinition = {
  id: 'safe-core-collector',
  title: 'Safe Route Collector',
  patchNote:
    'Safe cores briefly attract a slow collector, rewarding prompt banking or a riskier route.',
  author: 'gremlin',
  durationMs: 20_000,
  difficultyCost: 1.25,
  triggers: [
    {
      id: 'collect-safe-core',
      type: 'onCoreCollected',
      coreRisk: 'safe',
      effects: [
        {
          type: 'spawnCollector',
          count: 1,
          spawnAt: 'collectedCore',
          speedMultiplier: 0.45,
          contactDamage: 8,
          tag: 'safe-core-collector-entities',
        },
      ],
    },
  ],
  limits: {
    maxTriggerActivations: 2,
    maxSpawnedEntities: 2,
  },
  cleanup: [
    {
      type: 'removeEntitiesByTag',
      tag: 'safe-core-collector-entities',
      when: 'expiry',
    },
  ],
}

const measuredDashTax: MutationDefinition = {
  id: 'measured-dash-tax',
  title: 'Measured Dash Tax',
  patchNote: 'Dash recovery is slightly longer for one short patch cycle.',
  author: 'auditor',
  durationMs: 20_000,
  difficultyCost: 1,
  triggers: [
    {
      id: 'adjust-dash-recovery',
      type: 'onActivation',
      effects: [
        {
          type: 'modifyRule',
          rule: 'dashCooldownMs',
          operation: 'multiply',
          value: 1.1,
          tag: 'measured-dash-tax-rule',
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
      tag: 'measured-dash-tax-rule',
      when: 'expiry',
    },
  ],
}

export const LOCAL_POLICY_CANDIDATES: readonly LocalPolicyCandidate[] = [
  {
    conceptId: 'route-pressure',
    priority: 100,
    allowedTrends: ['too_easy'],
    minimumRouteRepetition: 0.65,
    mutation: routeTaxWithUpside,
  },
  {
    conceptId: 'safe-core-pressure',
    priority: 80,
    allowedTrends: ['too_easy'],
    minimumLowRiskCoreRate: 0.6,
    mutation: safeCoreCollector,
  },
  {
    conceptId: 'general-pressure',
    priority: 10,
    allowedTrends: ['too_easy'],
    mutation: measuredDashTax,
  },
]

function holdDecision(
  context: MatchDirectorContext,
  reason: string,
): LocalPolicyDecision {
  return {
    action: 'hold',
    source: 'local_fixture',
    mutation: null,
    reason,
    context: structuredClone(context),
  }
}

export function selectLocalAdaptivePatch(
  context: MatchDirectorContext,
  candidates: readonly LocalPolicyCandidate[] = LOCAL_POLICY_CANDIDATES,
): LocalPolicyDecision {
  if (context.telemetry.challengeTrend === 'too_hard') {
    return holdDecision(context, 'Run is too hard; preserve or reduce pressure.')
  }
  if (context.telemetry.challengeTrend === 'on_target') {
    return holdDecision(context, 'Challenge is on target; keep current rules.')
  }

  const lastMutationId = context.recentMutationIds.at(-1)
  const activeMutationIds = new Set(context.telemetry.activeMutationIds)
  const rejectedConceptIds = new Set(context.rejectedConceptIds)
  const telemetry = context.telemetry

  const selected = candidates
    .filter((candidate) =>
      candidate.allowedTrends.includes(telemetry.challengeTrend),
    )
    .filter(({ conceptId }) => !rejectedConceptIds.has(conceptId))
    .filter(({ mutation }) => mutation.id !== lastMutationId)
    .filter(({ mutation }) => !activeMutationIds.has(mutation.id))
    .filter(
      ({ mutation }) =>
        Number.isFinite(mutation.difficultyCost) && mutation.difficultyCost > 0,
    )
    .filter(
      ({ mutation }) =>
        mutation.difficultyCost <= context.remainingDifficultyBudget,
    )
    .filter(
      ({ minimumRouteRepetition }) =>
        minimumRouteRepetition === undefined ||
        telemetry.routeRepetition >= minimumRouteRepetition,
    )
    .filter(
      ({ minimumLowRiskCoreRate }) =>
        minimumLowRiskCoreRate === undefined ||
        telemetry.lowRiskCoreRate >= minimumLowRiskCoreRate,
    )
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        left.mutation.id.localeCompare(right.mutation.id),
    )[0]

  if (selected === undefined) {
    return holdDecision(
      context,
      'No fresh local fixture fits the current budget and telemetry.',
    )
  }

  const reason =
    selected.conceptId === 'route-pressure'
      ? 'Dominant repeated routing receives measured pressure plus a risky reward.'
      : `Selected deterministic fallback concept ${selected.conceptId}.`

  return {
    action: 'apply',
    source: 'local_fixture',
    mutation: structuredClone(selected.mutation),
    reason,
    context: retainSelectedMutation(
      context,
      selected.mutation.id,
      selected.mutation.difficultyCost,
    ),
  }
}
