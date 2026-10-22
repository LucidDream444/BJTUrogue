/**
 * `floor-plan.json` 的加载、换算与校验。**纯函数，零 Phaser 依赖，node 下可直接单测。**
 *
 * ---
 *
 * ## 这一层楼是**画**出来的，不是算出来的
 *
 * 生成器的职责从「算出几何」缩到「往几何里填内容」。房间在哪、多大、门开在哪儿
 * 全部来自 6F 平面图照片，写死在配置表里 —— 同一层楼每次生成长得一样，
 * 改一间房的位置就是改配置表里的一个数。种子决定的是**内容**：关别、障碍物、刷怪点。
 *
 * ## 两次换算，都只在这一处
 *
 * | 从 | 到 | 谁负责 |
 * |---|---|---|
 * | 格（配置表） | px（运行期） | `cellSize`，就是 `rooms.json` 的 `navCellSize` |
 * | 左上角（配置表） | 中心点（`Rect`） | `model/rect.ts` 的 `rectFromTopLeft()` |
 *
 * ⚠️ **两处都只许这里做。** 第二次尤其危险：`Rect` 的 `x` / `y` 是**中心点**
 * （理由见 `model/types.ts` 的文件头），而配置表写的是左上角 —— 写反的症状是
 * 整张图偏移半个身位，**且不会有任何报错**。所以解析完吐出去的对象里
 * **只留中心点那一份**，把格坐标也带着（校验器要用），但谁取数都要走 `rect`。
 *
 * ## 为什么这些校验在**解析**这一步，而不是 `validate/`
 *
 * `validate/` 的职责是「**生成出来的地图**合不合法」，它的输入是 `DungeonMap`。
 * 而这里问的是另一个问题：「**配置表自己**自相矛盾吗」—— 房间叠在一起、
 * 门开在空气上、有一间房根本没有门。这些问题与种子、与生成器都无关，
 * 一张写错的平面图换一百个种子还是错的。放进 `validate/` 会让每个种子
 * 都重跑一遍同一批必然失败的判定。
 */

import { ConfigError } from '@/core/config'
import { floorsConfigFromCache, need, needArray, needNumber, needObject } from '../config'
import type { RoomKind, Rect } from '../model/types'
import { ROOM_KINDS } from '../model/types'
import { rectFromTopLeft } from '../model/rect'

// ---------------------------------------------------------------- 形状

/**
 * 解析一份平面图要用到的**几个 px 度量**，全部来自 `rooms.json`。
 *
 * 做成窄接口而不是直接收 `RoomsConfig`：单元测试不必为了试一条几何校验
 * 去凑一份 40 个字段的配置。`RoomsConfig` 结构上满足它，调用方直接传即可。
 *
 * ★ 改了（2026-10-22）：**「这一层有几间房」不再是这里的一个字段**，
 * 改由**平面图自己声明**（`roomTotal`，见 `checkRoomCount`）。原因是产品有了
 * 两层楼（YF3 十五间、6F 十六间），而 `rooms.json` 只有一份 —— 一个全局的数
 * 对不上两张图，那种对不上会在第 1 层加载时抛，看着像「平面图写错了」。
 *
 * 留下来的四条度量的共性是：**它们是单位换算，与「第几层」无关** ——
 * 一层楼有多宽、多少格、门多宽，两层楼是同一套。
 */
export interface FloorPlanMetrics {
  /** 1 格多少 px。配置表里的格坐标靠它换成运行期的 px */
  readonly navCellSize: number
  /** 墙厚（px）。门洞挖穿的就是它，门矩形的短边恒等于它 */
  readonly wallThickness: number
  /** 门的净宽（px），也就是门矩形长边的标准值 */
  readonly doorWidth: number
  /** 通道最小净宽（px）。门洞不许比它窄，否则玩家挤不过去 */
  readonly minPassageWidth: number
}

/**
 * 平面图上的一个**空间**。房间、楼梯间、走廊都是它 ——
 * 三者在几何上完全平等，差别只在内容。
 *
 * `cells` 是配置表的原样（**整数格、左上角**），`rect` 是换算后的
 * （**px、中心点**）。两份都留着不是冗余：校验器要在格空间里判「有没有隔开 1 格」，
 * 生成器要在 px 空间里摆东西，而这两个问题用对方的坐标问就会问错。
 */
export interface FloorPlanSpace {
  readonly id: string
  readonly cells: Rect
  readonly rect: Rect
}

export interface FloorPlanRoom extends FloorPlanSpace {
  /** 写死的关别（`YF604` 是 `boss`，两间教休室是 `reward`）。`null` = 按种子抽 */
  readonly fixed: RoomKind | null
}

export interface FloorPlanCorridor extends FloorPlanSpace {
  /** 走廊段之间**直接相接、不隔墙**（它们是同一条走廊，见 `_gap_comment`） */
  readonly connectsTo: readonly string[]
}

/**
 * 一扇门 —— 墙上挖掉的那几格。
 *
 * `a` / `b` 是它连的两个空间的 `id`，**按字典序排好**：门是无向的，
 * 没有「来」与「去」。旧模型的三态 `back` / `forward` / `side` 是主干道模型的产物，
 * 已经随「玩家随意挑房间进」一起作废（design D8）。
 */
export interface FloorPlanDoor {
  readonly a: string
  readonly b: string
  readonly cells: Rect
  readonly rect: Rect
  /** 门开在一堵**水平**墙上（人沿 y 穿过）还是**竖直**墙上（人沿 x 穿过） */
  readonly axis: 'h' | 'v'
}

export interface FloorPlan {
  readonly schemaVersion: number
  readonly cellSize: number
  readonly wallThickness: number
  /**
   * 这一层一共**几间房（含楼梯间）**，平面图自己声明。
   *
   * ★ 新增（2026-10-22）：这个数原先是代码里的常量 `FLOOR_ROOM_TOTAL`（16），
   * 而它其实是「这一层」的属性：6F 十六间、YF3 十五间。一份全局的数配两张图，
   * 必然错一边，而错的那一边会在**第 1 层加载时**抛，看着像平面图写错了。
   * 现在它跟着平面图走，`checkRoomCount` 拿它与 `rooms.length + 1` 对账。
   */
  readonly roomTotal: number
  /** 整层的外框（px、中心点），缩略图与相机取景的依据 */
  readonly bounds: Rect
  readonly cols: number
  readonly rows: number
  readonly stairwell: FloorPlanRoom
  readonly rooms: readonly FloorPlanRoom[]
  readonly corridors: readonly FloorPlanCorridor[]
  readonly doors: readonly FloorPlanDoor[]
}

/** 配置文件在 `public/` 下的相对路径。**不带前导斜杠**（见 `config.ts` 文件头）。 */
export const FLOOR_PLAN_NAME = 'floor-plan.json'
export const FLOOR_PLAN_URL = `config/${FLOOR_PLAN_NAME}`

/**
 * 逸夫楼 3F —— 一局的**第 1 层**（用户 2026-10-22：「进入游戏先是 YF3，下一层是 YF6」）。
 *
 * 单独给个名字是因为它有两个身份：对 `floors.json` 它是第一项，对测试场
 * `?arena=d2_seeds` 它是 `C` 键切过去的那一层（那场 2026-10-22 由 `yf` 并进来，
 * 默认就是它）。写死字符串的地方只有这里一处。
 */
export const FLOOR_PLAN_YF3_NAME = 'floor-plan-yf3.json'

/**
 * **全部**平面图文件。`BattleScene.preload()` 加载的就是这一串，
 * 而「第几层用哪一张」在 `floors.json` 里。
 *
 * ★ 新增（2026-10-22）：一局有两层楼之后，**加载清单必须在读配置之前就存在**
 * （先有鸡才有蛋：`floors.json` 自己也是被加载进来的），所以它是代码里的常量，
 * 而顺序/用哪张是配置。加一张新图 = 丢一份 JSON + 在这里加一个文件名 + 在
 * `floors.json` 里排上号；漏了这一步的报错由 `floorPlansForRun()` 给出。
 *
 * ⚠️ 名字以 `.json` 结尾（和 `ROOMS_CONFIG_NAME` 一样）：Phaser 的 `cache.json`
 * 用的就是文件名当 key，`load.json(name, 'config/' + name)` 两处是同一个字符串。
 */
export const FLOOR_PLAN_FILES: readonly string[] = [FLOOR_PLAN_NAME, FLOOR_PLAN_YF3_NAME]

// ---------------------------------------------------------------- 取值

function needString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new ConfigError(path, `要一个非空字符串，拿到 ${JSON.stringify(value)}`)
  }
  return value
}

function needRect(value: unknown, path: string): Rect {
  const obj = needObject(value, path)
  return {
    x: needNumber(obj.x, `${path}.x`, { integer: true }),
    y: needNumber(obj.y, `${path}.y`, { integer: true }),
    width: needNumber(obj.width, `${path}.width`, { integer: true, min: 1 }),
    height: needNumber(obj.height, `${path}.height`, { integer: true, min: 1 }),
  }
}

/** 格矩形 → px 中心点矩形。**全项目只有这一处做这次换算。** */
function toRect(cells: Rect, cellSize: number): Rect {
  return rectFromTopLeft(cells.x * cellSize, cells.y * cellSize, cells.width * cellSize, cells.height * cellSize)
}

// ---------------------------------------------------------------- 校验

/** 空间在格空间里的覆盖：左上角 + 宽高，全部整数格。 */
type Span = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }

function spanOf(s: FloorPlanSpace): Span {
  return { x0: s.cells.x, y0: s.cells.y, x1: s.cells.x + s.cells.width, y1: s.cells.y + s.cells.height }
}

/** 两个格区间是否**正交相邻或重叠**（对角相接不算，中间夹着两个墙格，走不过去）。 */
function touching(a: Span, b: Span): 'overlap' | 'touch' | null {
  const xOverlap = a.x0 < b.x1 && b.x0 < a.x1
  const yOverlap = a.y0 < b.y1 && b.y0 < a.y1
  if (xOverlap && yOverlap) return 'overlap'
  const yAdjacent = a.y1 === b.y0 || b.y1 === a.y0
  const xAdjacent = a.x1 === b.x0 || b.x1 === a.x0
  if ((xOverlap && yAdjacent) || (yOverlap && xAdjacent)) return 'touch'
  return null
}

/**
 * 2.5 · **任意两个空间之间必须空出整整 1 格**（走廊↔走廊例外，它们是一条走廊）。
 *
 * 这条是整份校验里最值钱的一条，因为它堵的那个坑**两边都不报错**：
 * 两间房直接贴上时，那一格墙不存在 —— 墙心落在格**边界**上，一格中心都盖不住，
 * 于是寻路认为墙两侧都通、物理体照样挡着玩家。症状是「怪卡在看不见的角里」，
 * 与「寻路坏了」长得一模一样。
 *
 * 判据用「正交相邻或重叠」而不是「距离 < 1」：**对角相接是允许的**
 *（两个对角格子中间还夹着两个墙格，4 连通走不过去），一把抓会把对的判成坏的。
 */
export function checkSpacesSeparated(spaces: readonly FloorPlanSpace[], corridors: readonly FloorPlanCorridor[]): void {
  const corridorIds = new Set(corridors.map((c) => c.id))
  for (let i = 0; i < spaces.length; i++) {
    for (let j = i + 1; j < spaces.length; j++) {
      const a = spaces[i]
      const b = spaces[j]
      if (corridorIds.has(a.id) && corridorIds.has(b.id)) continue
      const hit = touching(spanOf(a), spanOf(b))
      if (!hit) continue
      const [p, q] = a.cells.x <= b.cells.x ? [a, b] : [b, a]
      throw new ConfigError(
        `floorPlan.spaces.${q.id}`,
        hit === 'overlap'
          ? `与「${p.id}」**重叠**了（${p.id} 占 x${p.cells.x}..${p.cells.x + p.cells.width - 1} ` +
              `y${p.cells.y}..${p.cells.y + p.cells.height - 1}，` +
              `${q.id} 占 x${q.cells.x}..${q.cells.x + q.cells.width - 1} y${q.cells.y}..${q.cells.y + q.cells.height - 1}）。` +
              `两个空间不许叠在一起`
          : `与「${p.id}」**贴死了，中间没有墙**（${p.id} 到 x${p.cells.x + p.cells.width - 1} / y${p.cells.y + p.cells.height - 1}，` +
              `${q.id} 从 x${q.cells.x} / y${q.cells.y} 起）。` +
              `相邻的两个空间之间必须**空出整整 1 格**，那一格才是墙 —— ` +
              `贴上时墙心落在格**边界**上，一格中心都盖不住，` +
              `于是寻路认为两侧都通、物理体照样挡着玩家，**两边都不报错**`,
      )
    }
  }
}

/**
 * 2.4 · **每扇门都要落在它声称要开的那面墙上，且净宽达标。**
 *
 * 三种写法各自对应一个真实的错：
 *
 * - 门格落在某个空间**里面** → 「墙上凭空多了个洞」，或者根本不是墙
 * - 门格落在**谁都不挨着**的地方 → 门开在空气上，两边都不是它声称的空间
 * - 门太窄 → 玩家挤不过去，而它在地图上看着就是一条正常的缝
 */
export function checkDoors(
  doors: readonly FloorPlanDoor[],
  spaces: readonly FloorPlanSpace[],
  metrics: FloorPlanMetrics,
): void {
  for (const d of doors) {
    const path = `floorPlan.doors["${d.a}↔${d.b}"]`
    const clearPx = Math.max(d.cells.width, d.cells.height) * metrics.navCellSize
    if (clearPx < metrics.minPassageWidth) {
      throw new ConfigError(
        path,
        `门洞净宽 ${clearPx}px 小于 minPassageWidth ${metrics.minPassageWidth}px —— 玩家挤不过去`,
      )
    }
    // 门格的每一个格子都不许落在任何空间里：那几格是**墙**。
    for (let dy = 0; dy < d.cells.height; dy++) {
      for (let dx = 0; dx < d.cells.width; dx++) {
        const cx = d.cells.x + dx
        const cy = d.cells.y + dy
        const inside = spaces.find(
          (s) =>
            cx >= s.cells.x &&
            cx < s.cells.x + s.cells.width &&
            cy >= s.cells.y &&
            cy < s.cells.y + s.cells.height,
        )
        if (inside) {
          throw new ConfigError(
            path,
            `门的第 (${cx}, ${cy}) 格落在「${inside.id}」**里面**了 —— ` +
              `门是墙上挖掉的那几格，必须整格落在墙上`,
          )
        }
      }
    }
    // 门洞两侧必须正好站着它声称的那两个空间。
    const near = new Set<string>()
    const steps: readonly (readonly [number, number])[] =
      d.cells.width > d.cells.height
        ? [
            [0, -1],
            [0, 1],
          ]
        : [
            [-1, 0],
            [1, 0],
          ]
    for (let dy = 0; dy < d.cells.height; dy++) {
      for (let dx = 0; dx < d.cells.width; dx++) {
        const cx = d.cells.x + dx
        const cy = d.cells.y + dy
        for (const [ox, oy] of steps) {
          const s = spaces.find(
            (v) =>
              cx + ox >= v.cells.x &&
              cx + ox < v.cells.x + v.cells.width &&
              cy + oy >= v.cells.y &&
              cy + oy < v.cells.y + v.cells.height,
          )
          if (s) near.add(s.id)
        }
      }
    }
    if (!near.has(d.a) || !near.has(d.b)) {
      throw new ConfigError(
        path,
        `门的两侧其实是 [${[...near].join(', ') || '空气'}]，不是它声称的「${d.a}」与「${d.b}」—— ` +
          `门只许开在**一边是 A、另一边是 B** 的那面墙上`,
      )
    }
  }
}

/**
 * 2.6 · **从楼梯间出发，每一间编号教室都要走得到。**
 *
 * 图的边有两类，缺一不可：
 *
 * - **门**：房间 ↔ 走廊
 * - **走廊相接**：走廊段之间直接相接、不隔墙（`_gap_comment` 里那个唯一例外）——
 *   少了这一类，一条由 6 段拼成的走廊会被判成一个都不通
 *
 * 失败时**列出走不到的 id**，不是只报个数：一间房进不去时，人第一个要问的就是
 * 「是哪几间」，而重新跑一遍去找它们是纯粹的浪费。
 */
export function checkReachable(
  stairwell: FloorPlanRoom,
  rooms: readonly FloorPlanRoom[],
  corridors: readonly FloorPlanCorridor[],
  doors: readonly FloorPlanDoor[],
): void {
  const adj = new Map<string, Set<string>>()
  const link = (a: string, b: string): void => {
    if (!adj.has(a)) adj.set(a, new Set())
    if (!adj.has(b)) adj.set(b, new Set())
    adj.get(a)!.add(b)
    adj.get(b)!.add(a)
  }
  for (const d of doors) link(d.a, d.b)
  for (const c of corridors) for (const other of c.connectsTo) link(c.id, other)

  const seen = new Set<string>([stairwell.id])
  const queue = [stairwell.id]
  while (queue.length > 0) {
    for (const next of adj.get(queue.pop()!) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  const unreachable = rooms.filter((r) => !seen.has(r.id)).map((r) => r.id)
  if (unreachable.length > 0) {
    throw new ConfigError(
      'floorPlan.doors',
      `从楼梯间（${stairwell.id}）走不到这几间教室：[${unreachable.join(', ')}]。` +
        `每一间房都要至少有一扇门，而且那扇门通向的走廊要真的连得到楼梯间`,
    )
  }
}

/**
 * 2.7 · **平面图声明了这一层有几间房，`rooms` 就得给出几间。**
 *
 * 两个数字对不上时**两个都报出来**：只报一个的话，读的人还要去翻另一个文件，
 * 而「配置表之间不一致」最容易的修法就是照着报出来的那个数改另一个 ——
 * 报一个数等于在暗示「是这个错了」，而那是猜的。
 *
 * ★ 改了（2026-10-22）：原先是**两条判据**（平面图的教室数 vs `rooms.json` 的
 * `classroomCount`；再加一条「加一间楼梯间」）。现在只剩一条，因为两个数里的
 * 「应当是几间」移进了平面图自己（`roomTotal`）—— 一局两层楼，`rooms.json`
 * 只有一份，那个全局的数对不上两张图。判据没变松：**声明与几何对账**照旧，
 * 楼梯间照旧计入，写小了 / 写大了都当场抛。
 *
 * 一并删掉的是「教室数 vs classroomCount」那一条：它守的是「几何与玩法侧
 * 对同一个数」，而现在**玩法侧不再有这个数**（关别发牌按平面图里不带 fixed 的
 * 间数自适应，见 `layout.ts` 的 `assignKinds`），没有第二个数可对。
 */
export function checkRoomCount(rooms: readonly FloorPlanRoom[], roomTotal: number): void {
  if (rooms.length + 1 !== roomTotal) {
    throw new ConfigError(
      'floorPlan.roomTotal',
      `这一层声明了 ${roomTotal} 间房，而几何给出的是 ${rooms.length} 间 + 1 间楼梯间 = ${rooms.length + 1} 间。` +
        `楼梯间必须算进去（出生点在它里面，它也是一间房），所以：` +
        `roomTotal 写成 ${rooms.length} 就是漏了楼梯间，写成 ${roomTotal + 1} 就是多数了一间。` +
        `⚠️ 两个数都在这一份平面图里（\`roomTotal\` 与 \`rooms\`），改一个就顺带看一眼另一个`,
    )
  }
}

// ---------------------------------------------------------------- 解析

/**
 * 把 `floor-plan.json` 的原始 JSON 解析并校验成 `FloorPlan`。
 *
 * 顺序是**刻意的**：先建对象（会被 `needX` 挡下的结构性错误在这一步就炸），
 * 再按「局部 → 全局」的顺序校验 —— 先叠不叠、门开得对不对（只看坐标就能判），
 * 最后才连通性（要先把图建起来）。连通性放前面的话，一张叠着的图会先报
 * 「走不到 YF607」，而真正的原因在旁边那张房上，读的人会被带偏。
 */
export function parseFloorPlan(raw: unknown, metrics: FloorPlanMetrics): FloorPlan {
  const root = needObject(raw, 'floorPlan')

  const schemaVersion = needNumber(root.schemaVersion, 'floorPlan.schemaVersion', { integer: true, min: 1 })

  // 这一层有几间房由平面图自己声明。**这里不读 `rooms.json`** —— 两份平面图的
  // 间数不同（6F 十六、YF3 十五），全局只有一个教室数时必然错一边。
  const roomTotal = needNumber(root.roomTotal, 'floorPlan.roomTotal', { integer: true, min: 2 })

  const cellSize = metrics.navCellSize
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new ConfigError('rooms.navCellSize', `要一个正数，拿到 ${cellSize} —— 格边长是全部换算的分母`)
  }

  const readRoom = (value: unknown, path: string): FloorPlanRoom => {
    const obj = needObject(value, path)
    const cells = needRect(obj, path)
    const fixedRaw = obj.fixed
    let fixed: RoomKind | null = null
    if (fixedRaw !== undefined && fixedRaw !== null) {
      fixed = needString(fixedRaw, `${path}.fixed`) as RoomKind
      if (!ROOM_KINDS.includes(fixed)) {
        throw new ConfigError(
          `${path}.fixed`,
          `要一个关别（${ROOM_KINDS.join(' / ')}），拿到 ${JSON.stringify(fixedRaw)}`,
        )
      }
    }
    return { id: needString(obj.id, `${path}.id`), cells, rect: toRect(cells, cellSize), fixed }
  }

  const stairwell = readRoom(need(root.stairwell, 'floorPlan.stairwell'), 'floorPlan.stairwell')

  const roomArr = needArray(root.rooms, 'floorPlan.rooms', 1)
  const rooms = roomArr.map((r, i) => readRoom(r, `floorPlan.rooms[${i}]`))

  const corridorArr = needArray(root.corridors, 'floorPlan.corridors', 1)
  // 先只读坐标，相接关系等全部读完再算 —— 相接是**两两**的事，
  // 读第一段时第二段还不存在。
  const rawCorridors = corridorArr.map((c, i) => {
    const path = `floorPlan.corridors[${i}]`
    const obj = needObject(c, path)
    const cells = needRect(obj, path)
    return { id: needString(obj.id, `${path}.id`), cells, rect: toRect(cells, cellSize) }
  })
  // 走廊段相接：4 连通上有正交相邻（或重叠）的一对格子就算接上了。
  const corridors: FloorPlanCorridor[] = rawCorridors.map((c) => ({
    ...c,
    connectsTo: rawCorridors.filter((o) => o !== c && corridorAdjacent(c, o)).map((o) => o.id),
  }))

  const roomIds = new Set<string>()
  const allIds = new Set<string>()
  const allSpaces: FloorPlanSpace[] = [stairwell, ...rooms, ...corridors]
  for (const s of allSpaces) {
    if (allIds.has(s.id)) {
      throw new ConfigError(
        `floorPlan.${s.id}`,
        `id「${s.id}」出现了两次 —— 同一层里 id 必须唯一，` +
          `门就是靠 id 指认空间的，重名会让一扇门连到随机的那个`,
      )
    }
    allIds.add(s.id)
    if (s !== stairwell) roomIds.add(s.id)
  }

  const doorArr = needArray(root.doors, 'floorPlan.doors', 1)
  const doors: FloorPlanDoor[] = doorArr.map((d, i) => {
    const path = `floorPlan.doors[${i}]`
    const obj = needObject(d, path)
    const a = needString(obj.a, `${path}.a`)
    const b = needString(obj.b, `${path}.b`)
    // 2.2 · 未知 id **与**合法 id 集合一起报：只说「不知道 YF616 是谁」，
    //        读的人还得去翻合法清单，而多数时候那一眼就能看出是打错了哪一位。
    for (const id of [a, b]) {
      if (!allIds.has(id)) {
        throw new ConfigError(
          `${path}.${id === a ? 'a' : 'b'}`,
          `门引用了不存在的空间「${id}」。这一层里合法的 id 是：[${[...allIds].join(', ')}]`,
        )
      }
    }
    if (a === b) throw new ConfigError(path, `门的两端是同一个空间「${a}」`)
    const cells = needRect(obj, path)
    const horizontal = cells.width > cells.height
    if (cells.width !== cells.height && Math.min(cells.width, cells.height) !== 1) {
      throw new ConfigError(
        path,
        `门是 ${cells.width}×${cells.height} 格 —— 横门该是 N×1、竖门该是 1×N（短边恒为 1 格 = 墙厚 ${metrics.wallThickness}px）`,
      )
    }
    const [p, q] = a < b ? [a, b] : [b, a]
    return { a: p, b: q, cells, rect: toRect(cells, cellSize), axis: horizontal ? 'h' : 'v' }
  })

  // 2.3 · 坐标是整数格（`needNumber({integer:true})` 已经钉住），
  //        再确认换算后的 px 落在 `navCellSize` 的整数倍上 —— 这一条现在恒真，
  //        留着是因为它守的是**下一个改动**：哪天有人想在配置表里写半格，
  //        墙心就会从格中心（20 + 40n）偏出去，而那正是 `_gap_comment` 描述的那个坑。
  for (const s of allSpaces) {
    for (const [name, v] of [
      ['x', s.cells.x],
      ['y', s.cells.y],
      ['width', s.cells.width],
      ['height', s.cells.height],
    ] as const) {
      if ((v * cellSize) % cellSize !== 0) {
        throw new ConfigError(
          `floorPlan.${s.id}.${name}`,
          `${v} 格换算成 ${v * cellSize}px，不是 navCellSize(${cellSize}) 的整数倍`,
        )
      }
    }
  }

  const bounds = boundsOf(allSpaces, cellSize)
  const cols = Math.max(...allSpaces.map((s) => s.cells.x + s.cells.width))
  const rows = Math.max(...allSpaces.map((s) => s.cells.y + s.cells.height))

  const plan: FloorPlan = {
    schemaVersion,
    cellSize,
    wallThickness: metrics.wallThickness,
    roomTotal,
    bounds,
    cols,
    rows,
    stairwell,
    rooms,
    corridors,
    doors,
  }

  // 局部 → 全局
  checkSpacesSeparated(allSpaces, corridors)
  checkDoors(doors, allSpaces, metrics)
  checkRoomCount(rooms, roomTotal)
  checkReachable(stairwell, rooms, corridors, doors)

  return plan
}

/** 两条走廊是否正交相接（相接就行，允许重叠 —— 它们是同一条走廊）。 */
function corridorAdjacent(a: FloorPlanSpace, b: FloorPlanSpace): boolean {
  const xOverlap = a.cells.x < b.cells.x + b.cells.width && b.cells.x < a.cells.x + a.cells.width
  const yOverlap = a.cells.y < b.cells.y + b.cells.height && b.cells.y < a.cells.y + a.cells.height
  const yAdjacent = a.cells.y + a.cells.height === b.cells.y || b.cells.y + b.cells.height === a.cells.y
  const xAdjacent = a.cells.x + a.cells.width === b.cells.x || b.cells.x + b.cells.width === a.cells.x
  return (xOverlap && yOverlap) || (xOverlap && yAdjacent) || (yOverlap && xAdjacent)
}

function boundsOf(spaces: readonly FloorPlanSpace[], cellSize: number): Rect {
  const x0 = Math.min(...spaces.map((s) => s.cells.x)) * cellSize
  const y0 = Math.min(...spaces.map((s) => s.cells.y)) * cellSize
  const x1 = Math.max(...spaces.map((s) => s.cells.x + s.cells.width)) * cellSize
  const y1 = Math.max(...spaces.map((s) => s.cells.y + s.cells.height)) * cellSize
  return rectFromTopLeft(x0, y0, x1 - x0, y1 - y0)
}

/**
 * 从 `public/` 取**一份**平面图（6F 那份）。开屏时用。
 *
 * ⚠️ 产品那条路不走这里：`BattleScene.preload()` 把 `FLOOR_PLAN_FILES` 一次
 * 全加载进 Phaser 缓存，之后一律 `floorPlanFromCache()` / `floorPlansForRun()`
 * —— 换层时**一个网络请求都没有**（红线 1）。留在这里的是「只想拿一张图」的
 * 场合（校验脚本、单测）。
 *
 * ⚠️ `base` 必须传（通常是 `import.meta.env.BASE_URL`）。别给它一个
 * `document.baseURI` 默认值 —— node 下求值即 `ReferenceError`，无参调用的单测会当场崩。
 *
 * 加载失败**直接抛**，不降级、不兜底（2.8）。「退回上一个能用的平面图」
 * 会让这一局的几何与配置表说的不是一回事，而症状是「地图偶尔长得不对」——
 * 那比开屏就崩难查一个数量级。
 */
export async function loadFloorPlan(base: string, metrics: FloorPlanMetrics): Promise<FloorPlan> {
  const url = new URL(FLOOR_PLAN_URL, base).href
  let res: Response
  try {
    res = await fetch(url)
  } catch (cause) {
    throw new ConfigError(FLOOR_PLAN_URL, `网络请求失败（${url}）：${String(cause)}`)
  }
  if (!res.ok) throw new ConfigError(FLOOR_PLAN_URL, `HTTP ${res.status}（${url}）`)

  let raw: unknown
  try {
    raw = await res.json()
  } catch (cause) {
    throw new ConfigError(FLOOR_PLAN_URL, `不是合法 JSON：${String(cause)}`)
  }
  return parseFloorPlan(raw, metrics)
}

/**
 * 一个平面图文件名**必须先在 `FLOOR_PLAN_FILES` 里**，否则它根本没被 preload，
 * `cache.get()` 只会给一个 `undefined`。
 *
 * 那句 `undefined` 一路走到底报出来的是 `floorPlan.schemaVersion 要一个整数，
 * 拿到 undefined` —— 看不出「这个文件压根没加载」。所以在这里先拦一道，
 * 把该往哪儿加说清楚。
 */
function needLoadedPlanName(name: string): string {
  if (!FLOOR_PLAN_FILES.includes(name)) {
    throw new ConfigError(
      `floorPlan.${name}`,
      `这一层要用「${name}」，但它不在 FLOOR_PLAN_FILES 里，所以 preload 时根本没加载。` +
        `加一张平面图 = 丢一份 JSON 进 public/config/ + 把文件名加进 \`FLOOR_PLAN_FILES\`` +
        `（${FLOOR_PLAN_FILES.join(' / ')}）+ 在 floors.json 里排上号。` +
        `⚠️ floors.json 自己也是被加载进来的，所以加载清单没法从它推出来，只能是常量`,
    )
  }
  return name
}

/**
 * 从 Phaser 的缓存里取一份已经用 `load.json` 载入的平面图。
 *
 * ★ 改了（2026-10-22）：多了 `name`。一局里**第几层走哪张图**由 `floors.json`
 * 定，于是「取哪一份」成了参数；默认值仍是 6F 那一份，单测与老调用方不用改。
 * 整局要的那一串用 `floorPlansForRun()`，别一层一层自己取。
 */
export function floorPlanFromCache(
  cache: { get(key: string): unknown },
  metrics: FloorPlanMetrics,
  name: string = FLOOR_PLAN_NAME,
): FloorPlan {
  return parseFloorPlan(cache.get(needLoadedPlanName(name)), metrics)
}

/**
 * **整局**每一层的平面图，按层号排（第 1 项 = 第 1 层）。开屏 / 建关卡时取一次。
 *
 * ★ 新增（2026-10-22）：在这之前「几何整局一份」，`BattleScene` 只留一个
 * `this.plan`，换层只换内容。现在第 1 层是逸夫楼 3F、第 2 层是 6F，
 * 换层要**整层换掉几何**，所以取回来的是一串。
 *
 * 三层校验叠在一起，缺一层就会变成别的症状：
 * 1. `floors.json` 的条数 == `combat.json` 的 `arena.maxStages`（`parseFloorsConfig`）
 * 2. 每个文件名都在 `FLOOR_PLAN_FILES` 里（`needLoadedPlanName`，也就是真的加载过）
 * 3. 每份都解析得出来（`parseFloorPlan` 那一整套几何校验）
 *
 * ⚠️ **不在这查「几层的包围盒一不一样」**：那是 `BattleScene.applyArena()` 的
 * 活（TerrainMap 的行列数与物理世界边界在 `CombatSession` 构造时就定了，
 * 两层包围盒不同的话换层时它会当场抛）。`floors.test.ts` 里另有一条提前守。
 */
export function floorPlansForRun(
  cache: { get(key: string): unknown },
  metrics: FloorPlanMetrics,
  expectedFloors: number,
): readonly FloorPlan[] {
  return floorsConfigFromCache(cache, expectedFloors).floors.map((name) =>
    floorPlanFromCache(cache, metrics, name),
  )
}