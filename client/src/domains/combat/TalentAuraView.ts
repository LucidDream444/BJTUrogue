import Phaser from 'phaser'
import type { GameClock } from '@/core/time'
import type { Player } from './Player'
import type { TalentFxConfig, TalentFxGlyph } from './config'
import type { TalentKind, TalentRun } from './TalentRun'

interface Burst {
  kind: TalentKind
  start: number
}

/**
 * Visual-only talent identity around the player.
 *
 * Three layers:
 *  - `under`: a subtle ground ellipse under the feet;
 *  - `over`: one belt of up to eight owned-talent glyphs;
 *  - `burst`: a short acquisition ring in the new talent's color.
 *
 * No damage/healing/status is applied here. `TalentCombat` owns procs; this view
 * only mirrors ownership and condition state so a build is readable at a glance.
 */
export class TalentAuraView {
  private readonly under: Phaser.GameObjects.Graphics
  private readonly over: Phaser.GameObjects.Graphics
  private readonly burst: Phaser.GameObjects.Graphics
  private readonly pending: TalentKind[] = []
  private activeBurst: Burst | null = null
  private disposed = false

  constructor(
    scene: Phaser.Scene,
    private readonly clock: GameClock,
    private readonly run: TalentRun,
    private readonly player: Player,
    private readonly cfg: TalentFxConfig,
  ) {
    this.under = scene.add.graphics()
    this.over = scene.add.graphics()
    this.burst = scene.add.graphics()
  }

  /** Queued because reward selection happens while the clock is paused. */
  acquire(kind: TalentKind): void {
    if (this.disposed) return
    this.pending.push(kind)
  }

  clear(): void {
    this.pending.length = 0
    this.activeBurst = null
    this.under.clear()
    this.over.clear()
    this.burst.clear()
  }

  update(): void {
    if (this.disposed) return
    const now = this.clock.nowMs
    if (!this.clock.paused) {
      if (!this.activeBurst && this.pending.length)
        this.activeBurst = { kind: this.pending.shift()!, start: now }
      if (this.activeBurst && now - this.activeBurst.start >= this.cfg.burstMs)
        this.activeBurst = null
    }
    this.draw(now)
  }

  destroy(): void {
    if (this.disposed) return
    this.disposed = true
    this.clear()
    this.under.destroy()
    this.over.destroy()
    this.burst.destroy()
  }

  private draw(now: number): void {
    const under = this.under,
      over = this.over,
      burst = this.burst
    under.clear()
    over.clear()
    burst.clear()
    if (!this.player.model.alive) return
    const owned = this.run.owned
    if (!owned.length) return

    const cx = this.player.x
    const cy = this.player.y - 2
    const feet = this.player.feetY
    const moving = Math.hypot(this.player.body.velocity.x, this.player.body.velocity.y) > 10
    const first = this.cfg.entries[owned[0]!.talent!.kind]

    if (first)
      under
        .lineStyle(1, first.color, this.cfg.idleAlpha * 0.28)
        .strokeEllipse(cx, feet - 4, this.cfg.orbitRadius * 1.35, this.cfg.orbitRadius * 0.52)

    const count = owned.length
    const base = (now / 1000) * this.cfg.spinRadPerSec
    over.lineStyle(1, this.cfg.ringColor, 0.14).strokeCircle(cx, cy, this.cfg.orbitRadius)
    for (let i = 0; i < count; i++) {
      const kind = owned[i]!.talent!.kind
      const fx = this.cfg.entries[kind]
      if (!fx) continue
      const angle = base + (i * Math.PI * 2) / count
      const x = cx + Math.cos(angle) * this.cfg.orbitRadius
      const y = cy + Math.sin(angle) * this.cfg.orbitRadius
      const active = this.run.auraActive(kind, this.player.model, now, moving)
      this.glyph(
        over,
        fx.glyph,
        x,
        y,
        this.cfg.orbitSize * (active ? 1.2 : 1),
        fx.color,
        active ? this.cfg.activeAlpha : this.cfg.idleAlpha,
      )
    }

    if (this.activeBurst) {
      const progress = (now - this.activeBurst.start) / this.cfg.burstMs
      if (progress >= 0 && progress <= 1) {
        const fx = this.cfg.entries[this.activeBurst.kind]
        if (fx) this.drawBurst(burst, cx, cy, progress, fx.color, fx.glyph)
      }
    }

    under.setDepth(feet - 1.5)
    over.setDepth(feet + 0.2)
    burst.setDepth(feet + 0.3)
  }

  private drawBurst(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    progress: number,
    color: number,
    glyph: TalentFxGlyph,
  ): void {
    const fade = 1 - progress
    const radius = 10 + 58 * progress
    g.lineStyle(3 * fade, color, 0.9 * fade).strokeCircle(x, y, radius)
    g.lineStyle(1.5, color, 0.45 * fade).strokeCircle(x, y, radius * 0.68)
    this.glyph(g, glyph, x, y, this.cfg.orbitSize * (1.4 + progress * 0.8), color, 0.85 * fade)
    for (let i = 0; i < 6; i++) {
      const angle = progress * Math.PI * 4 + (i * Math.PI) / 3
      const inner = radius * 0.55
      g.lineStyle(1.5, color, 0.6 * fade).lineBetween(
        x + Math.cos(angle) * inner,
        y + Math.sin(angle) * inner,
        x + Math.cos(angle) * radius,
        y + Math.sin(angle) * radius,
      )
    }
  }

  /** Small procedural glyphs; no textures, no per-glyph GameObjects. */
  private glyph(
    g: Phaser.GameObjects.Graphics,
    glyph: TalentFxGlyph,
    x: number,
    y: number,
    size: number,
    color: number,
    alpha: number,
  ): void {
    const s = Math.max(3, size)
    g.lineStyle(Math.max(1, s * 0.24), color, alpha)
    switch (glyph) {
      case 'dot':
        g.fillStyle(color, alpha).fillCircle(x, y, s * 0.46)
        break
      case 'twin':
        g.fillStyle(color, alpha).fillCircle(x - s * 0.42, y, s * 0.28)
        g.fillCircle(x + s * 0.42, y, s * 0.28)
        break
      case 'arrow':
        g.lineBetween(x - s, y, x + s * 0.25, y)
        g.lineBetween(x + s * 0.25, y, x - s * 0.05, y - s * 0.55)
        g.lineBetween(x + s * 0.25, y, x - s * 0.05, y + s * 0.55)
        break
      case 'ring':
        g.strokeCircle(x, y, s * 0.72)
        g.fillStyle(color, alpha).fillCircle(x, y, s * 0.16)
        break
      case 'star':
        this.star(g, x, y, s, color, alpha)
        break
      case 'bolt':
        g.beginPath()
        g.moveTo(x + s * 0.25, y - s)
        g.lineTo(x - s * 0.45, y + s * 0.12)
        g.lineTo(x + s * 0.02, y + s * 0.12)
        g.lineTo(x - s * 0.25, y + s)
        g.lineTo(x + s * 0.55, y - s * 0.18)
        g.lineTo(x + s * 0.08, y - s * 0.18)
        g.closePath()
        g.strokePath()
        break
      case 'crescent':
        g.beginPath()
        g.arc(x, y + s * 0.15, s, -1.05, 1.05, false)
        g.strokePath()
        break
      case 'burst':
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3
          g.lineBetween(
            x + Math.cos(a) * s * 0.25,
            y + Math.sin(a) * s * 0.25,
            x + Math.cos(a) * s,
            y + Math.sin(a) * s,
          )
        }
        g.strokeCircle(x, y, s * 0.42)
        break
      case 'hex':
        this.polygon(g, x, y, s, 6, color, alpha, Math.PI / 6)
        break
      case 'droplet':
        g.fillStyle(color, alpha * 0.85).fillCircle(x, y + s * 0.25, s * 0.5)
        g.beginPath()
        g.moveTo(x, y - s)
        g.lineTo(x - s * 0.42, y + s * 0.15)
        g.lineTo(x + s * 0.42, y + s * 0.15)
        g.closePath()
        g.fillPath()
        break
      case 'snow':
        for (let i = 0; i < 3; i++) {
          const a = (i * Math.PI) / 3
          g.lineBetween(
            x - Math.cos(a) * s,
            y - Math.sin(a) * s,
            x + Math.cos(a) * s,
            y + Math.sin(a) * s,
          )
        }
        g.strokeCircle(x, y, s * 0.25)
        break
      case 'clock':
        g.strokeCircle(x, y, s * 0.8)
        g.lineBetween(x, y, x, y - s * 0.55)
        g.lineBetween(x, y, x + s * 0.42, y + s * 0.18)
        break
      case 'heart':
        g.fillStyle(color, alpha).fillCircle(x - s * 0.3, y - s * 0.18, s * 0.34)
        g.fillCircle(x + s * 0.3, y - s * 0.18, s * 0.34)
        g.beginPath()
        g.moveTo(x - s * 0.62, y - s * 0.02)
        g.lineTo(x, y + s * 0.85)
        g.lineTo(x + s * 0.62, y - s * 0.02)
        g.closePath()
        g.fillPath()
        break
      case 'battery':
        g.strokeRect(x - s * 0.42, y - s * 0.62, s * 0.84, s * 1.24)
        g.fillStyle(color, alpha * 0.65).fillRect(
          x - s * 0.28,
          y - s * 0.3,
          s * 0.56,
          s * 0.6,
        )
        g.lineBetween(x - s * 0.14, y - s * 0.8, x + s * 0.14, y - s * 0.8)
        break
      case 'book':
        g.strokeRect(x - s * 0.65, y - s * 0.7, s * 1.3, s * 1.4)
        g.lineBetween(x, y - s * 0.7, x, y + s * 0.7)
        g.lineBetween(x - s * 0.45, y - s * 0.18, x - s * 0.16, y - s * 0.18)
        break
      case 'void':
        g.fillStyle(0x1a1028, alpha * 0.9).fillCircle(x, y, s * 0.6)
        g.strokeCircle(x, y, s * 0.78)
        g.fillStyle(color, alpha * 0.85).fillCircle(x + s * 0.62, y - s * 0.12, s * 0.12)
        break
      case 'link':
        g.strokeCircle(x - s * 0.45, y, s * 0.35)
        g.strokeCircle(x + s * 0.45, y, s * 0.35)
        g.lineBetween(x - s * 0.12, y, x + s * 0.12, y)
        break
      case 'chevron':
        g.lineBetween(x - s * 0.8, y + s * 0.45, x, y - s * 0.45)
        g.lineBetween(x, y - s * 0.45, x + s * 0.8, y + s * 0.45)
        g.lineBetween(x - s * 0.55, y + s * 0.78, x, y + s * 0.2)
        break
      case 'bell':
        g.beginPath()
        g.moveTo(x - s * 0.72, y + s * 0.38)
        g.lineTo(x - s * 0.48, y - s * 0.12)
        g.lineTo(x - s * 0.2, y - s * 0.62)
        g.lineTo(x + s * 0.2, y - s * 0.62)
        g.lineTo(x + s * 0.48, y - s * 0.12)
        g.lineTo(x + s * 0.72, y + s * 0.38)
        g.closePath()
        g.strokePath()
        g.lineBetween(x - s * 0.78, y + s * 0.4, x + s * 0.78, y + s * 0.4)
        g.fillStyle(color, alpha).fillCircle(x, y + s * 0.58, s * 0.17)
        break
      case 'loop':
        g.beginPath()
        g.arc(x, y, s * 0.7, -0.2, Math.PI * 1.5, false)
        g.strokePath()
        g.lineBetween(x + s * 0.55, y + s * 0.45, x + s * 0.85, y + s * 0.2)
        break
      case 'fan':
        for (let i = -1; i <= 1; i++) {
          g.lineBetween(x, y + s * 0.65, x + i * s * 0.72, y - s * 0.7)
        }
        break
      case 'flame':
        g.beginPath()
        g.moveTo(x, y - s)
        g.lineTo(x + s * 0.65, y + s * 0.15)
        g.lineTo(x + s * 0.22, y + s * 0.8)
        g.lineTo(x - s * 0.5, y + s * 0.55)
        g.lineTo(x - s * 0.55, y - s * 0.12)
        g.closePath()
        g.fillPath()
        break
      case 'shard':
        g.beginPath()
        g.moveTo(x, y - s)
        g.lineTo(x + s * 0.62, y + s * 0.65)
        g.lineTo(x - s * 0.55, y + s * 0.45)
        g.closePath()
        g.fillPath()
        break
      default: {
        // Keep this exhaustive: a new glyph must be implemented here, not silently skipped.
        const never: never = glyph
        void never
      }
    }
  }

  private polygon(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    size: number,
    sides: number,
    color: number,
    alpha: number,
    rotation: number,
  ): void {
    g.fillStyle(color, alpha * 0.18)
    g.beginPath()
    for (let i = 0; i < sides; i++) {
      const angle = rotation + (i * Math.PI * 2) / sides
      const px = x + Math.cos(angle) * size * 0.72
      const py = y + Math.sin(angle) * size * 0.72
      if (i === 0) g.moveTo(px, py)
      else g.lineTo(px, py)
    }
    g.closePath()
    g.fillPath()
    g.strokePath()
  }

  private star(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    size: number,
    color: number,
    alpha: number,
  ): void {
    g.fillStyle(color, alpha * 0.9)
    g.beginPath()
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI) / 5
      const radius = i % 2 === 0 ? size : size * 0.42
      const px = x + Math.cos(angle) * radius
      const py = y + Math.sin(angle) * radius
      if (i === 0) g.moveTo(px, py)
      else g.lineTo(px, py)
    }
    g.closePath()
    g.fillPath()
  }
}
