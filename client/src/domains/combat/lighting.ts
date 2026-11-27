/**
 * 暗区光照的**纯几何**。零 Phaser 依赖，node 下可直接单测。
 *
 * 只回答三个问题：
 * 1. 一条射线先撞到哪面墙（`rayRectDistance`）—— 用来画可见光扇；
 * 2. 两点之间有没有墙（`segmentBlocked`）—— 用来决定实体是否被照亮；
 * 3. 某个点是否在玩家/子弹的光里（`isPointLit`）。
 *
 * 坐标约定与 `StageGeometry.SolidRect` 一致：`x` / `y` 是**左上角**，宽高为正。
 *
 * ⚠️ **角落要放大一点点（`EDGE_EPS`）**：两条相邻墙的边在拐角处如果严格相接，
 * 射线会从数值缝隙里钻出去，表现为「墙拐角后面漏进一道光」。宁可多挡半像素，
 * 也不要让光穿墙 —— 后者玩家一眼就能看见，前者看不出来。
 */

export interface LightRect {
  x: number
  y: number
  width: number
  height: number
  /**
   * 桌椅等**室内家具**：可见光扇可以覆盖它的整块贴图（停在外沿 + 一点余量），
   * 但光不会继续穿到它后面。墙/门挡板没有这个标记，光线停在近面。
   */
  furniture?: boolean
}

/** 一条射线穿过矩形时的近面 / 远面距离。没相交时两者都等于 `maxDist`。 */
export interface RaySpan {
  near: number
  far: number
}

export interface LightPoint {
  x: number
  y: number
}

export interface LightSource extends LightPoint {
  radius: number
}

/** 拐角数值容差（世界像素）。 */
const EDGE_EPS = 0.5

/**
 * 射线 `(ox, oy) + t * (dx, dy)`（方向必须是单位向量）到矩形的最短命中距离。
 * 没命中返回 `maxDist`；起点在矩形内返回 0。超出 `maxDist` 的命中不算。
 */
export function rayRectSpan(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
  rect: LightRect,
): RaySpan {
  const minX = rect.x - EDGE_EPS
  const maxX = rect.x + rect.width + EDGE_EPS
  const minY = rect.y - EDGE_EPS
  const maxY = rect.y + rect.height + EDGE_EPS

  let tMin = 0
  let tMax = maxDist

  if (Math.abs(dx) < 1e-9) {
    if (ox < minX || ox > maxX) return { near: maxDist, far: maxDist }
  } else {
    const inv = 1 / dx
    let t1 = (minX - ox) * inv
    let t2 = (maxX - ox) * inv
    if (t1 > t2) {
      const swap = t1
      t1 = t2
      t2 = swap
    }
    if (t1 > tMin) tMin = t1
    if (t2 < tMax) tMax = t2
    if (tMin > tMax) return { near: maxDist, far: maxDist }
  }

  if (Math.abs(dy) < 1e-9) {
    if (oy < minY || oy > maxY) return { near: maxDist, far: maxDist }
  } else {
    const inv = 1 / dy
    let t1 = (minY - oy) * inv
    let t2 = (maxY - oy) * inv
    if (t1 > t2) {
      const swap = t1
      t1 = t2
      t2 = swap
    }
    if (t1 > tMin) tMin = t1
    if (t2 < tMax) tMax = t2
    if (tMin > tMax) return { near: maxDist, far: maxDist }
  }

  return { near: tMin, far: Math.min(maxDist, tMax) }
}

export function rayRectDistance(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
  rect: LightRect,
): number {
  return rayRectSpan(ox, oy, dx, dy, maxDist, rect).near
}

/**
 * 线段 `(x0, y0) → (x1, y1)` 是否被任一矩形挡住。
 *
 * 先按线段的包围盒粗筛，避免每个实体都拿整层 190 块墙跑一遍。
 */
export function segmentBlocked(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rects: readonly LightRect[],
): boolean {
  const dx = x1 - x0
  const dy = y1 - y0
  const length = Math.hypot(dx, dy)
  if (length < 1e-6) return false
  const ux = dx / length
  const uy = dy / length
  const minX = Math.min(x0, x1)
  const maxX = Math.max(x0, x1)
  const minY = Math.min(y0, y1)
  const maxY = Math.max(y0, y1)

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!
    if (
      r.x - EDGE_EPS > maxX ||
      r.x + r.width + EDGE_EPS < minX ||
      r.y - EDGE_EPS > maxY ||
      r.y + r.height + EDGE_EPS < minY
    )
      continue
    if (rayRectDistance(x0, y0, ux, uy, length, r) < length - EDGE_EPS) return true
  }
  return false
}

/**
 * 以 `origin` 为圆心、`radius` 为半径，向四周 `rays` 条射线求最近墙距。
 * 结果写进 `out`（长度至少为 `rays`），供表现层直接连成可见光多边形。
 */
export function castRayDistances(
  origin: LightPoint,
  radius: number,
  rects: readonly LightRect[],
  rays: number,
  out: Float32Array,
  furnitureMarginPx = 0,
): void {
  const step = (Math.PI * 2) / rays
  for (let i = 0; i < rays; i++) {
    const angle = i * step
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)

    // 最近一堵墙：光停它的近面。
    let wall = radius
    // 第一件挡在墙前面的家具：光覆盖到它（以及和它相连的家具）的外沿，
    // 然后停在后面 —— 贴图被照亮，但桌椅后面的传播路径仍然被挡住。
    let furnitureNear = Infinity
    let furnitureFar = -Infinity
    for (let j = 0; j < rects.length; j++) {
      const rect = rects[j]!
      const span = rayRectSpan(origin.x, origin.y, dx, dy, radius, rect)
      if (span.near >= radius) continue
      if (rect.furniture) {
        if (span.near < wall && span.near < furnitureNear) {
          furnitureNear = span.near
          furnitureFar = span.far
        }
      } else if (span.near < wall) {
        wall = span.near
      }
    }

    if (furnitureNear >= wall || !Number.isFinite(furnitureNear)) {
      out[i] = wall
      continue
    }

    let distance = Math.min(radius, furnitureFar + furnitureMarginPx)
    // 连续的家具（L 形/缺口形/长条的多行）一起覆盖。只向**墙前面**的家具延伸，
    // 不让光从桌椅外沿的余量里穿过一堵墙去照亮隔壁。
    for (let j = 0; j < rects.length; j++) {
      const rect = rects[j]!
      if (!rect.furniture) continue
      const span = rayRectSpan(origin.x, origin.y, dx, dy, radius, rect)
      if (span.near < wall && span.near <= distance && span.far + furnitureMarginPx > distance) {
        distance = Math.min(radius, span.far + furnitureMarginPx)
      }
    }
    out[i] = distance
  }
}

function insideLight(source: LightSource, x: number, y: number): boolean {
  const dx = x - source.x
  const dy = y - source.y
  return dx * dx + dy * dy <= source.radius * source.radius
}

/**
 * 一个点是否被玩家光或任意一颗玩家子弹光照亮。
 *
 * 距离只做粗筛，**最终判据是视线**：站在墙后、但离玩家很近的敌人依然是暗的。
 */
export function isPointLit(
  x: number,
  y: number,
  player: LightSource,
  bullets: readonly LightSource[],
  rects: readonly LightRect[],
): boolean {
  if (insideLight(player, x, y) && !segmentBlocked(player.x, player.y, x, y, rects)) return true
  for (let i = 0; i < bullets.length; i++) {
    const bullet = bullets[i]!
    if (insideLight(bullet, x, y) && !segmentBlocked(bullet.x, bullet.y, x, y, rects)) return true
  }
  return false
}
