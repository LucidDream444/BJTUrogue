import type Phaser from 'phaser'
import { NIGHTMARE_CAT_ART } from '@/core/assetManifest'
import { textureKeyFor } from '@/core/assets'
import type { GameClock } from '@/core/time'
import type { ConfigBundle } from '@/core/config'
import type { EnemySystem } from '../EnemySystem'

const TAU = Math.PI * 2
const DAMAGE_COLOR = 0xdfa6ff

/** Only damaging areas are marked; pull and projectile deflection remain invisible wind. */
export class AnimalAttackFx {
  private readonly graphics: Phaser.GameObjects.Graphics
  private readonly winds = new Map<number, Phaser.GameObjects.Sprite>()
  private readonly activeFields = new Set<number>()
  constructor(private readonly scene: Phaser.Scene, private readonly clock: GameClock, private readonly enemies: EnemySystem, private readonly bundle: ConfigBundle) {
    this.graphics = scene.add.graphics().setDepth(1)
  }
  update(): void {
    this.graphics.clear()
    const nowMs = this.clock.nowMs
    const cfg = this.bundle.enemies.enemies.nightmare_cat.vortex
    for (const { model, view } of this.enemies.liveEnemies) {
      if (!model.alive || model.state !== 'windup') continue
      const center = view.body.center
      if (model.enemyKind === 'muscovy') {
        const distance = this.bundle.enemies.enemies.muscovy.charge.dashDistance
        this.graphics.lineStyle(2, 0xf39a68, 0.8).lineBetween(center.x, center.y, center.x + model.lockedDirX * distance, center.y + model.lockedDirY * distance)
      } else if (model.enemyKind === 'nightmare_cat') {
        const progress = Math.min(1, model.stateAgeMs(nowMs) / cfg.windupMs)
        this.drawDamageRange(center.x, center.y, cfg.damageRadius, 0.35 + progress * 0.35)
        // The countdown previews the only damaging boundary.
        this.graphics.lineStyle(3, DAMAGE_COLOR, 0.9).beginPath()
          .arc(center.x, center.y, cfg.damageRadius, -Math.PI / 2, -Math.PI / 2 + TAU * progress)
          .strokePath()
      }
    }
    this.activeFields.clear()
    for (const field of this.enemies.vortex.snapshots) {
      if (nowMs < field.startedAtMs || nowMs >= field.endsAtMs) continue
      this.activeFields.add(field.fieldId)
      let wind = this.winds.get(field.fieldId)
      if (!wind) {
        wind = this.scene.add.sprite(field.x, field.y, textureKeyFor(this.scene, NIGHTMARE_CAT_ART.vortex))
        this.winds.set(field.fieldId, wind)
      }
      // All motion follows logical time, so pause and hitstop freeze the whole field.
      const cycles = (nowMs - field.startedAtMs) * NIGHTMARE_CAT_ART.fxFrameRate / (1000 * NIGHTMARE_CAT_ART.fxFrameCount)
      const frame = Math.floor(cycles * NIGHTMARE_CAT_ART.fxFrameCount) % NIGHTMARE_CAT_ART.fxFrameCount
      if (wind.texture.has(String(frame))) wind.setFrame(frame)
      // The original dense vortex art marks damage only, even when the wind reaches farther.
      wind.setPosition(field.x, field.y).setDisplaySize(field.damageRadius * 2, field.damageRadius * 2).setDepth(field.y - 1)
      this.drawDamageRange(field.x, field.y, field.damageRadius, 0.8)
    }
    for (const [id, wind] of this.winds) {
      if (this.activeFields.has(id)) continue
      wind.destroy()
      this.winds.delete(id)
    }
  }

  private drawDamageRange(x: number, y: number, damageRadius: number, alpha: number): void {
    this.graphics.fillStyle(DAMAGE_COLOR, alpha * 0.06).fillCircle(x, y, damageRadius)
    this.graphics.lineStyle(2, DAMAGE_COLOR, alpha).strokeCircle(x, y, damageRadius)
  }

  destroy(): void {
    this.graphics.destroy()
    for (const wind of this.winds.values()) wind.destroy()
    this.winds.clear()
    this.activeFields.clear()
  }
}
