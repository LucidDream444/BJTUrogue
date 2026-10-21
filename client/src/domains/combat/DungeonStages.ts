/**
 * 把 **D2 生成的一层楼**，交成 **D1 认的一张整层几何**。
 *
 * ## ★ 2026-10-21：从「一间房 = 一关」改成「**整层连续**」
 *
 * 上一版把一层楼拆成 16 屏，过门 = `enterStage(下一间)`。那个拆法有一个**前提**：
 * 门通向另一间房。v5 的 `floor-plan.json` 把 16 扇门**全部**改成了「房间 ↔ 走廊」，
 * 前提当场不成立 —— `sidesOfOpening()` 只在 `map.rooms` 里找，走廊不是 `Room`，
 * 于是每扇门都只探得到一侧、全被当成「通向连廊的洞」**封死**，
 * `doorTargets` 恒空 → 按 F 无处可去 → **玩家出不了第一间房**（且不抛任何错）。
 *
 * 用户 2026-10-21 拍板走 **「A 整层连续（按平面图玩）」**：战斗场景直接跑在 D2 的
 * 平面图上，走廊与房间是**同一张连续地图里的真实空间**，出生点在楼梯间门外的走廊上，
 * 走到哪扇门就进哪一间。于是这个文件交出去的东西整个换了形状：
 *
 * | | 上一版 | 现在 |
 * |---|---|---|
 * | `stages` | 16 关，每关一间房、各自一个取景框 | **恰好 1 关 = 整层**，无取景框 |
 * | 坐标 | 每间的取景框坐标（`dx` / `dy` 挪到公共盒子正中） | **地图坐标原样**，一格不挪 |
 * | 缩放 | `fitMapFrame(1344, 832, 1920, 1160)` ≈ 0.70 | **1:1**（`sourceSize` = 竞技场） |
 * | 门 | 裁进本间、编成 `door-…` 实体，靠 `doorTargets` 指路 | **不进 `solids`** —— 是 D1 手里的可开关挡板 |
 * | 出生点 | 「离房间中心最近的那个刷怪点」 | **楼梯间门外那条走廊上** |
 * | `DoorBarrier` 的 `toId` | 只用来判「是不是通向房间」 | **走廊段 id**，再也不需要探两侧 |
 *
 * ## 为什么 `sourceSize` 就等于整层尺寸：`fitMapFrame` 会**自然退化成恒等**
 *
 * `stageGeometry()` 拿 `fitMapFrame(arena.width, arena.height, sourceSize.width, sourceSize.height)`
 * 算缩放与平移。两者相等时 `scale = 1`、`x = y = 0`，于是：
 *
 * - 所有矩形**原样**出来，地图坐标就是世界坐标 —— 少一层换算就少一处会静默偏掉的错；
 * - `frame_top` / `frame_bottom` / `frame_left` / `frame_right` 那四块**不会被 emit**
 *   （条件是 `frame.x > 0` / `frame.y > 0`），正好 —— 整层的外沿是物理世界边界
 *   （`physics.world.setBounds`）而不是四块人造的墙。
 *
 * ⚠️ 这条等式是**这一版成立的地基**。谁要把 `arena` 改回 1344×832，
 * 整层会在一瞬间被缩到七分之一并居中，而且**什么都不报** —— 看起来像「地图没加载」。
 *
 * ## 竞技场就是 `map.bounds`，而 `bounds` 的左上角必须是 (0,0)
 *
 * 世界坐标 = 地图坐标 = 从 `map.bounds` 的左上角起算。`floor-plan.json` 从格 (0,0)
 * 开始画，所以今天 `left(bounds) === top(bounds) === 0`，这一条是**恒等的**。
 *
 * 但它不是假设出来的：`stageGeometry` 要求每个实体的 `x >= 0 且 x + width <= arena.width`
 * （`parseStageCollisions` 的 `validRect`）。平面图哪天往左上挪出 (0,0)，
 * 这里会**当场被 D1 的校验器拒掉**，而不是整层悄悄偏掉 80px。
 * **宁可当场炸，不要静默偏。**
 *
 * ## 墙的两个方向：`map.walls` 往外多铺 2 格，那 2 格在这里被裁掉
 *
 * `walls` 含平面图外围整整 2 格（`navExtentFor` 给的余量，为了让贴着地图边缘的
 * 房间不在寻路网格的外沿上）。那 2 格**在世界之外**：裁掉它们不打开任何通路
 * （它们本来就在所有空间的外面），而留着它们会让 `validRect` 的 `x >= 0` 不成立。
 * 世界的外沿由 `physics.world.setBounds` 与 `isWalkable` 的边界判据一起兜住。
 */
import { collidersOf } from '@/domains/procgen/colliders'
import { generateDungeon } from '@/domains/procgen/gen/generate'
import type { FloorPlan } from '@/domains/procgen/gen/floorPlan'
import { Rng } from '@/core/rng'
import {
  bottom,
  clipRect,
  containsPoint,
  left,
  rectFromCorners,
  right,
  top,
} from '@/domains/procgen/model/rect'
import type { RoomsConfig } from '@/domains/procgen/config'
import type { DungeonMap, Door, Point, Rect, Room } from '@/domains/procgen/model/types'
import { roomNeedsFight } from '@/domains/procgen/roomFlow'
import type { CombatConfig } from './config'
import type {
  SolidRect,
  StageBarrier,
  StageCollisionConfig,
  StageLayout,
} from './StageGeometry'

/**
 * **整层只有一关**，关号恒为它。
 *
 * 留着「关」这个概念（而不是把 `StageCollisionConfig` 也换掉）是**故意的**：
 * `TerrainMap` / `StageColliders` / `parseStageCollisions` 那一整套吃的都是它，
 * 而它们关心的是「一份几何 + 一个落脚点」，与「一间房」从来不是一回事。
 * 换成整层之后那一整套**一行都不用改** —— 这也正是当初选它做接口的回报。
 */
export const FLOOR_STAGE = 1

/**
 * 一扇门：挡板的几何（世界坐标 = 地图坐标，**左上角**，与 `StageBarrier` 同一份）
 * 加上它开在谁身上、以及朝向。
 *
 * ⚠️ **`axis` 是「人穿过它的方向」**（`Door.axis` 的原话），不是门的长边方向。
 * 判「玩家站在这扇门前没有」要按**矩形**量距离，不是按中心点 ——
 * 门洞长边 120px，站在一端时离中心 60px，按中心判就会漏。见 `BattleScene.doorAhead()`。
 */
export interface DoorBrief extends StageBarrier {
  readonly axis: 'h' | 'v'
}

export interface DungeonRoom {
  /** = `Room.order`。**不是关卡号** —— 整层只有一关，它只是「第几间房」 */
  readonly order: number
  readonly room: Room
  /** 这一间要不要打（`roomNeedsFight`：关别要打 **且** 有刷怪点）。 */
  readonly needsFight: boolean
  /**
   * 本间的刷怪点，**世界坐标**。`spawnPoints[0]` 离房间中心最近的那个是
   * 「玩家站的那一个」，刷怪时跳过它（与 D2 `nearestSpawn()` 同一个口径）。
   */
  readonly spawnPoints: readonly Point[]
  /** 开在这一间身上的门（世界坐标）。今天恒为 1 扇。 */
  readonly doors: readonly DoorBrief[]
}

export interface DungeonStages {
  readonly map: DungeonMap
  /** **恰好一关**：整层的墙 + 家具（`stages[0].barriers` 是整层的门）。 */
  readonly stages: StageCollisionConfig
  /** 整层的每一扇门：几何 + 归属 + 朝向。与 `stages[0].barriers` 是同序同值。 */
  readonly doors: readonly DoorBrief[]
  readonly rooms: readonly DungeonRoom[]
  /** 玩家出生点：**楼梯间门外那条走廊上**（用户 2026-10-21 的原话） */
  readonly spawn: Point
  /**
   * 楼梯间那一间房的矩形（`x` / `y` 是**中心**，见 `model/types.ts`）。
   *
   * ★ 改了（2026-10-21）：原来只给一个中心点（`Point`）。用户把楼梯间定成
   * 「每层之间的中转站」之后，里面要摆**两个**入口（上一层 / 下一层），
   * 而两个入口摆在哪儿要看这一间**多大**（`stairPadSpots()` 按它钳制）——
   * 只给中心点的话，那个函数只能拿到一个「往两边各挪多少」的常数，房间一小就出墙。
   */
  readonly stairwell: Rect
}

/**
 * 界面上「整层是多大」的两个数 —— **就是 `map.bounds` 的尺寸**（世界坐标从它的左上角起）。
 *
 * 提出来是因为 `BattleScene` 要在**建场景之前**就知道它（物理世界边界、相机边界、
 * `cfg.arena` 都得是它）。从 `dungeon.map.bounds` 现推也行，但那样就有两处推法。
 */
export function arenaOf(map: DungeonMap): { width: number; height: number } {
  return { width: map.bounds.width, height: map.bounds.height }
}

/**
 * `(x, y)` 落在哪一间房里；不在任何一间（走廊里）给 `null`。
 *
 * `inset`：把每间房的矩形**四边各收进去这么多**再判。用在两个地方：
 *
 * 1. 玩家「**进来了没有**」—— `inset = 玩家半径`。取 0 的话，人刚跨过门口那条线
 *    （身体还有一截留在门洞里）就算「进来了」，而那一刻会**同时**发生两件事：
 *    刷怪 + 封门。封门是把门洞那一格变成实体，而玩家的身体正压在上面 ——
 *    物理会把他弹一下。收进去一个半径，封门时人已经整个在房里，一点不弹。
 * 2. 小地图上「现在在哪一间」—— 同一个 `inset`，于是**「门开了一半」在两处都不算进来**。
 *    两处共用一个判据，比各写一遍强：分岔的那天表现是「小地图说在房里、门却还没封」。
 *
 * ⚠️ **走廊不是房**，所以「在走廊里」返回 `null` 是正确答案，不是失败。
 */
export function roomAt(
  rooms: readonly DungeonRoom[],
  x: number,
  y: number,
  inset = 0,
): DungeonRoom | null {
  for (const unit of rooms) {
    const r = unit.room.rect
    if (
      x >= left(r) + inset &&
      x <= right(r) - inset &&
      y >= top(r) + inset &&
      y <= bottom(r) - inset
    )
      return unit
  }
  return null
}

/**
 * 宝箱该摆在哪：玩家身前 `lift` 像素，但**夹进 `unit` 这一间**里（四周各留 `half`）。
 *
 * ⚠️ 那个「夹」不是保险，是**必需**的：进门是在玩家**刚跨过门口**那一刻判定的
 * （`roomAt()` 要求身体整个进到房里），这时玩家离门外的走廊只有十几像素 ——
 * 「玩家上面 60px」正好落在**墙外**。而走廊和房里一样是可走地面，
 * `TerrainMap.safeSpawn()` 看不出区别（它只认地面不认墙），宝箱就摆到门外去了。
 *
 * 纯函数、零依赖：node 下可直接单测（`DungeonStages.test.ts` 拿 8 个种子逐间验）。
 */
export function chestSpotIn(
  unit: DungeonRoom,
  x: number,
  y: number,
  lift: number,
  half: number,
): Point {
  const r = unit.room.rect
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  return {
    x: clamp(x, left(r) + half, right(r) - half),
    y: clamp(y - lift, top(r) + half, bottom(r) - half),
  }
}

/**
 * **不用打的那些房（道具关 / 宝箱关）里，宝箱摆在房间正中心。**
 *
 * 与上面那个「玩家身前 60px」是**两种**摆法，各有各的理由，别合并：
 *
 * - 精英关那个是**打完怪那一刻**掉的，它要的是「在你眼前出现」→ 跟玩家走；
 * - 道具关 / 宝箱关是**推门进去取东西**的房，它要的是「一眼看见它在这儿」。
 *
 * ⚠️ 用「玩家身前 60px」摆这一类房是**错的**，而且错得很稳定（用户 2026-10-21 报的
 * 「宝箱生成和显示有问题」）：进门是在玩家**刚跨过门口**那一刻判定的
 * （`roomAt()` 要求身体整个进到房里），所以「身前」永远等于**贴着刚进来的那扇门**，
 * 而 `chestSpotIn()` 的 clamp 还会把它贴在门口的墙上 —— 实测离房间中心 240—260px，
 * 人站在自己刚进来的门口时，宝箱**正好画在他头上**。
 *
 * ⚠️ 正中心**只对非战斗房成立**：`gen/obstacles.ts` 对非战斗关别早返回空房
 * （「没有敌人的房间里，一模一样的课桌只是占地方、还把宝箱的落点挤掉」），
 * 所以中心一定是空地。**别把这个函数用到会摆桌椅的房间上** ——
 * 那时中心可能正好是一张课桌，而 `safeSpawn()` 会把它挪开几十像素，
 * 挪完之后「正中心」这个承诺就只剩个近似。
 *
 * 纯函数、零依赖：node 下按 8 个种子逐间验（`DungeonStages.test.ts`）。
 */
export function chestSpotAtCenter(unit: DungeonRoom): Point {
  // `Rect` 的 `x` / `y` **就是中心点**（`model/types.ts` 的约定），不用再加半个宽。
  return { x: unit.room.rect.x, y: unit.room.rect.y }
}

/**
 * **楼梯间门外那条走廊上**的一个点。
 *
 * 判据是**几何**，不是字段：从门洞中心往两侧各迈几格，落进哪一段走廊就是哪一段。
 * 不读 `Door.a` / `Door.b` —— `colliders.ts` 已经写过一次「位置本来就比字段可信」
 * （`sidesOfOpening` 那段把 `axis` 换成了量形状），这里照同一条走。
 *
 * 步长取 `navCellSize` 的整数倍：**门就骑在一格墙上**，所以第 1 步正好落在门外那一格的格心。
 *
 * ⚠️ 先迈 **2 格**、再退回 1 格、最后才试 3 格。先 1 格的话落脚点离墙只有 40px，
 * 而玩家半径 16 —— 判据是 `containsPoint`（**含边界**），门框那一格一有风吹草动
 * 就会在「在走廊里」与「在墙里」之间跳。2 格（80px）离墙远、又还在门正前方。
 */
function corridorPointAt(door: Door, map: DungeonMap, cell: number): Point {
  // 沿**人穿过它的方向**迈步：`axis === 'h'`（门开在水平墙上）→ 人沿 y 穿过。
  // 读 `axis` 而不是比 `width` / `height`：`Door` 上就只有这一个字段在说方向，
  // 而比宽高等于从形状里**再推一遍**同一件事 —— 两处推法迟早会有一处推反，
  // 而推反的表现是「出生点算在墙里」，看起来像平面图画错了。
  const alongX = door.axis === 'v'
  for (const step of [2, 1, 3]) {
    for (const sign of [1, -1]) {
      const p = alongX
        ? { x: door.x + sign * step * cell, y: door.y }
        : { x: door.x, y: door.y + sign * step * cell }
      if (map.passages.some((q) => containsPoint(q.rect, p.x, p.y))) return p
    }
  }
  const ids = map.passages.map((p) => p.id).join(', ')
  throw new Error(
    `楼梯间的门（${door.a} ↔ ${door.b}）两侧 ${3 * cell}px 内都没有走廊（这一层有：${ids}）——` +
      `出生点算不出来。门的位置是 (${door.x}, ${door.y})`,
  )
}

/** 把一块地图矩形裁进世界，再把 `x` / `y` / `width` / `height` 四舍五入到 0.01px。 */
function toSolid(rect: Rect, id: string, world: Rect): SolidRect | null {
  const r = clipRect(rect, world)
  if (r === null) return null
  return {
    id,
    x: Math.round(left(r) * 100) / 100,
    y: Math.round(top(r) * 100) / 100,
    width: Math.round(r.width * 100) / 100,
    height: Math.round(r.height * 100) / 100,
  }
}

/**
 * 生成一层楼，交成 D1 的一张整层几何。**纯函数**（零 Phaser、零场景），node 下可直接单测。
 *
 * @param seed 种子。**它只决定内容**（关别、障碍物、刷怪点）—— 几何与种子无关
 * @param roomsCfg 已校验的 `rooms.json`（`parseRoomsConfig` 过了才传进来）
 * @param plan 已校验的 `floor-plan.json`（`parseFloorPlan` 过了才传进来）。
 *   几何的唯一真值，「这一层楼长什么样」全在它里面，**不由种子算出来**
 * @param d1 D1 的配置，只为拿 `terrain.navigationCellSize`
 */
export function buildDungeonStages(
  seed: number,
  roomsCfg: RoomsConfig,
  plan: FloorPlan,
  d1: CombatConfig,
): DungeonStages {
  const map = generateDungeon(seed, roomsCfg, plan)
  const arena = arenaOf(map)
  // 世界矩形 = 竞技场。四边各自从 bounds 的左上角/右下角取，别写死 0（见文件头）。
  const world = rectFromCorners(left(map.bounds), top(map.bounds), right(map.bounds), bottom(map.bounds))
  if (left(world) !== 0 || top(world) !== 0) {
    // 这一条不是形式：`stageGeometry` 要求每个实体都落在 [0, arena] 里，
    // 左上角不为 0 的话整层要么被裁掉一片、要么被校验器拒掉。
    // 与其让它以「某个房间莫名少了一半」的形式出现，不如在这里说清楚。
    throw new Error(
      `整层的包围盒不贴在 (0,0) 上（左上角是 ${left(world)}, ${top(world)}）——` +
        `世界坐标的起点必须是它，见 DungeonStages.ts 文件头。` +
        `修 floor-plan.json 的坐标原点，或在这里加一次平移（**两处只能有一处**）。`,
    )
  }
  const col = collidersOf(map, roomsCfg)

  // ---- 实体：墙 + 课桌 + 椅子，一次全给。整层只有这一份。
  //
  // id 按种类带前缀（`wall-` / `desk-` / `chair-`）：观感层按前缀上色，
  // 而 `StageGeometry` 的校验器只要「唯一且非空」。**别改成 `s0` / `s1`** ——
  // 那样墙和课桌在画面上一个色，而「哪条是墙」是玩家唯一能读到的地形。
  const counters: Record<string, number> = {}
  const solids: SolidRect[] = []
  for (const c of col.solids) {
    const n = (counters[c.kind] = (counters[c.kind] ?? 0) + 1)
    const solid = toSolid(c.rect, `${c.kind}-${n}`, world)
    if (solid !== null) solids.push(solid)
  }
  if (!solids.length) throw new Error('整层一块碰撞体都没有 —— 生成器或裁剪出了问题')
  const ids = new Set(solids.map((s) => s.id))
  if (ids.size !== solids.length) throw new Error('碰撞体标识重复')

  // ---- 门：按 `ownerOrder` 归到各间房。门**不进 solids**（见文件头）。
  //
  // ⚠️ **`DoorBarrier.rect` 的 `x` / `y` 是中心点**（`colliders.ts` 的约定），
  //    而 `StageBarrier` 是**左上角**（与 `SolidRect` 一起进 `StageColliders`，
  //    两者差半个身位、而**两种都画得出来**）。转换就在这一行做完，
  //    别处一律按左上角读 —— 门洞正好是「墙厚 × 门宽」，所以左上角 = 中心 − 半宽。
  const doors: DoorBrief[] = col.barriers.map((b) => ({
    ownerOrder: b.ownerOrder,
    toId: b.toId,
    axis: b.axis,
    x: b.rect.x - b.rect.width / 2,
    y: b.rect.y - b.rect.height / 2,
    width: b.rect.width,
    height: b.rect.height,
  }))

  // ---- 出生点：楼梯间门外那条走廊上。
  const stairRoom = map.rooms.find((r) => r.kind === 'start')
  if (!stairRoom) throw new Error("这一层没有楼梯间（kind === 'start'）—— 出生点无从而来")
  if (!stairRoom.doors.length)
    throw new Error(`楼梯间 ${stairRoom.id} 一扇门都没有 —— 出生点算不出来（门外得先有走廊）`)
  const spawn = corridorPointAt(stairRoom.doors[0]!, map, roomsCfg.navCellSize)
  // 直接给整间房的矩形，不是它的中心：上下两个入口摆在哪儿要按这一间的大小算
  // （`Stairwell.stairPadSpots()`）。中心仍然读 `rect.x` / `rect.y`（`Rect` 的约定）。
  const stairwell = stairRoom.rect

  // ---- 每间房交出去的那一份。★ 没有再「换算到竞技场坐标」这一步了：世界坐标就是地图坐标。
  const rooms: DungeonRoom[] = map.rooms.map((room) => ({
    order: room.order,
    room,
    needsFight: roomNeedsFight(room, roomsCfg),
    spawnPoints: [...room.spawnPoints].sort(
      (a, b) =>
        (a.x - room.rect.x) ** 2 +
        (a.y - room.rect.y) ** 2 -
        ((b.x - room.rect.x) ** 2 + (b.y - room.rect.y) ** 2),
    ),
    doors: doors.filter((d) => d.ownerOrder === room.order),
  }))

  const layout: StageLayout & { furniture: [] } = {
    stage: FLOOR_STAGE,
    playerSpawn: spawn,
    solids,
    // 门**不进 `solids`**（见文件头）：它们会进寻路网格，把整层切成孤岛。
    barriers: doors.map((d) => ({
      ownerOrder: d.ownerOrder,
      toId: d.toId,
      x: d.x,
      y: d.y,
      width: d.width,
      height: d.height,
    })),
    // 家具是 D1 手绘图里那套「一坨能缩放的部件」；D2 的几何本来就是事实，
    // 没有需要缩放的东西 —— 空数组是 D1 校验器明确接受的形状。
    furniture: [],
  }

  return {
    map,
    rooms,
    doors,
    spawn,
    stairwell,
    stages: {
      // 网格口径用 **D1 自己的那个**（`combat.json` 的 `terrain.navigationCellSize`）：
      // 这份 `StageCollisionConfig` 是 D1 的东西、进的是它的 `TerrainMap`。
      navigationCellSize: d1.terrain.navigationCellSize,
      schemaVersion: 1,
      // ⚠️ **必须等于竞技场**，否则 `fitMapFrame` 会开始缩放整层，见文件头。
      sourceSize: { width: arena.width, height: arena.height },
      stages: [layout],
    },
  }
}

/**
 * **本局每一层的种子**：一局是多层楼，每层都要一张**不一样**的随机地图。
 *
 * 从同一个 `runSeed` 里抽 `floors` 个种子，于是：
 *
 * - **同一个 `runSeed` → 同一组种子** —— 报出 `runSeed` 就能复现整局（每一层都是同一张图）；
 * - **相邻两层不会撞成同一张图** —— 直接拿 `runSeed + floor` 当种子的话，
 *   相邻两层会长得极像（差 1 的种子在低位上几乎一样）。这里是走一遍 `Rng`。
 *
 * ⚠️ 两层之间**只有内容不同**（关别 / 障碍物 / 刷怪点），几何是一模一样的
 * —— `floor-plan.json` 画死了这一层楼。所以「换层」在画面上是「换了桌椅和怪」，
 * 不是「换了一张地图」。
 *
 * ⚠️ **必须 `Rng`，不能 `Math.random()`** —— 那样 `runSeed` 就复现不出这一局了。
 */
export function floorSeeds(runSeed: number, floors: number): number[] {
  const rng = new Rng(runSeed)
  return Array.from({ length: Math.max(1, floors) }, () => rng.between(0, 0x7fffffff))
}

/**
 * 把「一组 `Room.order`」翻成「一组 `Room.id`」—— **每帧现翻，不许缓存成字段**。
 *
 * ⚠️ **它是通用换算，不是「走过」专用的。** 名字原来是 `visitedRoomIds`，
 * 而 `BattleScene` 里**同时**有「去过没有」（`visited`，喂小地图的「走过 N / 16 间」）
 * 和「打完没有」（`cleared`，喂地上的房号和门色）两份，两份都走这个函数。
 * 名字只提 `visited` 的时候，第二处调用看起来就像「把 visited 又翻了一遍」——
 * 2026-10-21 用户报的「刚进普通关还没打怪就显示已清」正是那么来的（见 `StageBackground`）。
 *
 * ⚠️ **不许缓存。** 缓存的话就有两个真值来源，而序号那一份每帧都在变 ——
 * 分岔的那天不会报错，只会有一间房在小地图上一直灰着或一直绿着。
 * 整层 16 间，一次 `Set` 构造是常数级的小事。
 *
 * ⚠️ **认不出来的下标直接跳过，不抛**：换层的那一瞬间集合里可能还留着上一层的位置，
 * 拿它去索引新层的房间会越界 —— 而越界在 JS 里读出来是 `undefined`，
 * 拼进 `Set` 里就是一条永远匹配不上的垃圾 id，**不报错**。
 */
export function roomIdsOf(
  orders: ReadonlySet<number>,
  rooms: readonly DungeonRoom[],
): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const order of orders) {
    // ⚠️ **下标就是 `order`** 这条前提由 `DungeonStages.test.ts` 钉着
    // （生成器按平面图序推，两者相等）。破了的话这里是**静默错位一整间**。
    const id = rooms[order]?.room.id
    if (id !== undefined) ids.add(id)
  }
  return ids
}

