import 'dotenv/config'
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
  const codexSecretName = requiredEnvironment('DAYTONA_CODEX_SECRET_NAME')
  const result = await runDaytonaWorkerSmokeTest({
    provider: createDaytonaSdkWorkerProvider(),
    snapshotName,
    codexSecretName,
  })
  console.log(`Prepared Daytona worker passed: ${result.sandboxId}`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Daytona worker smoke test failed: ${message}`)
  process.exitCode = 1
})
