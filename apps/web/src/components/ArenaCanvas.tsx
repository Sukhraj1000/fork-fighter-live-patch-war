import { useEffect, useRef } from 'react'
import type { EndlessRunCallbacks } from '../model/endless-run'
import type { GameStateViewModel } from '../model/view-models'
import type { RunnerGameHandle } from '../game/create-runner-game'

type ArenaCanvasProps = {
  snapshot: GameStateViewModel
  callbacks: EndlessRunCallbacks
}

export function ArenaCanvas({ snapshot, callbacks }: ArenaCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<RunnerGameHandle | null>(null)
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  useEffect(() => {
    let cancelled = false

    void import('../game/create-runner-game').then(({ createRunnerGame }) => {
      if (cancelled || !hostRef.current) return
      handleRef.current = createRunnerGame(hostRef.current, snapshot, {
        onStats: (stats) => callbacksRef.current.onStats(stats),
        onGameOver: (result) => callbacksRef.current.onGameOver(result),
      })
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
      role="application"
      tabIndex={0}
      aria-label={`${snapshot.sector} endless runner arena. Press Space, W, Up, or tap the arena to jump over Game Master obstacles and collect fork shards.`}
    >
      <div className="loading-sprite" aria-hidden="true">LOADING RUN...</div>
    </div>
  )
}
