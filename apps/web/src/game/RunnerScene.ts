import Phaser from 'phaser'
import type {
  ConfigureRunnerEffect,
  GameMasterPersona,
  SpawnRunnerHazardEffect,
} from '@fork-fighter/contracts'
import type {
  EndlessRunCallbacks,
  EndlessRunStats,
  ObstacleKind,
  ObstaclePatch,
  RunnerMutationPatch,
} from '../model/endless-run'
import {
  obstaclePatchFromWave,
  runnerMutationPatchFromView,
} from '../model/endless-run'
import type { GameStateViewModel } from '../model/view-models'

const WIDTH = 960
const HEIGHT = 540
const GROUND_Y = 418
const PLAYER_X = 148
const PLAYER_GROUND_Y = GROUND_Y - 42
const PLAYER_CEILING_Y = 92
const GRAVITY = 2_050
const JUMP_VELOCITY = -770
const START_GRACE_MS = 1_800
const COLLISION_TUTORIAL_MS = 25_000
const JUMP_BUFFER_MS = 150
const MIN_HAZARD_SPACING_MS = 750
const RUNNER_ACTION_TEXTURE = 'fork-fighter-runner'
const RUNNER_RUN_TEXTURE = 'fork-fighter-run-cycle'
const RUNNER_HIT_TEXTURE = 'fork-fighter-hit'
const RUNNER_RUN_ANIMATION = 'fork-fighter-run-cycle'
const RUNNER_FRAME_WIDTH = 384
const RUNNER_FRAME_HEIGHT = 512
const RUNNER_SCALE = 0.3
const RUNNER_Y_OFFSET = -22
const RUNNER_RUN_Y_OFFSETS = [0, 0, 1, 3, 20, 20, 19, 19]
const RUNNER_JUMP_Y_OFFSET = 42
const RUNNER_HIT_Y_OFFSET = 13

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
  lane: SpawnRunnerHazardEffect['lane']
  author: GameMasterPersona
  title: string
  phase: number
  baseY: number
  speedMultiplier: number
  sourceMutationId: string
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

type PlayerMotion = 'run' | 'jump' | 'hit'

type RunnerConfiguration = Omit<ConfigureRunnerEffect, 'type' | 'tag'>

const DEFAULT_RUNNER_CONFIGURATION: RunnerConfiguration = {
  gravityMode: 'normal',
  jumpMultiplier: 1,
  speedMultiplier: 1,
  scaleMultiplier: 1,
  rotationMode: 'upright',
  worldStyle: 'normal',
}

export class RunnerScene extends Phaser.Scene {
  private snapshot: GameStateViewModel
  private readonly callbacks: EndlessRunCallbacks
  private player?: Phaser.GameObjects.Container
  private playerSprite?: Phaser.GameObjects.Sprite
  private playerShadow?: Phaser.GameObjects.Ellipse
  private keys?: RunnerKeys
  private speedLines: Phaser.GameObjects.Rectangle[] = []
  private obstacles: MovingObstacle[] = []
  private pickups: MovingPickup[] = []
  private seenPatchIds = new Set<string>()
  private activeRunnerMutation?: RunnerMutationPatch
  private mutationTimers: Phaser.Time.TimerEvent[] = []
  private runnerConfiguration: RunnerConfiguration = {
    ...DEFAULT_RUNNER_CONFIGURATION,
  }
  private mutationOverlay?: Phaser.GameObjects.Rectangle
  private suppressBaselineSpawns = false
  private collisionGraceMs = COLLISION_TUTORIAL_MS
  private elapsedMs = 0
  private pickupCount = 0
  private velocityY = 0
  private obstacleClockMs = 2_400
  private pickupClockMs = 900
  private lastStatsAtMs = -1_000
  private alive = true
  private pointerJumpQueued = false
  private jumpBufferMs = 0
  private startGraceMs = START_GRACE_MS
  private wasGrounded = true
  private landingSquashMs = 0
  private playerMotion?: PlayerMotion

  constructor(snapshot: GameStateViewModel, callbacks: EndlessRunCallbacks) {
    super({ key: 'endless-runner' })
    this.snapshot = snapshot
    this.callbacks = callbacks
  }

  preload() {
    const frameConfig = {
      frameWidth: RUNNER_FRAME_WIDTH,
      frameHeight: RUNNER_FRAME_HEIGHT,
    }
    this.load.spritesheet(RUNNER_ACTION_TEXTURE, '/assets/fork-fighter-runner.png', frameConfig)
    this.load.spritesheet(RUNNER_RUN_TEXTURE, '/assets/fork-fighter-run-cycle.png', frameConfig)
    this.load.image(RUNNER_HIT_TEXTURE, '/assets/fork-fighter-hit.png')
  }

  create() {
    this.cameras.main.setRoundPixels(true)
    this.drawBackdrop()
    this.createRunnerAnimations()
    this.playerShadow = this.add
      .ellipse(PLAYER_X, GROUND_Y + 3, 68, 14, COLORS.navyDark, 0.28)
      .setDepth(3)
    this.player = this.drawRunner()
    this.bindControls()
    this.showStartSignal()
    this.emitStats()
    this.reconcilePatch(this.snapshot)
  }

  update(_time: number, delta: number) {
    if (!this.alive || !this.player) return

    const frameMs = Math.min(delta, 40)
    if (this.startGraceMs > 0) {
      this.startGraceMs = Math.max(0, this.startGraceMs - frameMs)
      this.updateBackdrop(frameMs * 0.2)
      return
    }
    this.elapsedMs += frameMs
    this.collisionGraceMs = Math.max(0, this.collisionGraceMs - frameMs)
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
    if (this.sys.isActive()) this.reconcilePatch(snapshot)
  }

  private bindControls() {
    this.input.on('pointerdown', () => {
      this.pointerJumpQueued = true
    })
    if (!this.input.keyboard) return
    this.keys = {
      jump: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      up: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      w: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
    }
  }

  private updatePlayer(deltaMs: number) {
    if (!this.player) return
    const mode = this.runnerConfiguration.gravityMode
    const grounded =
      mode === 'inverted'
        ? this.player.y <= PLAYER_CEILING_Y + 1
        : mode !== 'zero_g' && this.player.y >= PLAYER_GROUND_Y - 1
    const wantsKeyboardJump = this.keys && (
      Phaser.Input.Keyboard.JustDown(this.keys.jump) ||
      Phaser.Input.Keyboard.JustDown(this.keys.up) ||
      Phaser.Input.Keyboard.JustDown(this.keys.w)
    )
    const wantsJump = Boolean(wantsKeyboardJump || this.pointerJumpQueued)
    this.pointerJumpQueued = false
    if (wantsJump) this.jumpBufferMs = JUMP_BUFFER_MS
    else this.jumpBufferMs = Math.max(0, this.jumpBufferMs - deltaMs)

    if (mode === 'zero_g' && this.jumpBufferMs > 0) {
      this.jumpBufferMs = 0
      this.velocityY = -440 * this.runnerConfiguration.jumpMultiplier
      this.setPlayerMotion('jump')
    } else if (grounded && this.jumpBufferMs > 0) {
      this.jumpBufferMs = 0
      const direction = mode === 'inverted' ? -1 : 1
      this.velocityY = JUMP_VELOCITY * this.runnerConfiguration.jumpMultiplier * direction
      this.setPlayerMotion('jump')
      this.emitFootfallPixels(false)
    }

    const seconds = deltaMs / 1_000
    const gravityScale =
      mode === 'moon' ? 0.36 : mode === 'inverted' ? -1 : mode === 'zero_g' ? 0 : 1
    if (mode === 'zero_g') {
      const floatTarget = (PLAYER_GROUND_Y + PLAYER_CEILING_Y) / 2
      this.velocityY += (floatTarget - this.player.y) * 0.9 * seconds
      this.velocityY *= Math.pow(0.985, deltaMs / 16.67)
    } else {
      this.velocityY += GRAVITY * gravityScale * seconds
    }
    this.player.y += this.velocityY * seconds

    if (this.player.y >= PLAYER_GROUND_Y) {
      this.player.y = PLAYER_GROUND_Y
      this.velocityY = mode === 'zero_g' ? -Math.abs(this.velocityY) * 0.55 : 0
    }
    if (this.player.y <= PLAYER_CEILING_Y) {
      this.player.y = PLAYER_CEILING_Y
      this.velocityY = mode === 'zero_g' ? Math.abs(this.velocityY) * 0.55 : 0
    }

    const isGrounded =
      mode === 'inverted'
        ? this.player.y <= PLAYER_CEILING_Y + 1
        : mode !== 'zero_g' && this.player.y >= PLAYER_GROUND_Y - 1
    if (isGrounded && !this.wasGrounded) {
      this.landingSquashMs = 120
      this.emitFootfallPixels(true)
    }

    this.setPlayerMotion(isGrounded ? 'run' : 'jump')
    this.alignPlayerFrame()
    if (this.runnerConfiguration.rotationMode === 'spin') {
      this.player.rotation += deltaMs / 190
    } else if (this.runnerConfiguration.rotationMode === 'flipped') {
      this.player.setRotation(Math.PI)
    } else {
      this.player.setRotation(
        isGrounded ? 0 : Phaser.Math.Clamp(this.velocityY / 8_000, -0.08, 0.06),
      )
    }

    const scale = this.runnerConfiguration.scaleMultiplier
    if (this.landingSquashMs > 0) {
      this.landingSquashMs = Math.max(0, this.landingSquashMs - deltaMs)
      this.player.setScale(scale * 1.08, scale * 0.9)
    } else {
      this.player.setScale(scale)
    }

    const jumpHeight = Math.min(
      Math.abs(PLAYER_GROUND_Y - this.player.y),
      Math.abs(this.player.y - PLAYER_CEILING_Y),
    )
    const shadowScale = Phaser.Math.Clamp(1 - jumpHeight / 260, 0.42, 1)
    this.playerShadow
      ?.setScale(shadowScale, Phaser.Math.Linear(0.58, 1, shadowScale))
      .setAlpha(Phaser.Math.Linear(0.1, 0.28, shadowScale))
    this.wasGrounded = isGrounded
  }

  private updateSpawns(deltaMs: number) {
    this.obstacleClockMs -= deltaMs
    this.pickupClockMs -= deltaMs

    if (!this.suppressBaselineSpawns && this.obstacleClockMs <= 0) {
      this.spawnObstacle({
        type: 'spawn_obstacle',
        obstacle: this.elapsedMs > 14_000 ? 'spike_row' : 'rolling_boulder',
        lane: 'ground',
        speedMultiplier: 1,
        author: 'gremlin',
        title: this.elapsedMs > 14_000 ? 'Spike Parade' : 'Warm-Up Trouble',
        sourceMutationId: `baseline-${Math.floor(this.elapsedMs)}`,
      })
      this.obstacleClockMs = Math.max(1_100, 2_300 - this.elapsedMs / 22)
    } else if (this.suppressBaselineSpawns) {
      this.obstacleClockMs = Math.max(this.obstacleClockMs, 700)
    }

    if (this.pickupClockMs <= 0) {
      this.spawnPickup()
      this.pickupClockMs = 1_050 + Math.random() * 550
    }
  }

  private updateObstacles(deltaMs: number) {
    const speed =
      (290 + Math.min(200, this.elapsedMs / 110)) *
      this.runnerConfiguration.speedMultiplier
    for (let index = this.obstacles.length - 1; index >= 0; index -= 1) {
      const obstacle = this.obstacles[index]
      obstacle.view.x -= speed * obstacle.speedMultiplier * (deltaMs / 1_000)
      if (obstacle.kind === 'moving_wall') {
        obstacle.view.y = this.laneAwareBob(obstacle, 18, 180)
      }
      if (obstacle.kind === 'rolling_boulder') {
        obstacle.view.rotation -= deltaMs / 230
      }
      if (obstacle.kind === 'falling_anvil') {
        obstacle.view.y = Math.min(
          GROUND_Y - obstacle.height / 2,
          obstacle.view.y + deltaMs * 0.16,
        )
      }
      if (obstacle.kind === 'rubber_duck') {
        obstacle.view.y = this.laneAwareBob(obstacle, 24, 135)
        obstacle.view.rotation = Math.sin(this.elapsedMs / 240 + obstacle.phase) * 0.18
      }
      if (obstacle.kind === 'fork_storm') {
        obstacle.view.y = this.laneAwareBob(obstacle, 20, 95)
        obstacle.view.rotation += deltaMs / 120
      }
      if (obstacle.view.x < -100) {
        obstacle.view.destroy()
        this.obstacles.splice(index, 1)
      }
    }
  }

  private laneAwareBob(obstacle: MovingObstacle, amplitude: number, periodMs: number) {
    const wave = Math.sin(this.elapsedMs / periodMs + obstacle.phase)
    if (obstacle.lane === 'ground') {
      return obstacle.baseY - ((wave + 1) / 2) * amplitude
    }
    if (obstacle.lane === 'ceiling') {
      return obstacle.baseY + ((wave + 1) / 2) * amplitude
    }
    return obstacle.baseY + wave * amplitude
  }

  private updatePickups(deltaMs: number) {
    const speed =
      (290 + Math.min(200, this.elapsedMs / 110)) *
      this.runnerConfiguration.speedMultiplier
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
    if (!this.player || this.collisionGraceMs > 0) return
    const scale = this.runnerConfiguration.scaleMultiplier
    const playerWidth = 34 * scale
    const playerHeight = 68 * scale
    const playerBounds = new Phaser.Geom.Rectangle(
      this.player.x - playerWidth / 2,
      this.player.y - playerHeight / 2,
      playerWidth,
      playerHeight,
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

  private reconcilePatch(snapshot: GameStateViewModel) {
    const view = snapshot.activePatch
    if (!this.alive || view.status !== 'active') {
      if (this.activeRunnerMutation) this.clearRunnerMutation()
      return
    }
    if (this.activeRunnerMutation?.id === view.id || this.seenPatchIds.has(view.id)) return

    this.clearRunnerMutation()
    this.seenPatchIds.add(view.id)
    const patch = runnerMutationPatchFromView(view)
    this.activeRunnerMutation = patch
    this.suppressBaselineSpawns = patch.waves.length > 0
    this.showPatchSignal(patch)
    if (patch.configuration) this.applyRunnerConfiguration(patch.configuration)
    this.game.canvas.dataset.activeMutation = patch.id

    for (const wave of patch.waves) {
      if (wave.trigger === 'onActivation') {
        this.scheduleHazardWave(patch, wave.effect)
        continue
      }
      const interval = this.time.addEvent({
        delay: wave.everyMs ?? 3_000,
        loop: true,
        callback: () => {
          if (this.alive && this.activeRunnerMutation?.id === patch.id) {
            this.scheduleHazardWave(patch, wave.effect)
          }
        },
      })
      this.mutationTimers.push(interval)
    }
  }

  private applyRunnerConfiguration(effect: ConfigureRunnerEffect) {
    const rotationMode = effect.gravityMode === 'zero_g' ? 'upright' : effect.rotationMode
    this.runnerConfiguration = {
      gravityMode: effect.gravityMode,
      jumpMultiplier: effect.jumpMultiplier,
      speedMultiplier: effect.speedMultiplier,
      scaleMultiplier: effect.scaleMultiplier,
      rotationMode,
      worldStyle: effect.worldStyle,
    }
    this.collisionGraceMs = Math.max(this.collisionGraceMs, 900)
    this.velocityY = 0
    this.clearObstacles()
    if (this.player) {
      if (effect.gravityMode === 'inverted') this.player.y = PLAYER_CEILING_Y
      if (effect.gravityMode !== 'zero_g' && effect.gravityMode !== 'inverted') {
        this.player.y = PLAYER_GROUND_Y
      }
      this.player.setRotation(0)
    }

    const styles: Record<RunnerConfiguration['worldStyle'], { color: number; alpha: number }> = {
      normal: { color: COLORS.sky, alpha: 0 },
      neon: { color: COLORS.pink, alpha: 0.18 },
      void: { color: COLORS.navyDark, alpha: 0.42 },
      sunset: { color: COLORS.gold, alpha: 0.2 },
    }
    const style = styles[effect.worldStyle]
    this.mutationOverlay?.setFillStyle(style.color).setAlpha(style.alpha)
    this.cameras.main.flash(180, 121, 215, 255, false)
    this.game.canvas.dataset.runnerGravity = effect.gravityMode
    this.game.canvas.dataset.runnerRotation = rotationMode
    this.game.canvas.dataset.worldStyle = effect.worldStyle
  }

  private scheduleHazardWave(
    patch: RunnerMutationPatch,
    effect: SpawnRunnerHazardEffect,
  ) {
    this.showHazardSignal(effect)
    this.game.canvas.dataset.hazardKind = effect.hazard
    this.game.canvas.dataset.hazardLane = effect.lane
    const spacingMs = Math.max(effect.spacingMs, MIN_HAZARD_SPACING_MS)
    this.game.canvas.dataset.hazardSpacingMs = String(spacingMs)
    const warning = this.time.delayedCall(effect.telegraphMs, () => {
      if (!this.alive || this.activeRunnerMutation?.id !== patch.id) return
      for (let index = 0; index < effect.count; index += 1) {
        const timer = this.time.delayedCall(index * spacingMs, () => {
          if (this.alive && this.activeRunnerMutation?.id === patch.id) {
            this.spawnObstacle(obstaclePatchFromWave(patch, effect))
          }
        })
        this.mutationTimers.push(timer)
      }
    })
    this.mutationTimers.push(warning)
  }

  private clearRunnerMutation() {
    const mutationId = this.activeRunnerMutation?.id
    for (const timer of this.mutationTimers) timer.remove(false)
    this.mutationTimers = []
    if (mutationId) {
      for (let index = this.obstacles.length - 1; index >= 0; index -= 1) {
        if (this.obstacles[index]?.sourceMutationId !== mutationId) continue
        this.obstacles[index]?.view.destroy()
        this.obstacles.splice(index, 1)
      }
    }
    this.activeRunnerMutation = undefined
    this.runnerConfiguration = { ...DEFAULT_RUNNER_CONFIGURATION }
    this.suppressBaselineSpawns = false
    this.mutationOverlay?.setAlpha(0)
    this.velocityY = 0
    this.collisionGraceMs = Math.max(this.collisionGraceMs, 1_000)
    if (this.player) {
      this.player.y = PLAYER_GROUND_Y
      this.player.setRotation(0).setScale(1)
    }
    delete this.game.canvas.dataset.activeMutation
    delete this.game.canvas.dataset.hazardKind
    delete this.game.canvas.dataset.hazardLane
    delete this.game.canvas.dataset.hazardSpacingMs
    this.game.canvas.dataset.runnerGravity = 'normal'
    this.game.canvas.dataset.runnerRotation = 'upright'
    this.game.canvas.dataset.worldStyle = 'normal'
  }

  private clearObstacles() {
    for (const obstacle of this.obstacles) obstacle.view.destroy()
    this.obstacles = []
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
    const view = this.add.container(x, GROUND_Y - height / 2).setDepth(3)

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
      const spikes = this.add.graphics()
      spikes.fillStyle(COLORS.navy)
      spikes.fillRect(-42, 12, 84, 10)
      for (let spikeX = -36; spikeX <= 24; spikeX += 20) {
        spikes.fillTriangle(spikeX, 12, spikeX + 10, -20, spikeX + 20, 12)
      }
      spikes.fillStyle(authorColor)
      spikes.fillRect(-38, 14, 76, 5)
      view.add(spikes)
    } else if (patch.obstacle === 'moving_wall') {
      width = 46
      height = 70
      view.add([
        this.add.rectangle(0, 0, width + 8, height + 8, COLORS.navy),
        this.add.rectangle(0, 0, width, height, authorColor),
        this.add.rectangle(0, -18, 24, 8, COLORS.cream),
        this.add.rectangle(0, 8, 24, 8, COLORS.cream),
      ])
    } else if (patch.obstacle === 'falling_anvil') {
      width = 62
      height = 52
      const anvil = this.add.graphics()
      anvil.fillStyle(COLORS.navy)
      anvil.fillRect(-32, -22, 64, 15)
      anvil.fillTriangle(-32, -7, 22, -7, 7, 8)
      anvil.fillRect(-9, 7, 18, 25)
      anvil.fillStyle(authorColor)
      anvil.fillRect(-25, -18, 50, 7)
      anvil.fillStyle(COLORS.cream)
      anvil.fillRect(-5, 12, 10, 12)
      view.add(anvil)
    } else if (patch.obstacle === 'rubber_duck') {
      width = 66
      height = 48
      view.add([
        this.add.ellipse(-4, 7, 58, 36, COLORS.gold).setStrokeStyle(5, COLORS.navy),
        this.add.ellipse(20, -12, 30, 30, COLORS.gold).setStrokeStyle(5, COLORS.navy),
        this.add.triangle(39, -9, 0, 0, 18, 7, 0, 14, COLORS.red),
        this.add.rectangle(25, -17, 5, 5, COLORS.navy),
        this.add.rectangle(-12, 4, 16, 8, authorColor),
      ])
    } else {
      width = 48
      height = 72
      const forks = this.add.graphics()
      forks.lineStyle(7, COLORS.navy)
      for (const forkX of [-14, 0, 14]) {
        forks.lineBetween(forkX, -27, forkX, 28)
        forks.lineBetween(forkX - 5, -27, forkX - 5, -16)
        forks.lineBetween(forkX + 5, -27, forkX + 5, -16)
      }
      forks.lineStyle(3, authorColor)
      forks.strokeCircle(0, 0, 27)
      view.add(forks)
    }

    view.y =
      patch.lane === 'ground'
        ? GROUND_Y - height / 2
        : patch.lane === 'ceiling'
          ? PLAYER_CEILING_Y + height / 2
          : PLAYER_GROUND_Y - 122
    if (patch.lane === 'ceiling' && patch.obstacle === 'spike_row') {
      view.setScale(1, -1)
    }

    this.obstacles.push({
      view,
      width,
      height,
      kind: patch.obstacle,
      lane: patch.lane,
      author: patch.author,
      title: patch.title,
      phase: Math.random() * Math.PI,
      baseY: view.y,
      speedMultiplier: patch.speedMultiplier,
      sourceMutationId: patch.sourceMutationId,
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
    this.setPlayerMotion('hit')
    this.player.setRotation(-0.16)
    this.tweens.add({
      targets: this.player,
      x: this.player.x - 18,
      y: this.player.y + 5,
      duration: 180,
      ease: 'Stepped',
    })
    this.tweens.add({
      targets: this.playerSprite,
      alpha: 0.34,
      duration: 55,
      yoyo: true,
      repeat: 2,
      ease: 'Stepped',
    })
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

  private showStartSignal() {
    const banner = this.add.container(WIDTH / 2, 146).setDepth(20)
    const panel = this.add.rectangle(0, 0, 430, 86, COLORS.navy)
    const inner = this.add.rectangle(0, 0, 416, 72, COLORS.gold)
    const title = this.add
      .text(0, -14, 'GET READY', this.pixelText(12, COLORS.navy))
      .setOrigin(0.5)
    const hint = this.add
      .text(0, 16, 'TAP / SPACE / W / UP TO JUMP', this.pixelText(7, COLORS.purple))
      .setOrigin(0.5)
    banner.add([panel, inner, title, hint])

    this.time.delayedCall(1_100, () => {
      title.setText('RUN!')
      hint.setText('ONE HIT = GAME OVER')
      inner.setFillStyle(COLORS.mint)
    })
    this.time.delayedCall(START_GRACE_MS, () => banner.destroy())
  }

  private showPatchSignal(patch: RunnerMutationPatch) {
    const banner = this.add.container(WIDTH / 2, 150).setDepth(10)
    const physics = patch.configuration
      ? `${patch.configuration.gravityMode.replace('_', ' ')} GRAVITY // ${patch.configuration.rotationMode}`
      : `${patch.waves.length} HAZARD DEMAND`
    banner.add([
      this.add.rectangle(0, 0, 500, 86, COLORS.navy),
      this.add.rectangle(0, 0, 486, 72, COLORS.pink),
      this.add.text(0, -19, `${patch.author.toUpperCase()} DEMANDED`, this.pixelText(9, COLORS.cream)).setOrigin(0.5),
      this.add.text(0, 4, patch.title.toUpperCase(), this.pixelText(7, COLORS.navy)).setOrigin(0.5),
      this.add.text(0, 25, `REFEREE APPROVED // ${physics.toUpperCase()}`, this.pixelText(5, COLORS.navy)).setOrigin(0.5),
    ])
    this.tweens.add({
      targets: banner,
      y: 160,
      alpha: 0,
      delay: 1_450,
      duration: 350,
      ease: 'Stepped',
      onComplete: () => banner.destroy(),
    })
  }

  private showHazardSignal(effect: SpawnRunnerHazardEffect) {
    const warning = this.add.container(WIDTH - 210, 245).setDepth(11)
    warning.add([
      this.add.rectangle(0, 0, 330, 58, COLORS.navy),
      this.add.rectangle(0, 0, 318, 46, COLORS.gold),
      this.add.text(0, -10, `INCOMING ${effect.hazard.replaceAll('_', ' ').toUpperCase()} ×${effect.count}`, this.pixelText(6, COLORS.navy)).setOrigin(0.5),
      this.add.text(0, 11, `${effect.lane.toUpperCase()} LANE // ${effect.telegraphMs}MS WARNING`, this.pixelText(5, COLORS.purple)).setOrigin(0.5),
    ])
    this.tweens.add({
      targets: warning,
      alpha: 0,
      delay: Math.max(250, effect.telegraphMs - 250),
      duration: 220,
      ease: 'Stepped',
      onComplete: () => warning.destroy(),
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
    this.mutationOverlay = this.add
      .rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, COLORS.sky, 0)
      .setDepth(1)
  }

  private updateBackdrop(deltaMs: number) {
    const speed =
      (130 + Math.min(100, this.elapsedMs / 180)) *
      this.runnerConfiguration.speedMultiplier
    for (const line of this.speedLines) {
      line.x -= speed * (deltaMs / 1_000)
      if (line.x < -60) line.x = WIDTH + Math.random() * 80
    }
  }

  private drawRunner() {
    const runner = this.add.container(PLAYER_X, PLAYER_GROUND_Y).setDepth(4)
    this.playerSprite = this.add
      .sprite(0, RUNNER_Y_OFFSET, RUNNER_RUN_TEXTURE, 0)
      .setScale(RUNNER_SCALE)
    runner.add(this.playerSprite)
    this.setPlayerMotion('run')
    return runner
  }

  private createRunnerAnimations() {
    if (this.anims.exists(RUNNER_RUN_ANIMATION)) return
    this.anims.create({
      key: RUNNER_RUN_ANIMATION,
      frames: this.anims.generateFrameNumbers(RUNNER_RUN_TEXTURE, { start: 0, end: 7 }),
      frameRate: 14,
      repeat: -1,
    })
  }

  private setPlayerMotion(motion: PlayerMotion) {
    if (!this.playerSprite || this.playerMotion === motion) return
    this.playerMotion = motion
    if (motion === 'run') {
      this.playerSprite.play(RUNNER_RUN_ANIMATION, true)
      return
    }
    this.playerSprite.stop()
    if (motion === 'jump') {
      this.playerSprite.setTexture(RUNNER_ACTION_TEXTURE, 5)
    } else {
      this.playerSprite.setTexture(RUNNER_HIT_TEXTURE)
    }
    this.alignPlayerFrame()
  }

  private alignPlayerFrame() {
    if (!this.playerSprite || !this.playerMotion) return
    if (this.playerMotion === 'run') {
      const frameIndex = Number(this.playerSprite.frame.name)
      this.playerSprite.setPosition(
        0,
        RUNNER_Y_OFFSET + (RUNNER_RUN_Y_OFFSETS[frameIndex] ?? 0),
      )
      return
    }
    this.playerSprite.setPosition(
      0,
      RUNNER_Y_OFFSET + (
        this.playerMotion === 'jump' ? RUNNER_JUMP_Y_OFFSET : RUNNER_HIT_Y_OFFSET
      ),
    )
  }

  private emitFootfallPixels(landing: boolean) {
    for (let index = 0; index < (landing ? 6 : 4); index += 1) {
      const direction = index % 2 === 0 ? -1 : 1
      const pixel = this.add
        .rectangle(
          PLAYER_X - 8 + index * 3,
          GROUND_Y - 2,
          landing ? 7 : 5,
          landing ? 7 : 5,
          index % 3 === 0 ? COLORS.gold : COLORS.cream,
          0.9,
        )
        .setDepth(3)
      this.tweens.add({
        targets: pixel,
        x: pixel.x + direction * (18 + index * 2),
        y: pixel.y - (landing ? 12 + index * 2 : 8 + index),
        alpha: 0,
        scale: 0.25,
        duration: 220 + index * 18,
        ease: 'Stepped',
        onComplete: () => pixel.destroy(),
      })
    }
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
