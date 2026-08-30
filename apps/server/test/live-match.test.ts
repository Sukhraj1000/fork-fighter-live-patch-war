import { describe, expect, it } from 'vitest'

import {
  InMemoryMatchLogStore,
  adaptAgentBrains,
  createMatchServer,
  createMockGameMasterBrains,
  type GameMasterAgent,
} from '../src/index.js'
import { ManualClock } from './helpers.js'

describe('playable integration loop', () => {
  it('feeds actual endless-run score and survival telemetry into Game Master context', async () => {
    const clock = new ManualClock()
    const server = createMatchServer({
      dependencies: {
        agents: adaptAgentBrains(createMockGameMasterBrains()),
        clock,
        cadenceMs: 2_000,
        proposalDeadlineMs: 500,
      },
      live: { autoTick: false },
    })

    try {
      await server.live.create({ matchId: 'runner-telemetry', autoStart: false })
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/live-matches/runner-telemetry/runner-telemetry',
        payload: {
          elapsedMs: 32_000,
          pickups: 7,
          score: 3_900,
          alive: true,
        },
      })

      expect(response.statusCode).toBe(202)
      expect(response.json().live.match.context.telemetry).toMatchObject({
        health: 100,
        coresBanked: 7,
        primaryObjectiveProgress: 32_000 / 60_000,
        challengeTrend: 'too_easy',
      })

      const capped = await server.app.inject({
        method: 'POST',
        url: '/api/live-matches/runner-telemetry/runner-telemetry',
        payload: {
          elapsedMs: 33_000,
          pickups: 150,
          score: 18_300,
          alive: true,
        },
      })
      expect(capped.statusCode).toBe(202)
      expect(capped.json().live.match.context.telemetry.coresBanked).toBe(100)
    } finally {
      await server.app.close()
    }
  })

  it('connects core, telemetry, mock brains, validation, selection, runtime, and host lifecycle', async () => {
    const clock = new ManualClock()
    const logStore = new InMemoryMatchLogStore()
    const server = createMatchServer({
      dependencies: {
        agents: adaptAgentBrains(createMockGameMasterBrains(0, 1_000)),
        clock,
        logStore,
        cadenceMs: 2_000,
        proposalDeadlineMs: 500,
      },
      live: { autoTick: false, telemetryEveryTicks: 5 },
    })

    try {
      await server.live.create({
        matchId: 'live-integration',
        seed: 'live-integration',
        autoStart: false,
      })
      await server.host.prepareNextPatch('live-integration')

      const preparedLog = await server.host.readLog('live-integration')
      expect(preparedLog.filter(({ type }) => type === 'proposal_received')).toHaveLength(3)
      expect(preparedLog.filter(({ type }) => type === 'proposal_rejected')).toHaveLength(2)
      expect(preparedLog.find(({ type }) => type === 'proposal_selected')?.data).toMatchObject({
        author: 'gremlin',
      })

      clock.advanceBy(2_000)
      await server.host.triggerPatchBoundary('live-integration')
      await server.live.step('live-integration', { type: 'wait' })
      expect(server.live.getSnapshot('live-integration').runtime.activeMutation?.definition.author).toBe('gremlin')

      for (let index = 0; index < 16; index += 1) {
        await server.live.step('live-integration', {
          type: 'move',
          direction: { x: 1, y: 0 },
        })
      }
      expect(server.live.getSnapshot('live-integration').runtime.entities.length).toBeGreaterThan(0)

      for (let index = 0; index < 4; index += 1) {
        await server.live.step('live-integration', { type: 'wait' })
      }
      expect(server.live.getSnapshot('live-integration').runtime.activeMutation).toBeNull()

      for (let index = 0; index < 90; index += 1) {
        const current = server.live.getSnapshot('live-integration')
        if (current.game.status === 'completed') break
        await server.live.step('live-integration', {
          type: 'move',
          direction: { x: 1, y: 0 },
        })
      }

      const completed = server.live.getSnapshot('live-integration')
      expect(completed.game.extraction.completed).toBe(true)
      expect(completed.match.status).toBe('ended')
      expect(completed.match.context.telemetry.coresBanked).toBeGreaterThanOrEqual(3)

      const lifecycle = await server.host.readLog('live-integration')
      expect(lifecycle.some(({ type }) => type === 'patch_activated')).toBe(true)
      expect(lifecycle.some(({ type }) => type === 'patch_expired')).toBe(true)
      expect(lifecycle.some(({ type, data }) =>
        type === 'event_batch_ingested' &&
        JSON.stringify(data).includes('patch_effect_applied'),
      )).toBe(true)
    } finally {
      await server.app.close()
    }
  })

  it('continues deterministic game ticks while one provider times out', async () => {
    const clock = new ManualClock()
    const logStore = new InMemoryMatchLogStore()
    const normalAgents = adaptAgentBrains(createMockGameMasterBrains())
    const stalled: GameMasterAgent = {
      persona: 'gremlin',
      propose: () => new Promise<never>(() => undefined),
    }
    const server = createMatchServer({
      dependencies: {
        agents: normalAgents.map((agent) =>
          agent.persona === stalled.persona ? stalled : agent,
        ),
        clock,
        logStore,
        cadenceMs: 2_000,
        proposalDeadlineMs: 500,
      },
      live: { autoTick: false },
    })

    try {
      await server.live.create({
        matchId: 'live-timeout',
        autoStart: false,
      })
      const proposalRound = server.host.prepareNextPatch('live-timeout')
      for (let attempt = 0; attempt < 50; attempt += 1) await Promise.resolve()
      expect(clock.pendingTimerCount).toBeGreaterThan(0)

      const before = server.live.getSnapshot('live-timeout').game.tick
      await server.live.step('live-timeout', {
        type: 'move',
        direction: { x: 1, y: 0 },
      })
      expect(server.live.getSnapshot('live-timeout').game.tick).toBe(before + 1)

      clock.advanceBy(500)
      await proposalRound
      const failures = (await server.host.readLog('live-timeout')).filter(
        ({ type }) => type === 'proposal_failed',
      )
      expect(failures).toHaveLength(1)
      expect(failures[0]?.data).toMatchObject({
        persona: 'gremlin',
        error: { code: 'timeout' },
      })
    } finally {
      await server.app.close()
    }
  })
})
