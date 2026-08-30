import { createHash, randomUUID } from 'node:crypto'

import { Daytona, type DaytonaConfig } from '@daytona/sdk'

import {
  DAYTONA_WORKER_HEALTH_COMMAND,
  DAYTONA_WORKER_PROPOSAL_COMMAND,
  DAYTONA_WORKER_ROOT,
  type DaytonaWorkerProvider,
  type DaytonaWorkerSandbox,
  type DaytonaWorkerScope,
  type WorkerCommandResult,
} from './types.js'

interface SdkExecuteResponse {
  readonly exitCode: number
  readonly result: string
}

interface SdkSandboxLike {
  readonly id: string
  readonly state?: unknown
  readonly fs: {
    uploadFile(contents: Buffer, remotePath: string): Promise<void>
    downloadFile(remotePath: string): Promise<Buffer>
  }
  readonly process: {
    executeCommand(
      command: string,
      cwd?: string,
      env?: Record<string, string>,
      timeoutSeconds?: number,
    ): Promise<SdkExecuteResponse>
  }
  start(timeoutSeconds?: number): Promise<void>
  recover(timeoutSeconds?: number): Promise<void>
  delete(timeoutSeconds?: number, wait?: boolean): Promise<void>
}

export interface DaytonaSdkClientLike {
  list(query: {
    labels: Record<string, string>
    snapshots: string[]
  }): AsyncIterableIterator<SdkSandboxLike>
  create(
    params: {
      name: string
      snapshot: string
      labels: Record<string, string>
      public: false
      autoStopInterval: 0
      ttlMinutes: number
      domainAllowList: string
      secrets: { CODEX_API_KEY: string }
    },
    options: { timeout: number },
  ): Promise<SdkSandboxLike>
}

const ALLOWED_WRITE_PATHS = new Set([
  `${DAYTONA_WORKER_ROOT}/contract/mutation-proposal.schema.json`,
  `${DAYTONA_WORKER_ROOT}/runtime/request.json`,
  `${DAYTONA_WORKER_ROOT}/runtime/prompt.txt`,
])
const PROPOSAL_PATH = `${DAYTONA_WORKER_ROOT}/runtime/proposal.json`
const ALLOWED_COMMANDS = new Set([
  DAYTONA_WORKER_HEALTH_COMMAND,
  DAYTONA_WORKER_PROPOSAL_COMMAND,
])

function labelsFor(scope: DaytonaWorkerScope): Record<string, string> {
  return {
    'fork-fighter-role': 'game-master',
    'fork-fighter-match': scope.matchId,
    'fork-fighter-persona': scope.persona,
  }
}

function workerName(scope: DaytonaWorkerScope): string {
  const matchKey = createHash('sha256')
    .update(scope.matchId)
    .digest('hex')
    .slice(0, 12)
  return `fork-fighter-${matchKey}-${scope.persona}-${randomUUID().slice(0, 8)}`
}

class DaytonaSdkWorkerSandbox implements DaytonaWorkerSandbox {
  readonly id: string
  readonly #sandbox: SdkSandboxLike

  constructor(sandbox: SdkSandboxLike) {
    this.id = sandbox.id
    this.#sandbox = sandbox
  }

  async writeFile(path: string, contents: string): Promise<void> {
    if (!ALLOWED_WRITE_PATHS.has(path)) {
      throw new TypeError('Worker write path is outside the proposal gateway.')
    }
    await this.#sandbox.fs.uploadFile(Buffer.from(contents, 'utf8'), path)
  }

  async readFile(path: string): Promise<string> {
    if (path !== PROPOSAL_PATH) {
      throw new TypeError('Workers may return only the proposal output file.')
    }
    const contents = await this.#sandbox.fs.downloadFile(path)
    return contents.toString('utf8')
  }

  async execute(command: string, timeoutMs: number): Promise<WorkerCommandResult> {
    if (!ALLOWED_COMMANDS.has(command)) {
      throw new TypeError('Worker command is outside the installed runner contract.')
    }
    const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1_000))
    const response = await this.#sandbox.process.executeCommand(
      command,
      DAYTONA_WORKER_ROOT,
      undefined,
      timeoutSeconds,
    )
    return {
      exitCode: response.exitCode,
      stdout: response.result,
    }
  }

  async destroy(): Promise<void> {
    await this.#sandbox.delete(30, true)
  }
}

/** Adapts the Daytona SDK to the narrow, testable worker lifecycle contract. */
export class DaytonaSdkWorkerProvider implements DaytonaWorkerProvider {
  readonly #client: DaytonaSdkClientLike

  constructor(client: DaytonaSdkClientLike) {
    this.#client = client
  }

  async claim(
    scope: DaytonaWorkerScope,
  ): Promise<DaytonaWorkerSandbox | undefined> {
    for await (const sandbox of this.#client.list({
      labels: labelsFor(scope),
      snapshots: [scope.snapshotName],
    })) {
      await this.#ensureStarted(sandbox)
      return new DaytonaSdkWorkerSandbox(sandbox)
    }
    return undefined
  }

  async create(scope: DaytonaWorkerScope): Promise<DaytonaWorkerSandbox> {
    const sandbox = await this.#client.create(
      {
        name: workerName(scope),
        snapshot: scope.snapshotName,
        labels: labelsFor(scope),
        public: false,
        autoStopInterval: 0,
        ttlMinutes: scope.ttlMinutes,
        domainAllowList: 'api.openai.com',
        secrets: { CODEX_API_KEY: scope.codexSecretName },
      },
      { timeout: 60 },
    )
    return new DaytonaSdkWorkerSandbox(sandbox)
  }

  async #ensureStarted(sandbox: SdkSandboxLike): Promise<void> {
    if (String(sandbox.state).toLowerCase() === 'started') {
      return
    }
    try {
      await sandbox.start(60)
    } catch {
      await sandbox.recover(60)
    }
  }
}

/** Creates the real provider; call this only from the server process. */
export function createDaytonaSdkWorkerProvider(
  config?: DaytonaConfig,
): DaytonaSdkWorkerProvider {
  return new DaytonaSdkWorkerProvider(
    new Daytona(config) as unknown as DaytonaSdkClientLike,
  )
}
