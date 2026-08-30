import { IdentifierSchema, type GameMasterPersona } from '@fork-fighter/contracts'

import type { GameMasterBrains } from '../brain/proposal-runner.js'
import { ScopedProposalGateway } from '../codex/index.js'
import { GAME_MASTER_PERSONAS, type PersonaRecord } from '../personas/index.js'
import {
  PersistentDaytonaBrain,
  type WorkerReadiness,
} from './persistent-worker-brain.js'
import type {
  DaytonaWorkerObserver,
  DaytonaWorkerProvider,
} from './types.js'

export interface DaytonaGameMasterPoolOptions {
  readonly matchId: string
  readonly snapshotName: string
  /** Name of the Daytona organization secret containing the Codex API key. */
  readonly codexSecretName: string
  readonly codexAuthMode?: 'api-key' | 'chatgpt'
  readonly codexAuthJson?: string
  readonly provider: DaytonaWorkerProvider
  readonly ttlMinutes?: number
  readonly startupTimeoutMs?: number
  readonly now?: () => number
  readonly observe?: DaytonaWorkerObserver
}

export type DaytonaWorkerReadiness = PersonaRecord<WorkerReadiness>

function requiredName(value: string, label: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 128) {
    throw new TypeError(`${label} must contain 1-128 characters.`)
  }
  return trimmed
}

/** Owns the three match-scoped, persistent AgentBrain implementations. */
export class DaytonaGameMasterPool {
  readonly brains: GameMasterBrains

  readonly #workers: PersonaRecord<PersistentDaytonaBrain>

  constructor(options: DaytonaGameMasterPoolOptions) {
    const matchId = IdentifierSchema.parse(options.matchId)
    const snapshotName = requiredName(options.snapshotName, 'Snapshot name')
    const codexSecretName = requiredName(
      options.codexSecretName,
      'Codex secret name',
    )
    const codexAuthMode = options.codexAuthMode ?? 'api-key'
    if (codexAuthMode === 'chatgpt') {
      const auth = options.codexAuthJson
      if (!auth) throw new TypeError('ChatGPT Codex auth JSON is required.')
      let parsed: unknown
      try {
        parsed = JSON.parse(auth)
      } catch {
        throw new TypeError('ChatGPT Codex auth JSON must be valid JSON.')
      }
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        (parsed as { auth_mode?: unknown }).auth_mode !== 'chatgpt'
      ) {
        throw new TypeError('ChatGPT Codex auth JSON must use chatgpt auth mode.')
      }
    }
    const ttlMinutes = options.ttlMinutes ?? 30
    const startupTimeoutMs = options.startupTimeoutMs ?? 20_000
    if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 120) {
      throw new TypeError('Worker ttlMinutes must be an integer from 1 to 120.')
    }
    if (
      !Number.isInteger(startupTimeoutMs) ||
      startupTimeoutMs < 1 ||
      startupTimeoutMs > 120_000
    ) {
      throw new TypeError(
        'Worker startupTimeoutMs must be an integer from 1 to 120000.',
      )
    }

    const gateway = new ScopedProposalGateway()
    this.#workers = Object.fromEntries(
      GAME_MASTER_PERSONAS.map((persona) => [
        persona,
        new PersistentDaytonaBrain({
          scope: {
            matchId,
            persona,
            snapshotName,
            codexSecretName,
            codexAuthMode,
            ...(options.codexAuthJson === undefined
              ? {}
              : { codexAuthJson: options.codexAuthJson }),
            ttlMinutes,
          },
          provider: options.provider,
          gateway,
          startupTimeoutMs,
          now: options.now,
          observe: options.observe,
        }),
      ]),
    ) as PersonaRecord<PersistentDaytonaBrain>
    this.brains = this.#workers
  }

  /** Claims or creates all three persona workers concurrently at match start. */
  async start(): Promise<DaytonaWorkerReadiness> {
    const entries = await Promise.all(
      GAME_MASTER_PERSONAS.map(async (persona) => {
        const readiness = await this.#workers[persona].warm()
        return [persona, readiness] as const
      }),
    )
    return Object.fromEntries(entries) as DaytonaWorkerReadiness
  }

  sandboxId(persona: GameMasterPersona): string | undefined {
    return this.#workers[persona].sandboxId
  }

  async close(): Promise<void> {
    await Promise.all(
      GAME_MASTER_PERSONAS.map((persona) => this.#workers[persona].close()),
    )
  }
}
