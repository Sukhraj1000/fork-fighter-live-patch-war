import type {
  GameEvent,
  GameMapDefinition,
  GameRules,
  GameState,
} from '@fork-fighter/contracts'

export type {
  CoreSpawnDefinition,
  CoreState,
  CoreStatus,
  DamageZoneDefinition,
  DashCommand,
  ExtractionDefinition,
  ExtractionState,
  GameConfig,
  GameEvent,
  GameMapDefinition,
  GameRules,
  GameState,
  GameStatus,
  MoveCommand,
  ObstacleDefinition,
  PlayerCommand,
  PlayerState,
  Rectangle,
  RelayDefinition,
  Vector2,
  WaitCommand,
} from '@fork-fighter/contracts'

export type GameTransition = {
  state: GameState
  events: GameEvent[]
}

export type GameReplay = GameTransition & {
  commandsProcessed: number
}

export type CreateGameOptions = {
  seed: number | string
  map?: GameMapDefinition
  rules?: Partial<GameRules>
}
