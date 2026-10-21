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
 * 这一间永远清不掉，门口的挡板也永远不开
 * ```
 *
 * ★ 改了（v5）：末行的后果 v4 写的是「『不回头』规则下，这一局直接作废」——
 * **「不回头」这条规则随 v5 删了**（`leavesBehind`，见 `roomFlow.ts` 文件头），
 * 今天的落点轻得多：玩家可以丢下这间去打别的，只是那间永远清不掉
 * （与 `validate/reachability.ts` 的 ⚠️、`gen/spawns.ts` 的同一条失败链一致）。
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
 * 从一张地图建可走性判定。
 *
 * ## ⚠️ 这个函数**今天没有生产调用点** —— 别照下面那段猜运行时是怎么接的
 *
 * 2026-10-19 核过（`real-floorplan-layout` 那次 C2 变更的审计）：`grep -rn buildWalkability src/`
 * 的命中是 **0** —— **生产没有，测试也没有**。
 *
 * ⚠️ 我第一版更正说「只被 procgen 自己用（校验器 + 调试渲染）」，**那也错了**：
 * 那两处 import 的是兄弟函数 **`gridOfMap`**（`validate/reachability.ts:50`、
 * `presentation/floorplan.ts:32`），不是这个函数。本模块真正被用的导出是
 * `gridOfMap` / `isBlockedCell` / `cellCenter` / `cellOf` / `doorSideCells`，
 * 消费方 `gen/generate.ts:41`（`buildGrid` / `navExtentFor`）、`gen/spawns.ts:31`、
 * 那两个校验/渲染文件和两个测试 —— **全是 D2 内部**。
 *
 * **运行时的 `isWalkable` 走的是 D1 自己的路**：`combat/CombatSession.ts` 把
 * `(x, y) => this.terrain.isWalkable(x, y, largestEnemyRadius)` 交给 `EnemyBridge`，
 * 而 `TerrainMap` 读的是 `combat.json` 的 `terrain` 数字与 **D1 从 `StageLayout.solids`
 * 传进来**的那一份。
 *
 * ⚠️⚠️ **但那份 `StageLayout` 不是本域生成器产出的那一份**：`BattleScene.ts:770`
 * 无条件 `applyPaintedRooms(...)`，`PaintedRooms.ts:119` 把每关的 `solids` 换成
 * `stage-collisions.json` 的贴图模板 + 按 `doorTargets` 长度摆的 `gates`，
 * `:167` 连整份 `stages` 一起换掉。**也就是说：本域算出来的墙、门与 `seals`
 * 今天一行都到不了怪的寻路** —— 想让整层对怪可走，要么 D1 不再替换几何，
 * 要么把平面图喂进他的模板那一侧。**不是这里。**
 *
 * 下面这段是**设想的接法**（一度被当成既成事实写进了注释、通知稿和测试文件头），
 * 不是既有代码 —— 谁要真接，得 D1 先点头，因为那会换掉 `TerrainMap` 这条通道。
 *
 * ```ts
 * // 设想：D1 侧改成
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
  cfg: { navCellSize: number; wallThickness: number },
  door: Door,
): { inside: { cx: number; cy: number }[]; outside: { cx: number; cy: number }[] } {
  const cell = cfg.navCellSize
  // 门洞里几格中心：门洞两端落在格边界上，所以中心数 = 宽度 / 格边长，
  // 不用四舍五入去猜。
  //
  // ★ 改了（v5）：宽度读**门自己的** `door.width`，不再读配置表的 `doorWidth`。
  // 配置表那份是「标准门宽」，而门洞的实际宽度写在 `floor-plan.json` 里 ——
  // 两边不一致时（比如有人改门宽只改了配置表），照配置表数会**数错格子**：
  // 门洞是 5 格而这里只扫 3 格，于是 flood fill 的起点漏掉两格、
  // 「门通不通」只检查了一部分。**两边都不报错**，只是有些门看着通、实际没人过得去。
  // 读门自己的宽度之后，「这里到底几格」只有一个真值来源。
  const count = Math.max(1, Math.round(door.width / cell))

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
 * 向外留两格余量：**平面图上没被任何空间占用的格子全是墙**（`layout.ts` 的
 * `buildWallRects`），而贴着地图边沿的房间与走廊（`C_W` 就在 x = 0 那一列上）
 * 之外**没有格子**了 —— 不留余量的话那片「墙」就是网格的边界外沿，
 * 而界外一律算堵（见 `isBlockedCell`）。界内界外都是堵，看似等价，其实不然：
 * 向外铺的这 2 格是**真的墙矩形**，D1 拿它建物理体，玩家撞得到；
 * 只靠「界外算堵」的话寻路认为走不出去，而物理体不存在 —— **玩家直接走出地图**。
 *
 * ---
 *
 * ## ⚠️ 原点必须**吸附到格的整数倍**上，不能直接用 `bounds - pad`
 *
 * 这一句是整份可走性里最容易漏的一句，而它漏掉的后果**没有任何报错**。
 *
 * 「按格对齐」靠的是**格心的相位**：
 *
 * ```
 * 格心所在的 x ≡ 原点 + 格边长/2  (mod 格边长)
 * ```
 *
 * 而 `layout.ts` 是**按格号**铺墙的（第 n 格就是 `原点 + n × 格边长` 那一片）。
 * 原点落在半格上的话，格心的相位整体挪半格 —— 于是每一堵墙都恰好骑在格**边界**上，
 * **一格中心都盖不住**：寻路认为墙两侧都走得通，物理体照样挡着玩家。
 * 症状是「怪穿墙、玩家不穿」，两边都不抛异常。
 *
 * 吸附之后相位是**定死的**（格心恒在 `≡ 格边长/2` 处），不再随包围盒漂移，
 * 于是「矩形边界落在格边界上」变成一条能校验的硬规则（`validate/contract.ts` 里
 * 按 `floor-plan.json` 的整数格核），而不是一句"看情况"。
 *
 * ⚠️ **v5 换了方向**：v4 要求「房间边界落在格**中心**」（墙以边界为中心、正好封掉一格），
 * v5 要求「空间边界落在格**边界**」（墙是**隔壁那一格**）。
 * 两条都靠这一个吸附函数成立，但拿旧那条去核新的图会把对的判成坏的 ——
 * 见 `model/types.ts` 文件头「对齐」那一节。
 *
 * `rectsIntersect` 那一类判定同理：整格对齐之后，所有坐标都是格边长的整数倍，
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