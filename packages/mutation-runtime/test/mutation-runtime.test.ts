import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import {
  GameEventSchema,
  MutationDefinitionSchema,
  canonicalMockGameState,
  debtCollectorMutationFixture as canonicalDebtCollector,
  type GameEvent,
  type MutationDefinition,
} from '@fork-fighter/contracts'
import {
  createInitialState,
  stepGame,
  type GameState,
  type PlayerCommand,
} from '@fork-fighter/game-core'

import {
  MutationRuntimeError,
  activateMutation,
  advanceMutationRuntime,
  createMutationRuntimeState,
  processMutationGameBoundary,
  type MutationRuntimeState,
} from '../src/index.js'

const fixtureUrl = new URL(
  '../../../fixtures/mutations/runtime/debt-collector.json',
  import.meta.url,
)
const debtCollectorFixture = MutationDefinitionSchema.parse(
  JSON.parse(readFileSync(fixtureUrl, 'utf8')),
)

const coreCollected: GameEvent = {
  type: 'core_collected',
  tick: canonicalMockGameState.tick,
  atMs: canonicalMockGameState.elapsedMs,
  coreId: 'core-b',
  risk: 'safe',
  coresHeld: 1,
}

function activateDebtCollector(): MutationRuntimeState {
  return activateMutation(
    createMutationRuntimeState(),
    debtCollectorFixture,
    { tick: 0, atMs: 0 },
  ).state
}

function runLifecycle(): {
  runtime: MutationRuntimeState
  events: GameEvent[]
} {
  const activated = activateMutation(
    createMutationRuntimeState(),
    debtCollectorFixture,
    { tick: 0, atMs: 0 },
  )
  const applied = processMutationGameBoundary(activated.state, {
    state: canonicalMockGameState,
    events: [coreCollected],
  })
  const expired = advanceMutationRuntime(applied.state, {
    tick: 400,
    atMs: 20_000,
  })

  return {
    runtime: expired.state,
    events: [...activated.events, ...applied.events, ...expired.events],
  }
}

describe('Debt Collector fixture', () => {
  it('is a hand-authored typed fixture matching the canonical contract example', () => {
    const fixture: MutationDefinition = debtCollectorFixture

    assert.deepEqual(fixture, canonicalDebtCollector)
    assert.equal(fixture.title, 'Debt Collector')
  })
})

describe('mutation lifecycle', () => {
  it('activates at an explicit deterministic boundary', () => {
    const input = createMutationRuntimeState()
    const first = activateMutation(input, debtCollectorFixture, {
      tick: 20,
      atMs: 1_000,
    })
    const second = activateMutation(input, debtCollectorFixture, {
      tick: 20,
      atMs: 1_000,
    })

    assert.deepEqual(first, second)
    assert.deepEqual(input, createMutationRuntimeState())
    assert.equal(first.state.activeMutation?.expiresAtMs, 21_000)
    assert.deepEqual(first.events, [
      {
        type: 'patch_activated',
        tick: 20,
        atMs: 1_000,
        mutationId: 'debt-collector',
        author: 'gremlin',
        expiresAtMs: 21_000,
      },
    ])
    assert.doesNotThrow(() => GameEventSchema.parse(first.events[0]))
  })

  it('dispatches onCoreCollected and applies spawnCollector deterministically', () => {
    const input = activateDebtCollector()
    const snapshot = structuredClone(input)
    const first = processMutationGameBoundary(input, {
      state: canonicalMockGameState,
      events: [coreCollected],
    })
    const second = processMutationGameBoundary(input, {
      state: canonicalMockGameState,
      events: [coreCollected],
    })

    assert.deepEqual(first, second)
    assert.deepEqual(input, snapshot)
    assert.deepEqual(first.state.entities, [
      {
        type: 'collector',
        id: 'collector:000001',
        mutationId: 'debt-collector',
        triggerId: 'collect-core',
        tag: 'debt-collector:collectors',
        position: canonicalMockGameState.cores[1]?.position,
        speedMultiplier: 0.55,
        contactDamage: 10,
        sourceCoreId: 'core-b',
        spawnedAtTick: 30,
        spawnedAtMs: 1_500,
      },
    ])
    assert.deepEqual(first.events, [
      {
        type: 'patch_effect_applied',
        tick: 30,
        atMs: 1_500,
        mutationId: 'debt-collector',
        triggerId: 'collect-core',
        effect: 'spawnCollector',
        affectedIds: ['collector:000001'],
      },
    ])
    assert.doesNotThrow(() => GameEventSchema.parse(first.events[0]))
  })

  it('honours risk filters and hard activation/entity budgets', () => {
    const riskyMutation = structuredClone(debtCollectorFixture)
    const trigger = riskyMutation.triggers[0]
    assert.ok(trigger?.type === 'onCoreCollected')
    trigger.coreRisk = 'risky'

    const activated = activateMutation(
      createMutationRuntimeState(),
      riskyMutation,
      { tick: 0, atMs: 0 },
    )
    const ignored = processMutationGameBoundary(activated.state, {
      state: canonicalMockGameState,
      events: [coreCollected],
    })
    assert.deepEqual(ignored.events, [])
    assert.deepEqual(ignored.state.entities, [])

    let runtime = activateDebtCollector()
    const effectEvents: GameEvent[] = []
    for (let activation = 0; activation < 5; activation += 1) {
      const transition = processMutationGameBoundary(runtime, {
        state: canonicalMockGameState,
        events: [coreCollected],
      })
      runtime = transition.state
      effectEvents.push(...transition.events)
    }

    assert.equal(runtime.entities.length, 4)
    assert.equal(effectEvents.length, 4)
    assert.equal(
      runtime.activeMutation?.triggerActivations[0]?.count,
      4,
    )
  })

  it('expires on the inclusive duration boundary and removes all tagged state', () => {
    const applied = processMutationGameBoundary(activateDebtCollector(), {
      state: canonicalMockGameState,
      events: [coreCollected],
    })
    const beforeExpiry = advanceMutationRuntime(applied.state, {
      tick: 399,
      atMs: 19_999,
    })
    const expired = advanceMutationRuntime(beforeExpiry.state, {
      tick: 400,
      atMs: 20_000,
    })

    assert.equal(beforeExpiry.state.entities.length, 1)
    assert.equal(expired.state.activeMutation, null)
    assert.deepEqual(expired.state.entities, [])
    assert.deepEqual(expired.events, [
      {
        type: 'patch_expired',
        tick: 400,
        atMs: 20_000,
        mutationId: 'debt-collector',
        cleanedTags: ['debt-collector:collectors'],
      },
    ])
    assert.doesNotThrow(() => GameEventSchema.parse(expired.events[0]))
  })

  it('produces identical activation, effect, expiry, and cleanup results', () => {
    assert.deepEqual(runLifecycle(), runLifecycle())
  })

  it('expires before dispatching a trigger at the same timestamp', () => {
    const expiringState: GameState = {
      ...canonicalMockGameState,
      tick: 400,
      elapsedMs: 20_000,
    }
    const event: GameEvent = {
      ...coreCollected,
      tick: 400,
      atMs: 20_000,
    }
    const result = processMutationGameBoundary(activateDebtCollector(), {
      state: expiringState,
      events: [event],
    })

    assert.deepEqual(result.state.entities, [])
    assert.deepEqual(result.events.map(({ type }) => type), ['patch_expired'])
  })
})

describe('runtime boundary safety', () => {
  it('parses unknown configs before they can enter runtime state', () => {
    const input = createMutationRuntimeState()
    const malformed = structuredClone(debtCollectorFixture) as unknown as {
      triggers: Array<{ effects: unknown[] }>
    }
    malformed.triggers[0]!.effects = [
      { type: 'executeJavascript', source: 'boom' },
    ]

    assert.throws(() =>
      activateMutation(input, malformed, { tick: 0, atMs: 0 }),
    )
    assert.deepEqual(input, createMutationRuntimeState())
  })

  it('rejects contract-valid capabilities outside the first runtime slice', () => {
    const unsupported = structuredClone(debtCollectorFixture) as unknown as Record<
      string,
      unknown
    >
    unsupported.triggers = [
      {
        id: 'timer',
        type: 'onInterval',
        everyMs: 1_000,
        effects: debtCollectorFixture.triggers[0]!.effects,
      },
    ]
    const parsed = MutationDefinitionSchema.parse(unsupported)

    assert.throws(
      () =>
        activateMutation(createMutationRuntimeState(), parsed, {
          tick: 0,
          atMs: 0,
        }),
      (error: unknown) =>
        error instanceof MutationRuntimeError &&
        error.code === 'unsupported_trigger',
    )
  })

  it('rejects out-of-order clocks and mismatched event boundaries', () => {
    const activated = activateMutation(
      createMutationRuntimeState(),
      debtCollectorFixture,
      { tick: 20, atMs: 1_000 },
    )

    assert.throws(
      () =>
        advanceMutationRuntime(activated.state, { tick: 19, atMs: 999 }),
      (error: unknown) =>
        error instanceof MutationRuntimeError &&
        error.code === 'boundary_out_of_order',
    )
    assert.throws(
      () =>
        processMutationGameBoundary(activated.state, {
          state: canonicalMockGameState,
          events: [{ ...coreCollected, tick: 29 }],
        }),
      (error: unknown) =>
        error instanceof MutationRuntimeError &&
        error.code === 'event_boundary_mismatch',
    )
  })
})

describe('game-core integration', () => {
  it('keeps the base collect, bank, and extraction loop completable', () => {
    const right: PlayerCommand = {
      type: 'move',
      direction: { x: 1, y: 0 },
    }
    let game = createInitialState({ seed: 'mutation-runtime-loop' })
    let runtime = activateMutation(
      createMutationRuntimeState(),
      debtCollectorFixture,
      { tick: game.tick, atMs: game.elapsedMs },
    ).state

    for (let tick = 0; tick < 90; tick += 1) {
      const transition = stepGame(game, right)
      const gameSnapshot = structuredClone(transition.state)
      const mutationTransition = processMutationGameBoundary(runtime, transition)
      assert.deepEqual(transition.state, gameSnapshot)
      game = transition.state
      runtime = mutationTransition.state
    }

    assert.equal(game.status, 'completed')
    assert.equal(game.extraction.completed, true)
    assert.equal(game.player.coresBanked, 3)
    assert.equal(runtime.entities.length, 3)

    const expired = advanceMutationRuntime(runtime, {
      tick: 400,
      atMs: 20_000,
    })
    assert.deepEqual(expired.state.entities, [])
    assert.equal(expired.state.activeMutation, null)
    assert.equal(game.status, 'completed')
  })
})
