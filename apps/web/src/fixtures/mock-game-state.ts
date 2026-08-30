import { canonicalMockGameState } from '@fork-fighter/contracts'
import type { FixtureMode, GameStateViewModel } from '../model/view-models'

const contractState = canonicalMockGameState
const stageX = (worldX: number) => Math.round(58 + (worldX / contractState.map.width) * 844)

const base: Omit<GameStateViewModel, 'fixture' | 'extraction' | 'activePatch'> = {
  runId: `FF-${String(contractState.seed).padStart(3, '0')}`,
  sector: 'SUNSET CIRCUIT',
  elapsedSeconds: Math.floor(contractState.elapsedMs / 1000) + 67,
  totalSeconds: 90,
  health: contractState.player.health - 16,
  score: contractState.player.score + 12_380,
  coresHeld: contractState.player.coresHeld + 1,
  coresBanked: contractState.player.coresBanked + 2,
  coresRequired: contractState.extraction.requiredBankedCores + 2,
  dashReady: contractState.player.dashCooldownRemainingMs === 0,
  player: {
    id: 'player',
    x: stageX(contractState.player.position.x) - 88,
    y: 356,
    motion: 'run',
    facing: 'right',
  },
  cores: contractState.cores
    .filter((core) => core.status !== 'banked')
    .map((core, index) => ({
      id: core.id,
      x: stageX(core.position.x),
      y: index % 2 === 0 ? 300 : 235,
    })),
  hazards: contractState.map.damageZones.map((zone) => ({
    id: zone.id,
    x: stageX(zone.bounds.x + zone.bounds.width / 2),
    y: 371,
  })),
  relay: {
    id: contractState.map.relays[0].id,
    x: stageX(contractState.map.relays[0].position.x) - 470,
    y: 328,
  },
  platforms: [
    { id: 'p-1', x: 0, y: 408, width: 370, kind: 'ground' },
    { id: 'p-2', x: 408, y: 372, width: 154, kind: 'bounce' },
    { id: 'p-3', x: 592, y: 310, width: 116, kind: 'crumble' },
    { id: 'p-4', x: 735, y: 408, width: 225, kind: 'ground' },
  ],
  directors: [
    {
      id: 'architect',
      name: 'ARCHITECT',
      status: 'validated',
      message: 'Built a safer high route',
      accent: '#58a6ff',
    },
    {
      id: 'gremlin',
      name: 'GREMLIN',
      status: 'selected',
      message: 'Found your favourite lane!',
      accent: '#f45aa5',
    },
    {
      id: 'auditor',
      name: 'AUDITOR',
      status: 'rejected',
      message: 'Blocked an unfair spike',
      accent: '#5ee7b7',
    },
  ],
  activity: [
    {
      id: 'a-1',
      at: '01:02',
      author: 'architect',
      status: 'validated',
      title: 'SKY BRIDGE',
      detail: 'Route check passed',
    },
    {
      id: 'a-2',
      at: '01:04',
      author: 'auditor',
      status: 'rejected',
      title: 'TURBO TUNNEL',
      detail: 'Too close to landing zone',
    },
    {
      id: 'a-3',
      at: '01:06',
      author: 'gremlin',
      status: 'selected',
      title: 'BUBBLE TROUBLE',
      detail: 'Best challenge fit',
    },
    {
      id: 'a-4',
      at: '01:08',
      author: 'system',
      status: 'incoming',
      title: 'PATCH READY',
      detail: '7/7 safety gates passed',
    },
  ],
}

export const MOCK_RUNS: Record<FixtureMode, GameStateViewModel> = {
  run: {
    ...base,
    fixture: 'run',
    extraction: { id: contractState.extraction.id, x: stageX(contractState.extraction.position.x), y: 328, ready: false },
    activePatch: {
      id: 'patch-03',
      title: 'SPRING PARADE',
      note: 'Bounce pads pop up on the high route.',
      author: 'architect',
      status: 'active',
      durationSeconds: 18,
      difficulty: 1.6,
    },
  },
  patch: {
    ...base,
    fixture: 'patch',
    elapsedSeconds: 72,
    score: 13840,
    player: { id: 'player', x: 346, y: 356, motion: 'dash', facing: 'right' },
    extraction: { id: contractState.extraction.id, x: stageX(contractState.extraction.position.x), y: 328, ready: false },
    activePatch: {
      id: 'patch-04',
      title: 'BUBBLE TROUBLE',
      note: 'Repeat lanes grow bouncy. A bonus core appears up high!',
      author: 'gremlin',
      status: 'incoming',
      durationSeconds: 20,
      countdownSeconds: 8,
      difficulty: 2.4,
    },
  },
  extract: {
    ...base,
    fixture: 'extract',
    elapsedSeconds: 83,
    health: 66,
    score: 17620,
    coresHeld: 0,
    coresBanked: 5,
    player: { id: 'player', x: 742, y: 326, motion: 'jump', facing: 'right' },
    extraction: { id: contractState.extraction.id, x: stageX(contractState.extraction.position.x), y: 328, ready: true },
    activePatch: {
      id: 'patch-03',
      title: 'SPRING PARADE',
      note: 'Bounce pads pop up on the high route.',
      author: 'architect',
      status: 'expired',
      durationSeconds: 18,
      difficulty: 1.6,
    },
  },
}
