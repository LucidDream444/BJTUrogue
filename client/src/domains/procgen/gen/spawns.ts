/**
 * 刷怪点。**纯函数，零 Phaser 依赖。**
 *
 * ---
 *
 * ## 顺序：先摆障碍物，再**从门做 flood fill**，出生点只从可达的格子里挑
 *
 * 这个顺序是整份生成器里最值钱的一个决定。
 *
 * 「出生点被封死」的后果不是"地图走不通"，而是**软锁**：怪出不来 → 玩家打不到 →
 * 房间清不掉 → 门不开 → 那一间永远进不了也出不来。
 * ⚠️ v4 时这条的代价更重（「不回头」规则下一局直接作废）；v5 里玩家可以自由
 * 来回走、跳过打不开的房间再去别的（用户 2026-10-19），所以它退化成
 * **一场没法完成的挑战**，而不是废掉一局。**但那仍然是个 bug** ——
 * 它可能在 1000 个种子里第 837 个才出现。
 *
 * 反过来做（先定出生点、再摆桌子、摆完检查）就必须靠「不通就整张图重来」兜底，
 * 而重试次数不确定会让生成耗时出现长尾 —— 而耗时是要显示在 HUD 上的读数。
 *
 * 现在这个顺序下，「出生点不可达」**在构造上不可能发生**：
 * 出生点是可达集合的子集。校验器因此退居二线，角色从"兜底"变成"回归网"——
 * 它防的是**以后的重构把这条不变量改坏**，而不是今天的运气不好。
 *
 * ## 从门出发，不是从房间中心出发
 *
 * 从中心出发会漏掉一整类失败：**门这一侧被课桌封住、房间另一侧空着**。
 * 中心可达、门不可达，于是玩家进得来、出不去 —— 而按中心的校验会全绿。
 */

import type { Point, Room } from '../model/types'
import type { RoomsConfig } from '../config'
import { isCombatKind } from '../config'
import { bottom, left, right, top } from '../model/rect'
import { cellCenter, cellOf, doorSideCells, isBlockedCell, type NavGrid } from '../walkability'
import { rngFor } from './seed'

/** 每扇门**里侧**那一格 —— flood fill 的起点。几何来自共用的 `doorSideCells`。 */
function doorEntryCells(room: Room, cfg: RoomsConfig, grid: NavGrid): { cx: number; cy: number }[] {
  const out: { cx: number; cy: number }[] = []
  for (const d of room.doors) {
    for (const c of doorSideCells(grid, room, cfg, d).inside) {
      if (!isBlockedCell(grid, c.cx, c.cy)) out.push(c)
    }
  }
  return out
}

/** 从一组起点做 4-邻域 BFS，返回可达格子（用 `cy * cols + cx` 编码）。 */
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

  // 8 邻域里的斜角要**两侧正交邻格都不堵**才算通 —— 与 `FlowField` 的
  // 「不许切角」保持一致。不一致的话会出现「校验说通、怪走不过去」。
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
 * 房间内部的格子（中心落在房间矩形里）。
 *
 * ★ 改了（v5）：**不再往里让半堵墙。** 房间矩形现在**就是**它的可走格跨度
 * （v4 的矩形含墙，所以那时要 `left + wt/2`）。照旧式子让 20px 的话，
 * 取出来的格子范围与房间实际的可走区域错开半格，而这一错**不报错**：
 * 只是最内圈那几格被漏掉、或者墙角多出一格 —— 表现是「这间房明明还有空地，
 * 刷怪点全挤在中间」。
 *
 * 右/下边界是**开区间**，所以用 `x1 - 1` 去取最后一格的下标；
 * 直接传 `x1` 会落到隔壁那一格（那一格是墙）。
 */
function interiorCells(room: Room, grid: NavGrid): { cx: number; cy: number }[] {
  const x0 = left(room.rect)
  const x1 = right(room.rect)
  const y0 = top(room.rect)
  const y1 = bottom(room.rect)

  const a = cellOf(grid, x0, y0)
  const b = cellOf(grid, x1 - 1, y1 - 1)
  const out: { cx: number; cy: number }[] = []
  for (let cy = a.cy; cy <= b.cy; cy++) {
    for (let cx = a.cx; cx <= b.cx; cx++) {
      const p = cellCenter(grid, cx, cy)
      // ★ 改了（2026-10-22 晚·七）：**离四面墙各让出整整一格**。
      //
      // 只要求「在房间里」是不够的：最外那一圈格子的中心离墙只有半格（20px），
      // 而怪放下去要一份 `ENEMY_CLEARANCE = 26px` 的净空（D1 的 `BattleScene`）——
      // 20 < 26，于是运行时 `safeSpawn()` 把它推开，推的方向**不看墙**：
      // 实测 6F 的 YF614 有一颗点被推到了走廊里（种子 7919）。
      // 房间本身仍然「有刷怪点」，所以这件事不报错、只有那条用例看得见。
      //
      // 让一格 = 中心离墙 60px > 26 ✓；而且这条判据**不抄 D1 的那个数**
      // （26 是它们的旋钮，改了不该让这边红）—— 一格是这里能表达的最小裕度。
      const m = grid.cellSize
      if (p.x - x0 >= m && x1 - p.x >= m && p.y - y0 >= m && y1 - p.y >= m) out.push({ cx, cy })
    }
  }
  return out
}

export function placeSpawnPoints(
  seed: number,
  cfg: RoomsConfig,
  room: Room,
  grid: NavGrid,
): Point[] {
  // 非战斗关别**没有刷怪点** —— 不是「没配上」，是这一层数据里就没有位置这回事。
  // D1 的「进房关门、清完开门」在空房间上要立刻放行（通知里点名过这一条）：
  // 判据是 `spawnPoints.length === 0`，而不是去查关别名册。
  //
  // 早返回在 flood fill 之前：那一趟是整层网格上最贵的一段，
  // 而它算出来的东西对一节空教室没有用。
  if (!isCombatKind(cfg, room.kind)) return []

  const reachable = floodFill(grid, doorEntryCells(room, cfg, grid))
  const candidates = interiorCells(room, grid).filter(
    (c) => reachable.has(c.cy * grid.cols + c.cx) && !isBlockedCell(grid, c.cx, c.cy),
  )
  if (candidates.length === 0) return []

  const want = rngFor(seed, 'spawnCount', room.order).between(
    cfg.spawnPointsMin,
    cfg.spawnPointsMax,
  )

  // 洗牌后贪心取，保证两点间距 ≥ spawnPointMinGap。
  // 贪心而不是「均匀撒开」：均匀撒开需要先知道要取几个，而"要取几个"本身是随机的，
  // 于是间距和数量会互相牵制，调一个必然动另一个。
  const rng = rngFor(seed, 'spawnPlaces', room.order)
  const shuffled = [...candidates]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.between(0, i)
    const t = shuffled[i]!
    shuffled[i] = shuffled[j]!
    shuffled[j] = t
  }

  const picked: Point[] = []
  const minGapSq = cfg.spawnPointMinGap * cfg.spawnPointMinGap
  for (const c of shuffled) {
    if (picked.length >= want) break
    const p = cellCenter(grid, c.cx, c.cy)
    if (picked.some((q) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < minGapSq)) continue
    picked.push(p)
  }

  // 间距约束把候选全筛掉时，**宁可放宽间距也不要交出一间空房** ——
  // 空房 = 没有怪 = 房间永远清不掉 = 门永远不开（见文件头）。
  if (picked.length === 0) {
    const p = cellCenter(grid, shuffled[0]!.cx, shuffled[0]!.cy)
    picked.push(p)
  }

  return picked
}