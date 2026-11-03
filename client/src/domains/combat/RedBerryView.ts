import Phaser from 'phaser'
import { PUBLIC_WEAPON_ART, RED_BERRY_ART } from '@/core/assetManifest'
import { textureKeyFor } from '@/core/assets'
import type { RedBerryPose, RedBerryWeapon } from './RedBerryPose'

/** The existing player Sprite is visual only; the separate floor Zone owns physics. */
export class RedBerryView {
  readonly gun: Phaser.GameObjects.Image

  constructor(private readonly body: Phaser.GameObjects.Sprite) {
    this.gun = body.scene.add.image(0, 0,
      textureKeyFor(body.scene, PUBLIC_WEAPON_ART.pencil.texture))
  }

  draw(pose: RedBerryPose, frame: number, scale: number, weaponId: RedBerryWeapon,
    alive: boolean, flash: boolean): void {
    const art = RED_BERRY_ART
    const weapon = PUBLIC_WEAPON_ART[weaponId]
    this.body.setTexture(textureKeyFor(this.body.scene, art.texture), frame)
      .setPosition(pose.body.x, pose.body.y)
      .setOrigin(art.foot[0] / art.frameSize, art.foot[1] / art.frameSize)
      .setScale(scale).setFlip(false, false).setRotation(0).setAlpha(1)
      .setDepth(pose.feet.y)
    this.gun.setTexture(textureKeyFor(this.body.scene, weapon.texture))
      .setOrigin(weapon.grip[0] / weapon.size[0], weapon.grip[1] / weapon.size[1])
      .setPosition(pose.grip.x, pose.grip.y).setScale(pose.gunScale)
      .setFlip(false, pose.flipY).setRotation(pose.rotation)
      .setDepth(pose.feet.y + (pose.gunBehind ? -0.1 : 0.1)).setVisible(alive)
    for (const layer of [this.body, this.gun]) {
      layer.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
      if (flash) layer.setTint(0xffb5b5)
      else layer.clearTint()
    }
  }

  destroy(): void { this.gun.destroy() }
}
