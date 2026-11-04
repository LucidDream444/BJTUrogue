import Phaser from 'phaser'
import { CAMPUS_PIXEL_ART as ART, CAMPUS_PIXEL_SPRITES } from '@/core/assetManifest'
import { textureKeyFor } from '@/core/assets'
import { doorRect, left, right, top } from '@/domains/procgen/model/rect'
import type { DungeonMap, Rect, Room } from '@/domains/procgen/model/types'
import type { SolidRect } from './StageGeometry'
import { furnitureArtPlacement } from './CampusArtLayout'
import { STAIR_FLIGHT_GAP, stairPadSpots } from './Stairwell'
import { FloorExit } from './FloorExit'

const FLOOR_DEPTH = -119
const WALL_DEPTH = -115
const TRIM_DEPTH = -113
const DECOR_DEPTH = -111
const CROPPED_FRAME = 'campus-visible'
/** 楼梯图底边与互动点方框顶边之间的间隙（世界像素）。 */
const STAIR_ART_GAP = 12
/** Limit each TileSprite canvas, including the Canvas renderer fallback. */
const TILE_CHUNK = 1024

/**
 * Static artwork for the real continuous floor. It owns no physics bodies.
 * Materials follow room/passage rectangles, furniture follows the exact solids
 * used by StageColliders, and wall decorations remain inside actual wall cells.
 * Shared source textures survive floor changes; every GameObject here does not.
 */
export class CampusMapArt {
  private readonly objects: Phaser.GameObjects.GameObject[] = []
  private readonly trim: Phaser.GameObjects.Graphics
  private readonly walls: readonly SolidRect[]
  private readonly occupiedWallArt: SolidRect[] = []

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly map: DungeonMap,
    private readonly solids: readonly SolidRect[],
    /**
     * 画不画楼梯间那两段楼梯图。**「异常」层（8F）传 `false`** ——
     * 那一层的小房间是传送阵的落点，不是楼梯间（用户 2026-11-04）。
     */
    private readonly drawStairs = true,
  ) {
    this.walls = solids.filter((solid) => solid.id.startsWith('wall'))
    this.trim = scene.add.graphics().setDepth(TRIM_DEPTH).setName('campus-wall-trim')
    this.objects.push(this.trim)
    this.paintSurfaces()
    this.paintWalls()
    this.paintFurniture()
    this.paintRoomDetails()
    this.paintCorridorDetails()
    this.paintThresholds()
  }

  private remember<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.objects.push(object)
    return object
  }

  private tile(key: string, rect: SolidRect, depth: number, tint = 0xffffff): void {
    const scale = (this.map.navCellSize * 2) / 64
    const texture = textureKeyFor(this.scene, key)
    this.scene.textures.get(texture).setFilter(Phaser.Textures.FilterMode.NEAREST)
    for (let dy = 0; dy < rect.height; dy += TILE_CHUNK) {
      for (let dx = 0; dx < rect.width; dx += TILE_CHUNK) {
        const x = rect.x + dx
        const y = rect.y + dy
        const image = this.scene.add
          .tileSprite(
            x,
            y,
            Math.min(TILE_CHUNK, rect.width - dx),
            Math.min(TILE_CHUNK, rect.height - dy),
            texture,
          )
          .setOrigin(0)
          .setTileScale(scale)
          .setTilePosition(x / scale, y / scale)
          .setTint(tint)
          .setDepth(depth)
          .setName(`campus-${rect.id}`)
        // TileSprite samples its own repeating texture, independently of the
        // source texture's filter. Keep that sampler crisp as well.
        const renderer = this.scene.game.renderer
        if (
          renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer &&
          image.fillPattern &&
          'webGLTexture' in image.fillPattern
        ) {
          renderer.setTextureFilter(image.fillPattern, Phaser.Textures.FilterMode.NEAREST)
        }
        image.context.imageSmoothingEnabled = false
        this.remember(image)
      }
    }
  }

  private floorRect(rect: Rect, id: string): SolidRect {
    return { id, x: left(rect), y: top(rect), width: rect.width, height: rect.height }
  }

  private paintSurfaces(): void {
    for (const passage of this.map.passages) {
      this.tile(
        ART.tiles.corridor,
        this.floorRect(passage.rect, `passage-${passage.id}`),
        FLOOR_DEPTH,
      )
    }
    for (const room of this.map.rooms) {
      const key =
        room.kind === 'boss'
          ? ART.tiles.concrete
          : room.kind === 'shop' || room.kind === 'elevator'
            ? ART.tiles.stone
            : ART.tiles.classroom
      this.tile(key, this.floorRect(room.rect, `room-${room.id}`), FLOOR_DEPTH)
      const r = room.rect
      // Fine architectural trim, rather than tinting the photographic materials
      // blue/green by encounter kind. The minimap and room labels keep that role.
      this.trim.lineStyle(2, 0x8d9486, 0.65).strokeRect(left(r), top(r), r.width, r.height)
    }
  }

  private paintWalls(): void {
    const cell = this.map.navCellSize
    for (const wall of this.walls) {
      const massive = wall.width > cell * 3 && wall.height > cell * 3
      this.tile(ART.tiles.plaster, wall, WALL_DEPTH, massive ? 0x929c91 : 0xffffff)
      this.trim.lineStyle(2, 0x525e55, 0.85).strokeRect(wall.x, wall.y, wall.width, wall.height)
      this.trim
        .lineStyle(2, 0xe8e6dd, 0.9)
        .lineBetween(wall.x + 2, wall.y + 2, wall.x + wall.width - 2, wall.y + 2)
      this.trim
        .lineStyle(4, 0x303638, 0.9)
        .lineBetween(
          wall.x,
          wall.y + wall.height - 2,
          wall.x + wall.width,
          wall.y + wall.height - 2,
        )
    }
  }

  private croppedImage(key: string, x: number, y: number): Phaser.GameObjects.Image {
    const geometry = CAMPUS_PIXEL_SPRITES[key]
    if (!geometry) throw new Error(`校园资源缺少可见边界：${key}`)
    const textureKey = textureKeyFor(this.scene, key)
    const texture = this.scene.textures.get(textureKey)
    texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
    const b = geometry.bounds
    if (!texture.has(CROPPED_FRAME)) texture.add(CROPPED_FRAME, 0, b.x, b.y, b.width, b.height)
    return this.remember(this.scene.add.image(x, y, textureKey, CROPPED_FRAME))
  }

  private paintFurniture(): void {
    let chairIndex = 0
    for (const solid of this.solids) {
      if (solid.id.startsWith('wall')) continue
      const chair = solid.id.startsWith('chair')
      const key = chair
        ? chairIndex++ % 3 === 0
          ? ART.furniture.chairDown
          : ART.furniture.chairFolded
        : solid.width <= this.map.navCellSize * 2
          ? ART.furniture.deskDouble
          : ART.furniture.deskTriple
      const placement = furnitureArtPlacement(solid, CAMPUS_PIXEL_SPRITES[key]!.bounds)
      this.croppedImage(key, placement.x, placement.y)
        .setOrigin(0.5, 1)
        .setDisplaySize(placement.width, placement.height)
        .setDepth(placement.depth)
        .setName(`campus-furniture-${solid.id}`)
        .setData('solidId', solid.id)
        .setData('solid', { ...solid })
        .setData('placement', placement)
    }
  }

  /** Fit a wall-mounted object entirely into one genuine wall rectangle. */
  private wallProp(key: string, x: number, y: number, desiredWidth: number): void {
    const b = CAMPUS_PIXEL_SPRITES[key]!.bounds
    const cell = this.map.navCellSize
    const wall = this.walls.find(
      (s) => x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.height,
    )
    if (!wall) return
    const scale = Math.min(
      desiredWidth / b.width,
      (wall.height - 4) / b.height,
      (wall.width - 4) / b.width,
    )
    if (scale <= 0) return
    const width = b.width * scale
    const height = b.height * scale
    const cx = Phaser.Math.Clamp(x, wall.x + width / 2 + 2, wall.x + wall.width - width / 2 - 2)
    const cy = Phaser.Math.Clamp(y, wall.y + height / 2 + 2, wall.y + wall.height - height / 2 - 2)
    const rect = { id: key, x: cx - width / 2, y: cy - height / 2, width, height }
    if (
      this.occupiedWallArt.some(
        (r) =>
          r.x < rect.x + width + cell / 4 &&
          r.x + r.width > rect.x - cell / 4 &&
          r.y < rect.y + height &&
          r.y + r.height > rect.y,
      )
    )
      return
    this.occupiedWallArt.push(rect)
    this.croppedImage(key, cx, cy)
      .setDisplaySize(width, height)
      .setDepth(DECOR_DEPTH)
      .setName(`campus-wall-prop-${key}`)
      .setData('wallRect', { ...wall })
  }

  private paintRoomDetails(): void {
    const cell = this.map.navCellSize
    for (const room of this.map.rooms) {
      const r = room.rect
      const y = top(r) - cell / 2
      if (room.kind === 'start') {
        this.wallFinish(
          { id: 'stair-brick', x: left(r), y: top(r) - cell, width: r.width, height: cell },
          ART.tiles.brick,
        )
        if (this.drawStairs) this.paintStairs(room)
        this.wallProp(ART.props.exitSign, r.x, y, cell * 1.6)
      } else if (room.kind === 'elevator') {
        this.wallProp(ART.props.fireDoor, r.x, y, cell * 2)
        this.trim
          .lineStyle(3, 0x4ab5c8, 0.8)
          .strokeRect(left(r) + 3, top(r) + 3, r.width - 6, r.height - 6)
      } else if (room.kind === 'shop') {
        this.wallFinish(
          { id: 'lobby-brick', x: left(r), y: top(r) - cell, width: r.width, height: cell },
          ART.tiles.brick,
        )
        this.wallProp(ART.props.neon, r.x, y, cell * 2)
        this.wallProp(ART.props.fireCabinet, left(r) + cell * 2, y, cell)
      } else {
        this.wallProp(ART.props.chalkboard, r.x - cell, y, cell * 4)
        this.wallProp(ART.props.clock, r.x + cell * 2.5, y, cell * 0.8)
        for (const x of [left(r) + cell * 2, right(r) - cell * 2]) {
          this.wallProp(ART.props.windowWide, x, y, cell * 2)
          // Different adjoining bays keep the woven curtains visible without
          // painting a second opaque object over the glazed window.
          this.wallProp(ART.props.curtainClosed, x + cell, y, cell * 1.5)
        }
      }
    }
  }

  private wallFinish(rect: SolidRect, key: string): void {
    for (const wall of this.walls) {
      const x = Math.max(rect.x, wall.x)
      const y = Math.max(rect.y, wall.y)
      const width = Math.min(rect.x + rect.width, wall.x + wall.width) - x
      const height = Math.min(rect.y + rect.height, wall.y + wall.height) - y
      if (width > 0 && height > 0)
        this.tile(key, { id: rect.id, x, y, width, height }, WALL_DEPTH + 1)
    }
  }

  private paintStairs(room: Room): void {
    const cell = this.map.navCellSize
    const pads = stairPadSpots(room.rect, FloorExit.SIZE)
    // 两段楼梯**横着并排**，中心分别对准自己的互动点：
    // 下一层在左（`pads.down`）、上一层在右（`pads.up`）—— 与用户 2026-11-04 的摆法一致。
    // 宽度：左右各留半格、中间留 `STAIR_FLIGHT_GAP`，再按整块上限（5 格）收一收。
    const width = Math.min((room.rect.width - cell - STAIR_FLIGHT_GAP) / 2, cell * 5)
    // 高度：按原图比例，但**不能顶到互动点** —— 底边停在方框上方 `STAIR_ART_GAP` 处。
    const padTop = pads.up.y - FloorExit.SIZE / 2
    const available = Math.max(0, padTop - STAIR_ART_GAP - top(room.rect))
    for (const [key, pad] of [
      [ART.props.stairsDown, pads.down],
      [ART.props.stairsUp, pads.up],
    ] as const) {
      const b = CAMPUS_PIXEL_SPRITES[key]!.bounds
      const height = Math.min((width * b.height) / b.width, available)
      if (height <= 1) continue
      this.croppedImage(key, pad.x, padTop - STAIR_ART_GAP - height / 2)
        .setDisplaySize(width, height)
        .setDepth(FLOOR_DEPTH + 1)
        .setName('campus-stair-flight')
    }
  }

  private paintCorridorDetails(): void {
    const cell = this.map.navCellSize
    for (const passage of this.map.passages) {
      const r = passage.rect
      if (r.width < cell * 4) continue
      const y = top(r) - cell / 2
      for (let x = left(r) + cell * 3; x < right(r) - cell; x += cell * 8) {
        this.wallProp(ART.props.radiator, x, y, cell * 2)
        this.wallProp(ART.props.exitSign, x + cell * 3, y, cell)
      }
    }
  }

  private paintThresholds(): void {
    for (const room of this.map.rooms) {
      for (const [index, door] of room.doors.entries()) {
        // The doorway is walkable; only its threshold is part of static art.
        // The separate StageBackground Graphics retains the seal/clear signal.
        const rect = doorRect(door, this.map.navCellSize)
        const texture = textureKeyFor(this.scene, ART.tiles.threshold)
        this.scene.textures.get(texture).setFilter(Phaser.Textures.FilterMode.NEAREST)
        this.remember(
          this.scene.add
            .image(rect.x, rect.y, texture)
            .setDisplaySize(door.width, this.map.navCellSize)
            .setAngle(door.axis === 'v' ? 90 : 0)
            .setDepth(FLOOR_DEPTH + 1)
            .setName(`campus-threshold-${room.id}-${index}`),
        )
      }
    }
  }

  destroy(): void {
    for (const object of this.objects) object.destroy()
    this.objects.length = 0
    this.occupiedWallArt.length = 0
  }
}
