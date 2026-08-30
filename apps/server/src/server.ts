import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify'

import { JsonlMatchLogStore } from './jsonl-log.js'
import { createPersistentDaytonaBrains } from './daytona-agent-brain.js'
import {
  adaptAgentBrains,
  createIntegratedSelector,
  createIntegratedValidator,
  createMockGameMasterBrains,
} from './integration-dependencies.js'
import {
  LiveGameStateStore,
  LiveMatchCoordinator,
  type LiveMatchCoordinatorOptions,
} from './live-match.js'
import { MatchHost, MatchHostError } from './match-host.js'
import {
  defaultCapabilities,
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
  provider?: 'mock' | 'daytona'
  live?: LiveMatchCoordinatorOptions
}

export interface MatchServer {
  app: FastifyInstance
  host: MatchHost
  live: LiveMatchCoordinator
}

function knownSecretValues(): string[] {
  return [
    process.env.DAYTONA_API_KEY,
    process.env.OPENAI_API_KEY,
    process.env.CODEX_API_KEY,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return parsed
}

function defaultAgents(options: MatchServerOptions): MatchHostDependencies['agents'] {
  const provider = options.provider ?? process.env.GAME_MASTER_PROVIDER ?? 'mock'
  if (provider === 'daytona') {
    const snapshotName = process.env.DAYTONA_WORKER_SNAPSHOT
    const codexSecretName = process.env.DAYTONA_CODEX_SECRET_NAME
    if (!snapshotName || !codexSecretName) {
      throw new Error(
        'Daytona mode requires DAYTONA_WORKER_SNAPSHOT and DAYTONA_CODEX_SECRET_NAME.',
      )
    }
    return adaptAgentBrains(
      createPersistentDaytonaBrains({
        snapshotName,
        codexSecretName,
        ttlMinutes: positiveInteger(
          process.env.DAYTONA_WORKER_TTL_MINUTES,
          30,
          'DAYTONA_WORKER_TTL_MINUTES',
        ),
        startupTimeoutMs: positiveInteger(
          process.env.DAYTONA_WORKER_STARTUP_TIMEOUT_MS,
          20_000,
          'DAYTONA_WORKER_STARTUP_TIMEOUT_MS',
        ),
      }),
    )
  }
  if (provider !== 'mock') {
    throw new Error('GAME_MASTER_PROVIDER must be mock or daytona.')
  }

  const delayMs = positiveInteger(
    process.env.MOCK_AGENT_DELAY_MS,
    1,
    'MOCK_AGENT_DELAY_MS',
  )
  const configuredDuration = process.env.MOCK_MUTATION_DURATION_MS
  const durationMs =
    configuredDuration === undefined
      ? undefined
      : positiveInteger(
          configuredDuration,
          16_000,
          'MOCK_MUTATION_DURATION_MS',
        )
  return adaptAgentBrains(createMockGameMasterBrains(delayMs, durationMs))
}

function resolveDependencies(
  options: MatchServerOptions,
  gameStates: LiveGameStateStore,
): MatchHostDependencies {
  const overrides = options.dependencies ?? {}
  return {
    agents: overrides.agents ?? defaultAgents(options),
    validator:
      overrides.validator ?? createIntegratedValidator((matchId) => gameStates.get(matchId)),
    selector:
      overrides.selector ?? createIntegratedSelector((matchId) => gameStates.get(matchId)),
    capabilities: overrides.capabilities ?? defaultCapabilities,
    logStore:
      overrides.logStore ??
      new JsonlMatchLogStore(
        resolve(options.logDirectory ?? process.env.MATCH_LOG_DIR ?? 'data/matches'),
      ),
    clock: overrides.clock ?? systemClock,
    idGenerator: overrides.idGenerator ?? randomUUID,
    cadenceMs:
      overrides.cadenceMs ??
      positiveInteger(process.env.MATCH_PATCH_CADENCE_MS, 6_000, 'MATCH_PATCH_CADENCE_MS'),
    proposalDeadlineMs:
      overrides.proposalDeadlineMs ??
      positiveInteger(
        process.env.MATCH_PROPOSAL_DEADLINE_MS,
        5_000,
        'MATCH_PROPOSAL_DEADLINE_MS',
      ),
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
  const configuredOrigins = (process.env.CLIENT_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  if (configuredOrigins.length > 0) {
    app.addHook('onRequest', async (request, reply) => {
      const requestOrigin = request.headers.origin
      const allowsAll = configuredOrigins.includes('*')
      if (requestOrigin && (allowsAll || configuredOrigins.includes(requestOrigin))) {
        reply.header('Access-Control-Allow-Origin', allowsAll ? '*' : requestOrigin)
        reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        reply.header('Access-Control-Allow-Headers', 'Content-Type,Last-Event-ID')
        reply.header('Vary', 'Origin')
      }
      if (request.method === 'OPTIONS') return reply.code(204).send()
    })
  }
  const gameStates = new LiveGameStateStore()
  const dependencies = resolveDependencies(options, gameStates)
  const host = new MatchHost(dependencies)
  const live = new LiveMatchCoordinator(host, gameStates, options.live)

  app.get('/health', async () => ({ status: 'ok' }))

  app.post('/api/matches', async (request, reply) => {
    const body =
      request.body && typeof request.body === 'object' ? request.body : {}
    const snapshot = await host.createMatch(body)
    return reply.code(201).send({ match: snapshot })
  })

  app.post('/api/live-matches', async (request, reply) => {
    const body =
      request.body && typeof request.body === 'object'
        ? (request.body as { matchId?: unknown; seed?: unknown })
        : {}
    const matchId =
      typeof body.matchId === 'string' ? body.matchId : `live-${randomUUID()}`
    const seed =
      typeof body.seed === 'string' || typeof body.seed === 'number'
        ? body.seed
        : matchId
    const snapshot = await live.create({ matchId, seed })
    return reply.code(201).send({ live: snapshot })
  })

  app.get<{ Params: { matchId: string } }>(
    '/api/live-matches/:matchId',
    async (request) => ({ live: live.getSnapshot(request.params.matchId) }),
  )

  app.post<{ Params: { matchId: string } }>(
    '/api/live-matches/:matchId/commands',
    async (request, reply) =>
      reply
        .code(202)
        .send({ live: live.queueCommand(request.params.matchId, request.body) }),
  )

  app.post<{ Params: { matchId: string } }>(
    '/api/live-matches/:matchId/end',
    async (request) => ({ live: await live.end(request.params.matchId) }),
  )

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
    await live.close()
    await host.close()
  })

  return { app, host, live }
}

export const buildMatchServer = createMatchServer
