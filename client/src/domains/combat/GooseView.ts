import Phaser from 'phaser'
import { GOOSE_ART } from '@/core/assetManifest'
import { textureKeyFor } from '@/core/assets'
import { goosePose, type GooseDirection, type Point } from './GoosePose'
import type { WeaponId } from './config'

/** 只有躯干占用玩家原来的 Sprite；另外两层从不添加物理体。 */
export class GooseView {
  readonly neck: Phaser.GameObjects.Sprite
  readonly gun: Phaser.GameObjects.Image
  constructor(private readonly torso: Phaser.GameObjects.Sprite) {
    const scene = torso.scene
    this.neck = scene.add.sprite(0, 0, textureKeyFor(scene, GOOSE_ART.neck.texture))
    this.gun = scene.add.image(0, 0, textureKeyFor(scene, GOOSE_ART.guns.pencil))
  }

  draw(feet: Point, direction: GooseDirection, frame: number, scale: number,
    aim: Point, weapon: WeaponId, alive: boolean, flash: boolean): void {
    const art = GOOSE_ART.directions[direction]
    const pose = goosePose(feet, direction, scale, aim)
    this.torso.setTexture(textureKeyFor(this.torso.scene, art.body), frame)
      .setPosition(feet.x, feet.y).setOrigin(GOOSE_ART.foot[0] / GOOSE_ART.frameSize, GOOSE_ART.foot[1] / GOOSE_ART.frameSize)
      .setScale(scale).setFlipX(false).setRotation(0).setDepth(feet.y).setAlpha(alive ? 1 : 0.45)
    const depth = feet.y + (Math.sin(pose.angle) < -0.25 ? -0.2 : 0.2)
    this.neck.setTexture(textureKeyFor(this.torso.scene, GOOSE_ART.neck.texture), frame)
      .setOrigin(GOOSE_ART.neck.pivot[0] / GOOSE_ART.frameSize, GOOSE_ART.neck.pivot[1] / GOOSE_ART.frameSize)
      .setPosition(pose.pivot.x, pose.pivot.y).setScale(scale).setRotation(pose.rotation)
      .setDepth(depth).setAlpha(alive ? 1 : 0.45)
    this.gun.setTexture(textureKeyFor(this.torso.scene, GOOSE_ART.guns[weapon]))
      .setOrigin(GOOSE_ART.grip[0] / GOOSE_ART.gunSize[0], GOOSE_ART.grip[1] / GOOSE_ART.gunSize[1])
      .setPosition(pose.mouth.x, pose.mouth.y).setScale(scale).setRotation(pose.angle)
      .setDepth(depth - 0.05).setVisible(alive)
    for (const layer of [this.torso, this.neck, this.gun]) {
      layer.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
      if (flash) layer.setTint(0xffb5b5)
      else layer.clearTint()
    }
  }

  destroy(): void {
    this.neck.destroy()
    this.gun.destroy()
  }
}
