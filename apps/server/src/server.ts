import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify'

import { JsonlMatchLogStore } from './jsonl-log.js'
import { MatchHost, MatchHostError } from './match-host.js'
import {
  createDeterministicMockAgents,
  defaultCapabilities,
  deterministicMockSelector,
  deterministicMockValidator,
} from './mock-dependencies.js'
import { redactForExternal } from './redaction.js'
import { registerBuiltClient } from './static-client.js'
import type { MatchClock, MatchHostDependencies } from './types.js'

const systemClock: MatchClock = {
  now: () => Date.now(),
  setTimeout(callback, delayMs) {
    const timer = setTimeout(callback, delayMs)
    timer.unref()
    return timer
  },
  clearTimeout(handle) {
    clearTimeout(handle as NodeJS.Timeout)
  },
}

export interface MatchServerOptions {
  fastify?: FastifyServerOptions
  dependencies?: Partial<MatchHostDependencies>
  logDirectory?: string
  clientDistPath?: string
}

export interface MatchServer {
  app: FastifyInstance
  host: MatchHost
}

function knownSecretValues(): string[] {
  return [
    process.env.DAYTONA_API_KEY,
    process.env.OPENAI_API_KEY,
    process.env.CODEX_API_KEY,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)
}

function resolveDependencies(options: MatchServerOptions): MatchHostDependencies {
  const overrides = options.dependencies ?? {}
  return {
    agents: overrides.agents ?? createDeterministicMockAgents(),
    validator: overrides.validator ?? deterministicMockValidator,
    selector: overrides.selector ?? deterministicMockSelector,
    capabilities: overrides.capabilities ?? defaultCapabilities,
    logStore:
      overrides.logStore ??
      new JsonlMatchLogStore(
        resolve(options.logDirectory ?? process.env.MATCH_LOG_DIR ?? 'data/matches'),
      ),
    clock: overrides.clock ?? systemClock,
    idGenerator: overrides.idGenerator ?? randomUUID,
    cadenceMs: overrides.cadenceMs ?? 20_000,
    proposalDeadlineMs: overrides.proposalDeadlineMs ?? 5_000,
    sseHistorySize: overrides.sseHistorySize ?? 256,
    secretValues: overrides.secretValues ?? knownSecretValues(),
  }
}

function issuesFrom(error: unknown): unknown[] | undefined {
  if (!error || typeof error !== 'object' || !('issues' in error)) return undefined
  const issues = (error as { issues?: unknown }).issues
  return Array.isArray(issues) ? issues : undefined
}

export function createMatchServer(options: MatchServerOptions = {}): MatchServer {
  const app = Fastify({
    bodyLimit: 1_048_576,
    logger: false,
    ...options.fastify,
  })
  const dependencies = resolveDependencies(options)
  const host = new MatchHost(dependencies)

  app.get('/health', async () => ({ status: 'ok' }))

  app.post('/api/matches', async (request, reply) => {
    const body =
      request.body && typeof request.body === 'object' ? request.body : {}
    const snapshot = await host.createMatch(body)
    return reply.code(201).send({ match: snapshot })
  })

  app.get<{ Params: { matchId: string } }>(
    '/api/matches/:matchId',
    async (request) => ({ match: host.getSnapshot(request.params.matchId) }),
  )

  app.post<{ Params: { matchId: string } }>(
    '/api/matches/:matchId/end',
    async (request) => ({ match: await host.endMatch(request.params.matchId) }),
  )

  app.post<{ Params: { matchId: string } }>(
    '/api/matches/:matchId/telemetry',
    async (request, reply) =>
      reply
        .code(202)
        .send(await host.ingestTelemetry(request.params.matchId, request.body)),
  )

  app.post<{ Params: { matchId: string } }>(
    '/api/matches/:matchId/event-batches',
    async (request, reply) =>
      reply
        .code(202)
        .send(await host.ingestEventBatch(request.params.matchId, request.body)),
  )

  app.get<{ Params: { matchId: string } }>(
    '/api/matches/:matchId/log',
    async (request) => ({ entries: await host.readLog(request.params.matchId) }),
  )

  app.get<{ Params: { matchId: string } }>(
    '/api/matches/:matchId/events',
    async (request, reply) => {
      host.getSnapshot(request.params.matchId)
      const header = request.headers['last-event-id']
      const value = Array.isArray(header) ? header[0] : header
      const parsed = value === undefined ? undefined : Number.parseInt(value, 10)
      if (parsed !== undefined && (!Number.isSafeInteger(parsed) || parsed < 0)) {
        return reply.code(400).send({
          error: {
            code: 'invalid_last_event_id',
            message: 'Last-Event-ID must be a non-negative integer.',
          },
        })
      }

      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      reply.raw.write(': connected\n\n')
      host.subscribe(request.params.matchId, reply.raw, parsed)
    },
  )

  if (options.clientDistPath) {
    registerBuiltClient(app, options.clientDistPath)
  }

  app.setErrorHandler((error, _request, reply) => {
    const issues = issuesFrom(error)
    const hostError = error instanceof MatchHostError ? error : undefined
    const errorStatus =
      error && typeof error === 'object' && 'statusCode' in error
        ? (error as { statusCode?: unknown }).statusCode
        : undefined
    const transportStatus =
      typeof errorStatus === 'number' && errorStatus >= 400 && errorStatus < 500
        ? errorStatus
        : undefined
    const statusCode = hostError?.statusCode ?? (issues ? 400 : transportStatus ?? 500)
    const code =
      hostError?.code ??
      (issues || transportStatus ? 'invalid_request' : 'internal_error')
    const message =
      hostError?.message ??
      (issues || transportStatus
        ? 'Request did not match the server contract.'
        : 'Internal server error.')
    return reply.code(statusCode).send(
      redactForExternal(
        {
          error: {
            code,
            message,
            ...(issues ? { issues } : {}),
          },
        },
        dependencies.secretValues,
      ),
    )
  })

  app.addHook('onClose', async () => {
    await host.close()
  })

  return { app, host }
}

export const buildMatchServer = createMatchServer
