import {
  GameEventSchema,
  GameStateSchema,
  MutationDefinitionSchema,
  type GameEvent,
  type GameState,
  type MutationDefinition,
  type OnCoreCollectedTrigger,
  type SpawnCollectorEffect,
  type Vector2,
} from '@fork-fighter/contracts'

import {
  MutationRuntimeError,
  type ActiveMutation,
  type CollectorEntity,
  type MutationBoundary,
  type MutationGameBoundary,
  type MutationRuntimeState,
  type MutationRuntimeTransition,
} from './types.js'

function cloneRuntimeState(state: MutationRuntimeState): MutationRuntimeState {
  return structuredClone(state)
}

function assertBoundary(boundary: MutationBoundary): void {
  if (
    !Number.isSafeInteger(boundary.tick) ||
    boundary.tick < 0 ||
    !Number.isSafeInteger(boundary.atMs) ||
    boundary.atMs < 0
  ) {
    throw new MutationRuntimeError(
      'invalid_boundary',
      'Mutation boundaries require non-negative safe-integer tick and atMs values',
    )
  }
}

function assertOrderedBoundary(
  previous: MutationBoundary | null,
  next: MutationBoundary,
): void {
  if (
    previous &&
    (next.tick < previous.tick || next.atMs < previous.atMs)
  ) {
    throw new MutationRuntimeError(
      'boundary_out_of_order',
      `Mutation boundary ${next.tick}@${next.atMs} precedes ${previous.tick}@${previous.atMs}`,
    )
  }
}

function assertSupportedDefinition(mutation: MutationDefinition): void {
  for (const trigger of mutation.triggers) {
    if (trigger.type !== 'onCoreCollected') {
      throw new MutationRuntimeError(
        'unsupported_trigger',
        `Mutation runtime v1 does not support trigger ${trigger.type}`,
      )
    }

    for (const effect of trigger.effects) {
      if (effect.type !== 'spawnCollector') {
        throw new MutationRuntimeError(
          'unsupported_effect',
          `Mutation runtime v1 does not support effect ${effect.type}`,
        )
      }
    }
  }

  for (const cleanup of mutation.cleanup) {
    if (cleanup.type !== 'removeEntitiesByTag') {
      throw new MutationRuntimeError(
        'unsupported_cleanup',
        `Mutation runtime v1 does not support cleanup ${cleanup.type}`,
      )
    }
  }
}

function activationTotal(active: ActiveMutation): number {
  return active.triggerActivations.reduce(
    (total, activation) => total + activation.count,
    0,
  )
}

function entityCountForMutation(
  state: MutationRuntimeState,
  mutationId: string,
): number {
  return state.entities.filter((entity) => entity.mutationId === mutationId)
    .length
}

function incrementTriggerActivation(
  active: ActiveMutation,
  triggerId: string,
): void {
  const activation = active.triggerActivations.find(
    (candidate) => candidate.triggerId === triggerId,
  )

  if (!activation) {
    throw new MutationRuntimeError(
      'unsupported_trigger',
      `Trigger ${triggerId} was not registered at activation`,
    )
  }

  activation.count += 1
}

function matchesCoreCollectedTrigger(
  trigger: OnCoreCollectedTrigger,
  event: Extract<GameEvent, { type: 'core_collected' }>,
): boolean {
  return trigger.coreRisk === 'any' || trigger.coreRisk === event.risk
}

function farthestEdgePosition(gameState: GameState): Vector2 {
  const candidates: Vector2[] = [
    { x: 0, y: 0 },
    { x: gameState.map.width, y: 0 },
    { x: 0, y: gameState.map.height },
    { x: gameState.map.width, y: gameState.map.height },
  ]
  let farthest = candidates[0]!
  let farthestDistance = -1

  for (const candidate of candidates) {
    const deltaX = candidate.x - gameState.player.position.x
    const deltaY = candidate.y - gameState.player.position.y
    const distance = deltaX * deltaX + deltaY * deltaY
    if (distance > farthestDistance) {
      farthest = candidate
      farthestDistance = distance
    }
  }

  return { ...farthest }
}

function collectorSpawnPosition(
  effect: SpawnCollectorEffect,
  event: Extract<GameEvent, { type: 'core_collected' }>,
  gameState: GameState,
): Vector2 {
  if (effect.spawnAt === 'farthestEdge') {
    return farthestEdgePosition(gameState)
  }

  const core = gameState.cores.find((candidate) => candidate.id === event.coreId)
  if (!core) {
    throw new MutationRuntimeError(
      'effect_context_missing',
      `Collected core ${event.coreId} is absent from the game state`,
    )
  }

  return { ...core.position }
}

function spawnCollectors(
  state: MutationRuntimeState,
  active: ActiveMutation,
  trigger: OnCoreCollectedTrigger,
  effect: SpawnCollectorEffect,
  event: Extract<GameEvent, { type: 'core_collected' }>,
  gameState: GameState,
): string[] {
  const affectedIds: string[] = []
  const position = collectorSpawnPosition(effect, event, gameState)

  for (let index = 0; index < effect.count; index += 1) {
    const id = `collector:${String(state.nextEntitySequence).padStart(6, '0')}`
    const collector: CollectorEntity = {
      type: 'collector',
      id,
      mutationId: active.definition.id,
      triggerId: trigger.id,
      tag: effect.tag,
      position: { ...position },
      speedMultiplier: effect.speedMultiplier,
      contactDamage: effect.contactDamage,
      sourceCoreId: event.coreId,
      spawnedAtTick: event.tick,
      spawnedAtMs: event.atMs,
    }

    state.entities.push(collector)
    state.nextEntitySequence += 1
    affectedIds.push(id)
  }

  return affectedIds
}

function dispatchCoreCollected(
  state: MutationRuntimeState,
  event: Extract<GameEvent, { type: 'core_collected' }>,
  gameState: GameState,
): GameEvent[] {
  const active = state.activeMutation
  if (!active) return []

  const lifecycleEvents: GameEvent[] = []
  for (const candidate of active.definition.triggers) {
    if (candidate.type !== 'onCoreCollected') continue
    const trigger = candidate
    if (!matchesCoreCollectedTrigger(trigger, event)) continue
    if (activationTotal(active) >= active.definition.limits.maxTriggerActivations) {
      continue
    }

    const spawnCount = trigger.effects.reduce(
      (total, effect) =>
        effect.type === 'spawnCollector' ? total + effect.count : total,
      0,
    )
    const currentEntityCount = entityCountForMutation(
      state,
      active.definition.id,
    )
    if (
      currentEntityCount + spawnCount >
      active.definition.limits.maxSpawnedEntities
    ) {
      continue
    }

    incrementTriggerActivation(active, trigger.id)
    for (const effect of trigger.effects) {
      if (effect.type !== 'spawnCollector') continue
      const affectedIds = spawnCollectors(
        state,
        active,
        trigger,
        effect,
        event,
        gameState,
      )
      lifecycleEvents.push({
        type: 'patch_effect_applied',
        tick: event.tick,
        atMs: event.atMs,
        mutationId: active.definition.id,
        triggerId: trigger.id,
        effect: effect.type,
        affectedIds,
      })
    }
  }

  return lifecycleEvents
}

function cleanupTags(mutation: MutationDefinition): string[] {
  return [
    ...new Set(
      mutation.cleanup
        .filter((cleanup) => cleanup.type === 'removeEntitiesByTag')
        .map((cleanup) => cleanup.tag),
    ),
  ]
}

export function createMutationRuntimeState(): MutationRuntimeState {
  return {
    activeMutation: null,
    entities: [],
    nextEntitySequence: 1,
    lastBoundary: null,
  }
}

export function activateMutation(
  inputState: MutationRuntimeState,
  candidate: unknown,
  boundary: MutationBoundary,
): MutationRuntimeTransition {
  assertBoundary(boundary)
  assertOrderedBoundary(inputState.lastBoundary, boundary)
  if (inputState.activeMutation) {
    throw new MutationRuntimeError(
      'active_mutation_exists',
      `Mutation ${inputState.activeMutation.definition.id} is already active`,
    )
  }

  const mutation = MutationDefinitionSchema.parse(candidate)
  assertSupportedDefinition(mutation)
  const expiresAtMs = boundary.atMs + mutation.durationMs
  if (!Number.isSafeInteger(expiresAtMs)) {
    throw new MutationRuntimeError(
      'invalid_boundary',
      'Mutation expiry exceeds the safe integer clock range',
    )
  }

  const state = cloneRuntimeState(inputState)
  state.activeMutation = {
    definition: mutation,
    activatedAtTick: boundary.tick,
    activatedAtMs: boundary.atMs,
    expiresAtMs,
    triggerActivations: mutation.triggers.map((trigger) => ({
      triggerId: trigger.id,
      count: 0,
    })),
  }
  state.lastBoundary = { ...boundary }

  return {
    state,
    events: [
      {
        type: 'patch_activated',
        tick: boundary.tick,
        atMs: boundary.atMs,
        mutationId: mutation.id,
        author: mutation.author,
        expiresAtMs,
      },
    ],
  }
}

export function advanceMutationRuntime(
  inputState: MutationRuntimeState,
  boundary: MutationBoundary,
): MutationRuntimeTransition {
  assertBoundary(boundary)
  assertOrderedBoundary(inputState.lastBoundary, boundary)
  const state = cloneRuntimeState(inputState)
  state.lastBoundary = { ...boundary }
  const active = state.activeMutation

  if (!active || boundary.atMs < active.expiresAtMs) {
    return { state, events: [] }
  }

  const tags = cleanupTags(active.definition)
  const tagSet = new Set(tags)
  state.entities = state.entities.filter(
    (entity) => !tagSet.has(entity.tag),
  )
  state.activeMutation = null

  return {
    state,
    events: [
      {
        type: 'patch_expired',
        tick: boundary.tick,
        atMs: boundary.atMs,
        mutationId: active.definition.id,
        cleanedTags: tags,
      },
    ],
  }
}

export function processMutationGameBoundary(
  inputState: MutationRuntimeState,
  boundary: MutationGameBoundary,
): MutationRuntimeTransition {
  const gameState = GameStateSchema.parse(boundary.state)
  const gameEvents = boundary.events.map((event) => GameEventSchema.parse(event))
  const clock = { tick: gameState.tick, atMs: gameState.elapsedMs }

  for (const event of gameEvents) {
    if (event.tick !== clock.tick || event.atMs !== clock.atMs) {
      throw new MutationRuntimeError(
        'event_boundary_mismatch',
        `Game event ${event.type} does not belong to boundary ${clock.tick}@${clock.atMs}`,
      )
    }
  }

  const advanced = advanceMutationRuntime(inputState, clock)
  if (!advanced.state.activeMutation) return advanced

  const state = advanced.state
  const lifecycleEvents = [...advanced.events]
  for (const event of gameEvents) {
    if (event.type === 'core_collected') {
      lifecycleEvents.push(...dispatchCoreCollected(state, event, gameState))
    }
  }

  return { state, events: lifecycleEvents }
}
