import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GameMasterPersona } from '@fork-fighter/contracts'
import {
  createLiveMatch,
  endLiveMatch,
  getLiveMatch,
  getRuntimeInfo,
  sendRunnerTelemetry,
  subscribeToMatch,
} from './api/live-match-client'
import { ArenaCanvas } from './components/ArenaCanvas'
import { MOCK_RUNS } from './fixtures/mock-game-state'
import type { EndlessRunResult, EndlessRunStats } from './model/endless-run'
import type { LiveMatchPayload, MatchStreamEvent } from './model/live-match'
import { adaptLiveMatch } from './model/live-view-adapter'
import type { ActivityItem, GameStateViewModel, PatchStatus } from './model/view-models'

const statusCopy: Record<PatchStatus, string> = {
  idle: 'IDLE',
  drafting: 'DRAFT',
  proposed: 'READY',
  rejected: 'NOPE',
  validated: 'SAFE',
  selected: 'PICKED',
  incoming: 'NEXT',
  active: 'LIVE',
  expired: 'DONE',
  failed: 'OFFLINE',
}

const emptyStats: EndlessRunStats = {
  alive: true,
  elapsedMs: 0,
  pickups: 0,
  timeScore: 0,
  pickupScore: 0,
  score: 0,
}

const BEST_SCORE_KEY = 'fork-fighter:best-score'
const SEEDED_DEMO_SEED = 'fork-fighter-demo-v1'

function isSeededDemo(): boolean {
  return new URLSearchParams(window.location.search).get('demo') === 'seeded'
}

function mutationDemands(patch: GameStateViewModel['activePatch']): string[] {
  if (!patch.mutation) return []
  return patch.mutation.triggers.flatMap(({ effects }) =>
    effects.flatMap((effect) => {
      if (effect.type === 'configureRunner') {
        return [
          `${effect.gravityMode.replace('_', ' ')} gravity`,
          `${effect.rotationMode} runner`,
          `${effect.speedMultiplier}× world speed`,
        ]
      }
      if (effect.type === 'spawnRunnerHazard') {
        return [`${effect.count}× ${effect.hazard.replaceAll('_', ' ')} · ${effect.lane}`]
      }
      return []
    }),
  )
}

function storedBestScore(): number {
  try {
    const value = Number.parseInt(window.localStorage.getItem(BEST_SCORE_KEY) ?? '0', 10)
    return Number.isSafeInteger(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

const localPatchCycle = [
  {
    author: 'gremlin',
    title: 'BUBBLE TROUBLE',
    note: 'A typed rolling obstacle is entering your route.',
  },
  {
    author: 'architect',
    title: 'SKYLINE SHOVE',
    note: 'A moving wall is forcing a tighter jump window.',
  },
  {
    author: 'auditor',
    title: 'SPIKE AUDIT',
    note: 'A validated spike row is cutting off the safe line.',
  },
] as const

function localDemoSnapshot(runId: number): GameStateViewModel {
  const template = MOCK_RUNS.run
  return {
    ...template,
    runId: `DEMO-${String(runId % 100_000).padStart(5, '0')}`,
    sector: 'ENDLESS FORKWAY',
    directors: template.directors.map((director) => ({
      ...director,
      status: director.id === 'gremlin' ? 'selected' : 'validated',
      message: director.id === 'gremlin'
        ? 'Deploying the next safe obstacle.'
        : 'Obstacle contract verified.',
    })),
    activePatch: {
      id: `local-bubble-trouble-${runId}`,
      ...localPatchCycle[0],
      status: 'active',
      durationSeconds: 8,
      difficulty: 1.4,
    },
    activity: [
      {
        id: `local-draft-${runId}`,
        at: '00:00',
        author: 'architect',
        status: 'drafting',
        title: 'OBSTACLE DRAFTED',
        detail: 'Architect authored a typed candidate.',
      },
      {
        id: `local-reject-${runId}`,
        at: '00:01',
        author: 'auditor',
        status: 'rejected',
        title: 'UNFAIR WALL REJECTED',
        detail: 'The safety gate preserved a playable route.',
      },
      {
        id: `local-active-${runId}`,
        at: '00:02',
        author: 'gremlin',
        status: 'active',
        title: 'BUBBLE TROUBLE',
        detail: 'Validated obstacle deployed through the safe runtime.',
      },
    ],
  }
}

function formatClock(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function formatSeconds(milliseconds: number) {
  return `${(Math.max(0, milliseconds) / 1_000).toFixed(1)}s`
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined
}

function persona(value: unknown): GameMasterPersona | 'system' {
  return value === 'architect' || value === 'gremlin' || value === 'auditor'
    ? value
    : 'system'
}

function status(value: unknown): PatchStatus {
  return typeof value === 'string' && value in statusCopy
    ? (value as PatchStatus)
    : 'validated'
}

function activityFromStream(event: MatchStreamEvent): ActivityItem[] {
  const data = record(event.data)
  if (!data || event.type === 'snapshot') return []
  const at = formatClock(Date.now() % 3_600_000)
  const item = (
    suffix: string,
    author: GameMasterPersona | 'system',
    itemStatus: PatchStatus,
    title: string,
    detail: string,
  ): ActivityItem => ({
    id: `${event.id}-${suffix}`,
    at,
    author,
    status: itemStatus,
    title,
    detail,
  })

  if (event.type === 'match_created') {
    return [item(
      'match',
      'system',
      'validated',
      'LIVE MATCH CONNECTED',
      'Server-owned game loop and event stream are online.',
    )]
  }
  if (event.type === 'match_ended') {
    return [item(
      'ended',
      'system',
      'expired',
      'MATCH CLOSED CLEANLY',
      'Workers and active mutation state were released.',
    )]
  }
  if (event.type === 'patch_cycle_started') {
    const patchIndex = typeof data.patchIndex === 'number' ? data.patchIndex : undefined
    return [item(
      'cycle',
      'system',
      'drafting',
      patchIndex === undefined
        ? '3 AGENTS DISPATCHED'
        : `WAVE ${String(patchIndex).padStart(2, '0')} · 3 AGENTS DISPATCHED`,
      'Architect, Gremlin, and Auditor are drafting typed obstacles in parallel.',
    )]
  }
  if (event.type === 'patch_cycle_skipped') {
    const reason = data.reason === 'proposal_round_in_flight'
      ? 'The previous proposal round is still running.'
      : 'No safe typed proposal was ready; the game continued unchanged.'
    return [item(
      'cycle-skipped',
      'system',
      'expired',
      'WAVE CONTINUED SAFELY',
      reason,
    )]
  }

  if (event.type === 'agent_status') {
    const itemStatus = status(data.status)
    if (!['drafting', 'failed'].includes(itemStatus)) return []
    return [item(
      'agent',
      persona(data.persona),
      itemStatus,
      itemStatus === 'drafting' ? 'DRAFTING OBSTACLE' : `AGENT ${statusCopy[itemStatus]}`,
      typeof data.message === 'string' ? data.message : 'Typed obstacle proposal cycle updated.',
    )]
  }

  if (event.type === 'proposal_received') {
    const proposal = record(data.proposal)
    const mutation = record(proposal?.mutation)
    return [item(
      'proposal',
      persona(proposal?.author),
      'validated',
      typeof mutation?.title === 'string' ? mutation.title : 'OBSTACLE RECEIVED',
      'Typed proposal reached the validator.',
    )]
  }
  if (event.type === 'proposal_rejected') {
    const reasons = Array.isArray(data.reasons) ? data.reasons : []
    const reason = record(reasons[0])
    return [item('rejected', persona(data.author), 'rejected', 'PATCH REJECTED', typeof reason?.message === 'string' ? reason.message : 'Safety gate rejected the obstacle.')]
  }
  if (event.type === 'proposal_selected') {
    return [item('selected', persona(data.author), 'selected', 'OBSTACLE SELECTED', typeof data.mutationId === 'string' ? data.mutationId : 'Best valid challenge fit.')]
  }
  if (event.type === 'proposal_expired') {
    return [item(
      'proposal-expired',
      persona(data.author),
      'expired',
      'VALID PROPOSAL NOT CHOSEN',
      typeof data.note === 'string'
        ? data.note
        : 'The referee selected a stronger candidate for this wave.',
    )]
  }
  if (event.type === 'patch_scheduled') {
    const proposal = record(data.proposal)
    const mutation = record(proposal?.mutation)
    return [item(
      'scheduled',
      persona(proposal?.author),
      'incoming',
      'OBSTACLE QUEUED',
      typeof mutation?.title === 'string'
        ? `${mutation.title} will deploy at the next safe boundary.`
        : 'The selected patch is waiting for the next safe boundary.',
    )]
  }
  if (event.type === 'patch_activated') {
    const mutation = record(data.mutation)
    return [item('active', persona(mutation?.author), 'active', typeof mutation?.title === 'string' ? mutation.title : 'OBSTACLE LIVE', typeof mutation?.patchNote === 'string' ? mutation.patchNote : 'Game Master obstacle entered the run.')]
  }
  if (event.type === 'patch_expired') {
    return [item('expired', 'system', 'expired', 'PATCH EXPIRED', 'Obstacle window cleaned up; the endless run continued.')]
  }
  if (event.type === 'proposal_failed') {
    const failure = record(data.error)
    return [item('failed', persona(data.persona), 'failed', 'PROVIDER TIMEOUT', typeof failure?.message === 'string' ? failure.message : 'The run continued without waiting for the agent.')]
  }
  return []
}

function Portrait({ index, name }: { index: number; name: string }) {
  return (
    <div className="gm-avatar" role="img" aria-label={`${name} pixel-art portrait`}>
      <img src="/assets/game-master-triptych.png" alt="" style={{ transform: `translateX(-${index * 33.333}%)` }} />
    </div>
  )
}

function StatusBadge({ status: value }: { status: PatchStatus }) {
  return <span className={`status-badge status-${value}`}><i />{statusCopy[value]}</span>
}

export function App() {
  const seededDemo = isSeededDemo()
  const [phase, setPhase] = useState<'ready' | 'starting' | 'playing' | 'gameover' | 'error'>('ready')
  const [live, setLive] = useState<LiveMatchPayload>()
  const [localSnapshot, setLocalSnapshot] = useState<GameStateViewModel>()
  const [transport, setTransport] = useState<'server' | 'local'>('server')
  const [provider, setProvider] = useState<'mock' | 'daytona' | 'local'>('local')
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [stats, setStats] = useState<EndlessRunStats>(emptyStats)
  const [result, setResult] = useState<EndlessRunResult>()
  const [bestScore, setBestScore] = useState(storedBestScore)
  const [runKey, setRunKey] = useState(0)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const lastRunnerTelemetryAt = useRef(-1_000)

  const appendActivity = useCallback((items: ActivityItem[]) => {
    if (items.length === 0) return
    setActivity((current) => {
      const byId = new Map([...current, ...items].map((entry) => [entry.id, entry]))
      return [...byId.values()].slice(-20)
    })
  }, [])

  useEffect(() => {
    if (!live?.matchId) return
    const matchId = live.matchId
    const unsubscribe = subscribeToMatch(
      matchId,
      (event) => appendActivity(activityFromStream(event)),
      (isConnected) => {
        setConnected(isConnected)
        if (isConnected) {
          appendActivity([{
            id: `${matchId}-stream-connected`,
            at: formatClock(Date.now() % 3_600_000),
            author: 'system',
            status: 'validated',
            title: 'EVENT STREAM CONNECTED',
            detail: 'Live server events are flowing into this right-hand system log.',
          }])
        }
      },
    )
    const poll = window.setInterval(() => {
      void getLiveMatch(matchId).then(setLive).catch(() => setConnected(false))
    }, 200)
    return () => {
      window.clearInterval(poll)
      unsubscribe()
    }
  }, [live?.matchId, appendActivity])

  const snapshot = useMemo(
    () => (live ? adaptLiveMatch(live, activity) : localSnapshot),
    [live, activity, localSnapshot],
  )

  useEffect(() => {
    if (transport !== 'local' || phase !== 'playing') return
    const timer = window.setInterval(() => {
      setLocalSnapshot((current) => {
        if (!current) return current
        const currentIndex = localPatchCycle.findIndex(
          (patch) => patch.author === current.activePatch.author,
        )
        const next = localPatchCycle[(currentIndex + 1) % localPatchCycle.length]
        const changedAt = Date.now()
        const nextActivity: ActivityItem = {
          id: `local-active-${changedAt}`,
          at: formatClock(changedAt % 3_600_000),
          author: next.author,
          status: 'active',
          title: next.title,
          detail: 'New typed obstacle deployed during live play.',
        }
        return {
          ...current,
          directors: current.directors.map((director) => ({
            ...director,
            status: director.id === next.author ? 'selected' : 'drafting',
            message: director.id === next.author
              ? `Deploying ${next.title}.`
              : 'Authoring the next typed obstacle.',
          })),
          activePatch: {
            id: `local-${next.author}-${changedAt}`,
            ...next,
            status: 'active',
            durationSeconds: 6,
            difficulty: 1.6,
          },
          activity: [
            ...current.activity,
            nextActivity,
          ].slice(-20),
        }
      })
    }, 2_500)
    return () => window.clearInterval(timer)
  }, [phase, transport])

  const startRun = async () => {
    const previousMatchId = live?.matchId
    setPhase('starting')
    setError('')
    setLive(undefined)
    setLocalSnapshot(undefined)
    setResult(undefined)
    setStats(emptyStats)
    lastRunnerTelemetryAt.current = -1_000
    setActivity([{
      id: `local-drafting-${Date.now()}`,
      at: '00:00',
      author: 'system',
      status: 'drafting',
      title: 'GAME MASTERS DRAFTING',
      detail: 'The runner starts immediately while three agents prepare safe obstacle patches.',
    }])
    if (previousMatchId) void endLiveMatch(previousMatchId).catch(() => undefined)

    try {
      const [created, runtime] = await Promise.all([
        createLiveMatch(seededDemo ? { seed: SEEDED_DEMO_SEED } : {}),
        getRuntimeInfo(),
      ])
      setLive(created)
      setTransport('server')
      setProvider(runtime.provider)
      appendActivity([{
        id: `${created.matchId}-runtime-connected`,
        at: '00:00',
        author: 'system',
        status: 'validated',
        title: 'RUNTIME CHECK PASSED',
        detail: `${runtime.parallelGameMasters} ${runtime.provider.toUpperCase()} game masters connected; validator and safe runtime ready.`,
      }])
      setRunKey((current) => current + 1)
      setPhase('playing')
    } catch {
      const localRunId = Date.now()
      setLocalSnapshot(localDemoSnapshot(localRunId))
      setTransport('local')
      setProvider('local')
      setRunKey((current) => current + 1)
      setPhase('playing')
    }
  }

  const handleStats = useCallback((nextStats: EndlessRunStats) => {
    setStats(nextStats)
    if (!live?.matchId || !nextStats.alive) return
    if (nextStats.elapsedMs - lastRunnerTelemetryAt.current < 1_000) return
    lastRunnerTelemetryAt.current = nextStats.elapsedMs
    void sendRunnerTelemetry(live.matchId, nextStats).catch(() => setConnected(false))
  }, [live?.matchId])

  const handleGameOver = useCallback((nextResult: EndlessRunResult) => {
    setResult(nextResult)
    setBestScore((current) => {
      const nextBest = Math.max(current, nextResult.score)
      try {
        window.localStorage.setItem(BEST_SCORE_KEY, String(nextBest))
      } catch {
        // A blocked storage API should never make the run unplayable.
      }
      return nextBest
    })
    setPhase('gameover')
    if (live?.matchId) {
      void sendRunnerTelemetry(live.matchId, nextResult)
        .catch(() => undefined)
        .finally(() => endLiveMatch(live.matchId).catch(() => undefined))
    }
  }, [live?.matchId])

  if (!snapshot || (phase !== 'playing' && phase !== 'gameover')) {
    return (
      <main className="launch-shell">
        <div className="pixel-sky" aria-hidden="true"><i className="star star-1" /><i className="star star-2" /><i className="star star-3" /></div>
        <section className="launch-card pixel-panel">
          <small>ENDLESS RUNNER // LIVE GAME MASTER PATCHES{seededDemo ? ' // SEEDED DEMO' : ''}</small>
          <h1><span>FORK</span>/FIGHTER</h1>
          <p>Run forever. Grab fork shards. Jump every obstacle. Three long-running Game Masters watch your run and deploy typed, validated traps to end it.</p>
          {bestScore > 0 && <div className="launch-best"><small>PERSONAL BEST</small><strong>{bestScore.toLocaleString('en-GB')}</strong></div>}
          <button type="button" onClick={() => void startRun()} disabled={phase === 'starting'} data-testid="start-run">
            {phase === 'starting' ? 'STARTING RUN…' : phase === 'error' ? 'TRY AGAIN' : seededDemo ? 'START SEEDED DEMO' : 'START LIVE RUN'}
          </button>
          {error && <p className="launch-error" role="alert">{error}</p>}
          <footer>SPACE / W / ↑ / TAP TO JUMP // ONE HIT = GAME OVER // HIGHEST SCORE WINS</footer>
        </section>
      </main>
    )
  }

  const activeAuthor = snapshot.directors.find((director) => director.id === snapshot.activePatch.author)
  const demands = mutationDemands(snapshot.activePatch)
  const isGameOver = phase === 'gameover' && result
  const shellConnected = transport === 'local' || connected
  const patchIndex = live?.match.patchIndex ?? 0

  return (
    <main className="app-shell fixture-run">
      <div className="pixel-sky" aria-hidden="true"><i className="star star-1" /><i className="star star-2" /><i className="star star-3" /></div>
      <header className="topbar pixel-panel">
        <a className="brand" href="#game" aria-label="Fork Fighter home"><span className="brand-fork">FORK</span><span className="brand-slash">/</span><span>FIGHTER</span><small>LIVE PATCH WAR</small></a>
        <div className="pipeline-state" aria-label="Integration pipeline"><span>RUN</span><i>→</i><span>TELEMETRY</span><i>→</i><span>GAME MASTERS</span><i>→</i><span>OBSTACLE</span></div>
        <div className="run-clock"><span className={`live-dot ${shellConnected ? 'connected' : ''}`} /><small>RUN {snapshot.runId}</small><strong>{formatClock(stats.elapsedMs)}</strong></div>
      </header>

      <section className="broadcast-grid" id="game">
        <section className="game-frame pixel-panel">
          <div className="frame-titlebar"><span><i className="flag-pixel" /> ENDLESS FORKWAY</span><span data-testid="run-status">{isGameOver ? 'GAME OVER' : `RUNNING // WAVE ${String(patchIndex + 1).padStart(2, '0')}`}</span></div>
          <div className="game-screen">
            <ArenaCanvas
              key={runKey}
              snapshot={snapshot}
              callbacks={{ onStats: handleStats, onGameOver: handleGameOver }}
            />
            <div className="game-hud" aria-label="Run status">
              <div className="score-box"><small>SCORE</small><b data-testid="live-score">{stats.score.toLocaleString('en-GB')}</b></div>
              <div className="time-box"><small>TIME ALIVE</small><b>{formatSeconds(stats.elapsedMs)}</b></div>
            </div>
            <div className="screen-counter core-counter"><span className="core-gem" /><small>FORK SHARDS</small><b>{String(stats.pickups).padStart(2, '0')}</b></div>
            {snapshot.activePatch.status === 'incoming' && <div className="patch-pop" role="status"><span className="pop-kicker">OBSTACLE IN</span><strong>{String(snapshot.activePatch.countdownSeconds ?? 0).padStart(2, '0')}</strong><i className="pop-arrow">↓</i></div>}
            {isGameOver && (
              <div className="game-over-overlay" role="dialog" aria-label="Final score" data-testid="game-over">
                <small>RUN OVER</small>
                <h2>FINAL SCORE</h2>
                <div className="score-breakdown">
                  <span>TIME: {formatSeconds(result.elapsedMs)}</span><b>+{result.timeScore.toLocaleString('en-GB')}</b>
                  <span>FORK SHARDS: {result.pickups}</span><b>+{result.pickupScore.toLocaleString('en-GB')}</b>
                </div>
                <strong>{result.score.toLocaleString('en-GB')}</strong>
                <p className="best-score">PERSONAL BEST: {bestScore.toLocaleString('en-GB')}</p>
                <p>KILLED BY: {result.killer.author.toUpperCase()} — {result.killer.title}</p>
                <button type="button" onClick={() => void startRun()} data-testid="restart-run">RESTART RUN</button>
              </div>
            )}
          </div>
          <footer className="game-footer endless-footer">
            <div className="control-hint"><kbd className="tap-key">TAP</kbd><kbd className="keyboard-key">SPACE</kbd><kbd className="keyboard-key">W</kbd><kbd className="keyboard-key">↑</kbd><span>JUMP</span></div>
            <div className="command-stream"><i /> AUTO-RUN: {isGameOver ? 'STOPPED' : 'FULL SPEED'}</div>
            <div className={`dash-state ${stats.alive ? 'ready' : ''}`}>ONE HIT = DEATH</div>
          </footer>
        </section>

        <aside className={`executor-rail pixel-panel executor-${snapshot.activePatch.author}`} aria-label="Live patch activity">
          <header className="executor-title"><span>GAME MASTER SIGNAL</span><i className="signal-light" /></header>
          <section className={`executor-card patch-${snapshot.activePatch.status}`} data-testid="patch-card" data-status={snapshot.activePatch.status}>
            <div className="executor-portrait"><Portrait index={snapshot.activePatch.author === 'architect' ? 0 : snapshot.activePatch.author === 'gremlin' ? 1 : 2} name={activeAuthor?.name ?? snapshot.activePatch.author} /><span className="portrait-scan" aria-hidden="true" /></div>
            <div className="executor-copy"><small>{snapshot.activePatch.status === 'incoming' ? 'NEXT ATTACKER' : snapshot.activePatch.status === 'expired' ? 'LAST ATTACKER' : 'ATTACKING AS'}</small><h2>{activeAuthor?.name ?? snapshot.activePatch.author.toUpperCase()}</h2><StatusBadge status={snapshot.activePatch.status} /></div>
            <div className="execution-rule" /><small className="change-label">REFEREE-ORDERED DEMAND</small><h3>{snapshot.activePatch.title}</h3><p className="patch-note">{snapshot.activePatch.note}</p>
            {demands.length > 0 && <div className="demand-list" data-testid="patch-demands">{demands.map((demand) => <span key={demand}>{demand}</span>)}</div>}
            {snapshot.activePatch.status === 'active' && <div className="referee-stamp">VALIDATOR APPROVED · 1 PATCH LIVE</div>}
            {snapshot.activePatch.countdownSeconds !== undefined && <div className="executor-countdown"><span>DEPLOYS IN</span><b>00:{String(snapshot.activePatch.countdownSeconds).padStart(2, '0')}</b></div>}
          </section>
          <section className="director-stack" aria-label="Game master statuses">
            {snapshot.directors.map((director) => <div className="director-row" key={director.id} data-testid={`agent-${director.id}`} data-status={director.status}><span style={{ background: director.accent }} /><b>{director.name}</b><StatusBadge status={director.status} /></div>)}
          </section>
          <section className="system-log" data-testid="system-log" aria-label="Live system log">
            <header className="system-log-header">
              <div><small>RIGHT-HAND PROOF FEED</small><strong data-testid="system-log-title">LIVE SYSTEM LOG</strong></div>
              <span className={`system-log-status ${shellConnected ? 'online' : ''}`} data-testid="system-log-status"><i />{transport === 'local' ? 'FAILSAFE LIVE' : connected ? 'STREAM LIVE' : 'RECONNECTING'}</span>
            </header>
            <div className="system-log-health" aria-label="Live subsystem status">
              <span><i />GAME LOOP</span>
              <span><i />VALIDATOR</span>
              <span data-testid="system-log-provider"><i />{provider.toUpperCase()} // {snapshot.directors.length} AGENTS</span>
            </div>
            <div className="system-log-meta" data-testid="system-log-event-count">{String(snapshot.activity.length).padStart(2, '0')} EVENTS // NEWEST FIRST</div>
            <ol className="activity-feed" data-testid="activity-feed" aria-live="polite" aria-relevant="additions text">
              {snapshot.activity.slice().reverse().map((entry, index) => <li key={entry.id} data-status={entry.status} data-testid={`activity-${entry.status}`}><small><b>#{String(snapshot.activity.length - index).padStart(2, '0')}</b>{entry.at} // {entry.author.toUpperCase()}</small><strong>{entry.title}</strong><span>{entry.detail}</span></li>)}
            </ol>
          </section>
        </aside>
      </section>
      <footer className="page-footer"><span>{seededDemo ? 'SEEDED DEMO // ' : ''}TYPED OBSTACLES ONLY</span><span className="shell-safe"><i /> GAME SHELL {transport === 'local' ? 'FAILSAFE' : connected ? 'LIVE' : 'RECONNECTING'}</span><span>{provider === 'daytona' ? 'DAYTONA // 3 PARALLEL CODEX WORKERS' : provider === 'mock' ? 'LOCAL MOCK GAME MASTERS' : 'LOCAL DEMO FALLBACK'}</span></footer>
    </main>
  )
}
