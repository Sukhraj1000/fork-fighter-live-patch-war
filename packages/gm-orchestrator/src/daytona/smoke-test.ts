import { mutationProposalJsonSchema } from '../codex/index.js'
import {
  DAYTONA_WORKER_HEALTH_COMMAND,
  DAYTONA_WORKER_ROOT,
  type DaytonaWorkerProvider,
} from './types.js'

export interface DaytonaWorkerSmokeTestOptions {
  readonly provider: DaytonaWorkerProvider
  readonly snapshotName: string
  readonly codexSecretName: string
}

/** Server-only smoke test for the prepared worker environment. */
export async function runDaytonaWorkerSmokeTest(
  options: DaytonaWorkerSmokeTestOptions,
): Promise<{ readonly sandboxId: string }> {
  const sandbox = await options.provider.create({
    matchId: `smoke-${Date.now().toString(36)}`,
    persona: 'architect',
    snapshotName: options.snapshotName,
    codexSecretName: options.codexSecretName,
    ttlMinutes: 10,
  })

  try {
    await sandbox.writeFile(
      `${DAYTONA_WORKER_ROOT}/contract/mutation-proposal.schema.json`,
      JSON.stringify(mutationProposalJsonSchema()),
    )
    const result = await sandbox.execute(DAYTONA_WORKER_HEALTH_COMMAND, 20_000)
    if (result.exitCode !== 0) {
      throw new Error('Prepared Daytona worker failed its installed test command.')
    }
    return { sandboxId: sandbox.id }
  } finally {
    await sandbox.destroy().catch(() => undefined)
  }
}
