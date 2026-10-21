/**
 * **可达性**校验，两层。纯函数，零 Phaser 依赖，node 下可直跑。
 *
 * ---
 *
 * ## 两层的分工
 *
 * ```
 * 层 1 · 空间之间：从楼梯间在**网格上**走一遍，每一间房都要进得去、
 *                每一段走廊的每一格都要走得到
 * 层 2 · 教室之内：门的两侧都要站得住人；每个刷怪点都要从门走得到；
 *                外加实测「全层最窄的窄口」够不够宽
 * ```
 *
 * ## ★ v5：层 1 从「房间图」换成「网格上的世界」
 *
 * v4 的层 1 走的是一张**抽象房间图**：边来自 `Door.toOrder`，
 * 再加上「侧室入口接宿主、出口接主干下一间」这条接线检查。
 * 那两样在 v5 里都没有了 —— `toOrder` 随有向门一起作废，侧室不存在了。
 *
 * 更关键的是：v4 那张图**漏掉了走廊内部**。它只问「房间之间连不连得通」，
 * 而 v5 的走廊是一张**网**（6 段拼成 S 形，段与段直接相接、不隔墙）——
 * 「网里有没有一段是断的」在房间图上根本问不出来。
 * 所以 v5 直接在**烘好的可走性网格**上从楼梯间 flood 一遍：
 * 它是运行时唯一真的会发生的走法（`walkability.ts` 就是往 D3 的 `FlowField`
 * 里注的那份判定），问出来的答案不依赖任何关于「走廊长什么样」的假设。
 *
 * ## ★ v5：`checkPassagesWalkable` 的判据整个换掉了（2026-10-20）
 *
 * v4 那一条是「**每一段连廊的两端各要有一扇门**」—— 它成立的前提是
 * 「连廊是夹在两间教室之间的一小段」，所以两端一定是竖直隔墙上的门。
 *
 * v5 的这个前提没了：走廊段可以直接接在另一段走廊上（`C_W` 的东端就是 `C_J`，
 * 中间既没有墙也没有门）。照旧判据走，「每一段的两端都要有门」会把
 * `C_J` / `C_M` / `C_S` 这些**中段的走廊**全判成错。
 *
 * 换掉的判据是**更强的一条**：**这一段走廊里每一个能站的格子，都要从楼梯间走得到**。
 * 「两端」这个说法在网里本来就不成立（一段走廊可能有三条去处），
 * 而逐格问「走不走得到」不需要先定义「端」在哪儿。
 * 它顺带把原来那半条「端到端可走」也盖住了：两端都走得到 ⟹ 中间也走得到。
 *
 * ⚠️ 走廊段**互相重叠是允许的**（它们是同一条走廊），所以判据里不能出现
 * 「两个矩形不许相交」那种话 —— 见 `validate/contract.ts` 里那一节的 ⚠️。
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

import type { DungeonMap, Door, Passage, Room } from '../model/types'
import type { RoomsConfig } from '../config'
import { bottom, left, right, top } from '../model/rect'
import {
  cellCenter,
  cellOf,
  doorSideCells,
  gridOfMap,
  isBlockedCell,
  type NavGrid,
} from '../walkability'
import { MapValidationError, type MapErrorContext } from './errors'

/** 一个格子（`cy * cols + cx` 编码）。 */
type Cell = { cx: number; cy: number }

export interface ReachabilityResult {
  /** 层 1：从楼梯间出发，每一间房、每一段走廊都走得到 */
  layer1Ok: boolean
  /** 层 2：每扇门都通、每个出生点都从门可达、窄口够宽 */
  layer2Ok: boolean
  /** 层 1 里至少有一格可走、且从楼梯间走得到的房间数 */
  visitedRooms: number
  roomCount: number
  /**
   * **每一段**走廊的实测净宽（px），顺序同 `map.passages`。
   *
   * 「净宽」量的是**短边**：走廊段横着竖着都有（`C_W` 是 119×6 格，
   * `C_S` 是 6×22 格），量长边量出来的是它的**长度**。v4 只量竖直方向，
   * 因为那时连廊一律是横向的一小段；v5 的 S 形里有 `C_S` 那样的竖段，
   * 照旧量法会报出 880 —— 而 `C_S` 的净宽就是 240。
   * ⚠️ 报大了比报小更糟：窄口读数偏大时，一条真过不去的路会看着像通的。
   */
  passageClearWidths: number[]
  /**
   * 实测的**窄口净宽**（px）：由网格量出来的走廊净宽，与全层最窄的一扇门，取小。
   * 量出来而不是照配置抄 —— 见下面 `measureNarrowestOpening`。
   */
  narrowestOpeningWidth: number
  problems: string[]
}

/** 从一组起点做 4-邻域 flood fill，返回可达格集合（`cy * cols + cx` 编码）。 */
function floodFill(grid: NavGrid, starts: readonly Cell[]): Set<number> {
  const seen = new Set<number>()
  const queue: Cell[] = []
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
 * 一个**空间矩形**盖住的格子。
 *
 * 右/下边界用 `- 1` 换成**闭区间**再取格：`right(rect)` 落在格边界上，
 * 直接拿它 `cellOf` 会落到隔壁那一格 —— 而那一格是墙。
 * （`gen/spawns.ts` 的 `interiorCells` 是同一件事的更细一版，那边还要按格心收紧。）
 */
function cellsOfRect(grid: NavGrid, rect: { x: number; y: number; width: number; height: number }): Cell[] {
  const a = cellOf(grid, left(rect), top(rect))
  const b = cellOf(grid, right(rect) - 1, bottom(rect) - 1)
  const out: Cell[] = []
  for (let cy = a.cy; cy <= b.cy; cy++) {
    for (let cx = a.cx; cx <= b.cx; cx++) out.push({ cx, cy })
  }
  return out
}

/**
 * 层 1：从楼梯间在网格上 flood 一遍。
 *
 * 起点是**楼梯间里能站的每一格**（`rooms[0]`），也就是玩家出生后脚下那一块 ——
 * 不从「楼梯间的门」出发：那样量的是「门通不通」，而门通不通是层 2 在问的事，
 * 这里问的是「从玩家站的地方出发，这一层能走到哪儿」。
 */
function walkFromStairwell(
  map: DungeonMap,
  grid: NavGrid,
): { visited: Set<number>; visitedRooms: number; problems: string[] } {
  const problems: string[] = []
  const entry = map.rooms[0]
  if (entry === undefined) {
    return { visited: new Set(), visitedRooms: 0, problems: ['层 1：这一层一间房都没有'] }
  }

  const starts = cellsOfRect(grid, entry.rect).filter((c) => !isBlockedCell(grid, c.cx, c.cy))
  if (starts.length === 0) {
    problems.push(
      `层 1：楼梯间「${entry.id}」里一格能站的都没有 —— 出生点没有落脚的地方`,
    )
  }
  const visited = floodFill(grid, starts)

  // ---- 每一间房至少有一格走得到
  let visitedRooms = 0
  for (const room of map.rooms) {
    const any = cellsOfRect(grid, room.rect).some((c) => visited.has(c.cy * grid.cols + c.cx))
    if (any) {
      visitedRooms++
      continue
    }
    problems.push(
      `层 1：房间 #${room.order}（${room.id} / ${room.kind}）从楼梯间走不到 —— ` +
        `它的门通向 [${room.doors.map((d) => (d.a === room.id ? d.b : d.a)).join(', ') || '（一扇门都没有）'}]，` +
        `而这些空间要么不通、要么那一整片被墙围死了`,
    )
  }

  // ---- 每一段走廊的**每一格**都要走得到（见文件头：这是 v5 换掉的那条判据）
  for (const p of map.passages) {
    const cells = cellsOfRect(grid, p.rect)
    const walkable = cells.filter((c) => !isBlockedCell(grid, c.cx, c.cy))
    const missed = walkable.filter((c) => !visited.has(c.cy * grid.cols + c.cx))
    if (missed.length > 0) {
      problems.push(
        `层 1：走廊「${p.id}」有 ${missed.length}/${walkable.length} 格从楼梯间走不到` +
          `（第一格在 (${cellCenter(grid, missed[0]!.cx, missed[0]!.cy).x}, ` +
          `${cellCenter(grid, missed[0]!.cx, missed[0]!.cy).y})）—— ` +
          `走廊是一张**网**，每一段都要通到楼梯间；` +
          `这一段被墙围住了，或者它与相邻那几段之间的口子没接上`,
      )
    }
  }

  return { visited, visitedRooms, problems }
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
  // 另一端叫什么名字：`a` / `b` 是字典序排好的，所以不能靠「取 a」——
  // `'C_W' < 'YF601'` 但 `'C_W' > 'STAIR'`，同一个写法在两条数据上给出不同的答案。
  const other = d.a === room.id ? d.b : d.a
  const tag = `#${room.order}（${room.id}）的 doors[${index}]（${d.axis}，通向 ${other}）`

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
    const starts: Cell[] = []
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
      const c = cellOf(grid, p.x, p.y)
      if (isBlockedCell(grid, c.cx, c.cy)) {
        problems.push(
          `层 2：房间 #${room.order}（${room.id}）的出生点 (${p.x}, ${p.y}) 被障碍物盖住了 —— ` +
            `怪会卡在桌子里`,
        )
        continue
      }
      if (!reachable.has(c.cy * grid.cols + c.cx)) {
        // ⚠️ v5 里这条的后果**不再是**「一局作废」：玩家可以丢下这间去打别的
        //（用户 2026-10-19：随意在走廊走、随意挑房间进）。但那个房间永远清不掉，
        // 门口的挡板（如果 D1 按 `spawnPoints.length > 0` 判它在战斗里）也永远不开。
        problems.push(
          `层 2：房间 #${room.order}（${room.id}）的出生点 (${p.x}, ${p.y}) 从门走不到 —— ` +
            `怪出不来 → 玩家打不到 → 这间房永远清不掉、门口的挡板永远不开`,
        )
      }
    }
  }
  return { problems, spawnsChecked }
}

/**
 * 实测一段走廊的**净宽**（px）：从短边中线那一格往两侧扩，数连续的格。
 *
 * ⚠️ 起点必须是**中线那一格**，不能「数这一列里最长的一段能站几格」——
 * 走廊外面还有房间，取最长段会量到别的地方去，于是一段被堵死的走廊也会报绿。
 *
 * ⚠️ 光「从中线起、遇堵就停」还不够：**门洞下面没有墙**。走廊与房间之间那 1 格
 * 墙在门洞那一列上是空的，于是往上数会**穿过门洞走进房间**，一路数到房间的另一头
 * —— 实测报出来是「走廊 + 门 + 房间」的和，而那一段的净宽没变。
 *
 * 所以**还要夹在走廊自己的矩形里**（判定用格心）。这些格子确实站得住，
 * 但它们**不是这段走廊**：报大了比报小更糟 —— 窄口读数偏大时，
 * 一条真过不去的路会看着像通的。
 *
 * ★ 改了（v5）：夹的范围就是 `p.rect` **本身**，不再往里退半个墙厚。
 * v4 的 `Passage.rect` 含墙（墙骑在上下两条边上、各吃半层），所以那时要退；
 * v5 的矩形**就是可走的那一片**，再退 20px 会把最外圈那两格算漏（差一格 = 差 40px），
 * 而它不报错 —— 只是读数偏小，于是「够不够宽」这条判定变得保守。
 * 今天不退也仍然对：墙那两格的**格心落在矩形外面**，本来就夹得掉。
 */
function measurePassageClearWidth(grid: NavGrid, p: Passage): number {
  // 短边才是净宽。竖着的走廊（`C_S`）量竖直方向量出来的是它的长度。
  const vertical = p.rect.height <= p.rect.width
  const midX = Math.floor((p.rect.x - grid.originX) / grid.cellSize)
  const midY = Math.floor((p.rect.y - grid.originY) / grid.cellSize)

  const within = (c: Cell): boolean => {
    const center = cellCenter(grid, c.cx, c.cy)
    return (
      center.x >= left(p.rect) &&
      center.x <= right(p.rect) &&
      center.y >= top(p.rect) &&
      center.y <= bottom(p.rect)
    )
  }
  const open = (c: Cell): boolean => !isBlockedCell(grid, c.cx, c.cy) && within(c)

  if (!open({ cx: midX, cy: midY })) return 0

  const step = (sign: number): number => {
    let n = 0
    for (;;) {
      const c: Cell = vertical
        ? { cx: midX, cy: midY + sign * (n + 1) }
        : { cx: midX + sign * (n + 1), cy: midY }
      if (c.cx < 0 || c.cy < 0 || c.cx >= grid.cols || c.cy >= grid.rows) break
      if (!open(c)) break
      n++
    }
    return n
  }

  return (step(1) + step(-1) + 1) * grid.cellSize
}

/**
 * 全层**最窄的可走净宽**（px）——「最宽的东西过得去」这条约束量出来的那个数。
 *
 * 两个来源取小：
 *
 * - **走廊净宽**：网格量出来的。真正决定「肉盾过不过得去」的是烘进网格之后
 *   剩下的空地，而那和「平面图上写了 6 格」之间的差额正是墙与格对齐悄悄吃掉的东西。
 * - **每一扇门的门宽**：门是全层最窄的地方。走廊 240 而门 40 的话，
 *   玩家卡在门上，而走廊那边一路绿灯。
 *
 * ⚠️ 门宽读的是**门自己的** `width`，不是配置表的 `doorWidth` ——
 * 门洞的实际宽度写在 `floor-plan.json` 里，两边不一致时照配置抄会量出一个
 * 这层楼里根本不存在的数。
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

  const walk = walkFromStairwell(map, grid)

  const doorProblems: string[] = []
  for (const room of map.rooms) {
    for (let i = 0; i < room.doors.length; i++) {
      doorProblems.push(...checkDoorPassable(grid, room, cfg, room.doors[i]!, i))
    }
  }

  const spawnResult = checkSpawnsFromDoors(map, grid, cfg)

  const passageClearWidths = map.passages.map((p) => measurePassageClearWidth(grid, p))
  const narrowestOpeningWidth = measureNarrowestOpening(map, passageClearWidths)
  const narrowProblems: string[] = []
  if (narrowestOpeningWidth < cfg.minPassageWidth) {
    narrowProblems.push(
      `层 2：实测最窄的窄口只有 ${narrowestOpeningWidth}px < minPassageWidth ${cfg.minPassageWidth}px —— ` +
        `肉盾直径 80px，过不去的窄口会把玩家卡在走廊或门口`,
    )
  }

  const problems: string[] = [...walk.problems, ...doorProblems, ...spawnResult.problems, ...narrowProblems]

  return {
    layer1Ok: walk.problems.length === 0,
    layer2Ok:
      doorProblems.length === 0 && spawnResult.problems.length === 0 && narrowProblems.length === 0,
    visitedRooms: walk.visitedRooms,
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