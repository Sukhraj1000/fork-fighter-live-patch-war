import Phaser from 'phaser'
import type { EndlessRunCallbacks } from '../model/endless-run'
import type { GameStateViewModel } from '../model/view-models'
import { RunnerScene } from './RunnerScene'

export type RunnerGameHandle = {
  game: Phaser.Game
  updateSnapshot: (snapshot: GameStateViewModel) => void
}

export function createRunnerGame(
  parent: HTMLElement,
  snapshot: GameStateViewModel,
  callbacks: EndlessRunCallbacks,
): RunnerGameHandle {
  const scene = new RunnerScene(snapshot, callbacks)
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 960,
    height: 540,
    backgroundColor: '#79d7ff',
    pixelArt: true,
    antialias: false,
    roundPixels: true,
    banner: false,
    audio: { noAudio: true },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene,
  })

  return {
    game,
    updateSnapshot: (nextSnapshot) => scene.applySnapshot(nextSnapshot),
  }
}
