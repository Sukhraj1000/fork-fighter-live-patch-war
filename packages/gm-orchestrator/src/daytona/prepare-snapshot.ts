import { fileURLToPath } from 'node:url'

import { Daytona, Image, type DaytonaConfig, type Snapshot } from '@daytona/sdk'

export const DEFAULT_DAYTONA_WORKER_SNAPSHOT =
  'fork-fighter-game-master-codex-v4'

export interface PrepareWorkerSnapshotOptions {
  readonly name?: string
  readonly dockerfilePath?: string
  readonly timeoutSeconds?: number
  readonly onLog?: (chunk: string) => void
  readonly daytonaConfig?: DaytonaConfig
}

/** Builds one reusable image so match workers never install packages per cycle. */
export async function prepareDaytonaWorkerSnapshot(
  options: PrepareWorkerSnapshotOptions = {},
): Promise<Snapshot> {
  const name = options.name?.trim() || DEFAULT_DAYTONA_WORKER_SNAPSHOT
  const dockerfilePath =
    options.dockerfilePath ??
    fileURLToPath(new URL('../../worker/Dockerfile', import.meta.url))
  const daytona = new Daytona(options.daytonaConfig)
  const snapshot = await daytona.snapshot.create(
    {
      name,
      image: Image.fromDockerfile(dockerfilePath),
      entrypoint: ['sleep', 'infinity'],
    },
    {
      timeout: options.timeoutSeconds ?? 0,
      onLogs: options.onLog,
    },
  )
  try {
    return await daytona.snapshot.activate(snapshot)
  } catch (error) {
    if (error instanceof Error && /already active/i.test(error.message)) {
      return snapshot
    }
    throw error
  }
}
