import type {
  GameMasterPersona,
  GameMasterRequest,
} from '@fork-fighter/contracts'
import {
  DaytonaGameMasterPool,
  createDaytonaSdkWorkerProvider,
  type AgentBrain,
  type DaytonaWorkerProvider,
  type GameMasterBrains,
} from '@fork-fighter/gm-orchestrator'

export interface PersistentDaytonaBrainsOptions {
  snapshotName: string
  codexSecretName: string
  provider?: DaytonaWorkerProvider
  ttlMinutes?: number
  startupTimeoutMs?: number
}

interface PoolEntry {
  pool: DaytonaGameMasterPool
  ready: Promise<void>
}

/**
 * MatchHost exposes one AgentBrain per persona, while Daytona workers are
 * match-scoped. This registry bridges those lifetimes: the first proposal for
 * a match warms one issue-#9 pool, and later patch cycles reuse the same three
 * private workers.
 */
class MatchScopedDaytonaRegistry {
  readonly #options: PersistentDaytonaBrainsOptions
  readonly #provider: DaytonaWorkerProvider
  readonly #pools = new Map<string, PoolEntry>()
  #closed = false
  #closePromise: Promise<void> | undefined

  constructor(options: PersistentDaytonaBrainsOptions) {
    this.#options = options
    this.#provider = options.provider ?? createDaytonaSdkWorkerProvider()
  }

  async propose(
    persona: GameMasterPersona,
    request: GameMasterRequest,
  ): Promise<unknown> {
    if (this.#closed) return undefined
    if (request.persona !== persona) return undefined

    const entry = this.#pool(request.context.matchId)
    void entry.ready
    return entry.pool.brains[persona].propose(request)
  }

  close(): Promise<void> {
    this.#closed = true
    this.#closePromise ??= Promise.all(
      [...this.#pools.values()].map(({ pool }) => pool.close()),
    ).then(() => undefined)
    return this.#closePromise
  }

  #pool(matchId: string): PoolEntry {
    const existing = this.#pools.get(matchId)
    if (existing) return existing

    const pool = new DaytonaGameMasterPool({
      matchId,
      snapshotName: this.#options.snapshotName,
      codexSecretName: this.#options.codexSecretName,
      provider: this.#provider,
      ...(this.#options.ttlMinutes === undefined
        ? {}
        : { ttlMinutes: this.#options.ttlMinutes }),
      ...(this.#options.startupTimeoutMs === undefined
        ? {}
        : { startupTimeoutMs: this.#options.startupTimeoutMs }),
    })
    const entry: PoolEntry = {
      pool,
      ready: pool.start().then(() => undefined),
    }
    this.#pools.set(matchId, entry)
    return entry
  }
}

class MatchScopedDaytonaBrain implements AgentBrain {
  readonly persona: GameMasterPersona
  readonly #registry: MatchScopedDaytonaRegistry

  constructor(
    persona: GameMasterPersona,
    registry: MatchScopedDaytonaRegistry,
  ) {
    this.persona = persona
    this.#registry = registry
  }

  propose(request: GameMasterRequest): Promise<unknown> {
    return this.#registry.propose(this.persona, request)
  }

  close(): Promise<void> {
    return this.#registry.close()
  }
}

export function createPersistentDaytonaBrains(
  options: PersistentDaytonaBrainsOptions,
): GameMasterBrains {
  const registry = new MatchScopedDaytonaRegistry(options)
  return {
    architect: new MatchScopedDaytonaBrain('architect', registry),
    gremlin: new MatchScopedDaytonaBrain('gremlin', registry),
    auditor: new MatchScopedDaytonaBrain('auditor', registry),
  }
}
