import type {
  ChallengeTrend,
  GameEvent,
  GameEventBatch,
  GameState,
  PatchOutcome,
  RunTelemetry,
} from '@fork-fighter/contracts'

export const PATCH_CYCLE_MS = 20_000
export const TARGET_RUN_DURATION_MS = 120_000
export const MAX_RETAINED_PATCH_OUTCOMES = 6
export const MAX_ACTIVE_MUTATION_IDS = 16
export const DEFAULT_ROUTE_BUCKET_SIZE = 96

export interface DifficultySignals {
  elapsedMs: number
  health: number
  maxHealth: number
  primaryObjectiveProgress: number
  recentDamage: number
  recentDeaths: number
}

export interface TelemetryCycleInput {
  matchId: string
  patchIndex: number
  state: GameState
  batches: readonly GameEventBatch[]
  previousTelemetry?: RunTelemetry
  patchOutcomes?: readonly PatchOutcome[]
  startingActiveMutationIds?: readonly string[]
  routeBucketSize?: number
}

interface OrderedEvent {
  batchIndex: number
  eventIndex: number
  event: GameEvent
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function roundUnit(value: number): number {
  return Number(clampUnit(value).toFixed(6))
}

function orderedEvents(
  matchId: string,
  batches: readonly GameEventBatch[],
): OrderedEvent[] {
  const seenBatchIndexes = new Set<number>()

  for (const batch of batches) {
    if (batch.matchId !== matchId) {
      throw new Error(
        `event batch ${batch.batchIndex} belongs to ${batch.matchId}, not ${matchId}`,
      )
    }
    if (seenBatchIndexes.has(batch.batchIndex)) {
      throw new Error(`duplicate event batch index ${batch.batchIndex}`)
    }
    seenBatchIndexes.add(batch.batchIndex)
  }

  return batches
    .flatMap((batch) =>
      batch.events.map((event, eventIndex) => ({
        batchIndex: batch.batchIndex,
        eventIndex,
        event,
      })),
    )
    .sort(
      (left, right) =>
        left.event.atMs - right.event.atMs ||
        left.event.tick - right.event.tick ||
        left.batchIndex - right.batchIndex ||
        left.eventIndex - right.eventIndex,
    )
}

function movementRouteKey(
  event: Extract<GameEvent, { type: 'player_moved' }>,
  bucketSize: number,
): string | undefined {
  const dx = event.to.x - event.from.x
  const dy = event.to.y - event.from.y
  if (dx === 0 && dy === 0) {
    return undefined
  }

  const middleX = (event.from.x + event.to.x) / 2
  const middleY = (event.from.y + event.to.y) / 2
  if (Math.abs(dx) >= Math.abs(dy) * 2) {
    return `horizontal:${Math.round(middleY / bucketSize)}`
  }
  if (Math.abs(dy) >= Math.abs(dx) * 2) {
    return `vertical:${Math.round(middleX / bucketSize)}`
  }

  const diagonalDirection = Math.sign(dx * dy) || 1
  const diagonalOffset = middleY - diagonalDirection * middleX
  return `diagonal:${diagonalDirection}:${Math.round(diagonalOffset / bucketSize)}`
}

export function measureRouteRepetition(
  events: readonly GameEvent[],
  bucketSize = DEFAULT_ROUTE_BUCKET_SIZE,
): number {
  if (!Number.isFinite(bucketSize) || bucketSize <= 0) {
    throw new Error('route bucket size must be a positive finite number')
  }

  const routeCounts = new Map<string, number>()
  let movementCount = 0

  for (const event of events) {
    if (event.type !== 'player_moved') {
      continue
    }
    const key = movementRouteKey(event, bucketSize)
    if (key === undefined) {
      continue
    }
    movementCount += 1
    routeCounts.set(key, (routeCounts.get(key) ?? 0) + 1)
  }

  if (movementCount <= 1) {
    return 0
  }

  const dominantRouteUses = Math.max(...routeCounts.values())
  return roundUnit((dominantRouteUses - 1) / (movementCount - 1))
}

export function classifyDifficulty(
  signals: DifficultySignals,
): ChallengeTrend {
  const safeMaxHealth = Math.max(1, signals.maxHealth)
  const healthRatio = clampUnit(signals.health / safeMaxHealth)
  const damageRatio = clampUnit(signals.recentDamage / safeMaxHealth)
  const expectedProgress = clampUnit(
    signals.elapsedMs / TARGET_RUN_DURATION_MS,
  )
  const progressPace =
    expectedProgress === 0
      ? 0
      : signals.primaryObjectiveProgress / expectedProgress

  const severeFailure =
    signals.recentDeaths >= 2 || healthRatio <= 0.3 || damageRatio >= 0.6
  const failedUnderPressure =
    signals.recentDeaths >= 1 &&
    (healthRatio <= 0.5 || damageRatio >= 0.35 || progressPace < 0.75)
  const stalledRun =
    signals.elapsedMs >= PATCH_CYCLE_MS * 2 && progressPace < 0.45

  if (severeFailure || failedUnderPressure || stalledRun) {
    return 'too_hard'
  }

  const dominantRun =
    signals.elapsedMs >= PATCH_CYCLE_MS &&
    signals.recentDeaths === 0 &&
    healthRatio >= 0.7 &&
    damageRatio <= 0.15 &&
    progressPace >= 1.25

  return dominantRun ? 'too_easy' : 'on_target'
}

function recentPatchOutcomes(
  previous: readonly PatchOutcome[],
  current: readonly PatchOutcome[],
): PatchOutcome[] {
  const byPatch = new Map<string, PatchOutcome>()
  for (const outcome of [...previous, ...current]) {
    byPatch.set(`${outcome.patchIndex}:${outcome.mutationId}`, outcome)
  }

  return [...byPatch.values()]
    .sort(
      (left, right) =>
        left.endedAtMs - right.endedAtMs ||
        left.patchIndex - right.patchIndex ||
        left.mutationId.localeCompare(right.mutationId),
    )
    .slice(-MAX_RETAINED_PATCH_OUTCOMES)
}

export function aggregateRunTelemetry(
  input: TelemetryCycleInput,
): RunTelemetry {
  if (!Number.isInteger(input.patchIndex) || input.patchIndex < 0) {
    throw new Error('patch index must be a non-negative integer')
  }
  if (
    input.previousTelemetry !== undefined &&
    input.previousTelemetry.matchId !== input.matchId
  ) {
    throw new Error('previous telemetry belongs to a different match')
  }

  const entries = orderedEvents(input.matchId, input.batches)
  if (entries.some(({ event }) => event.atMs > input.state.elapsedMs)) {
    throw new Error('event batch contains an event from the future')
  }
  const events = entries.map(({ event }) => event)
  const activeMutationIds = new Set(
    input.startingActiveMutationIds ??
      input.previousTelemetry?.activeMutationIds ??
      [],
  )
  let recentDamage = 0
  let recentDeaths = 0
  let lowRiskCores = 0
  let highRiskCores = 0

  for (const event of events) {
    switch (event.type) {
      case 'player_damaged':
        recentDamage = Math.min(100_000, recentDamage + event.amount)
        break
      case 'player_died':
        recentDeaths += 1
        break
      case 'core_collected':
        if (event.risk === 'safe') {
          lowRiskCores += 1
        } else {
          highRiskCores += 1
        }
        break
      case 'patch_activated':
        activeMutationIds.add(event.mutationId)
        break
      case 'patch_expired':
        activeMutationIds.delete(event.mutationId)
        break
    }
  }

  const totalCollectedCores = lowRiskCores + highRiskCores
  if (activeMutationIds.size > MAX_ACTIVE_MUTATION_IDS) {
    throw new Error(
      `active mutations exceed compact telemetry limit ${MAX_ACTIVE_MUTATION_IDS}`,
    )
  }
  const primaryObjectiveProgress = input.state.extraction.completed
    ? 1
    : roundUnit(
        input.state.player.coresBanked /
          input.state.extraction.requiredBankedCores,
      )
  const challengeTrend = classifyDifficulty({
    elapsedMs: input.state.elapsedMs,
    health: input.state.player.health,
    maxHealth: input.state.player.maxHealth,
    primaryObjectiveProgress,
    recentDamage,
    recentDeaths,
  })

  return {
    matchId: input.matchId,
    patchIndex: input.patchIndex,
    elapsedMs: input.state.elapsedMs,
    health: input.state.player.health,
    coresHeld: input.state.player.coresHeld,
    coresBanked: input.state.player.coresBanked,
    primaryObjectiveProgress,
    recentDamage,
    recentDeaths,
    routeRepetition: measureRouteRepetition(
      events,
      input.routeBucketSize,
    ),
    lowRiskCoreRate:
      totalCollectedCores === 0
        ? 0
        : roundUnit(lowRiskCores / totalCollectedCores),
    highRiskCoreRate:
      totalCollectedCores === 0
        ? 0
        : roundUnit(highRiskCores / totalCollectedCores),
    activeMutationIds: [...activeMutationIds].sort(),
    recentPatchOutcomes: recentPatchOutcomes(
      input.previousTelemetry?.recentPatchOutcomes ?? [],
      input.patchOutcomes ?? [],
    ),
    challengeTrend,
  }
}
