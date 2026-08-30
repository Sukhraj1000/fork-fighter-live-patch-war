import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GameMasterPersona, PlayerCommand } from '@fork-fighter/contracts'
import {
  createLiveMatch,
  getLiveMatch,
  sendPlayerCommand,
  subscribeToMatch,
} from './api/live-match-client'
import { ArenaCanvas } from './components/ArenaCanvas'
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

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds)
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

function commandLabel(command: PlayerCommand) {
  if (command.type === 'wait') return 'WAIT'
  const x = Math.sign(command.direction.x)
  const y = Math.sign(command.direction.y)
  const direction = x < 0 ? 'LEFT' : x > 0 ? 'RIGHT' : y < 0 ? 'UP' : 'DOWN'
  return `${command.type.toUpperCase()}_${direction}`
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
  const at = formatTime(Math.floor(Date.now() / 1_000) % 3_600)
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
    return [
      item(
        'agent',
        persona(data.persona),
        itemStatus,
        itemStatus === 'drafting' ? 'DRAFTING PATCH' : `AGENT ${statusCopy[itemStatus]}`,
        typeof data.message === 'string' ? data.message : 'Typed proposal cycle updated.',
      ),
    ]
  }

  if (event.type === 'proposal_received') {
    const proposal = record(data.proposal)
    const mutation = record(proposal?.mutation)
    return [item('proposal', persona(proposal?.author), 'validated', typeof mutation?.title === 'string' ? mutation.title : 'PROPOSAL RECEIVED', 'Typed proposal reached the validator.')]
  }
  if (event.type === 'proposal_rejected') {
    const reasons = Array.isArray(data.reasons) ? data.reasons : []
    const reason = record(reasons[0])
    return [item('rejected', persona(data.author), 'rejected', 'PATCH REJECTED', typeof reason?.message === 'string' ? reason.message : 'Safety gate rejected the proposal.')]
  }
  if (event.type === 'proposal_selected') {
    return [item('selected', persona(data.author), 'selected', 'PATCH SELECTED', typeof data.mutationId === 'string' ? data.mutationId : 'Best valid challenge fit.')]
  }
  if (event.type === 'patch_activated') {
    const mutation = record(data.mutation)
    return [item('active', persona(mutation?.author), 'active', typeof mutation?.title === 'string' ? mutation.title : 'PATCH LIVE', typeof mutation?.patchNote === 'string' ? mutation.patchNote : 'Mutation applied without pausing play.')]
  }
  if (event.type === 'patch_expired') {
    return [item('expired', 'system', 'expired', 'PATCH EXPIRED', 'Cleanup completed and base rules remain playable.')]
  }
  if (event.type === 'proposal_failed') {
    const failure = record(data.error)
    return [item('failed', persona(data.persona), 'failed', 'PROVIDER TIMEOUT', typeof failure?.message === 'string' ? failure.message : 'The run continued on the stable game shell.')]
  }
  if (event.type === 'event_batch_ingested') {
    const batch = record(data.batch)
    const events = Array.isArray(batch?.events) ? batch.events : []
    return events.flatMap((raw, index) => {
      const gameEvent = record(raw)
      if (gameEvent?.type === 'patch_effect_applied') {
        return [item(`effect-${index}`, 'system', 'active', 'MUTATION TRIGGERED', `${String(gameEvent.effect)} applied to live game-core state.`)]
      }
      if (gameEvent?.type === 'extraction_completed') {
        return [item(`extract-${index}`, 'system', 'validated', 'EXTRACTION COMPLETE', 'The deterministic objective loop completed.')]
      }
      if (gameEvent?.type === 'player_died') {
        return [item(`death-${index}`, 'system', 'rejected', 'RUNNER DOWN', 'Deterministic respawn preserved the run.')]
      }
      return []
    })
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
  const [phase, setPhase] = useState<'ready' | 'starting' | 'playing' | 'error'>('ready')
  const [live, setLive] = useState<LiveMatchPayload>()
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [lastCommand, setLastCommand] = useState('WAIT')
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const commandInFlight = useRef(false)

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
    }, 160)
    return () => {
      window.clearInterval(poll)
      unsubscribe()
    }
  }, [live?.matchId, appendActivity])

  const snapshot = useMemo(() => (live ? adaptLiveMatch(live, activity) : undefined), [live, activity])

  const startRun = async () => {
    setPhase('starting')
    setError('')
    setActivity([{
      id: 'local-drafting',
      at: '00:00',
      author: 'system',
      status: 'drafting',
      title: 'AGENTS DRAFTING',
      detail: 'Playable game-core started before provider work completed.',
    }])
    try {
      const created = await createLiveMatch()
      setLive(created)
      setPhase('playing')
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Could not start the live run.')
      setPhase('error')
    }
  }

  const sendCommand = (command: PlayerCommand) => {
    if (!live || commandInFlight.current || live.game.status !== 'running') return
    commandInFlight.current = true
    setLastCommand(commandLabel(command))
    void sendPlayerCommand(live.matchId, command)
      .catch(() => setConnected(false))
      .finally(() => { commandInFlight.current = false })
  }

  if (!snapshot || !live || phase !== 'playing') {
    return (
      <main className="launch-shell">
        <div className="pixel-sky" aria-hidden="true"><i className="star star-1" /><i className="star star-2" /><i className="star star-3" /></div>
        <section className="launch-card pixel-panel">
          <small>DETERMINISTIC CORE // LIVE AGENT PATCHES</small>
          <h1><span>FORK</span>/FIGHTER</h1>
          <p>Move, collect three cores, bank them at the relay, and extract. While you play, three game masters draft typed mutations behind seven safety gates.</p>
          <button type="button" onClick={() => void startRun()} disabled={phase === 'starting'} data-testid="start-run">
            {phase === 'starting' ? 'STARTING CORE…' : 'START LIVE RUN'}
          </button>
          {error && <p className="launch-error" role="alert">{error}</p>}
          <footer>MOCK PROVIDER BY DEFAULT // DAYTONA OPTIONAL // GAMEPLAY NEVER WAITS</footer>
        </section>
      </main>
    )
  }

  const timeRemaining = snapshot.totalSeconds - snapshot.elapsedSeconds
  const filledHearts = Math.ceil(snapshot.health / 20)
  const activeAuthor = snapshot.directors.find((director) => director.id === snapshot.activePatch.author)
  const extracted = live.game.extraction.completed

  return (
    <main className={`app-shell fixture-${snapshot.fixture}`}>
      <div className="pixel-sky" aria-hidden="true"><i className="star star-1" /><i className="star star-2" /><i className="star star-3" /></div>
      <header className="topbar pixel-panel">
        <a className="brand" href="#game" aria-label="Fork Fighter home"><span className="brand-fork">FORK</span><span className="brand-slash">/</span><span>FIGHTER</span><small>LIVE PATCH WAR</small></a>
        <div className="pipeline-state" aria-label="Integration pipeline"><span>CORE</span><i>→</i><span>TELEMETRY</span><i>→</i><span>VALIDATOR</span><i>→</i><span>RUNTIME</span></div>
        <div className="run-clock"><span className={`live-dot ${connected ? 'connected' : ''}`} /><small>RUN {snapshot.runId}</small><strong>{formatTime(timeRemaining)}</strong></div>
      </header>

      <section className="broadcast-grid" id="game">
        <section className="game-frame pixel-panel">
          <div className="frame-titlebar"><span><i className="flag-pixel" /> {snapshot.sector}</span><span data-testid="run-status">{extracted ? 'EXTRACTED' : `PATCH WINDOW ${String(live.match.patchIndex + 1).padStart(2, '0')}`}</span></div>
          <div className="game-screen">
            <ArenaCanvas snapshot={snapshot} onCommand={sendCommand} />
            <div className="game-hud" aria-label="Run status">
              <div className="heart-row" aria-label={`${snapshot.health} percent health`}>{Array.from({ length: 5 }, (_, index) => <span className={index < filledHearts ? 'heart-full' : 'heart-empty'} key={index}>♥</span>)}</div>
              <div className="score-box"><small>SCORE</small><b>{snapshot.score.toLocaleString('en-GB')}</b></div>
              <div className="time-box"><small>TIME</small><b>{formatTime(timeRemaining)}</b></div>
            </div>
            <div className="screen-counter core-counter"><span className="core-gem" /><small>HELD</small><b>{String(snapshot.coresHeld).padStart(2, '0')}</b></div>
            <div className="screen-counter bank-counter"><span className="bank-icon">B</span><small>BANK</small><b>{snapshot.coresBanked}/{snapshot.coresRequired}</b></div>
            {snapshot.activePatch.status === 'incoming' && <div className="patch-pop" role="status"><span className="pop-kicker">PATCH IN</span><strong>{String(snapshot.activePatch.countdownSeconds ?? 0).padStart(2, '0')}</strong><i className="pop-arrow">↓</i></div>}
            {extracted && <div className="extract-pop" role="status"><small>ALL CORES BANKED!</small><strong>RUN EXTRACTED ✓</strong></div>}
          </div>
          <footer className="game-footer">
            <div className="control-hint"><kbd>A</kbd><kbd>D</kbd><span>RUN</span><kbd>W</kbd><kbd>S</kbd><span>MOVE</span><kbd>SPACE</kbd><span>DASH</span></div>
            <div className="command-stream"><i /> INPUT: {lastCommand}</div>
            <div className={`dash-state ${snapshot.dashReady ? 'ready' : ''}`}>DASH {snapshot.dashReady ? 'READY!' : 'CHARGING'}</div>
          </footer>
        </section>

        <aside className={`executor-rail pixel-panel executor-${snapshot.activePatch.author}`} aria-label="Live patch activity">
          <header className="executor-title"><span>PATCH SIGNAL</span><i className="signal-light" /></header>
          <section className={`executor-card patch-${snapshot.activePatch.status}`} data-testid="patch-card" data-status={snapshot.activePatch.status}>
            <div className="executor-portrait"><Portrait index={snapshot.activePatch.author === 'architect' ? 0 : snapshot.activePatch.author === 'gremlin' ? 1 : 2} name={activeAuthor?.name ?? ''} /><span className="portrait-scan" aria-hidden="true" /></div>
            <div className="executor-copy"><small>{snapshot.activePatch.status === 'incoming' ? 'NEXT EXECUTOR' : snapshot.activePatch.status === 'expired' ? 'LAST EXECUTOR' : 'EXECUTED BY'}</small><h2>{activeAuthor?.name}</h2><StatusBadge status={snapshot.activePatch.status} /></div>
            <div className="execution-rule" /><small className="change-label">CHANGE</small><h3>{snapshot.activePatch.title}</h3><p className="patch-note">{snapshot.activePatch.note}</p>
            {snapshot.activePatch.countdownSeconds !== undefined && <div className="executor-countdown"><span>IN</span><b>00:{String(snapshot.activePatch.countdownSeconds).padStart(2, '0')}</b></div>}
          </section>
          <section className="director-stack" aria-label="Game master statuses">
            {snapshot.directors.map((director) => <div className="director-row" key={director.id} data-testid={`agent-${director.id}`} data-status={director.status}><span style={{ background: director.accent }} /><b>{director.name}</b><StatusBadge status={director.status} /></div>)}
          </section>
          <ol className="activity-feed" data-testid="activity-feed">
            {snapshot.activity.slice().reverse().map((entry) => <li key={entry.id} data-status={entry.status} data-testid={`activity-${entry.status}`}><small>{entry.at} // {entry.author.toUpperCase()}</small><strong>{entry.title}</strong><span>{entry.detail}</span></li>)}
          </ol>
        </aside>
      </section>
      <footer className="page-footer"><span>MOCK PATH // NO DAYTONA REQUIRED</span><span className="shell-safe"><i /> GAME SHELL {connected ? 'LIVE' : 'RECONNECTING'}</span><span>SSE STATUS // SERVER-AUTHORITATIVE CORE</span></footer>
    </main>
  )
}
