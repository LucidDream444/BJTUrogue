import type Phaser from 'phaser'
import type { EnemySystem } from '../EnemySystem'

/** One graphics layer for all live enemies; dead/pooled entries disappear in the same frame. */
export class EnemyHealthBars {
  private readonly graphics: Phaser.GameObjects.Graphics
  visibleCount = 0
  constructor(
    scene: Phaser.Scene,
    private readonly enemies: EnemySystem,
  ) {
    this.graphics = scene.add.graphics().setDepth(4600)
  }
  update(): void {
    this.graphics.clear()
    this.visibleCount = 0
    for (const { model, view } of this.enemies.liveEnemies) {
      if (!model.alive || !view.visible || !view.body.enable) continue
      const boss = this.enemies.isBoss(model.id)
      const final = this.enemies.isFinalBoss(model.id)
      const width = final ? 104 : boss ? 84 : Math.max(28, Math.min(56, model.stats.radius * 2))
      const height = boss ? 8 : 5
      const x = view.x - width / 2
      const y = view.y - view.displayHeight / 2 - 11
      const ratio = Math.max(0, Math.min(1, model.hp / Math.max(1, model.maxHp)))
      const color = final
        ? 0xcb83ff
        : boss
          ? 0xffae61
          : model.enemyKind === 'tank'
            ? 0xff8383
            : 0x7cdd8e
      this.graphics
        .fillStyle(0x050913, 0.95)
        .fillRoundedRect(x - 2, y - 2, width + 4, height + 4, 3)
      this.graphics.fillStyle(0x293247, 1).fillRect(x, y, width, height)
      if (ratio > 0) this.graphics.fillStyle(color, 1).fillRect(x, y, width * ratio, height)
      if (boss)
        this.graphics
          .lineStyle(1, color, 0.65)
          .strokeRoundedRect(x - 2, y - 2, width + 4, height + 4, 3)
      this.visibleCount++
    }
  }
  destroy(): void {
    this.graphics.destroy()
  }
}
