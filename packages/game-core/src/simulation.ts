import {
  assertValidMap,
  cloneMap,
  DEFAULT_GAME_RULES,
  DETERMINISTIC_MAP_FIXTURE,
} from './map.js'
import { normaliseSeed, randomInteger } from './random.js'
import type {
  CoreState,
  CreateGameOptions,
  GameEvent,
  GameMapDefinition,
  GameReplay,
  GameRules,
  GameState,
  GameTransition,
  PlayerCommand,
  Rectangle,
  Vector2,
} from './types.js'

const POSITION_PRECISION = 1_000_000
const MAX_MOVEMENT_SUBSTEP = 4

function quantise(value: number): number {
  return Math.round(value * POSITION_PRECISION) / POSITION_PRECISION
}

function clonePosition(position: Vector2): Vector2 {
  return { x: position.x, y: position.y }
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    rules: { ...state.rules },
    map: cloneMap(state.map),
    player: {
      ...state.player,
      position: clonePosition(state.player.position),
      spawnPosition: clonePosition(state.player.spawnPosition),
    },
    cores: state.cores.map((core) => ({
      ...core,
      position: clonePosition(core.position),
      spawnPosition: clonePosition(core.spawnPosition),
    })),
    extraction: {
      ...state.extraction,
      position: clonePosition(state.extraction.position),
    },
  }
}

function mergeRules(overrides: Partial<GameRules> | undefined): GameRules {
  const rules = { ...DEFAULT_GAME_RULES, ...overrides }
  const positiveRules: Array<keyof GameRules> = [
    'tickMs',
    'moveSpeed',
    'playerRadius',
    'dashDistance',
    'maxHealth',
    'requiredBankedCores',
    'coreRadius',
  ]
  const nonNegativeIntegerRules: Array<keyof GameRules> = [
    'dashCooldownMs',
    'damageCooldownMs',
    'relayBankScore',
    'extractionScore',
  ]

  for (const name of positiveRules) {
    if (!Number.isFinite(rules[name]) || rules[name] <= 0) {
      throw new Error(`${name} must be a finite positive number`)
    }
  }

  for (const name of nonNegativeIntegerRules) {
    if (!Number.isInteger(rules[name]) || rules[name] < 0) {
      throw new Error(`${name} must be a non-negative integer`)
    }
  }

  if (
    !Number.isInteger(rules.tickMs) ||
    !Number.isInteger(rules.maxHealth) ||
    !Number.isInteger(rules.requiredBankedCores)
  ) {
    throw new Error('tickMs, maxHealth, and requiredBankedCores must be integers')
  }

  return rules
}

function seedCores(
  map: GameMapDefinition,
  initialRngState: number,
): { cores: CoreState[]; rngState: number } {
  let rngState = initialRngState
  const cores = map.coreSpawns.map((spawn) => {
    const jitter = spawn.jitter ?? { x: 0, y: 0 }
    let xOffset = 0
    let yOffset = 0

    if (jitter.x > 0) {
      const next = randomInteger(rngState, -Math.floor(jitter.x), Math.floor(jitter.x))
      rngState = next.state
      xOffset = next.value
    }

    if (jitter.y > 0) {
      const next = randomInteger(rngState, -Math.floor(jitter.y), Math.floor(jitter.y))
      rngState = next.state
      yOffset = next.value
    }

    const position = {
      x: spawn.position.x + xOffset,
      y: spawn.position.y + yOffset,
    }

    return {
      id: spawn.id,
      spawnPosition: clonePosition(position),
      position: clonePosition(position),
      status: 'available' as const,
      risk: spawn.risk,
    }
  })

  return { cores, rngState }
}

export function createInitialState(options: CreateGameOptions): GameState {
  const rules = mergeRules(options.rules)
  const map = cloneMap(options.map ?? DETERMINISTIC_MAP_FIXTURE)
  assertValidMap(map, rules)

  const seed = normaliseSeed(options.seed)
  const seededCores = seedCores(map, seed)
  const state: GameState = {
    version: 1,
    seed,
    rngState: seededCores.rngState,
    tick: 0,
    elapsedMs: 0,
    status: 'running',
    rules,
    map,
    player: {
      position: clonePosition(map.playerSpawn),
      spawnPosition: clonePosition(map.playerSpawn),
      health: rules.maxHealth,
      maxHealth: rules.maxHealth,
      radius: rules.playerRadius,
      coresHeld: 0,
      coresBanked: 0,
      score: 0,
      deaths: 0,
      dashCooldownRemainingMs: 0,
      damageCooldownRemainingMs: 0,
    },
    cores: seededCores.cores,
    extraction: {
      ...map.extraction,
      position: clonePosition(map.extraction.position),
      requiredBankedCores: rules.requiredBankedCores,
      unlocked: false,
      completed: false,
    },
  }

  assertGameStateInvariants(state)
  return state
}

export function startGame(options: CreateGameOptions): GameTransition {
  const state = createInitialState(options)

  return {
    state,
    events: [
      {
        type: 'game_started',
        tick: state.tick,
        atMs: state.elapsedMs,
        seed: state.seed,
        mapId: state.map.id,
      },
    ],
  }
}

function eventEnvelope(state: GameState): { tick: number; atMs: number } {
  return { tick: state.tick, atMs: state.elapsedMs }
}

function normaliseDirection(direction: Vector2): Vector2 | null {
  if (!Number.isFinite(direction.x) || !Number.isFinite(direction.y)) return null
  const length = Math.hypot(direction.x, direction.y)
  if (length === 0) return null

  return {
    x: direction.x / length,
    y: direction.y / length,
  }
}

function circleIntersectsRectangle(
  position: Vector2,
  radius: number,
  rectangle: Rectangle,
): boolean {
  const nearestX = Math.max(rectangle.x, Math.min(position.x, rectangle.x + rectangle.width))
  const nearestY = Math.max(rectangle.y, Math.min(position.y, rectangle.y + rectangle.height))
  const deltaX = position.x - nearestX
  const deltaY = position.y - nearestY

  return deltaX * deltaX + deltaY * deltaY < radius * radius
}

function assertCoreRespawnsAreCollectible(state: GameState): void {
  for (const core of state.cores) {
    const collectionRadius = state.player.radius + state.rules.coreRadius
    const isInsideBounds =
      core.spawnPosition.x >= collectionRadius &&
      core.spawnPosition.x <= state.map.width - collectionRadius &&
      core.spawnPosition.y >= collectionRadius &&
      core.spawnPosition.y <= state.map.height - collectionRadius
    const overlapsObstacle = state.map.obstacles.some((obstacle) =>
      circleIntersectsRectangle(core.spawnPosition, collectionRadius, obstacle.bounds),
    )

    if (!isInsideBounds || overlapsObstacle) {
      throw new Error(`seeded core ${core.id} is not safely collectible`)
    }
  }
}

function circlesIntersect(
  firstPosition: Vector2,
  firstRadius: number,
  secondPosition: Vector2,
  secondRadius: number,
): boolean {
  const deltaX = firstPosition.x - secondPosition.x
  const deltaY = firstPosition.y - secondPosition.y
  const radius = firstRadius + secondRadius

  return deltaX * deltaX + deltaY * deltaY <= radius * radius
}

function collidingObstacleIds(state: GameState, position: Vector2): string[] {
  return state.map.obstacles
    .filter((obstacle) =>
      circleIntersectsRectangle(position, state.player.radius, obstacle.bounds),
    )
    .map(({ id }) => id)
    .sort()
}

function moveOneSubstep(
  state: GameState,
  delta: Vector2,
  blockedIds: Set<string>,
): void {
  const radius = state.player.radius
  const maximumX = state.map.width - radius
  const maximumY = state.map.height - radius

  const candidateX = {
    x: quantise(Math.max(radius, Math.min(maximumX, state.player.position.x + delta.x))),
    y: state.player.position.y,
  }
  const xCollisions = collidingObstacleIds(state, candidateX)
  if (xCollisions.length === 0) {
    state.player.position.x = candidateX.x
  } else {
    xCollisions.forEach((id) => blockedIds.add(id))
  }

  const candidateY = {
    x: state.player.position.x,
    y: quantise(Math.max(radius, Math.min(maximumY, state.player.position.y + delta.y))),
  }
  const yCollisions = collidingObstacleIds(state, candidateY)
  if (yCollisions.length === 0) {
    state.player.position.y = candidateY.y
  } else {
    yCollisions.forEach((id) => blockedIds.add(id))
  }
}

function damagePlayer(
  state: GameState,
  sourceId: string,
  amount: number,
  events: GameEvent[],
): boolean {
  if (state.player.damageCooldownRemainingMs > 0) return false

  const appliedDamage = Math.min(state.player.health, Math.max(1, Math.round(amount)))
  state.player.health -= appliedDamage
  state.player.damageCooldownRemainingMs = state.rules.damageCooldownMs
  events.push({
    type: 'player_damaged',
    ...eventEnvelope(state),
    sourceId,
    amount: appliedDamage,
    health: state.player.health,
  })

  if (state.player.health > 0) return false

  const respawnedCoreIds = state.cores
    .filter(({ status }) => status === 'carried')
    .map(({ id }) => id)
    .sort()

  for (const core of state.cores) {
    if (core.status === 'carried') {
      core.status = 'available'
      core.position = clonePosition(core.spawnPosition)
    }
  }

  state.player.coresHeld = 0
  state.player.deaths += 1
  state.player.health = state.player.maxHealth
  state.player.position = clonePosition(state.player.spawnPosition)
  state.player.damageCooldownRemainingMs = state.rules.damageCooldownMs

  events.push({
    type: 'player_died',
    ...eventEnvelope(state),
    sourceId,
    deaths: state.player.deaths,
    respawnPosition: clonePosition(state.player.spawnPosition),
  })

  if (respawnedCoreIds.length > 0) {
    events.push({
      type: 'cores_respawned',
      ...eventEnvelope(state),
      coreIds: respawnedCoreIds,
    })
  }

  return true
}

type InteractionResult = 'continue' | 'player_died' | 'completed'

function resolveInteractions(state: GameState, events: GameEvent[]): InteractionResult {
  for (const zone of state.map.damageZones) {
    if (
      circleIntersectsRectangle(state.player.position, state.player.radius, zone.bounds) &&
      damagePlayer(state, zone.id, zone.damage, events)
    ) {
      return 'player_died'
    }
  }

  for (const core of state.cores) {
    if (
      core.status === 'available' &&
      circlesIntersect(
        state.player.position,
        state.player.radius,
        core.position,
        state.rules.coreRadius,
      )
    ) {
      core.status = 'carried'
      core.position = clonePosition(state.player.position)
      state.player.coresHeld += 1
      events.push({
        type: 'core_collected',
        ...eventEnvelope(state),
        coreId: core.id,
        risk: core.risk,
        coresHeld: state.player.coresHeld,
      })
    }
  }

  const relay = state.map.relays.find((candidate) =>
    circlesIntersect(
      state.player.position,
      state.player.radius,
      candidate.position,
      candidate.radius,
    ),
  )

  if (relay && state.player.coresHeld > 0) {
    const coreIds = state.cores
      .filter(({ status }) => status === 'carried')
      .map(({ id }) => id)
      .sort()

    for (const core of state.cores) {
      if (core.status === 'carried') core.status = 'banked'
    }

    const scoreAwarded = coreIds.length * state.rules.relayBankScore
    state.player.coresHeld = 0
    state.player.coresBanked += coreIds.length
    state.player.score += scoreAwarded
    events.push({
      type: 'cores_banked',
      ...eventEnvelope(state),
      relayId: relay.id,
      coreIds,
      coresBanked: state.player.coresBanked,
      scoreAwarded,
    })
  }

  if (
    !state.extraction.unlocked &&
    state.player.coresBanked >= state.extraction.requiredBankedCores
  ) {
    state.extraction.unlocked = true
    events.push({
      type: 'extraction_unlocked',
      ...eventEnvelope(state),
      requiredBankedCores: state.extraction.requiredBankedCores,
    })
  }

  if (
    state.extraction.unlocked &&
    circlesIntersect(
      state.player.position,
      state.player.radius,
      state.extraction.position,
      state.extraction.radius,
    )
  ) {
    state.extraction.completed = true
    state.status = 'completed'
    state.player.score += state.rules.extractionScore
    events.push({
      type: 'extraction_completed',
      ...eventEnvelope(state),
      finalScore: state.player.score,
    })
    return 'completed'
  }

  return 'continue'
}

function resolveMovement(
  state: GameState,
  direction: Vector2,
  distance: number,
  mode: 'move' | 'dash',
  events: GameEvent[],
): void {
  const from = clonePosition(state.player.position)
  const substeps = Math.max(1, Math.ceil(distance / MAX_MOVEMENT_SUBSTEP))
  const delta = {
    x: (direction.x * distance) / substeps,
    y: (direction.y * distance) / substeps,
  }
  const blockedIds = new Set<string>()
  let movementDestination = clonePosition(from)

  for (let substep = 0; substep < substeps; substep += 1) {
    moveOneSubstep(state, delta, blockedIds)
    movementDestination = clonePosition(state.player.position)
    if (resolveInteractions(state, events) !== 'continue') break
  }

  if (movementDestination.x !== from.x || movementDestination.y !== from.y) {
    events.unshift({
      type: 'player_moved',
      ...eventEnvelope(state),
      from,
      to: movementDestination,
      mode,
    })
  }

  if (blockedIds.size > 0) {
    events.push({
      type: 'movement_blocked',
      ...eventEnvelope(state),
      obstacleIds: [...blockedIds].sort(),
      mode,
    })
  }
}

export function stepGame(inputState: GameState, command: PlayerCommand): GameTransition {
  assertGameStateInvariants(inputState)
  if (inputState.status !== 'running') return { state: cloneState(inputState), events: [] }

  const state = cloneState(inputState)
  state.tick += 1
  state.elapsedMs += state.rules.tickMs
  state.player.dashCooldownRemainingMs = Math.max(
    0,
    state.player.dashCooldownRemainingMs - state.rules.tickMs,
  )
  state.player.damageCooldownRemainingMs = Math.max(
    0,
    state.player.damageCooldownRemainingMs - state.rules.tickMs,
  )

  const events: GameEvent[] = []
  if (command.type === 'wait') {
    resolveInteractions(state, events)
  } else {
    const direction = normaliseDirection(command.direction)

    if (command.type === 'dash') {
      if (!direction) {
        events.push({
          type: 'dash_rejected',
          ...eventEnvelope(state),
          reason: 'zero_direction',
          remainingMs: state.player.dashCooldownRemainingMs,
        })
        resolveInteractions(state, events)
      } else if (state.player.dashCooldownRemainingMs > 0) {
        events.push({
          type: 'dash_rejected',
          ...eventEnvelope(state),
          reason: 'cooldown',
          remainingMs: state.player.dashCooldownRemainingMs,
        })
        resolveInteractions(state, events)
      } else {
        state.player.dashCooldownRemainingMs = state.rules.dashCooldownMs
        resolveMovement(state, direction, state.rules.dashDistance, 'dash', events)
      }
    } else if (direction) {
      const distance = (state.rules.moveSpeed * state.rules.tickMs) / 1_000
      resolveMovement(state, direction, distance, 'move', events)
    } else {
      resolveInteractions(state, events)
    }
  }

  assertGameStateInvariants(state)
  return { state, events }
}

export function replayGame(
  options: CreateGameOptions,
  commands: readonly PlayerCommand[],
): GameReplay {
  const started = startGame(options)
  let state = started.state
  const events = [...started.events]

  for (const command of commands) {
    const transition = stepGame(state, command)
    state = transition.state
    events.push(...transition.events)
  }

  return { state, events, commandsProcessed: commands.length }
}

export function assertGameStateInvariants(state: GameState): void {
  assertValidMap(state.map, state.rules)

  if (state.player.health <= 0 || state.player.health > state.player.maxHealth) {
    throw new Error('player health is outside its valid range')
  }

  const held = state.cores.filter(({ status }) => status === 'carried').length
  const banked = state.cores.filter(({ status }) => status === 'banked').length
  if (held !== state.player.coresHeld || banked !== state.player.coresBanked) {
    throw new Error('player core counters do not match canonical core states')
  }

  if (state.cores.length < state.extraction.requiredBankedCores) {
    throw new Error('primary objective no longer has enough cores')
  }

  if (state.extraction.unlocked !== (banked >= state.extraction.requiredBankedCores)) {
    throw new Error('extraction lock state does not match banked core progress')
  }

  if (state.extraction.completed !== (state.status === 'completed')) {
    throw new Error('completion state is inconsistent')
  }

  const coreIds = state.cores.map(({ id }) => id)
  if (new Set(coreIds).size !== coreIds.length) {
    throw new Error('core ids must remain unique')
  }

  for (const core of state.cores) {
    if (core.status === 'available') {
      const collectionRadius = state.player.radius + state.rules.coreRadius
      if (
        !Number.isFinite(core.position.x + core.position.y) ||
        core.position.x < collectionRadius ||
        core.position.x > state.map.width - collectionRadius ||
        core.position.y < collectionRadius ||
        core.position.y > state.map.height - collectionRadius
      ) {
        throw new Error(`available core ${core.id} has an invalid position`)
      }
    }
  }

  assertCoreRespawnsAreCollectible(state)
}
