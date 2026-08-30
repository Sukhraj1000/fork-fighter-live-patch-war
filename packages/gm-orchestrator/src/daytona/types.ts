import type { GameMasterPersona } from '@fork-fighter/contracts'

export const DAYTONA_WORKER_ROOT = '/opt/fork-fighter-worker'
export const DAYTONA_WORKER_HEALTH_COMMAND = './bin/test-worker'
export const DAYTONA_WORKER_PROPOSAL_COMMAND = './bin/propose'

export interface DaytonaWorkerScope {
  readonly matchId: string
  readonly persona: GameMasterPersona
  readonly snapshotName: string
  /** Name of an opaque Daytona organization secret, never its value. */
  readonly codexSecretName: string
  readonly ttlMinutes: number
}

export interface WorkerCommandResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr?: string
}

/** The deliberately narrow host-side surface exposed by a worker sandbox. */
export interface DaytonaWorkerSandbox {
  readonly id: string
  writeFile(path: string, contents: string): Promise<void>
  readFile(path: string): Promise<string>
  execute(command: string, timeoutMs: number): Promise<WorkerCommandResult>
  destroy(): Promise<void>
}

export interface DaytonaWorkerProvider {
  claim(scope: DaytonaWorkerScope): Promise<DaytonaWorkerSandbox | undefined>
  create(scope: DaytonaWorkerScope): Promise<DaytonaWorkerSandbox>
}

export type DaytonaWorkerObservation =
  | {
      readonly type: 'worker_ready' | 'worker_recovered'
      readonly matchId: string
      readonly persona: GameMasterPersona
      readonly sandboxId: string
      readonly latencyMs: number
    }
  | {
      readonly type: 'proposal_observed'
      readonly matchId: string
      readonly persona: GameMasterPersona
      readonly requestId: string
      readonly sandboxId?: string
      readonly status: 'succeeded' | 'failed'
      /** Includes Codex generation and the worker-side proposal test. */
      readonly latencyMs: number
      readonly recovered: boolean
    }

export type DaytonaWorkerObserver = (
  observation: DaytonaWorkerObservation,
) => void
