import type {
  GameMasterPersona,
  GameMasterRequest,
} from '@fork-fighter/contracts'

export interface PersonaStrategy {
  readonly intent: string
  readonly telemetrySignals: readonly string[]
  readonly preferredMechanics: readonly string[]
}

export interface GameMasterPersonaDefinition {
  readonly id: GameMasterPersona
  readonly displayName: string
  readonly systemPrompt: string
  readonly strategy: PersonaStrategy
}

export interface PersonaPrompt {
  readonly system: string
  readonly request: GameMasterRequest
}

export type PersonaRecord<Value> = {
  readonly [Persona in GameMasterPersona]: Value
}
