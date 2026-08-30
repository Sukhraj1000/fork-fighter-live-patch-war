import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  MatchDirectorContextSchema,
  MutationProposalSchema,
} from '@fork-fighter/contracts'

import {
  invalidValidatorFixtures,
  routeBlockingGameStateFixture,
  routeBlockingProposalFixture,
  validBonusProposalFixture,
  validCollectorProposalFixture,
  validatorContextFixture,
  validatorGameStateFixture,
} from '../fixtures/validator-fixtures.js'
import {
  mutationConceptId,
  mutationMechanicKey,
  resolveValidatorPolicy,
  runDeterministicMicroSimulation,
  selectMutationProposal,
  validateMutationProposal,
  type MutationSimulationAdapter,
} from '../src/index.js'

describe('mutation validation gates', () => {
  for (const fixture of invalidValidatorFixtures) {
    it(`rejects ${fixture.name} at the expected gate`, () => {
      const result = validateMutationProposal({
        proposal: fixture.proposal,
        context: fixture.context,
        gameState: fixture.gameState,
      })

      assert.equal(result.valid, false)
      if (result.valid) return
      assert.equal(result.checks.at(-1)?.gate, fixture.expectedGate)
      assert.equal(result.checks.at(-1)?.status, 'failed')
      assert.ok(
        result.reasons.some(({ code }) => code === fixture.expectedCode),
        `expected ${fixture.expectedCode}; received ${result.reasons
          .map(({ code }) => code)
          .join(', ')}`,
      )
    })
  }

  it('passes a valid proposal through all seven gates', () => {
    const result = validateMutationProposal({
      proposal: validCollectorProposalFixture,
      context: validatorContextFixture,
      gameState: validatorGameStateFixture,
    })

    assert.equal(result.valid, true)
    if (!result.valid) return
    assert.deepEqual(
      result.checks.map(({ gate }) => gate),
      [
        'schema',
        'capability',
        'cleanup',
        'invariant',
        'difficulty',
        'novelty',
        'simulation',
      ],
    )
    assert.ok(result.checks.every(({ status }) => status === 'passed'))
    assert.ok(Number.isFinite(result.score))
  })

  it('does not mutate proposal, context, or game state inputs', () => {
    const proposal = structuredClone(validCollectorProposalFixture)
    const context = structuredClone(validatorContextFixture)
    const gameState = structuredClone(validatorGameStateFixture)
    const snapshot = structuredClone({ proposal, context, gameState })

    validateMutationProposal({ proposal, context, gameState })

    assert.deepEqual({ proposal, context, gameState }, snapshot)
  })

  it('rejects a primary-objective requirement that exceeds available cores', () => {
    const proposal = MutationProposalSchema.parse({
      proposalId: 'proposal-impossible-extraction',
      requestId: 'request-validator-2',
      author: 'auditor',
      mutation: {
        id: 'impossible-extraction',
        title: 'Impossible Extraction',
        patchNote: 'Extraction asks for more cores than exist.',
        author: 'auditor',
        durationMs: 20_000,
        difficultyCost: 1.5,
        triggers: [
          {
            id: 'activate-requirement',
            type: 'onActivation',
            effects: [
              {
                type: 'adjustExtractionRequirement',
                additionalBankedCores: 2,
                tag: 'impossible-extraction:rule',
              },
            ],
          },
        ],
        limits: { maxTriggerActivations: 1, maxSpawnedEntities: 1 },
        cleanup: [
          {
            type: 'restoreRulesByTag',
            tag: 'impossible-extraction:rule',
            when: 'expiry',
          },
        ],
      },
      summary: 'Raises the extraction requirement.',
      expectedImpact: 'Would make the primary objective impossible.',
    })

    const result = validateMutationProposal({
      proposal,
      context: validatorContextFixture,
      gameState: validatorGameStateFixture,
    })

    assert.equal(result.valid, false)
    if (result.valid) return
    assert.equal(result.checks.at(-1)?.gate, 'invariant')
    assert.ok(
      result.reasons.some(({ code }) => code === 'primary-objective-impossible'),
    )
  })

  it('blocks escalation when telemetry says the player is struggling', () => {
    const strugglingContext = MatchDirectorContextSchema.parse({
      ...structuredClone(validatorContextFixture),
      telemetry: {
        ...structuredClone(validatorContextFixture.telemetry),
        challengeTrend: 'too_hard',
        recentDeaths: 1,
      },
    })
    const result = validateMutationProposal({
      proposal: validCollectorProposalFixture,
      context: strugglingContext,
      gameState: validatorGameStateFixture,
    })

    assert.equal(result.valid, false)
    if (result.valid) return
    assert.equal(result.checks.at(-1)?.gate, 'difficulty')
    assert.ok(result.reasons.some(({ code }) => code === 'escalation-blocked'))
  })

  it('enforces the active-mutation concurrency limit', () => {
    const busyContext = MatchDirectorContextSchema.parse({
      ...structuredClone(validatorContextFixture),
      telemetry: {
        ...structuredClone(validatorContextFixture.telemetry),
        activeMutationIds: ['active-one'],
      },
    })
    const result = validateMutationProposal({
      proposal: validCollectorProposalFixture,
      context: busyContext,
      gameState: validatorGameStateFixture,
    })

    assert.equal(result.valid, false)
    if (result.valid) return
    assert.equal(result.checks.at(-1)?.gate, 'capability')
    assert.ok(
      result.reasons.some(({ code }) => code === 'active-mutation-limit'),
    )
  })

  it('recognises the same recent mechanic under a new mutation id', () => {
    const renamed = MutationProposalSchema.parse({
      ...structuredClone(validCollectorProposalFixture),
      proposalId: 'proposal-renamed-collector',
      mutation: {
        ...structuredClone(validCollectorProposalFixture.mutation),
        id: 'renamed-collector',
      },
    })
    const mechanicKey = mutationMechanicKey(validCollectorProposalFixture.mutation)
    const result = validateMutationProposal({
      proposal: renamed,
      context: validatorContextFixture,
      gameState: validatorGameStateFixture,
      recentMechanicKeys: [mechanicKey],
    })

    assert.equal(result.valid, false)
    if (result.valid) return
    assert.equal(result.checks.at(-1)?.gate, 'novelty')
    assert.ok(result.reasons.some(({ code }) => code === 'mechanic-repeated'))
    assert.match(mutationConceptId(renamed.mutation), /^mechanic-[0-9a-f]{8}$/)
  })

  it('returns concise feed-safe messages without reflecting proposal content', () => {
    const proposal = {
      ...structuredClone(validCollectorProposalFixture),
      proposalId: 'proposal-feed-safe',
      mutation: {
        ...structuredClone(validCollectorProposalFixture.mutation),
        patchNote: '<script>private-provider-prompt</script>',
        durationMs: 60_000,
      },
    }
    const result = validateMutationProposal({
      proposal,
      context: validatorContextFixture,
      gameState: validatorGameStateFixture,
    })
    const serialised = JSON.stringify(result)

    assert.equal(result.valid, false)
    assert.doesNotMatch(serialised, /private-provider-prompt|<script>/)
    assert.ok(result.checks.every(({ message }) => message.length <= 200))
    if (!result.valid) {
      assert.ok(result.reasons.every(({ message }) => message.length <= 200))
    }
  })
})

describe('deterministic micro-simulation', () => {
  it('replays a valid apply-and-expire cycle identically', () => {
    const input = {
      mutation: validCollectorProposalFixture.mutation,
      context: validatorContextFixture,
      gameState: validatorGameStateFixture,
      policy: resolveValidatorPolicy(undefined),
    }
    const first = runDeterministicMicroSimulation(input)
    const second = runDeterministicMicroSimulation(input)

    assert.deepEqual(first, second)
    assert.equal(first.passed, true)
    assert.match(first.digest, /^sim-[0-9a-f]{8}$/)
    assert.equal(first.entitiesSpawned, first.entitiesCleaned)
    assert.ok(first.triggerActivations > 0)
  })

  it('rejects an adapter whose repeated results differ', () => {
    let run = 0
    const nondeterministicAdapter: MutationSimulationAdapter = {
      id: 'unstable-test-adapter',
      simulate: () => ({
        passed: true,
        digest: `sim-${run++}`,
        triggerActivations: 1,
        entitiesSpawned: 0,
        entitiesCleaned: 0,
        reasons: [],
      }),
    }
    const result = validateMutationProposal({
      proposal: validCollectorProposalFixture,
      context: validatorContextFixture,
      gameState: validatorGameStateFixture,
      simulationAdapter: nondeterministicAdapter,
    })

    assert.equal(result.valid, false)
    if (result.valid) return
    assert.equal(result.checks.at(-1)?.gate, 'simulation')
    assert.ok(
      result.reasons.some(({ code }) => code === 'simulation-nondeterministic'),
    )
  })
})

describe('deterministic selection', () => {
  it('never selects a route-blocking mutation', () => {
    const selection = selectMutationProposal({
      candidates: [routeBlockingProposalFixture],
      context: validatorContextFixture,
      gameState: routeBlockingGameStateFixture,
    })

    assert.equal(selection.selected, null)
    assert.equal(selection.selectedValidation, null)
    assert.equal(selection.validations[0]?.valid, false)
  })

  it('selects the same candidate regardless of candidate order', () => {
    const firstCollector = MutationProposalSchema.parse({
      ...structuredClone(validCollectorProposalFixture),
      proposalId: 'proposal-a',
      mutation: {
        ...structuredClone(validCollectorProposalFixture.mutation),
        id: 'collector-a',
      },
    })
    const secondCollector = MutationProposalSchema.parse({
      ...structuredClone(validCollectorProposalFixture),
      proposalId: 'proposal-b',
      mutation: {
        ...structuredClone(validCollectorProposalFixture.mutation),
        id: 'collector-b',
      },
    })
    const forward = selectMutationProposal({
      candidates: [secondCollector, validBonusProposalFixture, firstCollector],
      context: validatorContextFixture,
      gameState: validatorGameStateFixture,
    })
    const reverse = selectMutationProposal({
      candidates: [firstCollector, validBonusProposalFixture, secondCollector],
      context: validatorContextFixture,
      gameState: validatorGameStateFixture,
    })

    assert.equal(forward.selected?.proposalId, 'proposal-a')
    assert.deepEqual(forward, reverse)
  })
})
