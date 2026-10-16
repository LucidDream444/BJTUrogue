/**
 * 把 **D2 生成的一层楼**，拆成 **D1 认的「一间房 = 一关」**。
 *
 * ## 为什么是「一间房 = 一关」而不是一整个大地图
 *
 * D2 的房间是 640×280，D1 的竞技场是 1344×832 —— 差 6 倍。真做成一张连通的大地图，
 * 玩家尺寸、移动速度、刷怪间距、寻路格子全都要重调一遍，而那些数现在都是调好的。
 *
 * 拆成一间一关之后：
 *
 * - **`CombatSession` 一行都不用改** —— 它只读 `stageConfig`，
 *   而 `enterStage(n)` 本来就是「换几何 → 重建碰撞 → 找落脚点 → 挪人」这一套。
 *   门外那一步就是 `enterStage(下一间)`。
 * - **`StageBackground` 一行都不用改** —— 它画的就是 `stageGeometry(config, n, …)`。
 *
 * 两个域的接口因此收在一处：**这个文件**。
 *
 * ## 每间房交出去的东西
 *
 * | 项 | 来源 | 少了会怎样 |
 * |---|---|---|
 * | 实体（墙 / 课桌 / 椅子） | `collidersOf().solids` **裁进本间取景框** | 隔壁房间的桌子挡在本间里 |
 * | 门洞挡板 | `collidersOf().barriers` 同法裁 | 门开着，怪顺着洞走出去打不着 |
 * | 出生点 | `room.spawnPoints` 里离房间中心最近的 | 站到墙里 |
 * | 要不要打 | `roomNeedsFight()` | 道具关把玩家关死在里面 |
 *
 * ⚠️ **碰撞一律从 `collidersOf()` 里裁，不要从 `map.walls` / `room.obstacles` 各推一遍。**
 * 那两个数组正是 `solids` 的来源（见 `colliders.ts` 文件头「一座楼只有这一份」）。
 * 在这儿重推一遍就是第二份会漂的事实：D2 哪天把某类家具挪出挡人列表，
 * 这里会照旧挡着，而那个样子看起来像「碰撞体没跟着更新」。
 *
 * ## 取景框为什么要留边
 *
 * 口径逐字抄 `procgen/presentation/framing.ts` 的 `roomFitSize`：`wallThickness`
 * 让**墙整条**落在框里（切掉半条墙的话，那一侧的碰撞体一半在框外，
 * `clipRect` 会把它裁短，于是墙看起来「薄了一半」）；半格 `navCellSize`
 * 让门和门外那一点点露出来。
 *
 * 不用 `roomViewBox()` —— 那个会把门外的连廊、侧室整块并进来，
 * 并进来之后教室在屏上只剩一半。
 */
import { collidersOf, type DoorBarrier } from '@/domains/procgen/colliders'
import { generateDungeon } from '@/domains/procgen/gen/generate'
import { Rng } from '@/core/rng'
import { bottom, clipRect, containsPoint, left, rectFromCorners, right, top } from '@/domains/procgen/model/rect'
import { fitMapFrame } from './StageGeometry'
import type { RoomsConfig } from '@/domains/procgen/config'
import type { DungeonMap, Point, Rect, Room } from '@/domains/procgen/model/types'
import { roomNeedsFight } from '@/domains/procgen/roomFlow'
import type { CombatConfig } from './config'
import type { SolidRect, StageCollisionConfig, StageLayout } from './StageGeometry'

export interface DungeonRoom {
  /** 0 起。**D1 的关号是它 + 1** —— `enterStage()` 吃的是关号。 */
  readonly order: number
  readonly room: Room
  /** 这一间要不要打（`roomNeedsFight`：关别要打 **且** 有刷怪点）。 */
  readonly needsFight: boolean
  /** 取景框（地图坐标），调试读数用。 */
  readonly box: Rect
  /** 本间在**取景框坐标**里的矩形 —— 观感层用它铺地板（框减去它就是「墙外」）。 */
  readonly rectInBox: Rect
  /**
   * 本间的每一扇门通向第几间（0 起；`null` = 尽头），**顺序与 solids 里
   * `door-…` 那几条一致**。观感层靠它把门外那一小块涂成下一间的颜色 ——
   * 这样玩家在门开着的时候能**看见隔壁是什么关别**，而不是两眼一抹黑。
   */
  readonly doorTargets: readonly (number | null)[]
  /** 本间每扇门在**地图坐标**里的位置（和 `doorTargets` 同序）。小地图靠它画出拓扑。 */
  readonly doorRects: readonly Rect[]
  /**
   * 本间的刷怪点，**已经换算到竞技场坐标**（D1 的敌人系统用的是这一套）。
   *
   * ⚠️ **别再用「以玩家为圆心撒一圈」那套。** D1 原来是 `cx + cos(a)*250`，
   * 而竞赛场是 1344×832 的大场子、D2 的房间只有 520×280 —— 250px 的半径
   * 直接把怪撒在玩家脸上，**开局被围死、跑都跑不掉**。
   * D2 的刷怪点是按房间量出来的，而且「每一个都从门可达」（那边 `types.ts` 的原话）。
   *
   * 玩家的出生点是**离房间中心最近的那个**刷怪点，所以这里把它排在最前面 ——
   * 刷怪时跳过它，免得怪直接生在玩家身上。
   */
  readonly spawnPoints: readonly { x: number; y: number }[]
}

export interface DungeonStages {
  readonly map: DungeonMap
  readonly stages: StageCollisionConfig
  /** 整层的门洞挡板。**没裁进任何一间** —— 开合状态由场景按 `ownerOrder` 判。 */
  readonly barriers: readonly DoorBarrier[]
  readonly rooms: readonly DungeonRoom[]
}

/**
 * **一个洞口连通哪两间房 —— 从几何算，不看 `ownerOrder` / `toOrder`。**
 *
 * D2 的 `collidersOf()` 是**按洞口去重**的（那边文件头写着）：一个洞口只出一条，
 * `ownerOrder` 只是「谁先被扫到」。所以拿 `toOrder` 当唯一真值会出两类错：
 *
 * - 一层里大部分洞口只有单向记录，照它走会以为「B 没有回 A 的门」；
 * - 而我早先的兜底（缺哪条补哪条）**可能把同一个洞口补成两条**，
 *   表现就是「两扇门通向同一间」。
 *
 * 门的**位置**是可信的（墙上那个洞就在那儿），所以连通关系直接量：
 * 沿门的法线往两边各跨一段，落进哪两间房，这个洞就连通哪两间。
 * **按构造不可能不对称** —— 因为它本来就是对称的（一个洞有两面）。
 *
 * ## ⚠️ 门**不一定通向房间** —— 它可能通向「连廊」
 *
 * 实测 seed 1 的第 1 间（侧室，x 220~620）：它上边那面墙上有个洞在 x=540，
 * 而 x=540 的正上方是**连廊**（房间 0 到 x=420 就结束了、房间 2 从 x=620 才开始）
 * —— 不是任何一间房。这类门**只探得到一侧**，于是会被下面的 `length === 2` 滤掉。
 *
 * **别为了让它们凑出两侧而加兜底**（换另一根轴再探一次）—— 我加过，
 * 结果是沿错轴探到了**假的邻居**：那间房的两扇门于是都指向同一间，
 * 而真正的邻居反而回不去。探不到就是「这门通向连廊」，丢掉它对这一层模型是对的
 * （这一版没有把连廊当一格，见文件头）。
 */
function sidesOfOpening(
  rect: Rect,
  rooms: readonly Room[],
  cfg: RoomsConfig,
): number[] {
  // ⚠️ **门开在哪面墙上，看门洞自己的形状**：竖墙上的洞是**高**的。
  //
  // 早先用的是 D2 的 `DoorBarrier.axis` —— 但那个字段的语义（`'v'` 是「墙竖直」
  // 还是「洞竖直」）从名字上看不出来，而按它探会**探到斜对面的房间**：
  // 表现是「左边的门和下面的门都通向下面那一间，左边的 A 回不去了」。
  // 形状没有歧义，而且是从位置本身推出来的 —— 位置本来就比字段可信。
  const alongX = rect.height >= rect.width
  const steps = [cfg.roomGap, cfg.roomGap * 1.5, cfg.roomGap * 2, cfg.roomGap * 3].map(
    (d) => d + cfg.wallThickness,
  )
  const probe = (dirX: boolean, sign: number): number | null => {
    for (const step of steps) {
      const p = dirX
        ? { x: rect.x + sign * step, y: rect.y }
        : { x: rect.x, y: rect.y + sign * step }
      const hit = rooms.find((r) => containsPoint(r.rect, p.x, p.y))
      if (hit) return hit.order
    }
    return null
  }
  const out: number[] = []
  for (const sign of [1, -1]) {
    const hit = probe(alongX, sign)
    if (hit !== null && !out.includes(hit)) out.push(hit)
  }
  return out
}

/** 0.01px 的零头是浮点噪声，留着只会让读数上下跳。 */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * 一间房的取景框：房间 + 一整条墙 + **隔壁**。
 *
 * 外扩量 = `wallThickness + navCellSize/2 + roomGap`：
 *
 * | 这一段 | 为什么 |
 * |---|---|
 * | `wallThickness` | 让**墙整条**落在框里。切掉半条的话那一侧的碰撞体会被裁短，墙看起来「薄了一半」 |
 * | `navCellSize/2` | 半格门外 —— 门与门框之间那一丁点 |
 * | **`roomGap`** | **让隔壁的墙和一小条地板走进框里。** 这就是「房间拼接」那层观感：站在门口看得见下一间的地一直铺过去、并带着它自己的边框 |
 *
 * ⚠️ 这个量**不是随手加的**，它还兼任「比例尺」：`fitMapFrame()` **会放大**
 * （没有 1.0 上限），外扩只有 60 时比例是 **2.08×** —— 房间被放大一倍、
 * 玩家相对只有一半大，而且隔壁全在框外。加上 `roomGap` 之后比例回到 **≈1.04**，
 * 也就是 D2 测试场那个 1:1 的口径。
 */
function boxOf(room: Room, cfg: RoomsConfig): Rect {
  const margin = cfg.wallThickness + cfg.navCellSize / 2
  return rectFromCorners(
    left(room.rect) - margin,
    top(room.rect) - margin,
    right(room.rect) + margin,
    bottom(room.rect) + margin,
  )
}

/**
 * 地图一块 → 盒子一块（左上角原点）。`null` = 这一块整个在盒子外。
 *
 * `dx` / `dy` 是**这一间的平移量**：把它的取景框挪到公共盒子正中，
 * 于是宽窄不同的房间都居中、缩放也只有一个。算错了**不报错** ——
 * 房间会偏一边，而偏一边看起来像「生成器把房间摆歪了」。
 */
function toBoxRect(r: Rect, dx: number, dy: number, id: string): SolidRect | null {
  const x = round2(left(r) + dx)
  const y = round2(top(r) + dy)
  const x1 = round2(right(r) + dx)
  const y1 = round2(bottom(r) + dy)
  if (x1 <= x || y1 <= y) return null
  return { id, x, y, width: round2(x1 - x), height: round2(y1 - y) }
}

/**
 * 地图**一个点** → 盒子坐标。
 *
 * ⚠️ 点不能借 `toBoxRect()` 走 —— 那个吃的是**中心点约定**的 `Rect`，
 * `left(r)` 会先减掉半个宽；拿一个 `width: 1` 的假矩形去装一个点，
 * 结果正好偏 0.5px，两个轴一起偏就是 0.707px。
 */
function toBoxPoint(p: Point, dx: number, dy: number): Point {
  return { x: round2(p.x + dx), y: round2(p.y + dy) }
}

/** 离房间中心最近的刷怪点。**不是离取景框中心** —— 两个场子要读到同一个数。 */
function nearestSpawn(room: Room): Point | null {
  let best: Point | null = null
  let bestDist = Infinity
  for (const p of room.spawnPoints) {
    const d = (p.x - room.rect.x) ** 2 + (p.y - room.rect.y) ** 2
    if (d < bestDist) {
      bestDist = d
      best = p
    }
  }
  return best
}

/**
 * **本局每一层的种子**：一局是多层楼，每层都要一张**不一样**的随机地图。
 *
 * 从同一个 `runSeed` 里抽 `floors` 个种子，于是：
 *
 * - **同一个 `runSeed` → 同一组种子** —— 报出 `runSeed` 就能复现整局（每一层都是同一张图）；
 * - **相邻两层不会撞成同一张图** —— 直接拿 `runSeed + floor` 当种子的话，
 *   只要房间尺寸档位是「按种子取档」的，相邻两层会长得极像（差 1 的种子在
 *   低位上几乎一样）。这里是走一遍 `Rng`，第 n 个种子与第 n+1 个之间没有可预测的关系。
 *
 * ⚠️ **必须 `Rng`，不能 `Math.random()`** —— 那样 `runSeed` 就复现不出这一局了。
 */
export function floorSeeds(runSeed: number, floors: number): number[] {
  const rng = new Rng(runSeed)
  return Array.from({ length: Math.max(1, floors) }, () => rng.between(0, 0x7fffffff))
}

/**
 * 生成一层楼并拆成 D1 的关卡表。**纯函数**（零 Phaser、零场景），node 下可直接单测。
 *
 * @param seed 种子。同一个种子 + 同一份 `roomsCfg` → 完全相同的一层楼
 * @param roomsCfg 已校验的 `rooms.json`（`parseRoomsConfig` 过了才传进来）
 * @param d1 D1 的配置，只为拿 `terrain.navigationCellSize`
 */
export function buildDungeonStages(
  seed: number,
  roomsCfg: RoomsConfig,
  d1: CombatConfig,
): DungeonStages {
  const map = generateDungeon(seed, roomsCfg)
  const boxes = map.rooms.map((room) => boxOf(room, roomsCfg))
  const box = {
    width: Math.max(...boxes.map((b) => b.width)),
    height: Math.max(...boxes.map((b) => b.height)),
  }
  const col = collidersOf(map, roomsCfg)
  // 房间几何 → 竞技场坐标要用的那把尺子。和 `StageGeometry.stageGeometry()` 同一套
  // （`fitMapFrame`），所以刷怪点和墙、出生点在同一个坐标系里。
  const frame = fitMapFrame(d1.arena.width, d1.arena.height, box.width, box.height)
  const toArena = (p: Point, dx: number, dy: number) => ({
    x: frame.x + (p.x + dx) * frame.scale,
    y: frame.y + (p.y + dy) * frame.scale,
  })
  // 每个洞口**两侧都建一条**，通向哪一间由几何算 —— 于是每间房拿到的门是一份
  // 从它自己看出去的完整列表，且天然对称。
  const openings = col.barriers
    .map((b) => ({ rect: b.rect, axis: b.axis, kind: b.kind, sides: sidesOfOpening(b.rect, map.rooms, roomsCfg) }))
    .filter((o) => o.sides.length === 2)

  const rooms: DungeonRoom[] = []
  const stageList: (StageLayout & { furniture: [] })[] = []
  map.rooms.forEach((room, i) => {
    const own = boxes[i]!
    // 取景框挪到公共盒子正中
    const dx = (box.width - own.width) / 2 - left(own)
    const dy = (box.height - own.height) / 2 - top(own)

    // ⚠️ **必须用裁剪后的矩形，不能用原始的**。墙是「一整条」——房间四边各一条，
    //    而取景框只比房间大 wallThickness + 半格。直接用 `c.rect`，那条墙会伸到
    //    框外一截，于是 solids 里出现越界的矩形，D1 的校验器当场拒绝
    //    （`stage-collisions: 碰撞范围越界或标识重复`）。
    const inside = col.solids
      .map((c) => clipRect(c.rect, own))
      .filter((r): r is Rect => r !== null)
    // 门洞也填成实体：不填，门开着的时候怪会顺着洞走出去，而玩家追不出去。
    //
    // 门按 **`ownerOrder`（开在哪一间的墙上）** 取，不按几何裁 —— 顺带就拿到了
    // 「这扇通向第几间」（`toOrder`），观感层要用它把门外那一小块涂成下一间的颜色。
    // 裁一遍就把结果和 `toOrder` 一起收下，**不裁两遍** —— 两遍就是第二份会漂的事实。
    const doors: Rect[] = []
    const doorTargets: (number | null)[] = []
    const doorRects: Rect[] = []
    // ⚠️ **通向连廊的洞口要封死**，不能只是「不当作门」。
    //
    //    这类洞的另一侧不是房间（是连廊），所以它在 `openings` 里被滤掉了 ——
    //    但墙上那个洞**还在**。不封的话玩家能从那儿**走出房间**，
    //    走到一片没有地板、没有边界的地方去（表现就是「侧室边界不全被包围」）。
    //    这一版是「一间房一屏」，连廊不是一格，房间之间靠 F 过门；
    //    所以连廊那一侧的口子就该当作**墙**。
    const seals: Rect[] = []
    for (const b of col.barriers) {
      const sides = sidesOfOpening(b.rect, map.rooms, roomsCfg)
      if (sides.length === 2) continue
      if (!sides.includes(room.order)) continue
      const r = clipRect(b.rect, own)
      if (r !== null) seals.push(r)
    }
    for (const o of openings) {
      if (!o.sides.includes(room.order)) continue
      const r = clipRect(o.rect, own)
      if (r === null) continue
      doors.push(r)
      doorTargets.push(o.sides.find((s) => s !== room.order) ?? null)
      doorRects.push(o.rect)
    }

    // ⚠️ 门的 id 要**留得住**：观感层靠 id 前缀分辨「这块是门」，
    //    全叫 `s1-0` 的话门和墙画成一个色，玩家打完一间找不到门出不去。
    const solids = [
      ...inside.map((r, n) => [r, `s${room.order + 1}-${n}`] as const),
      ...doors.map((r, n) => [r, `door-${room.order + 1}-${n}`] as const),
      // 封口用 `wall-` 前缀，观感层才会把它画成墙的颜色（见 `StageBackground` 的 colorFor）
      ...seals.map((r, n) => [r, `wall-seal-${room.order + 1}-${n}`] as const),
    ]
      .map(([r, id]) => toBoxRect(r, dx, dy, id))
      .filter((r): r is SolidRect => r !== null)

    const spawnMap = nearestSpawn(room) ?? { x: room.rect.x, y: room.rect.y }
    // 玩家占掉最近的那个刷怪点，其余的留给怪
    const spawnPoints = room.spawnPoints
      .map((p) => toArena(p, dx, dy))
      .sort((a, b) => {
        const da = (a.x - toArena(spawnMap, dx, dy).x) ** 2 + (a.y - toArena(spawnMap, dx, dy).y) ** 2
        const db = (b.x - toArena(spawnMap, dx, dy).x) ** 2 + (b.y - toArena(spawnMap, dx, dy).y) ** 2
        return da - db
      })
    rooms.push({
      spawnPoints,
      order: room.order,
      room,
      needsFight: roomNeedsFight(room, roomsCfg),
      box: own,
      rectInBox: {
        x: round2(left(room.rect) + dx),
        y: round2(top(room.rect) + dy),
        width: room.rect.width,
        height: room.rect.height,
      },
      doorTargets,
      doorRects,
    })
    stageList.push({
      stage: room.order + 1,
      playerSpawn: toBoxPoint(spawnMap, dx, dy),
      solids,
      // 家具是 D1 手绘图里那套「一坨能缩放的部件」；D2 的几何本来就是事实，
      // 没有需要缩放的东西 —— 空数组是 D1 校验器明确接受的形状。
      furniture: [],
    })
  })

  return {
    map,
    rooms,
    barriers: col.barriers,
    stages: {
      // 网格口径用 **D1 自己的那个**（`combat.json` 的 `terrain.navigationCellSize`）：
      // 这份 `StageCollisionConfig` 是 D1 的东西、进的是它的 `TerrainMap`。
      // 换成 D2 的 `navCellSize`（40）等于「D1 的网格跟着地图的可变参数走」——
      // D2 的墙按 40 对齐、D1 的网格是 32，差半格的地方会多出或少掉一排格子，**且不报错**。
      navigationCellSize: d1.terrain.navigationCellSize,
      schemaVersion: 1,
      sourceSize: { width: box.width, height: box.height },
      stages: stageList,
    },
  }
}
