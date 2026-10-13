/**
 * 楼层平面：主干道 + 主干教室 + 侧室 + 门 + 墙。**纯函数，零 Phaser 依赖。**
 *
 * ---
 *
 * ## 平面长这样
 *
 * ```
 *              （北侧教室）
 *    ┌──────┐┌────┐┌──────┐        ┌──────┐
 *    │ 后台 ││侧室││      │        │ 首领 │
 *    └──┬───┘└─┬──┘└──┬───┘        └──┬───┘
 *   ════╧══════╧══════╧═══════════════╧══════   ← 主干道（横向，贯穿整层）
 *    ┌──┴───┐┌─┴──┐┌──┴───┐        ┌──┴───┐
 *    │      ││    ││      │        │      │
 *    └──────┘└────┘└──────┘        └──────┘
 *              （南侧教室）
 * ```
 *
 * ## 三条几何规则，每条都在堵一个具体的坑
 *
 * **① 主干教室交替挂在南北两侧。** 于是相邻两间永远分属不同侧，
 * 侧室就有位置放 —— 见 ②。
 *
 * **② 侧室紧挨着它的宿主教室，同一侧、下一个位置，中间隔 0px。**
 * 这一条是「入口来自宿主教室的侧门」唯一能不拐弯地落地的排法：
 * 两间房共用一道墙，墙上一扇门，左边是宿主、右边是侧室。
 * 侧室再开一扇门朝走廊，出去就是主干道 —— 那就是「出口汇回主干下一间」。
 *
 * 错开一格的排法（比如侧室放到对面一侧）看起来更省地方，但那样
 * 「从宿主进去」就得靠一条 L 形通道绕，而矩形模型表达不了 L 形。
 *
 * **③ 整个楼从 `x = 半格` 起排。** 于是每堵墙的中心线都落在**格中心**上
 * （寻路格的中心在 `20 + 40n`），一堵墙恰好封掉一格，不多不少；
 * 每个门洞的两端都落在**格边界**上（`40n`），一扇门恰好开出整数格。
 *
 * ③ 看着像强迫症，它是三个「不报错但会坏事」的坑的总闸：
 *
 * | 没对齐会怎样 | 症状 |
 * |---|---|
 * | 墙中心落在格边界上 | 一格中心都不覆盖 → **寻路认为墙两侧都通**（墙上有洞） |
 * | 门洞两端落在格中心上 | 实际能过的格子数**比设计多一个**（`80px` 的门过 3 格） |
 * | 障碍物没对齐 | 看着能挤过去的缝，寻路认为整格封死 |
 *
 * ## 墙是**数据**，不是各消费方自己推导的
 *
 * 返回的 `walls` 是一段段矩形。D1 拿它建物理碰撞体，寻路拿它判可走性。
 * 两处各推一次的话，一边少推一段就是「玩家从缝里走出去了」或者
 * 「怪卡在一个看不见的角里」—— 都不报错。
 */

import type { Door, Rect, Room, RoomBranch, RoomKind } from '../model/types'
import type { RoomsConfig } from '../config'
import { rngFor } from './seed'
import { threatBudget } from './budget'

/** 一个区间的半开表示：`[start, end)`，两端都落在格边界上（见文件头 ③） */
interface Span {
  start: number
  end: number
}

export interface LayoutPlan {
  rooms: Room[]
  corridorRect: Rect
  walls: Rect[]
  bounds: Rect
  mainCount: number
}

/** 生成过程中用的中间结构。对外只吐 `Room`。 */
interface Desc {
  order: number
  kind: RoomKind
  branch: RoomBranch
  /** 主干序号（0 = 起点，mainCount−1 = 首领）；侧室为 null */
  mainIndex: number | null
  /** 侧室挂在哪个主干序号上；主干为 null */
  anchorMainIndex: number | null
  band: 'north' | 'south'
}

export function planLayout(seed: number, cfg: RoomsConfig): LayoutPlan {
  const cell = cfg.navCellSize
  const halfCell = cell / 2
  const wt = cfg.wallThickness

  // 走廊的中心线到它外墙中心线的距离。可走宽度 = corridorMinWidth，
  // 两侧各被一层墙吃掉 wallThickness。
  const corridorEdge = cfg.corridorMinWidth / 2 + wt

  // -------------------------------------------------------------- 数量

  const mainCount = rngFor(seed, 'mainCount').between(cfg.mainRoomMin, cfg.mainRoomMax)
  const sideCount = cfg.totalRooms - mainCount

  // -------------------------------------------------------------- 侧室挂载点

  // 首领不能有侧室：它的出口要「汇回主干道的下一间」，而首领后面没有下一间。
  // 所以候选是主干 0 .. mainCount−2，共 mainCount−1 个。
  //
  // 这个数恰好够用，不是巧合：侧室数 = totalRooms − mainCount，
  // 在 mainCount 取下限时最大（15 − 8 = 7），而候选数也是 7（8 − 1）。
  // 8—11 这个区间是唯一能让「每间主干教室至多一间侧室」成立的区间，
  // 上限再放宽一格（主干 7 间 → 侧室 8 间 → 候选只有 6 个）就会**排不下**。
  // 这是 8—11 除了「守住 5—10 分钟」之外的第二个理由。
  const anchorSet = chooseAnchors(seed, sideCount, mainCount)

  // -------------------------------------------------------------- 进度轴

  // `order` 是**唯一的顺序来源**。按「主干第 i 间 → 挂在它上面的侧室 → 主干第 i+1 间」
  // 交错编号，于是 `order` 的升序**正好等于平面上的从左到右** ——
  // 缩略图上看到的顺序就是进度顺序，不需要第二张表去对照。
  const descs: Desc[] = []
  const mainOrder: number[] = new Array<number>(mainCount)
  let ord = 0
  for (let i = 0; i < mainCount; i++) {
    const band: 'north' | 'south' = i % 2 === 0 ? 'north' : 'south'
    mainOrder[i] = ord
    descs.push({
      order: ord++,
      kind: kindOfMain(i, mainCount),
      branch: 'main',
      mainIndex: i,
      anchorMainIndex: null,
      band,
    })
    if (anchorSet.has(i)) {
      descs.push({
        order: ord++,
        kind: 'main',
        branch: 'side',
        mainIndex: null,
        anchorMainIndex: i,
        band,
      })
    }
  }

  // -------------------------------------------------------------- 摆位置

  const tierCount = cfg.sizeTiers.length
  const placed: { desc: Desc; rect: Rect; tierIndex: number }[] = []
  let cursorX = halfCell // 见文件头 ③

  for (let k = 0; k < descs.length; k++) {
    const d = descs[k]!
    const tierIndex = rngFor(seed, 'sizeTier', d.order).between(0, tierCount - 1)
    const tier = cfg.sizeTiers[tierIndex]!
    const w = tier.width
    const h = tier.height

    const prev = placed[k - 1]
    // 侧室紧贴宿主（见文件头 ②）：0px 间隔，两间房共用一道墙。
    // 第一间前面没有东西要隔开，`roomGap` 不适用 —— 白让出 40px 会让整层
    // 往右偏一格，而"格心"那句话是从第一间房的左边界起算的。
    const adjacentToHost = d.branch === 'side' && prev !== undefined
    const gap = k === 0 || adjacentToHost ? 0 : cfg.roomGap

    const x = cursorX + gap + w / 2
    const y = d.band === 'north' ? -(corridorEdge + h / 2) : corridorEdge + h / 2

    placed.push({ desc: d, rect: { x, y, width: w, height: h }, tierIndex })
    cursorX += gap + w
  }

  const buildingLeft = placed[0]!.rect.x - placed[0]!.rect.width / 2
  const buildingRight =
    placed[placed.length - 1]!.rect.x + placed[placed.length - 1]!.rect.width / 2

  // 走廊矩形：贯穿整层的横带。高度 = 可走宽度 + 两侧墙厚。
  const corridorRect: Rect = {
    x: (buildingLeft + buildingRight) / 2,
    y: 0,
    width: buildingRight - buildingLeft,
    height: cfg.corridorMinWidth + wt * 2,
  }

  // -------------------------------------------------------------- 门

  const doorTo = (order: number | null): Door['toOrder'] => order
  const doorsOf = new Map<number, Door[]>()

  for (let k = 0; k < placed.length; k++) {
    const { desc, rect } = placed[k]!
    const list: Door[] = []
    const edgeY = desc.band === 'north' ? -corridorEdge : corridorEdge

    if (desc.branch === 'main') {
      const i = desc.mainIndex!
      // 起点没有"回头门"（它后面就没有房间了）。
      if (i > 0) {
        list.push({
          kind: 'back',
          x: rect.x - rect.width / 2 + halfCell + cfg.doorWidth / 2,
          y: edgeY,
          width: cfg.doorWidth,
          axis: 'h',
          toOrder: doorTo(mainOrder[i - 1]!),
        })
      }
      // 首领没有"前进门"：它是单局的终点。
      if (i < mainCount - 1) {
        list.push({
          kind: 'forward',
          x: rect.x + rect.width / 2 - halfCell - cfg.doorWidth / 2,
          y: edgeY,
          width: cfg.doorWidth,
          axis: 'h',
          toOrder: doorTo(mainOrder[i + 1]!),
        })
      }
      // 宿主 → 侧室的门，开在宿主东墙上。
      // 目标 order 就是 `mainOrder[i] + 1` —— 侧室在进度轴上紧跟在宿主后面，
      // 这是 `order` 交错编号的直接结果，不需要再查一张表。
      if (anchorSet.has(i)) {
        list.push({
          kind: 'side',
          x: rect.x + rect.width / 2,
          y: sideDoorY(desc.band, corridorEdge, wt, cfg.doorWidth),
          width: cfg.doorWidth,
          axis: 'v',
          toOrder: doorTo(mainOrder[i]! + 1),
        })
      }
    }
    doorsOf.set(desc.order, list)
  }

  // 侧室的两扇门：西墙进（来自宿主）、朝走廊的东侧出（汇回主干下一间）。
  for (let k = 0; k < placed.length; k++) {
    const { desc, rect } = placed[k]!
    if (desc.branch !== 'side') continue
    const a = desc.anchorMainIndex!
    const list = doorsOf.get(desc.order)!
    const edgeY = desc.band === 'north' ? -corridorEdge : corridorEdge

    // ① 入口：与宿主共用的那道墙。x 取侧室的西边界（= 宿主的东边界）。
    list.push({
      kind: 'side',
      x: rect.x - rect.width / 2,
      y: sideDoorY(desc.band, corridorEdge, wt, cfg.doorWidth),
      width: cfg.doorWidth,
      axis: 'v',
      toOrder: doorTo(mainOrder[a]!),
    })
    // ② 出口：朝走廊，位置与"前进门"一致。
    list.push({
      kind: 'side',
      x: rect.x + rect.width / 2 - halfCell - cfg.doorWidth / 2,
      y: edgeY,
      width: cfg.doorWidth,
      axis: 'h',
      toOrder: doorTo(mainOrder[a + 1]!),
    })
  }

  // -------------------------------------------------------------- 墙

  const walls = buildWalls(placed, doorsOf, corridorRect, cfg)

  // -------------------------------------------------------------- 组装

  const rooms: Room[] = placed.map(({ desc, rect, tierIndex }) => ({
    order: desc.order,
    kind: desc.kind,
    branch: desc.branch,
    rect,
    sizeTier: tierIndex,
    doors: doorsOf.get(desc.order) ?? [],
    obstacles: [],
    spawnPoints: [],
    budget:
      desc.branch === 'main'
        ? threatBudget(desc.mainIndex!, mainCount, cfg)
        : // 侧室沿用宿主那一间的预算：它在进度上和宿主是并行的，
          // 用宿主的值既保证「预算单调不减」，也免得侧室变成一个难度洼地。
          threatBudget(desc.anchorMainIndex!, mainCount, cfg),
    anchoredTo: desc.branch === 'side' ? mainOrder[desc.anchorMainIndex!]! : null,
  }))

  const bounds = boundsOf(rooms, corridorRect, wt)

  return { rooms, corridorRect, walls, bounds, mainCount }
}

// ---------------------------------------------------------------- 内部

function kindOfMain(i: number, mainCount: number): RoomKind {
  if (i === 0) return 'start'
  if (i === mainCount - 1) return 'boss'
  return 'main'
}

/**
 * 挑出挂侧室的主干序号。
 *
 * 候选是 `0 .. mainCount-2`（首领除外）。侧室数 ≥ 候选数时全都要 ——
 * 这不是退化情形而是常态：`mainCount = 8` 时侧室 7 间、候选正好 7 个。
 *
 * 洗牌用的是**派生出来的那条流**（`'sideAnchors'`），所以换一批挂载点
 * 不会连带改变房间尺寸 —— 见 `seed.ts` 讲的理由。
 */
function chooseAnchors(seed: number, sideCount: number, mainCount: number): Set<number> {
  const candidates: number[] = []
  for (let i = 0; i <= mainCount - 2; i++) candidates.push(i)

  const rng = rngFor(seed, 'sideAnchors')
  // Fisher-Yates。**必须自己写**：`Array.sort` 传一个用随机数的比较器
  // 在 V8 上不是稳定行为，同一个种子会排出不同的序 —— 而「同种子同图」
  // 只在同一台机器上成立的话，这个承诺就没有意义了。
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = rng.between(0, i)
    const t = candidates[i]!
    candidates[i] = candidates[j]!
    candidates[j] = t
  }

  return new Set(candidates.slice(0, Math.min(sideCount, candidates.length)))
}

/**
 * 一扇门作为一块矩形（不是线段）。`doorClearance` 与障碍物生成要用它 ——
 * 「门前净空」得先有一个能inflate的东西，线段扩不出面积来。
 *
 * 实现在 `model/rect.ts`（校验器也要它，而校验器不该 import 生成器）。
 */

/** 侧门的中心 y（竖直墙上的一扇门，沿 y 量宽度）。 */
function sideDoorY(
  band: 'north' | 'south',
  corridorEdge: number,
  wallThickness: number,
  doorWidth: number,
): number {
  // 从走廊外墙的内侧起，往里让开半格（对齐格边界，见文件头 ③）再取门心。
  const inset = wallThickness / 2 + doorWidth / 2
  return band === 'north' ? -(corridorEdge + inset) : corridorEdge + inset
}

/**
 * 把 `[a0, a1]` 这条线按 `openings` 挖空，返回剩下的实心段。
 *
 * 挖空用的是**半开区间** `[start, end)`：两端落在格边界上时，
 * 恰好覆盖整数个格中心（见文件头 ③）。用闭区间会多覆盖一个端点的格中心，
 * 症状是「80px 的门实际能过 3 格」。
 */
function segmentsAround(a0: number, a1: number, openings: readonly Span[]): Span[] {
  const sorted = [...openings].sort((p, q) => p.start - q.start)
  const out: Span[] = []
  let cursor = a0
  for (const o of sorted) {
    if (o.end <= cursor) continue
    if (o.start > cursor) out.push({ start: cursor, end: Math.min(o.start, a1) })
    cursor = Math.max(cursor, o.end)
  }
  if (cursor < a1) out.push({ start: cursor, end: a1 })
  return out.filter((s) => s.end - s.start > 0)
}

function horizontalWall(y: number, a0: number, a1: number, t: number, openings: readonly Span[]): Rect[] {
  return segmentsAround(a0, a1, openings).map((s) => ({
    x: (s.start + s.end) / 2,
    y,
    width: s.end - s.start,
    height: t,
  }))
}

function verticalWall(x: number, a0: number, a1: number, t: number, openings: readonly Span[]): Rect[] {
  return segmentsAround(a0, a1, openings).map((s) => ({
    x,
    y: (s.start + s.end) / 2,
    width: t,
    height: s.end - s.start,
  }))
}

/** 把一扇门换算成它挖掉的那段区间（门心 ± 半个门宽）。 */
function doorSpan(d: Door): Span {
  return d.axis === 'h'
    ? { start: d.x - d.width / 2, end: d.x + d.width / 2 }
    : { start: d.y - d.width / 2, end: d.y + d.width / 2 }
}

function buildWalls(
  placed: readonly { desc: Desc; rect: Rect }[],
  doorsOf: ReadonlyMap<number, readonly Door[]>,
  corridorRect: Rect,
  cfg: RoomsConfig,
): Rect[] {
  const wt = cfg.wallThickness
  const left = corridorRect.x - corridorRect.width / 2
  const right = corridorRect.x + corridorRect.width / 2
  const edge = corridorRect.height / 2

  // 走廊的上下两条边：整条线实心，只在通向走廊的门处挖空。
  //
  // 「只在门处挖空」把一件麻烦事顺手解掉了：宿主与侧室之间那条 0px 的缝
  // 朝走廊是**封着**的，于是玩家没法绕过宿主教室从走廊直接钻进侧室，
  // 「入口来自宿主」才是真的。缝在朝外的另一端也是封的（两侧房间的侧墙）。
  const northOpenings: Span[] = []
  const southOpenings: Span[] = []
  for (const { desc } of placed) {
    const list = doorsOf.get(desc.order) ?? []
    for (const d of list) {
      if (d.axis !== 'h') continue
      ;(desc.band === 'north' ? northOpenings : southOpenings).push(doorSpan(d))
    }
  }

  const walls: Rect[] = [
    ...horizontalWall(-edge, left - wt / 2, right + wt / 2, wt, northOpenings),
    ...horizontalWall(edge, left - wt / 2, right + wt / 2, wt, southOpenings),
  ]

  // 走廊两端的封口。不加的话走廊两端是敞开的口子，玩家能直接走出地图。
  walls.push(
    ...verticalWall(left - wt / 2, -edge, edge, wt, []),
    ...verticalWall(right + wt / 2, -edge, edge, wt, []),
  )

  // 每间房的另外三面：东西两侧的侧墙 + 远离走廊的那面。
  // 朝走廊的那一面由上面两条走廊边线负责，不重复。
  for (const { desc, rect } of placed) {
    const list = doorsOf.get(desc.order) ?? []
    const rl = rect.x - rect.width / 2
    const rr = rect.x + rect.width / 2
    const nearY = desc.band === 'north' ? -edge : edge
    const farY = desc.band === 'north' ? rect.y - rect.height / 2 : rect.y + rect.height / 2
    const y0 = Math.min(nearY, farY)
    const y1 = Math.max(nearY, farY)

    const onWest = list.filter((d) => d.axis === 'v' && Math.abs(d.x - rl) < 1e-6).map(doorSpan)
    const onEast = list.filter((d) => d.axis === 'v' && Math.abs(d.x - rr) < 1e-6).map(doorSpan)

    walls.push(...verticalWall(rl, y0, y1, wt, onWest))
    walls.push(...verticalWall(rr, y0, y1, wt, onEast))
    walls.push(...horizontalWall(farY, rl - wt / 2, rr + wt / 2, wt, []))
  }

  return walls
}

function boundsOf(rooms: readonly Room[], corridorRect: Rect, wt: number): Rect {
  let minX = corridorRect.x - corridorRect.width / 2
  let maxX = corridorRect.x + corridorRect.width / 2
  let minY = corridorRect.y - corridorRect.height / 2
  let maxY = corridorRect.y + corridorRect.height / 2
  for (const r of rooms) {
    minX = Math.min(minX, r.rect.x - r.rect.width / 2 - wt)
    maxX = Math.max(maxX, r.rect.x + r.rect.width / 2 + wt)
    minY = Math.min(minY, r.rect.y - r.rect.height / 2 - wt)
    maxY = Math.max(maxY, r.rect.y + r.rect.height / 2 + wt)
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, width: maxX - minX, height: maxY - minY }
}