import type {
  DamageZoneDefinition,
  GameMapDefinition,
  GameState,
  MutationDefinition,
  Rectangle,
  ValidationReason,
  Vector2,
} from '@fork-fighter/contracts'

import { mutationEffectEntries } from './mechanics.js'
import type { ValidatorPolicy } from './types.js'

type ProjectedHazard = Readonly<{
  id: string
  bounds: Rectangle
}>

function reason(
  code: string,
  message: string,
  path: Array<string | number>,
): ValidationReason {
  return { code, message, path }
}

function squaredDistance(first: Vector2, second: Vector2): number {
  const x = first.x - second.x
  const y = first.y - second.y
  return x * x + y * y
}

function centre(bounds: Rectangle): Vector2 {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  }
}

function circleIntersectsRectangle(
  position: Vector2,
  radius: number,
  rectangle: Rectangle,
): boolean {
  const nearestX = Math.max(
    rectangle.x,
    Math.min(position.x, rectangle.x + rectangle.width),
  )
  const nearestY = Math.max(
    rectangle.y,
    Math.min(position.y, rectangle.y + rectangle.height),
  )
  const x = position.x - nearestX
  const y = position.y - nearestY
  return x * x + y * y <= radius * radius
}

function pointIsWalkable(
  point: Vector2,
  map: GameMapDefinition,
  radius: number,
  extraBlockers: readonly Rectangle[],
): boolean {
  if (
    point.x < radius ||
    point.x > map.width - radius ||
    point.y < radius ||
    point.y > map.height - radius
  ) {
    return false
  }
  return ![...map.obstacles.map(({ bounds }) => bounds), ...extraBlockers].some(
    (bounds) => circleIntersectsRectangle(point, radius, bounds),
  )
}

function primaryRouteTarget(state: GameState): Vector2 {
  if (state.player.coresHeld > 0) {
    const relay = [...state.map.relays].sort(
      (first, second) =>
        squaredDistance(state.player.position, first.position) -
          squaredDistance(state.player.position, second.position) ||
        first.id.localeCompare(second.id),
    )[0]
    if (relay) return relay.position
  }

  const core = state.cores
    .filter(({ status }) => status === 'available')
    .sort(
      (first, second) =>
        squaredDistance(state.player.position, first.position) -
          squaredDistance(state.player.position, second.position) ||
        first.id.localeCompare(second.id),
    )[0]
  return core?.position ?? state.extraction.position
}

function moveTowards(
  from: Vector2,
  destination: Vector2,
  maximumDistance: number,
): Vector2 {
  const x = destination.x - from.x
  const y = destination.y - from.y
  const distance = Math.hypot(x, y)
  if (distance === 0 || distance <= maximumDistance) return { ...destination }
  return {
    x: from.x + (x / distance) * maximumDistance,
    y: from.y + (y / distance) * maximumDistance,
  }
}

function clampHazardCentre(
  position: Vector2,
  bounds: Rectangle,
  map: GameMapDefinition,
): Vector2 {
  return {
    x: Math.max(
      bounds.width / 2,
      Math.min(map.width - bounds.width / 2, position.x),
    ),
    y: Math.max(
      bounds.height / 2,
      Math.min(map.height - bounds.height / 2, position.y),
    ),
  }
}

function projectRelocatedHazards(
  mutation: MutationDefinition,
  state: GameState,
): { hazards: readonly ProjectedHazard[]; reasons: readonly ValidationReason[] } {
  const hazards: DamageZoneDefinition[] = state.map.damageZones.map((zone) => ({
    ...zone,
    bounds: { ...zone.bounds },
  }))
  const relocated: ProjectedHazard[] = []
  const reasons: ValidationReason[] = []

  for (const { effect, effectIndex, triggerIndex } of mutationEffectEntries(mutation)) {
    if (effect.type !== 'relocateHazard') continue
    if (hazards.length === 0) {
      reasons.push(
        reason(
          'hazard-unavailable',
          'The mutation requires a hazard that is not present in this match.',
          ['mutation', 'triggers', triggerIndex, 'effects', effectIndex],
        ),
      )
      continue
    }

    const hazard = [...hazards].sort((first, second) => {
      if (effect.hazard === 'leastActive') return first.id.localeCompare(second.id)
      return (
        squaredDistance(state.player.position, centre(first.bounds)) -
          squaredDistance(state.player.position, centre(second.bounds)) ||
        first.id.localeCompare(second.id)
      )
    })[0]
    if (!hazard) continue

    const target = primaryRouteTarget(state)
    const routeFraction = effect.destination === 'mostUsedRoute' ? 0.5 : 0.35
    const desired = {
      x: state.player.position.x +
        (target.x - state.player.position.x) * routeFraction,
      y: state.player.position.y +
        (target.y - state.player.position.y) * routeFraction,
    }
    const destination = clampHazardCentre(
      moveTowards(centre(hazard.bounds), desired, effect.maxDistance),
      hazard.bounds,
      state.map,
    )
    hazard.bounds = {
      ...hazard.bounds,
      x: destination.x - hazard.bounds.width / 2,
      y: destination.y - hazard.bounds.height / 2,
    }
    relocated.push({ id: hazard.id, bounds: { ...hazard.bounds } })
  }

  return { hazards: relocated, reasons }
}

type Reachability = Readonly<{
  reaches(position: Vector2): boolean
}>

function buildReachability(
  source: Vector2,
  state: GameState,
  blockers: readonly Rectangle[],
  policy: ValidatorPolicy,
): Reachability {
  const radius = state.player.radius
  const usableWidth = state.map.width - radius * 2
  const usableHeight = state.map.height - radius * 2
  if (usableWidth <= 0 || usableHeight <= 0) return { reaches: () => false }

  let cellSize = Math.max(4, policy.reachabilityCellSize)
  let columns = Math.max(2, Math.ceil(usableWidth / cellSize) + 1)
  let rows = Math.max(2, Math.ceil(usableHeight / cellSize) + 1)
  const maximumCells = Math.max(100, policy.maxReachabilityCells)
  if (columns * rows > maximumCells) {
    cellSize *= Math.sqrt((columns * rows) / maximumCells)
    columns = Math.max(2, Math.ceil(usableWidth / cellSize) + 1)
    rows = Math.max(2, Math.ceil(usableHeight / cellSize) + 1)
  }

  const xStep = usableWidth / (columns - 1)
  const yStep = usableHeight / (rows - 1)
  const indexFor = (column: number, row: number): number => row * columns + column
  const positionFor = (column: number, row: number): Vector2 => ({
    x: radius + column * xStep,
    y: radius + row * yStep,
  })
  const coordinateFor = (position: Vector2): [number, number] => [
    Math.max(0, Math.min(columns - 1, Math.round((position.x - radius) / xStep))),
    Math.max(0, Math.min(rows - 1, Math.round((position.y - radius) / yStep))),
  ]
  const walkable = new Uint8Array(columns * rows)
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      walkable[indexFor(column, row)] = pointIsWalkable(
        positionFor(column, row),
        state.map,
        radius,
        blockers,
      )
        ? 1
        : 0
    }
  }

  const [sourceColumn, sourceRow] = coordinateFor(source)
  const sourceIndex = indexFor(sourceColumn, sourceRow)
  const visited = new Uint8Array(columns * rows)
  if (walkable[sourceIndex] === 1) {
    visited[sourceIndex] = 1
    const queue: number[] = [sourceIndex]
    let cursor = 0
    const directions = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const
    while (cursor < queue.length) {
      const current = queue[cursor++]!
      const row = Math.floor(current / columns)
      const column = current - row * columns
      for (const [columnDelta, rowDelta] of directions) {
        const nextColumn = column + columnDelta
        const nextRow = row + rowDelta
        if (
          nextColumn < 0 ||
          nextColumn >= columns ||
          nextRow < 0 ||
          nextRow >= rows
        ) {
          continue
        }
        const next = indexFor(nextColumn, nextRow)
        if (walkable[next] === 1 && visited[next] === 0) {
          visited[next] = 1
          queue.push(next)
        }
      }
    }
  }

  return {
    reaches(position: Vector2): boolean {
      if (!pointIsWalkable(position, state.map, radius, blockers)) return false
      const [column, row] = coordinateFor(position)
      return visited[indexFor(column, row)] === 1
    },
  }
}

function criticalHazardCollision(
  hazard: ProjectedHazard,
  state: GameState,
  policy: ValidatorPolicy,
): boolean {
  const clearance = policy.safeSpawnClearance
  const criticalPoints = [
    {
      position: state.player.position,
      radius: state.player.radius + clearance,
    },
    {
      position: state.player.spawnPosition,
      radius: state.player.radius + clearance,
    },
    ...state.cores
      .filter(({ status }) => status !== 'banked')
      .map(({ position }) => ({
        position,
        radius: state.rules.coreRadius + state.player.radius,
      })),
    ...state.map.relays.map(({ position, radius }) => ({ position, radius })),
    {
      position: state.extraction.position,
      radius: state.extraction.radius,
    },
  ]
  return criticalPoints.some(({ position, radius }) =>
    circleIntersectsRectangle(position, radius, hazard.bounds),
  )
}

function spawnPointIsSafe(
  position: Vector2,
  state: GameState,
  blockers: readonly Rectangle[],
  policy: ValidatorPolicy,
): boolean {
  return pointIsWalkable(
    position,
    state.map,
    state.player.radius + policy.safeSpawnClearance,
    blockers,
  )
}

function farthestSafeCorner(
  state: GameState,
  blockers: readonly Rectangle[],
  policy: ValidatorPolicy,
): Vector2 | null {
  const margin = state.player.radius + policy.safeSpawnClearance
  return (
    [
      { x: margin, y: margin },
      { x: state.map.width - margin, y: margin },
      { x: margin, y: state.map.height - margin },
      { x: state.map.width - margin, y: state.map.height - margin },
    ]
      .sort(
        (first, second) =>
          squaredDistance(state.player.position, second) -
            squaredDistance(state.player.position, first) ||
          first.x - second.x ||
          first.y - second.y,
      )
      .find((point) => spawnPointIsSafe(point, state, blockers, policy)) ?? null
  )
}

function bonusSpawnPoint(
  awayFromRoute: boolean,
  state: GameState,
  blockers: readonly Rectangle[],
  policy: ValidatorPolicy,
): Vector2 | null {
  if (awayFromRoute) return farthestSafeCorner(state, blockers, policy)
  const target = primaryRouteTarget(state)
  const desired = {
    x: state.player.position.x + (target.x - state.player.position.x) * 0.65,
    y: state.player.position.y + (target.y - state.player.position.y) * 0.65,
  }
  if (spawnPointIsSafe(desired, state, blockers, policy)) return desired

  const step = Math.max(policy.safeSpawnClearance, policy.reachabilityCellSize)
  for (let ring = 1; ring <= 6; ring += 1) {
    const candidates = [
      { x: desired.x + ring * step, y: desired.y },
      { x: desired.x - ring * step, y: desired.y },
      { x: desired.x, y: desired.y + ring * step },
      { x: desired.x, y: desired.y - ring * step },
    ]
    const safe = candidates.find((point) =>
      spawnPointIsSafe(point, state, blockers, policy),
    )
    if (safe) return safe
  }
  return null
}

export function evaluateMutationInvariants(
  mutation: MutationDefinition,
  state: GameState,
  policy: ValidatorPolicy,
): readonly ValidationReason[] {
  const reasons: ValidationReason[] = []
  const projection = projectRelocatedHazards(mutation, state)
  reasons.push(...projection.reasons)
  const blockers = projection.hazards.map(({ bounds }) => bounds)

  for (const hazard of projection.hazards) {
    if (criticalHazardCollision(hazard, state, policy)) {
      reasons.push(
        reason(
          'unsafe-hazard',
          'A relocated hazard would overlap a spawn or required objective.',
          ['mutation', 'triggers'],
        ),
      )
      break
    }
  }

  const currentReachability = buildReachability(
    state.player.position,
    state,
    blockers,
    policy,
  )
  const respawnReachability = buildReachability(
    state.player.spawnPosition,
    state,
    blockers,
    policy,
  )
  if (
    !currentReachability.reaches(state.extraction.position) ||
    !respawnReachability.reaches(state.extraction.position)
  ) {
    reasons.push(
      reason(
        'extraction-unreachable',
        'The mutation would make extraction unreachable.',
        ['mutation', 'triggers'],
      ),
    )
  }

  const reachableRelay = state.map.relays.some(
    ({ position }) =>
      currentReachability.reaches(position) &&
      respawnReachability.reaches(position),
  )
  if (!reachableRelay) {
    reasons.push(
      reason(
        'relay-unreachable',
        'The mutation would make every relay unreachable.',
        ['mutation', 'triggers'],
      ),
    )
  }

  const extraRequired = mutationEffectEntries(mutation).reduce(
    (total, { effect }) =>
      total +
      (effect.type === 'adjustExtractionRequirement'
        ? effect.additionalBankedCores
        : 0),
    0,
  )
  const effectiveRequirement =
    state.extraction.requiredBankedCores + extraRequired
  if (effectiveRequirement > state.cores.length) {
    reasons.push(
      reason(
        'primary-objective-impossible',
        'The mutation would require more banked cores than the match contains.',
        ['mutation', 'triggers'],
      ),
    )
  } else {
    const reachableAvailable = state.cores.filter(
      ({ position, status }) =>
        status === 'available' &&
        currentReachability.reaches(position) &&
        respawnReachability.reaches(position),
    ).length
    const obtainable =
      state.player.coresBanked + state.player.coresHeld + reachableAvailable
    if (obtainable < effectiveRequirement) {
      reasons.push(
        reason(
          'primary-objective-unreachable',
          'Too few reachable cores would remain for the primary objective.',
          ['mutation', 'triggers'],
        ),
      )
    }
  }

  if (mutation.objective?.type === 'bankAdditionalCores') {
    const unbanked = state.cores.length - state.player.coresBanked
    if (unbanked < mutation.objective.count) {
      reasons.push(
        reason(
          'secondary-objective-impossible',
          'The secondary objective cannot be completed in the current match.',
          ['mutation', 'objective'],
        ),
      )
    }
  } else if (mutation.objective?.type === 'collectRiskyCores') {
    const riskyAvailable = state.cores.filter(
      ({ risk, status }) => risk === 'risky' && status === 'available',
    ).length
    if (riskyAvailable < mutation.objective.count) {
      reasons.push(
        reason(
          'secondary-objective-impossible',
          'The secondary objective cannot be completed in the current match.',
          ['mutation', 'objective'],
        ),
      )
    }
  } else if (
    mutation.objective?.type === 'survive' &&
    mutation.objective.durationMs > mutation.durationMs
  ) {
    reasons.push(
      reason(
        'secondary-objective-impossible',
        'The secondary objective outlasts the mutation.',
        ['mutation', 'objective', 'durationMs'],
      ),
    )
  }

  for (const { effect, effectIndex, triggerIndex } of mutationEffectEntries(mutation)) {
    const path = ['mutation', 'triggers', triggerIndex, 'effects', effectIndex]
    if (effect.type === 'spawnCollector') {
      if (effect.contactDamage >= state.player.health) {
        reasons.push(
          reason(
            'unsafe-spawn',
            'A collector could defeat the player immediately when it spawns.',
            path,
          ),
        )
      }
      const points =
        effect.spawnAt === 'collectedCore'
          ? state.cores
              .filter(({ status }) => status === 'available')
              .map(({ position }) => position)
          : [farthestSafeCorner(state, blockers, policy)].filter(
              (point): point is Vector2 => point !== null,
            )
      if (
        points.length === 0 ||
        points.some((point) => !spawnPointIsSafe(point, state, blockers, policy))
      ) {
        reasons.push(
          reason(
            'unsafe-spawn',
            'The mutation cannot place a collector at a safe deterministic spawn.',
            path,
          ),
        )
      }
    }
    if (effect.type === 'spawnBonusCore') {
      const point = bonusSpawnPoint(
        effect.spawnAt === 'awayFromMostUsedRoute',
        state,
        blockers,
        policy,
      )
      if (!point) {
        reasons.push(
          reason(
            'unsafe-spawn',
            'The mutation cannot place its bonus core at a safe spawn.',
            path,
          ),
        )
      }
    }
  }

  return reasons.slice(0, 16)
}
