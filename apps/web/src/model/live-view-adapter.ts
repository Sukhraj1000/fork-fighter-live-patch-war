import type { GameMasterPersona } from '@fork-fighter/contracts'
import type { LiveMatchPayload } from './live-match'
import type {
  ActivityItem,
  GameStateViewModel,
  PatchStatus,
  PlayerMotion,
} from './view-models'

const PERSONAS = ['architect', 'gremlin', 'auditor'] as const
const PERSONA_NAMES: Record<GameMasterPersona, string> = {
  architect: 'ARCHITECT',
  gremlin: 'GREMLIN',
  auditor: 'AUDITOR',
}
const PERSONA_ACCENTS: Record<GameMasterPersona, string> = {
  architect: '#58a6ff',
  gremlin: '#f45aa5',
  auditor: '#5ee7b7',
}

function stageY(worldY: number): number {
  return Math.round(356 + (worldY - 96) * 0.58)
}

function playerMotion(live: LiveMatchPayload): PlayerMotion {
  const latest = live.recentEvents.at(-1)
  if (latest?.type === 'player_damaged' || latest?.type === 'player_died') return 'hit'
  if (live.lastCommand.type === 'dash') return 'dash'
  if (live.lastCommand.type === 'move') {
    return live.lastCommand.direction.y < 0 ? 'jump' : 'run'
  }
  return 'idle'
}

function facing(live: LiveMatchPayload): 'left' | 'right' {
  return live.lastCommand.type !== 'wait' && live.lastCommand.direction.x < 0
    ? 'left'
    : 'right'
}

export function adaptLiveMatch(
  live: LiveMatchPayload,
  activity: ActivityItem[],
  now = Date.now(),
): GameStateViewModel {
  const game = live.game
  const runtimeMutation = live.runtime.activeMutation?.definition
  const hostedActive = live.match.activePatches[0]
  const pending = live.match.pendingPatch
  const outcome = live.match.recentOutcomes.at(-1)
  const proposal = hostedActive?.proposal ?? pending?.proposal
  const author =
    runtimeMutation?.author ?? proposal?.author ?? outcome?.author ?? 'architect'
  const mutation = runtimeMutation ?? proposal?.mutation

  let patchStatus: PatchStatus = 'drafting'
  let countdownSeconds: number | undefined
  if (runtimeMutation) {
    patchStatus = 'active'
  } else if (pending) {
    patchStatus = 'incoming'
    countdownSeconds = Math.max(0, Math.ceil((pending.activatesAtMs - now) / 1_000))
  } else if (outcome) {
    patchStatus = 'expired'
  }

  const fixture = game.extraction.completed
    ? 'extract'
    : pending
      ? 'patch'
      : 'run'
  const runSeconds = Math.floor(game.elapsedMs / 1_000)

  return {
    fixture,
    runId: live.matchId.slice(-8).toUpperCase(),
    sector: game.map.id.replaceAll('-', ' ').toUpperCase(),
    elapsedSeconds: runSeconds,
    totalSeconds: 90,
    health: game.player.health,
    score: game.player.score,
    coresHeld: game.player.coresHeld,
    coresBanked: game.player.coresBanked,
    coresRequired: game.extraction.requiredBankedCores,
    dashReady: game.player.dashCooldownRemainingMs === 0,
    player: {
      id: 'player',
      x: game.player.position.x,
      y: stageY(game.player.position.y),
      motion: playerMotion(live),
      facing: facing(live),
    },
    cores: game.cores
      .filter(({ status }) => status === 'available')
      .map((core) => ({
        id: core.id,
        x: core.position.x,
        y: stageY(core.position.y) - 56,
      })),
    hazards: [
      ...game.map.damageZones.map((zone) => ({
        id: zone.id,
        x: zone.bounds.x + zone.bounds.width / 2,
        y: stageY(zone.bounds.y),
      })),
      ...live.runtime.entities.map((entity) => ({
        id: entity.id,
        x: entity.position.x,
        y: stageY(entity.position.y),
      })),
    ],
    relay: {
      id: game.map.relays[0]?.id ?? 'relay',
      x: game.map.relays[0]?.position.x ?? 760,
      y: stageY(game.map.relays[0]?.position.y ?? 96) - 28,
    },
    extraction: {
      id: game.extraction.id,
      x: game.extraction.position.x,
      y: stageY(game.extraction.position.y) - 28,
      ready: game.extraction.unlocked,
    },
    platforms: [
      { id: 'p-1', x: 0, y: 408, width: 370, kind: 'ground' },
      { id: 'p-2', x: 408, y: 372, width: 154, kind: 'bounce' },
      { id: 'p-3', x: 592, y: 310, width: 116, kind: 'crumble' },
      { id: 'p-4', x: 735, y: 408, width: 225, kind: 'ground' },
    ],
    directors: PERSONAS.map((persona) => {
      const agent = live.match.agents.find((candidate) => candidate.persona === persona)
      return {
        id: persona,
        name: PERSONA_NAMES[persona],
        status: (agent?.status ?? 'idle') as PatchStatus,
        message: agent?.message ?? 'Standing by for compact telemetry.',
        accent: PERSONA_ACCENTS[persona],
      }
    }),
    activePatch: {
      id: mutation?.id ?? outcome?.mutationId ?? 'drafting-cycle',
      title: mutation?.title ?? (outcome ? 'PATCH EXPIRED' : 'MASTERS DRAFTING'),
      note:
        mutation?.patchNote ??
        (outcome
          ? 'Cleanup complete. The stable game shell kept running.'
          : 'Three game masters are preparing typed proposals in parallel.'),
      author,
      status: patchStatus,
      durationSeconds: Math.ceil((mutation?.durationMs ?? 0) / 1_000),
      ...(countdownSeconds === undefined ? {} : { countdownSeconds }),
      difficulty: mutation?.difficultyCost ?? 0,
      ...(mutation ? { mutation } : {}),
    },
    activity,
  }
}
