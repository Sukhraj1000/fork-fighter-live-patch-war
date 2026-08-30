import { describe, expect, it } from 'vitest'

import {
  GameMasterRequestSchema,
  GameEventBatchSchema,
  GameStateSchema,
  MAX_MUTATION_DURATION_MS,
  MUTATION_CAPABILITIES,
  MatchDirectorContextSchema,
  MutationDefinitionSchema,
  MutationProposalSchema,
  PlayerCommandSchema,
  ProposalResultSchema,
  RunTelemetrySchema,
  ValidationResultSchema,
  canonicalMockEventBatch,
  canonicalMockGameState,
  debtCollectorMutationFixture,
  type MutationDefinition,
  type PlayerCommand,
} from '../src/index.js'

function mutationWith(
  update: (mutation: Record<string, unknown>) => void,
): Record<string, unknown> {
  const mutation = structuredClone(
    debtCollectorMutationFixture,
  ) as unknown as Record<string, unknown>
  update(mutation)
  return mutation
}

describe('canonical fixtures', () => {
  it('parses the canonical game state and event batch', () => {
    expect(GameStateSchema.parse(canonicalMockGameState)).toEqual(
      canonicalMockGameState,
    )
    expect(GameEventBatchSchema.parse(canonicalMockEventBatch)).toEqual(
      canonicalMockEventBatch,
    )
  })

  it('parses the Debt Collector mutation as an inferred type', () => {
    const mutation: MutationDefinition = MutationDefinitionSchema.parse(
      debtCollectorMutationFixture,
    )
    expect(mutation.id).toBe('debt-collector')
  })
})

describe('mutation boundary', () => {
  it('rejects unknown effects', () => {
    const result = MutationDefinitionSchema.safeParse(
      mutationWith((mutation) => {
        const triggers = mutation.triggers as Array<Record<string, unknown>>
        triggers[0]!.effects = [{ type: 'executeJavascript', source: 'boom' }]
      }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects unbounded spawn counts', () => {
    const result = MutationDefinitionSchema.safeParse(
      mutationWith((mutation) => {
        const triggers = mutation.triggers as Array<{
          effects: Array<Record<string, unknown>>
        }>
        triggers[0]!.effects[0]!.count = 999
      }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects excessive duration', () => {
    const result = MutationDefinitionSchema.safeParse(
      mutationWith((mutation) => {
        mutation.durationMs = MAX_MUTATION_DURATION_MS + 1
      }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects missing cleanup', () => {
    const result = MutationDefinitionSchema.safeParse(
      mutationWith((mutation) => {
        mutation.cleanup = []
      }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects cleanup for the wrong tag', () => {
    const result = MutationDefinitionSchema.safeParse(
      mutationWith((mutation) => {
        mutation.cleanup = [
          {
            type: 'removeEntitiesByTag',
            tag: 'some-other-tag',
            when: 'expiry',
          },
        ]
      }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects unknown top-level capabilities', () => {
    const result = MutationDefinitionSchema.safeParse(
      mutationWith((mutation) => {
        mutation.rawCommand = 'move player'
      }),
    )
    expect(result.success).toBe(false)
  })
})

describe('agent and player boundaries', () => {
  it('keeps commands typed and source-code free', () => {
    const command: PlayerCommand = { type: 'dash', direction: { x: 1, y: 0 } }
    expect(PlayerCommandSchema.parse(command)).toEqual(command)
    expect(
      PlayerCommandSchema.safeParse({ type: 'eval', source: 'process.exit()' })
        .success,
    ).toBe(false)
  })

  it('requires proposal and mutation authors to agree', () => {
    const result = MutationProposalSchema.safeParse({
      proposalId: 'proposal-1',
      requestId: 'request-1',
      author: 'architect',
      mutation: debtCollectorMutationFixture,
      summary: 'Adds measured pursuit pressure.',
      expectedImpact: 'Encourages the player to bank cores promptly.',
    })
    expect(result.success).toBe(false)
  })

  it('parses compact telemetry and retained director context', () => {
    const telemetry = RunTelemetrySchema.parse({
      matchId: 'match-ff-042',
      patchIndex: 1,
      elapsedMs: 20_000,
      health: 84,
      coresHeld: 1,
      coresBanked: 2,
      primaryObjectiveProgress: 2 / 3,
      recentDamage: 16,
      recentDeaths: 0,
      routeRepetition: 0.7,
      lowRiskCoreRate: 0.75,
      highRiskCoreRate: 0.25,
      activeMutationIds: [],
      recentPatchOutcomes: [],
      challengeTrend: 'too_easy',
    })
    const context = MatchDirectorContextSchema.parse({
      version: 1,
      matchId: telemetry.matchId,
      patchIndex: telemetry.patchIndex,
      updatedAtMs: telemetry.elapsedMs,
      telemetry,
      remainingDifficultyBudget: 3,
      recentMutationIds: [],
      rejectedConceptIds: ['route-blocker'],
    })
    expect(context.telemetry.challengeTrend).toBe('too_easy')
  })

  it('prevents one persona request from receiving another persona history', () => {
    const telemetry = RunTelemetrySchema.parse({
      matchId: 'match-ff-042',
      patchIndex: 1,
      elapsedMs: 20_000,
      health: 84,
      coresHeld: 1,
      coresBanked: 2,
      primaryObjectiveProgress: 2 / 3,
      recentDamage: 16,
      recentDeaths: 0,
      routeRepetition: 0.7,
      lowRiskCoreRate: 0.75,
      highRiskCoreRate: 0.25,
      activeMutationIds: [],
      recentPatchOutcomes: [],
      challengeTrend: 'too_easy',
    })
    const directorContext = MatchDirectorContextSchema.parse({
      version: 1,
      matchId: telemetry.matchId,
      patchIndex: telemetry.patchIndex,
      updatedAtMs: telemetry.elapsedMs,
      telemetry,
      remainingDifficultyBudget: 3,
      recentMutationIds: [],
      rejectedConceptIds: [],
    })
    const request = {
      requestId: 'request-1',
      persona: 'gremlin',
      requestedAtMs: 20_000,
      deadlineMs: 5_000,
      context: directorContext,
      capabilities: MUTATION_CAPABILITIES,
      priorProposals: [
        {
          proposalId: 'proposal-old',
          mutationId: 'safe-bridge',
          persona: 'architect',
          patchIndex: 0,
          result: 'rejected',
          note: 'Not this persona history.',
        },
      ],
    }
    expect(GameMasterRequestSchema.safeParse(request).success).toBe(false)
  })

  it('represents provider failure and validation rejection as typed data', () => {
    expect(
      ProposalResultSchema.safeParse({
        status: 'failed',
        requestId: 'request-1',
        latencyMs: 5_000,
        error: { code: 'timeout', message: 'Proposal deadline elapsed.' },
      }).success,
    ).toBe(true)

    expect(
      ValidationResultSchema.safeParse({
        valid: false,
        proposalId: 'proposal-1',
        checks: [
          {
            gate: 'invariant',
            status: 'failed',
            message: 'Extraction is not reachable.',
          },
        ],
        reasons: [
          {
            code: 'extraction_blocked',
            message: 'Extraction is not reachable.',
            path: ['mutation'],
          },
        ],
      }).success,
    ).toBe(true)
  })
})
