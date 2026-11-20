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
    // 弹丸必须画在首领巨大的身体之上：首领贴图深度按 y（几百），32 会被完全盖住。
    // 3000 高于实体与武器特效（2500），低于 HUD（5010）。
    this.graphics = scene.add.graphics().setDepth(3000)
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
    for (const shot of this.enemies.radialShots.shots) {
      if (!shot.active) continue
      const pulse = shot.pulsePeriodMs > 0
        ? Math.sin((now / shot.pulsePeriodMs) * Math.PI * 2 + shot.id) * 0.5 + 0.5
        : 0
      const radius = shot.radius * (shot.pulseMin + (shot.pulseMax - shot.pulseMin) * pulse)
      const dx = shot.vx / shot.speed,
        dy = shot.vy / shot.speed
      const age = now - shot.bornAtMs
      const fade = Math.min(1, (shot.lifetimeMs - age) / 220)
      const tail = Math.min(24, (age * shot.speed) / 1000)
      // 用弹丸自己的颜色画光晕/拖尾：首领弹幕配置成红色时整颗子弹都是红的，
      // 不再被写死的蓝色光晕盖掉。
      const color = shot.color ?? 0x60cfff
      g.lineStyle(radius * 1.2, color, 0.25 * fade)
      g.lineBetween(shot.x - dx * tail, shot.y - dy * tail, shot.x, shot.y)
      g.fillStyle(color, 0.18 * fade).fillCircle(shot.x, shot.y, radius * 1.8)
      g.fillStyle(color, 0.9 * fade).fillCircle(shot.x, shot.y, radius)
      g.fillStyle(0xffffff, fade).fillCircle(shot.x, shot.y, radius * 0.45)
      g.fillStyle(color, 0.5 * fade)
      g.fillCircle(shot.x - dx * tail * 1.6, shot.y - dy * tail * 1.6, 1.5)
    }
  }

  destroy(): void {
    this.graphics.destroy()
  }
}
