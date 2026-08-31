import type {
  GameState,
  MatchDirectorContext,
  MutationDefinition,
  MutationProposal,
  ValidationReason,
  ValidationResult,
} from '@fork-fighter/contracts'

export type ModifierRule = 'moveSpeed' | 'dashCooldownMs' | 'damageTakenMultiplier'

export type ModifierRange = Readonly<{
  minimum: number
  maximum: number
}>

export type ValidatorPolicy = Readonly<{
  maxActiveMutations: number
  maxDurationMs: number
  maxTriggerActivations: number
  maxSpawnedEntities: number
  maxDifficultyCost: number
  maxCollectorContactDamage: number
  maxCollectorSpeedMultiplier: number
  minRunnerTelegraphMs: number
  maxRunnerPhysicsDurationMs: number
  maxRunnerSpeedMultiplier: number
  maxRunnerScaleMultiplier: number
  maxRunnerHazardSpeedMultiplier: number
  safeSpawnClearance: number
  reachabilityCellSize: number
  maxReachabilityCells: number
  modifierRanges: Readonly<Record<ModifierRule, ModifierRange>>
}>

export type ValidatorPolicyOverrides = Partial<
  Omit<ValidatorPolicy, 'modifierRanges'>
> & {
  modifierRanges?: Partial<Record<ModifierRule, Partial<ModifierRange>>>
}

export type MutationSimulationInput = Readonly<{
  mutation: MutationDefinition
  context: MatchDirectorContext
  gameState: GameState
  policy: ValidatorPolicy
}>

export type MicroSimulationResult = Readonly<{
  passed: boolean
  digest: string
  triggerActivations: number
  entitiesSpawned: number
  entitiesCleaned: number
  reasons: readonly ValidationReason[]
}>

export type MutationSimulationAdapter = Readonly<{
  id: string
  simulate(input: MutationSimulationInput): MicroSimulationResult
}>

export type MutationValidationOptions = Readonly<{
  recentMechanicKeys?: readonly string[]
  policy?: ValidatorPolicyOverrides
  simulationAdapter?: MutationSimulationAdapter
}>

export type MutationValidationInput = MutationValidationOptions &
  Readonly<{
    proposal: unknown
    context: unknown
    gameState: unknown
  }>

export type MutationSelectionInput = MutationValidationOptions &
  Readonly<{
    candidates: readonly unknown[]
    context: unknown
    gameState: unknown
  }>

export type MutationSelectionResult = Readonly<{
  selected: MutationProposal | null
  selectedValidation: Extract<ValidationResult, { valid: true }> | null
  validations: readonly ValidationResult[]
}>
