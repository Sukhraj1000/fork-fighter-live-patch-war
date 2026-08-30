import 'dotenv/config'
import { Daytona } from '@daytona/sdk'
import type { Sandbox } from '@daytona/sdk'

async function main(): Promise<void> {
  if (!process.env.DAYTONA_API_KEY) {
    throw new Error(
      'DAYTONA_API_KEY is missing. Copy .env.example to .env and add your Daytona API key.',
    )
  }

  const daytona = new Daytona()
  let sandbox: Sandbox | undefined

  try {
    console.log('Creating Daytona sandbox...')
    sandbox = await daytona.create()
    console.log(`Sandbox ready: ${sandbox.id}`)

    const response = await sandbox.process.codeRun(
      'print("Hello from an isolated Daytona sandbox!")',
    )

    console.log(response.result)
  } finally {
    if (sandbox) {
      console.log('Deleting sandbox...')
      await sandbox.delete(60, true)
      console.log('Sandbox deleted.')
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Daytona quickstart failed: ${message}`)
  process.exitCode = 1
})
