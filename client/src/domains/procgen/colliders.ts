/**
 * **从地图派生的碰撞几何** —— 谁该挡住谁，一次算清楚，只有这一份。
 *
 * 纯函数，零 Phaser 依赖（和 `walkability.ts` 同一个层次、同一个理由）。
 *
 * ## 它回答什么
 *
 * | 问题 | 读哪里 |
 * |---|---|
 * | 玩家/怪撞上去会停的东西 | `solids` |
 * | 子弹撞上去会停的东西 | `bulletStoppers` |
 * | 门洞里那块**可开关**的挡板 | `barriers` |
 *
 * ⚠️ **拿它建物理体之前，先看 `docs/地牢生成设计.md` §4.2 末尾那张「八个坑」表**
 * （坐标系、中心点 vs 左上角、体必须进 Group、静态体不跟着 GameObject 走……）。
 * 八个坑的症状**全是「没有报错」**：不崩、控制台干干净净，只是东西挡不住。
 *
 * ## 为什么是函数，不是 `DungeonMap` 上多几个字段
 *
 * 派生数据写进地图 = 同一件事有两个真值来源，而且**多出来的字段会跟着 `schemaVersion` 走**
 * —— 改一次碰撞分组的口径就得升一次版本、让 D1/D3 跟着动。放在函数里，
 * 改了只影响读到新版本代码的人。地图上已有的三样（`walls` / `Room.doors` /
 * `Room.obstacles`）**已经够推出全部答案**，一个字段都不用加。
 *
 * ## 为什么不让每个消费者自己推
 *
 * 「墙列表里哪几段挡子弹」「门洞那块矩形长什么样」这两件事各有好几个写法，
 * 而**写错了不会报错**：
 *
 * - 椅子漏进挡弹列表 → 子弹在椅子前面停住，看起来像「枪卡了」
 * - 门挡板偏半格 → 门缝里能挤过去一个人，看起来像「碰撞没生效」
 * - 门挡板数错（同一洞口记了两次，见下）→ 多出一块看不见的墙
 *
 * ## ⚠️ 同一个洞口在数据里可能出现**两次**，这里只出一块挡板
 *
 * `Room.doors` 按「谁在门的两端」建（`gen/layout.ts`）：**「房间 ↔ 房间」的门
 * 会在两间房的 `doors` 里各出现一次**，两扇说的是同一个洞。
 * 墙上那个缺口只挖一次（挖两次等于挖一次），但**照着 `doors` 逐个造挡板就会造两块**。
 * 两块重叠的挡板不会崩、也不影响手感，只是**多算一份物理**，而且让「本层有几扇门」
 * 这个读数从此开始说谎。
 *
 * 所以 `barriers` 按**几何**去重（`axis + 位置 + 宽`），不按 `ownerOrder`：
 * 后者本来就是分岔的那一维。
 *
 * ⚠️ **今天这一条是空转的** —— `floor-plan.json` 里 16 扇门全部是「房间 ↔ 走廊」，
 * 而走廊不是 `Room`（没有 `doors` 数组），所以每个洞口只被记了一次。
 * 留着去重不是洁癖：删掉它的代价是**下一个人加一扇房间互通的门时才会暴露**，
 * 而那时的症状是「凭空多出一块看不见的墙」，与这里毫无关联。
 */

import type { RoomsConfig } from './config'
import { clipRect, doorRect, left, top } from './model/rect'
import type { Door, DungeonMap, Rect, Room } from './model/types'

/**
 * 一块碰撞矩形**是什么东西**。
 *
 * 存在的唯一理由是 `desk` 与 `chair` 的分岔：**课桌挡子弹、椅子不挡**
 * （`openspec/specs/procgen-config-contract/spec.md` 里那一条）。
 * 两者对**移动**完全一样 —— 所以 `solids` 里两种都在，分岔只体现在 `bulletStoppers`。
 */
export type ColliderKind = 'wall' | 'desk' | 'chair'

export interface ColliderRect {
  readonly kind: ColliderKind
  /** 世界坐标，`x` / `y` 是**中心点**（与地图其余部分同一约定） */
  readonly rect: Rect
}

/**
 * 门洞里的一块**挡板**。
 *
 * D2 交的是**几何**，不是行为：这块矩形正好填住门洞（墙厚 × 门宽），
 * 封门 = 让它变成实体，开门 = 撤掉它。**开关状态不在数据里、也不该在**
 * —— 地图是只读的，而「这一扇现在关着没有」是运行时的事，归 D1。
 *
 * 判「要不要封」的输入也一并带上：`ownerOrder` 是门洞**开在哪一间**的墙上
 * （清场开门要按房判），`toId` 是它通向哪个空间。
 *
 * ★ 改了（v5）：删掉了 `kind`（`back` / `forward` / `side`）与 `toOrder`。
 * 那两个字段是**主干道模型**的产物 —— 它们表达的是「沿进度轴往前走还是回头」，
 * 而 v5 里进度轴没有了（玩家在走廊里随意走、随意挑房间进）。
 * 今天每一扇门都是「房间 ↔ 走廊」，所以 `ownerOrder` 恒为**那间房**的序号，
 * `toId` 恒为一段走廊的 id。**不留着 `toOrder: null` 占位**：
 * 一个恒为 null 的字段会让消费方那边「按它分支」的代码静默地什么都不做，
 * 而删掉它至少是个编译错误。
 */
export interface DoorBarrier {
  /** 门洞那块矩形。**正好填住墙上的缺口** —— 不压在两侧的墙上，也不留缝 */
  readonly rect: Rect
  readonly axis: 'h' | 'v'
  /** 这扇门开在**第几间房**的墙上（`Room.order`）。清场开门就是按它判的 */
  readonly ownerOrder: number
  /** 另一头是哪个空间 —— `Room.id` 或走廊段 id（今天恒为后者，如 `'C_W'`） */
  readonly toId: string
}

export interface MapColliders {
  /**
   * **挡移动的**：墙 + 课桌 + 椅子，全都在里面。
   *
   * ⚠️ **给玩家，不要给怪。** 怪走的是寻路网格（运行时那份由 D1 的 `TerrainMap` 喂给
   * `EnemySystem`，见 `walkability.ts` 文件头那段更正 —— **不是**本域的 `gridOfMap`），
   * 撞墙只是兜底；给几百只怪逐个接 `collider`，每一次分离力都要做一次碰撞解算
   * （《Phaser3性能与引擎事实》§5）。**怪只吃 `isWalkable`。**
   *
   * 但两边的口径**必须一致**（`walkability.ts` 文件头那条链子）：`solids` 里的
   * 墙与桌椅，在网格上也必须是堵的。各推一遍就会出现「怪绕着一张桌子走、
   * 玩家撞在空气上」这种两边都不抛异常的场面。
   */
  readonly solids: readonly ColliderRect[]
  /**
   * **挡子弹的**：墙 + 课桌，**椅子不在里面**。
   *
   * 椅子挡人不挡弹是刻意的（《地牢生成设计》§三）：子弹能扫过一排椅子，
   * 于是「躲在椅子后面」不是掩体，而「躲在课桌后面」是 —— 两种室内家具的区别
   * 必须能从手感上看出来，否则 `kind` 就白分了。
   */
  readonly bulletStoppers: readonly ColliderRect[]
  /**
   * 门洞挡板，**一个洞口一块**（见文件头那条 ⚠️）。
   * 顺序稳定（按 `ownerOrder`，同间按 `x` / `y`），所以读数与截图可比。
   */
  readonly barriers: readonly DoorBarrier[]
}

/**
 * 把一层楼推成碰撞几何。
 *
 * `cfg` 只用来取一个数：`wallThickness` —— 门洞那块矩形的厚度。
 * 它**不在 `DungeonMap` 上**（地图只记结果，不记配置），所以只能从外面传。
 */
export function collidersOf(map: DungeonMap, cfg: RoomsConfig): MapColliders {
  const solids: ColliderRect[] = map.walls.map((rect) => ({ kind: 'wall' as const, rect }))
  for (const room of map.rooms) {
    for (const o of room.obstacles) solids.push({ kind: o.kind, rect: o.rect })
  }

  return {
    solids,
    // 分岔只有这一行。**不要**把它写成 `solids.filter(挡弹)` 之外的任何东西 ——
    // 两个列表必须从**同一份 `solids`** 派生，各扫一遍地图就会出现
    // 「有一件家具在挡弹列表里、不在挡人列表里」这种谁也想不出来的状态。
    bulletStoppers: solids.filter((c) => c.kind !== 'chair'),
    barriers: barriersOf(map, cfg),
  }
}

/**
 * 门洞挡板：**按洞口去重**。
 *
 * 键取 `axis` + 位置 + 宽，坐标**取到 0.1px**（`.toFixed(1)`）。
 * 不取整到 1px：门洞的坐标本来就落在格边界上（40 的倍数 ± 半格 = 20 的倍数），
 * 不会有半个像素的零头；反倒是取整会把「差 0.4px 的两扇门」错并成一扇，
 * 而那种错**看不出来**（两扇门本来就重叠）。
 */
function barriersOf(map: DungeonMap, cfg: RoomsConfig): DoorBarrier[] {
  const seen = new Set<string>()
  const out: DoorBarrier[] = []
  for (const room of map.rooms) {
    for (const d of room.doors) {
      const rect = doorRect(d, cfg.wallThickness)
      const key = `${d.axis}:${rect.x.toFixed(1)}:${rect.y.toFixed(1)}:${rect.width.toFixed(1)}:${rect.height.toFixed(1)}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(barrier(rect, d, room))
    }
  }
  out.sort(
    (a, b) =>
      a.ownerOrder - b.ownerOrder ||
      top(a.rect) - top(b.rect) ||
      left(a.rect) - left(b.rect),
  )
  return out
}

function barrier(rect: Rect, d: Door, room: Room): DoorBarrier {
  // 另一头：`a` / `b` 是**字典序**排好的两个空间名，这里取的是「不是这间房的那一头」。
  //
  // ★ 改了（v5 复核）：旧注释说「取 a」/「取 b」会随字母顺序选中房间那一侧或走廊那一侧
  // —— **实测为假**。走廊 id 一律以 `'C_'` 开头，字典序排在**全部**房间 id
  // （`'STAIR'` / `'YF6xx'`）之前（`'C_W' < 'YF601'`、`'C_W' < 'STAIR'` 都成立），
  // 所以今天 16 扇门里 `a` **恒是走廊**、`b` **恒是房间**（`d.a === room.id` 一次都不成立）：
  // 「恒取 a」与现在这个写法 16/16 逐项相同、「恒取 b」16/16 会指回房自己 ——
  // **不是各错一半**。显式比较这一头留着，是因为这里问的本来就是「另一头」：
  // 房间 ↔ 房间 的门（见文件头 ⚠️）一旦出现，`a` / `b` 两头都是房间，
  // 「恒取 a」在 id 较小那间房的记录上会把 `toId` 指成房自己。
  return { rect, axis: d.axis, ownerOrder: room.order, toId: d.a === room.id ? d.b : d.a }
}

/**
 * 「**第几间房的门**」→「**第几号挡板**」。
 *
 * ## 为什么需要它
 *
 * 物理层拿到的是一个**数组**，开关门的接口也是按下标来的
 * （`ArenaBase` 的 `DoorBarrierControl.setClosedAt(index, …)`）。
 * 而「清完这间的怪，把这间的门打开」这句话里说的是 `ownerOrder`。
 * 中间那一步 —— 把房间号翻成下标 —— 就是这里。
 *
 * ## 为什么不各自推
 *
 * 推错的两种写法都**不会报错**：**差一**（`index + 1`）会让「开这间」开到隔壁；
 * **忘了跳过重复洞口**（「房间 ↔ 房间」的门在两间房上各记一次，见文件头 ⚠️）
 * 会让所有下标从某一间开始整体偏移。两种都表现为「门开了，但不是那一扇」，
 * 而看画面只会以为是判定写错了。
 *
 * ## 为什么参数是 `barriers` 本身，不是 `(map, cfg)`
 *
 * 因为它算出来的下标**必须**对齐调用方手里那个数组。传 `barriers` 进来，
 * 「你交给物理层的是哪一份，映射就照哪一份算」是**语法上**成立的；
 * 传 `(map, cfg)` 的话，函数内部会重新 `collidersOf()` 一次，
 * 那就等于假设调用方交出去的正是这一份 —— 一个不会报错的假设。
 *
 * `collidersOf()` 产出的 `barriers` 已经按 `ownerOrder` 排好序，
 * 所以同一间的下标是连续的一段；这里不依赖那一点，逐项收集即可。
 */
export function barrierIndicesByRoom(
  barriers: readonly DoorBarrier[],
): Map<number, number[]> {
  const out = new Map<number, number[]>()
  barriers.forEach((b, index) => {
    const list = out.get(b.ownerOrder)
    if (list) list.push(index)
    else out.set(b.ownerOrder, [index])
  })
  return out
}

/**
 * 两个矩形有没有**面积**相交（贴合不算）。
 *
 * `rectsIntersect` 是**含贴合**的（那是对的，见它的注释：留 0px 缝在物理上就是留了缝），
 * 但挡板贴着两侧的墙是**设计**，不是错误 —— 用含贴合的判定会把每一块挡板都报成错的。
 * 所以这里退回 `clipRect`：交不出面积就是「只是贴着」。
 *
 * **导出**：测试要用同一个判据。测试里自己写一份的话，判据一分叉，
 * 「挡板压墙」这种事会变成两边各自都对。
 */
export function overlapsWithArea(a: Rect, b: Rect): boolean {
  return clipRect(a, b) !== null
}

