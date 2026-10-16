import { prepareFurnitureTextures } from './FurnitureTextures'
import Phaser from 'phaser'
import { CAMPAIGN_ART } from '@/core/assetManifest'
import {
  fitMapFrame,
  furnitureRect,
  stageGeometry,
  type MapRect,
  type StageCollisionConfig,
} from './StageGeometry'
import { roomArtIndex, type GateSide } from './PaintedRooms'

export const STAGE_BACKGROUNDS = [
  CAMPAIGN_ART.level1,
  CAMPAIGN_ART.level2,
  CAMPAIGN_ART.level3,
] as const
export interface RoomBrief {
  readonly kind: string
  readonly rectInBox: MapRect
  readonly doorTargets: readonly (number | null)[]
  readonly gateSides?: readonly GateSide[]
}
const ARROWS: Record<GateSide, string> = { north: '↑', south: '↓', west: '←', east: '→' }

/** One complete reference painting per room, uniformly scaled with its authored collision layout. */
export class StageBackground {
  private readonly image: Phaser.GameObjects.Image
  private readonly furnitureImages: Phaser.GameObjects.Image[] = []
  private readonly fx: Phaser.GameObjects.Graphics
  private readonly labels: Phaser.GameObjects.Text[] = []
  private doors: MapRect[] = []
  private doorOpen = false
  private stage = 1

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly width: number,
    private readonly height: number,
    private readonly config: StageCollisionConfig,
    private readonly rooms: readonly RoomBrief[] = [],
  ) {
    this.image = scene.add.image(0, 0, STAGE_BACKGROUNDS[0]).setOrigin(0).setDepth(-102)
    this.fx = scene.add.graphics().setDepth(-100)
    this.setStage(1)
  }

  setStage(stage: number): void {
    this.stage = stage
    const layout = stageGeometry(this.config, stage, this.width, this.height)
    const frame = fitMapFrame(
      this.width,
      this.height,
      this.config.sourceSize.width,
      this.config.sourceSize.height,
    )
    const brief = this.rooms[stage - 1]
    const variant = roomArtIndex(brief?.kind ?? 'main', stage)
    const furniture = this.config.stages[stage - 1]!.furniture
    const artKey = STAGE_BACKGROUNDS[variant]!
    const textures = prepareFurnitureTextures(
      this.scene,
      artKey,
      this.config,
      furniture,
      'painted_desks_v1',
    )
    this.image
      .setTexture(textures.floorKey)
      .setPosition(frame.x, frame.y)
      .setDisplaySize(
        this.config.sourceSize.width * frame.scale,
        this.config.sourceSize.height * frame.scale,
      )
    this.image.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
    this.furnitureImages.forEach((image) => image.destroy())
    this.furnitureImages.length = 0
    for (const item of furniture) {
      const rect = furnitureRect(item.bounds, item)
      const image = this.scene.add
        .image(
          frame.x + (rect.x + rect.width / 2) * frame.scale,
          frame.y + (rect.y + rect.height / 2) * frame.scale,
          textures.objectKey(item.id),
        )
        .setDisplaySize(rect.width * frame.scale, rect.height * frame.scale)
        .setDepth(-101)
      image.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
      this.furnitureImages.push(image)
    }
    this.doors = layout.solids.filter((s) => s.id.startsWith('door-'))
    for (const label of this.labels) label.destroy()
    this.labels.length = 0
    this.doorOpen = false
    this.doors.forEach((door) => {
      this.labels.push(
        this.scene.add
          .text(door.x + door.width / 2, door.y + door.height / 2, '', {
            fontFamily: 'Microsoft YaHei, sans-serif',
            fontSize: '11px',
            color: '#f3dfb6',
          })
          .setOrigin(0.5)
          .setDepth(99),
      )
    })
    this.updateLabels()
    this.paintDoors(0)
  }

  private updateLabels(): void {
    const brief = this.rooms[this.stage - 1]
    this.labels.forEach((label, i) => {
      const target = brief?.doorTargets[i]
      const number = target == null ? '出口' : String(target + 1).padStart(2, '0')
      const arrow = ARROWS[brief?.gateSides?.[i] ?? 'east']
      label.setText((this.doorOpen ? 'F ' : '') + arrow + ' ' + number)
      label.setColor(this.doorOpen ? '#edffce' : '#d2bb8b')
    })
  }
  setDoorOpen(open: boolean): void {
    if (open === this.doorOpen) return
    this.doorOpen = open
    this.updateLabels()
    this.paintDoors(0)
  }
  private paintDoors(timeMs: number): void {
    const g = this.fx.clear(),
      pulse = 0.6 + Math.sin(timeMs / 500) * 0.16
    for (const d of this.doors) {
      g.fillStyle(this.doorOpen ? 0x253c28 : 0x32271a, 0.9).fillRoundedRect(
        d.x,
        d.y,
        d.width,
        d.height,
        3,
      )
      g.lineStyle(
        1,
        this.doorOpen ? 0xc5e5a3 : 0xc3a16b,
        this.doorOpen ? pulse : 0.7,
      ).strokeRoundedRect(d.x, d.y, d.width, d.height, 3)
      if (this.doorOpen)
        g.lineStyle(2, 0xe3d5a4, pulse * 0.3).strokeRoundedRect(
          d.x - 5,
          d.y - 5,
          d.width + 10,
          d.height + 10,
          5,
        )
    }
  }
  update(timeMs: number): void {
    if (this.doorOpen) this.paintDoors(timeMs)
  }
  destroy(): void {
    this.image.destroy()
    this.fx.destroy()
    this.furnitureImages.forEach((image) => image.destroy())
    this.labels.forEach((label) => label.destroy())
  }
}
