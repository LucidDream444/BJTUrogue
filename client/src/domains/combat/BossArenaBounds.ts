export interface BossArenaBounds {
  left: number
  top: number
  right: number
  bottom: number
}

/** procgen 的 Rect.x/y 为中心；不接受左上角 StageCollisionConfig 矩形。 */
export function bossArenaBoundsFromRect(rect: { x: number; y: number; width: number; height: number }): BossArenaBounds {
  return { left: rect.x - rect.width / 2, top: rect.y - rect.height / 2,
    right: rect.x + rect.width / 2, bottom: rect.y + rect.height / 2 }
}

/** 放置后检查实际物理圆，而非只检查传给 body.reset 的目标中心。 */
export function bossArenaContainsCircle(x: number, y: number, radius: number, bounds: BossArenaBounds): boolean {
  return [x, y, radius, bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite) &&
    radius >= 0 && bounds.left <= bounds.right && bounds.top <= bounds.bottom &&
    x - radius >= bounds.left && x + radius <= bounds.right &&
    y - radius >= bounds.top && y + radius <= bounds.bottom
}
/** Confine skill destinations to their sealed room, including furniture clearance. */
export function bossArenaPoint(
  x: number,
  y: number,
  radius: number,
  bounds: BossArenaBounds,
  cellSize: number,
  isWalkable: (x: number, y: number, radius: number) => boolean,
): { x: number; y: number } | null {
  const left = bounds.left + radius,
    right = bounds.right - radius,
    top = bounds.top + radius,
    bottom = bounds.bottom - radius
  if (left > right || top > bottom) return null
  const desired = { x: Math.max(left, Math.min(right, x)), y: Math.max(top, Math.min(bottom, y)) }
  if (isWalkable(desired.x, desired.y, radius)) return desired
  let nearest: { x: number; y: number } | null = null,
    best = Infinity
  for (
    let cy = Math.ceil((top - cellSize / 2) / cellSize) * cellSize + cellSize / 2;
    cy <= bottom;
    cy += cellSize
  )
    for (
      let cx = Math.ceil((left - cellSize / 2) / cellSize) * cellSize + cellSize / 2;
      cx <= right;
      cx += cellSize
    ) {
      if (!isWalkable(cx, cy, radius)) continue
      const distance = (cx - desired.x) ** 2 + (cy - desired.y) ** 2
      if (distance < best) {
        nearest = { x: cx, y: cy }
        best = distance
      }
    }
  return nearest
}
