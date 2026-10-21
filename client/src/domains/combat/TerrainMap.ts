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

  /**
   * 把一个「想放在这」的点挪到能放的地方。
   *
   * ⚠️ **`radius` 与 `reachRadius` 是两件事，别合成一个数用。**
   *
   * - `radius` = **摆放净空**：这个东西自己占多大地方（怪的碰撞半径、宝箱贴图的半边长）。
   *   决定「离墙、离桌子够不够远」。
   * - `reachRadius` = **通行半径**：**能走到那儿的是谁**。整层连续之后地图是一整张，
   *   房间之间靠门洞相连，门洞只有几十像素宽 —— 拿一个比门洞还粗的半径去泛洪，
   *   **整间房都会被判成「不可达」**（泛洪过不去门洞），于是兜底把它扔到
   *   出生点那一片走廊上。
   *
   * ★ 改了（2026-10-21）：早先只有一个 `radius`，两者共用。症状是**宝箱和怪都能被扔出房**，
   *   而且看起来毫无道理（房内明明有几百格空地）：
   *   - 宝箱：`chest.visualSize = 56` 被当成净空去泛洪 —— 那其实是个**直径**
   *     （本该按半边长 28 算），56 > 门洞 → 泛洪进不了房 → 实测扔出房外 **200—540px**；
   *   - 怪：门洞窄于 `2 × 26` 的房间（如种子 20261012 的 YF611），整间房不可达 →
   *     刷怪点被挪到**隔壁房和走廊**（实测 **673px / 731px**）。
   *
   *   两个症状同一个根。`reachRadius` 取**要走到那个东西的人**的半径
   *   （宝箱是玩家的 12；怪也是玩家的 12 —— 判据是「玩家能不能打到它」，
   *   不是「它自己能不能走过去」：怪本来就该刷在自己的房间里，
   *   而肉盾（半径 40）根本挤不过门洞）。
   *
   * 默认值 = `radius`，也就是老行为：手画的 `stage-collisions.json` 那几关
   * 仍是「一关一块地」，没有门洞这回事，不必传。
   */
  safeSpawn(x: number, y: number, radius: number, reachRadius = radius): Point {
    const clamp = (n: number, upper: number) => Math.min(upper - radius, Math.max(radius, n))
    const desired = { x: clamp(x, this.width), y: clamp(y, this.height) }
    const component = this.solids.length ? this.reachableCells(reachRadius) : null
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
