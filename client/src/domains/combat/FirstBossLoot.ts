import Phaser from 'phaser'
import { WEAPON_ART } from '@/core/assetManifest'
import type { WeaponId } from './config'
import { textureKeyFor } from '@/core/assets'
import type { CombatSession } from './CombatSession'
import type { Unsubscribe } from '@/core/events'

interface GroundWeapon {
  id: WeaponId
  image: Phaser.GameObjects.Image
  label: Phaser.GameObjects.Text
  reward: boolean
}

/** Boss chest plus persistent room loot. Replacement drops remain until picked up or room exit. */
export class FirstBossLoot {
  private state: 'absent' | 'closed' | 'dropped' | 'collected' = 'absent'
  private chest?: Phaser.GameObjects.Image
  private hint?: Phaser.GameObjects.Text
  private readonly halo: Phaser.GameObjects.Graphics
  private readonly ground: GroundWeapon[] = []
  private choice: GroundWeapon | null = null
  private openedAt = 0
  private readonly off: Unsubscribe
  private disposed = false
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly session: CombatSession,
  ) {
    this.halo = scene.add.graphics().setDepth(4)
    this.off = session.bus.on('weapon_replaced', (e) => this.drop(e.dropped, e.x, e.y, false))
  }
  get replacementPending(): boolean {
    return this.choice !== null
  }
  get completed(): boolean {
    return this.state === 'collected'
  }
  reset(): void {
    this.cancelReplacement()
    for (const item of this.ground) {
      item.image.destroy()
      item.label.destroy()
    }
    this.ground.length = 0
    this.chest?.destroy()
    this.hint?.destroy()
    this.chest = undefined
    this.hint = undefined
    this.halo.clear()
    this.state = 'absent'
  }
  spawn(x: number, y: number): void {
    if (this.state !== 'absent') return
    const point = this.session.terrain.safeSpawn(x, y, this.session.cfg.chest.visualSize)
    this.state = 'closed'
    this.chest = this.scene.add
      .image(point.x, point.y, textureKeyFor(this.scene, WEAPON_ART.chest))
      .setDisplaySize(this.session.cfg.chest.visualSize, this.session.cfg.chest.visualSize)
      .setDepth(point.y + 1)
    this.hint = this.scene.add
      .text(point.x, point.y - 48, '宝箱 · 靠近按 E', {
        fontFamily: 'Microsoft YaHei',
        fontSize: '14px',
        color: '#fff1ac',
        stroke: '#13182d',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(4000)
  }
  private drop(id: WeaponId, x: number, y: number, reward: boolean): GroundWeapon {
    const p = this.session.terrain.safeSpawn(x, y, this.session.player.model.stats.radius)
    const def = this.session.cfg.weapons.find((w) => w.id === id)!
    const image = this.scene.add
      .image(p.x, p.y, textureKeyFor(this.scene, def.artKey))
      .setDisplaySize(51, 46)
      .setDepth(p.y + 10)
    const label = this.scene.add
      .text(p.x, p.y - 38, def.name + ' · 按 E 拾取', {
        fontFamily: 'Microsoft YaHei',
        fontSize: '12px',
        color: '#f9e8bd',
        stroke: '#0b1320',
        strokeThickness: 4,
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(4000)
    const item = { id, image, label, reward }
    this.ground.push(item)
    return item
  }
  private canInteract(): boolean {
    return (
      this.session.player.model.alive && !this.session.clock.paused && !this.session.clock.frozen
    )
  }
  interact(): void {
    if (!this.canInteract()) return
    const p = this.session.player,
      cfg = this.session.cfg.chest
    if (
      this.state === 'closed' &&
      this.chest &&
      Phaser.Math.Distance.Between(p.x, p.y, this.chest.x, this.chest.y) <= cfg.interactRadius
    ) {
      this.state = 'dropped'
      this.openedAt = this.session.clock.nowMs
      this.chest.setTint(0x87cfff).setAlpha(0.6)
      const item = this.drop(
        this.session.chooseRandomWeaponId() ?? 'pulse',
        this.chest.x + cfg.visualSize,
        this.chest.y,
        true,
      )
      this.hint?.setText('宝箱已开启 · 靠近武器按 E')
      item.label.setText(
        this.session.cfg.weapons.find((w) => w.id === item.id)!.name + ' · 靠近自动拾取 / E',
      )
      return
    }
    if (this.choice) {
      this.cancelReplacement()
      return
    }
    let closest: GroundWeapon | null = null,
      distance = cfg.interactRadius
    for (const item of this.ground) {
      const d = Phaser.Math.Distance.Between(p.x, p.y, item.image.x, item.image.y)
      if (d <= distance) {
        distance = d
        closest = item
      }
    }
    if (closest) this.pickup(closest)
  }
  private pickup(item: GroundWeapon): void {
    if (this.session.inventory.includes(item.id)) {
      item.label.setText('已携带此武器 · 留在地面')
      return
    }
    if (this.session.pickupWeapon(item.id)) {
      this.collect(item)
      return
    }
    if (this.session.inventory.length >= 2) {
      this.choice = item
      item.label.setText('按 1 / 2 替换 · 旧武器留在脚边\nEsc 取消，地面武器保留')
    }
  }
  private collect(item: GroundWeapon): void {
    const index = this.ground.indexOf(item)
    if (index < 0) return
    this.ground.splice(index, 1)
    item.image.destroy()
    item.label.destroy()
    if (item.reward) {
      this.state = 'collected'
      this.hint?.setText('已拾取武器 · 1 / 2 或 Q 切换')
    }
    if (this.choice === item) this.choice = null
  }
  chooseReplacement(slot: number): boolean {
    const item = this.choice
    if (!item || !this.canInteract()) return false
    const p = this.session.player
    if (
      Phaser.Math.Distance.Between(p.x, p.y, item.image.x, item.image.y) >
      this.session.cfg.chest.interactRadius
    ) {
      this.cancelReplacement()
      return false
    }
    // weapon_replaced synchronously adds the old gun; collect only the selected item.
    if (!this.session.replaceWeapon(slot, item.id)) return false
    this.collect(item)
    return true
  }
  cancelReplacement(): void {
    if (!this.choice) return
    this.choice.label.setText(
      this.session.cfg.weapons.find((w) => w.id === this.choice!.id)!.name + ' · 按 E 拾取',
    )
    this.choice = null
  }
  update(): void {
    if (this.disposed) return
    const now = this.session.clock.nowMs,
      p = this.session.player,
      cfg = this.session.cfg.chest
    this.halo.clear()
    if (
      this.choice &&
      Phaser.Math.Distance.Between(p.x, p.y, this.choice.image.x, this.choice.image.y) >
        cfg.interactRadius
    )
      this.cancelReplacement()
    if (this.state === 'closed' && this.chest)
      this.drawHalo(this.chest.x, this.chest.y, 0x58dcff, now)
    if (this.state === 'dropped' && this.chest) {
      const t = Math.min(1, (now - this.openedAt) / cfg.openFxMs)
      this.halo.lineStyle(3, 0xffe1a4, 1 - t).strokeCircle(this.chest.x, this.chest.y, 20 + t * 60)
    }
    for (const item of this.ground) {
      const def = this.session.cfg.weapons.find((w) => w.id === item.id)!
      this.drawHalo(item.image.x, item.image.y, def.color, now)
      item.label.setVisible(
        Phaser.Math.Distance.Between(p.x, p.y, item.image.x, item.image.y) <=
          cfg.interactRadius * 2 || this.choice === item,
      )
    }
    // New chest rewards can auto-fill an empty slot; exchanged guns always require E.
    if (this.canInteract() && !this.choice && this.session.inventory.length < 2) {
      const item = this.ground.find(
        (g) =>
          g.reward &&
          Phaser.Math.Distance.Between(p.x, p.y, g.image.x, g.image.y) <= cfg.pickupRadius,
      )
      if (item) this.pickup(item)
    }
  }
  private drawHalo(x: number, y: number, color: number, now: number): void {
    this.halo.lineStyle(2, color, 0.55 + 0.2 * Math.sin(now / 300)).strokeEllipse(x, y + 16, 55, 18)
  }
  destroy(): void {
    if (this.disposed) return
    this.reset()
    this.disposed = true
    this.off()
    this.halo.destroy()
  }
}
