import type {
  GameEvent,
  GameState,
  MutationDefinition,
  Vector2,
} from '@fork-fighter/contracts'

export type MutationBoundary = {
  tick: number
  atMs: number
}

export type CollectorEntity = {
  type: 'collector'
  id: string
  mutationId: string
  triggerId: string
  tag: string
  position: Vector2
  speedMultiplier: number
  contactDamage: number
  sourceCoreId: string
  spawnedAtTick: number
  spawnedAtMs: number
}

export type MutationRuntimeEntity = CollectorEntity

export type TriggerActivationCount = {
  triggerId: string
  count: number
}

export type ActiveMutation = {
  definition: MutationDefinition
  activatedAtTick: number
  activatedAtMs: number
  expiresAtMs: number
  triggerActivations: TriggerActivationCount[]
}

export type MutationRuntimeState = {
  activeMutation: ActiveMutation | null
  entities: MutationRuntimeEntity[]
  nextEntitySequence: number
  lastBoundary: MutationBoundary | null
}

export type MutationRuntimeTransition = {
  state: MutationRuntimeState
  events: GameEvent[]
}

export type MutationGameBoundary = {
  state: GameState
  events: readonly GameEvent[]
}

export type MutationRuntimeErrorCode =
  | 'active_mutation_exists'
  | 'boundary_out_of_order'
  | 'effect_context_missing'
  | 'event_boundary_mismatch'
  | 'invalid_boundary'
  | 'unsupported_cleanup'
  | 'unsupported_effect'
  | 'unsupported_trigger'

export class MutationRuntimeError extends Error {
  readonly code: MutationRuntimeErrorCode

  constructor(code: MutationRuntimeErrorCode, message: string) {
    super(message)
    this.name = 'MutationRuntimeError'
    this.code = code
  }
}
