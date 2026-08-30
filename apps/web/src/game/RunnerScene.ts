import Phaser from 'phaser'
import type { GameMasterPersona } from '@fork-fighter/contracts'
import type {
  EndlessRunCallbacks,
  EndlessRunStats,
  ObstacleKind,
  ObstaclePatch,
} from '../model/endless-run'
import { obstaclePatchFromView } from '../model/endless-run'
import type { GameStateViewModel } from '../model/view-models'

const WIDTH = 960
const HEIGHT = 540
const GROUND_Y = 418
const PLAYER_X = 148
const PLAYER_GROUND_Y = GROUND_Y - 42
const GRAVITY = 2_050
const JUMP_VELOCITY = -770

const COLORS = {
  navy: 0x17214a,
  navyDark: 0x0a1230,
  sky: 0x79d7ff,
  skyLight: 0xc8f4ff,
  mint: 0x5ee7b7,
  blue: 0x58a6ff,
  pink: 0xf45aa5,
  gold: 0xffd166,
  cream: 0xfff4d6,
  purple: 0x7746aa,
  grass: 0x45c994,
  red: 0xef476f,
}

type MovingObstacle = {
  view: Phaser.GameObjects.Container
  width: number
  height: number
  kind: ObstacleKind
  author: GameMasterPersona
  title: string
  phase: number
  baseY: number
}

type MovingPickup = {
  view: Phaser.GameObjects.Container
  radius: number
}

type RunnerKeys = {
  jump: Phaser.Input.Keyboard.Key
  up: Phaser.Input.Keyboard.Key
  w: Phaser.Input.Keyboard.Key
}

export class RunnerScene extends Phaser.Scene {
  private snapshot: GameStateViewModel
  private readonly callbacks: EndlessRunCallbacks
  private player?: Phaser.GameObjects.Container
  private keys?: RunnerKeys
  private speedLines: Phaser.GameObjects.Rectangle[] = []
  private obstacles: MovingObstacle[] = []
  private pickups: MovingPickup[] = []
  private seenPatchIds = new Set<string>()
  private elapsedMs = 0
  private pickupCount = 0
  private velocityY = 0
  private obstacleClockMs = 1_250
  private pickupClockMs = 720
  private lastStatsAtMs = -1_000
  private alive = true

  constructor(snapshot: GameStateViewModel, callbacks: EndlessRunCallbacks) {
    super({ key: 'endless-runner' })
    this.snapshot = snapshot
    this.callbacks = callbacks
  }

  create() {
    this.cameras.main.setRoundPixels(true)
    this.drawBackdrop()
    this.player = this.drawRunner()
    this.bindControls()
    this.emitStats()
    this.maybeQueuePatch(this.snapshot)
  }

  update(_time: number, delta: number) {
    if (!this.alive || !this.player) return

    const frameMs = Math.min(delta, 40)
    this.elapsedMs += frameMs
    this.updateBackdrop(frameMs)
    this.updatePlayer(frameMs)
    this.updateSpawns(frameMs)
    this.updateObstacles(frameMs)
    this.updatePickups(frameMs)
    this.checkCollisions()

    if (this.elapsedMs - this.lastStatsAtMs >= 100) this.emitStats()
  }

  applySnapshot(snapshot: GameStateViewModel) {
    this.snapshot = snapshot
    if (this.sys.isActive()) this.maybeQueuePatch(snapshot)
  }

  private bindControls() {
    if (!this.input.keyboard) return
    this.keys = {
      jump: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      up: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      w: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
    }
  }

  private updatePlayer(deltaMs: number) {
    if (!this.player) return
    const grounded = this.player.y >= PLAYER_GROUND_Y - 1
    const wantsJump = this.keys && (
      Phaser.Input.Keyboard.JustDown(this.keys.jump) ||
      Phaser.Input.Keyboard.JustDown(this.keys.up) ||
      Phaser.Input.Keyboard.JustDown(this.keys.w)
    )

    if (grounded && wantsJump) this.velocityY = JUMP_VELOCITY
    this.velocityY += GRAVITY * (deltaMs / 1_000)
    this.player.y += this.velocityY * (deltaMs / 1_000)

    if (this.player.y >= PLAYER_GROUND_Y) {
      this.player.y = PLAYER_GROUND_Y
      this.velocityY = 0
    }

    const bob = grounded ? Math.sin(this.elapsedMs / 85) * 2 : 0
    this.player.setRotation(grounded ? 0 : -0.08)
    ;(this.player.getAt(0) as Phaser.GameObjects.Container).setY(18 + bob)
  }

  private updateSpawns(deltaMs: number) {
    this.obstacleClockMs -= deltaMs
    this.pickupClockMs -= deltaMs

    if (this.obstacleClockMs <= 0) {
      this.spawnObstacle({
        type: 'spawn_obstacle',
        obstacle: this.elapsedMs > 14_000 ? 'spike_row' : 'rolling_boulder',
        lane: 'ground',
        delayMs: 0,
        durationMs: 8_000,
        author: 'gremlin',
        title: this.elapsedMs > 14_000 ? 'Spike Parade' : 'Warm-Up Trouble',
        sourceMutationId: `baseline-${Math.floor(this.elapsedMs)}`,
      })
      this.obstacleClockMs = Math.max(900, 2_050 - this.elapsedMs / 18)
    }

    if (this.pickupClockMs <= 0) {
      this.spawnPickup()
      this.pickupClockMs = 1_050 + Math.random() * 550
    }
  }

  private updateObstacles(deltaMs: number) {
    const speed = 300 + Math.min(230, this.elapsedMs / 95)
    for (let index = this.obstacles.length - 1; index >= 0; index -= 1) {
      const obstacle = this.obstacles[index]
      obstacle.view.x -= speed * (deltaMs / 1_000)
      if (obstacle.kind === 'moving_wall') {
        obstacle.view.y = obstacle.baseY + Math.sin(this.elapsedMs / 180 + obstacle.phase) * 12
      }
      if (obstacle.kind === 'rolling_boulder') {
        obstacle.view.rotation -= deltaMs / 230
      }
      if (obstacle.view.x < -100) {
        obstacle.view.destroy()
        this.obstacles.splice(index, 1)
      }
    }
  }

  private updatePickups(deltaMs: number) {
    const speed = 300 + Math.min(230, this.elapsedMs / 95)
    for (let index = this.pickups.length - 1; index >= 0; index -= 1) {
      const pickup = this.pickups[index]
      pickup.view.x -= speed * (deltaMs / 1_000)
      pickup.view.rotation += deltaMs / 800
      if (pickup.view.x < -60) {
        pickup.view.destroy()
        this.pickups.splice(index, 1)
      }
    }
  }

  private checkCollisions() {
    if (!this.player) return
    const playerBounds = new Phaser.Geom.Rectangle(
      this.player.x - 20,
      this.player.y - 38,
      40,
      77,
    )

    for (const obstacle of this.obstacles) {
      const bounds = new Phaser.Geom.Rectangle(
        obstacle.view.x - obstacle.width / 2,
        obstacle.view.y - obstacle.height / 2,
        obstacle.width,
        obstacle.height,
      )
      if (Phaser.Geom.Intersects.RectangleToRectangle(playerBounds, bounds)) {
        this.endRun(obstacle.author, obstacle.title)
        return
      }
    }

    for (let index = this.pickups.length - 1; index >= 0; index -= 1) {
      const pickup = this.pickups[index]
      const bounds = new Phaser.Geom.Rectangle(
        pickup.view.x - pickup.radius,
        pickup.view.y - pickup.radius,
        pickup.radius * 2,
        pickup.radius * 2,
      )
      if (!Phaser.Geom.Intersects.RectangleToRectangle(playerBounds, bounds)) continue
      this.pickupCount += 1
      pickup.view.destroy()
      this.pickups.splice(index, 1)
      this.cameras.main.flash(90, 255, 209, 102, false)
      this.emitStats()
    }
  }

  private maybeQueuePatch(snapshot: GameStateViewModel) {
    const patch = snapshot.activePatch
    if (!this.alive || patch.status !== 'active' || this.seenPatchIds.has(patch.id)) return
    this.seenPatchIds.add(patch.id)
    const safePatch = obstaclePatchFromView(patch)
    this.showPatchSignal(safePatch)
    this.time.delayedCall(safePatch.delayMs, () => {
      if (this.alive) this.spawnObstacle(safePatch)
    })
  }

  private spawnObstacle(patch: ObstaclePatch) {
    const x = WIDTH + 70
    const authorColor = patch.author === 'architect'
      ? COLORS.blue
      : patch.author === 'auditor'
        ? COLORS.mint
        : COLORS.pink
    let width = 54
    let height = 54
    const view = this.add.container(x, GROUND_Y - height / 2)

    if (patch.obstacle === 'rolling_boulder') {
      width = 56
      height = 56
      const rock = this.add.graphics()
      rock.fillStyle(COLORS.navy)
      rock.fillCircle(0, 0, 31)
      rock.fillStyle(authorColor)
      rock.fillCircle(0, 0, 24)
      rock.fillStyle(COLORS.cream)
      rock.fillRect(-4, -20, 8, 40)
      rock.fillRect(-20, -4, 40, 8)
      view.add(rock)
    } else if (patch.obstacle === 'spike_row') {
      width = 78
      height = 38
      view.y = GROUND_Y - height / 2
      const spikes = this.add.graphics()
      spikes.fillStyle(COLORS.navy)
      spikes.fillRect(-42, 12, 84, 10)
      for (let spikeX = -36; spikeX <= 24; spikeX += 20) {
        spikes.fillTriangle(spikeX, 12, spikeX + 10, -20, spikeX + 20, 12)
      }
      spikes.fillStyle(authorColor)
      spikes.fillRect(-38, 14, 76, 5)
      view.add(spikes)
    } else {
      width = 46
      height = 70
      view.y = GROUND_Y - height / 2
      view.add([
        this.add.rectangle(0, 0, width + 8, height + 8, COLORS.navy),
        this.add.rectangle(0, 0, width, height, authorColor),
        this.add.rectangle(0, -18, 24, 8, COLORS.cream),
        this.add.rectangle(0, 8, 24, 8, COLORS.cream),
      ])
    }

    this.obstacles.push({
      view,
      width,
      height,
      kind: patch.obstacle,
      author: patch.author,
      title: patch.title,
      phase: Math.random() * Math.PI,
      baseY: view.y,
    })
  }

  private spawnPickup() {
    const y = Math.random() > 0.5 ? PLAYER_GROUND_Y - 12 : PLAYER_GROUND_Y - 112
    const view = this.add.container(WIDTH + 35, y)
    view.add([
      this.add.rectangle(0, 0, 25, 25, COLORS.navy).setAngle(45),
      this.add.rectangle(0, 0, 18, 18, COLORS.gold).setAngle(45),
      this.add.rectangle(-3, -3, 6, 6, COLORS.cream),
    ])
    this.tweens.add({
      targets: view,
      scale: 1.12,
      duration: 300,
      yoyo: true,
      repeat: -1,
      ease: 'Stepped',
    })
    this.pickups.push({ view, radius: 19 })
  }

  private endRun(author: GameMasterPersona, title: string) {
    if (!this.alive || !this.player) return
    this.alive = false
    this.player.setAlpha(0.72)
    this.player.setRotation(Math.PI / 2)
    this.cameras.main.shake(180, 0.012)
    this.cameras.main.flash(140, 239, 71, 111, false)
    const stats = this.stats(false)
    this.callbacks.onStats(stats)
    this.callbacks.onGameOver({ ...stats, killer: { author, title } })
  }

  private stats(alive = this.alive): EndlessRunStats {
    const timeScore = Math.floor(this.elapsedMs / 10)
    const pickupScore = this.pickupCount * 100
    return {
      alive,
      elapsedMs: Math.floor(this.elapsedMs),
      pickups: this.pickupCount,
      timeScore,
      pickupScore,
      score: timeScore + pickupScore,
    }
  }

  private emitStats() {
    this.lastStatsAtMs = this.elapsedMs
    this.callbacks.onStats(this.stats())
  }

  private showPatchSignal(patch: ObstaclePatch) {
    const banner = this.add.container(WIDTH / 2, 150).setDepth(10)
    banner.add([
      this.add.rectangle(0, 0, 420, 74, COLORS.navy),
      this.add.rectangle(0, 0, 408, 62, COLORS.pink),
      this.add.text(0, -14, `${patch.author.toUpperCase()} DEPLOYED`, this.pixelText(9, COLORS.cream)).setOrigin(0.5),
      this.add.text(0, 13, patch.title.toUpperCase(), this.pixelText(7, COLORS.navy)).setOrigin(0.5),
    ])
    this.tweens.add({
      targets: banner,
      y: 160,
      alpha: 0,
      delay: 1_050,
      duration: 350,
      ease: 'Stepped',
      onComplete: () => banner.destroy(),
    })
  }

  private drawBackdrop() {
    this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, COLORS.sky)
    this.add.rectangle(WIDTH / 2, 38, WIDTH, 76, COLORS.skyLight)

    const sun = this.add.rectangle(818, 92, 68, 68, COLORS.gold)
    this.add.rectangle(818, 92, 44, 44, 0xffee9b)
    this.tweens.add({ targets: sun, scale: 1.08, duration: 700, yoyo: true, repeat: -1, ease: 'Stepped' })

    const skyline = this.add.graphics()
    skyline.fillStyle(0x4f82a8)
    ;[
      [0, 310, 92, 108], [108, 336, 66, 82], [190, 286, 72, 132],
      [278, 326, 104, 92], [402, 302, 76, 116], [494, 344, 118, 74],
      [630, 294, 88, 124], [736, 330, 62, 88], [814, 276, 92, 142], [920, 320, 40, 98],
    ].forEach(([x, y, width, height]) => skyline.fillRect(x, y, width, height))

    for (let index = 0; index < 10; index += 1) {
      const line = this.add.rectangle(index * 112, 205 + (index % 5) * 34, 48, 4, COLORS.cream, 0.48)
      line.setOrigin(0, 0.5)
      this.speedLines.push(line)
    }

    this.add.rectangle(WIDTH / 2, GROUND_Y + 9, WIDTH, 18, COLORS.cream)
    this.add.rectangle(WIDTH / 2, GROUND_Y + 20, WIDTH, 18, COLORS.grass)
    this.add.rectangle(WIDTH / 2, GROUND_Y + 72, WIDTH, 86, COLORS.navyDark)
    for (let x = 0; x < WIDTH; x += 42) {
      this.add.rectangle(x, GROUND_Y + 48, 20, 12, COLORS.purple, 0.6)
    }
  }

  private updateBackdrop(deltaMs: number) {
    const speed = 130 + Math.min(100, this.elapsedMs / 180)
    for (const line of this.speedLines) {
      line.x -= speed * (deltaMs / 1_000)
      if (line.x < -60) line.x = WIDTH + Math.random() * 80
    }
  }

  private drawRunner() {
    const runner = this.add.container(PLAYER_X, PLAYER_GROUND_Y).setDepth(4)
    const body = this.add.container(0, 18)
    body.add([
      this.add.rectangle(-24, -6, 34, 8, COLORS.pink),
      this.add.rectangle(0, -24, 34, 30, COLORS.blue),
      this.add.rectangle(3, -40, 28, 25, COLORS.mint),
      this.add.rectangle(8, -43, 7, 7, COLORS.navy),
      this.add.rectangle(-10, 4, 11, 28, 0x1555a9),
      this.add.rectangle(10, 4, 11, 28, 0x1555a9),
      this.add.rectangle(-14, 20, 22, 8, COLORS.mint),
      this.add.rectangle(15, 20, 22, 8, COLORS.mint),
    ])
    runner.add(body)
    return runner
  }

  private pixelText(size: number, color: number): Phaser.Types.GameObjects.Text.TextStyle {
    return {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: `${size}px`,
      color: `#${color.toString(16).padStart(6, '0')}`,
      resolution: 2,
    }
  }
}
