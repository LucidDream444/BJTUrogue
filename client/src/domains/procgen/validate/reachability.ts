/**
 * **可达性**校验，两层。纯函数，零 Phaser 依赖，node 下可直跑。
 *
 * ---
 *
 * ## 两层的分工
 *
 * ```
 * 层 1 · 教室之间：房间图上从起点遍历，每间房都要被走到
 *                + 侧室的入口接宿主、出口接主干下一间
 * 层 2 · 教室之内：门 → 每一个出生点；外加「门本身通不通」
 * ```
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
 * 走廊实测宽度也在这里量：它要网格在手才量得出来，而网格是这一层的输入。
 */

import type { DungeonMap, Door, Room } from '../model/types'
import { mainRooms } from '../model/types'
import type { RoomsConfig } from '../config'
import { doorSideCells, gridOfMap, isBlockedCell, type NavGrid } from '../walkability'
import { MapValidationError, type MapErrorContext } from './errors'

export interface ReachabilityResult {
  /** 层 1：房间图遍历是否走到了每一间 */
  layer1Ok: boolean
  /** 层 2：每扇门都通、每个出生点都从门可达 */
  layer2Ok: boolean
  visitedRooms: number
  roomCount: number
  /** 实测的走廊可走宽度（px），由网格量出来，不是照配置抄的 */
  corridorWalkableWidth: number
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
 * 实测走廊的可走宽度：**从走廊中心线那一格往上下两侧扩，数连续的格**。
 *
 * **量出来而不是照配置抄** —— 配置写 `corridorMinWidth: 120` 只是意图；
 * 真正决定「肉盾过不过得去」的是烘进网格之后剩下的空地，
 * 而两者之间的差额正是墙厚与格对齐会悄悄吃掉的东西。
 *
 * ⚠️ 起点必须是**走廊中心线那一格**，不能「数这一列里最长的一段能站几格」——
 * 房间在竖直方向上也比走廊高（最高档教室 320px 的内部 vs 走廊 160px），
 * 取最长段会量到房间上去，于是一条被墙堵死的走廊也会报绿。
 */
function measureCorridor(grid: NavGrid, map: DungeonMap): number {
  const cx = Math.floor((map.corridorRect.x - grid.originX) / grid.cellSize)
  const midCy = Math.floor((map.corridorRect.y - grid.originY) / grid.cellSize)
  if (isBlockedCell(grid, cx, midCy)) return 0

  let up = 0
  while (midCy - up - 1 >= 0 && !isBlockedCell(grid, cx, midCy - up - 1)) up++
  let down = 0
  while (midCy + down + 1 < grid.rows && !isBlockedCell(grid, cx, midCy + down + 1)) down++
  return (up + down + 1) * grid.cellSize
}

export function checkReachability(map: DungeonMap, cfg: RoomsConfig): ReachabilityResult {
  const grid = gridOfMap(map)

  const layer1 = walkRoomGraph(map)
  const sideProblems = checkSideWiring(map)

  const problems: string[] = [...layer1.problems, ...sideProblems]

  const doorProblems: string[] = []
  for (const room of map.rooms) {
    for (let i = 0; i < room.doors.length; i++) {
      doorProblems.push(...checkDoorPassable(grid, room, cfg, room.doors[i]!, i))
    }
  }

  const spawnResult = checkSpawnsFromDoors(map, grid, cfg)
  problems.push(...doorProblems, ...spawnResult.problems)

  const corridorWalkableWidth = measureCorridor(grid, map)
  if (corridorWalkableWidth < cfg.corridorMinWidth) {
    problems.push(
      `层 2：走廊实测可走宽度 ${corridorWalkableWidth}px < corridorMinWidth ${cfg.corridorMinWidth}px —— ` +
        `肉盾直径 80px，过不去的走廊会把玩家卡在主干道上`,
    )
  }

  return {
    layer1Ok: layer1.problems.length === 0 && sideProblems.length === 0,
    layer2Ok: doorProblems.length === 0 && spawnResult.problems.length === 0,
    visitedRooms: layer1.visited.size,
    roomCount: map.rooms.length,
    corridorWalkableWidth,
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