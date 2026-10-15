import Phaser from 'phaser'
import { WEAPON_ART } from '@/core/assetManifest'
import { textureKeyFor } from '@/core/assets'
import type { CombatSession } from './CombatSession'
export class LoadoutHud {
  private readonly root: Phaser.GameObjects.Container
  private readonly slots: {
    label: Phaser.GameObjects.Text
    icon: Phaser.GameObjects.Image
    panel: Phaser.GameObjects.Rectangle
  }[] = []
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly session: CombatSession,
  ) {
    this.root = scene.add.container(18, 0).setScrollFactor(0).setDepth(1010)
    for (let i = 0; i < 2; i++) {
      const x = i * 192
      const panel = scene.add
        .rectangle(x, 0, 181, 63, 0x071321, 0.9)
        .setOrigin(0)
        .setStrokeStyle(1, 0x294b67)
      const icon = scene.add
        .image(x + 31, 30, textureKeyFor(scene, WEAPON_ART.pistol))
        .setDisplaySize(42, 40)
      const label = scene.add.text(x + 59, 11, '', {
        fontFamily: 'Microsoft YaHei',
        fontSize: '12px',
        color: '#c8deee',
        lineSpacing: 6,
      })
      this.root.add([panel, icon, label])
      this.slots.push({ panel, icon, label })
    }
  }
  update(): void {
    const c = this.scene.cameras.main,
      scale = Math.min(1, (c.width - 36) / 385)
    this.root
      .setScale(scale / c.zoom)
      .setPosition(
        c.width * c.originX * (1 - 1 / c.zoom) + 18 / c.zoom,
        c.height * c.originY * (1 - 1 / c.zoom) + (c.height - 16 - 63 * scale) / c.zoom,
      )
    for (let i = 0; i < 2; i++) {
      const id = this.session.inventory[i],
        weapon = id ? this.session.cfg.weapons.find((w) => w.id === id) : undefined,
        active = id === this.session.weapon.id,
        slot = this.slots[i]!
      slot.panel.setStrokeStyle(active ? 2 : 1, active ? 0x77ebff : 0x294b67)
      slot.icon
        .setTexture(textureKeyFor(this.scene, weapon?.artKey ?? WEAPON_ART.pistol))
        .setAlpha(weapon ? 1 : 0.2)
      slot.label
        .setText(
          weapon
            ? i + 1 + '  ' + weapon.name + '\n' + weapon.staminaCost + ' 体力 / 发'
            : i + 1 + '  未获得\n拾取新武器可替换',
        )
        .setColor(active ? '#9bf4ff' : '#9aaebe')
    }
  }
}
