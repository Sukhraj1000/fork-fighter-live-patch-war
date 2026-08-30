import 'dotenv/config'
import { readFileSync } from 'node:fs'
import {
  createDaytonaSdkWorkerProvider,
  runDaytonaWorkerSmokeTest,
} from '@fork-fighter/gm-orchestrator'

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required for the Daytona worker smoke test.`)
  }
  return value
}

async function main(): Promise<void> {
  requiredEnvironment('DAYTONA_API_KEY')
  const snapshotName = requiredEnvironment('DAYTONA_WORKER_SNAPSHOT')
  const configuredAuthMode = process.env.DAYTONA_CODEX_AUTH_MODE ?? 'api-key'
  if (configuredAuthMode !== 'api-key' && configuredAuthMode !== 'chatgpt') {
    throw new Error('DAYTONA_CODEX_AUTH_MODE must be api-key or chatgpt.')
  }
  const codexAuthMode = configuredAuthMode
  const codexSecretName = process.env.DAYTONA_CODEX_SECRET_NAME?.trim() ||
    (codexAuthMode === 'chatgpt'
      ? 'chatgpt-auth-file'
      : requiredEnvironment('DAYTONA_CODEX_SECRET_NAME'))
  const codexAuthJson = codexAuthMode === 'chatgpt'
    ? readFileSync(requiredEnvironment('DAYTONA_CODEX_AUTH_FILE'), 'utf8')
    : undefined
  const result = await runDaytonaWorkerSmokeTest({
    provider: createDaytonaSdkWorkerProvider(),
    snapshotName,
    codexSecretName,
    codexAuthMode,
    ...(codexAuthJson === undefined ? {} : { codexAuthJson }),
  })
  console.log(`Prepared Daytona worker passed: ${result.sandboxId}`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Daytona worker smoke test failed: ${message}`)
  process.exitCode = 1
})
