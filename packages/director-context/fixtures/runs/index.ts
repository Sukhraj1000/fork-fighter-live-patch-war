import type { GameEventBatch, GameState } from '@fork-fighter/contracts'

import type { TelemetryCycleInput } from '../../src/index.js'

const contractFixtureModule = '../../../contracts/src/index.ts'
const { canonicalMockGameState } = (await import(
  contractFixtureModule
)) as typeof import('@fork-fighter/contracts')

export interface DirectorRunFixture {
  name: string
  expectedTrend: 'too_easy' | 'on_target' | 'too_hard'
  input: TelemetryCycleInput
}

function stateAt(
  elapsedMs: number,
  health: number,
  coresBanked: number,
): GameState {
  const state = structuredClone(canonicalMockGameState)
  state.elapsedMs = elapsedMs
  state.tick = elapsedMs / state.rules.tickMs
  state.player.health = health
  state.player.coresHeld = 0
  state.player.coresBanked = coresBanked
  state.player.deaths = 0
  state.player.score = coresBanked * state.rules.relayBankScore
  state.cores = state.cores.map((core, index) => ({
    ...core,
    position:
      index < coresBanked ? state.extraction.position : core.spawnPosition,
    status: index < coresBanked ? 'banked' : 'available',
  }))
  state.extraction.unlocked =
    coresBanked >= state.extraction.requiredBankedCores
  state.extraction.completed = false
  state.status = 'running'
  return state
}

function eventBatch(
  matchId: string,
  batchIndex: number,
  fromTick: number,
  toTick: number,
  events: GameEventBatch['events'],
): GameEventBatch {
  return {
    matchId,
    batchIndex,
    fromTick,
    toTick,
    events,
  }
}

const tooEasyMatchId = 'fixture-too-easy'
const tooEasyState = stateAt(20_000, 100, 2)
const tooEasyBatch = eventBatch(tooEasyMatchId, 0, 0, tooEasyState.tick, [
  {
    type: 'player_moved',
    tick: 20,
    atMs: 1_000,
    from: { x: 72, y: 96 },
    to: { x: 180, y: 96 },
    mode: 'move',
  },
  {
    type: 'core_collected',
    tick: 40,
    atMs: 2_000,
    coreId: 'safe-a',
    risk: 'safe',
    coresHeld: 1,
  },
  {
    type: 'player_moved',
    tick: 80,
    atMs: 4_000,
    from: { x: 180, y: 96 },
    to: { x: 300, y: 96 },
    mode: 'dash',
  },
  {
    type: 'core_collected',
    tick: 120,
    atMs: 6_000,
    coreId: 'safe-b',
    risk: 'safe',
    coresHeld: 1,
  },
  {
    type: 'player_moved',
    tick: 160,
    atMs: 8_000,
    from: { x: 300, y: 96 },
    to: { x: 440, y: 96 },
    mode: 'move',
  },
  {
    type: 'core_collected',
    tick: 200,
    atMs: 10_000,
    coreId: 'safe-c',
    risk: 'safe',
    coresHeld: 1,
  },
  {
    type: 'player_moved',
    tick: 260,
    atMs: 13_000,
    from: { x: 440, y: 96 },
    to: { x: 580, y: 96 },
    mode: 'dash',
  },
  {
    type: 'core_collected',
    tick: 320,
    atMs: 16_000,
    coreId: 'risky-a',
    risk: 'risky',
    coresHeld: 1,
  },
])

const onTargetMatchId = 'fixture-on-target'
const onTargetState = stateAt(40_000, 72, 1)
const onTargetBatch = eventBatch(
  onTargetMatchId,
  1,
  400,
  onTargetState.tick,
  [
    {
      type: 'player_moved',
      tick: 440,
      atMs: 22_000,
      from: { x: 72, y: 96 },
      to: { x: 220, y: 96 },
      mode: 'move',
    },
    {
      type: 'core_collected',
      tick: 480,
      atMs: 24_000,
      coreId: 'safe-a',
      risk: 'safe',
      coresHeld: 1,
    },
    {
      type: 'player_moved',
      tick: 560,
      atMs: 28_000,
      from: { x: 220, y: 96 },
      to: { x: 220, y: 250 },
      mode: 'move',
    },
    {
      type: 'player_damaged',
      tick: 600,
      atMs: 30_000,
      sourceId: 'hazard-east',
      amount: 28,
      health: 72,
    },
    {
      type: 'player_moved',
      tick: 680,
      atMs: 34_000,
      from: { x: 220, y: 250 },
      to: { x: 480, y: 250 },
      mode: 'dash',
    },
    {
      type: 'core_collected',
      tick: 720,
      atMs: 36_000,
      coreId: 'risky-a',
      risk: 'risky',
      coresHeld: 1,
    },
    {
      type: 'player_moved',
      tick: 760,
      atMs: 38_000,
      from: { x: 480, y: 250 },
      to: { x: 480, y: 430 },
      mode: 'move',
    },
  ],
)

const tooHardMatchId = 'fixture-too-hard'
const tooHardState = stateAt(60_000, 30, 0)
tooHardState.player.deaths = 2
const tooHardBatch = eventBatch(
  tooHardMatchId,
  2,
  800,
  tooHardState.tick,
  [
    {
      type: 'player_damaged',
      tick: 900,
      atMs: 45_000,
      sourceId: 'hazard-west',
      amount: 65,
      health: 35,
    },
    {
      type: 'player_died',
      tick: 920,
      atMs: 46_000,
      sourceId: 'hazard-west',
      deaths: 1,
      respawnPosition: { x: 72, y: 96 },
    },
    {
      type: 'player_damaged',
      tick: 960,
      atMs: 48_000,
      sourceId: 'hazard-east',
      amount: 70,
      health: 30,
    },
    {
      type: 'player_died',
      tick: 980,
      atMs: 49_000,
      sourceId: 'hazard-east',
      deaths: 2,
      respawnPosition: { x: 72, y: 96 },
    },
    {
      type: 'player_damaged',
      tick: 1_100,
      atMs: 55_000,
      sourceId: 'hazard-west',
      amount: 70,
      health: 30,
    },
  ],
)

export const tooEasyRunFixture: DirectorRunFixture = {
  name: 'dominant repetitive run',
  expectedTrend: 'too_easy',
  input: {
    matchId: tooEasyMatchId,
    patchIndex: 0,
    state: tooEasyState,
    batches: [tooEasyBatch],
  },
}

export const onTargetRunFixture: DirectorRunFixture = {
  name: 'healthy challenged run',
  expectedTrend: 'on_target',
  input: {
    matchId: onTargetMatchId,
    patchIndex: 1,
    state: onTargetState,
    batches: [onTargetBatch],
  },
}

export const tooHardRunFixture: DirectorRunFixture = {
  name: 'weak high-damage run',
  expectedTrend: 'too_hard',
  input: {
    matchId: tooHardMatchId,
    patchIndex: 2,
    state: tooHardState,
    batches: [tooHardBatch],
  },
}

export const directorRunFixtures: readonly DirectorRunFixture[] = [
  tooEasyRunFixture,
  onTargetRunFixture,
  tooHardRunFixture,
]
