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
