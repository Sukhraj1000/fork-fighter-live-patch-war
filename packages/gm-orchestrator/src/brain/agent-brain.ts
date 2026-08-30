import type { GameMasterRequest } from '@fork-fighter/contracts'

/**
 * The provider-independent boundary for any local, hosted, or sandboxed agent.
 * Responses remain unknown until the proposal runner validates them.
 */
export interface AgentBrain {
  propose(request: GameMasterRequest): Promise<unknown>
}

/** A provider adapter may use this error to make unavailability explicit. */
export class ProviderUnavailableError extends Error {
  override readonly name = 'ProviderUnavailableError'
}
