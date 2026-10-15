import Phaser from 'phaser'
import type { TypedBus, Unsubscribe } from '@/core/events'
import type { GameClock } from '@/core/time'
import type { CombatEvents } from './events'
import type { CombatConfig } from './config'
import { DamageBatches } from './DamageBatches'
interface Floating {
  text: Phaser.GameObjects.Text
  until: number
  born: number
  y: number
}
interface Spark {
  view: Phaser.GameObjects.Arc
  until: number
  born: number
}
/** D3 owns all shake/hitstop/enemy audio. D1 adds bounded text/sparks/player warning only. */
export class CombatFeedback {
  private readonly unsubs: Unsubscribe[] = []
  private readonly floats: Floating[] = []
  private readonly sparks: Spark[] = []
  private readonly batches: DamageBatches
  private readonly warning: Phaser.GameObjects.Rectangle
  private hurtAt = -Infinity
  private hurtColor = 0xff3344
  constructor(
    scene: Phaser.Scene,
    bus: TypedBus<CombatEvents>,
    private readonly clock: GameClock,
    private readonly cfg: CombatConfig,
    position: (id: number) => { x: number; y: number } | null,
  ) {
    this.batches = new DamageBatches(cfg.feedback.aggregateMs, cfg.feedback.maxFloaters)
    for (let i = 0; i < cfg.feedback.maxFloaters; i++)
      this.floats.push({
        text: scene.add
          .text(0, 0, '', {
            fontFamily: 'monospace',
            fontSize: '20px',
            stroke: '#101522',
            strokeThickness: 4,
          })
          .setDepth(3000)
          .setVisible(false),
        until: 0,
        born: 0,
        y: 0,
      })
    for (let i = 0; i < cfg.feedback.maxParticles; i++)
      this.sparks.push({
        view: scene.add.circle(0, 0, 3, 0xffeabb).setDepth(2900).setVisible(false),
        until: 0,
        born: 0,
      })
    this.warning = scene.add
      .rectangle(0, 0, scene.scale.width, scene.scale.height, 0xff3344, 0)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(9000)
    this.unsubs.push(
      bus.on('player_hurt', (e) => {
        const p = position(e.id)
        if (!p) return
        this.hurtAt = this.clock.nowMs
        this.hurtColor = e.hpDamage > 0 ? 0xff3344 : 0x55ccff
        this.batches.add(e.id, e.hpDamage + e.shieldDamage, p.x, p.y, this.clock.nowMs, true)
        this.spark(p.x, p.y)
        scene.cameras.main.shake(cfg.feedback.hurtShakeMs, cfg.feedback.hurtShakeIntensity)
      }),
      bus.on('entity_damaged', (e) => {
        if (e.amount <= 0 || e.targetKind === 'player') return
        const p = position(e.targetId)
        if (!p) return
        this.batches.add(e.targetId, e.amount, p.x, p.y, this.clock.nowMs, false)
      }),
      bus.on('entity_killed', (e) => {
        if (e.kind === 'enemy') this.spark(e.x, e.y)
      }),
    )
  }
  private spark(x: number, y: number): void {
    const s = this.sparks.find((s) => s.until <= this.clock.nowMs)
    if (!s) return
    s.born = this.clock.nowMs
    s.until = s.born + this.cfg.feedback.particleMs
    s.view.setPosition(x, y).setVisible(true).setAlpha(1).setScale(1)
  }
  update(): void {
    const now = this.clock.nowMs
    for (const b of this.batches.flush(now)) {
      const f = this.floats.find((f) => f.until <= now)
      if (!f) continue
      f.born = now
      f.until = now + this.cfg.feedback.floatMs
      f.y = b.y
      f.text
        .setText(`${b.player ? '−' : ''}${Number(b.amount.toFixed(1))}`)
        .setColor(b.player ? '#ff8896' : '#fff1b5')
        .setPosition(b.x, b.y)
        .setVisible(true)
        .setAlpha(1)
      this.spark(b.x, b.y)
    }
    for (const f of this.floats) {
      const t = (now - f.born) / this.cfg.feedback.floatMs
      f.text
        .setVisible(now < f.until)
        .setAlpha(Math.max(0, 1 - t))
        .setY(f.y - t * 40)
    }
    for (const s of this.sparks) {
      const t = (now - s.born) / this.cfg.feedback.particleMs
      s.view
        .setVisible(now < s.until)
        .setAlpha(Math.max(0, 1 - t))
        .setScale(1 + t * 4)
    }
    const camera = this.warning.scene.cameras.main
    this.warning
      .setScale(1 / camera.zoom)
      .setPosition(
        camera.width * camera.originX * (1 - 1 / camera.zoom),
        camera.height * camera.originY * (1 - 1 / camera.zoom),
      )
      .setSize(camera.width, camera.height)
      .setFillStyle(
        this.hurtColor,
        Math.max(0, 1 - (now - this.hurtAt) / this.cfg.feedback.hurtFlashMs) *
          this.cfg.feedback.hurtFlashAlpha,
      )
  }
  destroy(): void {
    for (const off of this.unsubs) off()
    this.batches.pending.clear()
    for (const f of this.floats) f.text.destroy()
    for (const s of this.sparks) s.view.destroy()
    this.warning.destroy()
  }
}
