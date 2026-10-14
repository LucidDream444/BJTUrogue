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
 * 房间清不掉 → 门不开 → 而「不回头」规则下**这一局直接作废**。
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

/** 房间内部的格子（中心落在四面墙内侧）。 */
function interiorCells(room: Room, cfg: RoomsConfig, grid: NavGrid): { cx: number; cy: number }[] {
  const wt = cfg.wallThickness
  const x0 = left(room.rect) + wt / 2
  const x1 = right(room.rect) - wt / 2
  const y0 = top(room.rect) + wt / 2
  const y1 = bottom(room.rect) - wt / 2

  const a = cellOf(grid, x0, y0)
  const b = cellOf(grid, x1, y1)
  const out: { cx: number; cy: number }[] = []
  for (let cy = a.cy; cy <= b.cy; cy++) {
    for (let cx = a.cx; cx <= b.cx; cx++) {
      const p = cellCenter(grid, cx, cy)
      if (p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1) out.push({ cx, cy })
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
  const candidates = interiorCells(room, cfg, grid).filter(
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
  // 空房 = 没有怪 = 房间永远清不掉 = 不回头规则下整局作废。
  if (picked.length === 0) {
    const p = cellCenter(grid, shuffled[0]!.cx, shuffled[0]!.cy)
    picked.push(p)
  }

  return picked
}