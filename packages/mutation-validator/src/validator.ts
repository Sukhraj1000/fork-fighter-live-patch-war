import {
  GameStateSchema,
  MUTATION_CAPABILITIES,
  MatchDirectorContextSchema,
  MutationProposalSchema,
  ValidationResultSchema,
  type GameState,
  type MatchDirectorContext,
  type MutationDefinition,
  type MutationProposal,
  type MutationTrigger,
  type ValidationCheck,
  type ValidationGate,
  type ValidationReason,
  type ValidationResult,
} from '@fork-fighter/contracts'

import { evaluateMutationInvariants } from './geometry.js'
import {
  estimateMutationPressure,
  mutationConceptId,
  mutationEffectEntries,
  mutationMechanicKey,
  mutationMechanicTokens,
  requiredCleanupType,
  scoreMutation,
  stableSerialize,
} from './mechanics.js'
import { resolveValidatorPolicy } from './policy.js'
import { deterministicMutationSimulationAdapter } from './simulation.js'
import type {
  MutationSimulationAdapter,
  MutationValidationInput,
  MutationValidationOptions,
  ValidatorPolicy,
} from './types.js'

const IDENTIFIER = /^[a-z0-9][a-z0-9:_-]*$/

const CHECK_MESSAGES: Readonly<
  Record<ValidationGate, Readonly<{ passed: string; failed: string }>>
> = {
  schema: {
    passed: 'Proposal matches the frozen mutation contract.',
    failed: 'Proposal does not match the frozen mutation contract.',
  },
  capability: {
    passed: 'Mutation stays within supported capabilities and policy limits.',
    failed: 'Mutation exceeds a supported capability or policy limit.',
  },
  cleanup: {
    passed: 'Every temporary effect has one matching expiry cleanup.',
    failed: 'Mutation cleanup is incomplete or ambiguous.',
  },
  invariant: {
    passed: 'Primary objectives, routes, and spawn points remain safe.',
    failed: 'Mutation would violate a match safety invariant.',
  },
  difficulty: {
    passed: 'Mutation fits the current difficulty budget and player condition.',
    failed: 'Mutation does not fit the current difficulty budget or player condition.',
  },
  novelty: {
    passed: 'Mutation is fresh for the current match context.',
    failed: 'Mutation repeats an active, recent, or rejected mechanic.',
  },
  simulation: {
    passed: 'Deterministic simulation applied and expired the mutation cleanly.',
    failed: 'Deterministic simulation could not apply and expire the mutation safely.',
  },
}

function check(gate: ValidationGate, passed: boolean): ValidationCheck {
  return {
    gate,
    status: passed ? 'passed' : 'failed',
    message: CHECK_MESSAGES[gate][passed ? 'passed' : 'failed'],
  }
}

function reason(
  code: string,
  message: string,
  path: Array<string | number>,
): ValidationReason {
  return { code, message, path: path.slice(0, 12) }
}

function rejected(
  proposalId: string,
  checks: readonly ValidationCheck[],
  reasons: readonly ValidationReason[],
): ValidationResult {
  return ValidationResultSchema.parse({
    valid: false,
    proposalId,
    checks,
    reasons: reasons.slice(0, 16),
  })
}

function safeProposalId(input: unknown): string {
  if (typeof input !== 'object' || input === null) return 'unknown-proposal'
  const value = (input as Record<string, unknown>).proposalId
  return typeof value === 'string' && value.length <= 64 && IDENTIFIER.test(value)
    ? value
    : 'unknown-proposal'
}

function safePath(path: readonly PropertyKey[]): Array<string | number> {
  return path.slice(0, 12).map((part) => {
    if (typeof part === 'number' && Number.isInteger(part) && part >= 0) return part
    const text = String(part)
    return /^[a-zA-Z0-9_-]{1,64}$/.test(text) ? text : 'field'
  })
}

function schemaReasons(error: { issues: readonly { path: readonly PropertyKey[] }[] }): ValidationReason[] {
  const reasons = error.issues.map((issue) =>
    reason(
      'schema-invalid',
      'A proposal field is missing, unknown, or outside the contract bounds.',
      safePath(issue.path),
    ),
  )
  return [
    ...new Map(
      reasons.map((entry) => [`${entry.code}:${entry.path.join('.')}`, entry]),
    ).values(),
  ].slice(0, 16)
}

function triggerCapacity(
  trigger: MutationTrigger,
  mutation: MutationDefinition,
): number {
  if (trigger.type === 'onActivation') return 1
  if (trigger.type === 'onInterval') {
    return Math.floor(mutation.durationMs / trigger.everyMs)
  }
  return mutation.limits.maxTriggerActivations
}

function worstCaseSpawnCount(mutation: MutationDefinition): number {
  const weightedTriggers = mutation.triggers
    .map((trigger) => ({
      capacity: triggerCapacity(trigger, mutation),
      spawnCount: trigger.effects.reduce(
        (total, effect) =>
          total +
          (effect.type === 'spawnCollector' ||
          effect.type === 'spawnBonusCore' ||
          effect.type === 'spawnRunnerHazard'
            ? effect.count
            : 0),
        0,
      ),
    }))
    .sort(
      (first, second) =>
        second.spawnCount - first.spawnCount || second.capacity - first.capacity,
    )
  let remainingActivations = mutation.limits.maxTriggerActivations
  let spawned = 0
  for (const entry of weightedTriggers) {
    const activations = Math.min(remainingActivations, entry.capacity)
    spawned += activations * entry.spawnCount
    remainingActivations -= activations
    if (remainingActivations === 0) break
  }
  return spawned
}

function capabilityReasons(
  mutation: MutationDefinition,
  context: MatchDirectorContext,
  policy: ValidatorPolicy,
): readonly ValidationReason[] {
  const reasons: ValidationReason[] = []
  const knownTriggers = new Set<string>(MUTATION_CAPABILITIES.triggers)
  const knownEffects = new Set<string>(MUTATION_CAPABILITIES.effects)
  const knownObjectives = new Set<string>(MUTATION_CAPABILITIES.objectives)

  mutation.triggers.forEach((trigger, triggerIndex) => {
    if (!knownTriggers.has(trigger.type)) {
      reasons.push(
        reason(
          'unsupported-trigger',
          'Mutation uses an unsupported trigger.',
          ['mutation', 'triggers', triggerIndex, 'type'],
        ),
      )
    }
    trigger.effects.forEach((effect, effectIndex) => {
      if (!knownEffects.has(effect.type)) {
        reasons.push(
          reason(
            'unsupported-effect',
            'Mutation uses an unsupported effect.',
            ['mutation', 'triggers', triggerIndex, 'effects', effectIndex, 'type'],
          ),
        )
      }
    })
  })
  if (mutation.objective && !knownObjectives.has(mutation.objective.type)) {
    reasons.push(
      reason(
        'unsupported-objective',
        'Mutation uses an unsupported secondary objective.',
        ['mutation', 'objective', 'type'],
      ),
    )
  }

  if (mutation.durationMs > policy.maxDurationMs) {
    reasons.push(
      reason(
        'duration-policy-limit',
        'Mutation duration exceeds the live-match policy limit.',
        ['mutation', 'durationMs'],
      ),
    )
  }
  if (
    context.telemetry.activeMutationIds.length >= policy.maxActiveMutations
  ) {
    reasons.push(
      reason(
        'active-mutation-limit',
        'The match already has the maximum number of active mutations.',
        ['context', 'telemetry', 'activeMutationIds'],
      ),
    )
  }
  if (mutation.limits.maxTriggerActivations > policy.maxTriggerActivations) {
    reasons.push(
      reason(
        'trigger-activation-limit',
        'Mutation requests too many trigger activations.',
        ['mutation', 'limits', 'maxTriggerActivations'],
      ),
    )
  }
  if (mutation.limits.maxSpawnedEntities > policy.maxSpawnedEntities) {
    reasons.push(
      reason(
        'spawned-entity-limit',
        'Mutation requests too many retained spawned entities.',
        ['mutation', 'limits', 'maxSpawnedEntities'],
      ),
    )
  }
  const projectedSpawns = worstCaseSpawnCount(mutation)
  if (
    projectedSpawns > mutation.limits.maxSpawnedEntities ||
    projectedSpawns > policy.maxSpawnedEntities
  ) {
    reasons.push(
      reason(
        'spawn-budget-exceeded',
        'Worst-case trigger activity would exceed the spawn budget.',
        ['mutation', 'limits', 'maxSpawnedEntities'],
      ),
    )
  }

  const effectTagOwners = new Map<string, string>()
  const modifiedRules = new Set<string>()
  let extractionAdjustments = 0
  let hazardRelocations = 0
  let runnerConfigurations = 0
  for (const { effect, effectIndex, trigger, triggerIndex } of mutationEffectEntries(
    mutation,
  )) {
    const path = ['mutation', 'triggers', triggerIndex, 'effects', effectIndex]
    const owner =
      effect.type === 'modifyRule'
        ? `${effect.type}:${effect.rule}`
        : effect.type === 'adjustExtractionRequirement'
          ? effect.type
          : requiredCleanupType(effect)
    const previousOwner = effectTagOwners.get(effect.tag)
    if (previousOwner && previousOwner !== owner) {
      reasons.push(
        reason(
          'ambiguous-effect-tag',
          'One effect tag cannot own different temporary resources.',
          [...path, 'tag'],
        ),
      )
    } else {
      effectTagOwners.set(effect.tag, owner)
    }

    if (effect.type === 'spawnCollector') {
      if (
        effect.contactDamage > policy.maxCollectorContactDamage ||
        effect.speedMultiplier > policy.maxCollectorSpeedMultiplier
      ) {
        reasons.push(
          reason(
            'collector-policy-limit',
            'Collector speed or contact damage exceeds live-match policy.',
            path,
          ),
        )
      }
    }
    if (effect.type === 'modifyRule') {
      if (trigger.type !== 'onActivation') {
        reasons.push(
          reason(
            'repeating-rule-modifier',
            'Rule modifiers may run only once on mutation activation.',
            path,
          ),
        )
      }
      const range = policy.modifierRanges[effect.rule]
      if (effect.value < range.minimum || effect.value > range.maximum) {
        reasons.push(
          reason(
            'modifier-policy-limit',
            'Rule modifier is outside the safe live-match range.',
            [...path, 'value'],
          ),
        )
      }
      if (modifiedRules.has(effect.rule)) {
        reasons.push(
          reason(
            'duplicate-rule-modifier',
            'A mutation may modify each game rule only once.',
            path,
          ),
        )
      }
      modifiedRules.add(effect.rule)
    }
    if (effect.type === 'adjustExtractionRequirement') {
      extractionAdjustments += 1
      if (trigger.type !== 'onActivation') {
        reasons.push(
          reason(
            'repeating-extraction-adjustment',
            'Extraction requirements may change only once on activation.',
            path,
          ),
        )
      }
    }
    if (effect.type === 'relocateHazard') hazardRelocations += 1
    if (effect.type === 'configureRunner') {
      runnerConfigurations += 1
      if (trigger.type !== 'onActivation') {
        reasons.push(
          reason(
            'repeating-runner-configuration',
            'Runner physics may change only once on mutation activation.',
            path,
          ),
        )
      }
      if (mutation.durationMs > policy.maxRunnerPhysicsDurationMs) {
        reasons.push(
          reason(
            'runner-physics-duration-limit',
            'Runner physics changes exceed the live-match duration limit.',
            ['mutation', 'durationMs'],
          ),
        )
      }
      if (
        effect.speedMultiplier > policy.maxRunnerSpeedMultiplier ||
        effect.scaleMultiplier > policy.maxRunnerScaleMultiplier
      ) {
        reasons.push(
          reason(
            'runner-configuration-policy-limit',
            'Runner speed or scale exceeds the referee policy.',
            path,
          ),
        )
      }
      const noOp =
        effect.gravityMode === 'normal' &&
        effect.rotationMode === 'upright' &&
        effect.worldStyle === 'normal' &&
        effect.jumpMultiplier === 1 &&
        effect.speedMultiplier === 1 &&
        effect.scaleMultiplier === 1
      if (noOp) {
        reasons.push(
          reason(
            'runner-configuration-noop',
            'Runner configuration must create a visible or mechanical change.',
            path,
          ),
        )
      }
    }
    if (effect.type === 'spawnRunnerHazard') {
      if (trigger.type !== 'onActivation' && trigger.type !== 'onInterval') {
        reasons.push(
          reason(
            'runner-hazard-trigger-unsupported',
            'Runner hazards may spawn only on activation or a bounded interval.',
            path,
          ),
        )
      }
      if (
        effect.telegraphMs < policy.minRunnerTelegraphMs ||
        effect.speedMultiplier > policy.maxRunnerHazardSpeedMultiplier
      ) {
        reasons.push(
          reason(
            'runner-hazard-policy-limit',
            'Runner hazards need a longer warning or a lower travel speed.',
            path,
          ),
        )
      }
      if (
        trigger.type === 'onInterval' &&
        effect.telegraphMs + effect.spacingMs * (effect.count - 1) > trigger.everyMs
      ) {
        reasons.push(
          reason(
            'runner-hazard-wave-overlap',
            'A runner hazard wave must finish its warning and spacing before repeating.',
            path,
          ),
        )
      }
    }
  }
  if (extractionAdjustments > 1) {
    reasons.push(
      reason(
        'duplicate-extraction-adjustment',
        'A mutation may adjust the extraction requirement only once.',
        ['mutation', 'triggers'],
      ),
    )
  }
  if (hazardRelocations > 1) {
    reasons.push(
      reason(
        'duplicate-hazard-relocation',
        'A mutation may relocate only one hazard at a time.',
        ['mutation', 'triggers'],
      ),
    )
  }
  if (runnerConfigurations > 1) {
    reasons.push(
      reason(
        'duplicate-runner-configuration',
        'A mutation may configure runner physics only once.',
        ['mutation', 'triggers'],
      ),
    )
  }

  return reasons.slice(0, 16)
}

function cleanupReasons(
  mutation: MutationDefinition,
): readonly ValidationReason[] {
  const reasons: ValidationReason[] = []
  const required = new Set(
    mutationEffectEntries(mutation).map(
      ({ effect }) => `${effect.tag}:${requiredCleanupType(effect)}`,
    ),
  )
  const seen = new Set<string>()
  mutation.cleanup.forEach((cleanup, index) => {
    const key = `${cleanup.tag}:${cleanup.type}`
    if (seen.has(key)) {
      reasons.push(
        reason(
          'duplicate-cleanup',
          'A cleanup rule is duplicated.',
          ['mutation', 'cleanup', index],
        ),
      )
    }
    seen.add(key)
    if (!required.has(key)) {
      reasons.push(
        reason(
          'orphan-cleanup',
          'A cleanup rule does not match any temporary effect.',
          ['mutation', 'cleanup', index],
        ),
      )
    }
  })
  for (const key of required) {
    if (!seen.has(key)) {
      reasons.push(
        reason(
          'missing-cleanup',
          'A temporary effect has no matching expiry cleanup.',
          ['mutation', 'cleanup'],
        ),
      )
    }
  }
  return reasons.slice(0, 16)
}

function difficultyReasons(
  mutation: MutationDefinition,
  context: MatchDirectorContext,
  state: GameState,
  policy: ValidatorPolicy,
): readonly ValidationReason[] {
  const reasons: ValidationReason[] = []
  if (mutation.difficultyCost > context.remainingDifficultyBudget) {
    reasons.push(
      reason(
        'difficulty-budget-exceeded',
        'Mutation cost exceeds the remaining difficulty budget.',
        ['mutation', 'difficultyCost'],
      ),
    )
  }
  if (mutation.difficultyCost > policy.maxDifficultyCost) {
    reasons.push(
      reason(
        'difficulty-policy-limit',
        'Mutation cost exceeds the per-patch difficulty limit.',
        ['mutation', 'difficultyCost'],
      ),
    )
  }

  const pressure = estimateMutationPressure(mutation)
  const minimumDeclaredCost = Math.max(0.25, pressure * 0.75)
  if (mutation.difficultyCost + 0.25 < minimumDeclaredCost) {
    reasons.push(
      reason(
        'difficulty-underreported',
        'Mutation difficulty cost is too low for its combined effects.',
        ['mutation', 'difficultyCost'],
      ),
    )
  }

  const struggling =
    context.telemetry.challengeTrend === 'too_hard' ||
    context.telemetry.recentDeaths > 0 ||
    state.player.health / state.player.maxHealth < 0.35
  if (struggling && pressure > 0.25) {
    reasons.push(
      reason(
        'escalation-blocked',
        'Pressure cannot increase while the player is struggling.',
        ['mutation', 'difficultyCost'],
      ),
    )
  }
  return reasons.slice(0, 16)
}

function noveltyReasons(
  mutation: MutationDefinition,
  context: MatchDirectorContext,
  recentMechanicKeys: readonly string[],
): readonly ValidationReason[] {
  const reasons: ValidationReason[] = []
  const activeAndRecentIds = new Set([
    ...context.telemetry.activeMutationIds,
    ...context.recentMutationIds,
    ...context.telemetry.recentPatchOutcomes.map(({ mutationId }) => mutationId),
  ])
  if (activeAndRecentIds.has(mutation.id)) {
    reasons.push(
      reason(
        'mutation-repeated',
        'Mutation is already active or was used recently.',
        ['mutation', 'id'],
      ),
    )
  }

  const tokens = mutationMechanicTokens(mutation)
  if (new Set(tokens).size !== tokens.length) {
    reasons.push(
      reason(
        'mechanic-duplicated',
        'Mutation repeats the same mechanic within one proposal.',
        ['mutation', 'triggers'],
      ),
    )
  }
  const mechanicKey = mutationMechanicKey(mutation)
  const conceptId = mutationConceptId(mutation)
  const recent = new Set(recentMechanicKeys)
  if (recent.has(mechanicKey) || recent.has(conceptId)) {
    reasons.push(
      reason(
        'mechanic-repeated',
        'Mutation repeats a mechanic used in a recent patch.',
        ['mutation', 'triggers'],
      ),
    )
  }
  if (
    context.rejectedConceptIds.includes(conceptId) ||
    context.rejectedConceptIds.includes(mutation.id)
  ) {
    reasons.push(
      reason(
        'concept-rejected',
        'Mutation repeats a concept already rejected for this match.',
        ['mutation', 'triggers'],
      ),
    )
  }
  return reasons.slice(0, 16)
}

function simulationReasons(
  proposal: MutationProposal,
  context: MatchDirectorContext,
  gameState: GameState,
  policy: ValidatorPolicy,
  adapter: MutationSimulationAdapter,
): readonly ValidationReason[] {
  try {
    const input = { mutation: proposal.mutation, context, gameState, policy }
    const first = adapter.simulate(input)
    const second = adapter.simulate(input)
    if (stableSerialize(first) !== stableSerialize(second)) {
      return [
        reason(
          'simulation-nondeterministic',
          'Repeated deterministic simulations produced different results.',
          ['mutation'],
        ),
      ]
    }
    if (!first.passed || first.reasons.length > 0) {
      const simulationFailures = first.reasons.map((entry) =>
        reason(
          IDENTIFIER.test(entry.code) && entry.code.length <= 64
            ? entry.code
            : 'simulation-failed',
          'Deterministic simulation could not apply and clean up the mutation.',
          safePath(entry.path),
        ),
      )
      return simulationFailures.length > 0
        ? simulationFailures.slice(0, 16)
        : [
            reason(
              'simulation-failed',
              'Deterministic simulation could not apply and clean up the mutation.',
              ['mutation'],
            ),
          ]
    }
    return []
  } catch {
    return [
      reason(
        'simulation-failed',
        'Deterministic simulation could not apply and clean up the mutation.',
        ['mutation'],
      ),
    ]
  }
}

function validate(input: MutationValidationInput): ValidationResult {
  const proposalId = safeProposalId(input.proposal)
  const checks: ValidationCheck[] = []
  const proposalResult = MutationProposalSchema.safeParse(input.proposal)
  if (!proposalResult.success) {
    checks.push(check('schema', false))
    return rejected(proposalId, checks, schemaReasons(proposalResult.error))
  }
  const proposal = proposalResult.data
  checks.push(check('schema', true))

  const contextResult = MatchDirectorContextSchema.safeParse(input.context)
  const stateResult = GameStateSchema.safeParse(input.gameState)
  if (!contextResult.success || !stateResult.success) {
    checks.push(check('invariant', false))
    return rejected(proposal.proposalId, checks, [
      reason(
        !contextResult.success ? 'context-invalid' : 'game-state-invalid',
        !contextResult.success
          ? 'The match context is invalid for mutation validation.'
          : 'The game state is invalid for mutation validation.',
        !contextResult.success ? ['context'] : ['gameState'],
      ),
    ])
  }
  const context = contextResult.data
  const gameState = stateResult.data
  const policy = resolveValidatorPolicy(input.policy)

  const gates: Array<
    readonly [ValidationGate, () => readonly ValidationReason[]]
  > = [
    ['capability', () => capabilityReasons(proposal.mutation, context, policy)],
    ['cleanup', () => cleanupReasons(proposal.mutation)],
    [
      'invariant',
      () => evaluateMutationInvariants(proposal.mutation, gameState, policy),
    ],
    [
      'difficulty',
      () => difficultyReasons(proposal.mutation, context, gameState, policy),
    ],
    [
      'novelty',
      () => noveltyReasons(proposal.mutation, context, input.recentMechanicKeys ?? []),
    ],
    [
      'simulation',
      () =>
        simulationReasons(
          proposal,
          context,
          gameState,
          policy,
          input.simulationAdapter ?? deterministicMutationSimulationAdapter,
        ),
    ],
  ]

  for (const [gate, evaluate] of gates) {
    const reasons = evaluate()
    checks.push(check(gate, reasons.length === 0))
    if (reasons.length > 0) {
      return rejected(proposal.proposalId, checks, reasons)
    }
  }

  return ValidationResultSchema.parse({
    valid: true,
    proposalId: proposal.proposalId,
    score: scoreMutation(proposal.mutation, context),
    checks,
  })
}

export function validateMutationProposal(
  input: MutationValidationInput,
): ValidationResult
export function validateMutationProposal(
  proposal: unknown,
  context: unknown,
  gameState: unknown,
  options?: MutationValidationOptions,
): ValidationResult
export function validateMutationProposal(
  inputOrProposal: MutationValidationInput | unknown,
  context?: unknown,
  gameState?: unknown,
  options: MutationValidationOptions = {},
): ValidationResult {
  if (
    arguments.length === 1 &&
    typeof inputOrProposal === 'object' &&
    inputOrProposal !== null &&
    'proposal' in inputOrProposal &&
    'context' in inputOrProposal &&
    'gameState' in inputOrProposal
  ) {
    return validate(inputOrProposal as MutationValidationInput)
  }
  return validate({ proposal: inputOrProposal, context, gameState, ...options })
}

export const validateProposal = validateMutationProposal
