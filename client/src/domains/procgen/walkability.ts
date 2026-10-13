/**
 * 可走性判定。**校验器与运行时共用这一份。** 纯函数，零 Phaser 依赖。
 *
 * ---
 *
 * ## 为什么这个文件必须只有一份
 *
 * 不共用的话有一条**没有任何报错**的失败链：
 *
 * ```
 * 校验器自己写一套判定 → 1000 个种子全绿
 *        ↓
 * 运行时 D3 的 FlowField 用另一套
 *        ↓
 * 某个种子里一张课桌把一个刷怪点封死
 *        ↓
 * 怪出不来 → 玩家打不到 → 房间清不掉 → 门不开
 *        ↓
 * 「不回头」规则下，这一局直接作废
 * ```
 *
 * 全过程中**两边都不会抛异常**，因为两边各自都是自洽的。
 *
 * `FlowField` 的文件头已经把这件事点名了：「可走性由调用方给的 `isWalkable(x, y)`
 * 决定（**墙、障碍、门都归 D2 的房间生成**）」—— 它留了注入口，这里就是往那个口里塞的东西。
 *
 * ## 中心点采样：一格算堵，当且仅当**它的中心**落在障碍里
 *
 * 不能写成「取矩形包围盒、把相交的格子全填上」。那样一格只要**碰到**障碍的边
 * 就算堵，而格子是 40px 的 —— 一堵 40px 厚的墙会连它两侧各一格的空地一起封掉。
 * 症状是「一堵不挨着别的墙的墙把地图切成两半，中间明明留了缝却没人过得去」。
 *
 * 中心点采样的语义是**「这一格的中心能不能站」**，和玩家的直觉一致，
 * 也和 `ArenaBase.makeNav()` 一致（那边注释里写着同一句话）。
 *
 * ## 网格参数从地图数据里读，不由调用方传
 *
 * `buildWalkability(map)` 只收地图。`navCellSize` / `navOrigin` 在 `DungeonMap` 里 ——
 * **让两侧各选一个 `cellSize` 是「共用同一份判定」最容易被破坏的方式**：
 * 函数确实共用了，但喂进去的格子不一样，结果就不一样。
 * 参数进了数据，两侧就物理上不可能选到不同的值。
 */

import type { Door, DungeonMap, Obstacle, Point, Rect } from './model/types'
import { bottom, left, right, top } from './model/rect'

export interface NavGrid {
  cellSize: number
  /** 网格的**最小角**（不是格子中心的偏移 —— 见 `ArenaBase.makeNav` 的 ⚠️） */
  originX: number
  originY: number
  cols: number
  rows: number
  /** 长度 `cols * rows`，1 = 堵 */
  blocked: Uint8Array
}

export interface GridInput {
  walls: readonly Rect[]
  obstacles: readonly Obstacle[]
  cellSize: number
  originX: number
  originY: number
  width: number
  height: number
}

/** 建一张寻路网格。**只看中心点**。 */
export function buildGrid(input: GridInput): NavGrid {
  const { walls, obstacles, cellSize, originX, originY } = input
  const cols = Math.max(1, Math.ceil(input.width / cellSize))
  const rows = Math.max(1, Math.ceil(input.height / cellSize))
  const blocked = new Uint8Array(cols * rows)

  const stamp = (r: Rect): void => {
    // 只枚举与这个矩形包围盒相交的格子 —— 整张图逐格问一遍是 O(格数 × 矩形数)，
    // 15 间房 × 上百个矩形会让生成耗时从毫秒级涨到几十毫秒。
    const cx0 = Math.max(0, Math.floor((left(r) - originX) / cellSize))
    const cx1 = Math.min(cols - 1, Math.floor((right(r) - originX) / cellSize))
    const cy0 = Math.max(0, Math.floor((top(r) - originY) / cellSize))
    const cy1 = Math.min(rows - 1, Math.floor((bottom(r) - originY) / cellSize))
    for (let cy = cy0; cy <= cy1; cy++) {
      const py = originY + (cy + 0.5) * cellSize
      if (py < top(r) || py > bottom(r)) continue
      for (let cx = cx0; cx <= cx1; cx++) {
        const px = originX + (cx + 0.5) * cellSize
        if (px < left(r) || px > right(r)) continue
        blocked[cy * cols + cx] = 1
      }
    }
  }

  for (const w of walls) stamp(w)
  for (const o of obstacles) stamp(o.rect)

  return { cellSize, originX, originY, cols, rows, blocked }
}

/** 一个格子中心的世界坐标。 */
export function cellCenter(grid: NavGrid, cx: number, cy: number): Point {
  return {
    x: grid.originX + (cx + 0.5) * grid.cellSize,
    y: grid.originY + (cy + 0.5) * grid.cellSize,
  }
}

/** 世界坐标落在哪个格子。**不夹取** —— 越界由调用方判。 */
export function cellOf(grid: NavGrid, x: number, y: number): { cx: number; cy: number } {
  return {
    cx: Math.floor((x - grid.originX) / grid.cellSize),
    cy: Math.floor((y - grid.originY) / grid.cellSize),
  }
}

export function insideGrid(grid: NavGrid, cx: number, cy: number): boolean {
  return cx >= 0 && cy >= 0 && cx < grid.cols && cy < grid.rows
}

export function isBlockedCell(grid: NavGrid, cx: number, cy: number): boolean {
  if (!insideGrid(grid, cx, cy)) return true // 界外一律当成堵的
  return grid.blocked[cy * grid.cols + cx] === 1
}

/** 世界坐标能不能站。**这就是要注入给 `FlowField` 的那个函数。** */
export function isWalkableWorld(grid: NavGrid, x: number, y: number): boolean {
  const { cx, cy } = cellOf(grid, x, y)
  return !isBlockedCell(grid, cx, cy)
}

/**
 * 从一张地图建可走性判定。**这是 `FlowField` 与可达性校验共同消费的入口。**
 *
 * D1 的写法：
 *
 * ```ts
 * const walkable = buildWalkability(map)
 * new EnemySystem({ ..., nav: { ...navGridOf(map), isWalkable: walkable } })
 * ```
 */
export function buildWalkability(map: DungeonMap): (x: number, y: number) => boolean {
  const grid = gridOfMap(map)
  return (x, y) => isWalkableWorld(grid, x, y)
}

/**
 * 一扇门的**两侧**：门洞每一格的中心往里退一格 / 往外退一格。
 *
 * 两侧都要，是因为它们各自回答一个不同的问题：
 *
 * - `inside`：`spawns.ts` 的 flood fill 起点（「从门可达」的那个「门」）
 * - `outside`：校验器判「这扇门通不通」（门洞外面那格要是堵的，这扇门就是死的）
 *
 * 抽成共用件是因为**两份实现会算出两个不同的"门在哪"** —— 而那时
 * 出生点从一侧起算、门通不通从另一侧判定，两边都能自圆其说，
 * 合起来却是「怪在门这边、门在那边」。
 *
 * 返回的是**原始格子，不过滤是否可走**：过滤是可走性判定的事，
 * 而「这格本来是堵的」恰恰是调用方要报的错（门被课桌堵住）。
 */
export function doorSideCells(
  grid: NavGrid,
  room: { rect: Rect; doors: readonly Door[] },
  cfg: { navCellSize: number; wallThickness: number; doorWidth: number },
  door: Door,
): { inside: { cx: number; cy: number }[]; outside: { cx: number; cy: number }[] } {
  const cell = cfg.navCellSize
  // 门洞里几格中心：门洞两端落在格边界上（见 `layout.ts` 文件头 ③），
  // 所以中心数 = 宽度 / 格边长，不用四舍五入去猜。
  const count = Math.max(1, Math.round(cfg.doorWidth / cell))

  // 往里是哪边：门在墙上，房间中心一定在门的里侧。
  const inward = door.axis === 'h' ? Math.sign(room.rect.y - door.y) : Math.sign(room.rect.x - door.x)
  const sign = inward === 0 ? 1 : inward

  const alongStart = (door.axis === 'h' ? door.x : door.y) - door.width / 2
  const inside: { cx: number; cy: number }[] = []
  const outside: { cx: number; cy: number }[] = []

  for (let i = 0; i < count; i++) {
    const along = alongStart + cell / 2 + i * cell
    const depthIn = cfg.wallThickness / 2 + cell / 2
    const pt = (depth: number): { cx: number; cy: number } =>
      door.axis === 'h' ? cellOf(grid, along, depth) : cellOf(grid, depth, along)

    inside.push(pt((door.axis === 'h' ? door.y : door.x) + sign * depthIn))
    outside.push(pt((door.axis === 'h' ? door.y : door.x) - sign * depthIn))
  }
  return { inside, outside }
}

/**
 * 网格该盖多大、从哪儿起。**生成器与校验器共用这一个**，所以它们不可能算出
 * 两个不同的 `navOrigin`。
 *
 * 向外留两格余量：地图的包围盒是按墙的中心线算的，而墙本身有厚度 ——
 * 不留余量的话最外圈那几格会被判成"界外"，而界外一律算堵（见 `isBlockedCell`），
 * 症状是**贴着外墙的房间边界少一格可走空间**，莫名其妙地窄一条。
 *
 * ---
 *
 * ## ⚠️ 原点必须**吸附到格的整数倍**上，不能直接用 `bounds - pad`
 *
 * 这一句是整份可走性里最容易漏的一句，而它漏掉的后果**没有任何报错**。
 *
 * 「按格对齐」有两个方向，靠的就是**格心的相位**：
 *
 * ```
 * 格心所在的 x ≡ 原点 + 格边长/2  (mod 格边长)
 * ```
 *
 * 而**房间边界必须落在格心上**（墙以它为中心，正好封掉一格）。
 * 如果 `pad` 之后原点落在半格上，格心的相位就整体挪了半格 ——
 * 于是每一堵墙都恰好骑在格**边界**上，**一格中心都盖不住**：
 * 寻路认为墙两侧都走得通，物理体照样挡着玩家。
 * 症状是「怪穿墙、玩家不穿」，两边都不抛异常。
 *
 * 吸附之后相位是**定死的**（格心恒在 `≡ 格边长/2` 处），不再随包围盒漂移 ——
 * 于是「房间边界落在格心上」变成一条能校验的硬规则（见 `validate/contract.ts`），
 * 而不是一句"看情况"。
 *
 * `rectsIntersect` 那一类判定同理：整格对齐之后，所有坐标都是格边长的整数倍加减半格，
 * 不存在"差一点点算相交还是不算"的浮点纠结。
 */
export function navExtentFor(bounds: Rect, cellSize: number): {
  originX: number
  originY: number
  width: number
  height: number
} {
  const pad = cellSize * 2
  const snapDown = (v: number): number => Math.floor(v / cellSize) * cellSize
  const snapUp = (v: number): number => Math.ceil(v / cellSize) * cellSize

  const originX = snapDown(left(bounds) - pad)
  const originY = snapDown(top(bounds) - pad)
  const farX = snapUp(right(bounds) + pad)
  const farY = snapUp(bottom(bounds) + pad)

  return { originX, originY, width: farX - originX, height: farY - originY }
}

/** 从地图里取网格参数并建格。校验器与 `buildWalkability` 共用。 */
export function gridOfMap(map: DungeonMap): NavGrid {
  const obstacles: Obstacle[] = []
  for (const r of map.rooms) for (const o of r.obstacles) obstacles.push(o)
  const extent = navExtentFor(map.bounds, map.navCellSize)
  return buildGrid({
    walls: map.walls,
    obstacles,
    cellSize: map.navCellSize,
    originX: extent.originX,
    originY: extent.originY,
    width: extent.width,
    height: extent.height,
  })
}