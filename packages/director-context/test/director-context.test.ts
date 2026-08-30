import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { PatchOutcome } from '@fork-fighter/contracts'
import {
  directorRunFixtures,
  onTargetRunFixture,
  tooEasyRunFixture,
  tooHardRunFixture,
} from '../fixtures/runs/index.js'
import {
  LOCAL_POLICY_CANDIDATES,
  MAX_RETAINED_PATCH_OUTCOMES,
  advanceDirectorContext,
  aggregateRunTelemetry,
  isPatchCycleDue,
  replayDirectorContext,
  selectLocalAdaptivePatch,
  type DirectorReplayCycle,
} from '../src/index.js'

const contractModule = '../../contracts/src/index.ts'
const {
  GameEventBatchSchema,
  GameStateSchema,
  MatchDirectorContextSchema,
  MutationDefinitionSchema,
  RunTelemetrySchema,
} = (await import(contractModule)) as typeof import('@fork-fighter/contracts')

function withMatchAndPatch(
  cycle: DirectorReplayCycle,
  matchId: string,
  patchIndex: number,
): DirectorReplayCycle {
  const copy = structuredClone(cycle)
  copy.matchId = matchId
  copy.patchIndex = patchIndex
  copy.batches = copy.batches.map((batch, batchIndex) => ({
    ...batch,
    matchId,
    batchIndex: patchIndex + batchIndex,
  }))
  return copy
}

function patchOutcome(
  patchIndex: number,
  mutationId: string,
): PatchOutcome {
  return {
    mutationId,
    patchIndex,
    author: 'gremlin',
    status: 'expired',
    activatedAtMs: patchIndex * 20_000,
    endedAtMs: (patchIndex + 1) * 20_000,
    triggerActivations: 1,
    entitiesSpawned: 1,
    entitiesCleaned: 1,
    healthDelta: -5,
    coresBankedDelta: 1,
    scoreDelta: 100,
    challengeTrend: 'on_target',
  }
}

describe('run telemetry', () => {
  it('accepts the deterministic run fixtures at the frozen boundaries', () => {
    for (const fixture of directorRunFixtures) {
      assert.doesNotThrow(() => GameStateSchema.parse(fixture.input.state))
      for (const batch of fixture.input.batches) {
        assert.doesNotThrow(() => GameEventBatchSchema.parse(batch))
      }
    }
  })

  it('classifies too-easy, on-target, and too-hard fixtures predictably', () => {
    for (const fixture of directorRunFixtures) {
      const telemetry = aggregateRunTelemetry(fixture.input)
      assert.equal(telemetry.challengeTrend, fixture.expectedTrend)
      assert.doesNotThrow(() => RunTelemetrySchema.parse(telemetry))
    }
  })

  it('measures damage, deaths, objective progress, routes, and reward risk', () => {
    const dominant = aggregateRunTelemetry(tooEasyRunFixture.input)
    assert.equal(dominant.recentDamage, 0)
    assert.equal(dominant.recentDeaths, 0)
    assert.equal(dominant.primaryObjectiveProgress, 0.666667)
    assert.equal(dominant.routeRepetition, 1)
    assert.equal(dominant.lowRiskCoreRate, 0.75)
    assert.equal(dominant.highRiskCoreRate, 0.25)

    const weak = aggregateRunTelemetry(tooHardRunFixture.input)
    assert.equal(weak.recentDamage, 205)
    assert.equal(weak.recentDeaths, 2)
    assert.equal(weak.primaryObjectiveProgress, 0)
  })

  it('replays active mutation lifecycle events in chronological order', () => {
    const input = structuredClone(onTargetRunFixture.input)
    input.startingActiveMutationIds = ['existing-patch']
    input.batches[0]!.events.push(
      {
        type: 'patch_activated',
        tick: 700,
        atMs: 35_000,
        mutationId: 'new-patch',
        author: 'gremlin',
        expiresAtMs: 55_000,
      },
      {
        type: 'patch_expired',
        tick: 720,
        atMs: 36_000,
        mutationId: 'existing-patch',
        cleanedTags: ['existing-patch-entities'],
      },
    )

    assert.deepEqual(aggregateRunTelemetry(input).activeMutationIds, [
      'new-patch',
    ])
  })
})

describe('retained director context', () => {
  it('keeps compact server-owned context serializable and replayable', () => {
    const matchId = 'replayable-match'
    const first = withMatchAndPatch(tooEasyRunFixture.input, matchId, 0)
    first.patchOutcomes = [patchOutcome(0, 'first-patch')]
    const second = withMatchAndPatch(onTargetRunFixture.input, matchId, 1)
    second.patchOutcomes = [patchOutcome(1, 'second-patch')]
    const cycles = [first, second]

    const replayed = replayDirectorContext(cycles)
    const sequential = advanceDirectorContext({
      ...second,
      previousContext: advanceDirectorContext(first),
    })

    assert.deepEqual(replayed, sequential)
    assert.deepEqual(JSON.parse(JSON.stringify(replayed)), replayed)
    assert.equal(replayed.telemetry.recentPatchOutcomes.length, 2)
    assert.doesNotThrow(() => MatchDirectorContextSchema.parse(replayed))
  })

  it('bounds prior outcomes and signals the 20-second patch cadence', () => {
    const input = structuredClone(tooEasyRunFixture.input)
    input.patchOutcomes = Array.from(
      { length: MAX_RETAINED_PATCH_OUTCOMES + 3 },
      (_, index) => patchOutcome(index, `patch-${index}`),
    )
    const context = advanceDirectorContext(input)

    assert.equal(
      context.telemetry.recentPatchOutcomes.length,
      MAX_RETAINED_PATCH_OUTCOMES,
    )
    assert.equal(isPatchCycleDue(19_999), false)
    assert.equal(isPatchCycleDue(20_000), true)
    assert.equal(isPatchCycleDue(39_999, context), false)
    assert.equal(isPatchCycleDue(40_000, context), true)
  })
})

describe('local adaptive policy', () => {
  it('keeps every local fixture inside the frozen mutation contract', () => {
    for (const { mutation } of LOCAL_POLICY_CANDIDATES) {
      assert.doesNotThrow(() => MutationDefinitionSchema.parse(mutation))
    }
  })

  it('never gives a weak run a harder patch', () => {
    const context = advanceDirectorContext(tooHardRunFixture.input)
    const decision = selectLocalAdaptivePatch(context)

    assert.equal(context.remainingDifficultyBudget, 0)
    assert.equal(decision.action, 'hold')
    assert.equal(decision.mutation, null)
  })

  it('gives a dominant repetitive run measured escalation', () => {
    const context = advanceDirectorContext(tooEasyRunFixture.input)
    const decision = selectLocalAdaptivePatch(context)

    assert.equal(decision.action, 'apply')
    if (decision.action !== 'apply') {
      assert.fail('expected the local fixture policy to select a patch')
    }
    assert.equal(decision.mutation.id, 'route-tax-with-upside')
    assert.ok(decision.mutation.difficultyCost <= 1.5)
    assert.equal(decision.context.remainingDifficultyBudget, 0.5)
  })

  it('does not select the same mutation twice consecutively', () => {
    const context = advanceDirectorContext(tooEasyRunFixture.input)
    const first = selectLocalAdaptivePatch(context)
    assert.equal(first.action, 'apply')
    if (first.action !== 'apply') {
      assert.fail('expected the first patch to be selected')
    }

    const replenished = {
      ...first.context,
      remainingDifficultyBudget: 2,
    }
    const fallback = selectLocalAdaptivePatch(replenished)
    assert.equal(fallback.action, 'apply')
    if (fallback.action !== 'apply') {
      assert.fail('expected a deterministic fallback patch')
    }
    assert.notEqual(fallback.mutation.id, first.mutation.id)
    assert.equal(fallback.mutation.id, 'safe-core-collector')
  })
})
