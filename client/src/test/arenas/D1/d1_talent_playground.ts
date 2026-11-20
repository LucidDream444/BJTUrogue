import Phaser from 'phaser'
import {
  ArenaBase,
  type ArenaConfig,
  type ArenaContext,
  type ArenaDefinition,
} from '../../ArenaBase'
import { TalentPlayground, type PlaygroundConfig } from './_TalentPlaygroundModel'
import { TalentPlaygroundUi } from './_TalentPlaygroundUi'

/** Preview only: real flight/hits, isolated from product battles and progression. */
class TalentPlaygroundArena extends ArenaBase {
  private lab!: TalentPlayground
  private labUi!: TalentPlaygroundUi
  private drawing!: Phaser.GameObjects.Graphics
  private labels: Phaser.GameObjects.Text[] = []
  private stage = { x: 0, y: 0, scale: 1 }
  private auto = true
  private held = false
  private keys = new Set<string>()
  private controller: AbortController | null = null
  private nextUi = 0
  private aim = { x: 700, y: 360 }
  private pointerInside = false
  private wasHidden = false

  protected get definition(): ArenaDefinition {
    return arena
  }
  override preload(): void {
    super.preload()
    this.load.json(
      'talent-playground',
      new URL('config/talent-playground.json', document.baseURI).href,
    )
  }
  protected configure(): ArenaConfig {
    const config = this.cache.json.get('talent-playground') as PlaygroundConfig | undefined
    if (
      !config ||
      config.schemaVersion !== 1 ||
      !config.presets?.length ||
      Object.values(config.tuning).some((v) => !Number.isFinite(v) || v <= 0)
    )
      throw new Error('天赋测试场配置缺失或数值无效')
    return { spawns: [], field: config.world, rngSeed: config.tuning.seed }
  }
  protected override onArenaCreate(ctx: ArenaContext): void {
    this.keys = new Set()
    this.auto = true
    this.held = false
    this.nextUi = 0
    this.wasHidden = false
    this.lab = new TalentPlayground(this.cache.json.get('talent-playground') as PlaygroundConfig)
    // Keep the base physics body alive; detach its debug gun before the first shot.
    ctx.gun.shutdown()
    ctx.player.setInvulnerable(true)
    this.cameras.main.ignore(this.children.getChildren())
    this.cameras.main.setBackgroundColor('#0c121d')
    this.drawing = this.add.graphics().setDepth(100).setScrollFactor(0)
    this.labels = Array.from({ length: 32 }, () =>
      this.add
        .text(0, 0, '', {
          fontFamily: 'Consolas, Microsoft YaHei',
          fontSize: '18px',
          fontStyle: 'bold',
          color: '#ffffff',
        })
        .setDepth(105)
        .setScrollFactor(0)
        .setOrigin(0.5),
    )
    this.labUi = new TalentPlaygroundUi(this.lab.config, {
      select: (id) => this.select(id),
      toggle: (effect) => {
        this.lab.toggle(effect)
        this.labUi.refresh(this.lab)
      },
      auto: () => {
        this.auto = !this.auto
        this.held = false
      },
      reset: () => this.lab.reset(),
      pause: () => {
        if (ctx.clock.paused) {
          ctx.clock.resume()
          this.physics.world.resume()
        } else {
          ctx.clock.pause()
          this.physics.world.pause()
        }
      },
      skill: () => {
        if (!ctx.clock.paused) this.lab.skill(this.auto ? this.lab.aimTarget() : this.aim)
      },
    })
    this.labUi.refresh(this.lab)
    this.controller = new AbortController()
    const { signal } = this.controller
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.repeat) return
        this.keys.add(event.code)
        if (/^Digit[1-5]$/.test(event.code))
          this.select(this.lab.config.presets[Number(event.code.slice(-1)) - 1]!.id)
        if (event.code === 'Digit6') this.select('baseline')
        if (event.code === 'KeyQ' && !ctx.clock.paused)
          this.lab.skill(this.auto ? this.lab.aimTarget() : this.aim)
      },
      { signal },
    )
    window.addEventListener('keyup', (event) => this.keys.delete(event.code), { signal })
    window.addEventListener('pointermove', (event) => this.readPointer(event), { signal })
    window.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0 || (event.target as HTMLElement).tagName !== 'CANVAS') return
        this.readPointer(event)
        if (this.pointerInside) {
          this.auto = false
          this.held = true
        }
      },
      { signal },
    )
    window.addEventListener(
      'pointerup',
      () => {
        this.held = false
      },
      { signal },
    )
    window.addEventListener(
      'blur',
      () => {
        this.held = false
        this.keys.clear()
      },
      { signal },
    )
    document.addEventListener(
      'visibilitychange',
      () => {
        this.wasHidden = document.hidden
        this.held = false
        this.keys.clear()
      },
      { signal },
    )
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.controller?.abort()
      this.controller = null
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this)
      this.labUi.destroy()
      this.labels = []
      document.title = '测试场 — 课后勇者'
    })
    document.title = '天赋试射场 · 课后勇者'
    this.layout()
    this.labUi.update(this.lab, this.auto, ctx.clock.paused)
  }
  protected override onArenaUpdate(dt: number, ctx: ArenaContext): void {
    if (!this.lab || !this.labUi) return
    if (!ctx.clock.paused && !this.wasHidden) {
      if (this.auto) this.aim = this.lab.aimTarget()
      this.lab.step(dt, {
        moveX:
          Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) -
          Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft')),
        moveY:
          Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')) -
          Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')),
        aimX: this.aim.x,
        aimY: this.aim.y,
        fire: this.auto || this.held,
      })
    }
    this.renderLab()
    if (this.time.now >= this.nextUi) {
      this.labUi.update(this.lab, this.auto, ctx.clock.paused)
      this.nextUi = this.time.now + 100
    }
  }
  private select(id: string): void {
    this.lab.select(id)
    this.held = false
    this.labUi.refresh(this.lab)
  }
  private readPointer(event: PointerEvent): void {
    const canvas = this.game.canvas.getBoundingClientRect()
    const localX = ((event.clientX - canvas.left) * this.scale.width) / canvas.width
    const localY = ((event.clientY - canvas.top) * this.scale.height) / canvas.height
    const x = (localX - this.stage.x) / this.stage.scale,
      y = (localY - this.stage.y) / this.stage.scale
    this.pointerInside =
      x >= 0 && x <= this.lab.config.world.width && y >= 0 && y <= this.lab.config.world.height
    if (this.pointerInside) this.aim = { x, y }
  }
  private layout(): void {
    if (!this.labUi) return
    const canvas = this.game.canvas.getBoundingClientRect(),
      box = this.labUi.viewport.getBoundingClientRect()
    const xRatio = this.scale.width / canvas.width,
      yRatio = this.scale.height / canvas.height
    const width = box.width * xRatio,
      height = box.height * yRatio
    const scale = Math.min(
      width / this.lab.config.world.width,
      height / this.lab.config.world.height,
    )
    this.stage = {
      x: (box.left - canvas.left) * xRatio + (width - this.lab.config.world.width * scale) / 2,
      y: (box.top - canvas.top) * yRatio + (height - this.lab.config.world.height * scale) / 2,
      scale,
    }
    this.drawing.setPosition(this.stage.x, this.stage.y).setScale(scale)
  }
  private renderLab(): void {
    const g = this.drawing,
      lab = this.lab,
      t = lab.config.tuning,
      world = lab.config.world
    const color = lab.config.presets.find((p) => p.id === lab.presetId)?.color ?? 0xdbe4f3,
      time = lab.now / 1000
    g.clear().fillStyle(0x101925).fillRect(0, 0, world.width, world.height)
    g.lineStyle(1, 0x26384d, 0.28)
    for (let x = world.padding; x <= world.width - world.padding; x += 44)
      g.lineBetween(x, world.padding, x, world.height - world.padding)
    for (let y = world.padding; y <= world.height - world.padding; y += 44)
      g.lineBetween(world.padding, y, world.width - world.padding, y)
    g.lineStyle(2, color, 0.25).strokeRoundedRect(
      world.padding,
      world.padding,
      world.width - world.padding * 2,
      world.height - world.padding * 2,
      10,
    )
    g.lineStyle(1, 0xb5c5dc, 0.12).strokeCircle(lab.player.x, lab.player.y, 38)
    g.lineStyle(1, 0xb5c5dc, 0.05).strokeCircle(lab.player.x, lab.player.y, 110)
    for (const effect of lab.effects) {
      const progress = effect.age / effect.life,
        fade = 1 - progress
      if (effect.kind === 'field') {
        g.fillStyle(color, 0.035 + progress * 0.04).fillCircle(effect.x, effect.y, effect.size)
        g.fillStyle(0x090c18, 0.92).fillCircle(effect.x, effect.y, 17 + Math.sin(time * 7) * 3)
        g.lineStyle(2, color, 0.75).strokeCircle(effect.x, effect.y, 24)
        for (let i = 0; i < 7; i++) {
          const angle = time * 2.8 + (i * Math.PI * 2) / 7,
            radius = 30 + ((i * 17 + (1 - progress) * 110) % 100)
          g.lineStyle(1.5, color, 0.2 + radius / 220).lineBetween(
            effect.x + Math.cos(angle) * radius,
            effect.y + Math.sin(angle) * radius,
            effect.x + Math.cos(angle + 0.3) * (radius - 12),
            effect.y + Math.sin(angle + 0.3) * (radius - 12),
          )
        }
        g.lineStyle(1, color, 0.2).strokeCircle(
          effect.x,
          effect.y,
          effect.size * (1 - progress * 0.3),
        )
      } else if (effect.kind === 'explosion') {
        const radius = effect.size * (0.2 + progress * 0.9)
        g.fillStyle(color, fade * 0.12).fillCircle(effect.x, effect.y, radius)
        g.lineStyle(3 * fade, color, fade * 0.75).strokeCircle(effect.x, effect.y, radius)
        for (let i = 0; i < 8; i++) {
          const angle = (i * Math.PI) / 4 + effect.x
          g.lineStyle(2, color, fade * 0.65).lineBetween(
            effect.x + Math.cos(angle) * radius,
            effect.y + Math.sin(angle) * radius,
            effect.x + Math.cos(angle) * (radius + 8 * fade),
            effect.y + Math.sin(angle) * (radius + 8 * fade),
          )
        }
      } else if (effect.kind === 'lightning' && effect.points) {
        for (let i = 1; i < effect.points.length; i++) {
          const from = effect.points[i - 1]!,
            to = effect.points[i]!
          for (const [width, alpha] of [
            [12, 0.1],
            [5, 0.4],
            [2, 1],
          ]) {
            g.lineStyle(width!, color, fade * alpha!)
              .beginPath()
              .moveTo(from.x, from.y)
            for (let j = 1; j <= 9; j++) {
              const fraction = j / 9,
                wave = j === 9 ? 0 : Math.sin(j * 19 + effect.x + effect.age * 0.03) * 11
              g.lineTo(
                from.x + (to.x - from.x) * fraction + wave,
                from.y + (to.y - from.y) * fraction - wave,
              )
            }
            g.strokePath()
          }
        }
      } else if (effect.kind === 'hit' || effect.kind === 'bounce') {
        g.lineStyle(2, color, fade * 0.7).strokeCircle(
          effect.x,
          effect.y,
          effect.size * (0.3 + progress),
        )
      } else if (effect.kind === 'muzzle')
        g.fillStyle(color, fade * 0.7).fillCircle(effect.x, effect.y, effect.size * fade)
    }
    for (const target of lab.targets) {
      if (target.hp <= 0) continue
      const r = t.enemyRadius
      g.fillStyle(0x060c16, 0.6).fillEllipse(target.x + 4, target.y + r + 7, r * 2.5, 9)
      g.fillStyle(target.flash > 0 ? color : 0xc0cbd9, target.flash > 0 ? 1 : 0.8).fillRoundedRect(
        target.x - r,
        target.y - r,
        r * 2,
        r * 2,
        5,
      )
      g.lineStyle(1, 0xf4f7ff, 0.6).strokeRoundedRect(target.x - r, target.y - r, r * 2, r * 2, 5)
      g.fillStyle(0x142033)
        .fillRect(target.x - 7, target.y - 3, 4, 4)
        .fillRect(target.x + 4, target.y - 3, 4, 4)
      g.fillStyle(0x27384c).fillRect(target.x - r, target.y - r - 10, r * 2, 3)
      g.fillStyle(color, 0.8).fillRect(
        target.x - r,
        target.y - r - 10,
        r * 2 * Math.max(0, target.hp / t.enemyHp),
        3,
      )
    }
    for (const bullet of lab.bullets) {
      const angle = bullet.orbit
        ? time * t.orbitSpeed + bullet.phase + Math.PI / 2
        : Math.atan2(bullet.vy, bullet.vx)
      const size = bullet.crit ? 5.5 : bullet.secondary ? 3 : 4,
        bright = bullet.crit ? 0xffefc5 : color
      g.lineStyle(size * 3.5, color, 0.06).lineBetween(
        bullet.x - Math.cos(angle) * 24,
        bullet.y - Math.sin(angle) * 24,
        bullet.x,
        bullet.y,
      )
      g.lineStyle(size * 1.7, color, 0.24).lineBetween(
        bullet.x - Math.cos(angle) * 17,
        bullet.y - Math.sin(angle) * 17,
        bullet.x,
        bullet.y,
      )
      g.lineStyle(size, bright, 0.95).lineBetween(
        bullet.x - Math.cos(angle) * 8,
        bullet.y - Math.sin(angle) * 8,
        bullet.x,
        bullet.y,
      )
      g.fillStyle(0xffffff, 0.95).fillCircle(bullet.x, bullet.y, size * 0.48)
    }
    const angle = Math.atan2(this.aim.y - lab.player.y, this.aim.x - lab.player.x)
    g.fillStyle(0x070d17, 0.65).fillEllipse(lab.player.x, lab.player.y + 20, 35, 10)
    g.fillStyle(0xf2f5fa).fillRoundedRect(lab.player.x - 12, lab.player.y - 15, 24, 30, 5)
    g.lineStyle(7, 0x62758c).lineBetween(
      lab.player.x,
      lab.player.y,
      lab.player.x + Math.cos(angle) * 24,
      lab.player.y + Math.sin(angle) * 24,
    )
    g.lineStyle(3, color).lineBetween(
      lab.player.x + Math.cos(angle) * 13,
      lab.player.y + Math.sin(angle) * 13,
      lab.player.x + Math.cos(angle) * 26,
      lab.player.y + Math.sin(angle) * 26,
    )
    g.fillStyle(color).fillCircle(lab.player.x, lab.player.y - 4, 3)
    if (!this.auto && this.pointerInside) {
      g.lineStyle(1, color, 0.8).strokeCircle(this.aim.x, this.aim.y, 9)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        g.lineBetween(
          this.aim.x + dx! * 5,
          this.aim.y + dy! * 5,
          this.aim.x + dx! * 15,
          this.aim.y + dy! * 15,
        )
    }
    const numbers = lab.effects
      .filter((effect) => effect.kind === 'number')
      .slice(-this.labels.length)
    this.labels.forEach((label, index) => {
      const effect = numbers[index]
      if (!effect) {
        label.setVisible(false)
        return
      }
      const progress = effect.age / effect.life
      label
        .setVisible(true)
        .setText(`${effect.crit ? '✦ ' : ''}${effect.value}`)
        .setPosition(
          this.stage.x + effect.x * this.stage.scale,
          this.stage.y + (effect.y - 25 - progress * 32) * this.stage.scale,
        )
        .setScale(this.stage.scale * (effect.crit ? 1.12 : 0.85))
        .setAlpha(1 - progress)
        .setColor(effect.crit ? '#ffe0a0' : '#d9e6f3')
    })
  }
}

export const arena = {
  displayName: '天赋试射场 · 五组奖励亲手玩',
  description:
    '分裂追踪 / 跳弹风暴 / 暴击雷网 / 回旋星环 / 黑洞聚爆。WASD 移动、左键开火、1—5 换组合、6 普通射击、Q 落雷；点击右侧卡片开关天赋。',
  scene: TalentPlaygroundArena,
}
