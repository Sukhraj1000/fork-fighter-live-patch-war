import {
  GameMasterRequestSchema,
  MUTATION_CAPABILITIES,
  MatchDirectorContextSchema,
  type GameMasterRequest,
  type MatchDirectorContext,
  type ProposalHistoryEntry,
} from '@fork-fighter/contracts'

import { GAME_MASTER_PERSONAS, type PersonaRecord } from '../personas/index.js'

export interface GameMasterRequestBatchInput {
  readonly context: MatchDirectorContext
  readonly requestedAtMs: number
  readonly deadlineMs: number
  readonly proposalHistory?: readonly ProposalHistoryEntry[]
}

export type GameMasterRequests = PersonaRecord<GameMasterRequest>

function requestIdFor(
  persona: (typeof GAME_MASTER_PERSONAS)[number],
  context: MatchDirectorContext,
  requestedAtMs: number,
): string {
  return [
    'gm',
    context.patchIndex.toString(36),
    requestedAtMs.toString(36),
    persona,
  ].join(':')
}

export function createGameMasterRequests(
  input: GameMasterRequestBatchInput,
): GameMasterRequests {
  const context = MatchDirectorContextSchema.parse(input.context)
  const history = input.proposalHistory ?? []

  const requests = GAME_MASTER_PERSONAS.map((persona) => {
    const priorProposals = history
      .filter((entry) => entry.persona === persona)
      .slice(-8)

    return [
      persona,
      GameMasterRequestSchema.parse({
        requestId: requestIdFor(persona, context, input.requestedAtMs),
        persona,
        requestedAtMs: input.requestedAtMs,
        deadlineMs: input.deadlineMs,
        context,
        capabilities: MUTATION_CAPABILITIES,
        priorProposals,
      }),
    ] as const
  })

  return Object.fromEntries(requests) as GameMasterRequests
}
