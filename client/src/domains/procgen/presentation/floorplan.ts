/**
 * 地图的**白箱**绘制：整层缩略图 + 单间教室 1:1。
 *
 * ---
 *
 * ## ⚠️ 这是 `procgen/` 里**唯一** import Phaser 的文件
 *
 * 别的文件（生成器、校验器、配置加载）都是纯函数，node 下直接跑单测。
 * 一旦哪份**测试**的依赖闭包里出现了 Phaser，`architecture.test.ts` 会当场红 ——
 * 这不是洁癖，是 `vite.config.ts` 把 Vitest 的环境钉死在 `node` 上
 * （见 `AGENTS.md` §七）：需要 jsdom 才能测的逻辑 = 逻辑和表现层没分开。
 *
 * 所以这一层的规矩很硬：**只有它碰 Phaser，而且它不写任何判定。**
 * 它只做一件事 —— 把已经算好的数据画出来。反过来（在绘制里补一个
 * 「这个房间应该在这儿」的推断）会让「画出来的」和「生成出来的」
 * 变成两个事实，而它们**不一致的时候恰恰是最需要看见的时候**。
 *
 * ## 为什么绘制值得单独一层
 *
 * 没有它，三个场子各写一份 `add.rectangle(...)`，三份对「门画在哪儿」
 * 「堵格是什么颜色」的理解就会分叉。而分叉之后，最坏的情形是
 * **两个场子对同一张图给出不同的画面，而两张都"看起来对"** ——
 * 那时没有人能判断哪个是真的，测试场就白建了。
 */

import Phaser from 'phaser'
import type { RoomsConfig } from '../config'
import { isCombatKind } from '../config'
import { bottom, clipRect, left, rectsIntersect, right, top } from '../model/rect'
import type { DungeonMap, Rect, Room } from '../model/types'
import { ROOM_KIND_LABELS } from '../model/types'
import { gridOfMap } from '../walkability'
import { fullyInside } from './framing'

// ---------------------------------------------------------------- 配色

/**
 * 配色表。**导出给场子用** —— 图例和画面必须读同一份，
 * 否则图例是对的、画面是错的（或者反过来），而两者都"看起来像那么回事"。
 */
export const COLORS = {
  /** 房间外的底色（整层的"空气"） */
  outside: 0x0b0b10,
  /**
   * **连廊**地面。**比 `outside` 明显亮一档** —— 差得太小的话，
   * 1:1 的场子里「门外面是连廊还是空气」看不出来，而那正是要看的。
   *
   * ⚠️ 它必须是**偏暖的**，不能是中性的灰。第一版用了 `0x262632`
   * （只比底色亮一点的中性灰），结果在缩略图那条 8:1 的长条上，
   * 连廊和背景**分不开** —— 一排主干教室里，连廊只有 200px 宽（缩到屏幕上 24px），
   * 而「教室之间那一段是什么」恰恰是这一排唯一要看的东西。
   *
   * 也不能偏蓝或偏绿：那会和两类教室撞。所以取一个深卡其 ——
   * 两边都不像，一眼能分出来就是它不是教室。
   */
  passage: 0x453b28,
  /** 主干教室 */
  mainRoom: 0x1e3a5f,
  mainRoomEdge: 0x4a7fb5,
  /** 侧室 */
  sideRoom: 0x1e4f3a,
  sideRoomEdge: 0x4ab58a,
  /** 起点 / 首领的强调描边 */
  startEdge: 0xb5a54a,
  bossEdge: 0xb54a4a,
  /**
   * **非战斗关别**（道具关 / 宝箱关，以及被 `combatKinds` 排除的起点/首领）的描边。
   *
   * 取紫罗兰色。它要和已经用掉的四种颜色**都分得开**：主干蓝 `0x4a7fb5`、
   * 侧室绿 `0x4ab58a`、起点黄 `0xb5a54a`、首领红 `0xb54a4a` ——
   * 也刻意避开刷怪点的粉 `0xd44a8a`（紫得发红就会和它混）。
   *
   * ⚠️ 起点 / 首领的描边**优先级更高**（见 `drawRoomOutline`）：一层的起点在哪
   * 比「这间打不打架」更值得一眼看见。默认配置里那两个都是战斗房，不冲突；
   * 真把 `start` 移出 `combatKinds` 时，起点房会保持黄色 —— 那是对的。
   */
  nonCombatEdge: 0x9b6ad4,
  /** 墙 */
  wall: 0x3a3a4a,
  wallEdge: 0x6a6a80,
  /** 门：按 `DoorKind` 区分 */
  doorForward: 0x4ad4a0,
  doorBack: 0x5a8fd4,
  doorSide: 0xd4a04a,
  doorSealed: 0x777788,
  /** 障碍物 */
  desk: 0x8a6a3a,
  chair: 0x6a5a4a,
  /** 刷怪点 */
  spawn: 0xd44a8a,
  /** **D2 的 40px 可走性判定**：红格 = 这一格中心站不了。底色用 */
  blockedCell: 0xff4040,
  /**
   * 同一件事的**描边**，画在障碍物**上面**。
   *
   * 为什么要两遍：底色那一遍会被**恰好压在上面的那张桌子盖掉** ——
   * 而「这一格为什么堵」的答案就是那张桌子。只画底色的话，
   * 有桌子的格子看不见红、没桌子的格子才有红，**恰好把要看的东西漏光**。
   */
  blockedEdge: 0xff5050,
  /** 40px 网格线。**要比地面亮** —— 比地面暗的线在缩放和压缩之后会消失。 */
  grid40: 0x5f7f9f,
  /** 底座的 80px 粗网格（只画线，不判断）。青色，与 40px 网格明确区分 */
  harnessGrid: 0x00d8ff,
  text: '#cfe4ff',
} as const

const DOOR_COLOR: Record<string, number> = {
  forward: COLORS.doorForward,
  back: COLORS.doorBack,
  side: COLORS.doorSide,
}

// ---------------------------------------------------------------- 换算

/** 世界坐标 → 屏幕坐标。**所有绘制都走它**，别处不许再写一次平移公式。 */
export interface Mapper {
  readonly scale: number
  toScreen(wx: number, wy: number): { x: number; y: number }
}

function mapperFor(world: Rect, screenX: number, screenY: number, scale: number): Mapper {
  const originX = left(world)
  const originY = top(world)
  return {
    scale,
    toScreen: (wx, wy) => ({
      x: screenX + (wx - originX) * scale,
      y: screenY + (wy - originY) * scale,
    }),
  }
}

function fillWorldRect(
  g: Phaser.GameObjects.Graphics,
  m: Mapper,
  r: Rect,
  color: number,
  alpha = 1,
): void {
  const p = m.toScreen(left(r), top(r))
  g.fillStyle(color, alpha)
  g.fillRect(p.x, p.y, r.width * m.scale, r.height * m.scale)
}

/** 起止两条世界坐标线（横向或纵向）。 */
function lineWorld(
  g: Phaser.GameObjects.Graphics,
  m: Mapper,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  const a = m.toScreen(x0, y0)
  const b = m.toScreen(x1, y1)
  g.lineBetween(a.x, a.y, b.x, b.y)
}

/** 门画成一段**亮线**，颜色按 `DoorKind`。线宽在屏幕上是定值，不随缩放变。 */
function drawDoor(
  g: Phaser.GameObjects.Graphics,
  m: Mapper,
  door: { kind: string; x: number; y: number; width: number; axis: 'h' | 'v'; toOrder: number | null },
): void {
  const color = door.toOrder === null ? COLORS.doorSealed : (DOOR_COLOR[door.kind] ?? COLORS.doorSealed)
  g.lineStyle(3, color, 1)
  const half = door.width / 2
  if (door.axis === 'h') lineWorld(g, m, door.x - half, door.y, door.x + half, door.y)
  else lineWorld(g, m, door.x, door.y - half, door.x, door.y + half)
}

// ---------------------------------------------------------------- 整层

export interface FloorplanOptions {
  /** 目标盒子（屏幕坐标，左上角 + 尺寸） */
  x: number
  y: number
  width: number
  height: number
  /** 盒子内边距。默认 10 */
  padding?: number
  /** 画 `#序号` 标签。默认 true */
  labels?: boolean
  /** 画门。默认 true */
  doors?: boolean
  /** 画刷怪点。默认 true */
  spawns?: boolean
  /** 画障碍物。整层缩略图里它们只有几个像素，默认 false */
  obstacles?: boolean
  /**
   * 要画的世界范围。默认 `map.bounds`（整层）。
   *
   * 有它才能**用同一个函数画局部放大**：整层是一排 15 间房，宽近 8000px、
   * 高不到 1000px —— 缩到屏幕上是一条 12:1 的长条，侧室与宿主那点搭接
   * 只剩几个像素。放大那一遍把同一个 `drawFloorplan` 对准其中两三间房，
   * 于是**两遍的配色、门型、画法天然一致**；各写一份绘制才是分叉的开始。
   */
  world?: Rect
}

export interface FloorplanView {
  mapper: Mapper
  /** 房间 → 屏幕矩形 */
  roomRect(room: Room): { x: number; y: number; width: number; height: number }
}

/**
 * 缩略图上那一行标签：**位置 · 关别**，例 `侧室·宝箱关`。
 *
 * 两个字段回答两个问题，而这张图两个都要答：
 *
 * | 字段 | 在这张图上的样子 |
 * |---|---|
 * | `branch`（位置） | 位置词 + 底色（主干蓝 / 侧室绿） |
 * | `kind`（内容） | `ROOM_KIND_LABELS` 的中文名 + 非战斗关别的紫色描边 |
 *
 * 早先这里只印位置词（`侧室` / `主干` / `起点` / `首领`），理由是「侧室和主干
 * 都写着 main，照原值印反而分不出来」。那句话在对 `kind` 的**原值**说事，
 * 而关别表落地之后原值不再是唯一的选择 —— 读 `ROOM_KIND_LABELS` 就有中文名，
 * 于是两个字段可以并列写出来，不必二选一。
 *
 * ⚠️ **中文名从 `ROOM_KIND_LABELS` 读，不许在这里写第二份关别名册**：
 * 三处各写一遍就是三份会漂移的事实，而漂移的表现是「同一个关别在两块画面上
 * 写着两个词」，谁都不会注意到（spec `procgen-config-contract` 有这一条）。
 */
function roleLabel(room: Room): string {
  const where = room.branch === 'side' ? '侧室' : '主干'
  return `${where}·${ROOM_KIND_LABELS[room.kind]}`
}

/**
 * 一间房描边的颜色与线宽。
 *
 * 优先级：**起点 / 首领 > 非战斗 > 位置**。
 *
 * - 起点与首领优先：「这层的起点在哪、终点在哪」是一眼就要看见的两个位置，
 *   而它比「这一间打不打架」更基本（默认配置里那两个本来也是战斗房）。
 * - 非战斗优先于位置：位置已经由**底色**表达了（主干蓝 / 侧室绿），描边空出来
 *   正好说第二件事 —— 「这一间不打架」。两件事各占一个通道，谁也不挤谁。
 */
function roomOutline(cfg: RoomsConfig, room: Room): { color: number; width: number } {
  if (room.kind === 'start') return { color: COLORS.startEdge, width: 3 }
  if (room.kind === 'boss') return { color: COLORS.bossEdge, width: 3 }
  if (!isCombatKind(cfg, room.kind)) return { color: COLORS.nonCombatEdge, width: 3 }
  return { color: room.branch === 'main' ? COLORS.mainRoomEdge : COLORS.sideRoomEdge, width: 2 }
}

/**
 * 把一个世界矩形按比例缩进一个屏幕盒子。
 *
 * **按比例，不是按 1:1** —— 一排 15 间房宽近 8000px，塞进 1280×720 必然要缩。
 * 缩略图回答的是「房间怎么串、门开在哪个方向、连廊通不通」，
 * 不是「课桌摆在离墙第几像素」—— 后者是 `d2_classroom` 的活。
 *
 * ## 取景框切到的东西，就不许再替它下结论
 *
 * `world` 比 `map.bounds` 小的时候，边框上会切出**半间房**。半间房画成
 * 半间房是对的（那是真的），但**描边和标签不行**：沿取景框画出来的那两条边
 * 会被读成「这里有一堵墙」，而原图上那儿什么都没有。
 * 所以规矩是：**填充按 `clipRect` 裁着画，描边/标签/门/刷怪点只画整块在框里的**。
 */
export function drawFloorplan(
  scene: Phaser.Scene,
  map: DungeonMap,
  cfg: RoomsConfig,
  opts: FloorplanOptions,
): FloorplanView {
  const world = opts.world ?? map.bounds
  const pad = opts.padding ?? 10
  const innerW = Math.max(1, opts.width - pad * 2)
  const innerH = Math.max(1, opts.height - pad * 2)
  const bw = Math.max(1, world.width)
  const bh = Math.max(1, world.height)
  const scale = Math.min(innerW / bw, innerH / bh)

  // 居中：内容比盒子小的时候两边留一样多，而不是全堆在左上角。
  const screenX = opts.x + pad + (innerW - bw * scale) / 2
  const screenY = opts.y + pad + (innerH - bh * scale) / 2
  const mapper = mapperFor(world, screenX, screenY, scale)

  const g = scene.add.graphics()
  g.setDepth(-80)

  // 1. 连廊。**先画它**，房间盖在上面 —— 房间与连廊交界的那一小段
  //    应该显示成房间，那才是玩家实际站在哪儿。
  //
  //    一段段画，不是画一条贯穿全层的带：连廊是**教室之间**的连接，
  //    一排里两间教室之间那一段深色就是它。
  for (const p of map.passages) {
    const c = clipRect(p.rect, world)
    if (c !== null) fillWorldRect(g, mapper, c, COLORS.passage)
  }

  // 2. 房间地面（+ 可选障碍物）。半间房裁着画，理由见上面「取景框」那一段。
  for (const room of map.rooms) {
    const c = clipRect(room.rect, world)
    if (c === null) continue
    fillWorldRect(g, mapper, c, room.branch === 'main' ? COLORS.mainRoom : COLORS.sideRoom)
    if (opts.obstacles ?? false) {
      for (const o of room.obstacles) {
        const oc = clipRect(o.rect, world)
        if (oc !== null) {
          fillWorldRect(g, mapper, oc, o.kind === 'desk' ? COLORS.desk : COLORS.chair, 0.8)
        }
      }
    }
  }

  // 3. 墙。缩略图里墙常常只有两三个像素宽 —— 仍然画，因为**它就是
  //    「哪几段是封死的」的唯一可视证据**（侧室的封口、连廊两端）。
  //    墙是整层连续的（上下两条墙线从头贯到尾），所以必须裁。
  for (const w of map.walls) {
    const c = clipRect(w, world)
    if (c !== null) fillWorldRect(g, mapper, c, COLORS.wall, 0.9)
  }

  // 4. 房间描边。压在墙上面：边界比墙更值得看清。
  //    只描**整块在取景框里**的房间，否则沿框边画出来的那两条线会被读成墙。
  for (const room of map.rooms) {
    if (!fullyInside(room.rect, world)) continue
    const p = mapper.toScreen(left(room.rect), top(room.rect))
    const w = room.rect.width * scale
    const h = room.rect.height * scale
    const line = roomOutline(cfg, room)
    g.lineStyle(line.width, line.color, 1)
    g.strokeRect(p.x, p.y, w, h)
  }

  if (opts.doors ?? true) {
    for (const room of map.rooms) {
      if (!fullyInside(room.rect, world)) continue
      for (const d of room.doors) drawDoor(g, mapper, d)
    }
  }

  if (opts.spawns ?? true) {
    for (const room of map.rooms) {
      if (!fullyInside(room.rect, world)) continue
      for (const s of room.spawnPoints) {
        const p = mapper.toScreen(s.x, s.y)
        g.fillStyle(COLORS.spawn, 1)
        g.fillRect(p.x - 2, p.y - 2, 4, 4)
      }
    }
  }

  if (opts.labels ?? true) {
    // 字号跟着格子走：缩放很小时 12px 的字会糊成一团，把缩略图变成一片字。
    const size = Math.max(10, Math.min(16, Math.round(cfg.navCellSize * 2 * scale)))
    for (const room of map.rooms) {
      if (!fullyInside(room.rect, world)) continue
      const p = mapper.toScreen(room.rect.x, room.rect.y)
      scene.add
        // 标的是**位置 · 关别**（见 `roleLabel`）：颜色之外还得有字 ——
        // 一块 24px 宽的色块，光靠蓝/绿/紫分不出「侧室·精英」和「侧室·宝箱关」。
        .text(p.x, p.y, `#${room.order}\n${roleLabel(room)}`, {
          fontFamily: 'monospace',
          fontSize: `${size}px`,
          color: COLORS.text,
          align: 'center',
        })
        .setOrigin(0.5)
        .setDepth(-70)
    }
  }

  return {
    mapper,
    roomRect: (room) => {
      const p = mapper.toScreen(left(room.rect), top(room.rect))
      return { x: p.x, y: p.y, width: room.rect.width * scale, height: room.rect.height * scale }
    },
  }
}

// ---------------------------------------------------------------- 单间 1:1

export interface Room1to1Options {
  /**
   * 要画的世界矩形（**地图坐标**）。由调用方决定框多大、框在哪 ——
   * 见 `roomViewBox`：对称留白对这个场子是错的，框要朝门外长出去。
   */
  box: Rect
  /** 框的左上角要落到屏幕的哪儿 */
  screenX: number
  screenY: number
  scale?: number
  /** 被裁过的墙。传 `wallsNearRoom()` 的结果 */
  walls: readonly Rect[]
  /** 画 D2 的 `navCellSize` 网格（细线）。默认 true */
  grid?: boolean
  /** **叠加 D2 的 40px 可走性判定**：红格 = 这一格中心站不了。默认 true */
  blocked?: boolean
  /** 叠底座的粗网格（只画线，不做判断）。默认 0 = 不画 */
  harnessGridCell?: number
  /** 画门 / 刷怪点 / 标签。默认全开 */
  doors?: boolean
  spawns?: boolean
  labels?: boolean
}

/**
 * 一间教室 1:1 —— 这一层要回答的是**单个格子的对错**，所以不缩放。
 *
 * ⚠️ **它只画，不判。** 红色的堵格读的是 `gridOfMap()`（与校验器、与
 * 将来 D3 的寻路同一份），不是这里现算的。如果这里现算一份，
 * 那「测试场显示课桌挡路」就只是这个文件自己的说法，证明不了任何事。
 */
export function drawRoom1to1(
  scene: Phaser.Scene,
  map: DungeonMap,
  cfg: RoomsConfig,
  room: Room,
  opts: Room1to1Options,
): Mapper {
  const scale = opts.scale ?? 1
  const box = opts.box
  const mapper = mapperFor(box, opts.screenX, opts.screenY, scale)

  const g = scene.add.graphics()
  g.setDepth(-80)

  // 1. 底色 + 连廊
  const p0 = mapper.toScreen(left(box), top(box))
  g.fillStyle(COLORS.outside, 1)
  g.fillRect(p0.x, p0.y, box.width * scale, box.height * scale)
  // 一段段判，不是判「走廊那条带」：取景框里可能落在两间教室之间（一段连廊），
  // 也可能整段错开（一间教室挨着下一间，中间什么都不夹）。
  for (const p of map.passages) {
    if (!rectsIntersect(p.rect, box)) continue
    const c = clipRect(p.rect, box)
    if (c !== null) fillWorldRect(g, mapper, c, COLORS.passage)
  }

  // 2. 房间地面。**框里出现的每一间都要填**，不只是选中的那一间 ——
  //    取景框现在朝门外长出去（见 `roomViewBox`），框里必然带着邻居的一条边。
  //    只填选中的那间，邻居就会是**一块黑**，而黑看起来和「生成器没生成这块地面」
  //    一模一样 —— 那正是这个场子最不该犯的错。
  //    邻居填淡一点：画面得能一眼分出「这是要看的那间」和「这是门外的邻居」。
  for (const other of map.rooms) {
    const c = clipRect(other.rect, box)
    if (c === null) continue
    const color = other.branch === 'main' ? COLORS.mainRoom : COLORS.sideRoom
    fillWorldRect(g, mapper, c, color, other === room ? 1 : 0.45)
  }

  // 3. **D2 的可走性判定**，压在障碍物**下面**：椅子的格子会红，
  //    但椅子本身还看得见 —— 不然红块会把「是谁把这一格堵了」盖掉。
  //
  //    这一遍是**底色**；描边在障碍物之后（第 6 步）。两遍都要，见 `COLORS.blockedEdge`。
  let blockedCells: [number, number][] | null = null
  if (opts.blocked ?? true) {
    // ⚠️ 读的是 `gridOfMap()` —— **和校验器、和将来 D3 的寻路同一份**。
    //    这里现算一份的话，「测试场显示课桌挡路」就只是这个文件自己的说法。
    const grid = gridOfMap(map)
    const cell = grid.cellSize
    const cx0 = Math.max(0, Math.floor((left(box) - grid.originX) / cell))
    const cx1 = Math.min(grid.cols - 1, Math.floor((right(box) - grid.originX) / cell))
    const cy0 = Math.max(0, Math.floor((top(box) - grid.originY) / cell))
    const cy1 = Math.min(grid.rows - 1, Math.floor((bottom(box) - grid.originY) / cell))
    blockedCells = []
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (grid.blocked[cy * grid.cols + cx] !== 1) continue
        const wx = grid.originX + cx * cell
        const wy = grid.originY + cy * cell
        blockedCells.push([wx, wy])
        const p = mapper.toScreen(wx, wy)
        g.fillStyle(COLORS.blockedCell, 0.28)
        g.fillRect(p.x, p.y, cell * scale, cell * scale)
      }
    }
  }

  // 4. 40px 网格线
  if (opts.grid ?? true) {
    g.lineStyle(1, COLORS.grid40, 0.5)
    const cell = cfg.navCellSize
    for (let x = left(box); x <= right(box) + 0.5; x += cell) {
      lineWorld(g, mapper, x, top(box), x, bottom(box))
    }
    for (let y = top(box); y <= bottom(box) + 0.5; y += cell) {
      lineWorld(g, mapper, left(box), y, right(box), y)
    }
  }

  // 5. 障碍物
  for (const o of room.obstacles) {
    fillWorldRect(g, mapper, o.rect, o.kind === 'desk' ? COLORS.desk : COLORS.chair, 0.85)
  }

  // 6. **堵格的描边**，压在障碍物上面。见 `COLORS.blockedEdge` 的注释：
  //    底色那一遍会被桌子盖掉，而桌子正是这一格堵住的原因。
  if (blockedCells !== null) {
    g.lineStyle(1, COLORS.blockedEdge, 0.9)
    for (const [wx, wy] of blockedCells) {
      const p = mapper.toScreen(wx, wy)
      g.strokeRect(p.x + 1, p.y + 1, cfg.navCellSize * scale - 2, cfg.navCellSize * scale - 2)
    }
  }

  // 7. 底座的粗网格。**只画线**：这一层说「两边的格子不一样大」，
  //    至于「底座会怎么判」是底座的事，抄一份过来只会让两边一起烂。
  //    **画在障碍物之后**：它要说的是「格子长这样」，不是「这格里有东西」，
  //    所以它得跨过桌子继续走。
  const hg = opts.harnessGridCell ?? 0
  if (hg > 0) {
    g.lineStyle(1, COLORS.harnessGrid, 0.55)
    for (let x = 0; x <= opts.screenX + box.width * scale; x += hg * scale) {
      if (x < opts.screenX) continue
      g.lineBetween(x, p0.y, x, p0.y + box.height * scale)
    }
    for (let y = 0; y <= opts.screenY + box.height * scale; y += hg * scale) {
      if (y < opts.screenY) continue
      g.lineBetween(p0.x, y, p0.x + box.width * scale, y)
    }
  }

  // 8. 墙。压在障碍物上面：墙永远比桌子更"硬"。
  for (const w of opts.walls) fillWorldRect(g, mapper, w, COLORS.wall)
  for (const w of opts.walls) {
    const p = mapper.toScreen(left(w), top(w))
    g.lineStyle(1, COLORS.wallEdge, 0.7)
    g.strokeRect(p.x, p.y, w.width * scale, w.height * scale)
  }

  // 9. 门
  if (opts.doors ?? true) for (const d of room.doors) drawDoor(g, mapper, d)

  // 10. 刷怪点
  if (opts.spawns ?? true) {
    for (const s of room.spawnPoints) {
      const p = mapper.toScreen(s.x, s.y)
      g.lineStyle(2, COLORS.spawn, 1)
      g.strokeCircle(p.x, p.y, cfg.navCellSize * 0.4 * scale)
      g.fillStyle(COLORS.spawn, 1)
      g.fillCircle(p.x, p.y, 3)
    }
  }

  // 11. 标签
  if (opts.labels ?? true) {
    const at = (wx: number, wy: number, text: string, color: string = COLORS.text): void => {
      const p = mapper.toScreen(wx, wy)
      scene.add
        .text(p.x, p.y, text, { fontFamily: 'monospace', fontSize: '12px', color })
        .setOrigin(0.5)
        .setDepth(-70)
    }
    // 1:1 这一场印的是**中文关别 + 原始 branch**：关别要和场子读数、
    // 和缩略图说得一样（`ROOM_KIND_LABELS` 那一份），而 branch 是代码里的字段名，
    // 对着 `Room` 读代码时用得上。这里本来印的是 `kind` 的**原值** ——
    // 关别表落地后原值有 8 个，中英混排的 `#9 chest (side)` 不如 `#9 宝箱关 (side)`
    // 好读，而原值在场子读数里照样查得到。
    at(room.rect.x, top(room.rect) + cfg.navCellSize, `#${room.order} ${ROOM_KIND_LABELS[room.kind]} (${room.branch})`)

    // 连廊那一段标出来。**不标的话它就是一块比周围亮一点的深色** ——
    // 而这个场子最要紧的一条就是「这扇门外确实有条路」。
    //
    // 只标**整段在框里**的：取景框朝门外长出去一格，框边上常常挂着半段邻居的
    // 连廊；照 `clipRect` 判的话标签会落在框外那片黑上，看起来像「这里标注了一段
    // 不存在的东西」。半段连廊照样画（那是真的），只是不给它贴名字。
    for (const p of map.passages) {
      if (!fullyInside(p.rect, box)) continue
      at(p.rect.x, p.rect.y, `连廊 ${p.between[0]}→${p.between[1]}`, '#c9b483')
    }
    for (const s of room.spawnPoints) {
      const p = mapper.toScreen(s.x, s.y)
      scene.add
        .text(p.x, p.y - cfg.navCellSize * 0.7, 'spawn', {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#ff9ac8',
        })
        .setOrigin(0.5)
        .setDepth(-70)
    }
  }

  return mapper
}