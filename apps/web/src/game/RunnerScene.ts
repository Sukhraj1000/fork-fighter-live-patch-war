import Phaser from 'phaser'
import type { GameStateViewModel, PlayerCommand } from '../model/view-models'

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

type CommandSink = (command: PlayerCommand) => void

export class RunnerScene extends Phaser.Scene {
  private snapshot: GameStateViewModel
  private readonly commandSink: CommandSink
  private speedLines: Phaser.GameObjects.Rectangle[] = []
  private clouds: Phaser.GameObjects.Container[] = []
  private runner?: Phaser.GameObjects.Container
  private lastCommandAt = 0

  constructor(snapshot: GameStateViewModel, commandSink: CommandSink) {
    super({ key: 'runner-presentation' })
    this.snapshot = snapshot
    this.commandSink = commandSink
  }

  create() {
    this.cameras.main.setRoundPixels(true)
    this.renderSnapshot()
    this.bindCommands()
  }

  applySnapshot(snapshot: GameStateViewModel) {
    this.snapshot = snapshot
    if (this.sys.isActive()) this.renderSnapshot()
  }

  private renderSnapshot() {
    this.tweens.killAll()
    this.children.removeAll()
    this.speedLines = []
    this.clouds = []
    this.runner = undefined

    this.drawBackdrop()
    this.snapshot.platforms.forEach((platform) => this.drawPlatform(platform))
    this.drawRelay(this.snapshot.relay.x, this.snapshot.relay.y)
    this.snapshot.cores.forEach((core, index) => this.drawCore(core.x, core.y, index))
    this.snapshot.hazards.forEach((hazard, index) => this.drawHazard(hazard.x, hazard.y, index))
    this.drawExtraction(
      this.snapshot.extraction.x,
      this.snapshot.extraction.y,
      this.snapshot.extraction.ready,
    )
    this.runner = this.drawRunner(this.snapshot.player)
  }

  private drawBackdrop() {
    this.add.rectangle(480, 270, 960, 540, COLORS.sky)
    this.add.rectangle(480, 40, 960, 80, COLORS.skyLight)

    const sun = this.add.container(812, 92)
    sun.add([
      this.add.rectangle(0, 0, 68, 68, COLORS.gold),
      this.add.rectangle(0, 0, 48, 48, 0xffee9b),
      this.add.rectangle(0, 0, 26, 26, COLORS.cream),
    ])
    this.tweens.add({ targets: sun, scale: 1.08, duration: 700, yoyo: true, repeat: -1, ease: 'Stepped' })

    const hill = this.add.graphics()
    hill.fillStyle(0x78b7d4)
    ;[
      [0, 296, 150, 114],
      [100, 260, 170, 150],
      [245, 310, 160, 100],
      [370, 270, 210, 140],
      [555, 298, 170, 112],
      [700, 250, 210, 160],
      [865, 294, 95, 116],
    ].forEach(([x, y, width, height]) => hill.fillRect(x, y, width, height))

    const city = this.add.graphics()
    city.fillStyle(0x4f82a8)
    ;[
      [12, 338, 68, 72], [96, 318, 44, 92], [158, 348, 86, 62], [270, 300, 54, 110],
      [338, 326, 74, 84], [442, 286, 58, 124], [526, 340, 96, 70], [654, 314, 62, 96],
      [742, 292, 72, 118], [835, 328, 48, 82], [899, 308, 61, 102],
    ].forEach(([x, y, width, height]) => {
      city.fillRect(x, y, width, height)
      city.fillStyle(COLORS.skyLight)
      for (let wx = x + 10; wx < x + width - 6; wx += 18) {
        city.fillRect(wx, y + 14, 6, 8)
      }
      city.fillStyle(0x4f82a8)
    })

    ;[90, 360, 655].forEach((x, index) => {
      const cloud = this.add.container(x, 110 + index * 44)
      cloud.add([
        this.add.rectangle(0, 8, 94, 20, COLORS.cream),
        this.add.rectangle(-24, -4, 38, 24, COLORS.cream),
        this.add.rectangle(16, -10, 44, 32, COLORS.cream),
        this.add.rectangle(42, 2, 28, 22, COLORS.cream),
        this.add.rectangle(-8, 18, 76, 6, 0x9bd9e9),
      ])
      cloud.setScale(0.7 + index * 0.15)
      this.clouds.push(cloud)
    })

    for (let index = 0; index < 9; index += 1) {
      const line = this.add.rectangle(index * 130, 220 + (index % 4) * 37, 42, 4, COLORS.cream, 0.44)
      line.setOrigin(0, 0.5)
      this.speedLines.push(line)
    }
  }

  private drawPlatform(platform: GameStateViewModel['platforms'][number]) {
    const x = platform.x + platform.width / 2
    const top = platform.y
    const baseColor = platform.kind === 'bounce' ? COLORS.pink : platform.kind === 'crumble' ? COLORS.gold : COLORS.grass
    this.add.rectangle(x, top + 24, platform.width, 48, COLORS.navyDark).setOrigin(0.5, 0)
    this.add.rectangle(x, top + 6, platform.width, 12, baseColor).setOrigin(0.5, 0)
    this.add.rectangle(x, top + 16, platform.width, 8, COLORS.cream).setOrigin(0.5, 0)

    for (let px = platform.x + 10; px < platform.x + platform.width - 5; px += 24) {
      this.add.rectangle(px, top + 34, 10, 10, baseColor, 0.65).setOrigin(0, 0)
    }

    if (platform.kind === 'bounce') {
      for (let px = platform.x + 18; px < platform.x + platform.width - 8; px += 42) {
        const spring = this.add.rectangle(px, top - 2, 22, 8, COLORS.pink).setOrigin(0, 1)
        this.tweens.add({ targets: spring, scaleY: 1.8, duration: 340, yoyo: true, repeat: -1, ease: 'Stepped', delay: px })
      }
    }
  }

  private drawCore(x: number, y: number, index: number) {
    const core = this.add.container(x, y)
    core.add([
      this.add.rectangle(0, 0, 22, 22, COLORS.navy).setAngle(45),
      this.add.rectangle(0, 0, 16, 16, COLORS.gold).setAngle(45),
      this.add.rectangle(-3, -3, 6, 6, COLORS.cream),
    ])
    this.tweens.add({
      targets: core,
      y: y - 9,
      duration: 430 + index * 70,
      yoyo: true,
      repeat: -1,
      ease: 'Stepped',
    })
    this.add.text(x - 21, y + 23, 'CORE', this.pixelText(7, COLORS.navy))
  }

  private drawHazard(x: number, y: number, index: number) {
    const hazard = this.add.container(x, y)
    hazard.add([
      this.add.rectangle(0, 10, 42, 20, COLORS.purple),
      this.add.rectangle(-14, 0, 14, 20, COLORS.pink),
      this.add.rectangle(6, -5, 22, 30, COLORS.pink),
      this.add.rectangle(-7, -6, 5, 7, COLORS.cream),
      this.add.rectangle(11, -10, 5, 7, COLORS.cream),
      this.add.rectangle(-6, -4, 3, 4, COLORS.navy),
      this.add.rectangle(12, -8, 3, 4, COLORS.navy),
    ])
    this.tweens.add({ targets: hazard, scaleX: 1.12, scaleY: 0.88, duration: 300 + index * 80, yoyo: true, repeat: -1, ease: 'Stepped' })
  }

  private drawRelay(x: number, y: number) {
    const relay = this.add.container(x, y)
    relay.add([
      this.add.rectangle(0, 26, 34, 70, COLORS.navy),
      this.add.rectangle(0, -16, 48, 24, COLORS.blue),
      this.add.rectangle(0, -16, 34, 10, COLORS.cream),
      this.add.rectangle(0, 7, 18, 18, COLORS.mint),
      this.add.rectangle(-10, 48, 14, 8, COLORS.gold),
      this.add.rectangle(10, 48, 14, 8, COLORS.gold),
    ])
    this.add.text(x - 32, y - 54, 'RELAY', this.pixelText(8, COLORS.navy))
    this.tweens.add({ targets: relay.getAt(3), alpha: 0.3, duration: 240, yoyo: true, repeat: -1, ease: 'Stepped' })
  }

  private drawExtraction(x: number, y: number, ready: boolean) {
    const color = ready ? COLORS.mint : 0x7081a8
    const portal = this.add.container(x, y)
    portal.add([
      this.add.rectangle(0, 20, 62, 94, COLORS.navy),
      this.add.rectangle(0, 12, 44, 74, color),
      this.add.rectangle(0, 12, 28, 58, ready ? COLORS.cream : 0x9ba6bd),
      this.add.rectangle(-24, -31, 14, 14, COLORS.gold),
      this.add.rectangle(24, -31, 14, 14, COLORS.gold),
    ])
    this.add.text(x - 42, y - 58, ready ? 'GO! GO! GO!' : 'LOCKED', this.pixelText(7, COLORS.navy))
    if (ready) {
      this.tweens.add({ targets: portal, scaleX: 1.08, duration: 260, yoyo: true, repeat: -1, ease: 'Stepped' })
    }
  }

  private drawRunner(player: GameStateViewModel['player']) {
    const { x, y, motion, facing } = player
    const runner = this.add.container(x, y)
    runner.setScale(facing === 'left' ? -1 : 1, 1)

    const scarf = this.add.container(-27, -18, [
      this.add.rectangle(0, 0, 34, 8, COLORS.pink),
      this.add.rectangle(-20, 4, 14, 8, COLORS.pink),
      this.add.rectangle(-30, 8, 8, 8, 0xe32f8c),
    ])

    const makeLeg = (legX: number, color: number) => {
      const leg = this.add.container(legX, 16)
      leg.add([
        this.add.rectangle(0, 10, 10, 25, color).setOrigin(0.5, 0),
        this.add.rectangle(5, 34, 19, 8, COLORS.mint),
        this.add.rectangle(10, 38, 10, 5, COLORS.navy),
      ])
      return leg
    }

    const makeArm = (armX: number, color: number) => {
      const arm = this.add.container(armX, -3)
      arm.add([
        this.add.rectangle(0, 8, 9, 22, color).setOrigin(0.5, 0),
        this.add.rectangle(3, 29, 11, 10, COLORS.mint),
      ])
      return arm
    }

    const rearLeg = makeLeg(-8, 0x1555a9)
    const frontLeg = makeLeg(8, COLORS.blue)
    const rearArm = makeArm(-13, 0x1555a9)
    const frontArm = makeArm(14, COLORS.blue)
    const torso = this.add.container(0, 0, [
      this.add.rectangle(0, 1, 32, 35, COLORS.navy),
      this.add.rectangle(2, 0, 25, 29, 0x2878d0),
      this.add.rectangle(0, 14, 24, 6, COLORS.gold),
      this.add.rectangle(7, 14, 7, 6, 0xe8a62e),
    ])
    const helmet = this.add.container(3, -29, [
      this.add.rectangle(0, 0, 38, 29, COLORS.navy),
      this.add.rectangle(-5, -4, 30, 23, COLORS.cream),
      this.add.rectangle(-12, -14, 18, 8, 0x2878d0),
      this.add.rectangle(-2, -11, 24, 7, COLORS.blue),
      this.add.rectangle(10, 1, 20, 12, COLORS.navyDark),
      this.add.rectangle(14, 1, 11, 5, COLORS.mint),
      this.add.rectangle(-18, 2, 6, 9, COLORS.gold),
    ])

    runner.add([scarf, rearLeg, rearArm, torso, frontLeg, frontArm, helmet])
    this.add.text(x - 22, y - 74, 'YOU', this.pixelText(8, COLORS.navy))

    if (motion === 'run') {
      rearLeg.setAngle(-34)
      frontLeg.setAngle(32)
      rearArm.setAngle(34)
      frontArm.setAngle(-36)
      this.tweens.add({ targets: runner, y: y - 4, duration: 110, yoyo: true, repeat: -1, ease: 'Stepped' })
      this.tweens.add({ targets: scarf, x: -35, y: -22, duration: 165, yoyo: true, repeat: -1, ease: 'Stepped' })
      this.tweens.add({ targets: frontLeg, angle: -34, duration: 145, yoyo: true, repeat: -1, ease: 'Stepped' })
      this.tweens.add({ targets: rearLeg, angle: 32, duration: 145, yoyo: true, repeat: -1, ease: 'Stepped' })
      this.tweens.add({ targets: frontArm, angle: 34, duration: 145, yoyo: true, repeat: -1, ease: 'Stepped' })
      this.tweens.add({ targets: rearArm, angle: -36, duration: 145, yoyo: true, repeat: -1, ease: 'Stepped' })
    }

    if (motion === 'idle') {
      rearLeg.setAngle(-4)
      frontLeg.setAngle(4)
      rearArm.setAngle(5)
      frontArm.setAngle(-5)
      this.tweens.add({ targets: runner, y: y - 2, duration: 520, yoyo: true, repeat: -1, ease: 'Stepped' })
      this.tweens.add({ targets: helmet.getAt(5), alpha: 0.3, duration: 950, yoyo: true, repeat: -1, ease: 'Stepped' })
    }

    if (motion === 'jump') {
      runner.setAngle(4)
      rearLeg.setPosition(-6, 11).setAngle(52)
      frontLeg.setPosition(8, 10).setAngle(-48)
      rearArm.setAngle(42)
      frontArm.setAngle(-55)
      scarf.setPosition(-31, -26).setAngle(-12)
      this.tweens.add({ targets: runner, y: y - 8, angle: -2, duration: 330, yoyo: true, repeat: -1, ease: 'Stepped' })
      this.tweens.add({ targets: scarf, angle: 9, duration: 170, yoyo: true, repeat: -1, ease: 'Stepped' })
    }

    if (motion === 'dash') {
      runner.setScale(facing === 'left' ? -1.16 : 1.16, 0.92)
      runner.setAngle(-5)
      rearLeg.setPosition(-10, 12).setAngle(67)
      frontLeg.setPosition(8, 13).setAngle(74)
      rearArm.setAngle(69)
      frontArm.setAngle(-72)
      scarf.setPosition(-39, -16).setScale(1.4, 0.8)
      const trail = this.add.container(x - 58, y - 3, [
        this.add.rectangle(0, -20, 58, 6, COLORS.pink, 0.8),
        this.add.rectangle(-16, 0, 72, 5, COLORS.blue, 0.65),
        this.add.rectangle(5, 19, 44, 5, COLORS.mint, 0.7),
      ])
      trail.setDepth(runner.depth - 1)
      this.tweens.add({ targets: trail, x: x - 82, alpha: 0.18, duration: 180, yoyo: true, repeat: -1, ease: 'Stepped' })
      this.tweens.add({ targets: runner, x: x + 4, duration: 90, yoyo: true, repeat: -1, ease: 'Stepped' })
    }

    if (motion === 'hit') {
      runner.setAngle(-12)
      rearLeg.setAngle(18)
      frontLeg.setAngle(-22)
      rearArm.setAngle(-58)
      frontArm.setAngle(55)
      scarf.setAngle(18)
      runner.add([
        this.add.rectangle(28, -45, 6, 12, COLORS.gold),
        this.add.rectangle(39, -34, 10, 6, COLORS.gold),
        this.add.rectangle(32, -22, 6, 6, COLORS.red),
      ])
      this.tweens.add({ targets: runner, x: x - 6, alpha: 0.55, duration: 90, yoyo: true, repeat: -1, ease: 'Stepped' })
    }

    return runner
  }

  private bindCommands() {
    this.input.keyboard?.on('keydown-LEFT', () => this.emitCommand({ type: 'move', direction: 'left' }))
    this.input.keyboard?.on('keydown-A', () => this.emitCommand({ type: 'move', direction: 'left' }))
    this.input.keyboard?.on('keydown-RIGHT', () => this.emitCommand({ type: 'move', direction: 'right' }))
    this.input.keyboard?.on('keydown-D', () => this.emitCommand({ type: 'move', direction: 'right' }))
    this.input.keyboard?.on('keydown-UP', () => this.emitCommand({ type: 'jump' }))
    this.input.keyboard?.on('keydown-W', () => this.emitCommand({ type: 'jump' }))
    this.input.keyboard?.on('keydown-SPACE', () => this.emitCommand({ type: 'dash' }))
  }

  private emitCommand(command: PlayerCommand) {
    const now = this.time.now
    if (now - this.lastCommandAt < 60) return
    this.lastCommandAt = now
    this.commandSink(command)
  }

  private pixelText(size: number, color: number): Phaser.Types.GameObjects.Text.TextStyle {
    return {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: `${size}px`,
      color: `#${color.toString(16).padStart(6, '0')}`,
      resolution: 2,
    }
  }

  update(_: number, delta: number) {
    const shift = (delta / 16.67) * 4
    this.speedLines.forEach((line) => {
      line.x -= shift * 2
      if (line.x < -50) line.x = 990
    })
    this.clouds.forEach((cloud, index) => {
      cloud.x -= shift * (0.08 + index * 0.025)
      if (cloud.x < -100) cloud.x = 1060
    })
  }
}
