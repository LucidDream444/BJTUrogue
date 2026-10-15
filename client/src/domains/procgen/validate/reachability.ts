/**
 * **可达性**校验，两层。纯函数，零 Phaser 依赖，node 下可直跑。
 *
 * ---
 *
 * ## 两层的分工
 *
 * ```
 * 层 1 · 教室之间：房间图上从起点遍历，每间房都要被走到
 *                + 每一段连廊端到端可走
 *                + 侧室的入口接宿主、出口接主干下一间
 * 层 2 · 教室之内：门 → 每一个出生点；外加「门本身通不通」
 * ```
 *
 * 层 1 里的「每一段连廊」是**一段一段**验的：连廊从「整层唯一的那条走廊」
 * 变成了「夹在两间教室之间的一小段」，数目由 1 变成 N−1，每一段夹着的两间房
 * 宽度、高度、两端门的开法都可能不同，**验过一段不代表另一段也对**。
 *
 * ## 层 2 为什么是**回归网**而不是兜底
 *
 * 出生点是 `gen/spawns.ts` 从「门可达格」里挑的（先摆障碍物、再 flood fill），
 * 所以「出生点被围死」**在构造上不可能发生**。这一层重算同一件事，
 * 抓的是**以后有人把这个顺序改坏**：比如把障碍物的生成挪到出生点之后，
 * 或者换了网格参数。那时这一层会当场红，而不是等玩家来报「怪不出来」。
 *
 * 所以它失败时的信息比它通过的结论更重要 —— 报出**种子、房间序号、出生点坐标**
 * （spec `map-reachability`：「失败时报出种子、房间序号、出生点坐标」）。
 *
 * ## 比 spec 多查的一条：**门本身通不通**
 *
 * spec 只要求「门 → 出生点」。但反过来还有一半：**门自己能不能过**。
 * 一张课桌摆在门洞里（或者紧贴门内侧那一格），flood fill 就从别处起算 ——
 * 于是「出生点可达」可以全绿，而**玩家进不了这间房**。
 * 那是同一场软锁，只是从另一头进的。
 *
 * `doorSideCells` 给出的是**原始格子、不管堵不堵**，所以这里能看出
 * 「门内侧那格是堵的」—— 而 `spawns.ts` 里那格会被直接丢掉，
 * 丢掉一个起点在它的视角下是无声的。
 *
 * 窄口净宽也在这里量：它要网格在手才量得出来，而网格是这一层的输入。
 */

import type { DungeonMap, Door, Passage, Rect, Room } from '../model/types'
import { mainRooms } from '../model/types'
import type { RoomsConfig } from '../config'
import { bottom, doorRect, left, rectsIntersect, right, top } from '../model/rect'
import {
  cellCenter,
  doorSideCells,
  gridOfMap,
  isBlockedCell,
  type NavGrid,
} from '../walkability'
import { MapValidationError, type MapErrorContext } from './errors'

export interface ReachabilityResult {
  /** 层 1：房间图遍历是否走到了每一间 */
  layer1Ok: boolean
  /** 层 2：每扇门都通、每个出生点都从门可达 */
  layer2Ok: boolean
  visitedRooms: number
  roomCount: number
  /**
   * **每一段**连廊的实测净高（px），顺序同 `map.passages`。
   *
   * 单独报出来是因为它与 `Passage.rect.height` **不是一个数**：矩形是含墙的
   * （首版 `corridorRect` 同约定），可走的是里面那一条，差着一层墙厚。
   * 只印矩形高度的话，读到的是 280，而玩家实际能走的是 240 ——
   * 而这两个数在屏幕上并排出现时，看起来像其中一个是错的。
   */
  passageClearWidths: number[]
  /**
   * 实测的**窄口净宽**（px）：由网格量出来的连廊净高，与全层最窄的一扇门，取小。
   * 量出来而不是照配置抄 —— 见下面 `measureNarrowestOpening`。
   */
  narrowestOpeningWidth: number
  problems: string[]
}

/** 从一组起点做 4-邻域 flood fill，返回可达格集合（`cy * cols + cx` 编码）。 */
function floodFill(grid: NavGrid, starts: readonly { cx: number; cy: number }[]): Set<number> {
  const seen = new Set<number>()
  const queue: { cx: number; cy: number }[] = []
  const push = (cx: number, cy: number): void => {
    if (cx < 0 || cy < 0 || cx >= grid.cols || cy >= grid.rows) return
    const key = cy * grid.cols + cx
    if (seen.has(key) || isBlockedCell(grid, cx, cy)) return
    seen.add(key)
    queue.push({ cx, cy })
  }
  for (const s of starts) push(s.cx, s.cy)
  for (let head = 0; head < queue.length; head++) {
    const { cx, cy } = queue[head]!
    push(cx + 1, cy)
    push(cx - 1, cy)
    push(cx, cy + 1)
    push(cx, cy - 1)
  }
  return seen
}

/**
 * 与 `floodFill` 同一件事，但**只许在 `bounds` 里走**。
 *
 * 为什么连廊那一段要限定范围：不限定的话，从西端的门出去可以绕「教室 → 别的门 →
 * 整层楼 → 东端的门」，于是**一段被堵死的连廊也会判绿** —— 因为绕路绕到了。
 * 限在连廊矩形里，走的才是「穿过这一段」本身。
 */
function floodWithin(
  grid: NavGrid,
  starts: readonly { cx: number; cy: number }[],
  bounds: Rect,
): Set<number> {
  const seen = new Set<number>()
  const queue: { cx: number; cy: number }[] = []
  const bx0 = left(bounds)
  const bx1 = right(bounds)
  const by0 = top(bounds)
  const by1 = bottom(bounds)
  const push = (cx: number, cy: number): void => {
    if (cx < 0 || cy < 0 || cx >= grid.cols || cy >= grid.rows) return
    const key = cy * grid.cols + cx
    if (seen.has(key) || isBlockedCell(grid, cx, cy)) return
    const c = cellCenter(grid, cx, cy)
    if (c.x < bx0 || c.x > bx1 || c.y < by0 || c.y > by1) return
    seen.add(key)
    queue.push({ cx, cy })
  }
  for (const s of starts) push(s.cx, s.cy)
  for (let head = 0; head < queue.length; head++) {
    const { cx, cy } = queue[head]!
    push(cx + 1, cy)
    push(cx - 1, cy)
    push(cx, cy + 1)
    push(cx, cy - 1)
  }
  return seen
}

/** 层 1：房间图。边来自门（`toOrder`）。 */
function walkRoomGraph(map: DungeonMap): { visited: Set<number>; problems: string[] } {
  const problems: string[] = []
  const seen = new Set<number>()
  const queue: number[] = [0]
  seen.add(0)

  while (queue.length > 0) {
    const order = queue.shift()!
    const room = map.rooms[order]
    if (room === undefined) continue
    for (const d of room.doors) {
      if (d.toOrder === null) continue // 墙外，不是一条边
      if (seen.has(d.toOrder)) continue
      seen.add(d.toOrder)
      queue.push(d.toOrder)
    }
  }

  for (const room of map.rooms) {
    if (!seen.has(room.order)) {
      problems.push(
        `层 1：房间 #${room.order}（${room.branch}/${room.kind}）从起点走不到 —— ` +
          `它的门通向 [${room.doors.map((d) => d.toOrder).join(', ')}]`,
      )
    }
  }
  return { visited: seen, problems }
}

/** 侧室的入口/出口接对（spec `map-reachability` 层 1 的第二个 Scenario）。 */
function checkSideWiring(map: DungeonMap): string[] {
  const problems: string[] = []
  const mains = mainRooms(map)
  for (const room of map.rooms) {
    if (room.branch !== 'side') continue
    const host = room.anchoredTo
    if (host === null) {
      problems.push(`层 1：侧室 #${room.order} 没记锚点（anchoredTo 是 null）`)
      continue
    }
    const idx = mains.findIndex((m) => m.order === host)
    if (idx < 0) {
      problems.push(`层 1：侧室 #${room.order} 锚在 order ${host}，但主干轴上没有这一间`)
      continue
    }
    const next = mains[idx + 1]
    if (next === undefined) {
      problems.push(`层 1：侧室 #${room.order} 锚在主干最后一间 #${host} 上，没有"下一间"可汇回`)
      continue
    }
    const targets = room.doors.map((d) => d.toOrder)
    if (!targets.includes(host)) {
      problems.push(`层 1：侧室 #${room.order} 的入口没接宿主 #${host}（它有门通向 [${targets.join(', ')}]）`)
    }
    if (!targets.includes(next.order)) {
      problems.push(`层 1：侧室 #${room.order} 的出口没汇回主干下一间 #${next.order}（它有门通向 [${targets.join(', ')}]）`)
    }
  }
  return problems
}

/**
 * 层 1：**每一段**连廊端到端可走（spec `map-reachability` 层 1 的第二个 Scenario）。
 *
 * 首版这里只有一段走廊（贯穿全层），所以「验一次」等于「验全层」。现在连廊是
 * 教室之间的一小段，数目由 1 变成 `N − 1` —— **验过一段不代表另一段也对**，
 * 因为它们各自夹着不同宽度、不同高度的两间房，两端那两扇门又各自开在不同的墙上。
 */
function checkPassagesWalkable(map: DungeonMap, grid: NavGrid, cfg: RoomsConfig): string[] {
  const problems: string[] = []
  const wt = cfg.wallThickness

  for (let i = 0; i < map.passages.length; i++) {
    const p = map.passages[i]!
    const label = `层 1：连廊 #${i}（主干 order ${p.between[0]} ↔ ${p.between[1]}）`

    // 这一段两端的门。只看 `axis: 'v'`：连廊的两端是**竖直隔墙**，
    // 而侧室那两扇 `axis: 'h'` 的门在带的上/下墙上，它们的矩形和连廊矩形
    // 角上会碰上（墙厚 40、各探出 20），混进来会把「东端有没有门」算错。
    const west: { cx: number; cy: number }[] = []
    const east: { cx: number; cy: number }[] = []
    for (const room of map.rooms) {
      for (const d of room.doors) {
        if (d.axis !== 'v') continue
        if (!rectsIntersect(doorRect(d, wt), p.rect)) continue
        // 门心在连廊左边的算西端。**不比较浮点相等**：所有坐标都是整格加减半格，
        // 但从两条不同的式子算出来的同一个数，不该靠 `===` 去认。
        const bucket = d.x <= p.rect.x ? west : east
        for (const c of doorSideCells(grid, room, cfg, d).outside) bucket.push(c)
      }
    }

    if (west.length === 0 || east.length === 0) {
      problems.push(
        `${label} 有一端没有门（西 ${west.length} 扇 / 东 ${east.length} 扇）—— ` +
          `连廊是"教室之间"的连接，两端各要有一扇`,
      )
      continue
    }

    const starts = west.filter((c) => !isBlockedCell(grid, c.cx, c.cy))
    if (starts.length === 0) {
      problems.push(`${label} 西端门外那一格每一格都是堵的 —— 这一段进不去`)
      continue
    }

    const reached = floodWithin(grid, starts, p.rect)
    if (!east.some((c) => reached.has(c.cy * grid.cols + c.cx))) {
      problems.push(`${label} 从西端的门走不到东端的门 —— 这一段连廊是堵死的`)
    }
  }
  return problems
}

/** 一扇门的两侧都得能站人，否则这扇门是死的。 */
function checkDoorPassable(
  grid: NavGrid,
  room: Room,
  cfg: RoomsConfig,
  d: Door,
  index: number,
): string[] {
  const problems: string[] = []
  const { inside, outside } = doorSideCells(grid, room, cfg, d)
  const tag = `#${room.order} 的 doors[${index}]（${d.kind}，通向 ${d.toOrder}）`

  const insideOk = inside.some((c) => !isBlockedCell(grid, c.cx, c.cy))
  if (!insideOk) {
    problems.push(
      `层 2：房间 ${tag} —— 门**内侧**每一格都被挡住了，玩家进了这间房出不去（或进不来）`,
    )
  }
  const outsideOk = outside.some((c) => !isBlockedCell(grid, c.cx, c.cy))
  if (!outsideOk) {
    problems.push(`层 2：房间 ${tag} —— 门**外侧**每一格都被挡住了，这扇门等于砌死了`)
  }
  return problems
}

/** 层 2：对每间房，从它的每一扇门出发 flood fill，要求每个出生点都在里面。 */
function checkSpawnsFromDoors(
  map: DungeonMap,
  grid: NavGrid,
  cfg: RoomsConfig,
): { problems: string[]; spawnsChecked: number } {
  const problems: string[] = []
  let spawnsChecked = 0

  for (const room of map.rooms) {
    const starts: { cx: number; cy: number }[] = []
    for (const d of room.doors) {
      for (const c of doorSideCells(grid, room, cfg, d).inside) {
        if (!isBlockedCell(grid, c.cx, c.cy)) starts.push(c)
      }
    }
    const reachable = floodFill(grid, starts)

    for (const p of room.spawnPoints) {
      spawnsChecked++
      // 出生点自己那一格堵不堵：堵了就是「障碍物盖住了出生点」，
      // 而那是 spec `dungeon-layout` 单列的一个 Scenario，单独报出来更好查。
      const c = {
        cx: Math.floor((p.x - grid.originX) / grid.cellSize),
        cy: Math.floor((p.y - grid.originY) / grid.cellSize),
      }
      if (isBlockedCell(grid, c.cx, c.cy)) {
        problems.push(
          `层 2：房间 #${room.order} 的出生点 (${p.x}, ${p.y}) 被障碍物盖住了 —— ` +
            `怪会卡在桌子里`,
        )
        continue
      }
      if (!reachable.has(c.cy * grid.cols + c.cx)) {
        problems.push(
          `层 2：房间 #${room.order} 的出生点 (${p.x}, ${p.y}) 从门走不到 —— ` +
            `怪出不来 → 玩家打不到 → 房间清不掉 → 「不回头」规则下这一局作废`,
        )
      }
    }
  }
  return { problems, spawnsChecked }
}

/**
 * 实测连廊的**净高**：从连廊中线那一格往上下两侧扩，数连续的格。
 *
 * ⚠️ 起点必须是**中线那一格**，不能「数这一列里最长的一段能站几格」——
 * 主干教室与连廊等高，但教室是整间房、连廊外面还有侧室，
 * 取最长段会量到别的地方去，于是一段被堵死的连廊也会报绿。
 *
 * ⚠️ 光「从中线起、遇堵就停」还不够：**门洞下面没有墙**。
 * 侧室的出口门就开在连廊的中线那一列上（`sideEntranceX` 那套），
 * 于是往上数到连廊北墙时会**穿过门洞走进侧室**，一路数到侧室的北墙 ——
 * 实测报出来是 520（240 的连廊 + 240 的侧室 + 中间那两格门洞），
 * 而这一段连廊的净高就是 240。
 *
 * 所以**还要夹在连廊自己的矩形里**（判定用格心，和 `floodWithin` 同一套口径）。
 * 这些格子确实站得住，但它们**不是这段连廊**：报大了比报小更糟 ——
 * 窄口读数偏大时，一条真过不去的路会看着像通的。
 *
 * ⚠️ 夹的是**里面那一条**，不是整个矩形：`Passage.rect` 含墙（墙骑在它的上下
 * 两条边上、各吃半层），所以可走的是 `rect` 往里各退半个墙厚的那一段 ——
 * 和 `passageClearWidths` 的字段注释里那句话是同一件事。
 * 只夹到矩形边的话，墙上那一格（格心正好落在墙的中线上）会被数进去：
 * 它平时是堵的、恰好在门洞那一列上是通的，于是同一段连廊会量出 240 或 280，
 * **取决于侧室的出口门开在哪一列** —— 一个随种子变的读数。
 */
function measurePassageHeight(grid: NavGrid, cfg: RoomsConfig, p: Passage): number {
  const cx = Math.floor((p.rect.x - grid.originX) / grid.cellSize)
  const midCy = Math.floor((p.rect.y - grid.originY) / grid.cellSize)
  if (isBlockedCell(grid, cx, midCy)) return 0

  const inner0 = top(p.rect) + cfg.wallThickness / 2
  const inner1 = bottom(p.rect) - cfg.wallThickness / 2
  const within = (cy: number): boolean => {
    const c = cellCenter(grid, cx, cy)
    return c.y >= inner0 && c.y <= inner1
  }
  let up = 0
  while (
    midCy - up - 1 >= 0 &&
    !isBlockedCell(grid, cx, midCy - up - 1) &&
    within(midCy - up - 1)
  ) {
    up++
  }
  let down = 0
  while (
    midCy + down + 1 < grid.rows &&
    !isBlockedCell(grid, cx, midCy + down + 1) &&
    within(midCy + down + 1)
  ) {
    down++
  }
  return (up + down + 1) * grid.cellSize
}

/**
 * 全层**最窄的可走净宽**（px）——「最宽的东西过得去」这条约束量出来的那个数。
 *
 * 两个来源取小：
 *
 * - **连廊净高**：网格量出来的。配置写 `mainRoomHeight − wallThickness = 240`
 *   只是意图；真正决定「肉盾过不过得去」的是烘进网格之后剩下的空地，
 *   而两者之间的差额正是墙厚与格对齐会悄悄吃掉的东西。
 * - **每一扇门的门宽**：门是全层最窄的地方。连廊 240 而门 40 的话，
 *   玩家卡在门上，而连廊那边一路绿灯。
 *
 * 首版这里量的是「走廊的可走宽度」，而走廊没有了 —— 约束的对象换成了
 * 全层最窄的这几处（spec `procgen-config-contract` 的尺寸契约表里也是这么写的）。
 */
function measureNarrowestOpening(
  map: DungeonMap,
  passageClearWidths: readonly number[],
): number {
  let narrowest = Infinity
  for (const w of passageClearWidths) narrowest = Math.min(narrowest, w)
  for (const room of map.rooms) {
    for (const d of room.doors) narrowest = Math.min(narrowest, d.width)
  }
  return narrowest === Infinity ? 0 : narrowest
}

export function checkReachability(map: DungeonMap, cfg: RoomsConfig): ReachabilityResult {
  const grid = gridOfMap(map)

  const layer1 = walkRoomGraph(map)
  const sideProblems = checkSideWiring(map)
  const passageProblems = checkPassagesWalkable(map, grid, cfg)

  const problems: string[] = [...layer1.problems, ...sideProblems, ...passageProblems]

  const doorProblems: string[] = []
  for (const room of map.rooms) {
    for (let i = 0; i < room.doors.length; i++) {
      doorProblems.push(...checkDoorPassable(grid, room, cfg, room.doors[i]!, i))
    }
  }

  const spawnResult = checkSpawnsFromDoors(map, grid, cfg)
  problems.push(...doorProblems, ...spawnResult.problems)

  const passageClearWidths = map.passages.map((p) => measurePassageHeight(grid, cfg, p))
  const narrowestOpeningWidth = measureNarrowestOpening(map, passageClearWidths)
  if (narrowestOpeningWidth < cfg.minPassageWidth) {
    problems.push(
      `层 2：实测最窄的窄口只有 ${narrowestOpeningWidth}px < minPassageWidth ${cfg.minPassageWidth}px —— ` +
        `肉盾直径 80px，过不去的窄口会把玩家卡在连廊或门口`,
    )
  }

  return {
    layer1Ok:
      layer1.problems.length === 0 &&
      sideProblems.length === 0 &&
      passageProblems.length === 0,
    layer2Ok: doorProblems.length === 0 && spawnResult.problems.length === 0,
    visitedRooms: layer1.visited.size,
    roomCount: map.rooms.length,
    passageClearWidths,
    narrowestOpeningWidth,
    problems,
  }
}

/**
 * 跑一层楼的校验，**不过就抛**。
 *
 * 批量扫描用它：抛出的错误自带种子，所以「第 837 个种子红了」是一条能复跑的报告，
 * 而不是一句「有些种子不行」。
 */
export function assertReachable(map: DungeonMap, cfg: RoomsConfig): ReachabilityResult {
  const result = checkReachability(map, cfg)
  if (result.problems.length > 0) {
    const context: MapErrorContext = { seed: map.seed }
    // 只报第一条 + 总数：1000 个种子的扫描里，一次几十条同样的话会把
    // 真正有用的第一条冲掉。要看全的就用 `checkReachability`。
    const head = result.problems[0]!
    const more =
      result.problems.length > 1 ? `（另有 ${result.problems.length - 1} 条同类问题）` : ''
    throw new MapValidationError('rooms', `${head}${more}`, context)
  }
  return result
}