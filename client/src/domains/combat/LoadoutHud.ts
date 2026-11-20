import Phaser from 'phaser'
import { WEAPON_ART } from '@/core/assetManifest'
import { textureKeyFor } from '@/core/assets'
import { ARCHIVE_THEME as A } from '../meta/ui/theme'
import type { CombatSession } from './CombatSession'
import { BOTTOM_HUD, bottomHudLayout } from './bottomHudLayout'
import { hudText, paintHudPlate, placeHud } from './CombatHudSkin'

/** Compact notebook equipment cards. All names, textures and costs come from the equipped weapon. */
export class LoadoutHud {
  private readonly root: Phaser.GameObjects.Container
  private readonly slots: {
    title: Phaser.GameObjects.Text
    cost: Phaser.GameObjects.Text
    hint: Phaser.GameObjects.Text
    key: Phaser.GameObjects.Text
    badge: Phaser.GameObjects.Rectangle
    icon: Phaser.GameObjects.Image
    empty: Phaser.GameObjects.Text
    panel: Phaser.GameObjects.Graphics
    signature: string
  }[] = []
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly session: CombatSession,
  ) {
    this.root = scene.add.container(0, 0).setScrollFactor(0).setDepth(5010)
    for (let i = 0; i < 2; i++) {
      const x = i * (BOTTOM_HUD.slotWidth + BOTTOM_HUD.slotGap)
      const panel = scene.add.graphics()
      const badge = scene.add.rectangle(x + 23, 23, 24, 23, A.ink).setStrokeStyle(1, A.brass)
      const key = hudText(scene, x + 23, 23, String(i + 1), 12, A.muted).setOrigin(0.5)
      const title = hudText(scene, x + 45, 14, '', 14, A.paper)
      const icon = scene.add.image(x + 34, 58, textureKeyFor(scene, WEAPON_ART.pistol))
      const empty = hudText(scene, x + 34, 55, '＋', 24, A.dim).setOrigin(0.5)
      const cost = hudText(scene, x + 70, 41, '', 12, A.muted)
      const hint = hudText(scene, x + 70, 61, '', 11, A.muted)
      this.root.add([panel, badge, key, title, icon, empty, cost, hint])
      this.slots.push({ panel, badge, key, title, icon, empty, cost, hint, signature: '' })
    }
    this.update()
  }
  update(): void {
    const c = this.scene.cameras.main
    placeHud(this.root, c, bottomHudLayout(c.width, c.height).loadout)
    this.slots.forEach((slot, i) => {
      const id = this.session.inventory[i]
      const weapon = id ? this.session.cfg.weapons.find((w) => w.id === id) : undefined
      const active = Boolean(weapon && id === this.session.weapon.id)
      const insufficient = Boolean(weapon && this.session.player.stamina < weapon.staminaCost)
      const signature = `${id}:${active}:${insufficient}:${weapon?.name}:${weapon?.artKey}:${weapon?.staminaCost}:${weapon?.mode}`
      if (slot.signature === signature) return
      slot.signature = signature
      paintHudPlate(
        slot.panel,
        i * (BOTTOM_HUD.slotWidth + BOTTOM_HUD.slotGap),
        BOTTOM_HUD.slotWidth,
        BOTTOM_HUD.height,
        active,
      )
      slot.badge.setFillStyle(active ? A.glass : A.ink).setStrokeStyle(1, active ? A.cyan : A.brass)
      slot.key.setColor(active ? A.energy : A.muted)
      slot.title.setText(weapon?.name ?? '空武器槽').setColor(weapon ? A.paper : A.dim)
      slot.title.setScale(Math.min(1, 134 / Math.max(1, slot.title.width)))
      slot.icon.setVisible(Boolean(weapon))
      slot.empty.setVisible(!weapon)
      if (weapon) {
        slot.icon.setTexture(textureKeyFor(this.scene, weapon.artKey ?? WEAPON_ART.pistol))
        slot.icon
          .setScale(Math.min(44 / slot.icon.width, 31 / slot.icon.height))
          .setAlpha(active ? 1 : 0.72)
        slot.icon.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
      }
      slot.cost
        .setText(
          weapon
            ? `${weapon.staminaCost} 能量 / ${weapon.mode === 'melee' ? '挥砍' : '发'}`
            : '拾取武器装备',
        )
        .setColor(insufficient ? A.warning : A.muted)
      slot.hint
        .setText(
          !weapon
            ? '最多携带两把'
            : insufficient
              ? '能量不足'
              : active
                ? '已装备 · X 切换'
                : `按 ${i + 1} 装备`,
        )
        .setColor(active ? A.energy : A.muted)
    })
  }
  destroy(): void {
    this.root.destroy()
  }
}
