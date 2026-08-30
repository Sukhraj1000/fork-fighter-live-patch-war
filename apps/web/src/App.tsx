import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GameMasterPersona } from '@fork-fighter/contracts'
import {
  createLiveMatch,
  endLiveMatch,
  getLiveMatch,
  subscribeToMatch,
} from './api/live-match-client'
import { ArenaCanvas } from './components/ArenaCanvas'
import type { EndlessRunResult, EndlessRunStats } from './model/endless-run'
import type { LiveMatchPayload, MatchStreamEvent } from './model/live-match'
import { adaptLiveMatch } from './model/live-view-adapter'
import type { ActivityItem, PatchStatus } from './model/view-models'

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
  const [phase, setPhase] = useState<'ready' | 'starting' | 'playing' | 'gameover' | 'error'>('ready')
  const [live, setLive] = useState<LiveMatchPayload>()
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [stats, setStats] = useState<EndlessRunStats>(emptyStats)
  const [result, setResult] = useState<EndlessRunResult>()
  const [runKey, setRunKey] = useState(0)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')

  const appendActivity = useCallback((items: ActivityItem[]) => {
    if (items.length === 0) return
    setActivity((current) => {
      const byId = new Map([...current, ...items].map((entry) => [entry.id, entry]))
      return [...byId.values()].slice(-10)
    })
  }, [])

  useEffect(() => {
    if (!live?.matchId) return
    const matchId = live.matchId
    const unsubscribe = subscribeToMatch(matchId, (event) => appendActivity(activityFromStream(event)), setConnected)
    const poll = window.setInterval(() => {
      void getLiveMatch(matchId).then(setLive).catch(() => setConnected(false))
    }, 200)
    return () => {
      window.clearInterval(poll)
      unsubscribe()
    }
  }, [live?.matchId, appendActivity])

  const snapshot = useMemo(() => (live ? adaptLiveMatch(live, activity) : undefined), [live, activity])

  const startRun = async () => {
    const previousMatchId = live?.matchId
    setPhase('starting')
    setError('')
    setResult(undefined)
    setStats(emptyStats)
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
      const created = await createLiveMatch()
      setLive(created)
      setRunKey((current) => current + 1)
      setPhase('playing')
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Could not start the live run.')
      setPhase('error')
    }
  }

  const handleGameOver = useCallback((nextResult: EndlessRunResult) => {
    setResult(nextResult)
    setPhase('gameover')
    if (live?.matchId) void endLiveMatch(live.matchId).catch(() => undefined)
  }, [live?.matchId])

  if (!snapshot || !live || (phase !== 'playing' && phase !== 'gameover')) {
    return (
      <main className="launch-shell">
        <div className="pixel-sky" aria-hidden="true"><i className="star star-1" /><i className="star star-2" /><i className="star star-3" /></div>
        <section className="launch-card pixel-panel">
          <small>ENDLESS RUNNER // LIVE GAME MASTER PATCHES</small>
          <h1><span>FORK</span>/FIGHTER</h1>
          <p>Run forever. Grab fork shards. Jump every obstacle. Three long-running Game Masters watch your run and deploy typed, validated traps to end it.</p>
          <button type="button" onClick={() => void startRun()} disabled={phase === 'starting'} data-testid="start-run">
            {phase === 'starting' ? 'STARTING RUN…' : phase === 'error' ? 'TRY AGAIN' : 'START LIVE RUN'}
          </button>
          {error && <p className="launch-error" role="alert">{error}</p>}
          <footer>SPACE / W / ↑ TO JUMP // ONE HIT = GAME OVER // HIGHEST SCORE WINS</footer>
        </section>
      </main>
    )
  }

  const activeAuthor = snapshot.directors.find((director) => director.id === snapshot.activePatch.author)
  const isGameOver = phase === 'gameover' && result

  return (
    <main className="app-shell fixture-run">
      <div className="pixel-sky" aria-hidden="true"><i className="star star-1" /><i className="star star-2" /><i className="star star-3" /></div>
      <header className="topbar pixel-panel">
        <a className="brand" href="#game" aria-label="Fork Fighter home"><span className="brand-fork">FORK</span><span className="brand-slash">/</span><span>FIGHTER</span><small>LIVE PATCH WAR</small></a>
        <div className="pipeline-state" aria-label="Integration pipeline"><span>RUN</span><i>→</i><span>TELEMETRY</span><i>→</i><span>GAME MASTERS</span><i>→</i><span>OBSTACLE</span></div>
        <div className="run-clock"><span className={`live-dot ${connected ? 'connected' : ''}`} /><small>RUN {snapshot.runId}</small><strong>{formatClock(stats.elapsedMs)}</strong></div>
      </header>

      <section className="broadcast-grid" id="game">
        <section className="game-frame pixel-panel">
          <div className="frame-titlebar"><span><i className="flag-pixel" /> ENDLESS FORKWAY</span><span data-testid="run-status">{isGameOver ? 'GAME OVER' : `RUNNING // WAVE ${String(live.match.patchIndex + 1).padStart(2, '0')}`}</span></div>
          <div className="game-screen">
            <ArenaCanvas
              key={runKey}
              snapshot={snapshot}
              callbacks={{ onStats: setStats, onGameOver: handleGameOver }}
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
                <p>KILLED BY: {result.killer.author.toUpperCase()} — {result.killer.title}</p>
                <button type="button" onClick={() => void startRun()} data-testid="restart-run">RESTART RUN</button>
              </div>
            )}
          </div>
          <footer className="game-footer endless-footer">
            <div className="control-hint"><kbd>SPACE</kbd><kbd>W</kbd><kbd>↑</kbd><span>JUMP</span></div>
            <div className="command-stream"><i /> AUTO-RUN: {isGameOver ? 'STOPPED' : 'FULL SPEED'}</div>
            <div className={`dash-state ${stats.alive ? 'ready' : ''}`}>ONE HIT = DEATH</div>
          </footer>
        </section>

        <aside className={`executor-rail pixel-panel executor-${snapshot.activePatch.author}`} aria-label="Live patch activity">
          <header className="executor-title"><span>GAME MASTER SIGNAL</span><i className="signal-light" /></header>
          <section className={`executor-card patch-${snapshot.activePatch.status}`} data-testid="patch-card" data-status={snapshot.activePatch.status}>
            <div className="executor-portrait"><Portrait index={snapshot.activePatch.author === 'architect' ? 0 : snapshot.activePatch.author === 'gremlin' ? 1 : 2} name={activeAuthor?.name ?? snapshot.activePatch.author} /><span className="portrait-scan" aria-hidden="true" /></div>
            <div className="executor-copy"><small>{snapshot.activePatch.status === 'incoming' ? 'NEXT ATTACKER' : snapshot.activePatch.status === 'expired' ? 'LAST ATTACKER' : 'ATTACKING AS'}</small><h2>{activeAuthor?.name ?? snapshot.activePatch.author.toUpperCase()}</h2><StatusBadge status={snapshot.activePatch.status} /></div>
            <div className="execution-rule" /><small className="change-label">OBSTACLE PATCH</small><h3>{snapshot.activePatch.title}</h3><p className="patch-note">{snapshot.activePatch.note}</p>
            {snapshot.activePatch.countdownSeconds !== undefined && <div className="executor-countdown"><span>DEPLOYS IN</span><b>00:{String(snapshot.activePatch.countdownSeconds).padStart(2, '0')}</b></div>}
          </section>
          <section className="director-stack" aria-label="Game master statuses">
            {snapshot.directors.map((director) => <div className="director-row" key={director.id} data-testid={`agent-${director.id}`} data-status={director.status}><span style={{ background: director.accent }} /><b>{director.name}</b><StatusBadge status={director.status} /></div>)}
          </section>
          <ol className="activity-feed" data-testid="activity-feed">
            {snapshot.activity.slice().reverse().map((entry) => <li key={entry.id} data-status={entry.status} data-testid={`activity-${entry.status}`}><small>{entry.at} // {entry.author.toUpperCase()}</small><strong>{entry.title}</strong><span>{entry.detail}</span></li>)}
          </ol>
        </aside>
      </section>
      <footer className="page-footer"><span>TYPED OBSTACLES ONLY</span><span className="shell-safe"><i /> GAME SHELL {connected ? 'LIVE' : 'RECONNECTING'}</span><span>LONG-RUNNING DAYTONA GAME MASTERS</span></footer>
    </main>
  )
}
