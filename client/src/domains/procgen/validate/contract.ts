/**
 * **几何契约**校验。纯函数，零 Phaser 依赖，node 下可直跑。
 *
 * ---
 *
 * ## 这个文件是「尺寸契约」的可执行版本
 *
 * spec `procgen-config-contract` 用一张表写了尺寸契约（格边长 / 窄口净宽 /
 * 门洞两端落在格边界 / 课桌短边 / 按格对齐 / 只横竖 / 椅子 1 格……）。
 * **一张写在文档里的表会被忘掉；一个会抛异常的断言不会。**
 *
 * 它校验的是**生成出来的地图**，不是配置表 —— 配置表的自洽在 `config.ts` 里跑，
 * 平面图的自洽在 `gen/floorPlan.ts` 里跑。三者抓的是不同的错：
 *
 * | 谁错了 | 谁抓得住 |
 * |---|---|
 * | `rooms.json` 里写了 `wallThickness: 20` | `config.ts`（它知道 20 < 一格 = 会漏洞） |
 * | `floor-plan.json` 里两间房贴在了一起 | `floorPlan.ts`（它看得见格坐标） |
 * | 生成器把某间房的对齐算歪了 | **这个文件**（配置全合法，map 是错的） |
 *
 * ## ★ v5：这个文件的输入没变，但它**守的东西换掉了一半**
 *
 * 签名还是 `(map, cfg)`，可 `cfg` 里**已经没有几何了** —— `rooms.json` 在 v5 只剩
 * 三个几何数（`navCellSize` / `wallThickness` / `minPassageWidth`），
 * 而 v4 在这里比对的 `mainWidthTiers` / `sideRoomTiers` / `mainRoomHeight` /
 * `roomGap` **一条都不在了**。拿它们核地图的检查没有「另一份」可核，
 * 所以它们不是「删了」，是**搬家**：房间在哪多大、门开在哪面墙上这些事实
 * 现在写在 `floor-plan.json` 里，由 `gen/floorPlan.ts` 在**解析时**核。
 *
 * 那为什么这个文件还留着？因为它的输入是 `DungeonMap` —— 一份**可能不是生成器
 * 交出来的**数据（存档、迁移脚本、别人手写的测试夹具）。`parseFloorPlan` 管不着那些：
 * 它看的是配置表，而这里看的是**手里这份 map**。所以留下的是「只靠地图自己
 * 就能问出答案」的那一半，最典型的是**关别那几条**（v4 起就在这儿，v5 只是换了判据）。
 *
 * ⚠️ **这个文件看不见 `floor-plan.json`**，所以「每一间房都在平面图上」
 * 「`YF604` 是首领」「教休室是道具关」这三条**不在这里**：
 * 前两条是 `parseFloorPlan` + `checkRoomCount` 的活，第三条由
 * `floorPlan.test.ts` 钉着固定关别。**别往这儿加** —— 要平面图才答得了的问题，
 * 加进一个只收 `DungeonMap` 的函数里只会变成一句抄下来的常量，而常量会漂。
 *
 * ## ⚠️ 对齐的方向在 v5 **反过来了**
 *
 * ```
 * v4：房间边界 → 必须落在【格中心】上（墙以它为中心，正好封掉那一格）
 * v5：空间边界 → 必须落在【格边界】上（空间的格跨度直接就是矩形，墙是隔壁那一格）
 * ```
 *
 * 两种对齐对应两种几何来源，**拿旧那条去核新的图会把对的判成坏的**。
 * 两边的道理都在 `walkability.ts` 的 `navExtentFor` 里：原点吸附到格的整数倍之后
 * 相位是定死的，所以「落在格边界上」是一条能校验的硬规则。
 *
 * ⚠️ 但**障碍物那条没变，仍然是格边界** —— 因为障碍物从来就是「正好占满整格」。
 * 别看到「空间也改成格边界了」就把两条合成一条：合成之后改哪一条都会静默地
 * 连带改掉另一条，而它们各自守的是不同的事（空间是**可走的那一片**，
 * 障碍物是**占满格子的一件家具**）。
 *
 * ## 枚举合法性为什么要 `as readonly string[]`
 *
 * `DungeonMap` 是 TS 类型，所以 `kind` 在编译期已经是 `RoomKind` 了 ——
 * 但那正是这个校验器存在的理由：它要在**运行期**看住从存档 JSON、
 * 从别人手写的测试夹具里读进来的数据，那些数据没经过编译器。
 * 不 cast 的话 `includes` 会被 TS 优化成 `true`，检查形同虚设。
 */

import type { DungeonMap, Point, Rect, Room } from '../model/types'
import {
  DUNGEON_SCHEMA_VERSION,
  ROOM_KINDS,
  ROOM_KINDS_EMITTED,
  ROOM_KIND_LABELS,
} from '../model/types'
import type { RoomsConfig } from '../config'
import { isCombatKind } from '../config'
import { doorRect, left, rectContains, rectsIntersect, right, top, bottom } from '../model/rect'
import { chairBelongsTo } from '../model/furniture'
import { overlapsWithArea } from '../colliders'
import { MapValidationError, type MapErrorContext } from './errors'

export interface ContractReport {
  roomCount: number
  passageCount: number
  doorCount: number
  obstacleCount: number
  spawnPointCount: number
  /**
   * 每个空间（`Room.id` / `Passage.id`）到楼梯间的**跳数**。
   *
   * 这一份是**从地图自己重算出来的**，不是问生成器要的 —— 预算单调那条判据
   * 靠它，而拿生成器算好的距离去核生成器算好的预算等于什么都没验。
   */
  hopOf: Map<string, number>
}

/** 非负取模。`-1 % 40` 是 `-1`，不是 39 —— 对齐判定用得到。 */
function mod(a: number, n: number): number {
  return ((a % n) + n) % n
}

/**
 * 从楼梯间出发，每个空间的**跳数**。图的边与 `gen/layout.ts` 的 `hopDistances`
 * **必须是同一个图**，否则预算那条判据会报假警：
 *
 * - **门**：两端（房间或走廊）各连一次
 * - **走廊相接**：两段走廊矩形**含贴合相交** —— 这就是「相邻或重叠」，
 *   与 `floorPlan.ts` 里 `corridorAdjacent` 判的是同一件事（那边的坐标是格、
 *   这边是 px，是同一份数据的两种单位）。少了这一类，一条 6 段拼成的走廊
 *   会被判成 6 个孤岛，于是每一段都「比楼梯间远」—— 而它是错的。
 *
 * 走不到的空间**不进这张表**（不是填 `Infinity`）：填了的话预算那条判据会
 * 拿 `Infinity` 去比大小，恒真或恒假，而「这间房走不到」是**另一条**在报的事
 * （`validate/reachability.ts` 的层 1）。两处都报同一件事，读的人会以为有两个 bug。
 */
function hopsFromStairwell(map: DungeonMap): Map<string, number> {
  const adj = new Map<string, Set<string>>()
  const link = (a: string, b: string): void => {
    if (!adj.has(a)) adj.set(a, new Set())
    if (!adj.has(b)) adj.set(b, new Set())
    adj.get(a)!.add(b)
    adj.get(b)!.add(a)
  }

  const passageIds = new Set(map.passages.map((p) => p.id))
  for (const d of map.passages) {
    for (const o of map.passages) {
      if (o === d) continue
      if (rectsIntersect(d.rect, o.rect)) link(d.id, o.id)
    }
  }
  for (const room of map.rooms) {
    for (const door of room.doors) {
      // 两头都得是这一层里真的有的空间。少一头时**不连**：
      // 连到空气上会把下面的房间算得比实际更近，于是预算那条判据对着一个错的
      // 距离说「单调」，而它看着是绿的。door 端点是否合法由下面单独报。
      const aOk = map.rooms.some((r) => r.id === door.a) || passageIds.has(door.a)
      const bOk = map.rooms.some((r) => r.id === door.b) || passageIds.has(door.b)
      if (aOk && bOk) link(door.a, door.b)
    }
  }

  const start = map.rooms[0]?.id
  const dist = new Map<string, number>()
  if (start === undefined) return dist
  dist.set(start, 0)
  let frontier = [start]
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

/**
 * @param roomTotal 这一层**应当有几间房（含楼梯间）**。★ 新增 2026-10-22，
 *   从 `plan.roomTotal` 取 —— 详见下面「1. 数量」那一段。
 */
export function validateContract(
  map: DungeonMap,
  cfg: RoomsConfig,
  roomTotal: number,
): ContractReport {
  const cell = cfg.navCellSize
  const wt = cfg.wallThickness
  const ox = map.navOrigin.x
  const oy = map.navOrigin.y
  const n = map.rooms.length

  const fail = (path: string, message: string, context: MapErrorContext = {}): never => {
    throw new MapValidationError(path, message, { seed: map.seed, ...context })
  }

  /** 落在**格边界**上。v5 里空间的边界与障碍物的边界都要满足它（见文件头） */
  const onCellBoundary = (v: number, origin: number): boolean => mod(v - origin, cell) === 0

  const where = (path: string, r: Rect): string =>
    `${path} = ${r.width}×${r.height} @ (${r.x}, ${r.y})`

  // ------------------------------------------------------------ 0. 版本

  // 红线 3 的同一件事：数据带版本号是为了将来能迁移。版本对不上**必须显式处理**，
  // 不能靠"字段看起来还行"蒙混过去 —— 那正是迁移出错的形态。
  if (!Number.isInteger(map.schemaVersion)) {
    fail('schemaVersion', `要一个整数，拿到 ${JSON.stringify(map.schemaVersion)}`)
  }
  if (map.schemaVersion !== DUNGEON_SCHEMA_VERSION) {
    fail(
      'schemaVersion',
      `本版校验器只认 ${DUNGEON_SCHEMA_VERSION}，拿到 ${map.schemaVersion} —— ` +
        `迁移要显式写出来，不能靠字段名撞对了就放过。` +
        `⚠️ v4 → v5 是**语义变化**：同一串 rooms 在 v4 里是一条进度轴上的教室，` +
        `在 v5 里是一张平面图上的 16 间平权的房（见 model/types.ts 的 schemaVersion 表）`,
    )
  }

  // spec `map-reachability`「网格粒度一致」：
  // 校验器与运行时的格边长不一致时，两边判出的可走性不同，**而两边都不报错**。
  if (map.navCellSize !== cfg.navCellSize) {
    fail(
      'navCellSize',
      `地图用 ${map.navCellSize}px、配置是 ${cfg.navCellSize}px —— ` +
        `格边长必须唯一，否则「同一份可走性判定」只是函数名相同`,
    )
  }

  // ------------------------------------------------------------ 1. 数量

  // ⚠️ **这个数必须由调用方给，这个文件推不出来**（★ 改了 2026-10-22）：
  // 「这一层该有几间」随层走（6F 十六间、YF3 十五间），而它写在**平面图**里，
  // 正是这个文件看不见的那份。这里收的是一个**数**（调用方从 `plan.roomTotal`
  // 取），不是平面图本身 —— 收平面图等于把这个文件变成 `parseFloorPlan` 的
  // 复读机，而它存在的理由恰恰是「手里这份 map 可能不是生成器交出来的」。
  //
  // 楼梯间**算在里面**：`map.rooms` 里楼梯间是一间房（出生点在里面，
  // 打完首领下楼的入口也在里面）。曾经的教训是照着「编号教室数」去查 ——
  // 正确的是 16，报出来的却是「实际 16 ≠ 应为 15」这种**看着合理**的假警，
  // 而下一个人的修法就是把楼梯间从 rooms 里删掉。
  //
  // 两个数各管一头：`checkRoomCount`（`gen/floorPlan.ts`）管「平面图自己声明
  // 的间数 vs 它的几何」，这里管「手里这份 map vs 这一层的声明」——
  // 存档、迁移、手写夹具都要过后面这一关。
  if (n !== roomTotal) {
    fail('rooms', `这一层应有 ${roomTotal} 间房（含楼梯间），实际 ${n}`)
  }
  if (n === 0) fail('rooms', '一间房都没有')

  // ------------------------------------------------------------ 2. 空间 id 唯一

  // 门靠 id 指认两头（`Door.a` / `Door.b`），所以 id 重名会让「这扇门通向哪儿」
  // 有两个一样合法的答案。生成侧构造上不可能，但存档与手写夹具能。
  const spaceRect = new Map<string, Rect>()
  const roomIds = new Set<string>()
  const passageIds = new Set<string>()

  const addSpace = (id: string, rect: Rect, path: string, tag: string): void => {
    if (spaceRect.has(id)) {
      fail(
        path,
        `${tag} id「${id}」出现了两次 —— 门就是靠 id 指认空间的，` +
          `重名会让一扇门连到随机的那个，而且两边都不报错`,
      )
    }
    spaceRect.set(id, rect)
  }
  for (let i = 0; i < map.rooms.length; i++) {
    const r = map.rooms[i]!
    addSpace(r.id, r.rect, `rooms[${i}].id`, '房间')
    roomIds.add(r.id)
  }
  for (let i = 0; i < map.passages.length; i++) {
    const p = map.passages[i]!
    addSpace(p.id, p.rect, `passages[${i}].id`, '走廊')
    passageIds.add(p.id)
  }

  // ------------------------------------------------------------ 3. 逐间房

  const starts: Room[] = []
  const bosses: Room[] = []

  for (let i = 0; i < n; i++) {
    const room = map.rooms[i]!
    const at = (field: string): string => `rooms[${i}].${field}`
    const ctx: MapErrorContext = { roomOrder: room.order }

    // `order` 是**在 rooms 里的下标**、0 起连号。有洞就说明有人按数组下标当
    // 别的东西用了（v4 是进度轴，v5 只是显示序，但**连号这条没变**）。
    if (room.order !== i) {
      fail(at('order'), `order 必须从 0 起升序连号，第 ${i} 项的 order 是 ${room.order}`, ctx)
    }

    // spec `procgen-config-contract`「出现枚举外的类型时报错」
    if (!(ROOM_KINDS as readonly string[]).includes(room.kind)) {
      fail(
        at('kind'),
        `"${room.kind}" 不是合法类型。合法取值：${ROOM_KINDS.join(' / ')}` +
          `（本期生成器只产出：${ROOM_KINDS_EMITTED.join(' / ')}）`,
        ctx,
      )
    }
    if (room.kind === 'start') starts.push(room)
    if (room.kind === 'boss') bosses.push(room)

    // spec `procgen-config-contract`「非战斗房三空」
    //
    // 判据只有 `combatKinds`（`isCombatKind`），与生成器读的是**同一处** ——
    // 分开写一份关别名册的话，改一处忘一处就会生成出「摆了桌椅但一个怪都没有」
    // 的房，两边都不报错。
    const label = ROOM_KIND_LABELS[room.kind]
    if (!isCombatKind(cfg, room.kind)) {
      const why = `「${label}」不在 combatKinds（${cfg.combatKinds.join(' / ')}）里，是不打架的关别`
      if (room.obstacles.length > 0) {
        fail(at('obstacles'), `${why}，却摆着 ${room.obstacles.length} 件桌椅`, ctx)
      }
      if (room.spawnPoints.length > 0) {
        fail(
          at('spawnPoints'),
          `${why}，却有 ${room.spawnPoints.length} 个刷怪点 —— ` +
            `D1 的「进房关门、清完开门」在这里会永远等不到清空`,
          ctx,
        )
      }
      if (room.budget !== 0) {
        fail(at('budget'), `${why}，威胁预算却写着 ${room.budget} —— 一个没有敌人的场地没有威胁`, ctx)
      }
    }

    // ---- 尺寸契约：空间边界落在**格边界**上（v5 方向，见文件头 ⚠️）
    if (
      !onCellBoundary(left(room.rect), ox) ||
      !onCellBoundary(right(room.rect), ox) ||
      !onCellBoundary(top(room.rect), oy) ||
      !onCellBoundary(bottom(room.rect), oy)
    ) {
      fail(
        at('rect'),
        `${where(at('rect'), room.rect)} 的边界没落在格边界上 —— ` +
          `球心在 ${ox}（x）/ ${oy}（y） + ${cell}k 处。` +
          `v5 的空间矩形**就是它的格跨度**，墙是隔壁那一格；` +
          `偏半格的话墙与寻路的相位对不上，**寻路认为墙两侧都通而物理体照样挡人**`,
        ctx,
      )
    }

    // ---- 房间必须在包围盒里
    if (!rectContains(map.bounds, room.rect)) {
      fail(at('rect'), `${where(at('rect'), room.rect)} 超出了地图包围盒`, ctx)
    }

    // ---------------------------------------------------------- 门
    //
    // v5 的门是**无向**的：`a` / `b` 是它连的两个空间的 id，按字典序排好，
    // 没有「来」与「去」。旧模型的有向 `toOrder` 与三态 `kind`
    // （`back` / `forward` / `side`）随主干道一起作废 —— 它们表达的是
    // 「沿进度轴往前走还是回头」，而进度轴没有了。
    //
    // ⚠️ **奇偶那一条也作废了。** v4 要求门宽是**奇数格**，因为门心要落在
    // 格中心上（墙以门心为中心）。v5 里门格本身就是墙上挖掉的那几格、
    // 整格对齐，偶数格的门几何上完全成立 —— 留着这条会把对的门判成错的。
    const seenDoors = new Set<string>()
    for (let j = 0; j < room.doors.length; j++) {
      const d = room.doors[j]!
      const dp = `rooms[${i}].doors[${j}]`
      if (d.axis !== 'h' && d.axis !== 'v') {
        fail(`${dp}.axis`, `axis 只能是 'h' 或 'v'，拿到 ${JSON.stringify(d.axis)}`, ctx)
      }
      if (typeof d.a !== 'string' || d.a === '') {
        fail(`${dp}.a`, `要一个空间 id，拿到 ${JSON.stringify(d.a)}`, ctx)
      }
      if (typeof d.b !== 'string' || d.b === '') {
        fail(`${dp}.b`, `要一个空间 id，拿到 ${JSON.stringify(d.b)}`, ctx)
      }
      if (d.a === d.b) {
        fail(`${dp}`, `门的两端是同一个空间「${d.a}」—— 门是墙上挖掉的那几格，连着两个**不同**的空间`, ctx)
      }
      // 字典序：**不是语义的一部分**，是为了让「同一扇门」在任何两处读起来逐字相同。
      // 不排的话，同一扇门在生成器里是 `(YF601, C_W)`、在校验器里是 `(C_W, YF601)`，
      // 而两者相等与否要靠人去比 —— 那种相等迟早会被 `===` 判错，且不报错。
      if (!(d.a < d.b)) {
        fail(
          `${dp}`,
          `两端是 ("${d.a}", "${d.b}")，但 a 必须**按字典序在前** —— ` +
            `门是无向的，排好序是为了让同一扇门在任何两处读起来一模一样`,
          ctx,
        )
      }
      // 两端都得是**这一层里真的有的空间**。指到空气上时，
      // `collidersOf` 造出来的挡板照样存在（它只读门的坐标），
      // 于是那扇门看着完好无损，而它通不到任何地方。
      const known: string[] = []
      for (const id of [d.a, d.b]) if (!spaceRect.has(id)) known.push(id)
      if (known.length > 0) {
        fail(
          `${dp}`,
          `门的一端指向不存在的空间 [${known.join(', ')}]。` +
            `这一层里合法的 id 是房间（${map.rooms.length} 个）与走廊（${map.passages.length} 段）`,
          ctx,
        )
      }
      // 同一间房里同一扇门记两次：`collidersOf` 按几何去重，所以**多出来的那块
      // 挡板不会出现** —— 症状是「本层有几扇门」这个读数开始说谎。
      const key = `${d.a}|${d.b}`
      if (seenDoors.has(key)) {
        fail(`${dp}`, `同一扇门（${d.a} ↔ ${d.b}）在这间房的 doors 里记了两次`, ctx)
      }
      seenDoors.add(key)

      // 门格必须整格落在格边界上：`doorSideCells` 是按「门洞有几格」扫的
      // （`round(width / cell)`），偏半格时它会**扫错格子**，于是 flood fill
      // 的起点漏掉一格、「门通不通」只检查了一部分，**两边都不报错**。
      const alongStart = (d.axis === 'h' ? d.x : d.y) - d.width / 2
      const doorAlong0 = alongStart
      const doorAlong1 = alongStart + d.width
      const doorOrigin = d.axis === 'h' ? ox : oy
      if (!onCellBoundary(doorAlong0, doorOrigin) || !onCellBoundary(doorAlong1, doorOrigin)) {
        fail(
          `${dp}`,
          `门洞的两端 (${doorAlong0}, ${doorAlong1}) 没落在格边界上` +
            `（球心在 ${doorOrigin} + ${cell}k 处）—— 门的格数会被算错，` +
            `而 doorSideCells 找不到的那几格是无声地漏掉的`,
          ctx,
        )
      }
    }

    // ---------------------------------------------------------- 障碍物
    let obstacleArea = 0
    for (let j = 0; j < room.obstacles.length; j++) {
      const o = room.obstacles[j]!
      const op = `rooms[${i}].obstacles[${j}]`
      if (o.kind !== 'desk' && o.kind !== 'chair') {
        fail(`${op}.kind`, `障碍物只有 'desk' / 'chair'，拿到 ${JSON.stringify(o.kind)}`, ctx)
      }
      const r = o.rect
      if (r.width % cell !== 0 || r.height % cell !== 0) {
        fail(op, `${where(op, r)} 的边长不是 navCellSize（${cell}）的整数倍`, ctx)
      }
      // 障碍物边界落在**格边界**上（正好占满整格）。这一条与上面空间那条
      // **不是同一条**，见文件头 ⚠️。
      if (!onCellBoundary(left(r), ox) || !onCellBoundary(top(r), oy)) {
        fail(
          op,
          `${where(op, r)} 的位置没落在格边界上 —— ` +
            `那样它只盖住格中心的一部分，而寻路只看格中心：` +
            `看着能挤过去的缝，寻路可能认为整格封死`,
          ctx,
        )
      }
      if (!rectContains(room.rect, r)) {
        fail(op, `${where(op, r)} 长到了房间外面`, ctx)
      }

      const wc = r.width / cell
      const hc = r.height / cell
      if (o.kind === 'chair') {
        if (wc !== 1 || hc !== 1) {
          fail(op, `椅子恒为 1 格，拿到 ${wc}×${hc} 格`, ctx)
        }
      } else if (
        // ⚠️ 2026-10-16 起桌**宽**是一个区间（`deskWidthCells` ~ `deskWidthCellsMax`）：
        // 每组桌椅抽一次，同一间房里既有两格的桌也有三四格的 —— 形状不至于千篇一律。
        // 高度仍然恒定（`deskHeightCells`），椅子仍然恒为一格：那两条是「桌椅成组」
        // 这个形状本身的定义，改了它 `model/furniture.ts` 的配对就散了。
        wc < cfg.deskWidthCells ||
        wc > cfg.deskWidthCellsMax ||
        hc !== cfg.deskHeightCells
      ) {
        fail(
          op,
          `课桌宽 ${cfg.deskWidthCells}~${cfg.deskWidthCellsMax} 格、高恒为 ${cfg.deskHeightCells} 格，` +
            `拿到 ${wc}×${hc} 格 —— 尺寸超出契约，桌椅就是横七竖八的`,
          ctx,
        )
      }

      // spec `dungeon-layout`「障碍物不挡住门」
      for (let k = 0; k < room.doors.length; k++) {
        if (rectsIntersect(doorRect(room.doors[k]!, wt), r)) {
          fail(
            op,
            `${where(op, r)} 挡住了 rooms[${i}].doors[${k}] —— ` +
              `一张课桌正堵在门口，房间进得去出不来`,
            ctx,
          )
        }
      }

      obstacleArea += r.width * r.height
    }

    // 桌椅**成组**：每张桌正下方紧贴一把椅子，每把椅子恰好属于一张桌。
    //
    // 这不是风格建议 —— 画法（`model/furniture.ts`）与 D1 那张「桌 + 椅」贴图
    // 都建立在这条上：一张没有椅子的桌，画出来是**半件**家具；一把没有桌子的椅子，
    // 根本没有贴图可贴。生成侧构造上满足它（`gen/obstacles.ts` 一次推两件），
    // 这一条守的是**别处塞进来的**障碍物（D1 的宝箱落点、将来的新家具）。
    {
      const desks = room.obstacles.filter((o) => o.kind === 'desk')
      const chairs = room.obstacles.filter((o) => o.kind === 'chair')
      for (let j = 0; j < room.obstacles.length; j++) {
        const o = room.obstacles[j]!
        const op = `rooms[${i}].obstacles[${j}]`
        if (o.kind === 'chair') {
          if (!desks.some((d) => chairBelongsTo(o.rect, d.rect))) {
            fail(
              op,
              `${where(op, o.rect)} 是一把**孤零零**的椅子 —— 桌椅成组（一张桌 + ` +
                `正下方紧贴的一把椅子），它上面没有桌子`,
              ctx,
            )
          }
        } else if (!chairs.some((c) => chairBelongsTo(c.rect, o.rect))) {
          fail(
            op,
            `${where(op, o.rect)} 这张课桌底下没有椅子 —— 桌椅成组，` +
              `少了椅子画出来是半件家具（椅子贴在桌子正下方，横向落在桌子的跨度里）`,
            ctx,
          )
        }
      }
    }

    // spec `dungeon-layout`「障碍物密度受配置上限约束」
    const roomArea = room.rect.width * room.rect.height
    if (obstacleArea > roomArea * cfg.obstacleDensityMax + 1e-9) {
      fail(
        at('obstacles'),
        `障碍物占了 ${((obstacleArea / roomArea) * 100).toFixed(1)}%，` +
          `超过 obstacleDensityMax = ${cfg.obstacleDensityMax}（教室面积 ${roomArea}）`,
        ctx,
      )
    }

    // ---------------------------------------------------------- 出生点
    //
    // ★ 改了（v5）：**不再往里让半个墙厚。**
    // `Room.rect` 现在**就是**它的可走格跨度（v4 的矩形含墙，墙以边界为中心、
    // 各吃半层，所以那时要 `+ wt/2`）。照旧式子让 20px 的话，
    // **最外圈那一排格子会被整排判死** —— 它们的格心正好落在 `left + cell/2 = left + wt/2`，
    // 而判据是严格大于。实测种子 13：36 个出生点里 **8 个**落在那一圈上，
    // 也就是这条假警会拦住**大多数种子**（每个房间都有最外圈）。
    // 而它会报成「出生点不在教室内部」—— 读起来像生成器摆错了位置。
    const ix0 = left(room.rect)
    const ix1 = right(room.rect)
    const iy0 = top(room.rect)
    const iy1 = bottom(room.rect)
    for (let j = 0; j < room.spawnPoints.length; j++) {
      const p = room.spawnPoints[j]!
      const pp = `rooms[${i}].spawnPoints[${j}]`
      if (!(p.x > ix0 && p.x < ix1 && p.y > iy0 && p.y < iy1)) {
        fail(
          pp,
          `出生点 (${p.x}, ${p.y}) 不在教室内部 ` +
            `(x ∈ (${ix0}, ${ix1}), y ∈ (${iy0}, ${iy1}))`,
          { ...ctx, point: p },
        )
      }
      // 出生点落在格中心上 —— 「这一点算不算堵」的判定是按格中心做的
      // （见 `walkability.ts`）。出生点不在格中心上，那句话就答不了。
      if (mod(p.x - ox, cell) !== cell / 2 || mod(p.y - oy, cell) !== cell / 2) {
        fail(pp, `出生点 (${p.x}, ${p.y}) 没落在格中心上`, { ...ctx, point: p })
      }
    }
  }

  // ------------------------------------------------------------ 4. 走廊
  //
  // ★ v5 把这里的**大半都删了**。v4 在这一段钉死了「段数 = 主干数 − 1」
  // 「每段与主干教室等高」「每段的长度 = roomGap」「`between` 报的是相邻两间」——
  // 那四条说的都是「连廊是夹在两间教室之间的一小段」。
  //
  // v5 的走廊是一张**网**：段与段直接相接、拼成 S 形（6 段），段数不必凑成某个数，
  // 形状由平面图说了算。于是那四条**都没有意义了** —— 留着它们会把 6 段判成错
  // （`主干数 − 1` 今天是什么？连「主干数」都没有了）。
  //
  // 留下的只有一条：**走廊与房间不许重叠**。走廊段**之间**重叠是允许的
  // （它们是同一条走廊，见 floor-plan.json 的 `_gap_comment`），
  // 所以判据必须跳过走廊↔走廊那一对。
  for (let i = 0; i < map.passages.length; i++) {
    const p = map.passages[i]!
    const pp = `passages[${i}]`
    if (
      !onCellBoundary(left(p.rect), ox) ||
      !onCellBoundary(right(p.rect), ox) ||
      !onCellBoundary(top(p.rect), oy) ||
      !onCellBoundary(bottom(p.rect), oy)
    ) {
      fail(pp, `${where(pp, p.rect)} 的边界没落在格边界上`)
    }
    for (const room of map.rooms) {
      if (!overlapsWithArea(p.rect, room.rect)) continue
      fail(
        pp,
        `${where(pp, p.rect)} 与房间「${room.id}」**重叠**了 —— ` +
          `走廊是**并排**在房间旁边的空间，中间要空出整整 1 格（那一格才是墙）。` +
          `重叠时那一格墙不存在，寻路认为两侧都通而物理体挡着，**两边都不报错**`,
        { roomOrder: room.order },
      )
    }
  }

  // ------------------------------------------------------------ 5. 全局

  // ★ 改了（v5）：v4 的两条位置判据（`start` 在进度轴第一间、`boss` 在最后一间）
  // 换成了**计数**。理由：v5 里 `order` 只是「楼梯间 + 其余按 id 升序」的显示序，
  // **不是进度轴**（见 `model/types.ts` 的 `Room`），所以「order = n − 1」
  // 既不代表最深、也不代表最后打到。而它离首领房是哪一间也毫无关系
  // （首领恒为 `YF604`，它的 id 落在中间，见 `floor-plan.json`）。
  //
  // 「**恰有**一个」才是真的要求，而且是两条不同的要求：
  // - 一个 `start`：两个出生点意味着「玩家从哪一间开始」没有答案
  // - **至多**一个 `boss`：打完首领才能下楼 —— 两个首领就是两个出口
  if (starts.length !== 1) {
    fail(
      'rooms',
      `起点房（kind: 'start'）应当恰好有 1 间，实际 ${starts.length} 间：` +
        `[${starts.map((r) => r.id).join(', ')}]。` +
        `它是楼梯间，也就是玩家的出生点 —— 两间的话「从哪一间开始」就没有答案`,
    )
  }
  if (map.rooms[0]!.kind !== 'start') {
    fail(
      'rooms[0].kind',
      `第一间应是 'start'（楼梯间），拿到 '${map.rooms[0]!.kind}' —— ` +
        `order 是「楼梯间 + 其余按 id 升序」的显示序，所以起点恒在下标 0`,
      { roomOrder: 0 },
    )
  }
  // ★ 改了（2026-10-22 晚）：「**恰好** 1 间」放宽成「**至多** 1 间」——
  // **0 间首领房现在是合法的**。用户给第 1 层（逸夫楼 1F）的要求是
  // 「YF1 所有房间都是空房间，不生成任何东西」，那一层因此一间首领房都没有，
  // 而这不再等于「没有出口」：门槛改在 `BattleScene.bossDown()` 那一边 ——
  // **找不到首领房就当作已打倒**，楼梯间里的下楼口直接亮。
  // 这一层因此是「过渡层」：进来、走到楼梯间、上一层，没有必须清掉的东西。
  //
  // 守的还是那条真要求：**两个首领 = 两个出口**（玩家不知道打完哪个才开门），
  // 所以上界仍然是 1。「最后一层必须有首领」那条搬去了 `floors.test.ts`
  // —— 它是**一局**的性质（最后一层打不出首领就永远通不了关），
  // 不是单张平面图的性质，而这个校验器只看一张图。
  if (bosses.length > 1) {
    fail(
      'rooms',
      `首领房（kind: 'boss'）至多有 1 间，实际 ${bosses.length} 间：` +
        `[${bosses.map((r) => r.id).join(', ')}]。` +
        `打完首领才能下楼，所以两个首领就是两个出口 —— 玩家不知道打完哪一个才开门。` +
        `（**0 间是允许的**：那一层没有门槛，见 BattleScene.bossDown()）`,
    )
  }

  // spec `dungeon-pacing`「预算单调不减」—— ★ v5 换了判据。
  //
  // v4 沿**主干序号**比（那时房间排在一条进度轴上，序号越大越深）。v5 里
  // `order` 跟难度无关了，取而代之的量是**到楼梯间的跳数**：
  // 「离出生点越远越强」才是这句话在真实平面图上的意思。
  //
  // 判据写成「**不同跳数之间不许出现反序**」，而不是「按跳数排序后逐个不减」：
  // 后者在同跳数内部比较，而同一跳数的几间房今天预算恰好相等**只是当前公式
  // 的产物**（`threatBudget(hop, maxDist)` 是 hop 的纯函数）。哪天有人给预算
  // 加一点同层噪声，逐个比会立刻报假警，而那时真正要守的「远的不许更弱」并没有破。
  // 所以按跳数分组取**组内最大**，只比组间。
  const hopOf = hopsFromStairwell(map)
  const maxBudgetAtHop = new Map<number, number>()
  for (const room of map.rooms) {
    // 非战斗关的钱恒为 0，拿它们进来会立刻违反单调 —— 而那是在报「道具房比战斗房弱」，
    // 一句正确的废话。
    if (!isCombatKind(cfg, room.kind)) continue
    const h = hopOf.get(room.id)
    // 走不到的房间不进这张表：那是 reachability 层 1 在报的事，两处都报会显得有两个 bug
    if (h === undefined) continue
    maxBudgetAtHop.set(h, Math.max(maxBudgetAtHop.get(h) ?? 0, room.budget))
  }
  const hopLevels = [...maxBudgetAtHop.keys()].sort((a, b) => a - b)
  for (let i = 1; i < hopLevels.length; i++) {
    const prevHop = hopLevels[i - 1]!
    const curHop = hopLevels[i]!
    const prev = maxBudgetAtHop.get(prevHop)!
    const cur = maxBudgetAtHop.get(curHop)!
    if (cur < prev) {
      fail(
        `rooms[${map.rooms[0]!.order}].budget`,
        `威胁预算按「离楼梯间多远」定强弱，但跳数 ${curHop} 的预算（${cur}）` +
          `低于跳数 ${prevHop} 的（${prev}）—— 更远却更弱。` +
          `生成侧那条式子在 gen/budget.ts 的 threatBudget（按 hop / maxDist 插值）`,
      )
    }
  }

  return {
    roomCount: n,
    passageCount: map.passages.length,
    doorCount: map.rooms.reduce((s: number, r: Room) => s + r.doors.length, 0),
    obstacleCount: map.rooms.reduce((s: number, r: Room) => s + r.obstacles.length, 0),
    spawnPointCount: map.rooms.reduce((s: number, r: Room) => s + r.spawnPoints.length, 0),
    hopOf,
  }
}

/** 便利：房间的出生点数组里有没有落在这个点上的（校验与测试共用）。 */
export function spawnPointAt(room: Room, p: Point): boolean {
  return room.spawnPoints.some((q) => Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6)
}