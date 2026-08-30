import { useMemo, useState } from 'react'
import { ArenaCanvas } from './components/ArenaCanvas'
import { MOCK_RUNS } from './fixtures/mock-game-state'
import { type FixtureMode, type PatchStatus, type PlayerCommand } from './model/view-models'

const fixtureLabels: Record<FixtureMode, string> = {
  run: 'RUN VIEW',
  patch: 'PATCH HIT',
  extract: 'EXTRACT!',
}

const statusCopy: Record<PatchStatus, string> = {
  drafting: 'DRAFT',
  rejected: 'NOPE',
  validated: 'SAFE',
  selected: 'PICKED',
  incoming: 'NEXT',
  active: 'LIVE',
  expired: 'DONE',
}

function formatTime(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function commandLabel(command: PlayerCommand) {
  if (command.type === 'move') return `MOVE_${command.direction.toUpperCase()}`
  return command.type.toUpperCase()
}

function Portrait({ index, name }: { index: number; name: string }) {
  return (
    <div className="gm-avatar" role="img" aria-label={`${name} pixel-art portrait`}>
      <img
        src="/assets/game-master-triptych.png"
        alt=""
        style={{ transform: `translateX(-${index * 33.333}%)` }}
      />
    </div>
  )
}

function StatusBadge({ status }: { status: PatchStatus }) {
  return <span className={`status-badge status-${status}`}><i />{statusCopy[status]}</span>
}

export function App() {
  const [fixture, setFixture] = useState<FixtureMode>('patch')
  const [lastCommand, setLastCommand] = useState('DEMO_LOOP')
  const snapshot = MOCK_RUNS[fixture]
  const timeRemaining = snapshot.totalSeconds - snapshot.elapsedSeconds
  const filledHearts = Math.ceil(snapshot.health / 20)

  const activeAuthor = useMemo(
    () => snapshot.directors.find((director) => director.id === snapshot.activePatch.author),
    [snapshot],
  )

  return (
    <main className={`app-shell fixture-${fixture}`}>
      <div className="pixel-sky" aria-hidden="true">
        <i className="star star-1" /><i className="star star-2" /><i className="star star-3" />
      </div>

      <header className="topbar pixel-panel">
        <a className="brand" href="#game" aria-label="Fork Fighter home">
          <span className="brand-fork">FORK</span><span className="brand-slash">/</span><span>FIGHTER</span>
          <small>LIVE PATCH WAR</small>
        </a>

        <nav className="fixture-tabs" aria-label="Design fixture views">
          {(Object.keys(fixtureLabels) as FixtureMode[]).map((mode) => (
            <button
              type="button"
              className={fixture === mode ? 'active' : ''}
              onClick={() => setFixture(mode)}
              aria-pressed={fixture === mode}
              key={mode}
            >
              {fixtureLabels[mode]}
            </button>
          ))}
        </nav>

        <div className="run-clock">
          <span className="live-dot" />
          <small>RUN {snapshot.runId}</small>
          <strong>{formatTime(timeRemaining)}</strong>
        </div>
      </header>

      <section className="broadcast-grid" id="game">
        <section className="game-frame pixel-panel">
          <div className="frame-titlebar">
            <span><i className="flag-pixel" /> {snapshot.sector}</span>
            <span>PATCH WINDOW 04</span>
          </div>

          <div className="game-screen">
            <ArenaCanvas
              snapshot={snapshot}
              onCommand={(command) => setLastCommand(commandLabel(command))}
            />

            <div className="game-hud" aria-label="Run status">
              <div className="heart-row" aria-label={`${snapshot.health} percent health`}>
                {Array.from({ length: 5 }, (_, index) => (
                  <span className={index < filledHearts ? 'heart-full' : 'heart-empty'} key={index}>♥</span>
                ))}
              </div>
              <div className="score-box"><small>SCORE</small><b>{snapshot.score.toLocaleString('en-GB')}</b></div>
              <div className="time-box"><small>TIME</small><b>{formatTime(timeRemaining)}</b></div>
            </div>

            <div className="screen-counter core-counter">
              <span className="core-gem" />
              <small>HELD</small><b>{String(snapshot.coresHeld).padStart(2, '0')}</b>
            </div>
            <div className="screen-counter bank-counter">
              <span className="bank-icon">B</span>
              <small>BANK</small><b>{snapshot.coresBanked}/{snapshot.coresRequired}</b>
            </div>

            {fixture === 'patch' && (
              <div className="patch-pop" role="status">
                <span className="pop-kicker">PATCH IN</span>
                <strong>{String(snapshot.activePatch.countdownSeconds ?? 0).padStart(2, '0')}</strong>
                <i className="pop-arrow">↓</i>
              </div>
            )}

            {fixture === 'extract' && (
              <div className="extract-pop" role="status">
                <small>ALL CORES BANKED!</small>
                <strong>RUN TO EXIT →</strong>
              </div>
            )}
          </div>

          <footer className="game-footer">
            <div className="control-hint"><kbd>A</kbd><kbd>D</kbd><span>RUN</span><kbd>W</kbd><span>JUMP</span><kbd>SPACE</kbd><span>DASH</span></div>
            <div className="command-stream"><i /> INPUT: {lastCommand}</div>
            <div className={`dash-state ${snapshot.dashReady ? 'ready' : ''}`}>DASH {snapshot.dashReady ? 'READY!' : 'CHARGING'}</div>
          </footer>
        </section>

        <aside className={`executor-rail pixel-panel executor-${snapshot.activePatch.author}`} aria-label="Patch executor">
          <header className="executor-title">
            <span>PATCH SIGNAL</span>
            <i className="signal-light" />
          </header>

          <section className={`executor-card patch-${snapshot.activePatch.status}`}>
            <div className="executor-portrait">
              <Portrait
                index={snapshot.activePatch.author === 'architect' ? 0 : snapshot.activePatch.author === 'gremlin' ? 1 : 2}
                name={activeAuthor?.name ?? ''}
              />
              <span className="portrait-scan" aria-hidden="true" />
            </div>

            <div className="executor-copy">
              <small>
                {snapshot.activePatch.status === 'incoming'
                  ? 'NEXT EXECUTOR'
                  : snapshot.activePatch.status === 'expired'
                    ? 'LAST EXECUTOR'
                    : 'EXECUTED BY'}
              </small>
              <h2>{activeAuthor?.name}</h2>
              <StatusBadge status={snapshot.activePatch.status} />
            </div>

            <div className="execution-rule" />
            <small className="change-label">CHANGE</small>
            <h3>{snapshot.activePatch.title}</h3>

            {snapshot.activePatch.countdownSeconds !== undefined && (
              <div className="executor-countdown">
                <span>IN</span>
                <b>00:{String(snapshot.activePatch.countdownSeconds).padStart(2, '0')}</b>
              </div>
            )}

            <div className="animation-slot" aria-hidden="true">
              <i /><i /><i />
            </div>
          </section>
        </aside>
      </section>

      <footer className="page-footer">
        <span>FIXTURE STATE // PRESENTATION ONLY</span>
        <span className="shell-safe"><i /> GAME SHELL SAFE</span>
        <span>NO RULES IN VISUAL CODE</span>
      </footer>
    </main>
  )
}
