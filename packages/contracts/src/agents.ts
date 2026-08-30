import { z } from 'zod'

import {
  GameMasterPersonaSchema,
  MutationCapabilityReferenceSchema,
  MutationDefinitionSchema,
} from './mutation.js'
import {
  FiniteNumberSchema,
  IdentifierSchema,
  NonNegativeIntegerSchema,
  PositiveIntegerSchema,
} from './primitives.js'
import { MatchDirectorContextSchema } from './telemetry.js'

export const ProposalHistoryEntrySchema = z
  .object({
    proposalId: IdentifierSchema,
    mutationId: IdentifierSchema,
    persona: GameMasterPersonaSchema,
    patchIndex: NonNegativeIntegerSchema,
    result: z.enum(['selected', 'rejected', 'expired']),
    note: z.string().min(1).max(200),
  })
  .strict()

export const GameMasterRequestSchema = z
  .object({
    requestId: IdentifierSchema,
    persona: GameMasterPersonaSchema,
    requestedAtMs: NonNegativeIntegerSchema,
    deadlineMs: PositiveIntegerSchema.max(20_000),
    context: MatchDirectorContextSchema,
    capabilities: MutationCapabilityReferenceSchema,
    priorProposals: z.array(ProposalHistoryEntrySchema).max(8),
  })
  .strict()
  .superRefine((request, context) => {
    request.priorProposals.forEach((proposal, index) => {
      if (proposal.persona !== request.persona) {
        context.addIssue({
          code: 'custom',
          message: 'Requests may include history only for their target persona',
          path: ['priorProposals', index, 'persona'],
        })
      }
    })
  })

export const MutationProposalSchema = z
  .object({
    proposalId: IdentifierSchema,
    requestId: IdentifierSchema,
    author: GameMasterPersonaSchema,
    mutation: MutationDefinitionSchema,
    summary: z.string().min(1).max(240),
    expectedImpact: z.string().min(1).max(240),
  })
  .strict()
  .superRefine((proposal, context) => {
    if (proposal.author !== proposal.mutation.author) {
      context.addIssue({
        code: 'custom',
        message: 'Proposal author must match mutation author',
        path: ['mutation', 'author'],
      })
    }
  })

export const ProposalFailureCodeSchema = z.enum([
  'timeout',
  'provider_unavailable',
  'invalid_response',
])

export const ProposalResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('proposed'),
      requestId: IdentifierSchema,
      latencyMs: NonNegativeIntegerSchema,
      proposal: MutationProposalSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('failed'),
      requestId: IdentifierSchema,
      latencyMs: NonNegativeIntegerSchema,
      error: z
        .object({
          code: ProposalFailureCodeSchema,
          message: z.string().min(1).max(200),
        })
        .strict(),
    })
    .strict(),
])

export const ValidationGateSchema = z.enum([
  'schema',
  'capability',
  'cleanup',
  'invariant',
  'difficulty',
  'novelty',
  'simulation',
])

export const ValidationCheckSchema = z
  .object({
    gate: ValidationGateSchema,
    status: z.enum(['passed', 'failed']),
    message: z.string().min(1).max(200),
  })
  .strict()

export const ValidationReasonSchema = z
  .object({
    code: IdentifierSchema,
    message: z.string().min(1).max(200),
    path: z.array(z.union([z.string(), NonNegativeIntegerSchema])).max(12),
  })
  .strict()

const AcceptedValidationResultSchema = z
  .object({
    valid: z.literal(true),
    proposalId: IdentifierSchema,
    score: FiniteNumberSchema,
    checks: z.array(ValidationCheckSchema).min(1).max(16),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.checks.some(({ status }) => status === 'failed')) {
      context.addIssue({
        code: 'custom',
        message: 'A valid result cannot contain failed checks',
        path: ['checks'],
      })
    }
  })

const RejectedValidationResultSchema = z
  .object({
    valid: z.literal(false),
    proposalId: IdentifierSchema,
    checks: z.array(ValidationCheckSchema).min(1).max(16),
    reasons: z.array(ValidationReasonSchema).min(1).max(16),
  })
  .strict()
  .superRefine((result, context) => {
    if (!result.checks.some(({ status }) => status === 'failed')) {
      context.addIssue({
        code: 'custom',
        message: 'A rejected result must contain a failed check',
        path: ['checks'],
      })
    }
  })

export const ValidationResultSchema = z.union([
  AcceptedValidationResultSchema,
  RejectedValidationResultSchema,
])

export type ProposalHistoryEntry = z.infer<typeof ProposalHistoryEntrySchema>
export type GameMasterRequest = z.infer<typeof GameMasterRequestSchema>
export type MutationProposal = z.infer<typeof MutationProposalSchema>
export type ProposalFailureCode = z.infer<typeof ProposalFailureCodeSchema>
export type ProposalResult = z.infer<typeof ProposalResultSchema>
export type ValidationGate = z.infer<typeof ValidationGateSchema>
export type ValidationCheck = z.infer<typeof ValidationCheckSchema>
export type ValidationReason = z.infer<typeof ValidationReasonSchema>
export type ValidationResult = z.infer<typeof ValidationResultSchema>
