import Phaser from 'phaser'
import { CAMPAIGN_ART } from '@/core/assetManifest'
import { fitMapFrame, stageGeometry, type StageCollisionConfig } from './StageGeometry'

/**
 * 三张手绘关的贴图 key。**正式游戏已不再用它们当背景**（见下），
 * 但联合测试场 `joint/_d1Scenes` 还要拿它去切家具贴图，所以留着。
 */
export const STAGE_BACKGROUNDS = [
  CAMPAIGN_ART.level1,
  CAMPAIGN_ART.level2,
  CAMPAIGN_ART.level3,
] as const

/**
 * 关卡背景 —— **一张碰撞箱调试图**，兼这一间的路标。
 *
 * ## 为什么去掉手绘图
 *
 * 手绘关把「画上的房间长什么样」和「哪里能走」绑死在两张独立的表里
 * （PNG 负责看，`stage-collisions.json` 负责撞）—— 改一处忘了另一处，
 * 画面和判定就分家了，而且**两边都不报错**。
 *
 * 改成调试图之后只剩一个真值来源：**画出来的每一个框都直接来自
 * `stageGeometry()`**，而物理和寻路读的也正是它。所见即所撞。
 *
 * ## 颜色是这一层唯一的语言，所以每一档都得能一眼分开
 *
 * | 画面上 | 含义 |
 * |---|---|
 * | 底色 | **本间的关别**（起点金 / 普通蓝 / 精英蓝 / 首领红 / 道具·宝箱紫） |
 * | 灰框 | 墙 |
 * | 蓝框 | 家具（课桌 / 椅子 / 讲台 / 书柜 / 盆栽） |
 * | 暗黄框 | 门 —— **关着**（本间还没打完） |
 * | **亮绿框 + 呼吸 + 箭头** | 门 —— **开了，从这儿走** |
 * | 粉十字 | 出生点 |
 *
 * 门这一条是重点：**打完一间找不到门出不去**，是这一层最容易卡住玩家的地方。
 * 所以门一开就换成亮绿、加呼吸、旁边浮一个箭头，方向按门在屏幕的哪一侧定。
 *
 * 配色抄 `domains/procgen/presentation/floorplan.ts` 的 `COLORS`，
 * 让两个域的「墙长什么样」是同一套色 —— 联调时不必先分辨自己在看谁画的。
 *
 * ⚠️ 手绘关那张 4K 图仍在 `client/public/assets/maps/` 里，也仍在资源清单里
 * （`CAMPAIGN_ART`）—— **没有删**，只是这个类不再加载它。要恢复手绘背景，
 * 把 `setStage` 换回 `prepareFurnitureTextures` 那条路即可，`FurnitureTextures.ts` 一直留着。
 */
const COLOR = {
  /** 框外 —— 贴着游戏本来的底色，不抢任何东西 */
  outside: 0x05070d,
  /** 本间的地板 */
  floor: 0x12161f,
  /** 本间的边界线 */
  ownEdge: 0x3c4a63,
  /** 墙。⚠️ 原来是 D2 的 `0x3a3a4a`，在这套很暗的地板（`0x12161f`）上**太亮** ——
   * 实测它占了左上三分之区域近 20% 的像素，看起来像一块贴错了的色块。
   * 调暗到贴着地板，靠描边认边界。 */
  wall: 0x212430,
  wallEdge: 0x4a5064,
  prop: 0x1e3a5f,
  propEdge: 0x4a7fb5,
  /** 门关着 */
  doorShut: 0x4a3f1e,
  doorShutEdge: 0xb5a54a,
  /** 门开了 —— 这一档要和画面上所有别的颜色都分得开，所以用亮绿 */
  doorOpen: 0x1f6a3a,
  doorOpenEdge: 0x6ee29a,
  spawn: 0xd44a8a,
} as const

export interface RoomBrief {
  readonly kind: string
  /** 本间在取景框坐标里的矩形 —— 框减去它就是「墙外」。 */
  readonly rectInBox: { x: number; y: number; width: number; height: number }
  /** 本间每扇门通向第几间（0 起，`null` = 尽头），顺序与 solids 里的 `door-…` 一致。 */
  readonly doorTargets: readonly (number | null)[]
}

export class StageBackground {
  /** 静态几何：墙 / 家具 / 门 / 出生点。换一间时重画一次。 */
  private readonly gfx: Phaser.GameObjects.Graphics
  /** 会动的那一层：门开了之后的呼吸高亮。每帧重画，所以单独一张。 */
  private readonly fx: Phaser.GameObjects.Graphics
  private readonly guide: Phaser.GameObjects.Text
  private readonly legend: Phaser.GameObjects.Text
  private doors: { x: number; y: number; width: number; height: number }[] = []
  private doorOpen = false

  constructor(
    scene: Phaser.Scene,
    private readonly width: number,
    private readonly height: number,
    private readonly config: StageCollisionConfig,
    private readonly rooms: readonly RoomBrief[] = [],
  ) {
    this.gfx = scene.add.graphics().setDepth(-102)
    this.fx = scene.add.graphics().setDepth(-101)
    this.guide = scene.add
      .text(0, 0, '', {
        fontFamily: 'Microsoft YaHei, sans-serif',
        fontSize: '18px',
        color: '#06140c',
        backgroundColor: '#6ee29a',
        padding: { x: 8, y: 3 },
      })
      .setOrigin(0.5)
      .setDepth(4400)
      .setVisible(false)
    this.legend = scene.add
      .text(12, height - 26, '灰=墙  蓝=家具  绿=门(开)  黄=门(关)  粉=出生点', {
        fontFamily: 'Microsoft YaHei, sans-serif',
        fontSize: '12px',
        color: '#8a93a8',
      })
      .setDepth(4400)
    this.setStage(1)
  }

  /**
   * 地面分三层：**框外 → 邻间 → 本间**，每一层给自己描一条边。
   *
   * ⚠️ 这三层**不带色相**（纯暗调）。早先按关别给本间上了底色
   * （起点金 / 首领红……），在游戏整体偏冷的色调里非常突兀 —— 关别交给小地图
   * 和提示行去说，地板只负责「让人看清空间」这一件事。
   */
  private paintFloors(stage: number): void {
    this.gfx.fillStyle(COLOR.outside, 1).fillRect(0, 0, this.width, this.height)
    const brief = this.rooms[stage - 1]
    if (!brief) return
    // ⚠️ **地板必须和墙用同一套坐标。**
    //
    // 房间矩形（`rectInBox`）是**取景框坐标**（0~760），而 `stageGeometry()` 交出来的
    // 墙是**竞技场坐标**（0~1344，已经过 `fitMapFrame` 缩放+居中）。
    // 早先这里直接把框坐标喂给 `fillRect`，于是地板缩在左上角一小块、
    // 大小和位置全不对 —— 看上去就像「房间左上角贴了一块格格不入的色块」，
    // 而且**能走进去**（可走区域是对的，只是地板画歪了），所以一直没往坐标上想。
    const frame = fitMapFrame(
      this.width,
      this.height,
      this.config.sourceSize.width,
      this.config.sourceSize.height,
    )
    const own = brief.rectInBox
    this.gfx
      .fillStyle(COLOR.floor, 1)
      .fillRect(
        frame.x + own.x * frame.scale,
        frame.y + own.y * frame.scale,
        own.width * frame.scale,
        own.height * frame.scale,
      )
    this.gfx
      .lineStyle(1, COLOR.ownEdge, 1)
      .strokeRect(
        frame.x + own.x * frame.scale,
        frame.y + own.y * frame.scale,
        own.width * frame.scale,
        own.height * frame.scale,
      )
  }
  setStage(stage: number): void {
    // **和物理读同一份几何**（`stageGeometry` 也是 `CombatSession` 喂给 `TerrainMap` 的那个），
    // 所以画出来的框和玩家真能撞到的东西一定一致 —— 这正是调试视图要保证的事。
    const layout = stageGeometry(this.config, stage, this.width, this.height)
    this.gfx.clear()
    this.paintFloors(stage)
    this.doors = []
    for (const s of layout.solids) {
      const isDoor = s.id.startsWith('door')
      if (isDoor) this.doors.push({ x: s.x, y: s.y, width: s.width, height: s.height })
      const fill = isDoor ? COLOR.doorShut : s.id.startsWith('prop') ? COLOR.prop : COLOR.wall
      const edge = isDoor
        ? COLOR.doorShutEdge
        : s.id.startsWith('prop')
          ? COLOR.propEdge
          : COLOR.wallEdge
      this.gfx.fillStyle(fill, 1).fillRect(s.x, s.y, s.width, s.height)
      this.gfx.lineStyle(1, edge, 1).strokeRect(s.x, s.y, s.width, s.height)
    }
    // 出生点标一个十字，免得「人怎么生在这儿」要靠猜
    this.gfx.lineStyle(2, COLOR.spawn, 1)
    this.gfx.lineBetween(
      layout.playerSpawn.x - 10,
      layout.playerSpawn.y,
      layout.playerSpawn.x + 10,
      layout.playerSpawn.y,
    )
    this.gfx.lineBetween(
      layout.playerSpawn.x,
      layout.playerSpawn.y - 10,
      layout.playerSpawn.x,
      layout.playerSpawn.y + 10,
    )
    // 换间就先把上一间的指引收掉 —— 不收的话它会在新的一间里浮着，指着一扇不存在的门。
    this.doorOpen = false
    this.fx.clear()
    this.guide.setVisible(false)
  }

  /** 本间的门开了没有。开了之后 `update()` 会把它画成亮绿 + 呼吸 + 箭头。 */
  setDoorOpen(open: boolean): void {
    if (open === this.doorOpen) return
    this.doorOpen = open
    if (!open) {
      this.fx.clear()
      this.guide.setVisible(false)
    }
  }

  /**
   * 每帧调。只在门开着时干活 —— 关着的时候这一层是全空的，一次 `clear()` 就够。
   *
   * `timeMs` 直接吃场景的 `time.now`（**不要 `performance.now()`**：
   * 暂停时场景时间会停，用它画面才是静的 —— 见《技术选型》§8）。
   */
  update(timeMs: number): void {
    if (!this.doorOpen || this.doors.length === 0) return
    // 呼吸：0.35~0.85 之间来回，肉眼一眼能看出「这里和别处不一样」
    const pulse = 0.35 + 0.25 * (1 + Math.sin(timeMs / 220))
    this.fx.clear()
    for (const d of this.doors) {
      this.fx.fillStyle(COLOR.doorOpen, pulse).fillRect(d.x, d.y, d.width, d.height)
      this.fx.lineStyle(3, COLOR.doorOpenEdge, 1).strokeRect(d.x, d.y, d.width, d.height)
    }
    // 箭头浮在最靠边的那扇门内侧，指**从房间走向门**的方向
    const door = this.doors.reduce((a, b) => (a.x <= b.x ? a : b))
    const toRight = door.x > this.width / 2
    const x = toRight ? door.x - 46 : door.x + door.width + 46
    this.guide
      .setText(toRight ? '过门 →' : '← 过门')
      .setPosition(x, door.y + door.height / 2)
      .setVisible(true)
  }

  destroy(): void {
    this.gfx.destroy()
    this.fx.destroy()
    this.guide.destroy()
    this.legend.destroy()
  }
}
