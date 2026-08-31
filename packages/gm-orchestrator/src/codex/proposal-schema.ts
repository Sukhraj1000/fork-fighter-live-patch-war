import {
  ConfigureRunnerEffectSchema,
  GameMasterPersonaSchema,
  IdentifierSchema,
  SpawnRunnerHazardEffectSchema,
} from '@fork-fighter/contracts'
import { z } from 'zod'

export type MutationProposalJsonSchema = Readonly<Record<string, unknown>>

const RunnerEffectSchema = z.discriminatedUnion('type', [
  ConfigureRunnerEffectSchema,
  SpawnRunnerHazardEffectSchema,
])
const runnerEffects = z.array(RunnerEffectSchema).min(1).max(2)

const RunnerTriggerSchema = z
  .object({
    id: IdentifierSchema,
    type: z.literal('onActivation'),
    effects: runnerEffects,
  })
  .strict()

const RunnerCleanupSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('removeEntitiesByTag'),
      tag: IdentifierSchema,
      when: z.literal('expiry'),
    })
    .strict(),
  z
    .object({
      type: z.literal('restoreRulesByTag'),
      tag: IdentifierSchema,
      when: z.literal('expiry'),
    })
    .strict(),
])

/**
 * Daytona advertises only the runner capabilities implemented by the browser.
 * A narrow output schema cuts model latency while remaining a strict subset of
 * the frozen MutationProposal contract parsed by the scoped gateway.
 */
const RunnerMutationProposalOutputSchema = z
  .object({
    proposalId: IdentifierSchema,
    requestId: IdentifierSchema,
    author: GameMasterPersonaSchema,
    mutation: z
      .object({
        id: IdentifierSchema,
        title: z.string().min(1).max(80),
        patchNote: z.string().min(1).max(200),
        author: GameMasterPersonaSchema,
        durationMs: z.number().int().min(1_000).max(20_000),
        difficultyCost: z.number().finite().positive().max(3),
        triggers: z.array(RunnerTriggerSchema).length(1),
        limits: z
          .object({
            maxTriggerActivations: z.literal(1),
            maxSpawnedEntities: z.number().int().positive().max(3),
          })
          .strict(),
        cleanup: z.array(RunnerCleanupSchema).min(1).max(2),
      })
      .strict(),
    summary: z.string().min(1).max(240),
    expectedImpact: z.string().min(1).max(240),
  })
  .strict()

let cachedSchema: MutationProposalJsonSchema | undefined

/**
 * Codex structured output accepts `anyOf` but rejects draft-7's `oneOf`.
 * It also requires every object property to be listed in `required`, so a
 * Zod-optional field becomes nullable here and is stripped before Zod parses
 * the returned proposal.
 */
function normaliseForCodex(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normaliseForCodex)
  if (typeof value !== 'object' || value === null) return value

  const source = value as Record<string, unknown>
  const normalised = Object.fromEntries(
    Object.entries(source).map(([key, entry]) => [
      key === 'oneOf' ? 'anyOf' : key,
      normaliseForCodex(entry),
    ]),
  ) as Record<string, unknown>
  const properties = normalised.properties
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    return normalised
  }

  const originalRequired = new Set(
    Array.isArray(normalised.required)
      ? normalised.required.filter((entry): entry is string => typeof entry === 'string')
      : [],
  )
  normalised.properties = Object.fromEntries(
    Object.entries(properties as Record<string, unknown>).map(([name, schema]) => [
      name,
      originalRequired.has(name)
        ? schema
        : { anyOf: [schema, { type: 'null' }] },
    ]),
  )
  normalised.required = Object.keys(normalised.properties as Record<string, unknown>)
  return normalised
}

/**
 * The server still parses returned data with the full Zod contract because JSON
 * Schema cannot represent every author, cleanup, novelty, or playability rule.
 */
export function mutationProposalJsonSchema(): MutationProposalJsonSchema {
  cachedSchema ??= Object.freeze({
    ...(normaliseForCodex(
      z.toJSONSchema(RunnerMutationProposalOutputSchema, {
        target: 'draft-7',
        unrepresentable: 'any',
      }),
    ) as Record<string, unknown>),
    $id: 'https://fork-fighter.dev/schemas/runner-mutation-proposal.v1.json',
    title: 'Fork Fighter Runner MutationProposal',
  })

  return cachedSchema
}
