import type { GameMasterPersona } from '@fork-fighter/contracts'
import type { PatchViewModel } from './view-models'

export type ObstacleKind = 'rolling_boulder' | 'spike_row' | 'moving_wall'

/** The only mutation shape the live runner is allowed to execute. */
export type ObstaclePatch = {
  type: 'spawn_obstacle'
  obstacle: ObstacleKind
  lane: 'ground' | 'air'
  delayMs: number
  durationMs: number
  author: GameMasterPersona
  title: string
  sourceMutationId: string
}

export type EndlessRunStats = {
  alive: boolean
  elapsedMs: number
  pickups: number
  timeScore: number
  pickupScore: number
  score: number
}

export type EndlessRunResult = EndlessRunStats & {
  killer: {
    author: GameMasterPersona
    title: string
  }
}

export type EndlessRunCallbacks = {
  onStats: (stats: EndlessRunStats) => void
  onGameOver: (result: EndlessRunResult) => void
}

export function obstaclePatchFromView(patch: PatchViewModel): ObstaclePatch {
  const obstacleByAuthor: Record<GameMasterPersona, ObstacleKind> = {
    architect: 'moving_wall',
    gremlin: 'rolling_boulder',
    auditor: 'spike_row',
  }

  return {
    type: 'spawn_obstacle',
    obstacle: obstacleByAuthor[patch.author],
    lane: patch.author === 'architect' ? 'air' : 'ground',
    delayMs: 350,
    durationMs: Math.max(1_500, patch.durationSeconds * 1_000),
    author: patch.author,
    title: patch.title,
    sourceMutationId: patch.id,
  }
}
