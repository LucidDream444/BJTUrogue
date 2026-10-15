import type { CombatConfig } from './config'

export interface Point {
  x: number
  y: number
}
export interface WaterRect extends Point {
  width: number
  height: number
}

/** Shared geometry for visible water, enemy pathing, spawn safety and lethal player entry. */
export class TerrainMap {
  readonly width: number
  readonly height: number
  readonly water: readonly WaterRect[]
  readonly cellSize: number
  constructor(config: CombatConfig) {
    this.width = config.arena.width
    this.height = config.arena.height
    this.water = config.terrain.water
    this.cellSize = config.terrain.navigationCellSize
  }

  isWater(x: number, y: number): boolean {
    return this.water.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)
  }

  isWalkable(x: number, y: number, radius = 0): boolean {
    if (x < radius || y < radius || x > this.width - radius || y > this.height - radius)
      return false
    // Expanding by actor radius also keeps navigation paths away from the bank corners.
    return !this.water.some(
      (r) =>
        x >= r.x - radius &&
        x <= r.x + r.width + radius &&
        y >= r.y - radius &&
        y <= r.y + r.height + radius,
    )
  }

  safeSpawn(x: number, y: number, radius: number): Point {
    const clamp = (n: number, upper: number) => Math.min(upper - radius, Math.max(radius, n))
    const desired = { x: clamp(x, this.width), y: clamp(y, this.height) }
    if (this.isWalkable(desired.x, desired.y, radius)) return desired
    // Spawn and split requests are cold paths; choose the nearest safe navigation cell.
    let best: Point | null = null,
      distance = Infinity
    for (let cy = this.cellSize / 2; cy < this.height; cy += this.cellSize) {
      for (let cx = this.cellSize / 2; cx < this.width; cx += this.cellSize) {
        if (!this.isWalkable(cx, cy, radius)) continue
        const d = (cx - desired.x) ** 2 + (cy - desired.y) ** 2
        if (d < distance) {
          best = { x: cx, y: cy }
          distance = d
        }
      }
    }
    if (!best) throw new Error('地图没有可供实体出生的安全草地')
    return best
  }

  /** Swept foot-point test also catches a fast move that enters and exits water in one frame. */
  crossesWater(from: Point, to: Point): boolean {
    return this.water.some((r) => {
      let enter = 0,
        leave = 1
      for (const axis of ['x', 'y'] as const) {
        const low = r[axis],
          high = low + (axis === 'x' ? r.width : r.height),
          delta = to[axis] - from[axis]
        if (Math.abs(delta) < 1e-9) {
          if (from[axis] < low || from[axis] >= high) return false
          continue
        }
        const a = (low - from[axis]) / delta,
          b = (high - from[axis]) / delta
        enter = Math.max(enter, Math.min(a, b))
        leave = Math.min(leave, Math.max(a, b))
        if (enter > leave) return false
      }
      return enter <= leave
    })
  }
}
