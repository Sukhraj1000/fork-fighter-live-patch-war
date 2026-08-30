import { pathToFileURL } from 'node:url'

export * from './jsonl-log.js'
export * from './match-host.js'
export * from './mock-dependencies.js'
export * from './redaction.js'
export * from './server.js'
export * from './types.js'

import { createMatchServer } from './server.js'

async function main(): Promise<void> {
  const port = Number.parseInt(process.env.PORT ?? '3001', 10)
  const host = process.env.HOST ?? '0.0.0.0'
  const clientDistPath = process.env.CLIENT_DIST_PATH
  const server = createMatchServer({
    fastify: { logger: true, disableRequestLogging: true },
    ...(clientDistPath ? { clientDistPath } : {}),
  })
  await server.app.listen({ port, host })
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Server failed to start.'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
