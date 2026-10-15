import Phaser from 'phaser'
import { WEAPON_ART } from '@/core/assetManifest'
import type { WeaponId } from './config'
import { textureKeyFor } from '@/core/assets'
import type { CombatSession } from './CombatSession'

/** First boss reward: closed chest -> opened chest + dropped gun -> one pickup. */
export class FirstBossLoot {
  private state: 'absent' | 'closed' | 'dropped' | 'choice' | 'collected' = 'absent'
  private chest?: Phaser.GameObjects.Image
  private gun?: Phaser.GameObjects.Image
  private hint?: Phaser.GameObjects.Text
  private halo?: Phaser.GameObjects.Graphics
  private openedAt = 0
  private rewardId: WeaponId = 'pulse'
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly session: CombatSession,
  ) {}
  get replacementPending(): boolean {
    return this.state === 'choice'
  }
  get completed(): boolean {
    return this.state === 'collected'
  }
  reset(): void {
    this.destroy()
    this.state = 'absent'
    this.chest = undefined
    this.gun = undefined
    this.hint = undefined
    this.halo = undefined
    this.rewardId = 'pulse'
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
      .text(point.x, point.y - 48, '首领宝箱 · 靠近按 E', {
        fontFamily: 'Microsoft YaHei',
        fontSize: '14px',
        color: '#fff1ac',
        stroke: '#13182d',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(4000)
    this.halo = this.scene.add.graphics().setDepth(point.y - 1)
  }
  interact(): void {
    if (
      this.session.clock.paused ||
      !this.session.player.model.alive ||
      this.state !== 'closed' ||
      !this.chest
    )
      return
    const p = this.session.player,
      cfg = this.session.cfg.chest
    if (Phaser.Math.Distance.Between(p.x, p.y, this.chest.x, this.chest.y) > cfg.interactRadius)
      return
    this.rewardId = this.session.chooseRandomWeaponId() ?? 'pulse'
    this.state = 'dropped'
    this.openedAt = this.session.clock.nowMs
    this.chest.setTint(0x87cfff).setAlpha(0.6)
    const point = this.session.terrain.safeSpawn(
      this.chest.x + cfg.visualSize,
      this.chest.y,
      this.session.cfg.player.visualScale * 20,
    )
    this.gun = this.scene.add
      .image(
        point.x,
        point.y,
        textureKeyFor(
          this.scene,
          this.session.cfg.weapons.find((w) => w.id === this.rewardId)!.artKey,
        ),
      )
      .setDisplaySize(51, 46)
      .setDepth(point.y + 10)
    this.hint!.setPosition(point.x, point.y - 44).setText(
      this.session.cfg.weapons.find((w) => w.id === this.rewardId)!.name + ' · 靠近拾取\n按 2 装备',
    )
  }
  chooseReplacement(slot: number): boolean {
    if (this.state !== 'choice' || !this.gun) return false
    if (!this.session.replaceWeapon(slot, this.rewardId)) return false
    this.state = 'collected'
    this.gun.destroy()
    this.gun = undefined
    this.halo?.clear()
    this.hint?.setText(
      '已替换为 ' +
        this.session.cfg.weapons.find((w) => w.id === this.rewardId)!.name +
        ' · 按 1 / 2 切换',
    )
    return true
  }
  update(): void {
    if (!this.chest || !this.halo) return
    const cfg = this.session.cfg.chest,
      now = this.session.clock.nowMs
    this.halo.clear()
    if (this.state === 'collected') return
    const x = this.gun?.x ?? this.chest.x,
      y = this.gun?.y ?? this.chest.y
    this.halo
      .lineStyle(2, 0x58dcff, 0.5 + 0.2 * Math.sin(now / 300))
      .strokeEllipse(x, y + 16, 55, 18)
    if (this.state === 'dropped') {
      const progress = Math.min(1, (now - this.openedAt) / cfg.openFxMs)
      this.halo
        .lineStyle(3, 0xffe1a4, 1 - progress)
        .strokeCircle(this.chest.x, this.chest.y, 20 + progress * 60)
      if (
        !this.session.clock.paused &&
        !this.session.clock.frozen &&
        this.session.player.model.alive &&
        this.gun
      ) {
        const p = this.session.player
        if (
          Phaser.Math.Distance.Between(p.x, p.y, this.gun.x, this.gun.y) <= cfg.pickupRadius &&
          (this.session.pickupWeapon(this.rewardId) || this.session.inventory.length >= 2)
        ) {
          if (
            this.session.inventory.length >= 2 &&
            !this.session.inventory.includes(this.rewardId)
          ) {
            this.state = 'choice'
            this.hint!.setText('武器栏已满 · 按 1 / 2 替换一把\nEsc 放弃')
          } else {
            this.state = 'collected'
            this.gun.destroy()
            this.gun = undefined
            this.halo.clear()
            this.hint!.setText(
              '已获得 ' +
                this.session.cfg.weapons.find((w) => w.id === this.rewardId)!.name +
                ' · 按 1 / 2 或 Q 切换',
            )
          }
        }
      }
    }
  }
  destroy(): void {
    this.chest?.destroy()
    this.gun?.destroy()
    this.hint?.destroy()
    this.halo?.destroy()
  }
}
