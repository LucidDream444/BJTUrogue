export interface ChargePoint { x: number; y: number }
export interface ChargeTarget extends ChargePoint {
  id: number
  spawnSeq: number
  radius: number
  alive: boolean
}
export type SolidHitTime = (x0: number, y0: number, x1: number, y1: number, radius: number) => number | null
export interface ChargeSolid { x: number; y: number; width: number; height: number }

/** Slab sweep against solid rectangles (top-left coordinates), expanded by actor radius. */
export function chargeSolidHitTime(from: ChargePoint, to: ChargePoint, radius: number, solids: readonly ChargeSolid[]): number | null {
  let first: number | null = null
  for (const solid of solids) {
    let enter = 0, leave = 1
    for (const [start, direction, low, high] of [
      [from.x, to.x - from.x, solid.x - radius, solid.x + solid.width + radius],
      [from.y, to.y - from.y, solid.y - radius, solid.y + solid.height + radius],
    ]) {
      if (direction === 0) {
        if (start! < low! || start! > high!) { leave = -1; break }
      } else {
        const a = (low! - start!) / direction!, b = (high! - start!) / direction!
        enter = Math.max(enter, Math.min(a, b))
        leave = Math.min(leave, Math.max(a, b))
      }
    }
    if (enter <= leave && enter >= 0 && enter <= 1) first = Math.min(first ?? 1, enter)
  }
  return first
}

/** Pure swept circle hit. Zero-length segments are valid contacts. */
export function chargeHitTime(from: ChargePoint, to: ChargePoint, target: ChargeTarget, radius: number): number | null {
  const dx = to.x - from.x, dy = to.y - from.y
  const lengthSq = dx * dx + dy * dy
  const reach = radius + target.radius
  const ox = from.x - target.x, oy = from.y - target.y
  if (ox * ox + oy * oy <= reach * reach) return 0
  if (lengthSq === 0) return null
  const b = 2 * (ox * dx + oy * dy)
  const c = ox * ox + oy * oy - reach * reach
  const discriminant = b * b - 4 * lengthSq * c
  if (discriminant < 0) return null
  const t = (-b - Math.sqrt(discriminant)) / (2 * lengthSq)
  return t >= 0 && t <= 1 ? t : null
}

/** Owns one attack's hit set, never a body or a second position integrator. */
export class ChargeSweep {
  private readonly hit = new Set<string>()
  constructor(readonly sourceId: number, readonly ownerId: number) {}

  sweep(from: ChargePoint, to: ChargePoint, radius: number, distanceLeft: number, targets: readonly ChargeTarget[], solidHitTime?: SolidHitTime) {
    const dx = to.x - from.x, dy = to.y - from.y
    const actualLength = Math.hypot(dx, dy)
    const distanceTime = actualLength > 0 ? Math.min(1, Math.max(0, distanceLeft) / actualLength) : 1
    const wall = solidHitTime?.(from.x, from.y, to.x, to.y, radius) ?? null
    const stopTime = Math.min(distanceTime, wall ?? 1)
    const endpoint = { x: from.x + dx * stopTime, y: from.y + dy * stopTime }
    const ids: ChargeTarget[] = []
    for (const target of targets) {
      if (!target.alive || target.id === this.ownerId) continue
      const identity = `${target.id}:${target.spawnSeq}`
      if (this.hit.has(identity)) continue
      const t = chargeHitTime(from, to, target, radius)
      // A wall wins a tie: a unit behind/touching its far face is never hit through it.
      if (t === null || t > distanceTime || (wall !== null && t >= wall)) continue
      this.hit.add(identity)
      ids.push(target)
    }
    return { endpoint, targets: ids, distance: actualLength * stopTime, stopped: wall !== null && wall <= distanceTime || distanceTime < 1 }
  }
}
