/**
 * 把**画好的几何**（`floor-plan.json`）变成一张可用的 `DungeonMap` 骨架：
 * 关别、威胁预算、墙、门挂在谁身上。
 *
 * **纯函数，零 Phaser 依赖**，同一个 `seed` + 同一份配置 → 逐字节相同的地图。
 *
 * ---
 *
 * ## 这个文件以前是 650 行，因为它在**算**几何
 *
 * v4 及以前，房间在哪、多大、门开在哪儿全是这里算出来的：主干教室一排、
 * 连廊串起来、侧室挂在两侧、尺寸档位按种子抽、墙按「房间的边减去门洞」拼。
 * 于是「这一层长什么样」是**代码的产物** —— 改一个数要看懂四段几何推导，
 * 而且换种子就换一张图，出问题时无法说「地图长错了」还是「种子不同」。
 *
 * v5 反过来：几何在 `floor-plan.json` 里**画好**（照 6F 平面图照片量的），
 * 这里只做「往几何里填内容」。**删掉的**：主干/侧室的分档、锚点挑选、
 * 尺寸档位、`roomGap` 让步、按边拼墙、`boundsOf`（它已经搬去 `floorPlan.ts`）。
 *
 * ## 三件事，顺序不能换
 *
 * ```
 * 1. 关别      YF604 恒为 boss、两间教休室恒为 reward、其余 12 间按权重抽
 * 2. 预算      按「到楼梯间的跳数」定强弱 —— 关别先定，因为非战斗关的钱恒为 0
 * 3. 墙 + 门   几何，与种子无关，换一百个种子一模一样
 * ```
 *
 * 1 在 2 前是必须的：`maxDist` 只在**战斗关**里取最大值，而「哪几间是战斗关」
 * 要等关别定下来才知道。
 *
 * ## 关别是**发牌**，不是 12 次独立抽签
 *
 * 独立抽有个只在部分种子里出现的坏结果：权重 `{main:4, elite:2, reward:2, chest:2}`
 * 下，12 次独立抽抽出一整层 10 间道具房的概率虽然不高，但它**会发生** ——
 * 而那时这一局没有仗可打，且**不报错、不抛异常**，看上去只是"这局运气不好"。
 *
 * 所以先把权重按最大余数法折成一副**正好 12 张的牌**，再洗牌发下去：
 * 比例每次都精确成立，种子里剩下的随机性只体现在「哪一间是哪一类」
 * —— 那才是玩家真正能感觉到的随机。
 *
 * ## 预算是**跳数**，不是房间序号
 *
 * v4 用 `主干序号 ÷ 主干数`，因为那时房间排在一条进度轴上。v5 里玩家
 * 随意挑房间进（用户 2026-10-19），**`order` 大不代表更深** —— 它是
 * 「楼梯间 + 其余按 id 升序」的下标，跟难度无关。
 * 取而代之的量是**到楼梯间的 BFS 跳数**：离出生点越远越强，
 * 而「远」在一张真实的平面图上是有意义的。
 *
 * ## 墙 = 平面图上**没被任何空间占用的格子**，减去门洞
 *
 * 这是 v5 最反直觉、也最容易改坏的一条，所以逐条说：
 *
 * - **为什么不是「房间的边」**：`buildGrid` 只把「墙 + 障碍物」标成不可走，
 *   其余一律可走。所以「不是空间的地方」必须**每一格都在 `walls` 里**。
 *   平面图上省略掉了电梯、卫生间、另外 5 处楼梯间 —— 它们落成**整块的实心区**
 *   （YF601 与 YF602 之间就有 22 格宽的一块）。按「房间的边」拼墙的话，
 *   那些块一格都不是墙，玩家能从中间穿过去，而它们在缩略图上看跟墙一模一样。
 *   **不报错，只是能穿墙。**
 * - **为什么要向外多铺 2 格**：`navExtentFor` 给的就是这个余量。不铺的话，
 *   贴着地图边缘的 `C_W`（x = 0 那一列）会开在网格外沿上，
 *   而界外一律算堵 —— 玩家一步走出地图，或者走廊被削掉一格。
 * - **为什么用贪心矩形合并而不是一格一个矩形**：一格一个矩形是 ~2 万个 Rect，
 *   每个都要进物理体、进 `zones`、进缩略图。合并之后是几百个，
 *   而合并本身只是把「同一片实心区」拼成若干大矩形，画的还是同一片区域。
 */
import type { Door, Passage, Rect, Room, RoomKind } from '../model/types'
import type { RoomsConfig } from '../config'
import { isCombatKind } from '../config'
import type { FloorPlan, FloorPlanSpace } from './floorPlan'
import { navExtentFor } from '../walkability'
import { rngFor } from './seed'
import { threatBudget } from './budget'

/**
 * 一张排好内容、但还没摆障碍物与刷怪点的地图骨架。
 *
 * `rooms` 里的 `obstacles` / `spawnPoints` 一律是空数组 —— 它们在
 * `gen/generate.ts` 的第 2、4 步才填。**这不是"忘了"，是顺序本身**：
 * 障碍物要先摆完才能烘网格，刷怪点要看着网格才能挑。
 */
export interface LayoutPlan {
  readonly rooms: readonly Room[]
  readonly passages: readonly Passage[]
  readonly walls: readonly Rect[]
  /** 全部房间与走廊的并集（px、中心点）。**不含向外那 2 格**，见文件头 */
  readonly bounds: Rect
}

// ---------------------------------------------------------------- 1. 关别

/**
 * 把权重表折成一副**正好 `count` 张**的牌。
 *
 * 最大余数法（largest remainder / 汉密尔顿法）：
 * `count × 权重 ÷ 总权重` 取整，剩下的名额按小数部分从大到小补。
 *
 * **平局按权重表里的书写顺序**打破，不是随便挑一个 —— 挑法进了结果，
 * 而结果要可复现。`Object.entries` 对非数字键保持插入顺序，
 * 所以「谁写在前面」是这里唯一能依赖的稳定顺序。
 */
export function kindBag(weights: Readonly<Partial<Record<RoomKind, number>>>, count: number): RoomKind[] {
  const entries = Object.entries(weights) as [RoomKind, number][]
  if (count <= 0 || entries.length === 0) return []

  let total = 0
  for (const [, w] of entries) total += w
  if (!(total > 0)) return []

  const exact = entries.map(([, w]) => (count * w) / total)
  const taken = exact.map((v) => Math.floor(v))
  let left = count - taken.reduce((a, b) => a + b, 0)

  // 按「小数部分降序、同分按书写顺序升序」补名额
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => (b.frac - a.frac) || (a.i - b.i))
  for (const { i } of order) {
    if (left <= 0) break
    // 权重恰为 0 的类目**不补名额** —— 补了等于把一个明确的「这一类不要」
    // 变成「偶尔来一个」，而配置表里写 0 的人想要的正是前者
    if (entries[i]![1] <= 0) continue
    taken[i]!++
    left--
  }

  const bag: RoomKind[] = []
  entries.forEach(([kind], i) => {
    for (let n = 0; n < taken[i]!; n++) bag.push(kind)
  })
  return bag
}

/**
 * 给每一间房定关别。**三层，先写死的、再发牌的**：
 *
 * 1. 楼梯间恒为 `start`（它不按种子抽，`floor-plan.json` 里没有 `fixed` 字段）
 * 2. `plan.rooms` 里 `fixed !== null` 的照抄（`YF604` 恒 `boss`、
 *    两间教休室恒 `reward`）—— 用户的原始要求就是这一条
 * 3. 其余 12 间按这副牌发
 *
 * **固定关别不占牌**：牌正好发 12 张（`classroomCount` 15 − 3 间固定）。
 *
 * 发牌顺序是**按 id 升序**，不是配置表里的书写顺序。配置表把 `YF604`（固定）
 * 写在第一条只是为了好读；拿书写顺序发牌的话，以后把 `YF604` 挪到表尾
 * 会让整层 12 间房的关别**全部换一遍** —— 一个纯编辑动作改变了种子语义。
 *
 * ⚠️ **2026-10-20 修掉一个静默的漏**：第一版只写了第 1、3 层 ——
 * `fixed` 那几间**根本没进这张表**，于是 `planLayout` 那边
 * `kinds.get(id) ?? 'main'` 把它们全部兜成 `main`。
 * 症状是**没有任何报错**，而「604 是首领关」这条要求当场不成立：
 * 那一层没有首领、`threatBudget` 按普通关算、打完首领下楼也就无从谈起。
 * 兜底那个 `?? 'main'` 不能删（它防的是**权重表把牌发少了**这种数据错），
 * 所以第 2 层必须显式写出来 —— 两件事长得像，但一个是「配置表说死了」，
 * 一个是「配置表坏了」，兜底只该管后者。
 */
export function assignKinds(seed: number, cfg: RoomsConfig, plan: FloorPlan): Map<string, RoomKind> {
  const drawable = plan.rooms
    .filter((r) => r.fixed === null)
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const bag = kindBag(cfg.roomKindWeights, drawable.length)
  const rng = rngFor(seed, 'roomKind', 0)
  // Fisher-Yates。**倒着走**：正着走时每一轮的可选范围随 i 增大，
  // 写错一个下标不会报错，只会让分布偏 —— 而偏了的分布要跑几千次才看得出来。
  for (let i = bag.length - 1; i > 0; i--) {
    const j = rng.between(0, i)
    const tmp = bag[i]!
    bag[i] = bag[j]!
    bag[j] = tmp
  }

  const kinds = new Map<string, RoomKind>()
  kinds.set(plan.stairwell.id, 'start')
  for (const r of plan.rooms) if (r.fixed !== null) kinds.set(r.id, r.fixed)
  drawable.forEach((r, i) => {
    // 牌不够（权重表是空的之类）时退回 `main`，而不是让 `kind` 变成 undefined ——
    // 那种 `undefined` 会一路传到 `isCombatKind` 里，表现是「这一层的怪一个都不刷」。
    kinds.set(r.id, bag[i] ?? 'main')
  })
  return kinds
}

// ---------------------------------------------------------------- 2. 预算

/**
 * 从楼梯间出发，每个空间（房间与走廊）的**跳数**。
 *
 * 图的边有两类，缺一不可：
 *
 * - **门**：房间 ↔ 走廊
 * - **走廊相接**：走廊段之间直接相接、不隔墙（`floor-plan.json` 的 `_gap_comment`
 *   里那个唯一例外）—— 少了这一类，一条由 6 段拼成的走廊会被判成 6 个孤岛
 *
 * `checkReachable`（解析配置表时）已经用同一套边证过「每间房都走得到」，
 * 所以这里不会有不连通的房间。**不连通时给 `Infinity` 而不是 `-1`**：
 * `-1` 喂进 `t = dist / maxDist` 会算出负数，`growth ** 负数` 是个合法的小数，
 * 一路算出一个正常的预算 —— 于是「这间房走不到」变成「这间房有点弱」，**不报错**。
 */
export function hopDistances(plan: FloorPlan): Map<string, number> {
  const adj = new Map<string, Set<string>>()
  const link = (a: string, b: string): void => {
    if (!adj.has(a)) adj.set(a, new Set())
    if (!adj.has(b)) adj.set(b, new Set())
    adj.get(a)!.add(b)
    adj.get(b)!.add(a)
  }
  for (const d of plan.doors) link(d.a, d.b)
  for (const c of plan.corridors) for (const other of c.connectsTo) link(c.id, other)

  const dist = new Map<string, number>([[plan.stairwell.id, 0]])
  let frontier = [plan.stairwell.id]
  let hop = 0
  while (frontier.length > 0) {
    hop++
    const next: string[] = []
    for (const id of frontier) {
      for (const to of adj.get(id) ?? []) {
        if (dist.has(to)) continue
        dist.set(to, hop)
        next.push(to)
      }
    }
    frontier = next
  }
  return dist
}

// ---------------------------------------------------------------- 3. 墙

/** 平面图格号 → 网格下标。`navExtentFor` 把原点向下吸附到格的整数倍上，所以这是整除。 */
interface CellGrid {
  readonly cols: number
  readonly rows: number
  /** 网格的 (0, 0) 对应平面图的第几格（负数 = 那 2 格余量） */
  readonly cell0X: number
  readonly cell0Y: number
}

function cellGridFor(bounds: Rect, cellSize: number): CellGrid {
  const extent = navExtentFor(bounds, cellSize)
  // ⚠️ 这两个 `Math.ceil` / `Math.max` 必须与 `walkability.ts` 的 `buildGrid`
  //    **逐字相同**。差一格的表现是墙角上多一块或少一块矩形，
  //    而「少一块」那一侧玩家能走出去 —— 两边都不报错。
  return {
    cols: Math.max(1, Math.ceil(extent.width / cellSize)),
    rows: Math.max(1, Math.ceil(extent.height / cellSize)),
    cell0X: Math.round(extent.originX / cellSize),
    cell0Y: Math.round(extent.originY / cellSize),
  }
}

/**
 * 把一片格子拼成尽量少的矩形。**贪心**：每一行往右扩到底，再往下扩到不能扩。
 *
 * 不追求最优分解（那是精确覆盖问题）：这里要的是「矩形少到物理体扛得住」，
 * 而贪心给出的是「同一片实心区里，连成片的行各一个矩形」——
 * 一堵 100 格长的墙是 1 个矩形而不是 100 个。
 *
 * 已收走的格子标记后不再被认领，所以**不可能产出重叠的矩形** ——
 * 旧模型的 `dedupeWalls()` 就是干这个的，这里由构造保证，那个函数不再需要。
 */
function mergeRects(open: Uint8Array, grid: CellGrid, cellSize: number, originX: number, originY: number): Rect[] {
  const { cols, rows } = grid
  const taken = new Uint8Array(cols * rows)
  const out: Rect[] = []

  const free = (cx: number, cy: number): boolean => {
    const i = cy * cols + cx
    return open[i] === 0 && taken[i] === 0
  }

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (!free(cx, cy)) continue

      let x1 = cx
      while (x1 + 1 < cols && free(x1 + 1, cy)) x1++

      let y1 = cy
      grow: while (y1 + 1 < rows) {
        for (let x = cx; x <= x1; x++) if (!free(x, y1 + 1)) break grow
        y1++
      }

      for (let y = cy; y <= y1; y++) for (let x = cx; x <= x1; x++) taken[y * cols + x] = 1

      // 格区间 → px 中心点矩形。原点与边长都是 cellSize 的整数倍，
      // 所以这四行里没有任何浮点误差，也不必吸附。
      const left = originX + cx * cellSize
      const top = originY + cy * cellSize
      const width = (x1 - cx + 1) * cellSize
      const height = (y1 - cy + 1) * cellSize
      out.push({ x: left + width / 2, y: top + height / 2, width, height })
    }
  }
  return out
}

/**
 * 这一层的**墙**：平面图上没被任何空间占用的格子（减去门洞），向外再铺 2 格。
 *
 * 顺序是刻意的：先把「空间」和「门洞」标成通，剩下的就是墙。
 * 反过来（先铺满墙再挖）等价，但那样每一次改动都要想「我挖全了吗」——
 * 而**漏挖一格的表现是门变窄**，不是门消失。
 */
export function buildWallRects(plan: FloorPlan, cellSize: number): Rect[] {
  const grid = cellGridFor(plan.bounds, cellSize)
  const { cols, rows, cell0X, cell0Y } = grid
  const open = new Uint8Array(cols * rows)

  const stamp = (s: FloorPlanSpace): void => {
    for (let y = s.cells.y; y < s.cells.y + s.cells.height; y++) {
      const gy = y - cell0Y
      if (gy < 0 || gy >= rows) continue
      for (let x = s.cells.x; x < s.cells.x + s.cells.width; x++) {
        const gx = x - cell0X
        if (gx < 0 || gx >= cols) continue
        open[gy * cols + gx] = 1
      }
    }
  }

  stamp(plan.stairwell)
  for (const s of plan.rooms) stamp(s)
  for (const s of plan.corridors) stamp(s)
  // 门洞最后挖。顺序不影响结果（都是置 1），写在这里是为了读起来像「先建屋、再开门」。
  for (const d of plan.doors) stamp({ id: d.a + '↔' + d.b, cells: d.cells, rect: d.rect })

  const extent = navExtentFor(plan.bounds, cellSize)
  return mergeRects(open, grid, cellSize, extent.originX, extent.originY)
}

// ---------------------------------------------------------------- 组装

/** 一扇配置表里的门 → 运行期的 `Door`。`width` 是**沿着墙**量的那一边。 */
function toDoor(d: FloorPlan['doors'][number]): Door {
  return {
    x: d.rect.x,
    y: d.rect.y,
    width: d.axis === 'h' ? d.rect.width : d.rect.height,
    axis: d.axis,
    a: d.a,
    b: d.b,
  }
}

/**
 * 排好内容的一层楼。
 *
 * @param seed 种子。**只决定内容**（关别、以及后面两步的障碍物与刷怪点）
 * @param cfg  已校验的 `rooms.json`（**先过 `parseRoomsConfig`**，这里不再校验）
 * @param plan 已解析的 `floor-plan.json`。几何的唯一真值
 */
export function planLayout(seed: number, cfg: RoomsConfig, plan: FloorPlan): LayoutPlan {
  const kinds = assignKinds(seed, cfg, plan)
  const dist = hopDistances(plan)

  // 每扇门挂到**它两端是房间的那一侧**。今天每扇门都是「房间 ↔ 走廊」，
  // 所以每扇只挂一次；将来真出现「房间 ↔ 房间」的门时，这里会自然地
  // 两侧各挂一次 —— 而 `obstacles.ts` 的门前净空只读自己那间房的 `doors`，
  // 少挂一侧，那一侧的课桌就会堵在门口，洞口在数据里却看着完好无损。
  //
  // ⚠️ **楼梯间必须一起进来**（2026-10-20 补的漏）。第一版只写了
  // `plan.rooms.map(...)`，而 `plan.stairwell` **不在** `plan.rooms` 里
  // （它是 `FloorPlan` 上的另一个字段，见 `gen/floorPlan.ts`）——
  // 于是 `STAIR ↔ C_W` 那一扇门**两头都不是房间**，被静默丢掉：
  //
  // - `map.walls` 照旧把洞挖了（`buildWallRects` 走的是 `plan.doors`，全 16 扇）
  // - 而那张图上只有 **15 块**门挡板、楼梯间的 `doors` 是空的
  // - 后果：楼梯间那一头**没有挡板**（挡板是按 `Room.doors` 造的），
  //   而它是出生点 —— 「打完首领回楼梯间下楼」这条路上少一道可开可关的门。
  //   不报错、不抛异常，只是那个洞永远敞着。
  //
  // 判据因此从「`plan.rooms` 里的」改成「**输出里会变成 `Room` 的**」——
  // 那正是下面 `ordered` 的那一份，两者必须同源。
  const roomIds = new Set([plan.stairwell.id, ...plan.rooms.map((r) => r.id)])
  const doorsOf = new Map<string, Door[]>()
  for (const raw of plan.doors) {
    const door = toDoor(raw)
    for (const id of [door.a, door.b]) {
      if (!roomIds.has(id)) continue
      const list = doorsOf.get(id)
      if (list) list.push(door)
      else doorsOf.set(id, [door])
    }
  }

  // `order` 是**稳定显示序**，不是进度轴：0 恒为楼梯间（`BattleScene` 的
  // `stage = 1` 之类的地方按它取整数键），其余按 id 升序。
  const ordered = [plan.stairwell, ...[...plan.rooms].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))]

  // `maxDist` 只在**战斗关**里取最大值：非战斗关的预算恒为 0，
  // 拿它们去撑最大值会让「最远的战斗关」永远够不到 t = 1，
  // 于是调平衡时那句「末尾那间有多强」随种子里道具房的远近飘。
  let maxDist = 0
  for (const s of ordered) {
    if (!isCombatKind(cfg, kinds.get(s.id) ?? 'main')) continue
    const d = dist.get(s.id)
    if (d !== undefined && d > maxDist) maxDist = d
  }

  const rooms: Room[] = ordered.map((s, order) => {
    const kind: RoomKind = order === 0 ? 'start' : (kinds.get(s.id) ?? 'main')
    const hop = dist.get(s.id) ?? Number.POSITIVE_INFINITY
    return {
      id: s.id,
      order,
      kind,
      rect: s.rect,
      doors: doorsOf.get(s.id) ?? [],
      obstacles: [],
      spawnPoints: [],
      // 非战斗关的钱恒为 0。一个空场地写着一份威胁预算就是数据在说谎 ——
      // 而且它会被 `validate/contract.ts` 的「非战斗关三空」当场拦下。
      budget: isCombatKind(cfg, kind) ? threatBudget(hop, maxDist, cfg) : 0,
    }
  })

  return {
    rooms,
    passages: plan.corridors.map((c): Passage => ({ id: c.id, rect: c.rect })),
    walls: buildWallRects(plan, cfg.navCellSize),
    bounds: plan.bounds,
  }
}