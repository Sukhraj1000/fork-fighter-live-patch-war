import {
  GameConfigSchema,
  GameEventBatchSchema,
  GameStateSchema,
} from './game.js'
import { MutationDefinitionSchema } from './mutation.js'

const canonicalRules = {
  tickMs: 50,
  moveSpeed: 200,
  playerRadius: 14,
  dashDistance: 120,
  dashCooldownMs: 600,
  damageCooldownMs: 400,
  maxHealth: 100,
  requiredBankedCores: 3,
  coreRadius: 10,
  relayBankScore: 100,
  extractionScore: 500,
}

const canonicalMap = {
  id: 'fork-foundry-v1',
  width: 960,
  height: 540,
  playerSpawn: { x: 72, y: 96 },
  obstacles: [
    {
      id: 'central-crate-bank',
      bounds: { x: 280, y: 230, width: 150, height: 52 },
    },
    {
      id: 'lower-crate-bank',
      bounds: { x: 650, y: 330, width: 130, height: 48 },
    },
  ],
  damageZones: [
    {
      id: 'unstable-patch',
      bounds: { x: 490, y: 350, width: 90, height: 52 },
      damage: 20,
    },
  ],
  coreSpawns: [
    { id: 'core-a', position: { x: 220, y: 96 }, risk: 'safe' },
    { id: 'core-b', position: { x: 410, y: 96 }, risk: 'safe' },
    { id: 'core-c', position: { x: 600, y: 96 }, risk: 'risky' },
    { id: 'core-d', position: { x: 510, y: 470 }, risk: 'risky' },
  ],
  relays: [{ id: 'relay-alpha', position: { x: 760, y: 96 }, radius: 30 }],
  extraction: {
    id: 'extraction-gate',
    position: { x: 890, y: 96 },
    radius: 28,
  },
}

export const canonicalMockGameConfig = GameConfigSchema.parse({
  version: 1,
  seed: 42,
  rules: canonicalRules,
  map: canonicalMap,
})

export const canonicalMockGameState = GameStateSchema.parse({
  version: 1,
  seed: 42,
  rngState: 2_272_899_779,
  tick: 30,
  elapsedMs: 1_500,
  status: 'running',
  rules: canonicalRules,
  map: canonicalMap,
  player: {
    position: { x: 415, y: 96 },
    spawnPosition: { x: 72, y: 96 },
    health: 100,
    maxHealth: 100,
    radius: 14,
    coresHeld: 1,
    coresBanked: 1,
    score: 100,
    deaths: 0,
    dashCooldownRemainingMs: 0,
    damageCooldownRemainingMs: 0,
  },
  cores: [
    {
      id: 'core-a',
      spawnPosition: { x: 220, y: 96 },
      position: { x: 760, y: 96 },
      status: 'banked',
      risk: 'safe',
    },
    {
      id: 'core-b',
      spawnPosition: { x: 410, y: 96 },
      position: { x: 415, y: 96 },
      status: 'carried',
      risk: 'safe',
    },
    {
      id: 'core-c',
      spawnPosition: { x: 600, y: 96 },
      position: { x: 600, y: 96 },
      status: 'available',
      risk: 'risky',
    },
    {
      id: 'core-d',
      spawnPosition: { x: 510, y: 470 },
      position: { x: 510, y: 470 },
      status: 'available',
      risk: 'risky',
    },
  ],
  extraction: {
    id: 'extraction-gate',
    position: { x: 890, y: 96 },
    radius: 28,
    requiredBankedCores: 3,
    unlocked: false,
    completed: false,
  },
})

export const canonicalMockEventBatch = GameEventBatchSchema.parse({
  matchId: 'match-ff-042',
  batchIndex: 0,
  fromTick: 0,
  toTick: 30,
  events: [
    {
      type: 'game_started',
      tick: 0,
      atMs: 0,
      seed: 42,
      mapId: 'fork-foundry-v1',
    },
    {
      type: 'player_moved',
      tick: 10,
      atMs: 500,
      from: { x: 72, y: 96 },
      to: { x: 220, y: 96 },
      mode: 'dash',
    },
    {
      type: 'core_collected',
      tick: 12,
      atMs: 600,
      coreId: 'core-a',
      risk: 'safe',
      coresHeld: 1,
    },
    {
      type: 'cores_banked',
      tick: 20,
      atMs: 1_000,
      relayId: 'relay-alpha',
      coreIds: ['core-a'],
      coresBanked: 1,
      scoreAwarded: 100,
    },
    {
      type: 'core_collected',
      tick: 30,
      atMs: 1_500,
      coreId: 'core-b',
      risk: 'safe',
      coresHeld: 1,
    },
  ],
})

export const debtCollectorMutationFixture = MutationDefinitionSchema.parse({
  id: 'debt-collector',
  title: 'Debt Collector',
  patchNote: 'Collecting a core dispatches a slow collector to reclaim it.',
  author: 'gremlin',
  durationMs: 20_000,
  difficultyCost: 1.5,
  triggers: [
    {
      id: 'collect-core',
      type: 'onCoreCollected',
      coreRisk: 'any',
      effects: [
        {
          type: 'spawnCollector',
          count: 1,
          spawnAt: 'collectedCore',
          speedMultiplier: 0.55,
          contactDamage: 10,
          tag: 'debt-collector:collectors',
        },
      ],
    },
  ],
  limits: {
    maxTriggerActivations: 4,
    maxSpawnedEntities: 4,
  },
  cleanup: [
    {
      type: 'removeEntitiesByTag',
      tag: 'debt-collector:collectors',
      when: 'expiry',
    },
  ],
})

export const upsideDownForkStormMutationFixture = MutationDefinitionSchema.parse({
  id: 'upside-down-fork-storm',
  title: 'Upside-Down Fork Storm',
  patchNote: 'Gravity flips while telegraphed forks sweep the ceiling lane.',
  author: 'gremlin',
  durationMs: 12_000,
  difficultyCost: 2.25,
  triggers: [
    {
      id: 'flip-runner',
      type: 'onActivation',
      effects: [
        {
          type: 'configureRunner',
          gravityMode: 'inverted',
          jumpMultiplier: 0.9,
          speedMultiplier: 1,
          scaleMultiplier: 0.9,
          rotationMode: 'flipped',
          worldStyle: 'void',
          tag: 'upside-down-fork-storm:runner',
        },
      ],
    },
    {
      id: 'rain-forks',
      type: 'onInterval',
      everyMs: 3_000,
      effects: [
        {
          type: 'spawnRunnerHazard',
          hazard: 'fork_storm',
          lane: 'ceiling',
          count: 1,
          spacingMs: 500,
          speedMultiplier: 1,
          telegraphMs: 900,
          tag: 'upside-down-fork-storm:forks',
        },
      ],
    },
  ],
  limits: {
    maxTriggerActivations: 5,
    maxSpawnedEntities: 4,
  },
  cleanup: [
    {
      type: 'restoreRulesByTag',
      tag: 'upside-down-fork-storm:runner',
      when: 'expiry',
    },
    {
      type: 'removeEntitiesByTag',
      tag: 'upside-down-fork-storm:forks',
      when: 'expiry',
    },
  ],
})
