import type Phaser from 'phaser'
import type { EnemySystem } from '../EnemySystem'
import { bossHealthBarLayout } from './BossHealthBarLayout'

interface BossLabel {
  name: Phaser.GameObjects.Text
  value: Phaser.GameObjects.Text
}

/** World bars for ordinary enemies and a fixed top HUD for every living boss. */
export class EnemyHealthBars {
  private readonly graphics: Phaser.GameObjects.Graphics
  private readonly bossRoot: Phaser.GameObjects.Container
  private readonly bossGraphics: Phaser.GameObjects.Graphics
  private readonly bossLabels = new Map<number, BossLabel>()
  visibleCount = 0
  bossVisibleCount = 0
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly enemies: EnemySystem,
    private readonly stage2Name: string,
  ) {
    this.graphics = scene.add.graphics().setDepth(4600)
    this.bossRoot = scene.add.container(0, 0).setScrollFactor(0).setDepth(5002)
    this.bossGraphics = scene.add.graphics()
    this.bossRoot.add(this.bossGraphics)
  }
  update(): void {
    this.graphics.clear()
    this.visibleCount = 0
    for (const { model, view } of this.enemies.liveEnemies) {
      if (!model.alive || !view.visible || !view.body.enable) continue
      if (this.enemies.isBoss(model.id)) continue
      const width = Math.max(28, Math.min(56, model.stats.radius * 2))
      const height = 5
      const x = view.x - width / 2
      const y = view.y - view.displayHeight / 2 - 11
      const ratio = Math.max(0, Math.min(1, model.hp / Math.max(1, model.maxHp)))
      const color = model.enemyKind === 'tank' ? 0xff8383 : 0x7cdd8e
      this.graphics
        .fillStyle(0x050913, 0.95)
        .fillRoundedRect(x - 2, y - 2, width + 4, height + 4, 3)
      this.graphics.fillStyle(0x293247, 1).fillRect(x, y, width, height)
      if (ratio > 0) this.graphics.fillStyle(color, 1).fillRect(x, y, width * ratio, height)
      this.visibleCount++
    }
    this.updateBossBars()
  }
  private updateBossBars(): void {
    // Boss spawning is triggered by entering its room. Once encountered, camera visibility,
    // patrol distance, and physics activation never decide whether its HUD remains visible.
    const bosses = this.enemies.bossStatuses()
    const aliveIds = new Set(bosses.map((boss) => boss.id))
    for (const [id, label] of this.bossLabels) {
      if (aliveIds.has(id)) continue
      label.name.destroy()
      label.value.destroy()
      this.bossLabels.delete(id)
    }
    this.bossVisibleCount = bosses.length
    this.visibleCount += bosses.length
    this.bossRoot.setVisible(bosses.length > 0)
    this.bossGraphics.clear()
    if (bosses.length === 0) return

    const layout = bossHealthBarLayout(this.scene.cameras.main)
    this.bossRoot.setPosition(layout.x, layout.y).setScale(layout.scale)
    const width = layout.width
    for (let row = 0; row < bosses.length; row++) {
      const boss = bosses[row]!
      const y = row * 60
      const color = boss.finalBoss ? 0xcb83ff : 0xffae61
      const ratio = Math.max(0, Math.min(1, boss.hp / Math.max(1, boss.maxHp)))
      this.bossGraphics
        .fillStyle(0x091323, 0.96)
        .fillRoundedRect(-10, y - 5, width + 20, 48, 6)
        .lineStyle(1, color, 0.75)
        .strokeRoundedRect(-10, y - 5, width + 20, 48, 6)
        .fillStyle(0x293247, 1)
        .fillRect(0, y + 23, width, 12)
      if (ratio > 0)
        this.bossGraphics.fillStyle(color, 1).fillRect(0, y + 23, width * ratio, 12)

      let label = this.bossLabels.get(boss.id)
      if (!label) {
        const style = {
          fontFamily: 'Microsoft YaHei, sans-serif',
          fontSize: '14px',
          color: '#fff2df',
        }
        label = {
          name: this.scene.add.text(0, 0, '', style),
          value: this.scene.add.text(0, 0, '', style).setOrigin(1, 0),
        }
        this.bossRoot.add([label.name, label.value])
        this.bossLabels.set(boss.id, label)
      }
      const name = boss.finalBoss ? '心魔' : boss.stage === 2 ? this.stage2Name : '课业重压'
      label.name.setPosition(0, y).setText(`第 ${boss.stage} 层 · ${name}`)
      label.value.setPosition(width, y).setText(`${Math.ceil(boss.hp)} / ${Math.ceil(boss.maxHp)}`)
    }
  }
  destroy(): void {
    this.graphics.destroy()
    this.bossRoot.destroy()
    this.bossLabels.clear()
  }
}
