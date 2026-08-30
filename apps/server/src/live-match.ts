import {
  GameEventBatchSchema,
  PlayerCommandSchema,
  type GameEvent,
  type GameEventBatch,
  type GameState,
  type PlayerCommand,
} from '@fork-fighter/contracts'
import { aggregateRunTelemetry } from '@fork-fighter/director-context'
import { startGame, stepGame } from '@fork-fighter/game-core'
import {
  activateMutation,
  createMutationRuntimeState,
  processMutationGameBoundary,
  type MutationRuntimeState,
} from '@fork-fighter/mutation-runtime'

import { MatchHost, MatchHostError } from './match-host.js'
import type { MatchSnapshot } from './types.js'

const MAX_RECENT_GAME_EVENTS = 48
const MAX_QUEUED_COMMANDS = 8

export class LiveGameStateStore {
  readonly #states = new Map<string, GameState>()

  get(matchId: string): GameState | undefined {
    return this.#states.get(matchId)
  }

  set(matchId: string, state: GameState): void {
    this.#states.set(matchId, state)
  }

  delete(matchId: string): void {
    this.#states.delete(matchId)
  }
}

interface LiveMatchSession {
  matchId: string
  game: GameState
  runtime: MutationRuntimeState
  batches: GameEventBatch[]
  nextBatchIndex: number
  queuedCommands: PlayerCommand[]
  recentEvents: GameEvent[]
  lastCommand: PlayerCommand
  timer?: NodeJS.Timeout
  ticking: boolean
  closed: boolean
  lastTelemetryTick: number
}

export interface LiveMatchSnapshot {
  matchId: string
  game: GameState
  runtime: MutationRuntimeState
  match: MatchSnapshot
  recentEvents: GameEvent[]
  lastCommand: PlayerCommand
}

export interface CreateLiveMatchInput {
  matchId: string
  seed?: number | string
  autoStart?: boolean
}

export interface LiveMatchCoordinatorOptions {
  autoTick?: boolean
  telemetryEveryTicks?: number
}

export class LiveMatchCoordinator {
  readonly #host: MatchHost
  readonly #gameStates: LiveGameStateStore
  readonly #sessions = new Map<string, LiveMatchSession>()
  readonly #autoTick: boolean
  readonly #telemetryEveryTicks: number

  constructor(
    host: MatchHost,
    gameStates: LiveGameStateStore,
    options: LiveMatchCoordinatorOptions = {},
  ) {
    this.#host = host
    this.#gameStates = gameStates
    this.#autoTick = options.autoTick ?? true
    this.#telemetryEveryTicks = options.telemetryEveryTicks ?? 10
  }

  async create(input: CreateLiveMatchInput): Promise<LiveMatchSnapshot> {
    if (this.#sessions.has(input.matchId)) {
      throw new MatchHostError('match_exists', 409, 'A match with that id already exists.')
    }

    const started = startGame({ seed: input.seed ?? input.matchId })
    const initialBatch = GameEventBatchSchema.parse({
      matchId: input.matchId,
      batchIndex: 0,
      fromTick: started.state.tick,
      toTick: started.state.tick,
      events: started.events,
    })
    const session: LiveMatchSession = {
      matchId: input.matchId,
      game: started.state,
      runtime: createMutationRuntimeState(),
      batches: [initialBatch],
      nextBatchIndex: 1,
      queuedCommands: [],
      recentEvents: [...started.events],
      lastCommand: { type: 'wait' },
      ticking: false,
      closed: false,
      lastTelemetryTick: 0,
    }
    this.#sessions.set(input.matchId, session)
    this.#gameStates.set(input.matchId, session.game)

    try {
      const initialTelemetry = aggregateRunTelemetry({
        matchId: input.matchId,
        patchIndex: 0,
        state: session.game,
        batches: session.batches,
      })
      await this.#host.createMatch({
        matchId: input.matchId,
        initialTelemetry,
        autoStart: input.autoStart ?? true,
      })
      await this.#host.ingestEventBatch(input.matchId, initialBatch)
      if (this.#autoTick) this.#startTicker(session)
      return this.getSnapshot(input.matchId)
    } catch (error) {
      this.#sessions.delete(input.matchId)
      this.#gameStates.delete(input.matchId)
      throw error
    }
  }

  getSnapshot(matchId: string): LiveMatchSnapshot {
    const session = this.#session(matchId)
    return structuredClone({
      matchId,
      game: session.game,
      runtime: session.runtime,
      match: this.#host.getSnapshot(matchId),
      recentEvents: session.recentEvents,
      lastCommand: session.lastCommand,
    })
  }

  queueCommand(matchId: string, input: unknown): LiveMatchSnapshot {
    const session = this.#session(matchId)
    if (session.closed || session.game.status !== 'running') {
      throw new MatchHostError('match_ended', 409, 'Match has ended.')
    }
    const command = PlayerCommandSchema.parse(input)
    session.queuedCommands.push(command)
    if (session.queuedCommands.length > MAX_QUEUED_COMMANDS) {
      session.queuedCommands.splice(0, session.queuedCommands.length - MAX_QUEUED_COMMANDS)
    }
    return this.getSnapshot(matchId)
  }

  async step(matchId: string, command?: PlayerCommand): Promise<LiveMatchSnapshot> {
    const session = this.#session(matchId)
    if (command) session.queuedCommands.push(PlayerCommandSchema.parse(command))
    await this.#tick(session)
    return this.getSnapshot(matchId)
  }

  async end(matchId: string): Promise<LiveMatchSnapshot> {
    const session = this.#session(matchId)
    this.#stopTicker(session)
    session.closed = true
    if (this.#host.getSnapshot(matchId).status === 'running') {
      await this.#host.endMatch(matchId)
    }
    return this.getSnapshot(matchId)
  }

  async close(): Promise<void> {
    for (const session of this.#sessions.values()) {
      this.#stopTicker(session)
      session.closed = true
    }
  }

  #startTicker(session: LiveMatchSession): void {
    session.timer = setInterval(() => {
      void this.#tick(session).catch(() => undefined)
    }, session.game.rules.tickMs)
    session.timer.unref()
  }

  #stopTicker(session: LiveMatchSession): void {
    if (session.timer) clearInterval(session.timer)
    session.timer = undefined
  }

  async #tick(session: LiveMatchSession): Promise<void> {
    if (session.ticking || session.closed || session.game.status !== 'running') return
    session.ticking = true
    try {
      const lifecycleEvents = this.#activateReadyPatch(session)
      const command = session.queuedCommands.shift() ?? { type: 'wait' as const }
      session.lastCommand = command
      const gameTransition = stepGame(session.game, command)
      const runtimeTransition = processMutationGameBoundary(session.runtime, gameTransition)
      session.game = gameTransition.state
      session.runtime = runtimeTransition.state
      this.#gameStates.set(session.matchId, session.game)

      const events = [
        ...lifecycleEvents,
        ...gameTransition.events,
        ...runtimeTransition.events,
      ]
      if (events.length > 0) await this.#ingestEvents(session, events)

      if (
        session.game.tick - session.lastTelemetryTick >= this.#telemetryEveryTicks ||
        events.some(({ type }) =>
          type === 'player_died' ||
          type === 'extraction_completed' ||
          type === 'patch_expired',
        )
      ) {
        await this.#publishTelemetry(session)
        session.lastTelemetryTick = session.game.tick
      }

      if (session.game.status === 'completed') {
        this.#stopTicker(session)
        session.closed = true
        await this.#host.endMatch(session.matchId)
      }
    } finally {
      session.ticking = false
    }
  }

  #activateReadyPatch(session: LiveMatchSession): GameEvent[] {
    if (session.runtime.activeMutation) return []
    const active = this.#host.getSnapshot(session.matchId).activePatches[0]
    if (!active) return []
    const transition = activateMutation(
      session.runtime,
      active.proposal.mutation,
      { tick: session.game.tick, atMs: session.game.elapsedMs },
    )
    session.runtime = transition.state
    return transition.events
  }

  async #ingestEvents(
    session: LiveMatchSession,
    events: readonly GameEvent[],
  ): Promise<void> {
    const ticks = events.map(({ tick }) => tick)
    const batch = GameEventBatchSchema.parse({
      matchId: session.matchId,
      batchIndex: session.nextBatchIndex,
      fromTick: Math.min(...ticks),
      toTick: Math.max(...ticks),
      events,
    })
    await this.#host.ingestEventBatch(session.matchId, batch)
    session.nextBatchIndex += 1
    session.batches.push(batch)
    session.recentEvents.push(...events)
    session.recentEvents = session.recentEvents.slice(-MAX_RECENT_GAME_EVENTS)
  }

  async #publishTelemetry(session: LiveMatchSession): Promise<void> {
    let snapshot = this.#host.getSnapshot(session.matchId)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const telemetry = aggregateRunTelemetry({
        matchId: session.matchId,
        patchIndex: snapshot.patchIndex,
        state: session.game,
        batches: session.batches,
        previousTelemetry: snapshot.context.telemetry,
        patchOutcomes: snapshot.recentOutcomes,
      })
      try {
        await this.#host.ingestTelemetry(session.matchId, telemetry)
        return
      } catch (error) {
        if (
          !(error instanceof MatchHostError) ||
          error.code !== 'patch_index_conflict' ||
          attempt > 0
        ) {
          throw error
        }
        snapshot = this.#host.getSnapshot(session.matchId)
      }
    }
  }

  #session(matchId: string): LiveMatchSession {
    const session = this.#sessions.get(matchId)
    if (!session) {
      throw new MatchHostError('match_not_found', 404, 'Match not found.')
    }
    return session
  }
}
