import { z } from 'zod'

import {
  FiniteNumberSchema,
  IdentifierSchema,
  NonNegativeIntegerSchema,
  PositiveIntegerSchema,
  RectangleSchema,
  Vector2Schema,
} from './primitives.js'

export const ObstacleDefinitionSchema = z
  .object({
    id: IdentifierSchema,
    bounds: RectangleSchema,
  })
  .strict()

export const DamageZoneDefinitionSchema = z
  .object({
    id: IdentifierSchema,
    bounds: RectangleSchema,
    damage: FiniteNumberSchema.positive().max(1_000),
  })
  .strict()

export const CoreSpawnDefinitionSchema = z
  .object({
    id: IdentifierSchema,
    position: Vector2Schema,
    jitter: Vector2Schema.optional(),
    risk: z.enum(['safe', 'risky']),
  })
  .strict()

export const RelayDefinitionSchema = z
  .object({
    id: IdentifierSchema,
    position: Vector2Schema,
    radius: FiniteNumberSchema.positive().max(1_000),
  })
  .strict()

export const ExtractionDefinitionSchema = RelayDefinitionSchema

export const GameMapDefinitionSchema = z
  .object({
    id: IdentifierSchema,
    width: FiniteNumberSchema.positive().max(100_000),
    height: FiniteNumberSchema.positive().max(100_000),
    playerSpawn: Vector2Schema,
    obstacles: z.array(ObstacleDefinitionSchema).max(256),
    damageZones: z.array(DamageZoneDefinitionSchema).max(256),
    coreSpawns: z.array(CoreSpawnDefinitionSchema).min(1).max(256),
    relays: z.array(RelayDefinitionSchema).min(1).max(32),
    extraction: ExtractionDefinitionSchema,
  })
  .strict()
  .superRefine((map, context) => {
    const ids = [
      ...map.obstacles.map(({ id }) => id),
      ...map.damageZones.map(({ id }) => id),
      ...map.coreSpawns.map(({ id }) => id),
      ...map.relays.map(({ id }) => id),
      map.extraction.id,
    ]

    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        message: 'Map entity ids must be unique',
        path: ['id'],
      })
    }
  })

export const GameRulesSchema = z
  .object({
    tickMs: PositiveIntegerSchema.max(1_000),
    moveSpeed: FiniteNumberSchema.positive().max(2_000),
    playerRadius: FiniteNumberSchema.positive().max(1_000),
    dashDistance: FiniteNumberSchema.positive().max(10_000),
    dashCooldownMs: NonNegativeIntegerSchema.max(60_000),
    damageCooldownMs: NonNegativeIntegerSchema.max(60_000),
    maxHealth: PositiveIntegerSchema.max(10_000),
    requiredBankedCores: PositiveIntegerSchema.max(100),
    coreRadius: FiniteNumberSchema.positive().max(1_000),
    relayBankScore: NonNegativeIntegerSchema.max(1_000_000),
    extractionScore: NonNegativeIntegerSchema.max(1_000_000),
  })
  .strict()

export const GameConfigSchema = z
  .object({
    version: z.literal(1),
    seed: z.union([z.number().int(), z.string().min(1).max(128)]),
    rules: GameRulesSchema,
    map: GameMapDefinitionSchema,
  })
  .strict()

export const CoreStatusSchema = z.enum(['available', 'carried', 'banked'])

export const CoreStateSchema = z
  .object({
    id: IdentifierSchema,
    spawnPosition: Vector2Schema,
    position: Vector2Schema,
    status: CoreStatusSchema,
    risk: z.enum(['safe', 'risky']),
  })
  .strict()

export const PlayerStateSchema = z
  .object({
    position: Vector2Schema,
    spawnPosition: Vector2Schema,
    health: NonNegativeIntegerSchema,
    maxHealth: PositiveIntegerSchema.max(10_000),
    radius: FiniteNumberSchema.positive().max(1_000),
    coresHeld: NonNegativeIntegerSchema.max(100),
    coresBanked: NonNegativeIntegerSchema.max(100),
    score: NonNegativeIntegerSchema.max(100_000_000),
    deaths: NonNegativeIntegerSchema,
    dashCooldownRemainingMs: NonNegativeIntegerSchema,
    damageCooldownRemainingMs: NonNegativeIntegerSchema,
  })
  .strict()
  .superRefine((player, context) => {
    if (player.health > player.maxHealth) {
      context.addIssue({
        code: 'custom',
        message: 'Player health cannot exceed maxHealth',
        path: ['health'],
      })
    }
  })

export const ExtractionStateSchema = z
  .object({
    id: IdentifierSchema,
    position: Vector2Schema,
    radius: FiniteNumberSchema.positive().max(1_000),
    requiredBankedCores: PositiveIntegerSchema.max(100),
    unlocked: z.boolean(),
    completed: z.boolean(),
  })
  .strict()

export const GameStatusSchema = z.enum(['running', 'completed'])

export const GameStateSchema = z
  .object({
    version: z.literal(1),
    seed: z.number().int(),
    rngState: NonNegativeIntegerSchema,
    tick: NonNegativeIntegerSchema,
    elapsedMs: NonNegativeIntegerSchema,
    status: GameStatusSchema,
    rules: GameRulesSchema,
    map: GameMapDefinitionSchema,
    player: PlayerStateSchema,
    cores: z.array(CoreStateSchema).min(1).max(256),
    extraction: ExtractionStateSchema,
  })
  .strict()

export const MoveCommandSchema = z
  .object({
    type: z.literal('move'),
    direction: Vector2Schema,
  })
  .strict()

export const DashCommandSchema = z
  .object({
    type: z.literal('dash'),
    direction: Vector2Schema,
  })
  .strict()

export const WaitCommandSchema = z.object({ type: z.literal('wait') }).strict()

export const PlayerCommandSchema = z.discriminatedUnion('type', [
  MoveCommandSchema,
  DashCommandSchema,
  WaitCommandSchema,
])

const eventEnvelope = {
  tick: NonNegativeIntegerSchema,
  atMs: NonNegativeIntegerSchema,
}

export const GameEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...eventEnvelope,
      type: z.literal('game_started'),
      seed: z.number().int(),
      mapId: IdentifierSchema,
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      type: z.literal('player_moved'),
      from: Vector2Schema,
      to: Vector2Schema,
      mode: z.enum(['move', 'dash']),
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      type: z.literal('movement_blocked'),
      obstacleIds: z.array(IdentifierSchema).min(1).max(256),
      mode: z.enum(['move', 'dash']),
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      type: z.literal('dash_rejected'),
      reason: z.enum(['cooldown', 'zero_direction']),
      remainingMs: NonNegativeIntegerSchema,
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      type: z.literal('core_collected'),
      coreId: IdentifierSchema,
      risk: z.enum(['safe', 'risky']),
      coresHeld: NonNegativeIntegerSchema.max(100),
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      type: z.literal('cores_banked'),
      relayId: IdentifierSchema,
      coreIds: z.array(IdentifierSchema).min(1).max(100),
      coresBanked: NonNegativeIntegerSchema.max(100),
      scoreAwarded: NonNegativeIntegerSchema.max(100_000_000),
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      type: z.literal('player_damaged'),
      sourceId: IdentifierSchema,
      amount: PositiveIntegerSchema.max(10_000),
      health: NonNegativeIntegerSchema.max(10_000),
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      type: z.literal('player_died'),
      sourceId: IdentifierSchema,
      deaths: PositiveIntegerSchema,
      respawnPosition: Vector2Schema,
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      type: z.literal('cores_respawned'),
      coreIds: z.array(IdentifierSchema).min(1).max(100),
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      type: z.literal('extraction_unlocked'),
      requiredBankedCores: PositiveIntegerSchema.max(100),
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      type: z.literal('extraction_completed'),
      finalScore: NonNegativeIntegerSchema.max(100_000_000),
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      type: z.literal('patch_activated'),
      mutationId: IdentifierSchema,
      author: z.enum(['architect', 'gremlin', 'auditor']),
      expiresAtMs: NonNegativeIntegerSchema,
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      type: z.literal('patch_effect_applied'),
      mutationId: IdentifierSchema,
      triggerId: IdentifierSchema,
      effect: z.enum([
        'spawnCollector',
        'relocateHazard',
        'spawnBonusCore',
        'modifyRule',
        'adjustExtractionRequirement',
      ]),
      affectedIds: z.array(IdentifierSchema).max(32),
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      type: z.literal('patch_expired'),
      mutationId: IdentifierSchema,
      cleanedTags: z.array(IdentifierSchema).min(1).max(16),
    })
    .strict(),
])

export const GameEventBatchSchema = z
  .object({
    matchId: IdentifierSchema,
    batchIndex: NonNegativeIntegerSchema,
    fromTick: NonNegativeIntegerSchema,
    toTick: NonNegativeIntegerSchema,
    events: z.array(GameEventSchema).max(2_048),
  })
  .strict()
  .superRefine((batch, context) => {
    if (batch.toTick < batch.fromTick) {
      context.addIssue({
        code: 'custom',
        message: 'toTick must be greater than or equal to fromTick',
        path: ['toTick'],
      })
    }

    let lastTick = batch.fromTick
    for (const [index, event] of batch.events.entries()) {
      if (event.tick < batch.fromTick || event.tick > batch.toTick) {
        context.addIssue({
          code: 'custom',
          message: 'Event tick must be inside the batch range',
          path: ['events', index, 'tick'],
        })
      }
      if (event.tick < lastTick) {
        context.addIssue({
          code: 'custom',
          message: 'Events must be ordered by tick',
          path: ['events', index, 'tick'],
        })
      }
      lastTick = event.tick
    }
  })

export type ObstacleDefinition = z.infer<typeof ObstacleDefinitionSchema>
export type DamageZoneDefinition = z.infer<typeof DamageZoneDefinitionSchema>
export type CoreSpawnDefinition = z.infer<typeof CoreSpawnDefinitionSchema>
export type RelayDefinition = z.infer<typeof RelayDefinitionSchema>
export type ExtractionDefinition = z.infer<typeof ExtractionDefinitionSchema>
export type GameMapDefinition = z.infer<typeof GameMapDefinitionSchema>
export type GameRules = z.infer<typeof GameRulesSchema>
export type GameConfig = z.infer<typeof GameConfigSchema>
export type CoreStatus = z.infer<typeof CoreStatusSchema>
export type CoreState = z.infer<typeof CoreStateSchema>
export type PlayerState = z.infer<typeof PlayerStateSchema>
export type ExtractionState = z.infer<typeof ExtractionStateSchema>
export type GameStatus = z.infer<typeof GameStatusSchema>
export type GameState = z.infer<typeof GameStateSchema>
export type MoveCommand = z.infer<typeof MoveCommandSchema>
export type DashCommand = z.infer<typeof DashCommandSchema>
export type WaitCommand = z.infer<typeof WaitCommandSchema>
export type PlayerCommand = z.infer<typeof PlayerCommandSchema>
export type GameEvent = z.infer<typeof GameEventSchema>
export type GameEventBatch = z.infer<typeof GameEventBatchSchema>
