/**
 * 楼层平面：一排主干教室 + 连廊 + 侧室 + 门 + 墙。**纯函数，零 Phaser 依赖。**
 *
 * ---
 *
 * ## 平面长这样
 *
 * ```
 *      ┌─────────┐                    ┌─────────┐
 *      │  侧室   │                    │  侧室   │        ← 随机挂在上方或下方
 *   ┌──┴──┬──┬──┴──┐              ┌──┴──┬──────┴──┐
 *   │      │  │     │              │     │         │
 *   │ 主干 1│连│主干2│═══连廊═══│主干 3│  连廊   │主干 4 │   ← 同一排横着排开
 *   │      │廊│     │              │     │         │
 *   └──────┴──┴─────┘              └─────┴─────────┘
 * ```
 *
 * **没有贯穿全层的走廊。** 首版把它做成了后者（一条主干道、教室南北交替挂在
 * 它两侧），而那与「一排主干教室」根本不是一个平面结构 —— 玩家看到的是一条
 * 长走廊，教室是走廊的配菜；要的是反过来：教室是主体，连廊只是它们之间的一小段。
 *
 * ## 四条几何规则，每条都在堵一个具体的坑
 *
 * **① 主干教室与连廊在同一条水平带里交替排开。** 于是「主干教室的上下两面墙」
 * 与「连廊的上下两面墙」是**同两条直线**，不必逐段跳台阶；侧室朝主干的那面墙
 * 也因此能一次贴合住宿主与连廊（见 ③）。
 *
 * **② 整排从 `x = 半格` 起排，`roomGap` 取格长的整数倍。** 于是每堵墙的中心线
 * 都落在**格中心**上（寻路格的中心在 `20 + 40n`），一堵墙恰好封掉一格；
 * 每个门洞的两端都落在**格边界**上（`40n`），一扇门恰好开出整数格。
 *
 * **③ 侧室横跨「宿主的一部分 + 一整段连廊」**，朝主干的那面墙开两扇门：
 * 一扇进宿主（入口），一扇进连廊（出口 → 汇回主干下一间）。
 * 两扇门开在同一条直线上，正是因为 ① 让宿主与连廊等高。
 * 侧室与宿主的搭接长度 `k = 侧室档位宽 − roomGap`，**必须 ≤ 宿主宽度**，
 * 否则侧室会伸到宿主的西墙外面去。
 *
 * **④ 竖直墙上的门心偏移半格（`y = +20`）。** 这条最绕，单独推一遍：
 *
 * ```
 *   带的上墙中心线在 ±h/2，它必须落在格中心上（20 + 40n）
 *        → h/2 ≡ 20 (mod 40)  →  h ≡ 40 (mod 80)      ← h 只能是奇数格
 *   于是带的中线（y = 0）永远落在一条**格边界**上
 *   而门洞两端必须落在格边界上（见 ②）
 *        → 竖直墙上的门心只能取 ±20，**取不到 0**
 * ```
 *
 * 这两个事实是**同一件事的两面**：带高是奇数格，中线就不可能同时是格中心。
 * `config.ts` 里那条「`mainRoomHeight` 必须 ≡ 40 (mod 80)」的断言守的就是它 ——
 * 谁把带高调成偶数格，中线就变回格中心，而下面那个 `y = +20` 会**悄悄变成错的**
 * （门洞两端落到格中心上，120px 的门实际能过 4 格）。
 *
 * 取 `+20` 而不是 `−20`：两者等价，正负只是「门往带的上半还是下半偏」。
 * 定死一个符号是为了让所有连廊的门在缩略图上排成一条线 —— 那是一条**能一眼
 * 看出错了**的线，而随机取符号会让「有一扇门偏了」淹在一堆本来就参差的线里。
 *
 * ② 看着像强迫症，它是三个「不报错但会坏事」的坑的总闸：
 *
 * | 没对齐会怎样 | 症状 |
 * |---|---|
 * | 墙中心落在格边界上 | 一格中心都不覆盖 → **寻路认为墙两侧都通**（墙上有洞） |
 * | 门洞两端落在格中心上 | 实际能过的格子数**比设计多一个**（`120px` 的门过 4 格） |
 * | 障碍物没对齐 | 看着能挤过去的缝，寻路认为整格封死 |
 *
 * ## 连廊不是一条走廊，所以它**不是 `Room`**
 *
 * `passages` 与 `rooms` 并列返回，但连廊没有 `order`、没有预算、不刷怪、
 * 不计入房间总数。它是两间教室之间的**过道**，玩家在这里永远处于脱战状态
 * （连廊的上下墙线不断开成门以外的东西，里面也没有可刷怪的空间 —— 见 design D5）。
 *
 * ## 墙是**数据**，不是各消费方自己推导的
 *
 * 返回的 `walls` 是一段段矩形。D1 拿它建物理碰撞体，寻路拿它判可走性。
 * 两处各推一次的话，一边少推一段就是「玩家从缝里走出去了」或者
 * 「怪卡在一个看不见的角里」—— 都不报错。
 *
 * 首版这里还有一段「侧室门厅的封口」要在墙里额外补：那时侧室贴在宿主旁边、
 * 中间一条 0px 的缝朝走廊敞着，不封就能绕过宿主直接钻进去。
 * 现在侧室整个在带的外侧、朝主干那一面由**连续墙线**负责，缝根本不存在，
 * 那段封口也就不需要了。
 */

import type { Door, Passage, Rect, Room, RoomBranch, RoomKind } from '../model/types'
import { bottom, left, right, top } from '../model/rect'
import type { RoomsConfig } from '../config'
import { rngFor } from './seed'
import { threatBudget } from './budget'

/** 一个区间的半开表示：`[start, end)`，两端都落在格边界上（见文件头 ②） */
interface Span {
  start: number
  end: number
}

/** 侧室挂在这一排的哪一侧。 */
type Band = 'north' | 'south'

export interface LayoutPlan {
  rooms: Room[]
  /** 相邻主干教室之间的连廊，按 x 从左到右。有几间主干教室就有几段（`N − 1`） */
  passages: Passage[]
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
}

/** 摆好位置的房间。`band` / `overlap` 只有侧室有。 */
interface Placed {
  desc: Desc
  rect: Rect
  /** 索引到 `config.mainWidthTiers`（主干）或 `config.sideRoomTiers`（侧室） */
  tierIndex: number
  band: Band | null
  /** 侧室与宿主的搭接长度（px，沿 x）；主干为 null */
  overlap: number | null
}

export function planLayout(seed: number, cfg: RoomsConfig): LayoutPlan {
  const cell = cfg.navCellSize
  const halfCell = cell / 2
  const wt = cfg.wallThickness
  const bandEdge = cfg.mainRoomHeight / 2
  const gap = cfg.roomGap

  // 竖直墙上的门心偏移，推导见文件头 ④。`config.ts` 保证它是半格 ——
  // 也就是说带高是奇数格，带的中线是格边界，门心只能偏半格。
  const vDoorY = halfCell

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
    mainOrder[i] = ord
    descs.push({
      order: ord++,
      kind: kindOfMain(i, mainCount),
      branch: 'main',
      mainIndex: i,
      anchorMainIndex: null,
    })
    if (anchorSet.has(i)) {
      descs.push({
        order: ord++,
        kind: 'main',
        branch: 'side',
        mainIndex: null,
        anchorMainIndex: i,
      })
    }
  }

  // -------------------------------------------------------------- 摆位置

  const placed: Placed[] = []
  const mainPlaced: Placed[] = new Array<Placed>(mainCount)
  /** 挂在这间主干教室上的侧室。门那一步要拿它的挂靠侧来定位入口门。 */
  const sideOf = new Map<number, Placed>()
  const passages: Passage[] = []

  // 侧室入口门的门洞从「宿主的东边界往西 `halfCell + doorWidth`」开始（见下）。
  // 门洞整体必须落在侧室与宿主的搭接段里，于是搭接长度有个下限 ——
  // 短于它，入口门就有一半开在宿主外面，而几何上看不出「开在外面」这件事。
  const minOverlap = halfCell + cfg.doorWidth

  let cursorX = halfCell // 见文件头 ②

  for (const d of descs) {
    if (d.branch === 'main') {
      const i = d.mainIndex!
      const widthCount = cfg.mainWidthTiers.length
      const tierIndex = rngFor(seed, 'mainWidth', i).between(0, widthCount - 1)
      const w = cfg.mainWidthTiers[tierIndex]!
      const p: Placed = {
        desc: d,
        rect: { x: cursorX + w / 2, y: 0, width: w, height: cfg.mainRoomHeight },
        tierIndex,
        band: null,
        overlap: null,
      }
      placed.push(p)
      mainPlaced[i] = p
      cursorX += w

      // 连廊：夹在这间和下一间之间的一小段，与教室同高（见文件头 ①）。
      // 最后一间后面没有东西，不铺连廊。
      if (i < mainCount - 1) {
        passages.push({
          rect: { x: cursorX + gap / 2, y: 0, width: gap, height: cfg.mainRoomHeight },
          // 带上两端的 `order`：D1 的封门与「不回头」逻辑靠它，不必去猜坐标
          between: [mainOrder[i]!, mainOrder[i + 1]!],
        })
        cursorX += gap
      }
      continue
    }

    // ---- 侧室：横跨「宿主的东半段 + 一整段连廊」（见文件头 ③）

    const anchor = d.anchorMainIndex!
    const host = mainPlaced[anchor]!
    const hostEast = right(host.rect)

    // 挂哪一侧随种子定。**单独一条派生流**：复用 `'sideAnchors'` 的话，
    // 调一下「哪几间挂侧室」会连带把所有侧室翻到另一侧去，两条规则粘在一起，
    // 出了问题分不清是哪一条引起的。
    const band: Band = rngFor(seed, 'bands', anchor).between(0, 1) === 0 ? 'north' : 'south'

    // 档位过滤：`k = 侧室宽 − roomGap` 是它与宿主的搭接长度。
    // 太长会伸到宿主的西墙外面，太短则入口门有一半悬空。
    // 过滤后只剩单个档位是常态（宽宿主配大侧室），**一个都没有是配置问题**：
    // 那说明 `sideRoomTiers` 里的每一档都放不进这排房子，而降级成一个更小的
    // 侧室会让「侧室比主干教室还大」这类平衡假设悄悄失效 —— 所以抛，不降级。
    const usable: number[] = []
    for (let t = 0; t < cfg.sideRoomTiers.length; t++) {
      const k = cfg.sideRoomTiers[t]!.width - gap
      if (k <= host.rect.width && k >= minOverlap) usable.push(t)
    }
    if (usable.length === 0) {
      const widths = cfg.sideRoomTiers.map((t) => t.width).join(' / ')
      throw new Error(
        `种子 ${seed}：主干第 ${anchor} 间宽 ${host.rect.width}，` +
          `而 sideRoomTiers 的宽度档（${widths}）配上 roomGap ${gap} 之后，` +
          `搭接长度没有一个落在 [${minOverlap}, ${host.rect.width}] 里 —— ` +
          `侧室放不下。调 sideRoomTiers 或 roomGap。`,
      )
    }
    const tierIndex =
      usable[rngFor(seed, 'sizeTier', d.order).between(0, usable.length - 1)]!
    const tier = cfg.sideRoomTiers[tierIndex]!
    const overlap = tier.width - gap
    const sx0 = hostEast - overlap
    const sx1 = hostEast + gap // 连廊的东端，也就是下一间主干教室的西边界
    const y = band === 'north' ? -(bandEdge + tier.height / 2) : bandEdge + tier.height / 2

    const sidePlaced: Placed = {
      desc: d,
      rect: { x: (sx0 + sx1) / 2, y, width: sx1 - sx0, height: tier.height },
      tierIndex,
      band,
      overlap,
    }
    placed.push(sidePlaced)
    sideOf.set(anchor, sidePlaced)
  }

  // -------------------------------------------------------------- 门

  const doorsOf = new Map<number, Door[]>()
  const snapDown = (v: number): number => Math.floor(v / cell) * cell

  for (const p of placed) {
    const list: Door[] = []
    doorsOf.set(p.desc.order, list)

    if (p.desc.branch === 'main') {
      const i = p.desc.mainIndex!
      // 起点没有"回头门"（它后面就没有房间了）。
      if (i > 0) {
        list.push({
          kind: 'back',
          x: left(p.rect),
          y: vDoorY,
          width: cfg.doorWidth,
          axis: 'v',
          toOrder: mainOrder[i - 1]!,
        })
      }
      // 首领没有"前进门"：它是单局的终点。
      if (i < mainCount - 1) {
        list.push({
          kind: 'forward',
          x: right(p.rect),
          y: vDoorY,
          width: cfg.doorWidth,
          axis: 'v',
          toOrder: mainOrder[i + 1]!,
        })
      }
      // 宿主 → 侧室：**一个门洞，两侧各记一条**（`Door.toOrder` 是有方向的，
      // 见 `model/types.ts`）。宿主这条不能省，虽然墙上的缺口是侧室那条开的：
      // `obstacles.ts` 的「门前净空」只读**这间房自己的** `doors` ——
      // 少了宿主这一条，宿主里的课桌就会大摇大摆地堵在侧室入口前面，
      // 而入口在数据里看着完好无损。
      const side = sideOf.get(i)
      if (side !== undefined) {
        list.push({
          kind: 'side',
          x: sideEntranceX(right(p.rect), cfg),
          y: side.band === 'north' ? -bandEdge : bandEdge,
          width: cfg.doorWidth,
          axis: 'h',
          // 交错编号的直接结果：侧室紧跟宿主，所以它的 order 就是宿主 +1
          toOrder: mainOrder[i]! + 1,
        })
      }
      continue
    }

    // ---- 侧室的两扇门，都开在朝主干的那面墙上（`axis: 'h'`，见文件头 ③）

    const anchor = p.desc.anchorMainIndex!
    const hostEast = right(mainPlaced[anchor]!.rect)
    const wallY = p.band === 'north' ? -bandEdge : bandEdge

    // ① 入口：进宿主。门洞紧贴宿主的东边界往西让开半格 —— 半格是为了让两端
    //    落在格边界上（见 ②）。往西而不是往东：往东跨过东边界就进连廊了，
    //    而入口必须落在宿主里。宿主那边记的是同一个门洞的反方向那条。
    list.push({
      kind: 'side',
      x: sideEntranceX(hostEast, cfg),
      y: wallY,
      width: cfg.doorWidth,
      axis: 'h',
      toOrder: mainOrder[anchor]!,
    })

    // ② 出口：进连廊，于是汇回主干下一间。
    //    贴着连廊东端往西让开半格（半堵墙）再取门心 —— 东端是「连廊与下一间
    //    教室的分界」，隔墙骑在那条线上，往西让半格正好贴住那道隔墙的内侧面。
    //    接在连廊东端而不是中间，是为了让出口**永远紧挨着下一间教室的门**：
    //    从侧室出来的玩家一转身就看见前进门，不必在两扇门之间找路。
    const passageEast = hostEast + gap
    const exitDoorEast = snapDown(passageEast - wt / 2)
    const exitDoorWest = exitDoorEast - cfg.doorWidth
    // 连廊的净长（两端各被半堵墙吃掉）必须放得下这扇门。放下不的时候
    // 门洞会啃进隔墙里 —— 那在数据上完全看不出来，只在游戏里表现为
    // 「连廊和教室之间没有墙」。所以这里当场抛，并告诉人该调哪个字段。
    if (exitDoorWest < hostEast + wt / 2) {
      throw new Error(
        `种子 ${seed}：连廊净长（roomGap − wallThickness = ${gap - wt}）` +
          `放不下侧室的出口门（宽 ${cfg.doorWidth}）。` +
          `调大 rooms.roomGap 或调小 rooms.doorWidth。`,
      )
    }
    list.push({
      kind: 'side',
      x: exitDoorEast - cfg.doorWidth / 2,
      y: wallY,
      width: cfg.doorWidth,
      axis: 'h',
      toOrder: mainOrder[anchor + 1]!,
    })
  }

  // -------------------------------------------------------------- 墙

  const bandLeft = left(mainPlaced[0]!.rect)
  const bandRight = right(mainPlaced[mainCount - 1]!.rect)
  const walls = buildWalls(placed, doorsOf, cfg, bandLeft, bandRight)

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

  return { rooms, passages, walls, bounds: boundsOf(walls), mainCount }
}

// ---------------------------------------------------------------- 内部

function kindOfMain(i: number, mainCount: number): RoomKind {
  if (i === 0) return 'start'
  if (i === mainCount - 1) return 'boss'
  return 'main'
}

/**
 * 侧室入口门的门心 x。
 *
 * 抽出来是因为**同一个门洞被记在两条记录里**（宿主一条、侧室一条），
 * 而两处各写一遍 `hostEast - (halfCell + doorWidth / 2)` 的话，改一处忘一处
 * 不会报错 —— 只会变成「宿主以为门在这儿、侧室以为门在那儿」，
 * 而墙上的缺口只挖一次，于是其中一条记录的净空圈**落在没门的地方**，
 * 另一侧却没人管。症状是课桌堵门，且堵的那一侧看起来完全正常。
 */
function sideEntranceX(hostEast: number, cfg: RoomsConfig): number {
  return hostEast - (cfg.navCellSize / 2 + cfg.doorWidth / 2)
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
 * 把 `[a0, a1]` 这条线按 `openings` 挖空，返回剩下的实心段。
 *
 * 挖空用的是**半开区间** `[start, end)`：两端落在格边界上时，
 * 恰好覆盖整数个格中心（见文件头 ②）。用闭区间会多覆盖一个端点的格中心，
 * 症状是「120px 的门实际能过 4 格」。
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

function horizontalWall(
  y: number,
  a0: number,
  a1: number,
  t: number,
  openings: readonly Span[],
): Rect[] {
  return segmentsAround(a0, a1, openings).map((s) => ({
    x: (s.start + s.end) / 2,
    y,
    width: s.end - s.start,
    height: t,
  }))
}

function verticalWall(
  x: number,
  a0: number,
  a1: number,
  t: number,
  openings: readonly Span[],
): Rect[] {
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
  placed: readonly Placed[],
  doorsOf: ReadonlyMap<number, readonly Door[]>,
  cfg: RoomsConfig,
  bandLeft: number,
  bandRight: number,
): Rect[] {
  const wt = cfg.wallThickness
  const edge = cfg.mainRoomHeight / 2

  // 上下两条**连续**墙线：整排的北墙与南墙。
  //
  // 只在一种地方断开：**侧室的门**。主干教室自己一扇门都不开在这两条线上
  // ——它的门全在东西两面竖直墙上（进连廊）。所以这两条线在整排上基本是实的，
  // 而这一点正是「一排房子」在数据上的样子：走廊没有了，取而代之的是
  // 教室与教室之间那几道竖直隔墙。
  //
  // 收集的是**整层的** `axis: 'h'` 门，按门自己的 y 分上下 —— 不看它挂在谁身上。
  // 一个门洞会被记两条（宿主一条、侧室一条），这里会各收到一次，但
  // `segmentsAround` 挖的是区间，同一条区间挖两遍等于挖一遍。
  // 按 y 而不是按 `band` 分：门开在哪条墙线上是**门自己的属性**，
  // 而「哪间房拥有这条记录」是记账方式，两者混在一起会让「谁该开这个洞」
  // 依赖一份**与几何无关**的约定。
  const north: Span[] = []
  const south: Span[] = []
  for (const p of placed) {
    for (const d of doorsOf.get(p.desc.order) ?? []) {
      if (d.axis !== 'h') continue
      ;(d.y < 0 ? north : south).push(doorSpan(d))
    }
  }

  const walls: Rect[] = [
    ...horizontalWall(-edge, bandLeft - wt / 2, bandRight + wt / 2, wt, north),
    ...horizontalWall(edge, bandLeft - wt / 2, bandRight + wt / 2, wt, south),
  ]

  // 竖直隔墙：每一间主干教室的东西两条边，各一堵。
  // 教室的东边那堵同时就是它东边连廊的西端，一间房一条边只画一次。
  for (const p of placed) {
    if (p.desc.branch !== 'main') continue
    const list = doorsOf.get(p.desc.order) ?? []
    const l = left(p.rect)
    const r = right(p.rect)
    const onWest = list.filter((d) => d.axis === 'v' && d.x === l).map(doorSpan)
    const onEast = list.filter((d) => d.axis === 'v' && d.x === r).map(doorSpan)
    walls.push(...verticalWall(l, -edge, edge, wt, onWest))
    walls.push(...verticalWall(r, -edge, edge, wt, onEast))
  }

  // 侧室的另外三面：东西两侧的侧墙 + 远离主干的那面。
  // 朝主干的那一面由上面两条连续墙线负责，不重复画。
  for (const p of placed) {
    if (p.band === null) continue
    const sl = left(p.rect)
    const sr = right(p.rect)
    const nearY = p.band === 'north' ? -edge : edge
    const farY = p.band === 'north' ? top(p.rect) : bottom(p.rect)
    walls.push(...verticalWall(sl, Math.min(nearY, farY), Math.max(nearY, farY), wt, []))
    walls.push(...verticalWall(sr, Math.min(nearY, farY), Math.max(nearY, farY), wt, []))
    walls.push(...horizontalWall(farY, sl - wt / 2, sr + wt / 2, wt, []))
  }

  return dedupeWalls(walls)
}

/**
 * 去掉完全重合的墙。
 *
 * 重合是**能发生的**：同侧相邻的两间侧室，前者的东边界与后者的西边界可以
 * 落在同一条线上（搭接长度正好等于宿主宽度时），于是同一堵墙被画两遍。
 * 两遍本身不报错、也不影响 D1 建碰撞体，但它会让 `walls.length` 这种
 * 「拿来做健全性检查」的读数随时漂，而漂的方向取决于随机结果 ——
 * 那种测试没人敢写。去重之后「一堵墙就是一条记录」重新成立。
 *
 * 键用 `join` 而不是浮点容差比较：所有坐标都是格长的整数倍加减半格
 * （见文件头 ②），重合就是**逐位相等**，容差反而会把「差半格」的两堵墙
 * 当成一堵，那是真的把几何弄丢了一段。
 */
function dedupeWalls(walls: readonly Rect[]): Rect[] {
  const seen = new Set<string>()
  const out: Rect[] = []
  for (const w of walls) {
    const key = [w.x, w.y, w.width, w.height].join(',')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(w)
  }
  return out
}

/**
 * 包围盒 = **所有墙的外侧面**的包围盒。
 *
 * 取墙而不是取房间：外墙比房间边界还往外半个墙厚，按房间算会让最外一圈墙
 * 有一部分落在包围盒外面，而 `navExtentFor` 是拿包围盒去铺寻路格的 ——
 * 少算的那半圈会被判成「界外」，界外一律算堵（见 `walkability.ts`），
 * 症状是贴着外墙的房间边界莫名其妙地窄一条。
 */
function boundsOf(walls: readonly Rect[]): Rect {
  const first = walls[0]
  if (first === undefined) throw new Error('一层楼不可能一堵墙都没有')
  let minX = left(first)
  let maxX = right(first)
  let minY = top(first)
  let maxY = bottom(first)
  for (const w of walls) {
    minX = Math.min(minX, left(w))
    maxX = Math.max(maxX, right(w))
    minY = Math.min(minY, top(w))
    maxY = Math.max(maxY, bottom(w))
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, width: maxX - minX, height: maxY - minY }
}