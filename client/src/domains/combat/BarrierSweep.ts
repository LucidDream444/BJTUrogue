import type { MapPoint, MapRect } from './StageGeometry'

/** 只查询当前启用的门；保持门洞不进入导航网格，与 static body 开关一致。 */
export function sweepEnabledBarriers(
  from: MapPoint,
  to: MapPoint,
  radius: number,
  barriers: readonly MapRect[],
  enabled: (index: number) => boolean,
): number | null {
  let first: number | null = null
  for (let index = 0; index < barriers.length; index++) {
    if (!enabled(index)) continue
    const rect = barriers[index]!
    let enter = 0, leave = 1
    let intersects = true
    for (const axis of ['x', 'y'] as const) {
      const low = rect[axis] - radius
      const high = rect[axis] + (axis === 'x' ? rect.width : rect.height) + radius
      const delta = to[axis] - from[axis]
      if (Math.abs(delta) < Number.EPSILON) {
        if (from[axis] < low || from[axis] > high) { intersects = false; break }
        continue
      }
      const a = (low - from[axis]) / delta, b = (high - from[axis]) / delta
      enter = Math.max(enter, Math.min(a, b))
      leave = Math.min(leave, Math.max(a, b))
      if (enter > leave) { intersects = false; break }
    }
    if (intersects && (first === null || enter < first)) first = enter
  }
  return first
}

/** 墙与启用门各有独立几何，合并时使用最早命中而不改变导航。 */
export function earliestObstacleHit(first: number | null, second: number | null): number | null {
  if (first === null) return second
  if (second === null) return first
  return Math.min(first, second)
}
