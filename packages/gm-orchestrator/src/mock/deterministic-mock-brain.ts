import {
  GameMasterRequestSchema,
  type GameMasterPersona,
  type GameMasterRequest,
  type MutationProposal,
} from '@fork-fighter/contracts'

import {
  ProviderUnavailableError,
  type AgentBrain,
} from '../brain/agent-brain.js'

export interface DeterministicMockBrainOptions {
  readonly delayMs?: number
  readonly unavailable?: boolean
  readonly onRequest?: (request: GameMasterRequest) => void
}

export type MockProposalStrategy = (
  request: GameMasterRequest,
) => MutationProposal

export class DeterministicMockBrain implements AgentBrain {
  readonly persona: GameMasterPersona

  readonly #strategy: MockProposalStrategy
  readonly #delayMs: number
  readonly #unavailable: boolean
  readonly #onRequest: ((request: GameMasterRequest) => void) | undefined

  constructor(
    persona: GameMasterPersona,
    strategy: MockProposalStrategy,
    options: DeterministicMockBrainOptions = {},
  ) {
    if (
      options.delayMs !== undefined &&
      (!Number.isInteger(options.delayMs) || options.delayMs < 0)
    ) {
      throw new TypeError('Mock brain delayMs must be a non-negative integer.')
    }

    this.persona = persona
    this.#strategy = strategy
    this.#delayMs = options.delayMs ?? 0
    this.#unavailable = options.unavailable ?? false
    this.#onRequest = options.onRequest
  }

  async propose(untrustedRequest: GameMasterRequest): Promise<MutationProposal> {
    const request = GameMasterRequestSchema.parse(untrustedRequest)
    if (request.persona !== this.persona) {
      throw new TypeError('Mock brain persona does not match the request.')
    }

    this.#onRequest?.(request)

    if (this.#delayMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, this.#delayMs)
      })
    }

    if (this.#unavailable) {
      throw new ProviderUnavailableError('Mock provider is unavailable.')
    }

    return this.#strategy(request)
  }
}
