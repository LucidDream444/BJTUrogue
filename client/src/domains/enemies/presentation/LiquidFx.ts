import Phaser from 'phaser'
import type { GameClock } from '@/core/time'
import type { PlayerProvider } from '../EnemySystem'
import type { LiquidField } from '../liquid/LiquidField'
import { LIQUID_SFX } from '@/core/assetManifest'
import { SfxPool } from './SfxPool'

/** 三个常驻绘图对象；气泡数量和液滩池均封顶，无逐帧粒子/补间分配。 */
export class LiquidFx {
  private readonly floor: Phaser.GameObjects.Graphics
  private readonly coating: Phaser.GameObjects.Graphics
  private readonly label: Phaser.GameObjects.Text
  private readonly sfx: SfxPool
  private wasCoated = false
  private wasPaused = false
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly clock: GameClock,
    private readonly field: LiquidField,
    private readonly player: PlayerProvider,
    private readonly warnings: () => { x: number; y: number; progress: number }[],
  ) {
    this.floor = scene.add.graphics().setDepth(-5)
    this.sfx = new SfxPool({ scene, keys: Object.values(LIQUID_SFX) })
    this.sfx.create()
    this.coating = scene.add.graphics().setDepth(2500)
    this.label = scene.add
      .text(0, 0, '', {
        fontFamily: 'Microsoft YaHei, sans-serif',
        fontSize: '15px',
        color: '#dcffbc',
        backgroundColor: '#172b2a',
        padding: { x: 14, y: 8 },
        align: 'center',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(5000)
      .setVisible(false)
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.draw, this)
  }

  private draw(): void {
    const { field, floor, coating } = this
    const cfg = field.cfg,
      now = this.clock.nowMs
    const paused = this.clock.paused || this.clock.frozen
    if (paused && !this.wasPaused) this.sfx.stopAll()
    this.wasPaused = paused
    floor.clear()
    coating.clear()
    for (const p of field.puddles) {
      if (!p.active) continue
      const r = cfg.spray.puddleRadius
      const fade = Math.min(1, Math.max(0, (p.expiresMs - now) / 1000))
      floor.fillStyle(0x193c2c, fade * 0.6).fillCircle(p.x, p.y + 2, r + 2)
      floor.fillStyle(cfg.fx.color, fade * 0.7).lineStyle(2, cfg.fx.edgeColor, fade * 0.9)
      floor.beginPath()
      // 不规则液滩边缘；最大外径仍使用配置的拾取半径。
      for (let i = 0; i <= 24; i++) {
        const angle = (i / 24) * Math.PI * 2
        const edge = r * (0.91 + 0.06 * Math.sin(angle * 3 + p.x) + 0.03 * Math.cos(angle * 5))
        const x = p.x + Math.cos(angle) * edge,
          y = p.y + Math.sin(angle) * edge
        if (i === 0) floor.moveTo(x, y)
        else floor.lineTo(x, y)
      }
      floor.closePath().fillPath().strokePath()
      for (let i = 0; i < cfg.fx.bubbleCount; i++) {
        const phase = now / 600 + i * 2.4
        const br = 2 + (Math.sin(phase) + 1) * 1.5
        const x = p.x + Math.cos(i * 2.4) * r * 0.57
        const y = p.y + Math.sin(i * 2.4) * r * 0.57
        floor.lineStyle(1, 0xf1ffbb, fade * 0.7).strokeCircle(x, y, br)
      }
    }
    for (const w of this.warnings()) {
      const r = cfg.spray.puddleRadius + cfg.spray.spreadDistance
      floor.fillStyle(cfg.fx.warningColor, 0.08).fillCircle(w.x, w.y, r)
      floor.lineStyle(2, cfg.fx.warningColor, 0.8).strokeCircle(w.x, w.y, r)
      floor.lineStyle(3, 0xffffff, 0.7).strokeCircle(w.x, w.y, r * Math.max(0, 1 - w.progress))
      floor.lineBetween(w.x - 7, w.y, w.x + 7, w.y)
      floor.lineBetween(w.x, w.y - 7, w.x, w.y + 7)
    }
    const target = this.player()
    const active = field.active && !!target?.alive
    if (active !== this.wasCoated) {
      if (target?.alive) this.sfx.play(active ? LIQUID_SFX.pickup : LIQUID_SFX.cleanse, 0, 0.5)
      this.wasCoated = active
    }
    this.label.setVisible(active)
    if (!active || !target) return
    const progress = Math.max(
      field.stillMs / cfg.coating.cleanseStillMs,
      field.movingMs / cfg.coating.cleanseMovingMs,
    )
    const r = target.radius + 7
    coating.lineStyle(3, cfg.fx.color, 0.9).strokeCircle(target.x, target.y, r)
    coating
      .lineStyle(4, 0xf0ffc4, 1)
      .beginPath()
      .arc(target.x, target.y, r + 5, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2)
      .strokePath()
    if (field.moving)
      for (let i = 0; i < 3; i++) {
        const angle = Math.atan2(target.vy, target.vx)
        const distance = r + 6 + i * 9
        coating
          .fillStyle(cfg.fx.color, (3 - i) * 0.2)
          .fillCircle(
            target.x - Math.cos(angle) * distance,
            target.y - Math.sin(angle) * distance,
            5 - i,
          )
      }
    const c = this.scene.cameras.main
    this.label
      .setScale(1 / c.zoom)
      .setPosition(
        c.width * c.originX * (1 - 1 / c.zoom) + c.width / (2 * c.zoom),
        c.height * c.originY * (1 - 1 / c.zoom) + 92 / c.zoom,
      )
      .setText([
        `催化沾液  ·  移速 ×${cfg.coating.speedMultiplier}  ·  接触帧伤 ${cfg.coating.contactDamagePerTick} / ${cfg.coating.contactTickMs / 1000}秒`,
        `自由穿怪  ·  移动耗血 ${cfg.coating.drainDamage} / ${cfg.coating.drainIntervalMs / 1000}秒`,
        `清除：累计移动 ${(field.movingMs / 1000).toFixed(1)} / ${cfg.coating.cleanseMovingMs / 1000} 秒  或  静止 ${(field.stillMs / 1000).toFixed(1)} / ${cfg.coating.cleanseStillMs / 1000} 秒`,
      ])
  }

  destroy(): void {
    this.sfx.destroy()
    this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.draw, this)
    this.floor.destroy()
    this.coating.destroy()
    this.label.destroy()
  }

  spray(): void {
    this.sfx.play(LIQUID_SFX.spray, 0, 0.45)
  }
}
