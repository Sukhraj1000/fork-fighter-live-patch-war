import { resolve } from 'node:path'

import { createMatchServer } from '../../apps/server/src/server.js'

process.env.MATCH_PATCH_CADENCE_MS ??= '3500'
process.env.MATCH_PROPOSAL_DEADLINE_MS ??= '700'
process.env.MOCK_AGENT_DELAY_MS ??= '140'
process.env.MOCK_MUTATION_DURATION_MS ??= '2000'

const server = createMatchServer({
  clientDistPath: resolve('apps/web/dist'),
  fastify: { logger: false },
})

await server.app.listen({ host: '127.0.0.1', port: 4173 })

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void server.app.close().finally(() => process.exit(0))
  })
}
