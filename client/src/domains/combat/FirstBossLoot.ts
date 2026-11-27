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
  /** 这把武器是从哪个箱子里掉出来的；拾取后把那个箱子标成已完成。 */
  chest?: ChestRuntime
}

type ChestState = 'closed' | 'dropped' | 'collected'

interface ChestRuntime {
  image: Phaser.GameObjects.Image
  hint: Phaser.GameObjects.Text
  state: ChestState
  openedAt: number
}

/**
 * Boss chest plus persistent room loot. Replacement drops remain until picked up or room exit.
 *
 * ★ 2026-11-28：从「一个箱子」扩展成「一组箱子」—— BOSSRUSH 每击败一位首领
 * 要在场地里同时刷新三个。普通闯关仍然只 `spawn()` 一个，行为不变。
 */
export class FirstBossLoot {
  private chests: ChestRuntime[] = []
  private readonly halo: Phaser.GameObjects.Graphics
  private readonly ground: GroundWeapon[] = []
  private choice: GroundWeapon | null = null
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
    return this.chests.length > 0 && this.chests.every((chest) => chest.state === 'collected')
  }
  /**
   * 宝箱**开过了没有**（开了 = 里面那把武器已经掉出来了）。
   *
   * ⚠️ **`reset()` 会把答案抹掉**（它把所有箱子清掉），所以调用方必须在
   * `reset()` **之前**问 —— `BattleScene.settleChest()` 就是干这个的。
   * 记下来的用途是「这一间的宝箱开过就不再出现」，见那一段。
   */
  get opened(): boolean {
    return this.chests.some((chest) => chest.state !== 'closed')
  }
  reset(): void {
    this.cancelReplacement()
    for (const item of this.ground) {
      item.image.destroy()
      item.label.destroy()
    }
    this.ground.length = 0
    for (const chest of this.chests) {
      chest.image.destroy()
      chest.hint.destroy()
    }
    this.chests.length = 0
    this.halo.clear()
  }
  spawn(x: number, y: number): void {
    this.spawnMany([{ x, y }])
  }
  /**
   * 一次摆多个箱子。已经摆过一组时返回 `false` —— 与原来的 `spawn()` 同一条
   * 「不重复刷」的守卫，BOSSRUSH 每层换首领前会先 `reset()`。
   */
  spawnMany(points: readonly { x: number; y: number }[]): boolean {
    if (this.chests.length > 0 || points.length === 0) return false
    for (const { x, y } of points) {
      // ⚠️ `visualSize` 是**边长**，当成净空半径用要减半 —— 见 `TerrainMap.safeSpawn()`：
      //    直接拿 56 当半径 = 要求 112px 的空地，比门洞还宽，宝箱会被扔到走廊去（实测 200—540px）。
      //    第四个参数是**通行半径** = 玩家：宝箱不是走过去的，是玩家走过去开它。
      const point = this.session.terrain.safeSpawn(
        x,
        y,
        this.session.cfg.chest.visualSize / 2,
        this.session.player.model.stats.radius,
      )
      const image = this.scene.add
        .image(point.x, point.y, textureKeyFor(this.scene, WEAPON_ART.chest))
        .setDisplaySize(this.session.cfg.chest.visualSize, this.session.cfg.chest.visualSize)
        .setDepth(point.y + 1)
      const hint = this.scene.add
        .text(point.x, point.y - 48, '宝箱 · 靠近按 E', {
          fontFamily: 'Microsoft YaHei',
          fontSize: '14px',
          color: '#fff1ac',
          stroke: '#13182d',
          strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setDepth(4000)
      this.chests.push({ image, hint, state: 'closed', openedAt: 0 })
    }
    return true
  }
  private drop(
    id: WeaponId,
    x: number,
    y: number,
    reward: boolean,
    chest?: ChestRuntime,
  ): GroundWeapon {
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
    const item = { id, image, label, reward, chest }
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
    let nearestChest: ChestRuntime | null = null,
      chestDistance = cfg.interactRadius
    for (const chest of this.chests) {
      if (chest.state !== 'closed') continue
      const d = Phaser.Math.Distance.Between(p.x, p.y, chest.image.x, chest.image.y)
      if (d <= chestDistance) {
        chestDistance = d
        nearestChest = chest
      }
    }
    if (nearestChest) {
      this.openChest(nearestChest)
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

  private openChest(chest: ChestRuntime): void {
    const cfg = this.session.cfg.chest
    chest.state = 'dropped'
    chest.openedAt = this.session.clock.nowMs
    chest.image.setTint(0x87cfff).setAlpha(0.6)
    const item = this.drop(
      this.session.chooseRandomWeaponId() ?? 'pulse',
      chest.image.x + cfg.visualSize,
      chest.image.y,
      true,
      chest,
    )
    chest.hint.setText('宝箱已开启 · 靠近武器按 E')
    item.label.setText(
      this.session.cfg.weapons.find((w) => w.id === item.id)!.name + ' · 靠近自动拾取 / E',
    )
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
    if (item.reward && item.chest) {
      item.chest.state = 'collected'
      item.chest.hint.setText('已拾取武器 · 1 / 2 或 Q 切换')
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
    for (const chest of this.chests) {
      if (chest.state === 'closed')
        this.drawHalo(chest.image.x, chest.image.y, 0x58dcff, now)
      if (chest.state === 'dropped') {
        const t = Math.min(1, (now - chest.openedAt) / cfg.openFxMs)
        this.halo
          .lineStyle(3, 0xffe1a4, 1 - t)
          .strokeCircle(chest.image.x, chest.image.y, 20 + t * 60)
      }
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
