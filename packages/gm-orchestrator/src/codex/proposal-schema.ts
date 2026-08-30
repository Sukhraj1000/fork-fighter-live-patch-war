import { MutationProposalSchema } from '@fork-fighter/contracts'
import { z } from 'zod'

export type MutationProposalJsonSchema = Readonly<Record<string, unknown>>

let cachedSchema: MutationProposalJsonSchema | undefined

/**
 * The schema sent to Codex is generated from the frozen runtime contract. The
 * server still parses the result with Zod because JSON Schema cannot represent
 * every cross-field refinement in the contract.
 */
export function mutationProposalJsonSchema(): MutationProposalJsonSchema {
  cachedSchema ??= Object.freeze({
    ...z.toJSONSchema(MutationProposalSchema, {
      target: 'draft-7',
      unrepresentable: 'any',
    }),
    $id: 'https://fork-fighter.dev/schemas/mutation-proposal.v1.json',
    title: 'Fork Fighter MutationProposal',
  })

  return cachedSchema
}
