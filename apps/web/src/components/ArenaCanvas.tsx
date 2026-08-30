import { useEffect, useRef } from 'react'
import type { GameStateViewModel, PlayerCommand } from '../model/view-models'
import type { RunnerGameHandle } from '../game/create-runner-game'

type ArenaCanvasProps = {
  snapshot: GameStateViewModel
  onCommand: (command: PlayerCommand) => void
}

export function ArenaCanvas({ snapshot, onCommand }: ArenaCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<RunnerGameHandle | null>(null)
  const commandRef = useRef(onCommand)
  commandRef.current = onCommand

  useEffect(() => {
    let cancelled = false

    void import('../game/create-runner-game').then(({ createRunnerGame }) => {
      if (cancelled || !hostRef.current) return
      handleRef.current = createRunnerGame(hostRef.current, snapshot, (command) => commandRef.current(command))
    })

    return () => {
      cancelled = true
      handleRef.current?.game.destroy(true)
      handleRef.current = null
    }
  }, [])

  useEffect(() => {
    handleRef.current?.updateSnapshot(snapshot)
  }, [snapshot])

  return (
    <div
      className="arena-canvas"
      ref={hostRef}
      role="img"
      aria-label={`${snapshot.sector} side-scrolling runner arena. Player is in ${snapshot.player.motion} motion with ${snapshot.coresHeld} cores and ${snapshot.health} health.`}
    >
      <div className="loading-sprite" aria-hidden="true">LOADING RUN...</div>
    </div>
  )
}
