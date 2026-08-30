import type {
  GameEvent,
  GameMasterPersona,
  GameState,
  MutationDefinition,
  PatchOutcome,
  PlayerCommand,
  RunTelemetry,
} from '@fork-fighter/contracts'

export type AgentActivityStatus =
  | 'idle'
  | 'drafting'
  | 'proposed'
  | 'rejected'
  | 'selected'
  | 'failed'

export interface AgentActivitySnapshot {
  persona: GameMasterPersona
  status: AgentActivityStatus
  proposalId?: string
  message?: string
  updatedAtMs: number
}

export interface PatchProposalSnapshot {
  proposalId: string
  author: GameMasterPersona
  mutation: MutationDefinition
}

export interface MatchSnapshot {
  matchId: string
  status: 'running' | 'ended'
  createdAtMs: number
  patchIndex: number
  nextPatchAtMs?: number
  context: { telemetry: RunTelemetry }
  agents: AgentActivitySnapshot[]
  pendingPatch?: {
    patchIndex: number
    proposal: PatchProposalSnapshot
    activatesAtMs: number
  }
  activePatches: Array<{
    patchIndex: number
    proposal: PatchProposalSnapshot
    activatedAtMs: number
    expiresAtMs: number
  }>
  recentOutcomes: PatchOutcome[]
}

export interface LiveMatchPayload {
  matchId: string
  game: GameState
  runtime: {
    activeMutation: null | {
      definition: MutationDefinition
      activatedAtMs: number
      expiresAtMs: number
    }
    entities: Array<{
      id: string
      position: { x: number; y: number }
    }>
  }
  match: MatchSnapshot
  recentEvents: GameEvent[]
  lastCommand: PlayerCommand
}

export interface MatchStreamEvent {
  id: number
  type: string
  data: unknown
}
