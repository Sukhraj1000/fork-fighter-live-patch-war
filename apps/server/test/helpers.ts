import type { RunTelemetry } from '@fork-fighter/contracts'

import type {
  GameMasterAgent,
  MatchClock,
  MatchHostDependencies,
} from '../src/index.js'
import {
  InMemoryMatchLogStore,
  createDeterministicMockAgents,
  defaultCapabilities,
  deterministicMockSelector,
  deterministicMockValidator,
} from '../src/index.js'

interface TimerRecord {
  atMs: number
  callback: () => void
}

export class ManualClock implements MatchClock {
  #now: number
  #nextTimerId = 1
  readonly #timers = new Map<number, TimerRecord>()

  constructor(now = 1_000) {
    this.#now = now
  }

  now(): number {
    return this.#now
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    const id = this.#nextTimerId++
    this.#timers.set(id, { atMs: this.#now + delayMs, callback })
    return id
  }

  clearTimeout(handle: unknown): void {
    this.#timers.delete(handle as number)
  }

  get pendingTimerCount(): number {
    return this.#timers.size
  }

  advanceBy(durationMs: number): void {
    this.#now += durationMs
    while (true) {
      const due = [...this.#timers.entries()]
        .filter(([, timer]) => timer.atMs <= this.#now)
        .sort(
          ([leftId, left], [rightId, right]) =>
            left.atMs - right.atMs || leftId - rightId,
        )[0]
      if (!due) return
      this.#timers.delete(due[0])
      due[1].callback()
    }
  }
}

export function telemetry(
  matchId: string,
  overrides: Partial<RunTelemetry> = {},
): RunTelemetry {
  return {
    matchId,
    patchIndex: 0,
    elapsedMs: 0,
    health: 100,
    coresHeld: 0,
    coresBanked: 0,
    primaryObjectiveProgress: 0,
    recentDamage: 0,
    recentDeaths: 0,
    routeRepetition: 0,
    lowRiskCoreRate: 0,
    highRiskCoreRate: 0,
    activeMutationIds: [],
    recentPatchOutcomes: [],
    challengeTrend: 'on_target',
    ...overrides,
  }
}

export function dependencies(
  overrides: Partial<MatchHostDependencies> = {},
): MatchHostDependencies {
  let id = 0
  return {
    agents: createDeterministicMockAgents(),
    validator: deterministicMockValidator,
    selector: deterministicMockSelector,
    capabilities: defaultCapabilities,
    logStore: new InMemoryMatchLogStore(),
    clock: new ManualClock(),
    idGenerator: () => `test-${++id}`,
    cadenceMs: 2_000,
    proposalDeadlineMs: 500,
    sseHistorySize: 64,
    secretValues: [],
    ...overrides,
  }
}

export function replaceAgent(
  agents: readonly GameMasterAgent[],
  replacement: GameMasterAgent,
): readonly GameMasterAgent[] {
  return agents.map((agent) =>
    agent.persona === replacement.persona ? replacement : agent,
  )
}
