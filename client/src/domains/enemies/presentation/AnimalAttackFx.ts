import type Phaser from 'phaser'
import { NIGHTMARE_CAT_ART } from '@/core/assetManifest'
import { textureKeyFor } from '@/core/assets'
import type { GameClock } from '@/core/time'
import type { ConfigBundle } from '@/core/config'
import type { EnemySystem } from '../EnemySystem'

/** Direction lines expose charge commitments; ring graphics expose the actual three radii. */
export class AnimalAttackFx {
  private readonly graphics: Phaser.GameObjects.Graphics
  private readonly winds = new Map<number, Phaser.GameObjects.Sprite>()
  constructor(private readonly scene: Phaser.Scene, private readonly clock: GameClock, private readonly enemies: EnemySystem, private readonly bundle: ConfigBundle) {
    this.graphics = scene.add.graphics().setDepth(1)
  }
  update(): void {
    this.graphics.clear()
    for (const { model, view } of this.enemies.liveEnemies) {
      if (!model.alive || model.state !== 'windup') continue
      const center = view.body.center
      if (model.enemyKind === 'muscovy') {
        const distance = this.bundle.enemies.enemies.muscovy.charge.dashDistance
        this.graphics.lineStyle(2, 0xf39a68, 0.8).lineBetween(center.x, center.y, center.x + model.lockedDirX * distance, center.y + model.lockedDirY * distance)
      } else if (model.enemyKind === 'nightmare_cat') {
        const radius = this.bundle.enemies.enemies.nightmare_cat.vortex.damageRadius
        this.graphics.lineStyle(2, 0xaf8bf2, 0.8).strokeCircle(center.x, center.y, radius)
      }
    }
    const active = new Set<number>()
    for (const field of this.enemies.vortex.snapshots) {
      active.add(field.fieldId)
      let wind = this.winds.get(field.fieldId)
      if (!wind) {
        wind = this.scene.add.sprite(field.x, field.y, textureKeyFor(this.scene, NIGHTMARE_CAT_ART.vortex))
        this.winds.set(field.fieldId, wind)
      }
      const frame = Math.floor((this.clock.nowMs - field.startedAtMs) * NIGHTMARE_CAT_ART.fxFrameRate / 1000) % NIGHTMARE_CAT_ART.fxFrameCount
      if (wind.texture.has(String(frame))) wind.setFrame(frame)
      wind.setDisplaySize(field.damageRadius * 2, field.damageRadius * 2).setDepth(field.y - 1)
      this.graphics.lineStyle(1, 0xad91ed, 0.5).strokeCircle(field.x, field.y, field.damageRadius)
    }
    for (const [id, wind] of this.winds) {
      if (active.has(id)) continue
      wind.destroy()
      this.winds.delete(id)
    }
  }
  destroy(): void { this.graphics.destroy(); for (const wind of this.winds.values()) wind.destroy(); this.winds.clear() }
}
