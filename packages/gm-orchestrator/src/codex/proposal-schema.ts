import { MutationProposalSchema } from '@fork-fighter/contracts'
import { z } from 'zod'

export type MutationProposalJsonSchema = Readonly<Record<string, unknown>>

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
 * The schema sent to Codex is generated from the frozen runtime contract. The
 * server still parses the result with Zod because JSON Schema cannot represent
 * every cross-field refinement in the contract.
 */
export function mutationProposalJsonSchema(): MutationProposalJsonSchema {
  cachedSchema ??= Object.freeze({
    ...(normaliseForCodex(
      z.toJSONSchema(MutationProposalSchema, {
        target: 'draft-7',
        unrepresentable: 'any',
      }),
    ) as Record<string, unknown>),
    $id: 'https://fork-fighter.dev/schemas/mutation-proposal.v1.json',
    title: 'Fork Fighter MutationProposal',
  })

  return cachedSchema
}
