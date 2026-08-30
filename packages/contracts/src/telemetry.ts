import { z } from 'zod'

import { GameMasterPersonaSchema } from './mutation.js'
import {
  FiniteNumberSchema,
  IdentifierSchema,
  NonNegativeIntegerSchema,
  UnitIntervalSchema,
} from './primitives.js'

export const ChallengeTrendSchema = z.enum([
  'too_easy',
  'on_target',
  'too_hard',
])

export const PatchOutcomeStatusSchema = z.enum([
  'expired',
  'completed',
  'cancelled',
])

export const PatchOutcomeSchema = z
  .object({
    mutationId: IdentifierSchema,
    patchIndex: NonNegativeIntegerSchema,
    author: GameMasterPersonaSchema,
    status: PatchOutcomeStatusSchema,
    activatedAtMs: NonNegativeIntegerSchema,
    endedAtMs: NonNegativeIntegerSchema,
    triggerActivations: NonNegativeIntegerSchema,
    entitiesSpawned: NonNegativeIntegerSchema,
    entitiesCleaned: NonNegativeIntegerSchema,
    healthDelta: z.number().int().min(-10_000).max(10_000),
    coresBankedDelta: z.number().int().min(-100).max(100),
    scoreDelta: z.number().int().min(-100_000_000).max(100_000_000),
    challengeTrend: ChallengeTrendSchema,
  })
  .strict()
  .superRefine((outcome, context) => {
    if (outcome.endedAtMs < outcome.activatedAtMs) {
      context.addIssue({
        code: 'custom',
        message: 'endedAtMs cannot precede activatedAtMs',
        path: ['endedAtMs'],
      })
    }
  })

export const RunTelemetrySchema = z
  .object({
    matchId: IdentifierSchema,
    patchIndex: NonNegativeIntegerSchema,
    elapsedMs: NonNegativeIntegerSchema,
    health: NonNegativeIntegerSchema.max(10_000),
    coresHeld: NonNegativeIntegerSchema.max(100),
    coresBanked: NonNegativeIntegerSchema.max(100),
    primaryObjectiveProgress: UnitIntervalSchema,
    recentDamage: NonNegativeIntegerSchema.max(100_000),
    recentDeaths: NonNegativeIntegerSchema,
    routeRepetition: UnitIntervalSchema,
    lowRiskCoreRate: UnitIntervalSchema,
    highRiskCoreRate: UnitIntervalSchema,
    activeMutationIds: z.array(IdentifierSchema).max(16),
    recentPatchOutcomes: z.array(PatchOutcomeSchema).max(12),
    challengeTrend: ChallengeTrendSchema,
  })
  .strict()
  .superRefine((telemetry, context) => {
    const totalRate = telemetry.lowRiskCoreRate + telemetry.highRiskCoreRate
    if (totalRate > 1.000_001) {
      context.addIssue({
        code: 'custom',
        message: 'Low-risk and high-risk core rates cannot total more than 1',
        path: ['highRiskCoreRate'],
      })
    }
  })

export const MatchDirectorContextSchema = z
  .object({
    version: z.literal(1),
    matchId: IdentifierSchema,
    patchIndex: NonNegativeIntegerSchema,
    updatedAtMs: NonNegativeIntegerSchema,
    telemetry: RunTelemetrySchema,
    remainingDifficultyBudget: FiniteNumberSchema.min(0).max(20),
    recentMutationIds: z.array(IdentifierSchema).max(16),
    rejectedConceptIds: z.array(IdentifierSchema).max(16),
  })
  .strict()
  .superRefine((directorContext, context) => {
    if (directorContext.matchId !== directorContext.telemetry.matchId) {
      context.addIssue({
        code: 'custom',
        message: 'Context and telemetry match ids must agree',
        path: ['telemetry', 'matchId'],
      })
    }
    if (directorContext.patchIndex !== directorContext.telemetry.patchIndex) {
      context.addIssue({
        code: 'custom',
        message: 'Context and telemetry patch indexes must agree',
        path: ['telemetry', 'patchIndex'],
      })
    }
  })

export type ChallengeTrend = z.infer<typeof ChallengeTrendSchema>
export type PatchOutcomeStatus = z.infer<typeof PatchOutcomeStatusSchema>
export type PatchOutcome = z.infer<typeof PatchOutcomeSchema>
export type RunTelemetry = z.infer<typeof RunTelemetrySchema>
export type MatchDirectorContext = z.infer<typeof MatchDirectorContextSchema>
