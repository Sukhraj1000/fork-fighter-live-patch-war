import { config } from 'dotenv'

config({ path: new URL('../../../../.env', import.meta.url) })

import {
  DEFAULT_DAYTONA_WORKER_SNAPSHOT,
  prepareDaytonaWorkerSnapshot,
} from './prepare-snapshot.js'

const name =
  process.env.DAYTONA_WORKER_SNAPSHOT ?? DEFAULT_DAYTONA_WORKER_SNAPSHOT

prepareDaytonaWorkerSnapshot({
  name,
  onLog(chunk) {
    process.stdout.write(chunk)
  },
})
  .then((snapshot) => {
    console.log(`Daytona worker snapshot ready: ${snapshot.name}`)
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Daytona worker snapshot preparation failed: ${message}`)
    process.exitCode = 1
  })
