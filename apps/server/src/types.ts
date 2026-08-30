import type {
  GameEventBatch,
  GameMasterPersona,
  GameMasterRequest,
  MatchDirectorContext,
  MutationCapabilityReference,
  MutationProposal,
  PatchOutcome,
  ProposalHistoryEntry,
  ProposalResult,
  RunTelemetry,
  ValidationResult,
} from '@fork-fighter/contracts'

export type MatchStatus = 'running' | 'ended'

export type AgentActivityStatus =
  | 'idle'
  | 'drafting'
  | 'proposed'
  | 'rejected'
  | 'selected'
  | 'failed'

export interface AgentActivity {
  persona: GameMasterPersona
  status: AgentActivityStatus
  proposalId?: string
  message?: string
  updatedAtMs: number
}

export interface GameMasterAgent {
  readonly persona: GameMasterPersona
  propose(
    request: GameMasterRequest,
    signal: AbortSignal,
  ): Promise<ProposalResult>
  closeMatch?(matchId: string): Promise<void>
  close?(): Promise<void>
}

export interface ProposalValidator {
  validate(
    proposal: MutationProposal,
    context: MatchDirectorContext,
  ): Promise<ValidationResult> | ValidationResult
}

export interface ValidatedProposal {
  proposal: MutationProposal
  validation: ValidationResult & { valid: true }
}

export interface ProposalSelector {
  select(
    candidates: readonly ValidatedProposal[],
    context: MatchDirectorContext,
  ): Promise<ValidatedProposal | undefined> | ValidatedProposal | undefined
}

export interface MatchClock {
  now(): number
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export interface MatchLogEntry {
  sequence: number
  atMs: number
  matchId: string
  type: MatchLogEventType
  data: unknown
}

export type MatchLogEventType =
  | 'match_created'
  | 'match_ended'
  | 'telemetry_ingested'
  | 'event_batch_ingested'
  | 'patch_cycle_started'
  | 'patch_cycle_skipped'
  | 'agent_status'
  | 'proposal_received'
  | 'proposal_failed'
  | 'proposal_rejected'
  | 'proposal_expired'
  | 'proposal_selected'
  | 'patch_scheduled'
  | 'patch_activated'
  | 'patch_expired'
  | 'patch_outcome'

export interface MatchLogStore {
  append(entry: MatchLogEntry): Promise<void>
  read(matchId: string): Promise<readonly MatchLogEntry[]>
  close?(): Promise<void>
}

export interface PendingPatch {
  patchIndex: number
  proposal: MutationProposal
  activatesAtMs: number
}

export interface ActivePatch {
  patchIndex: number
  proposal: MutationProposal
  activatedAtMs: number
  expiresAtMs: number
}

export interface MatchSnapshot {
  matchId: string
  status: MatchStatus
  createdAtMs: number
  endedAtMs?: number
  patchIndex: number
  nextPatchAtMs?: number
  context: MatchDirectorContext
  agents: AgentActivity[]
  pendingPatch?: PendingPatch
  activePatches: ActivePatch[]
  recentOutcomes: PatchOutcome[]
  lastBatchIndex: number
}

export interface CreateMatchInput {
  matchId?: string
  initialTelemetry?: RunTelemetry
  remainingDifficultyBudget?: number
  autoStart?: boolean
}

export interface TelemetryIngestResult {
  accepted: boolean
  duplicate: boolean
  telemetry: RunTelemetry
}

export interface EventBatchIngestResult {
  accepted: boolean
  duplicate: boolean
  batchIndex: number
  nextBatchIndex: number
}

export interface MatchHostDependencies {
  agents: readonly GameMasterAgent[]
  validator: ProposalValidator
  selector: ProposalSelector
  capabilities: MutationCapabilityReference
  logStore: MatchLogStore
  clock: MatchClock
  idGenerator: () => string
  cadenceMs: number
  proposalDeadlineMs: number
  sseHistorySize: number
  secretValues: readonly string[]
}

export interface MatchReplay {
  matchId: string
  proposals: MatchLogEntry[]
  rejections: MatchLogEntry[]
  selections: MatchLogEntry[]
  activations: MatchLogEntry[]
  expiries: MatchLogEntry[]
  outcomes: MatchLogEntry[]
}

export interface InternalMatchState {
  matchId: string
  status: MatchStatus
  createdAtMs: number
  endedAtMs?: number
  patchIndex: number
  nextPatchAtMs?: number
  context: MatchDirectorContext
  agents: Map<GameMasterPersona, AgentActivity>
  histories: Map<GameMasterPersona, ProposalHistoryEntry[]>
  pendingPatch?: PendingPatch
  activePatches: Map<string, ActivePatch>
  outcomes: PatchOutcome[]
  lastBatchIndex: number
  batchFingerprints: Map<number, string>
  sequence: number
  boundaryTimer?: unknown
  expiryTimers: Map<string, unknown>
  proposalRoundInFlight: boolean
  ended: boolean
  latestEventBatch?: GameEventBatch
  patchMetrics: Map<
    string,
    {
      activatedAtElapsedMs: number
      health: number
      coresBanked: number
      score: number
      triggerActivations: number
      entitiesSpawned: number
      entitiesCleaned: number
    }
  >
}
