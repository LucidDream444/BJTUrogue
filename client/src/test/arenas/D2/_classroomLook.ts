/**
 * **教室长什么样** —— 观感那套画法，从 `d2_classroom_scene` 抽出来的**共用件**。
 *
 * 文件名 `_` 开头 = **不进测试场菜单**（`arenaCatalog.ts` 的规则，`_shared.ts` 同一条）。
 * 它住在 `arenas/D2/` 里，所以「D2 的场子只许 import `domains/procgen`」那条照样管着它。
 *
 * ## 谁在用
 *
 * | 场子 | 怎么用 | 看什么 |
 * |---|---|---|
 * | `d2_classroom_scene` | 一间房、取景框 1:1 放大（≤×2），`focus` = 那一间 | 观感本身对不对 |
 * | `d2_three_rooms` | **整层**三间，跟着玩家走位，`depth` 抬到 −48 | 走位时观感层跟不跟得上 |
 *
 * 两个场子摆的是**同一份地图数据**、同一套配色、同一套画法 —— 各写一份的话，
 * 「观感图」和「走位图」会慢慢变成两张没法互相印证的画。
 *
 * ## 哪些是**画出来的**，哪些是**生成出来的**（这一条最要紧）
 *
 * | 画面上 | 来源 |
 * |---|---|
 * | 地面、墙、门的位置、课桌椅 | **地图数据**（`DungeonMap`），位置一格不差 |
 * | 地砖的缝 | **D2 的 40px 判定格**（`navOrigin` 对齐，就是 `navCellSize`） |
 * | 黑板、窗、四角的盆栽 | **装饰**：地图数据里没有这三样东西 |
 *
 * 装饰是**故意加的**，为的是让画面像一间教室。它们**不在 `Room` 的任何字段里**
 * —— D1 的子弹不会撞到它们，D3 的寻路不知道它们存在。
 * 真要把它们变成真东西，那是**改契约**（`obstacles` 加 `kind`、配置表加数值、
 * 通知 D1 与 D3 走 C2 流程），**不是把这里的画法搬过去**。
 *
 * ## 配色是**两套**，别混用
 *
 * | 那一套 | 这一套 |
 * |---|---|
 * | `floorplan.ts` 的 `COLORS`：红格、紫描边、青线 —— 给**判定**上色 | `INK`：地砖、桌椅、黑板 —— 给**东西**上色 |
 *
 * 唯一共用的是判定层的 `COLORS.blockedCell` / `COLORS.spawn`（`d2_classroom_scene`
 * 的 `D` 键那一层）—— 同一份判定在两个场子里要是两种样子，谁也不会想到它们读的是同一个数。
 *
 * ## 画顺序：**底 → 地面 → 家具 → 墙 → 门 → 装饰**
 *
 * 墙压在课桌上面、门压在墙上面：顺序错了的症状都是「某样东西被另一样盖住」，
 * 而那在现场看起来像「生成器没生成它」。
 */

import type Phaser from 'phaser'
import type { RoomsConfig } from '@/domains/procgen/config'
import {
  bottom,
  clipRect,
  doorRect,
  inflate,
  left,
  rectsIntersect,
  right,
  top,
} from '@/domains/procgen/model/rect'
import type { Door, DungeonMap, Rect, Room } from '@/domains/procgen/model/types'
import { fullyInside } from '@/domains/procgen/presentation/framing'
import type { Mapper } from '@/domains/procgen/presentation/floorplan'

/**
 * 默认画在哪一层。
 *
 * −80 是「底图」那一档：底座的地板网格在 −100、墙的灰方块在 −50、
 * 判定叠加在 −70。`d2_three_rooms` **不**用这个默认值 —— 它要盖住底座那些灰墙，
 * 见那边 `LOOK_DEPTH` 的注释。
 */
export const LOOK_DEPTH = -80

/**
 * 观感配色。和 `floorplan.ts` 的 `COLORS` 是**两套**（见文件头那张表）。
 */
export const INK = {
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
   * 门会把跨过门洞的那一段盖掉，不用专门去断开（见 `drawClassroomLook`）。
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
 * 洞本身**不是画上去的**（生成器本来就给墙留了缺口），这里只是给洞口加一圈橙框 ——
 * 不加的话，墙上的缺口看起来像「这一段墙没生成出来」，而那正是看场子的人
 * 最容易误判的一种坏法。
 *
 * 这条式子**不再在这儿写第二遍**：它就是 `rect.ts` 的 `doorRect()`，
 * 也是碰撞那边（`collidersOf().barriers`）用来造门挡板的同一条。
 * 这里自己算一份的话，画出来的橙框和挡板的实际位置会**各说各的**，
 * 而那种偏差看起来像「门没关严」。
 */
function doorHole(d: Door, cfg: RoomsConfig): Rect {
  return doorRect(d, cfg.wallThickness)
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

// ---------------------------------------------------------------- 画一张

/** `drawClassroomLook()` 要的那几样。**全是地图坐标**，换算在函数里走 `mapper`。 */
export interface ClassroomLook {
  map: DungeonMap
  cfg: RoomsConfig
  /** 地图 → 屏幕的换算器。**每个场子只有一份**，不许在这里自己算平移 */
  mapper: Mapper
  /** 画到哪儿为止（地图坐标）。整层画给 `map.bounds`，一间房给「房间 + 一圈留白」 */
  box: Rect
  /** 裁进 `box` 的墙。由调用方给 —— 它同时还要喂给碰撞，两处必须是同一份 */
  walls: readonly Rect[]
  /**
   * 只给**这一间**上色（其余压淡、且只有它画装饰）。
   *
   * 不给（`null` / 省略）= **每一间都按主角画** —— `d2_three_rooms` 那一场要的：
   * 三间都是要走进去打架的教室，没有哪一间是「背景」。
   */
  focus?: Room | null
  /** 画在哪一层，默认 `LOOK_DEPTH`（−80） */
  depth?: number
}

/**
 * 把观感画上去，返回那个 `Graphics`（**调用方要能拿到它**：`d2_three_rooms`
 * 靠 `setVisible` 在白箱 / 观感之间切）。
 *
 * 画的东西按「底 → 地面 → 家具 → 墙 → 门 → 装饰」六步，见文件头。
 */
export function drawClassroomLook(scene: Phaser.Scene, look: ClassroomLook): Phaser.GameObjects.Graphics {
  const { map, cfg, mapper, box } = look
  const focus = look.focus ?? null
  const g = scene.add.graphics().setDepth(look.depth ?? LOOK_DEPTH)

  // box 里出现的每一间。后面几处都读它，免得各写一遍 `clipRect(...) !== null`
  // ——那种重复检查最容易在某一处写漏，而漏的那一处表现是「这间房少画了地面」。
  const rooms = map.rooms.filter((r) => clipRect(r.rect, box) !== null)

  // 0. box 那块底。画布其余部分是底座的黑网格，留着 —— 一眼能分出
  //    「这张画」和「场子的底」。
  const p0 = mapper.toScreen(left(box), top(box))
  g.fillStyle(INK.mat, 1)
  g.fillRect(p0.x, p0.y, box.width * mapper.scale, box.height * mapper.scale)
  strokeWorld(g, mapper, box, INK.matEdge, 1)

  // 1. 连廊地面。一间房的取景框里只可能露出门外的一点点。
  for (const p of map.passages) {
    const c = clipRect(p.rect, box)
    if (c === null) continue
    drawTiles(g, mapper, map, cfg, c, INK.passageA, INK.passageB, INK.passageLine)
  }

  // 2. 地面。**box 里出现的每一间都要铺**，不只是选中的那一间 ——
  //    只铺一间的话，侧室搭在宿主墙外的那一条会是一块黑，
  //    而黑看起来和「生成器没生成这块地面」一模一样（`drawRoom1to1` 同一条）。
  //    有 focus 时邻居压淡一点：画面得一眼分得出「要看的是哪一间」。
  for (const other of rooms) {
    const c = clipRect(other.rect, box)
    if (c === null) continue
    drawTiles(g, mapper, map, cfg, c, INK.floorA, INK.floorB, INK.floorLine, focus === null || other === focus ? 1 : 0.5)
  }

  // 3. 家具。box 里每一间都画（侧室露出来的那条边上可能正好有张桌子）。
  for (const other of rooms) {
    for (const o of other.obstacles) {
      const r = clipRect(o.rect, box)
      if (r === null) continue
      if (o.kind === 'desk') drawDesk(g, mapper, r)
      else drawChair(g, mapper, r)
    }
  }

  // 4. 墙 + 房间内沿那一条亮线
  for (const w of look.walls) {
    fillWorld(g, mapper, w, INK.wall)
    strokeWorld(g, mapper, w, INK.wallEdge, 1)
  }
  // 内沿 = 房间往里收半堵墙（墙骑在房间边界上，它朝内的那一面就是内表面）。
  // 画在门之前：门会把跨过门洞的那一段盖掉 —— 不用专门去断开这条线。
  for (const r of focus === null ? rooms : [focus]) {
    strokeWorld(g, mapper, inflate(r.rect, -cfg.wallThickness / 2), INK.roomLine, 2, 0.9)
  }

  // 5. 门。**整扇在 box 里才画** —— 半扇门画出来会被读成「墙上有个奇怪的缺口」。
  for (const other of map.rooms) {
    for (const d of other.doors) {
      const hole = doorHole(d, cfg)
      if (!fullyInside(hole, box)) continue
      drawDoor(g, mapper, hole)
    }
  }

  // 6. 装饰。**只有地图数据里没有的那三样**（见文件头），
  //    每间教室都画 —— 三间都要走进去，哪一间也不该像「还没摆完的房」。
  for (const r of focus === null ? rooms : [focus]) drawDecor(g, mapper, cfg, r)

  return g
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