import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  GameMasterRequestSchema,
  MUTATION_CAPABILITIES,
  MatchDirectorContextSchema,
  MutationProposalSchema,
  ProposalResultSchema,
  type GameMasterPersona,
  type MatchDirectorContext,
  type MutationProposal,
  type ProposalHistoryEntry,
} from '@fork-fighter/contracts'

import {
  GAME_MASTER_PERSONAS,
  PERSONA_DEFINITIONS,
  ArchitectMockBrain,
  createDeterministicMockBrains,
  createGameMasterRequests,
  createGremlinMockProposal,
  proposeConcurrently,
  runAgentBrain,
  type AgentBrain,
} from '../src/index.js'

function directorContext(): MatchDirectorContext {
  return MatchDirectorContextSchema.parse({
    version: 1,
    matchId: 'match-agent-test',
    patchIndex: 3,
    updatedAtMs: 60_000,
    telemetry: {
      matchId: 'match-agent-test',
      patchIndex: 3,
      elapsedMs: 60_000,
      health: 92,
      coresHeld: 1,
      coresBanked: 2,
      primaryObjectiveProgress: 2 / 3,
      recentDamage: 8,
      recentDeaths: 0,
      routeRepetition: 0.82,
      lowRiskCoreRate: 0.8,
      highRiskCoreRate: 0.2,
      activeMutationIds: [],
      recentPatchOutcomes: [],
      challengeTrend: 'too_easy',
    },
    remainingDifficultyBudget: 3,
    recentMutationIds: ['previous-mutation'],
    rejectedConceptIds: ['blocked-extraction'],
  })
}

function requests(deadlineMs = 100) {
  return createGameMasterRequests({
    context: directorContext(),
    requestedAtMs: 60_000,
    deadlineMs,
  })
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, keys)
    }
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key)
      collectKeys(child, keys)
    }
  }
  return keys
}

describe('persona requests and prompts', () => {
  it('builds compact, capability-aware requests with isolated history', () => {
    const history: ProposalHistoryEntry[] = [
      ...Array.from({ length: 10 }, (_, patchIndex) => ({
        proposalId: `architect-proposal-${patchIndex}`,
        mutationId: `architect-mutation-${patchIndex}`,
        persona: 'architect' as const,
        patchIndex,
        result: 'rejected' as const,
        note: `Architect history ${patchIndex}.`,
      })),
      {
        proposalId: 'gremlin-proposal-1',
        mutationId: 'gremlin-mutation-1',
        persona: 'gremlin',
        patchIndex: 1,
        result: 'selected',
        note: 'Gremlin history only.',
      },
      {
        proposalId: 'auditor-proposal-2',
        mutationId: 'auditor-mutation-2',
        persona: 'auditor',
        patchIndex: 2,
        result: 'expired',
        note: 'Auditor history only.',
      },
    ]
    const context = directorContext()
    const built = createGameMasterRequests({
      context,
      requestedAtMs: 60_000,
      deadlineMs: 500,
      proposalHistory: history,
    })

    assert.equal(
      new Set(Object.values(built).map(({ requestId }) => requestId)).size,
      3,
    )
    for (const persona of GAME_MASTER_PERSONAS) {
      const request = built[persona]
      assert.doesNotThrow(() => GameMasterRequestSchema.parse(request))
      assert.equal(request.persona, persona)
      assert.deepEqual(request.context, context)
      assert.deepEqual(request.capabilities, MUTATION_CAPABILITIES)
      assert.equal(request.context.remainingDifficultyBudget, 3)
      assert.ok(
        request.priorProposals.every((entry) => entry.persona === persona),
      )
    }
    assert.equal(built.architect.priorProposals.length, 8)
    assert.equal(built.architect.priorProposals[0]?.patchIndex, 2)
    assert.equal(built.gremlin.priorProposals.length, 1)
    assert.equal(built.auditor.priorProposals.length, 1)
  })

  it('defines distinct, typed-output-only prompts and strategies', () => {
    const prompts = GAME_MASTER_PERSONAS.map(
      (persona) => PERSONA_DEFINITIONS[persona],
    )

    assert.deepEqual(
      prompts.map(({ displayName }) => displayName),
      ['Architect', 'Gremlin', 'Auditor'],
    )
    assert.equal(new Set(prompts.map(({ systemPrompt }) => systemPrompt)).size, 3)
    assert.equal(new Set(prompts.map(({ strategy }) => strategy.intent)).size, 3)
    for (const persona of prompts) {
      assert.match(persona.systemPrompt, /exactly one JSON MutationProposal/)
      assert.match(persona.systemPrompt, /Never return prose/)
      assert.match(persona.systemPrompt, /source edits/)
    }
  })
})

describe('deterministic mock proposal cycle', () => {
  it('starts all three mocks concurrently and returns one distinct typed proposal each', async () => {
    const started: GameMasterPersona[] = []
    const options = Object.fromEntries(
      GAME_MASTER_PERSONAS.map((persona) => [
        persona,
        {
          delayMs: 20,
          onRequest: () => {
            started.push(persona)
          },
        },
      ]),
    )
    const brains = createDeterministicMockBrains(options)
    const pending = proposeConcurrently(brains, requests(200))

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
    assert.deepEqual(new Set(started), new Set(GAME_MASTER_PERSONAS))

    const results = await pending
    const proposals: MutationProposal[] = GAME_MASTER_PERSONAS.map((persona) => {
      const result = results[persona]
      assert.doesNotThrow(() => ProposalResultSchema.parse(result))
      assert.equal(result.status, 'proposed')
      assert.equal(
        started.filter((startedPersona) => startedPersona === persona).length,
        1,
      )
      assert.doesNotThrow(() => MutationProposalSchema.parse(result.proposal))
      assert.equal(result.proposal.author, persona)
      assert.equal(result.proposal.requestId, requests(200)[persona].requestId)
      return result.proposal
    })

    assert.equal(proposals.length, 3)
    assert.equal(new Set(proposals.map(({ proposalId }) => proposalId)).size, 3)
    assert.deepEqual(
      proposals.map(({ mutation }) =>
        mutation.triggers.flatMap(({ effects }) => effects.map(({ type }) => type)),
      ),
      [
        ['configureRunner', 'spawnRunnerHazard'],
        ['configureRunner', 'spawnRunnerHazard'],
        ['configureRunner'],
      ],
    )
    assert.deepEqual(
      proposals.map(({ mutation }) => {
        const effect = mutation.triggers[0]?.effects[0]
        return effect?.type === 'configureRunner' ? effect.gravityMode : undefined
      }),
      ['moon', 'inverted', 'normal'],
    )

    const forbiddenKeys = new Set([
      'command',
      'commands',
      'rawCommand',
      'source',
      'sourceEdit',
      'sourceEdits',
      'code',
      'script',
    ])
    for (const proposal of proposals) {
      for (const key of collectKeys(proposal)) {
        assert.equal(forbiddenKeys.has(key), false, `forbidden proposal key: ${key}`)
      }
    }
  })

  it('returns the same proposal for the same persona request', async () => {
    const request = requests().architect
    const brain = new ArchitectMockBrain()

    assert.deepEqual(await brain.propose(request), await brain.propose(request))
  })

  it('alternates Gremlin into a zero-gravity anvil demand on even cycles', () => {
    const base = requests().gremlin
    const request = GameMasterRequestSchema.parse({
      ...base,
      requestId: 'request-zero-gravity-gremlin',
      context: {
        ...base.context,
        patchIndex: 4,
        telemetry: { ...base.context.telemetry, patchIndex: 4 },
      },
    })
    const proposal = createGremlinMockProposal(request)
    const effects = proposal.mutation.triggers.flatMap(({ effects }) => effects)
    const configuration = effects.find(({ type }) => type === 'configureRunner')
    const hazard = effects.find(({ type }) => type === 'spawnRunnerHazard')

    assert.equal(
      configuration?.type === 'configureRunner' ? configuration.gravityMode : undefined,
      'zero_g',
    )
    assert.equal(
      hazard?.type === 'spawnRunnerHazard' ? hazard.hazard : undefined,
      'falling_anvil',
    )
  })
})

describe('provider failure boundary', () => {
  it('turns a missed deadline into a typed timeout result', async () => {
    const request = requests(5).architect
    const result = await runAgentBrain(
      new ArchitectMockBrain({ delayMs: 30 }),
      request,
    )

    assert.doesNotThrow(() => ProposalResultSchema.parse(result))
    assert.equal(result.status, 'failed')
    assert.equal(result.error.code, 'timeout')
  })

  it('turns provider rejection into a typed unavailable result', async () => {
    const request = requests().architect
    const result = await runAgentBrain(
      new ArchitectMockBrain({ unavailable: true }),
      request,
    )

    assert.doesNotThrow(() => ProposalResultSchema.parse(result))
    assert.equal(result.status, 'failed')
    assert.equal(result.error.code, 'provider_unavailable')
  })

  it('rejects prose and command-shaped objects as actionable responses', async () => {
    const request = requests().architect
    const proseBrain: AgentBrain = {
      async propose() {
        return 'I propose making the player move left.'
      },
    }
    const commandBrain: AgentBrain = {
      async propose() {
        return {
          proposalId: 'unsafe-proposal',
          requestId: request.requestId,
          author: 'architect',
          rawCommand: 'edit src/game.ts',
        }
      },
    }

    for (const brain of [proseBrain, commandBrain]) {
      const result = await runAgentBrain(brain, request)
      assert.doesNotThrow(() => ProposalResultSchema.parse(result))
      assert.equal(result.status, 'failed')
      assert.equal(result.error.code, 'invalid_response')
    }
  })
})
