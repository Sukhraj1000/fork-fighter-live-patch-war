import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { GameEventSchema, GameStateSchema } from '@fork-fighter/contracts'
import {
  createInitialState,
  DETERMINISTIC_MAP_FIXTURE,
  replayGame,
  stepGame,
  type GameEvent,
  type GameMapDefinition,
  type GameState,
  type PlayerCommand,
} from '../src/index.js'

const RIGHT: PlayerCommand = { type: 'move', direction: { x: 1, y: 0 } }
const WAIT: PlayerCommand = { type: 'wait' }

function repeat(command: PlayerCommand, count: number): PlayerCommand[] {
  return Array.from({ length: count }, () => command)
}

function eventTypes(events: readonly GameEvent[]): string[] {
  return events.map(({ type }) => type)
}

function withPlayerAt(state: GameState, x: number, y: number): GameState {
  return {
    ...state,
    player: {
      ...state.player,
      position: { x, y },
    },
  }
}

describe('deterministic simulation', () => {
  it('produces identical state and events for the same seed and commands', () => {
    const commands: PlayerCommand[] = [
      ...repeat(RIGHT, 12),
      { type: 'dash', direction: { x: 1, y: 0 } },
      ...repeat(WAIT, 12),
      { type: 'dash', direction: { x: 1, y: 0 } },
      ...repeat(RIGHT, 30),
    ]

    const first = replayGame({ seed: 'repeatable-run' }, commands)
    const second = replayGame({ seed: 'repeatable-run' }, commands)

    assert.deepEqual(first, second)
    assert.notDeepEqual(
      createInitialState({ seed: 'repeatable-run' }).cores,
      createInitialState({ seed: 'another-run' }).cores,
    )
  })

  it('emits state and events accepted by the frozen runtime contracts', () => {
    const run = replayGame({ seed: 'contract-run' }, repeat(RIGHT, 90))

    assert.doesNotThrow(() => GameStateSchema.parse(run.state))
    for (const event of run.events) {
      assert.doesNotThrow(() => GameEventSchema.parse(event))
    }
  })

  it('completes the base start, collect, bank, and extract run', () => {
    const run = replayGame({ seed: 'demo-path' }, repeat(RIGHT, 90))
    const types = eventTypes(run.events)

    assert.equal(run.state.status, 'completed')
    assert.equal(run.state.extraction.unlocked, true)
    assert.equal(run.state.extraction.completed, true)
    assert.equal(run.state.player.coresBanked, 3)
    assert.equal(run.state.player.coresHeld, 0)
    assert.equal(run.state.player.score, 800)
    assert.equal(types[0], 'game_started')
    assert.equal(types.filter((type) => type === 'core_collected').length, 3)
    assert.ok(types.indexOf('cores_banked') < types.indexOf('extraction_unlocked'))
    assert.ok(types.indexOf('extraction_unlocked') < types.indexOf('extraction_completed'))
  })

  it('keeps the primary route completable across seeded fixture variants', () => {
    for (let seed = 1; seed <= 64; seed += 1) {
      const run = replayGame({ seed }, repeat(RIGHT, 90))

      assert.equal(run.state.status, 'completed', `seed ${seed} did not complete`)
      assert.equal(run.state.player.coresBanked, 3)
    }
  })

  it('enforces dash cooldown on fixed ticks', () => {
    const initial = createInitialState({ seed: 7 })
    const dashed = stepGame(initial, { type: 'dash', direction: { x: 1, y: 0 } })
    const rejected = stepGame(dashed.state, {
      type: 'dash',
      direction: { x: 1, y: 0 },
    })

    assert.equal(dashed.state.player.position.x, initial.player.position.x + 120)
    assert.equal(dashed.state.player.dashCooldownRemainingMs, 600)
    assert.deepEqual(eventTypes(rejected.events), ['dash_rejected'])
    assert.equal(rejected.state.player.position.x, dashed.state.player.position.x)
    assert.equal(rejected.state.player.dashCooldownRemainingMs, 550)

    let cooledDown = rejected.state
    for (let tick = 0; tick < 11; tick += 1) {
      cooledDown = stepGame(cooledDown, WAIT).state
    }

    assert.equal(cooledDown.player.dashCooldownRemainingMs, 0)
    assert.ok(
      eventTypes(
        stepGame(cooledDown, { type: 'dash', direction: { x: 1, y: 0 } }).events,
      ).includes('player_moved'),
    )
  })

  it('normalises movement input to a fixed per-tick distance', () => {
    const initial = createInitialState({ seed: 9 })
    const transition = stepGame(initial, {
      type: 'move',
      direction: { x: 3, y: 4 },
    })
    const deltaX = transition.state.player.position.x - initial.player.position.x
    const deltaY = transition.state.player.position.y - initial.player.position.y

    assert.ok(Math.abs(Math.hypot(deltaX, deltaY) - 10) < 0.000_01)
    assert.ok(Math.abs(deltaX - 6) < 0.000_01)
    assert.ok(Math.abs(deltaY - 8) < 0.000_01)
  })

  it('resolves dash collision without crossing a wall', () => {
    const collisionMap: GameMapDefinition = {
      ...DETERMINISTIC_MAP_FIXTURE,
      id: 'collision-test',
      playerSpawn: { x: 100, y: 100 },
      obstacles: [{ id: 'wall', bounds: { x: 150, y: 40, width: 20, height: 120 } }],
      damageZones: [],
    }
    const initial = createInitialState({ seed: 11, map: collisionMap })
    const first = stepGame(initial, { type: 'dash', direction: { x: 1, y: 0 } })
    const second = stepGame(createInitialState({ seed: 11, map: collisionMap }), {
      type: 'dash',
      direction: { x: 1, y: 0 },
    })

    assert.deepEqual(first, second)
    assert.ok(first.state.player.position.x <= 150 - first.state.player.radius)
    assert.ok(eventTypes(first.events).includes('movement_blocked'))
  })

  it('applies damage, death, and deterministic core respawn without losing the objective', () => {
    const initial = createInitialState({ seed: 'death-run' })
    const core = initial.cores[0]
    assert.ok(core)

    const collected = stepGame(withPlayerAt(initial, core.position.x, core.position.y), WAIT)
    assert.equal(collected.state.player.coresHeld, 1)

    const zone = collected.state.map.damageZones[0]
    assert.ok(zone)
    const insideZone = withPlayerAt(
      collected.state,
      zone.bounds.x + zone.bounds.width / 2,
      zone.bounds.y + zone.bounds.height / 2,
    )
    const vulnerable: GameState = {
      ...insideZone,
      player: {
        ...insideZone.player,
        health: zone.damage,
        damageCooldownRemainingMs: 0,
      },
    }
    const died = stepGame(vulnerable, WAIT)

    assert.deepEqual(eventTypes(died.events), [
      'player_damaged',
      'player_died',
      'cores_respawned',
    ])
    assert.equal(died.state.player.deaths, 1)
    assert.equal(died.state.player.health, died.state.player.maxHealth)
    assert.equal(died.state.player.coresHeld, 0)
    assert.equal(died.state.cores.length, initial.cores.length)
    assert.equal(died.state.cores[0]?.status, 'available')
    assert.deepEqual(died.state.cores[0]?.position, died.state.cores[0]?.spawnPosition)
    assert.ok(died.state.cores.length >= died.state.extraction.requiredBankedCores)
  })

  it('reports a lethal movement impact before respawning the player', () => {
    const lethalMap: GameMapDefinition = {
      ...DETERMINISTIC_MAP_FIXTURE,
      id: 'lethal-movement-test',
      playerSpawn: { x: 100, y: 100 },
      obstacles: [],
      damageZones: [
        { id: 'lethal-zone', bounds: { x: 140, y: 50, width: 40, height: 100 }, damage: 100 },
      ],
    }
    const transition = stepGame(createInitialState({ seed: 41, map: lethalMap }), {
      type: 'dash',
      direction: { x: 1, y: 0 },
    })
    const moved = transition.events.find(({ type }) => type === 'player_moved')

    assert.ok(moved?.type === 'player_moved')
    assert.ok(moved.to.x > lethalMap.playerSpawn.x)
    assert.deepEqual(transition.state.player.position, lethalMap.playerSpawn)
    assert.deepEqual(eventTypes(transition.events), [
      'player_moved',
      'player_damaged',
      'player_died',
    ])
  })

  it('applies damage again only when the fixed-tick cooldown expires', () => {
    const initial = createInitialState({ seed: 47 })
    const zone = initial.map.damageZones[0]
    assert.ok(zone)
    let state = withPlayerAt(
      initial,
      zone.bounds.x + zone.bounds.width / 2,
      zone.bounds.y + zone.bounds.height / 2,
    )

    const firstHit = stepGame(state, WAIT)
    assert.equal(firstHit.state.player.health, 50)
    assert.deepEqual(eventTypes(firstHit.events), ['player_damaged'])

    state = firstHit.state
    for (let tick = 0; tick < 7; tick += 1) {
      const protectedTick = stepGame(state, WAIT)
      assert.deepEqual(protectedTick.events, [])
      state = protectedTick.state
    }

    const secondHit = stepGame(state, WAIT)
    assert.deepEqual(eventTypes(secondHit.events), ['player_damaged', 'player_died'])
    assert.equal(secondHit.state.player.deaths, 1)
  })

  it('accepts contract-valid zero cooldowns and score awards', () => {
    const state = createInitialState({
      seed: 52,
      rules: {
        dashCooldownMs: 0,
        damageCooldownMs: 0,
        relayBankScore: 0,
        extractionScore: 0,
      },
    })
    const first = stepGame(state, { type: 'dash', direction: { x: 1, y: 0 } })
    const second = stepGame(first.state, { type: 'dash', direction: { x: 1, y: 0 } })

    assert.equal(first.state.player.dashCooldownRemainingMs, 0)
    assert.ok(eventTypes(second.events).includes('player_moved'))
  })

  it('does not mutate an input state while applying a command', () => {
    const initial = createInitialState({ seed: 23 })
    const snapshot = structuredClone(initial)

    stepGame(initial, RIGHT)

    assert.deepEqual(initial, snapshot)
  })

  it('rejects a map that cannot supply the primary objective', () => {
    const invalidMap: GameMapDefinition = {
      ...DETERMINISTIC_MAP_FIXTURE,
      coreSpawns: DETERMINISTIC_MAP_FIXTURE.coreSpawns.slice(0, 2),
    }

    assert.throws(
      () => createInitialState({ seed: 1, map: invalidMap }),
      /does not contain enough cores/,
    )
  })

  it('rejects a seeded core respawn that is not safely collectible', () => {
    const invalidMap: GameMapDefinition = {
      ...DETERMINISTIC_MAP_FIXTURE,
      coreSpawns: DETERMINISTIC_MAP_FIXTURE.coreSpawns.map((core, index) =>
        index === 0
          ? { ...core, position: { x: 20, y: core.position.y }, jitter: { x: 0, y: 0 } }
          : core,
      ),
    }

    assert.throws(
      () => createInitialState({ seed: 1, map: invalidMap }),
      /invalid position|not safely collectible/,
    )
  })
})
