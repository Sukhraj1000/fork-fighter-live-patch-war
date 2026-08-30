import type {
  ChallengeTrend,
  GameEvent,
  MatchDirectorContext,
} from '@fork-fighter/contracts'

import {
  PATCH_CYCLE_MS,
  aggregateRunTelemetry,
  type TelemetryCycleInput,
} from './telemetry.js'

export const MAX_DIFFICULTY_BUDGET = 4
export const MAX_RETAINED_MUTATION_IDS = 8
export const MAX_RETAINED_REJECTED_CONCEPT_IDS = 8

export interface AdvanceDirectorContextInput
  extends Omit<TelemetryCycleInput, 'previousTelemetry'> {
  previousContext?: MatchDirectorContext
  rejectedConceptIds?: readonly string[]
}

export type DirectorReplayCycle = Omit<
  AdvanceDirectorContextInput,
  'previousContext'
>

function uniqueTail(values: readonly string[], limit: number): string[] {
  const unique: string[] = []
  for (const value of values) {
    const existingIndex = unique.indexOf(value)
    if (existingIndex >= 0) {
      unique.splice(existingIndex, 1)
    }
    unique.push(value)
  }
  return unique.slice(-limit)
}

function activatedMutationIds(
  batches: AdvanceDirectorContextInput['batches'],
): string[] {
  const activations: Array<{
    batchIndex: number
    eventIndex: number
    event: Extract<GameEvent, { type: 'patch_activated' }>
  }> = []

  for (const batch of batches) {
    for (const [eventIndex, event] of batch.events.entries()) {
      if (event.type !== 'patch_activated') {
        continue
      }
      activations.push({
        batchIndex: batch.batchIndex,
        eventIndex,
        event,
      })
    }
  }

  return activations
    .sort(
      (left, right) =>
        left.event.atMs - right.event.atMs ||
        left.event.tick - right.event.tick ||
        left.batchIndex - right.batchIndex ||
        left.eventIndex - right.eventIndex,
    )
    .map(({ event }) => event.mutationId)
}

function roundBudget(value: number): number {
  return Number(Math.max(0, value).toFixed(2))
}

export function allocateDifficultyBudget(
  trend: ChallengeTrend,
  previousBudget?: number,
): number {
  if (previousBudget !== undefined && !Number.isFinite(previousBudget)) {
    throw new Error('previous difficulty budget must be finite')
  }
  if (trend === 'too_hard') {
    return 0
  }
  if (trend === 'on_target') {
    return roundBudget(Math.min(1.25, (previousBudget ?? 0.75) + 0.25))
  }
  return roundBudget(
    Math.min(MAX_DIFFICULTY_BUDGET, (previousBudget ?? 0.5) + 1.5),
  )
}

export function isPatchCycleDue(
  elapsedMs: number,
  context?: MatchDirectorContext,
): boolean {
  return elapsedMs - (context?.updatedAtMs ?? 0) >= PATCH_CYCLE_MS
}

export function advanceDirectorContext(
  input: AdvanceDirectorContextInput,
): MatchDirectorContext {
  const previous = input.previousContext
  if (previous !== undefined) {
    if (previous.matchId !== input.matchId) {
      throw new Error('director context belongs to a different match')
    }
    if (input.patchIndex !== previous.patchIndex + 1) {
      throw new Error(
        `patch index ${input.patchIndex} does not follow ${previous.patchIndex}`,
      )
    }
    if (input.state.elapsedMs < previous.updatedAtMs) {
      throw new Error('director context time cannot move backwards')
    }
    if (
      input.batches.some(({ events }) =>
        events.some(({ atMs }) => atMs < previous.updatedAtMs),
      )
    ) {
      throw new Error('director cycle contains an event from a prior cycle')
    }
  }

  const telemetry = aggregateRunTelemetry({
    ...input,
    previousTelemetry: previous?.telemetry,
  })
  const recentMutationIds = uniqueTail(
    [
      ...(previous?.recentMutationIds ?? []),
      ...activatedMutationIds(input.batches),
    ],
    MAX_RETAINED_MUTATION_IDS,
  )
  const rejectedConceptIds = uniqueTail(
    [
      ...(previous?.rejectedConceptIds ?? []),
      ...(input.rejectedConceptIds ?? []),
    ],
    MAX_RETAINED_REJECTED_CONCEPT_IDS,
  )

  return {
    version: 1,
    matchId: input.matchId,
    patchIndex: input.patchIndex,
    updatedAtMs: input.state.elapsedMs,
    telemetry,
    remainingDifficultyBudget: allocateDifficultyBudget(
      telemetry.challengeTrend,
      previous?.remainingDifficultyBudget,
    ),
    recentMutationIds,
    rejectedConceptIds,
  }
}

export function replayDirectorContext(
  cycles: readonly DirectorReplayCycle[],
): MatchDirectorContext {
  if (cycles.length === 0) {
    throw new Error('at least one director cycle is required')
  }

  let context: MatchDirectorContext | undefined
  for (const cycle of cycles) {
    context = advanceDirectorContext({ ...cycle, previousContext: context })
  }
  return context!
}

export function retainSelectedMutation(
  context: MatchDirectorContext,
  mutationId: string,
  difficultyCost: number,
): MatchDirectorContext {
  if (
    !Number.isFinite(difficultyCost) ||
    difficultyCost < 0 ||
    difficultyCost > context.remainingDifficultyBudget
  ) {
    throw new Error('mutation difficulty cost exceeds the remaining budget')
  }

  return {
    ...context,
    telemetry: {
      ...context.telemetry,
      activeMutationIds: [...context.telemetry.activeMutationIds],
      recentPatchOutcomes: [...context.telemetry.recentPatchOutcomes],
    },
    remainingDifficultyBudget: roundBudget(
      context.remainingDifficultyBudget - difficultyCost,
    ),
    recentMutationIds: uniqueTail(
      [...context.recentMutationIds, mutationId],
      MAX_RETAINED_MUTATION_IDS,
    ),
    rejectedConceptIds: [...context.rejectedConceptIds],
  }
}
