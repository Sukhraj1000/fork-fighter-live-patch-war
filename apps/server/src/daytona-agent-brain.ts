import { Daytona, type Sandbox } from '@daytona/sdk'
import type {
  GameMasterPersona,
  GameMasterRequest,
} from '@fork-fighter/contracts'
import {
  GAME_MASTER_PERSONAS,
  ProviderUnavailableError,
  type AgentBrain,
  type GameMasterBrains,
} from '@fork-fighter/gm-orchestrator'

export interface DaytonaWorkerBrainOptions {
  snapshot: string
  command: string
  createTimeoutSeconds?: number
}

/**
 * Adapter for the persistent worker image owned by issue #9. The worker reads
 * one compact request from FORK_FIGHTER_REQUEST_JSON and prints exactly one
 * MutationProposal JSON object. AgentBrain still treats that output as
 * untrusted and validates it before the server can see a proposal.
 */
export class DaytonaWorkerBrain implements AgentBrain {
  readonly #daytona: Daytona
  readonly #persona: GameMasterPersona
  readonly #options: DaytonaWorkerBrainOptions
  #sandboxPromise?: Promise<Sandbox>

  constructor(
    persona: GameMasterPersona,
    options: DaytonaWorkerBrainOptions,
    daytona = new Daytona(),
  ) {
    this.#persona = persona
    this.#options = options
    this.#daytona = daytona
  }

  async propose(request: GameMasterRequest): Promise<unknown> {
    if (request.persona !== this.#persona) {
      throw new TypeError('Daytona worker persona does not match the request.')
    }

    try {
      const sandbox = await this.#sandbox()
      const response = await sandbox.process.executeCommand(
        this.#options.command,
        undefined,
        {
          FORK_FIGHTER_PERSONA: this.#persona,
          FORK_FIGHTER_REQUEST_JSON: JSON.stringify(request),
        },
        Math.max(1, Math.ceil(request.deadlineMs / 1_000)),
      )
      if (response.exitCode !== 0) {
        throw new Error('Daytona proposal worker exited unsuccessfully.')
      }
      const output = response.result.trim()
      const jsonLine = output
        .split('\n')
        .reverse()
        .find((line) => line.trim().startsWith('{'))
      if (!jsonLine) {
        throw new Error('Daytona proposal worker returned no JSON object.')
      }
      return JSON.parse(jsonLine) as unknown
    } catch {
      await this.#discardSandbox()
      throw new ProviderUnavailableError('Daytona proposal worker is unavailable.')
    }
  }

  async close(): Promise<void> {
    await this.#discardSandbox()
  }

  #sandbox(): Promise<Sandbox> {
    this.#sandboxPromise ??= this.#daytona.create(
      {
        snapshot: this.#options.snapshot,
        language: 'typescript',
        envVars: { FORK_FIGHTER_PERSONA: this.#persona },
        autoStopInterval: 15,
        autoArchiveInterval: 30,
      },
      { timeout: this.#options.createTimeoutSeconds ?? 60 },
    )
    return this.#sandboxPromise
  }

  async #discardSandbox(): Promise<void> {
    const pending = this.#sandboxPromise
    this.#sandboxPromise = undefined
    if (!pending) return
    try {
      const sandbox = await pending
      await sandbox.delete(60, true)
    } catch {
      // A missing or already-dead worker is safe to recreate on the next cycle.
    }
  }
}

export function createDaytonaWorkerBrains(
  options: DaytonaWorkerBrainOptions,
): GameMasterBrains {
  return Object.fromEntries(
    GAME_MASTER_PERSONAS.map((persona) => [
      persona,
      new DaytonaWorkerBrain(persona, options),
    ]),
  ) as unknown as GameMasterBrains
}
