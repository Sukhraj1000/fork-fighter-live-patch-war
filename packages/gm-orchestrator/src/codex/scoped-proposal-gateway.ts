import { randomUUID } from 'node:crypto'

import {
  GameMasterRequestSchema,
  MutationProposalSchema,
  type GameMasterRequest,
  type MutationProposal,
} from '@fork-fighter/contracts'

export interface ProposalGrant {
  readonly id: string
  readonly requestId: string
  readonly expiresAtMs: number
}

interface StoredGrant extends ProposalGrant {
  readonly persona: GameMasterRequest['persona']
}

/** Converts Codex's required-but-null optional fields back to Zod optionals. */
function removeNullFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeNullFields)
  if (typeof value !== 'object' || value === null) return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== null)
      .map(([key, entry]) => [key, removeNullFields(entry)]),
  )
}

/**
 * A one-use, server-owned delivery boundary. It exposes no game commands or
 * state mutation methods: the only accepted value is the proposal matching the
 * grant's request and persona.
 */
export class ScopedProposalGateway {
  readonly #grants = new Map<string, StoredGrant>()

  issue(
    untrustedRequest: GameMasterRequest,
    expiresAtMs: number,
  ): ProposalGrant {
    const request = GameMasterRequestSchema.parse(untrustedRequest)
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs < 0) {
      throw new TypeError('Proposal grant expiry must be a non-negative integer.')
    }

    const grant: StoredGrant = {
      id: randomUUID(),
      requestId: request.requestId,
      persona: request.persona,
      expiresAtMs,
    }
    this.#grants.set(grant.id, grant)
    return grant
  }

  /**
   * Consumes the grant before parsing, so malformed or replayed submissions do
   * not get another attempt. Undefined is intentionally returned to the normal
   * AgentBrain response validator as an invalid response.
   */
  submit(
    grant: ProposalGrant,
    response: unknown,
    observedAtMs: number,
  ): MutationProposal | undefined {
    const stored = this.#grants.get(grant.id)
    this.#grants.delete(grant.id)
    if (
      stored === undefined ||
      stored.requestId !== grant.requestId ||
      stored.expiresAtMs !== grant.expiresAtMs ||
      !Number.isFinite(observedAtMs) ||
      observedAtMs < 0 ||
      observedAtMs > stored.expiresAtMs
    ) {
      return undefined
    }

    const parsed = MutationProposalSchema.safeParse(removeNullFields(response))
    if (
      !parsed.success ||
      parsed.data.requestId !== stored.requestId ||
      parsed.data.author !== stored.persona
    ) {
      return undefined
    }

    return parsed.data
  }

  revoke(grant: ProposalGrant): void {
    this.#grants.delete(grant.id)
  }
}
