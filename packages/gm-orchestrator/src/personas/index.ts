import type {
  GameMasterPersona,
  GameMasterRequest,
} from '@fork-fighter/contracts'

import { ARCHITECT_PERSONA } from './architect.js'
import { AUDITOR_PERSONA } from './auditor.js'
import { GREMLIN_PERSONA } from './gremlin.js'
import type {
  GameMasterPersonaDefinition,
  PersonaPrompt,
  PersonaRecord,
} from './types.js'

export { ARCHITECT_PERSONA } from './architect.js'
export { AUDITOR_PERSONA } from './auditor.js'
export { GREMLIN_PERSONA } from './gremlin.js'
export type {
  GameMasterPersonaDefinition,
  PersonaPrompt,
  PersonaRecord,
  PersonaStrategy,
} from './types.js'

export const GAME_MASTER_PERSONAS = [
  'architect',
  'gremlin',
  'auditor',
] as const satisfies readonly GameMasterPersona[]

export const PERSONA_DEFINITIONS: PersonaRecord<GameMasterPersonaDefinition> = {
  architect: ARCHITECT_PERSONA,
  gremlin: GREMLIN_PERSONA,
  auditor: AUDITOR_PERSONA,
}

export function buildPersonaPrompt(request: GameMasterRequest): PersonaPrompt {
  const persona = PERSONA_DEFINITIONS[request.persona]

  return {
    system: persona.systemPrompt,
    request,
  }
}
