import type { GameMapDefinition, GameRules, Rectangle, Vector2 } from './types.js'

export const DEFAULT_GAME_RULES: GameRules = Object.freeze({
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
})

export const DETERMINISTIC_MAP_FIXTURE: GameMapDefinition = {
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
      damage: 50,
    },
  ],
  coreSpawns: [
    {
      id: 'core-a',
      position: { x: 220, y: 96 },
      jitter: { x: 4, y: 8 },
      risk: 'safe',
    },
    {
      id: 'core-b',
      position: { x: 410, y: 96 },
      jitter: { x: 4, y: 8 },
      risk: 'safe',
    },
    {
      id: 'core-c',
      position: { x: 600, y: 96 },
      jitter: { x: 4, y: 8 },
      risk: 'safe',
    },
    {
      id: 'core-d',
      position: { x: 510, y: 470 },
      jitter: { x: 8, y: 4 },
      risk: 'risky',
    },
  ],
  relays: [{ id: 'relay-alpha', position: { x: 760, y: 96 }, radius: 30 }],
  extraction: { id: 'extraction-gate', position: { x: 890, y: 96 }, radius: 28 },
}

function assertFinitePositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite positive number`)
  }
}

function isInsideMap(
  position: Vector2,
  map: GameMapDefinition,
  margin = 0,
): boolean {
  return (
    position.x >= margin &&
    position.x <= map.width - margin &&
    position.y >= margin &&
    position.y <= map.height - margin
  )
}

function isRectangleInsideMap(
  bounds: Rectangle,
  map: GameMapDefinition,
): boolean {
  return (
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    bounds.x >= 0 &&
    bounds.y >= 0 &&
    bounds.x + bounds.width <= map.width &&
    bounds.y + bounds.height <= map.height
  )
}

export function cloneMap(map: GameMapDefinition): GameMapDefinition {
  return {
    ...map,
    playerSpawn: { ...map.playerSpawn },
    obstacles: map.obstacles.map((obstacle) => ({
      ...obstacle,
      bounds: { ...obstacle.bounds },
    })),
    damageZones: map.damageZones.map((zone) => ({
      ...zone,
      bounds: { ...zone.bounds },
    })),
    coreSpawns: map.coreSpawns.map((core) => ({
      ...core,
      position: { ...core.position },
      ...(core.jitter ? { jitter: { ...core.jitter } } : {}),
    })),
    relays: map.relays.map((relay) => ({
      ...relay,
      position: { ...relay.position },
    })),
    extraction: {
      ...map.extraction,
      position: { ...map.extraction.position },
    },
  }
}

export function assertValidMap(map: GameMapDefinition, rules: GameRules): void {
  assertFinitePositive('map.width', map.width)
  assertFinitePositive('map.height', map.height)

  if (!map.id) throw new Error('map.id must not be empty')
  if (map.relays.length === 0) throw new Error('map must contain a relay')
  if (map.coreSpawns.length < rules.requiredBankedCores) {
    throw new Error('map does not contain enough cores for extraction')
  }

  const ids = [
    ...map.obstacles.map(({ id }) => id),
    ...map.damageZones.map(({ id }) => id),
    ...map.coreSpawns.map(({ id }) => id),
    ...map.relays.map(({ id }) => id),
    map.extraction.id,
  ]

  if (ids.some((id) => id.length === 0) || new Set(ids).size !== ids.length) {
    throw new Error('map entity ids must be non-empty and unique')
  }

  const points = [
    map.playerSpawn,
    ...map.coreSpawns.map(({ position }) => position),
    ...map.relays.map(({ position }) => position),
    map.extraction.position,
  ]

  if (points.some((position) => !isInsideMap(position, map, rules.playerRadius))) {
    throw new Error('map contains an out-of-bounds objective or spawn')
  }

  for (const obstacle of map.obstacles) {
    assertFinitePositive(`${obstacle.id}.width`, obstacle.bounds.width)
    assertFinitePositive(`${obstacle.id}.height`, obstacle.bounds.height)
    if (!isRectangleInsideMap(obstacle.bounds, map)) {
      throw new Error(`obstacle ${obstacle.id} is outside the map`)
    }
  }

  for (const zone of map.damageZones) {
    assertFinitePositive(`${zone.id}.width`, zone.bounds.width)
    assertFinitePositive(`${zone.id}.height`, zone.bounds.height)
    assertFinitePositive(`${zone.id}.damage`, zone.damage)
    if (!isRectangleInsideMap(zone.bounds, map)) {
      throw new Error(`damage zone ${zone.id} is outside the map`)
    }
  }

  for (const core of map.coreSpawns) {
    if (
      core.jitter &&
      (!Number.isFinite(core.jitter.x) ||
        !Number.isFinite(core.jitter.y) ||
        core.jitter.x < 0 ||
        core.jitter.y < 0)
    ) {
      throw new Error(`core ${core.id} has invalid jitter`)
    }
  }
}
