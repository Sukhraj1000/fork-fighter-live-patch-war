import type {
  ConfigureRunnerEffect,
  GameMasterPersona,
  RunnerHazardKind,
  RunnerHazardLane,
  SpawnRunnerHazardEffect,
} from '@fork-fighter/contracts'
import type { PatchViewModel } from './view-models'

export type ObstacleKind = RunnerHazardKind

export type ObstaclePatch = {
  type: 'spawn_obstacle'
  obstacle: ObstacleKind
  lane: RunnerHazardLane
  speedMultiplier: number
  author: GameMasterPersona
  title: string
  sourceMutationId: string
}

export type RunnerHazardWave = {
  trigger: 'onActivation' | 'onInterval'
  everyMs?: number
  effect: SpawnRunnerHazardEffect
}

export type RunnerMutationPatch = {
  id: string
  title: string
  author: GameMasterPersona
  durationMs: number
  configuration?: ConfigureRunnerEffect
  waves: RunnerHazardWave[]
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

function fallbackPatch(patch: PatchViewModel): RunnerMutationPatch {
  const obstacleByAuthor: Record<GameMasterPersona, ObstacleKind> = {
    architect: 'moving_wall',
    gremlin: 'rolling_boulder',
    auditor: 'spike_row',
  }
  return {
    id: patch.id,
    title: patch.title,
    author: patch.author,
    durationMs: Math.max(1_500, patch.durationSeconds * 1_000),
    waves: [
      {
        trigger: 'onActivation',
        effect: {
          type: 'spawnRunnerHazard',
          hazard: obstacleByAuthor[patch.author],
          lane: patch.author === 'architect' ? 'air' : 'ground',
          count: 1,
          spacingMs: 500,
          speedMultiplier: 1,
          telegraphMs: 700,
          tag: `fallback:${patch.id}`,
        },
      },
    ],
  }
}

/** Converts the selected typed mutation into the fixed runner execution vocabulary. */
export function runnerMutationPatchFromView(
  patch: PatchViewModel,
): RunnerMutationPatch {
  if (!patch.mutation) return fallbackPatch(patch)

  let configuration: ConfigureRunnerEffect | undefined
  const waves: RunnerHazardWave[] = []
  for (const trigger of patch.mutation.triggers) {
    if (trigger.type !== 'onActivation' && trigger.type !== 'onInterval') continue
    for (const effect of trigger.effects) {
      if (effect.type === 'configureRunner' && trigger.type === 'onActivation') {
        configuration ??= effect
      }
      if (effect.type === 'spawnRunnerHazard') {
        waves.push({
          trigger: trigger.type,
          ...(trigger.type === 'onInterval' ? { everyMs: trigger.everyMs } : {}),
          effect,
        })
      }
    }
  }

  return {
    id: patch.mutation.id,
    title: patch.mutation.title,
    author: patch.mutation.author,
    durationMs: patch.mutation.durationMs,
    ...(configuration ? { configuration } : {}),
    waves,
  }
}

export function obstaclePatchFromWave(
  patch: RunnerMutationPatch,
  effect: SpawnRunnerHazardEffect,
): ObstaclePatch {
  return {
    type: 'spawn_obstacle',
    obstacle: effect.hazard,
    lane: effect.lane,
    speedMultiplier: effect.speedMultiplier,
    author: patch.author,
    title: patch.title,
    sourceMutationId: patch.id,
  }
}
