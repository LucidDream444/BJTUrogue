/**
 * **教室长这样。** 观感预览 —— 同一间房的另一张脸。
 *
 * ## 这一场回答什么问题
 *
 * 「D2 生出来的教室，摆进产品里**应该长什么样**。」给美术定调子、给 D1 接家具、
 * 给写交接文档的人一个**能指着说的目标样子**，而不是一堆白方块。
 *
 * 它和 `d2_classroom` 摆的是**同一间房**（两边都问 `chooseClassroom`），
 * 一个看观感，一个看格子：
 *
 * | 场子 | 看什么 | 画法 |
 * |---|---|---|
 * | `d2_classroom` | 门开在哪条边、桌子压不压门、红格与青线错没错开 | 白箱：色块 + 标号 + 判定 |
 * | 这一场 | 地砖、课桌椅、黑板、门框、盆栽 | 观感：产品里该有的颜色与细节 |
 *
 * ## 哪些是**画出来的**，哪些是**生成出来的**（这一条最要紧）
 *
 * | 画面上 | 来源 |
 * |---|---|
 * | 地面、墙、门的位置、课桌椅、刷怪点 | **地图数据**（`DungeonMap`），位置一格不差 |
 * | 地砖的缝 | **D2 的 40px 判定格**（`navOrigin` 对齐，就是 `navCellSize`） |
 * | 黑板、窗、四角的盆栽 | **装饰**：地图数据里没有这三样东西 |
 *
 * 装饰是**这一场自己加的**，为的是让画面像一间教室。它们**不在 `Room` 的任何字段里**
 * —— D1 的子弹不会撞到它们，D3 的寻路不知道它们存在。
 * 真要把它们变成真东西，那是**改契约**（`obstacles` 加 `kind`、配置表加数值、
 * 通知 D1 与 D3 走 C2 流程），**不是把这一场的画法搬过去**。
 * 这也是这一场留在 `test/` 里的理由：它是一张效果图，不是产品代码。
 *
 * ## 不是 1:1
 *
 * `d2_classroom` 不缩放 —— 它要回答**单个格子**的对错，一缩就没法量了。
 * 这一场反过来：要的是「一眼看清一间教室」，所以框取「**房间 + 一圈 40px 留白**」，
 * 再**缩放到塞满画面**（上限 ×2）。倍数印在图例第一行 —— 拿这张图去量像素之前先看那个数。
 *
 * 代价说清楚：**框里没有门外的连廊**（那是 `d2_classroom` 与 `d2_floorplan` 的活）。
 * 门在这里只表现为「墙上的一个洞 + 一圈橙框」，门外是黑的。取景框的这个取舍
 * 和 `d2_room_kinds` 是同一条（那边也讲了为什么），不重复。
 *
 * ## 这一场**验不了**什么
 *
 * 与 `d2_room_kinds` 同理：`configure()` **不往底座喂墙**，于是这里没有墙的物理体、
 * 也没有敌人 —— 白方块会直接飘过墙和课桌。那不是 bug，是这一场压根没有物理体
 * （理由是**底座的墙会盖在观感图上面**：`drawBackground` 给每堵墙 `add.rectangle()`
 * 到 depth −50，而这一场的画面在 −80，喂进去就变成一片灰色方块压在教室上）。
 *
 * 要验「挡不挡得住」去 `d2_classroom`，要验「换批种子稳不稳」去 `d2_seed_sweep`。
 *
 * ## 这一场的成品图
 *
 * `docs/images/d2_classroom_look.png` 就是这一场的无头截图（文档正文引它）。
 * **改了这一场的画法，那张图就过期了** —— 重截的命令在 `docs/images/README.md`。
 */

import type Phaser from 'phaser'
import type { ArenaConfig, ArenaContext, ArenaDefinition } from '../../ArenaBase'
import { ArenaBase, WORLD_WIDTH } from '../../ArenaBase'
import type { RoomsConfig } from '@/domains/procgen/config'
import { bottom, clipRect, inflate, left, rectsIntersect, right, top } from '@/domains/procgen/model/rect'
import type { Door, DungeonMap, Rect, Room } from '@/domains/procgen/model/types'
import { ROOM_KIND_LABELS } from '@/domains/procgen/model/types'
import { COLORS, mapperFor, type Mapper } from '@/domains/procgen/presentation/floorplan'
import { fullyInside, wallsNearRoom } from '@/domains/procgen/presentation/framing'
import { gridOfMap } from '@/domains/procgen/walkability'
import {
  chooseClassroom,
  D2_SEEDS,
  DEFAULT_SEED,
  elapsedText,
  generateForArena,
  HUD_HINT_RIGHT,
  HUD_TOP_LEFT_BOTTOM,
  loadRoomsConfig,
} from './_shared'

// ---------------------------------------------------------------- 配色

/**
 * 这一场的**观感配色**。和 `floorplan.ts` 的 `COLORS` 是**两套，别混用**：
 *
 * | 那一套 | 这一套 |
 * |---|---|
 * | 白箱：红格、紫描边、青线 —— 给**判定**上色 | 观感：地砖、桌椅、黑板 —— 给**东西**上色 |
 *
 * 唯一要共用的两处是判定层的 `COLORS.blockedCell` 与 `COLORS.spawn`：
 * `D` 键叠出来的那一层**必须**和 `d2_classroom` 里的红格、粉圈一模一样 ——
 * 同一份判定在两个场子里要是两种样子，谁也不会想到它们读的是同一个数。
 */
const INK = {
  /** 取景框外面的底。比 `COLORS.outside` 再冷一点，好让「画」和「画布」分得开 */
  mat: 0x0a0e11,
  matEdge: 0x1d2a2c,
  /**
   * 教室地面：青绿瓷砖，深浅交替。
   *
   * ⚠️ **比第一版暗了一档**，第一版是 `0x1d4a44 / 0x21544d / 缝 0x2d6a60`
   * —— 那三个数在真截图里是一整片发亮的青绿，因为**缝是每一格都描一遍的**：
   * 112 格的描边叠上去，把地面整体提亮了近两成。所以底色要按「缝会提亮它」来选，
   * 而不是按色板上的数选。参考图里那种深青绿才是目标。
   */
  floorA: 0x15332f,
  floorB: 0x173733,
  floorLine: 0x22544c,
  /** 连廊地面 / 邻居房间的地面，各降一档亮度（框里只可能露出邻间的一条边） */
  passageA: 0x2e281c,
  passageB: 0x332c20,
  passageLine: 0x463a28,
  /** 墙身 */
  wall: 0x1f2630,
  wallEdge: 0x3d4d5e,
  /**
   * **房间内沿那一条亮线**：沿「墙的内表面」勾一圈，把房间从周围的墙里区分出来。
   *
   * 参考图里房间就是被这么一条浅蓝灰线勾出来的。它画在**门之前** ——
   * 门会把跨过门洞的那一段盖掉，不用专门去断开（见 `drawScene`）。
   *
   * 第一版这里是「每堵墙的顶边加一条亮线」，画出来是一条**横在房间外面**的青线：
   * 墙骑在房间边界上，它的顶边是**朝外**那面，所以那条线落在屋外。
   */
  roomLine: 0x6d94a6,
  /** 门：洞是暗的，框是暖橙的（参考图里那两扇门的颜色） */
  doorGap: 0x140f08,
  doorFrame: 0xd9944a,
  /** 课桌 / 椅子 */
  desk: 0xe0bf6a,
  deskEdge: 0x6d5522,
  paper: 0xf2ecd8,
  chair: 0xb98a4c,
  chairEdge: 0x6a4a22,
  /** 黑板的板面 / 板框 / 粉笔字 */
  board: 0x1f2b28,
  boardFrame: 0x8a7a52,
  chalk: 0xcfe0d2,
  /** 窗 */
  window: 0x9fc6d8,
  windowEdge: 0x4b6a78,
  /** 盆栽 */
  pot: 0xa8622f,
  leaf: 0x4f9b52,
  leafDark: 0x3d7a41,
} as const

// ---------------------------------------------------------------- 版面

/**
 * 画面能用的那一块。**先躲底座 HUD**（左上标题 + 读数、左下按键说明，尺寸来源见
 * `_shared.ts` 里 `HUD_TOP_LEFT_BOTTOM` 那一段），剩下的才是这一场的画。
 *
 * 画占不满的时候**居中**：两边留一样多的底，比堆在左上角像一张图。
 */
const FRAME = { x: 8, y: HUD_TOP_LEFT_BOTTOM, width: WORLD_WIDTH - 16, height: 660 - HUD_TOP_LEFT_BOTTOM } as const
/** 放大上限。**不是 1:1** —— 见文件头「不是 1:1」那一段。 */
const MAX_SCALE = 2
/** 图例：右下角那一条（左边被按键说明占着；三行 11px）。 */
const LEGEND_AT = { x: HUD_HINT_RIGHT, y: 672 } as const

/**
 * 当前看的是第几张牌。**模块级** —— `scene.restart()` 会把场子实例销毁重建，
 * 实例字段留不住（`d2_seed_sweep` 同一条，那边的注释写得更细）。
 *
 * 起点是 `DEFAULT_SEED`，所以**一进这一场看到的，就是 `d2_classroom` 摆的那一间**。
 */
let seedIndex = D2_SEEDS.indexOf(DEFAULT_SEED as (typeof D2_SEEDS)[number])
if (seedIndex < 0) seedIndex = 0

// ---------------------------------------------------------------- 绘制小工具

function fillWorld(g: Phaser.GameObjects.Graphics, m: Mapper, r: Rect, color: number, alpha = 1): void {
  const p = m.toScreen(left(r), top(r))
  g.fillStyle(color, alpha)
  g.fillRect(p.x, p.y, r.width * m.scale, r.height * m.scale)
}

function strokeWorld(
  g: Phaser.GameObjects.Graphics,
  m: Mapper,
  r: Rect,
  color: number,
  width = 1,
  alpha = 1,
): void {
  const p = m.toScreen(left(r), top(r))
  g.lineStyle(width, color, alpha)
  g.strokeRect(p.x, p.y, r.width * m.scale, r.height * m.scale)
}

/**
 * 一扇门在墙上留下的**洞**：沿墙方向 = 门宽，横跨墙的方向 = 墙厚。
 *
 * 洞本身**不是画上去的**（生成器本来就给墙留了缺口），这一场只是给洞口加一圈橙框 ——
 * 不加的话，墙上的缺口看起来像「这一段墙没生成出来」，而那正是看场子的人
 * 最容易误判的一种坏法。
 */
function doorHole(d: Door, cfg: RoomsConfig): Rect {
  return d.axis === 'v'
    ? { x: d.x, y: d.y, width: cfg.wallThickness, height: d.width }
    : { x: d.x, y: d.y, width: d.width, height: cfg.wallThickness }
}

/**
 * 铺地砖。**一格 = 一格寻路格**（`cfg.navCellSize`，按 `map.navOrigin` 对齐）——
 * 地砖的缝不是随手画的：它和 D2 的 40px 判定格**是同一条线**，
 * 所以「一张桌子占几格」在这张图上是能直接数出来的。
 */
function drawTiles(
  g: Phaser.GameObjects.Graphics,
  m: Mapper,
  map: DungeonMap,
  cfg: RoomsConfig,
  area: Rect,
  a: number,
  b: number,
  line: number,
  alpha = 1,
): void {
  const cell = cfg.navCellSize
  const o = map.navOrigin
  const cx0 = Math.floor((left(area) - o.x) / cell)
  const cx1 = Math.floor((right(area) - o.x) / cell)
  const cy0 = Math.floor((top(area) - o.y) / cell)
  const cy1 = Math.floor((bottom(area) - o.y) / cell)
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const cellRect: Rect = {
        x: o.x + (cx + 0.5) * cell,
        y: o.y + (cy + 0.5) * cell,
        width: cell,
        height: cell,
      }
      // 裁着填：框边上的瓷砖只有半块，照整块填会画到画面外面去。
      const c = clipRect(cellRect, area)
      if (c === null) continue
      fillWorld(g, m, c, (cx + cy) % 2 === 0 ? a : b, alpha)
      // 砖缝压得很轻（0.3）：它一格描一遍，112 格叠起来是**整体提亮**，
      // 而目标是一间暗的教室（第一版 0.5 的实测结果就是「亮成一片」）。
      strokeWorld(g, m, c, line, 1, 0.3 * alpha)
    }
  }
}

/** 课桌：暖黄块 + 深色描边 + 桌上一张纸（参考图里每张桌上那点白） */
function drawDesk(g: Phaser.GameObjects.Graphics, m: Mapper, r: Rect): void {
  const p = m.toScreen(left(r), top(r))
  const w = r.width * m.scale
  const h = r.height * m.scale
  const pad = Math.max(1, 3 * m.scale)
  g.fillStyle(INK.desk, 1)
  g.fillRect(p.x + pad, p.y + pad, w - pad * 2, h - pad * 2)
  g.lineStyle(Math.max(1, 2 * m.scale), INK.deskEdge, 1)
  g.strokeRect(p.x + pad, p.y + pad, w - pad * 2, h - pad * 2)
  // 纸。尺寸跟着桌子走，宽桌子上的纸不跟着变长 —— 桌上摆的是一张纸，不是一条纸带。
  const pw = Math.min(w * 0.26, h * 0.42)
  g.fillStyle(INK.paper, 0.85)
  g.fillRect(p.x + w / 2 - pw / 2, p.y + h / 2 - pw / 2, pw, pw)
}

/** 椅子：比格子小一圈的木色方块 —— 和课桌一样高，才看得出「这是一把椅子」 */
function drawChair(g: Phaser.GameObjects.Graphics, m: Mapper, r: Rect): void {
  const p = m.toScreen(left(r), top(r))
  const w = r.width * m.scale
  const h = r.height * m.scale
  const pad = Math.max(2, 9 * m.scale)
  g.fillStyle(INK.chair, 1)
  g.fillRect(p.x + pad, p.y + pad, w - pad * 2, h - pad * 2)
  g.lineStyle(Math.max(1, 2 * m.scale), INK.chairEdge, 1)
  g.strokeRect(p.x + pad, p.y + pad, w - pad * 2, h - pad * 2)
}

/** 盆栽：一圈叶子 + 一只花盆。**装饰**，见文件头。 */
function drawPlant(g: Phaser.GameObjects.Graphics, m: Mapper, r: Rect): void {
  const p = m.toScreen(left(r), top(r))
  const s = r.width * m.scale
  g.fillStyle(INK.leaf, 1)
  g.fillCircle(p.x + s * 0.5, p.y + s * 0.44, s * 0.44)
  g.fillStyle(INK.leafDark, 1)
  g.fillCircle(p.x + s * 0.36, p.y + s * 0.34, s * 0.24)
  g.fillStyle(INK.pot, 1)
  g.fillRect(p.x + s * 0.22, p.y + s * 0.66, s * 0.56, s * 0.34)
}

/** 门：洞里是暗的，四周一圈暖橙框，两端各一段门垛 —— 参考图里那两扇门的样子。 */
function drawDoor(g: Phaser.GameObjects.Graphics, m: Mapper, hole: Rect): void {
  const p = m.toScreen(left(hole), top(hole))
  const w = hole.width * m.scale
  const h = hole.height * m.scale
  g.fillStyle(INK.doorGap, 1)
  g.fillRect(p.x, p.y, w, h)
  g.lineStyle(Math.max(1, 2 * m.scale), INK.doorFrame, 1)
  g.strokeRect(p.x, p.y, w, h)
  // 门垛：洞口两端各压一段橙。没有它，这扇门看起来只是「墙上的一块暗斑」。
  const post = Math.max(2, Math.min(w, h) * 0.28)
  g.fillStyle(INK.doorFrame, 1)
  if (h > w) {
    g.fillRect(p.x, p.y, w, post)
    g.fillRect(p.x, p.y + h - post, w, post)
  } else {
    g.fillRect(p.x, p.y, post, h)
    g.fillRect(p.x + w - post, p.y, post, h)
  }
}

// ---------------------------------------------------------------- 场子

interface SceneLayout {
  map: DungeonMap
  cfg: RoomsConfig
  room: Room
  /** 取景框（地图坐标）= 房间 + 一圈留白。**不含门外的连廊**（见文件头） */
  box: Rect
  mapper: Mapper
  /** 缩放倍数。**不是 1:1** —— 印在图例里，别拿这张图去量像素 */
  scale: number
  elapsedMs: number
  /** 裁进框里的墙 */
  walls: Rect[]
}

class D2ClassroomSceneArena extends ArenaBase {
  /** `configure()` 里算好、`onArenaCreate()` 里画 —— 两处必须是同一份几何。 */
  private layout: SceneLayout | null = null
  /** `D` 键叠出来的那一层。默认**隐藏**：这一场默认给的是观感，判定按需叠。 */
  private overlay: Phaser.GameObjects.Container | null = null

  protected get definition(): ArenaDefinition {
    return arena
  }

  override preload(): void {
    super.preload()
    loadRoomsConfig(this)
  }

  protected configure(): ArenaConfig {
    const seed = D2_SEEDS[seedIndex] ?? DEFAULT_SEED
    const { map, cfg, elapsedMs } = generateForArena(this, seed)
    // 和 `d2_classroom` 问同一份实现 —— 两边摆的不是同一间房的话，
    // 「观感图」和「格子图」就成了一对没法互相印证的两张画。
    const room = chooseClassroom(map, cfg)
    if (room === null) {
      // 挑不到就抛，**不兜底画第一间房** —— 理由同 `d2_classroom`：
      // 兜底会把「生成器变了」伪装成「这个场子只是凑合着跑」。
      throw new Error(
        `[d2_classroom_scene] 种子 ${seed} 里挑不出一间拿得出手的主干教室（见 chooseClassroom）。` +
          `换个种子（N），或者看 d2_seed_sweep 确认生成器是不是把尺寸档位改了。`,
      )
    }

    // 框 = 房间 + 一圈 40px 留白。留白是给**墙**的：墙骑在房间边界上、厚一格，
    // 各让 20px，再留 20px 的呼吸位置，画出来才是一间「有边」的房，而不是被切开的。
    const box = inflate(room.rect, cfg.navCellSize)
    const scale = Math.min(FRAME.width / box.width, FRAME.height / box.height, MAX_SCALE)
    // 居中。**顺序：先定框、再算落点** —— 反过来会把框顶出画面，房间缺一角，
    // 而缺一角看起来和「生成器没生成这段墙」一模一样（`d2_classroom` 同一条）。
    const screenX = FRAME.x + (FRAME.width - box.width * scale) / 2
    const screenY = FRAME.y + (FRAME.height - box.height * scale) / 2

    this.layout = {
      map,
      cfg,
      room,
      box,
      mapper: mapperFor(box, screenX, screenY, scale),
      scale,
      elapsedMs,
      walls: wallsNearRoom(map, box),
    }

    // ⚠️ **不喂墙**（`walls` 不传）。底座的 `drawBackground` 会给每堵墙
    // `add.rectangle()` 一个灰色方块、画在 depth −50，正好**盖在这一场的观感图上**
    // （这一场在 −80）。喂进去的后果不是「多了碰撞体」，是「教室被一片灰方块糊住」。
    return { rngSeed: 0xd2ce }
  }

  protected override onArenaCreate(ctx: ArenaContext): void {
    const L = this.layout
    if (L === null) return

    // 这一场没有敌人，但假玩家默认不无敌 —— 万一将来有人往这儿加怪，
    // 「看地图的人被打死了」比「什么都没发生」更费解。
    ctx.player.setInvulnerable(true)

    drawScene(ctx.scene, L)
    this.overlay = drawOverlay(ctx.scene, L)
    drawLegend(ctx.scene, L)

    ctx.scene.input.keyboard?.on('keydown-D', (ev: KeyboardEvent) => {
      // `ev.repeat` 要挡：按住不放会按系统重复率一直发 keydown，叠层就会闪。
      if (ev.repeat) return
      const o = this.overlay
      if (o === null) return
      o.setVisible(!o.visible)
      ctx.hud.setNotice(o.visible ? '判定叠加 ON（红格 = D2 的 40px 判定站不了）' : '')
    })
    ctx.scene.input.keyboard?.on('keydown-N', (ev: KeyboardEvent) => {
      if (ev.repeat) return
      seedIndex = (seedIndex + 1) % D2_SEEDS.length
      this.scene.restart()
    })

    // 长度是算过的：底座的提示条是 20px、**一行不折**且没有宽度上限
    // （`Hud.setNotice`），这一句约 40 个全角 ≈ 800px / 1280。再加词就会顶出画布。
    ctx.hud.setNotice('教室长这样：地砖 / 桌椅 / 黑板 / 门都是画出来的 —— 按 D 叠判定，按 N 换种子')
  }
}

// ---------------------------------------------------------------- 画一张

/**
 * 画顺序：**底 → 地面 → 家具 → 墙 → 门 → 装饰**。
 *
 * 墙压在课桌上面、门压在墙上面：顺序错了的症状都是「某样东西被另一样盖住」，
 * 而那在现场看起来像「生成器没生成它」。
 */
function drawScene(scene: Phaser.Scene, L: SceneLayout): void {
  const { map, cfg, room, box, mapper } = L
  const g = scene.add.graphics().setDepth(-80)

  // 0. 取景框那块底。画布其余部分是底座的黑网格，留着 —— 一眼能分出
  //    「这张画」和「场子的底」。
  const p0 = mapper.toScreen(left(box), top(box))
  g.fillStyle(INK.mat, 1)
  g.fillRect(p0.x, p0.y, box.width * L.scale, box.height * L.scale)
  strokeWorld(g, mapper, box, INK.matEdge, 1)

  // 1. 连廊地面。框里只可能露出门外的一点点（框是贴着房间切的，见文件头）。
  for (const p of map.passages) {
    const c = clipRect(p.rect, box)
    if (c === null) continue
    drawTiles(g, mapper, map, cfg, c, INK.passageA, INK.passageB, INK.passageLine)
  }

  // 2. 地面。**框里出现的每一间都要铺**，不只是选中的那一间 ——
  //    只铺一间的话，侧室搭在宿主墙外的那一条会是一块黑，
  //    而黑看起来和「生成器没生成这块地面」一模一样（`drawRoom1to1` 同一条）。
  //    邻居压淡一点：画面得一眼分得出「要看的是哪一间」。
  for (const other of map.rooms) {
    const c = clipRect(other.rect, box)
    if (c === null) continue
    drawTiles(g, mapper, map, cfg, c, INK.floorA, INK.floorB, INK.floorLine, other === room ? 1 : 0.5)
  }

  // 3. 家具。框里每一间都画（侧室露出来的那条边上可能正好有张桌子）。
  for (const other of map.rooms) {
    if (clipRect(other.rect, box) === null) continue
    for (const o of other.obstacles) {
      const r = clipRect(o.rect, box)
      if (r === null) continue
      if (o.kind === 'desk') drawDesk(g, mapper, r)
      else drawChair(g, mapper, r)
    }
  }

  // 4. 墙 + 房间内沿那一条亮线
  for (const w of L.walls) {
    fillWorld(g, mapper, w, INK.wall)
    strokeWorld(g, mapper, w, INK.wallEdge, 1)
  }
  // 内沿 = 房间往里收半堵墙（墙骑在房间边界上，它朝内的那一面就是内表面）。
  // 画在门之前：门会把跨过门洞的那一段盖掉 —— 不用专门去断开这条线。
  strokeWorld(g, mapper, inflate(room.rect, -cfg.wallThickness / 2), INK.roomLine, 2, 0.9)

  // 5. 门。**整扇在框里才画** —— 半扇门画出来会被读成「墙上有个奇怪的缺口」。
  for (const other of map.rooms) {
    for (const d of other.doors) {
      const hole = doorHole(d, cfg)
      if (!fullyInside(hole, box)) continue
      drawDoor(g, mapper, hole)
    }
  }

  // 6. 装饰（**只有选中的那一间**，且都不是地图数据 —— 见文件头）
  drawDecor(g, mapper, cfg, room)
}

/**
 * 黑板、窗、四角的盆栽。
 *
 * ## 挂哪面墙：北墙优先，有门就换南墙，两面都有门就不画
 *
 * 生成器里**没有「教室的正面」这个概念** —— 门开在东西墙上，黑板挂北挂南都说得通。
 * 所以这是一个**装饰的固定选择**（不是从数据里读出来的）：北墙。
 * 只有北墙上开着 `side` 门（侧室挂在上方）时才换到南墙；两面都有门（一上一下挂了两间
 * 侧室）就**不画** —— 硬塞会让黑板压住门，而那比没有黑板难看得多。
 *
 * 窗只在放得下的房间上画（窄的 400 档：黑板已经占掉中间 3 格，两边塞不下窗）。
 * 盆栽避开课桌：压在桌子上看起来像「这儿多了一张矮桌」。
 */
function drawDecor(
  g: Phaser.GameObjects.Graphics,
  m: Mapper,
  cfg: RoomsConfig,
  room: Room,
): void {
  const cell = cfg.navCellSize
  const inner = cfg.wallThickness / 2 // 房间的内表面：墙骑在边界上，各吃半堵
  const northHasDoor = room.doors.some((d) => d.axis === 'h' && d.y < room.rect.y)
  const southHasDoor = room.doors.some((d) => d.axis === 'h' && d.y > room.rect.y)
  const wallY = !northHasDoor ? top(room.rect) : southHasDoor ? null : bottom(room.rect)

  if (wallY !== null) {
    const dir = wallY === top(room.rect) ? 1 : -1 // 朝房间里面长

    // 黑板：居中，3 格宽
    const boardH = Math.round(cell * 0.55)
    const board: Rect = {
      x: room.rect.x,
      y: wallY + dir * (inner + boardH / 2),
      width: 3 * cell,
      height: boardH,
    }
    fillWorld(g, m, board, INK.board)
    strokeWorld(g, m, board, INK.boardFrame, 2)
    // 粉笔字：两行短横。不写字 —— 黑板上的字在这张图的尺度上是一团糊。
    const bp = m.toScreen(left(board), top(board))
    const bw = board.width * m.scale
    const bh = board.height * m.scale
    g.fillStyle(INK.chalk, 0.7)
    g.fillRect(bp.x + bw * 0.08, bp.y + bh * 0.26, bw * 0.38, Math.max(1, bh * 0.09))
    g.fillRect(bp.x + bw * 0.08, bp.y + bh * 0.56, bw * 0.24, Math.max(1, bh * 0.09))

    // 窗：同一面墙上左右各一扇，各 2 格宽。**与黑板或门撞上就不画这一扇。**
    const winH = Math.round(cell * 0.22)
    const offset = room.rect.width / 2 - 1.5 * cell
    for (const sign of [-1, 1]) {
      const win: Rect = {
        x: room.rect.x + sign * offset,
        y: wallY + dir * (inner + winH / 2),
        width: 2 * cell,
        height: winH,
      }
      if (rectsIntersect(win, board)) continue
      if (room.doors.some((d) => d.axis === 'h' && rectsIntersect(win, doorHole(d, cfg)))) continue
      fillWorld(g, m, win, INK.window)
      strokeWorld(g, m, win, INK.windowEdge, 1)
    }
  }

  // 四角盆栽。装饰的装饰 —— 但少了它，这间房看起来像「一间还没摆完的房」。
  const size = Math.round(cell * 0.65)
  const inset = 1.5 * cell
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const pot: Rect = {
        x: room.rect.x + sx * (room.rect.width / 2 - inset),
        y: room.rect.y + sy * (room.rect.height / 2 - inset),
        width: size,
        height: size,
      }
      if (room.obstacles.some((o) => rectsIntersect(o.rect, pot))) continue
      drawPlant(g, m, pot)
    }
  }
}

/**
 * `D` 键叠的那一层：**判定**。默认隐藏。
 *
 * 三样都是**读数据来的**，一样都不现算：
 *
 * | 叠出来的 | 读的是 |
 * |---|---|
 * | 红格 | `gridOfMap()` —— 和校验器、和将来 D3 的寻路**同一份** |
 * | 粉圈 + `spawn` | `room.spawnPoints` |
 * | `#序号 关别 (branch)` | `room.order` / `room.kind` / `room.branch` |
 *
 * 颜色全部走 `COLORS`（不是 `INK`）：这一层要和 `d2_classroom` 里那一层
 * **长得一模一样** —— 两边说的是同一件事，颜色不一样就等于两件事。
 */
function drawOverlay(scene: Phaser.Scene, L: SceneLayout): Phaser.GameObjects.Container {
  const { map, cfg, room, box, mapper } = L
  const g = scene.add.graphics()
  const texts: Phaser.GameObjects.Text[] = []

  // 红格。读 `gridOfMap()` —— 这里现算一份的话，这个场子显示的东西
  // 就只是它自己的说法，证明不了任何事（`drawRoom1to1` 同一条）。
  const grid = gridOfMap(map)
  const cell = grid.cellSize
  const cx0 = Math.max(0, Math.floor((left(box) - grid.originX) / cell))
  const cx1 = Math.min(grid.cols - 1, Math.floor((right(box) - grid.originX) / cell))
  const cy0 = Math.max(0, Math.floor((top(box) - grid.originY) / cell))
  const cy1 = Math.min(grid.rows - 1, Math.floor((bottom(box) - grid.originY) / cell))
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      if (grid.blocked[cy * grid.cols + cx] !== 1) continue
      const wx = grid.originX + cx * cell
      const wy = grid.originY + cy * cell
      const p = mapper.toScreen(wx, wy)
      g.fillStyle(COLORS.blockedCell, 0.3)
      g.fillRect(p.x, p.y, cell * L.scale, cell * L.scale)
      g.lineStyle(1, COLORS.blockedEdge, 0.9)
      g.strokeRect(p.x + 1, p.y + 1, cell * L.scale - 2, cell * L.scale - 2)
    }
  }

  // 刷怪点
  for (const s of room.spawnPoints) {
    const p = mapper.toScreen(s.x, s.y)
    g.lineStyle(2, COLORS.spawn, 1)
    g.strokeCircle(p.x, p.y, cfg.navCellSize * 0.4 * L.scale)
    g.fillStyle(COLORS.spawn, 1)
    g.fillCircle(p.x, p.y, 3)
    texts.push(
      scene.add
        .text(p.x, p.y - cfg.navCellSize * 0.7 * L.scale, 'spawn', {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#ff9ac8',
        })
        .setOrigin(0.5),
    )
  }

  // 房名。中文关别读 `ROOM_KIND_LABELS`（全项目唯一那份表），`branch` 印原值 ——
  // 对着 `Room` 读代码时用得上（`drawRoom1to1` 同一条）。
  const lp = mapper.toScreen(room.rect.x, top(room.rect) + cfg.navCellSize)
  texts.push(
    scene.add
      .text(lp.x, lp.y, `#${room.order} ${ROOM_KIND_LABELS[room.kind]} (${room.branch})`, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: COLORS.text,
      })
      .setOrigin(0.5),
  )

  // 容器在 depth −70：**压在观感图上面**（−80）、压在底座 HUD 下面（999+）。
  return scene.add.container(0, 0, [g, ...texts]).setDepth(-70).setVisible(false)
}

/**
 * 右下角那三行读法（左边被底座的按键说明占着，见文件头「版面」）。
 *
 * 每行不超过约 55 个全角 —— 这一块的右边是画布边（1272），左边是 `HUD_HINT_RIGHT`，
 * 算下来 650px 可用（11px 字）。**缩放在第一行**：拿这张图量像素之前先看它。
 *
 * ⚠️ 这些字是**字面量**：`Phaser.Text` 不认 Markdown，写 `**不是 1:1**` 是会**原样印出来**
 * 的（第一版就这么印在了屏幕上）。强调靠词序，不靠星号。
 */
function drawLegend(scene: Phaser.Scene, L: SceneLayout): void {
  const where = L.room.branch === 'side' ? '侧室' : '主干'
  const doors = L.room.doors.map((d) => `${d.kind}→${d.toOrder}`).join(' ')
  scene.add
    .text(
      LEGEND_AT.x,
      LEGEND_AT.y,
      [
        `种子 ${L.map.seed} · #${L.room.order} ${where}·${ROOM_KIND_LABELS[L.room.kind]} · ${L.room.rect.width}×${L.room.rect.height}px · 档位 ${L.room.sizeTier}`,
        `缩放 ×${L.scale.toFixed(2)}（不是 1:1，看观感）· 生成 ${elapsedText(L.elapsedMs)} · 桌椅 ${L.room.obstacles.length} · 刷怪点 ${L.room.spawnPoints.length} · 门 ${doors}`,
        'D = 判定叠加（红格 / 刷怪点 / 标签）　N = 换种子　黑板 · 窗 · 盆栽是装饰，不在地图数据里',
      ].join('\n'),
      { fontFamily: 'monospace', fontSize: '11px', color: COLORS.text, lineSpacing: 3 },
    )
    .setDepth(1000)
}

export const arena: ArenaDefinition = {
  displayName: 'D2 · 教室长这样（观感）',
  // 长度是算过的：底座的标题**不折行**，写到 1200px 就会被画布右边切掉。
  // 上限约 80 个全角字（15px 字，从 x = 8 起）。
  description:
    '同一间教室的观感图：地砖、课桌椅、黑板、门框、盆栽。桌椅与门是地图数据，黑板 / 窗 / 盆栽是装饰。按 D 叠判定，按 N 换种子。',
  scene: D2ClassroomSceneArena,
}