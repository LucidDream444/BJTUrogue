import type { CombatConfig } from './config'
import type { SolidRect, StageLayout } from './StageGeometry'

export interface Point {
  x: number
  y: number
}
export interface WaterRect extends Point {
  width: number
  height: number
}

/** One geometry model for physical obstacles, navigation, projectiles and spawn safety. */
export class TerrainMap {
  readonly width: number
  readonly height: number
  readonly water: readonly WaterRect[]
  readonly cellSize: number
  solids: readonly SolidRect[] = []
  private spawnOrigin: Point
  private readonly components = new Map<number, Uint8Array>()
  constructor(config: CombatConfig, cellSize = config.terrain.navigationCellSize) {
    this.width = config.arena.width
    this.height = config.arena.height
    this.water = config.terrain.water
    this.cellSize = cellSize
    this.spawnOrigin = config.terrain.playerSpawn
  }

  setStage(layout: StageLayout): void {
    this.solids = layout.solids
    this.spawnOrigin = layout.playerSpawn
    this.components.clear()
  }

  isWater(x: number, y: number): boolean {
    return this.water.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)
  }

  isWalkable(x: number, y: number, radius = 0): boolean {
    if (x < radius || y < radius || x > this.width - radius || y > this.height - radius)
      return false
    // Expanding by actor radius also keeps navigation paths away from the bank corners.
    const overlaps = (r: WaterRect) =>
      x >= r.x - radius &&
      x <= r.x + r.width + radius &&
      y >= r.y - radius &&
      y <= r.y + r.height + radius
    return !this.water.some(overlaps) && !this.solids.some(overlaps)
  }

  safeSpawn(x: number, y: number, radius: number): Point {
    const clamp = (n: number, upper: number) => Math.min(upper - radius, Math.max(radius, n))
    const desired = { x: clamp(x, this.width), y: clamp(y, this.height) }
    const component = this.solids.length ? this.reachableCells(radius) : null
    const cols = Math.ceil(this.width / this.cellSize)
    const reachable = (px: number, py: number) =>
      !component ||
      component[Math.floor(py / this.cellSize) * cols + Math.floor(px / this.cellSize)] === 1
    if (this.isWalkable(desired.x, desired.y, radius) && reachable(desired.x, desired.y))
      return desired
    // Spawn and split requests are cold paths; choose the nearest safe navigation cell.
    let best: Point | null = null,
      distance = Infinity
    for (let cy = this.cellSize / 2; cy < this.height; cy += this.cellSize) {
      for (let cx = this.cellSize / 2; cx < this.width; cx += this.cellSize) {
        if (!this.isWalkable(cx, cy, radius) || !reachable(cx, cy)) continue
        const d = (cx - desired.x) ** 2 + (cy - desired.y) ** 2
        if (d < distance) {
          best = { x: cx, y: cy }
          distance = d
        }
      }
    }
    if (!best) throw new Error('地图没有可供实体出生的安全区域')
    return best
  }

  /** Flood from the entry so spawns cannot be stranded behind a closed door. */
  private reachableCells(radius: number): Uint8Array {
    const cached = this.components.get(radius)
    if (cached) return cached
    const cols = Math.ceil(this.width / this.cellSize),
      rows = Math.ceil(this.height / this.cellSize)
    const reachable = new Uint8Array(cols * rows),
      walkable = new Uint8Array(cols * rows)
    const queue = new Int32Array(cols * rows)
    let start = -1,
      best = Infinity
    for (let i = 0; i < walkable.length; i++) {
      const x = ((i % cols) + 0.5) * this.cellSize,
        y = (Math.floor(i / cols) + 0.5) * this.cellSize
      if (!this.isWalkable(x, y, radius)) continue
      walkable[i] = 1
      const distance = (x - this.spawnOrigin.x) ** 2 + (y - this.spawnOrigin.y) ** 2
      if (distance < best) {
        best = distance
        start = i
      }
    }
    if (start >= 0) {
      let head = 0,
        tail = 1
      queue[0] = start
      reachable[start] = 1
      while (head < tail) {
        const i = queue[head++]!,
          x = i % cols,
          y = Math.floor(i / cols)
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx!,
            ny = y + dy!,
            next = ny * cols + nx
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !walkable[next] || reachable[next])
            continue
          reachable[next] = 1
          queue[tail++] = next
        }
      }
    }
    this.components.set(radius, reachable)
    return reachable
  }

  /** Swept collision catches fast projectiles crossing a thin door between physics frames. */
  solidHitTime(from: Point, to: Point, radius = 0): number | null {
    let first: number | null = null
    for (const r of this.solids) {
      let enter = 0,
        leave = 1,
        hit = true
      for (const axis of ['x', 'y'] as const) {
        const low = r[axis] - radius,
          high = r[axis] + (axis === 'x' ? r.width : r.height) + radius,
          delta = to[axis] - from[axis]
        if (Math.abs(delta) < 1e-9) {
          if (from[axis] < low || from[axis] > high) {
            hit = false
            break
          }
          continue
        }
        const a = (low - from[axis]) / delta,
          b = (high - from[axis]) / delta
        enter = Math.max(enter, Math.min(a, b))
        leave = Math.min(leave, Math.max(a, b))
        if (enter > leave) {
          hit = false
          break
        }
      }
      if (hit && (first === null || enter < first)) first = enter
    }
    return first
  }
  crossesSolid(from: Point, to: Point, radius = 0): boolean {
    return this.solidHitTime(from, to, radius) !== null
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
