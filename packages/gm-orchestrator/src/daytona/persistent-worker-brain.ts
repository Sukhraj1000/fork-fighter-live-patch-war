import {
  GameMasterRequestSchema,
  type GameMasterPersona,
  type GameMasterRequest,
} from '@fork-fighter/contracts'

import {
  ProviderUnavailableError,
  type AgentBrain,
} from '../brain/agent-brain.js'
import {
  buildCodexProposalPrompt,
  mutationProposalJsonSchema,
  ScopedProposalGateway,
} from '../codex/index.js'
import {
  DAYTONA_WORKER_HEALTH_COMMAND,
  DAYTONA_WORKER_PROPOSAL_COMMAND,
  DAYTONA_WORKER_ROOT,
  type DaytonaWorkerObserver,
  type DaytonaWorkerProvider,
  type DaytonaWorkerSandbox,
  type DaytonaWorkerScope,
} from './types.js'

const CONTRACT_PATH = `${DAYTONA_WORKER_ROOT}/contract/mutation-proposal.schema.json`
const REQUEST_PATH = `${DAYTONA_WORKER_ROOT}/runtime/request.json`
const PROMPT_PATH = `${DAYTONA_WORKER_ROOT}/runtime/prompt.txt`
const PROPOSAL_PATH = `${DAYTONA_WORKER_ROOT}/runtime/proposal.json`
const MAX_PROPOSAL_BYTES = 128 * 1024

export interface PersistentDaytonaBrainOptions {
  readonly scope: DaytonaWorkerScope
  readonly provider: DaytonaWorkerProvider
  readonly gateway: ScopedProposalGateway
  readonly startupTimeoutMs: number
  readonly now?: () => number
  readonly observe?: DaytonaWorkerObserver
}

export interface WorkerReadiness {
  readonly status: 'ready' | 'unavailable'
  readonly sandboxId?: string
}

/**
 * One long-lived Daytona worker bound to exactly one game-master persona.
 * Canonical context is replayed from each request, so sandbox-local memory is
 * convenient but never authoritative.
 */
export class PersistentDaytonaBrain implements AgentBrain {
  readonly persona: GameMasterPersona

  readonly #scope: DaytonaWorkerScope
  readonly #provider: DaytonaWorkerProvider
  readonly #gateway: ScopedProposalGateway
  readonly #startupTimeoutMs: number
  readonly #now: () => number
  readonly #observeCallback: DaytonaWorkerObserver | undefined

  #worker: DaytonaWorkerSandbox | undefined
  #starting: Promise<DaytonaWorkerSandbox> | undefined
  #inFlight = false
  #closed = false

  constructor(options: PersistentDaytonaBrainOptions) {
    this.persona = options.scope.persona
    this.#scope = options.scope
    this.#provider = options.provider
    this.#gateway = options.gateway
    this.#startupTimeoutMs = options.startupTimeoutMs
    this.#now = options.now ?? Date.now
    this.#observeCallback = options.observe
  }

  get sandboxId(): string | undefined {
    return this.#worker?.id
  }

  async warm(): Promise<WorkerReadiness> {
    try {
      const worker = await this.#ensureWorker(true, this.#startupTimeoutMs)
      return { status: 'ready', sandboxId: worker.id }
    } catch {
      return { status: 'unavailable' }
    }
  }

  async propose(untrustedRequest: GameMasterRequest): Promise<unknown> {
    const request = GameMasterRequestSchema.parse(untrustedRequest)
    if (request.persona !== this.persona || this.#closed || this.#inFlight) {
      return undefined
    }

    this.#inFlight = true
    const startedAt = this.#now()
    const deadlineAt = startedAt + request.deadlineMs
    const grant = this.#gateway.issue(request, deadlineAt)
    let recovered = false

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const remainingMs = deadlineAt - this.#now()
          if (remainingMs <= 0) {
            return undefined
          }
          const worker =
            attempt === 0
              ? await this.#ensureWorker(true, remainingMs)
              : await this.#replaceWorker(remainingMs)
          recovered = attempt > 0

          const response = await this.#runCycle(worker, request, deadlineAt)
          const proposal = this.#gateway.submit(grant, response, this.#now())
          this.#observe({
            type: 'proposal_observed',
            matchId: this.#scope.matchId,
            persona: this.persona,
            requestId: request.requestId,
            sandboxId: worker.id,
            status: proposal === undefined ? 'failed' : 'succeeded',
            latencyMs: this.#elapsed(startedAt),
            recovered,
          })
          return proposal
        } catch {
          if (attempt === 0 && this.#now() < deadlineAt) {
            continue
          }
        }
      }

      this.#observe({
        type: 'proposal_observed',
        matchId: this.#scope.matchId,
        persona: this.persona,
        requestId: request.requestId,
        sandboxId: this.#worker?.id,
        status: 'failed',
        latencyMs: this.#elapsed(startedAt),
        recovered,
      })
      throw new ProviderUnavailableError('Persistent game-master worker unavailable.')
    } finally {
      this.#gateway.revoke(grant)
      this.#inFlight = false
    }
  }

  async close(): Promise<void> {
    this.#closed = true
    await this.#starting?.catch(() => undefined)
    const worker = this.#worker
    this.#worker = undefined
    if (worker !== undefined) {
      await worker.destroy().catch(() => undefined)
    }
  }

  async #ensureWorker(
    claimExisting: boolean,
    timeoutMs: number,
  ): Promise<DaytonaWorkerSandbox> {
    if (this.#closed) {
      throw new ProviderUnavailableError('Game-master worker is closed.')
    }
    if (this.#worker !== undefined) {
      return this.#worker
    }
    if (this.#starting !== undefined) {
      return this.#starting
    }

    this.#starting = this.#acquireWorker(claimExisting, timeoutMs)
    try {
      return await this.#starting
    } finally {
      this.#starting = undefined
    }
  }

  async #acquireWorker(
    claimExisting: boolean,
    timeoutMs: number,
  ): Promise<DaytonaWorkerSandbox> {
    const startedAt = this.#now()
    let worker = claimExisting
      ? await this.#provider.claim(this.#scope)
      : undefined
    worker ??= await this.#provider.create(this.#scope)

    try {
      await this.#prepareWorker(worker, timeoutMs)
      if (this.#closed) {
        throw new ProviderUnavailableError('Game-master worker is closed.')
      }
      this.#worker = worker
      this.#observe({
        type: claimExisting ? 'worker_ready' : 'worker_recovered',
        matchId: this.#scope.matchId,
        persona: this.persona,
        sandboxId: worker.id,
        latencyMs: this.#elapsed(startedAt),
      })
      return worker
    } catch (error) {
      await worker.destroy().catch(() => undefined)
      throw error
    }
  }

  async #replaceWorker(timeoutMs: number): Promise<DaytonaWorkerSandbox> {
    const previous = this.#worker
    this.#worker = undefined
    if (previous !== undefined) {
      void previous.destroy().catch(() => undefined)
    }
    return this.#ensureWorker(false, timeoutMs)
  }

  async #prepareWorker(
    worker: DaytonaWorkerSandbox,
    timeoutMs: number,
  ): Promise<void> {
    await worker.writeFile(
      CONTRACT_PATH,
      JSON.stringify(mutationProposalJsonSchema()),
    )
    const health = await worker.execute(
      DAYTONA_WORKER_HEALTH_COMMAND,
      Math.max(1, Math.min(timeoutMs, this.#startupTimeoutMs)),
    )
    if (health.exitCode !== 0) {
      throw new ProviderUnavailableError('Game-master worker image check failed.')
    }
  }

  async #runCycle(
    worker: DaytonaWorkerSandbox,
    request: GameMasterRequest,
    deadlineAt: number,
  ): Promise<unknown> {
    await Promise.all([
      worker.writeFile(REQUEST_PATH, JSON.stringify(request)),
      worker.writeFile(PROMPT_PATH, buildCodexProposalPrompt(request)),
    ])

    const remainingMs = deadlineAt - this.#now()
    if (remainingMs <= 0) {
      return undefined
    }
    const execution = await worker.execute(
      DAYTONA_WORKER_PROPOSAL_COMMAND,
      remainingMs,
    )
    if (execution.exitCode !== 0) {
      throw new ProviderUnavailableError('Codex proposal command failed.')
    }

    const contents = await worker.readFile(PROPOSAL_PATH)
    if (Buffer.byteLength(contents, 'utf8') > MAX_PROPOSAL_BYTES) {
      return undefined
    }
    try {
      return JSON.parse(contents) as unknown
    } catch {
      return undefined
    }
  }

  #elapsed(startedAt: number): number {
    return Math.max(0, Math.round(this.#now() - startedAt))
  }

  #observe(observation: Parameters<DaytonaWorkerObserver>[0]): void {
    try {
      this.#observeCallback?.(observation)
    } catch {
      // Observability must never interrupt a proposal cycle.
    }
  }
}
