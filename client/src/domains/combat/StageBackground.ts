import Phaser from 'phaser'
import { CAMPAIGN_ART } from '@/core/assetManifest'
import { fitMapFrame, furnitureRect, type StageCollisionConfig } from './StageGeometry'
import { prepareFurnitureTextures } from './FurnitureTextures'

export const STAGE_BACKGROUNDS = [
  CAMPAIGN_ART.level1,
  CAMPAIGN_ART.level2,
  CAMPAIGN_ART.level3,
] as const

export class StageBackground {
  private readonly image: Phaser.GameObjects.Image
  private readonly furniture: Phaser.GameObjects.Image[] = []
  private readonly frame: ReturnType<typeof fitMapFrame>

  constructor(
    private readonly scene: Phaser.Scene,
    width: number,
    height: number,
    private readonly config: StageCollisionConfig,
  ) {
    this.frame = fitMapFrame(width, height, config.sourceSize.width, config.sourceSize.height)
    this.image = scene.add.image(width / 2, height / 2, STAGE_BACKGROUNDS[0]).setDepth(-100)
    this.setStage(1)
  }

  setStage(stage: number): void {
    const layout = this.config.stages.find((s) => s.stage === stage)
    if (!layout) throw new Error(`缺少第 ${stage} 关地图`)
    const key = STAGE_BACKGROUNDS[stage - 1]!
    const textures = prepareFurnitureTextures(this.scene, key, this.config, layout.furniture)
    this.image.setTexture(textures.floorKey).setScale(this.frame.scale)
    for (const image of this.furniture) image.destroy()
    this.furniture.length = 0
    for (const f of layout.furniture) {
      const rect = furnitureRect(f.bounds, f)
      const x = this.frame.x + rect.x * this.frame.scale,
        y = this.frame.y + rect.y * this.frame.scale
      const image = this.scene.add
        .image(x, y, textures.objectKey(f.id))
        .setOrigin(0)
        .setScale(f.scale * this.frame.scale)
        .setDepth(y + rect.height * this.frame.scale)
        .setName(f.id)
      this.furniture.push(image)
    }
  }
}
