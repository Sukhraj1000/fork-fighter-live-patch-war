import {
  MutationProposalSchema,
  type MutationProposal,
  type ValidationResult,
} from '@fork-fighter/contracts'

import { stableSerialize } from './mechanics.js'
import type {
  MutationSelectionInput,
  MutationSelectionResult,
} from './types.js'
import { validateMutationProposal } from './validator.js'

function candidateIdentifier(candidate: unknown): string {
  if (typeof candidate !== 'object' || candidate === null) return ''
  const proposalId = (candidate as Record<string, unknown>).proposalId
  return typeof proposalId === 'string' ? proposalId : ''
}

export function selectMutationProposal(
  input: MutationSelectionInput,
): MutationSelectionResult {
  const orderedCandidates = input.candidates
    .map((candidate) => ({ candidate, canonical: stableSerialize(candidate) }))
    .sort(
      (first, second) =>
        candidateIdentifier(first.candidate).localeCompare(
          candidateIdentifier(second.candidate),
        ) || first.canonical.localeCompare(second.canonical),
    )
  const evaluated = orderedCandidates.map((entry) => ({
    ...entry,
    validation: validateMutationProposal({
      proposal: entry.candidate,
      context: input.context,
      gameState: input.gameState,
      recentMechanicKeys: input.recentMechanicKeys,
      policy: input.policy,
      simulationAdapter: input.simulationAdapter,
    }),
  }))
  const valid = evaluated
    .filter(
      (
        entry,
      ): entry is typeof entry & {
        validation: Extract<ValidationResult, { valid: true }>
      } => entry.validation.valid,
    )
    .map((entry) => {
      const parsed = MutationProposalSchema.safeParse(entry.candidate)
      return parsed.success ? { ...entry, proposal: parsed.data } : null
    })
    .filter(
      (
        entry,
      ): entry is {
        candidate: unknown
        canonical: string
        validation: Extract<ValidationResult, { valid: true }>
        proposal: MutationProposal
      } => entry !== null,
    )
    .sort(
      (first, second) =>
        second.validation.score - first.validation.score ||
        first.proposal.proposalId.localeCompare(second.proposal.proposalId) ||
        first.proposal.mutation.id.localeCompare(second.proposal.mutation.id) ||
        first.canonical.localeCompare(second.canonical),
    )
  const winner = valid[0]

  return {
    selected: winner?.proposal ?? null,
    selectedValidation: winner?.validation ?? null,
    validations: evaluated.map(({ validation }) => validation),
  }
}

export const selectProposal = selectMutationProposal
