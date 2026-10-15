import Phaser from 'phaser'
import type { GameClock } from '@/core/time'
import type { Stage2BossDef } from '@/core/config'
import type { EnemySystem } from '../EnemySystem'

/** One graphics object draws the bounded projectile pool and the spell's windup cue. */
export class RadialBurstFx {
  private readonly graphics: Phaser.GameObjects.Graphics

  constructor(
    scene: Phaser.Scene,
    private readonly enemies: EnemySystem,
    private readonly clock: GameClock,
    private readonly cfg: Stage2BossDef,
  ) {
    this.graphics = scene.add.graphics().setDepth(32)
  }

  update(): void {
    const g = this.graphics.clear()
    const now = this.clock.nowMs
    for (const { model, view } of this.enemies.liveEnemies) {
      if (!model.alive || !this.enemies.isStage2Boss(model.id) || model.state !== 'windup') continue
      const progress = Math.min(1, model.stateAgeMs(now) / this.cfg.windupMs)
      const { x, y } = view.body.center
      const radius = model.stats.radius * (1 + progress)
      g.fillStyle(0x76ddff, 0.05 + progress * 0.07).fillCircle(x, y, radius)
      g.lineStyle(2, 0xa8edff, 0.3 + progress * 0.6).strokeCircle(x, y, radius)
      g.lineStyle(1, 0x76ddff, 0.3).strokeCircle(x, y, radius + 8)
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2 + now / 750
        g.fillStyle(0xe0fbff, 0.8)
        g.fillCircle(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, 2)
      }
    }
    const radius = this.cfg.projectile.radius
    for (const shot of this.enemies.radialShots.shots) {
      if (!shot.active) continue
      const dx = shot.vx / this.cfg.projectile.speed,
        dy = shot.vy / this.cfg.projectile.speed
      const age = now - shot.bornAtMs
      const fade = Math.min(1, (this.cfg.projectile.lifetimeMs - age) / 220)
      const tail = Math.min(24, (age * this.cfg.projectile.speed) / 1000)
      g.lineStyle(radius * 1.2, 0x60cfff, 0.25 * fade)
      g.lineBetween(shot.x - dx * tail, shot.y - dy * tail, shot.x, shot.y)
      g.fillStyle(0x4fb9ff, 0.18 * fade).fillCircle(shot.x, shot.y, radius * 1.8)
      g.fillStyle(0x7fddff, 0.9 * fade).fillCircle(shot.x, shot.y, radius)
      g.fillStyle(0xf0ffff, fade).fillCircle(shot.x, shot.y, radius * 0.5)
      g.fillStyle(0xb6f5ff, 0.5 * fade)
      g.fillCircle(shot.x - dx * tail * 1.6, shot.y - dy * tail * 1.6, 1.5)
    }
  }

  destroy(): void {
    this.graphics.destroy()
  }
}
