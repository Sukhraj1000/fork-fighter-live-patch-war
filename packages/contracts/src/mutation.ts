import { z } from 'zod'

import {
  FiniteNumberSchema,
  IdentifierSchema,
  NonNegativeIntegerSchema,
  PositiveIntegerSchema,
} from './primitives.js'

export const MUTATION_CONTRACT_VERSION = 1 as const
export const MAX_MUTATION_DURATION_MS = 60_000
export const MAX_TRIGGERS_PER_MUTATION = 4
export const MAX_EFFECTS_PER_TRIGGER = 4
export const MAX_SPAWN_COUNT_PER_EFFECT = 3
export const MAX_TRIGGER_ACTIVATIONS = 32
export const MAX_SPAWNED_ENTITIES = 32

export const GameMasterPersonaSchema = z.enum([
  'architect',
  'gremlin',
  'auditor',
])

export const SpawnCollectorEffectSchema = z
  .object({
    type: z.literal('spawnCollector'),
    count: PositiveIntegerSchema.max(MAX_SPAWN_COUNT_PER_EFFECT),
    spawnAt: z.enum(['collectedCore', 'farthestEdge']),
    speedMultiplier: FiniteNumberSchema.min(0.25).max(1.5),
    contactDamage: PositiveIntegerSchema.max(25),
    tag: IdentifierSchema,
  })
  .strict()

export const RelocateHazardEffectSchema = z
  .object({
    type: z.literal('relocateHazard'),
    hazard: z.enum(['nearest', 'leastActive']),
    destination: z.enum(['mostUsedRoute', 'aheadOfPlayer']),
    maxDistance: FiniteNumberSchema.positive().max(500),
    tag: IdentifierSchema,
  })
  .strict()

export const SpawnBonusCoreEffectSchema = z
  .object({
    type: z.literal('spawnBonusCore'),
    count: PositiveIntegerSchema.max(MAX_SPAWN_COUNT_PER_EFFECT),
    spawnAt: z.enum(['riskyRoute', 'awayFromMostUsedRoute']),
    scoreMultiplier: FiniteNumberSchema.min(1).max(3),
    tag: IdentifierSchema,
  })
  .strict()

export const ModifyRuleEffectSchema = z
  .object({
    type: z.literal('modifyRule'),
    rule: z.enum([
      'moveSpeed',
      'dashCooldownMs',
      'damageTakenMultiplier',
    ]),
    operation: z.literal('multiply'),
    value: FiniteNumberSchema.min(0.5).max(2),
    tag: IdentifierSchema,
  })
  .strict()

export const AdjustExtractionRequirementEffectSchema = z
  .object({
    type: z.literal('adjustExtractionRequirement'),
    additionalBankedCores: PositiveIntegerSchema.max(2),
    tag: IdentifierSchema,
  })
  .strict()

export const MutationEffectSchema = z.discriminatedUnion('type', [
  SpawnCollectorEffectSchema,
  RelocateHazardEffectSchema,
  SpawnBonusCoreEffectSchema,
  ModifyRuleEffectSchema,
  AdjustExtractionRequirementEffectSchema,
])

const effectsSchema = z
  .array(MutationEffectSchema)
  .min(1)
  .max(MAX_EFFECTS_PER_TRIGGER)

export const OnActivationTriggerSchema = z
  .object({
    id: IdentifierSchema,
    type: z.literal('onActivation'),
    effects: effectsSchema,
  })
  .strict()

export const OnCoreCollectedTriggerSchema = z
  .object({
    id: IdentifierSchema,
    type: z.literal('onCoreCollected'),
    coreRisk: z.enum(['any', 'safe', 'risky']).default('any'),
    effects: effectsSchema,
  })
  .strict()

export const OnCoreBankedTriggerSchema = z
  .object({
    id: IdentifierSchema,
    type: z.literal('onCoreBanked'),
    minimumBanked: PositiveIntegerSchema.max(100).default(1),
    effects: effectsSchema,
  })
  .strict()

export const OnIntervalTriggerSchema = z
  .object({
    id: IdentifierSchema,
    type: z.literal('onInterval'),
    everyMs: PositiveIntegerSchema.min(1_000).max(30_000),
    effects: effectsSchema,
  })
  .strict()

export const MutationTriggerSchema = z.discriminatedUnion('type', [
  OnActivationTriggerSchema,
  OnCoreCollectedTriggerSchema,
  OnCoreBankedTriggerSchema,
  OnIntervalTriggerSchema,
])

export const ObjectiveRewardSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('grantScore'),
      amount: PositiveIntegerSchema.max(10_000),
    })
    .strict(),
  z
    .object({
      type: z.literal('grantTime'),
      amountMs: PositiveIntegerSchema.max(15_000),
    })
    .strict(),
])

const objectiveEnvelope = {
  id: IdentifierSchema,
  title: z.string().min(1).max(80),
  description: z.string().min(1).max(200),
  reward: ObjectiveRewardSchema,
}

export const SecondaryObjectiveSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...objectiveEnvelope,
      type: z.literal('bankAdditionalCores'),
      count: PositiveIntegerSchema.max(3),
    })
    .strict(),
  z
    .object({
      ...objectiveEnvelope,
      type: z.literal('collectRiskyCores'),
      count: PositiveIntegerSchema.max(3),
    })
    .strict(),
  z
    .object({
      ...objectiveEnvelope,
      type: z.literal('survive'),
      durationMs: PositiveIntegerSchema.min(1_000).max(30_000),
    })
    .strict(),
])

export const CleanupRuleSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('removeEntitiesByTag'),
      tag: IdentifierSchema,
      when: z.literal('expiry'),
    })
    .strict(),
  z
    .object({
      type: z.literal('restoreEntitiesByTag'),
      tag: IdentifierSchema,
      when: z.literal('expiry'),
    })
    .strict(),
  z
    .object({
      type: z.literal('restoreRulesByTag'),
      tag: IdentifierSchema,
      when: z.literal('expiry'),
    })
    .strict(),
])

export const MutationLimitsSchema = z
  .object({
    maxTriggerActivations: PositiveIntegerSchema.max(MAX_TRIGGER_ACTIVATIONS),
    maxSpawnedEntities: PositiveIntegerSchema.max(MAX_SPAWNED_ENTITIES),
  })
  .strict()

const MutationDefinitionBaseSchema = z
  .object({
    id: IdentifierSchema,
    title: z.string().min(1).max(80),
    patchNote: z.string().min(1).max(200),
    author: GameMasterPersonaSchema,
    durationMs: PositiveIntegerSchema.min(1_000).max(
      MAX_MUTATION_DURATION_MS,
    ),
    difficultyCost: FiniteNumberSchema.positive().max(5),
    triggers: z
      .array(MutationTriggerSchema)
      .min(1)
      .max(MAX_TRIGGERS_PER_MUTATION),
    objective: SecondaryObjectiveSchema.optional(),
    limits: MutationLimitsSchema,
    cleanup: z.array(CleanupRuleSchema).min(1).max(16),
  })
  .strict()

function requiredCleanupType(
  effect: z.infer<typeof MutationEffectSchema>,
): z.infer<typeof CleanupRuleSchema>['type'] {
  switch (effect.type) {
    case 'spawnCollector':
    case 'spawnBonusCore':
      return 'removeEntitiesByTag'
    case 'relocateHazard':
      return 'restoreEntitiesByTag'
    case 'modifyRule':
    case 'adjustExtractionRequirement':
      return 'restoreRulesByTag'
  }
}

export const MutationDefinitionSchema = MutationDefinitionBaseSchema.superRefine(
  (mutation, context) => {
    const triggerIds = mutation.triggers.map(({ id }) => id)
    if (new Set(triggerIds).size !== triggerIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Trigger ids must be unique within a mutation',
        path: ['triggers'],
      })
    }

    let spawnedPerActivation = 0
    const requiredCleanups = new Set<string>()

    mutation.triggers.forEach((trigger, triggerIndex) => {
      if (trigger.type === 'onInterval' && trigger.everyMs > mutation.durationMs) {
        context.addIssue({
          code: 'custom',
          message: 'Interval must occur within the mutation duration',
          path: ['triggers', triggerIndex, 'everyMs'],
        })
      }

      trigger.effects.forEach((effect) => {
        if (effect.type === 'spawnCollector' || effect.type === 'spawnBonusCore') {
          spawnedPerActivation += effect.count
        }
        requiredCleanups.add(`${effect.tag}:${requiredCleanupType(effect)}`)
      })
    })

    if (spawnedPerActivation > mutation.limits.maxSpawnedEntities) {
      context.addIssue({
        code: 'custom',
        message: 'Spawn effects exceed maxSpawnedEntities',
        path: ['limits', 'maxSpawnedEntities'],
      })
    }

    const cleanupKeys = new Set(
      mutation.cleanup.map((rule) => `${rule.tag}:${rule.type}`),
    )
    for (const requiredCleanup of requiredCleanups) {
      if (!cleanupKeys.has(requiredCleanup)) {
        const separatorIndex = requiredCleanup.lastIndexOf(':')
        const tag = requiredCleanup.slice(0, separatorIndex)
        const cleanupType = requiredCleanup.slice(separatorIndex + 1)
        context.addIssue({
          code: 'custom',
          message: `Effect tag ${tag} requires ${cleanupType}`,
          path: ['cleanup'],
        })
      }
    }
  },
)

export const MutationCapabilityReferenceSchema = z
  .object({
    version: z.literal(MUTATION_CONTRACT_VERSION),
    triggers: z.array(
      z.enum([
        'onActivation',
        'onCoreCollected',
        'onCoreBanked',
        'onInterval',
      ]),
    ),
    effects: z.array(
      z.enum([
        'spawnCollector',
        'relocateHazard',
        'spawnBonusCore',
        'modifyRule',
        'adjustExtractionRequirement',
      ]),
    ),
    objectives: z.array(
      z.enum(['bankAdditionalCores', 'collectRiskyCores', 'survive']),
    ),
    limits: z
      .object({
        maxDurationMs: PositiveIntegerSchema,
        maxTriggers: PositiveIntegerSchema,
        maxEffectsPerTrigger: PositiveIntegerSchema,
        maxSpawnCountPerEffect: PositiveIntegerSchema,
        maxTriggerActivations: PositiveIntegerSchema,
        maxSpawnedEntities: PositiveIntegerSchema,
      })
      .strict(),
  })
  .strict()

export const MUTATION_CAPABILITIES = MutationCapabilityReferenceSchema.parse({
  version: MUTATION_CONTRACT_VERSION,
  triggers: [
    'onActivation',
    'onCoreCollected',
    'onCoreBanked',
    'onInterval',
  ],
  effects: [
    'spawnCollector',
    'relocateHazard',
    'spawnBonusCore',
    'modifyRule',
    'adjustExtractionRequirement',
  ],
  objectives: ['bankAdditionalCores', 'collectRiskyCores', 'survive'],
  limits: {
    maxDurationMs: MAX_MUTATION_DURATION_MS,
    maxTriggers: MAX_TRIGGERS_PER_MUTATION,
    maxEffectsPerTrigger: MAX_EFFECTS_PER_TRIGGER,
    maxSpawnCountPerEffect: MAX_SPAWN_COUNT_PER_EFFECT,
    maxTriggerActivations: MAX_TRIGGER_ACTIVATIONS,
    maxSpawnedEntities: MAX_SPAWNED_ENTITIES,
  },
})

export type GameMasterPersona = z.infer<typeof GameMasterPersonaSchema>
export type SpawnCollectorEffect = z.infer<typeof SpawnCollectorEffectSchema>
export type RelocateHazardEffect = z.infer<typeof RelocateHazardEffectSchema>
export type SpawnBonusCoreEffect = z.infer<typeof SpawnBonusCoreEffectSchema>
export type ModifyRuleEffect = z.infer<typeof ModifyRuleEffectSchema>
export type AdjustExtractionRequirementEffect = z.infer<
  typeof AdjustExtractionRequirementEffectSchema
>
export type MutationEffect = z.infer<typeof MutationEffectSchema>
export type OnActivationTrigger = z.infer<typeof OnActivationTriggerSchema>
export type OnCoreCollectedTrigger = z.infer<
  typeof OnCoreCollectedTriggerSchema
>
export type OnCoreBankedTrigger = z.infer<typeof OnCoreBankedTriggerSchema>
export type OnIntervalTrigger = z.infer<typeof OnIntervalTriggerSchema>
export type MutationTrigger = z.infer<typeof MutationTriggerSchema>
export type ObjectiveReward = z.infer<typeof ObjectiveRewardSchema>
export type SecondaryObjective = z.infer<typeof SecondaryObjectiveSchema>
export type CleanupRule = z.infer<typeof CleanupRuleSchema>
export type MutationLimits = z.infer<typeof MutationLimitsSchema>
export type MutationDefinition = z.infer<typeof MutationDefinitionSchema>
export type MutationCapabilityReference = z.infer<
  typeof MutationCapabilityReferenceSchema
>
