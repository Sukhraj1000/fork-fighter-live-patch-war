import type { PlayerCommand as CorePlayerCommand } from '@fork-fighter/contracts'

export type PatchStatus =
  | 'idle'
  | 'drafting'
  | 'proposed'
  | 'rejected'
  | 'validated'
  | 'selected'
  | 'incoming'
  | 'active'
  | 'expired'
  | 'failed'

export type FixtureMode = 'run' | 'patch' | 'extract'

export type PlayerCommand = CorePlayerCommand

export type RunnerEntity = {
  id: string
  x: number
  y: number
}

export type PlayerMotion = 'idle' | 'run' | 'jump' | 'dash' | 'hit'

export type PlayerViewModel = RunnerEntity & {
  motion: PlayerMotion
  facing: 'left' | 'right'
}

export type RunnerPlatform = RunnerEntity & {
  width: number
  kind: 'ground' | 'bounce' | 'crumble'
}

export type DirectorViewModel = {
  id: 'architect' | 'gremlin' | 'auditor'
  name: string
  status: PatchStatus
  message: string
  accent: string
}

export type ActivityItem = {
  id: string
  at: string
  author: DirectorViewModel['id'] | 'system'
  status: PatchStatus
  title: string
  detail: string
}

export type PatchViewModel = {
  id: string
  title: string
  note: string
  author: DirectorViewModel['id']
  status: PatchStatus
  durationSeconds: number
  countdownSeconds?: number
  difficulty: number
}

/**
 * Presentation facade for the frozen GameState contract tracked in issue #2.
 * Replace the fixture adapter when that package lands; renderers consume only
 * this shape and contain no scoring, collision, or mutation decisions.
 */
export type GameStateViewModel = {
  fixture: FixtureMode
  runId: string
  sector: string
  elapsedSeconds: number
  totalSeconds: number
  health: number
  score: number
  coresHeld: number
  coresBanked: number
  coresRequired: number
  dashReady: boolean
  player: PlayerViewModel
  cores: RunnerEntity[]
  hazards: RunnerEntity[]
  relay: RunnerEntity
  extraction: RunnerEntity & { ready: boolean }
  platforms: RunnerPlatform[]
  directors: DirectorViewModel[]
  activePatch: PatchViewModel
  activity: ActivityItem[]
}
