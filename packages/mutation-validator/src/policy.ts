import type {
  ModifierRule,
  ValidatorPolicy,
  ValidatorPolicyOverrides,
} from './types.js'

export const DEFAULT_VALIDATOR_POLICY: ValidatorPolicy = Object.freeze({
  // Game Masters may draft in parallel, but only one patch enters the run.
  maxActiveMutations: 1,
  maxDurationMs: 30_000,
  maxTriggerActivations: 12,
  maxSpawnedEntities: 12,
  maxDifficultyCost: 3,
  maxCollectorContactDamage: 20,
  maxCollectorSpeedMultiplier: 1.1,
  minRunnerTelegraphMs: 750,
  maxRunnerPhysicsDurationMs: 20_000,
  maxRunnerSpeedMultiplier: 1.25,
  maxRunnerScaleMultiplier: 1.3,
  maxRunnerHazardSpeedMultiplier: 1.35,
  safeSpawnClearance: 12,
  reachabilityCellSize: 12,
  maxReachabilityCells: 40_000,
  modifierRanges: Object.freeze({
    moveSpeed: Object.freeze({ minimum: 0.75, maximum: 1.25 }),
    dashCooldownMs: Object.freeze({ minimum: 0.75, maximum: 1.5 }),
    damageTakenMultiplier: Object.freeze({ minimum: 0.75, maximum: 1.35 }),
  }),
})

export function resolveValidatorPolicy(
  overrides: ValidatorPolicyOverrides | undefined,
): ValidatorPolicy {
  if (!overrides) return DEFAULT_VALIDATOR_POLICY

  const modifierRules: readonly ModifierRule[] = [
    'moveSpeed',
    'dashCooldownMs',
    'damageTakenMultiplier',
  ]
  const modifierRanges = Object.fromEntries(
    modifierRules.map((rule) => [
      rule,
      Object.freeze({
        ...DEFAULT_VALIDATOR_POLICY.modifierRanges[rule],
        ...overrides.modifierRanges?.[rule],
      }),
    ]),
  ) as Record<ModifierRule, { minimum: number; maximum: number }>

  return Object.freeze({
    ...DEFAULT_VALIDATOR_POLICY,
    ...overrides,
    modifierRanges: Object.freeze(modifierRanges),
  })
}
