/**
 * 转向力的公用零件。**零 Phaser 依赖**，node 下可直接单测。
 *
 * 三个函数的输出**相加**才是最终速度意图：
 *
 * ```
 *   期望速度 = 追击方向 × 速度          ← desiredDir：绕墙靠它
 *            + 分离力（归一化）× 强度    ← separation：不扎堆靠它
 *   最终意图 = clamp(期望速度, 0, 速度上限)
 * ```
 *
 * 分开写是有原因的：分离力是**局部短程力**（只跟身边几个邻居有关），
 * 追击是**大尺度导航**（跟整张地图有关）。混在一起写，一旦怪卡住就说不清是哪一边的问题。
 *
 * ## 为什么追击方向要「有视野走直线、没视野走网格」
 *
 * 流向场是 8 邻域 BFS 的产物，梯度只能指向 8 个方向之一。
 * 直接用它的后果是**敌人追人时走「楼梯步」**——一帧横一帧竖，看着很廉价。
 *
 * 所以：`hasLineOfSight` 成立时直接算 `目标 - 自己`（角度连续、丝滑），
 * 只有被墙挡住才退回网格流向。绝大多数时候（开阔房间、走廊里）走的都是直线分支，
 * 网格只负责「绕过那个墙角」，绕完之后视线恢复、又变回直线。
 */

import type { BrainContext, NavView, ActorSnapshot } from '@/core/actor/types'

export interface Vec2 {
  x: number
  y: number
}

/** 复用的临时向量。这些函数都是同步、顺序调用的，所以模块级 scratch 是安全的。 */
const _seek: Vec2 = { x: 0, y: 0 }
const _sep: Vec2 = { x: 0, y: 0 }
const ZERO: Vec2 = { x: 0, y: 0 }

/** 复用的输出对象。brain 用它填 `BrainOutput`，避免每次 AI tick 都分配。 */
export const scratchIntent: Vec2 = { x: 0, y: 0 }

/** 把 `out` 设成从 `(fromX, fromY)` 指向 `(toX, toY)` 的单位向量。零长度 → `(0,0)`。 */
export function dirTo(fromX: number, fromY: number, toX: number, toY: number, out: Vec2): Vec2 {
  const dx = toX - fromX
  const dy = toY - fromY
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 1e-6) {
    out.x = 0
    out.y = 0
    return out
  }
  out.x = dx / len
  out.y = dy / len
  return out
}

/**
 * 期望移动方向。**这是敌人「往哪走」的唯一入口。**
 *
 * 优先级：直线视野 > 流向场 > 直线（兜底）。
 *
 * 最后一档兜底很重要：`nav` 为 `null`（无墙房间）或玩家跑出网格时，
 * 必须退化成直线追。**不能退化成「站着不动」**——那会表现为
 * 「玩家一出房间，全屏敌人集体僵住」。
 */
export function desiredDir(
  selfX: number,
  selfY: number,
  targetX: number,
  targetY: number,
  nav: NavView | null,
  out: Vec2,
): Vec2 {
  if (nav && !nav.hasLineOfSight(selfX, selfY, targetX, targetY)) {
    const flow = nav.dirAt(selfX, selfY)
    if (flow && (flow.x !== 0 || flow.y !== 0)) {
      out.x = flow.x
      out.y = flow.y
      return out
    }
    // 流向场也帮不上忙（不可达 / 在网格外）→ 掉到下面的直线兜底
  }
  return dirTo(selfX, selfY, targetX, targetY, out)
}

/**
 * 分离力（未归一化）。同类挤在一起时把它们推开。
 *
 * 判据是 `self.radius + other.radius + pad`：
 * - 只加 `pad` 而不是「半径和」会让体型差别大的怪互相穿模（小怪钻进大怪身体里）；
 * - `pad` 是配置项（`ai.separationPad`），调手感不用改代码。
 *
 * ⚠️ 完全重合（`d2 === 0`）要单独处理：除法会出 `Infinity`，两个怪会一起飞出去。
 * 这时候按 id 决定一个确定的推开方向 —— 用 `Math.random()` 的话，
 * 同一份录像回放两次结果不同，调试无从下手。
 */
export function separation(
  self: ActorSnapshot,
  neighbors: readonly ActorSnapshot[],
  pad: number,
  out: Vec2,
): Vec2 {
  out.x = 0
  out.y = 0

  for (let i = 0; i < neighbors.length; i++) {
    const n = neighbors[i]!
    if (n.id === self.id || !n.alive) continue

    const minDist = self.radius + n.radius + pad
    const dx = self.x - n.x
    const dy = self.y - n.y
    const d2 = dx * dx + dy * dy

    if (d2 >= minDist * minDist) continue

    if (d2 < 1e-12) {
      // 完全重合：按 id 取一个确定的方向，别做除法
      const sign = (self.id + n.id) % 2 === 0 ? 1 : -1
      out.x += sign
      out.y += sign * 0.5
      continue
    }

    const d = Math.sqrt(d2)
    // 越近推得越狠：权重从 1（贴住）线性衰减到 0（刚好接触）
    const w = (minDist - d) / minDist
    out.x += (dx / d) * w
    out.y += (dy / d) * w
  }

  return out
}

/**
 * 合成最终速度意图并夹到 `maxSpeed`。**统一在这里 clamp**，
 * 否则分离力叠上去会让怪瞬间超速（尤其是在墙角被挤成一团的时候）。
 *
 * `sepStrength` 是「分离力最多能占速度上限的多少」的绝对量（px/s），
 * 不是倍数 —— 用倍数的话，速度不同的怪分离强度会跟着变，手感不一致。
 */
export function combine(
  dir: Vec2,
  sep: Vec2,
  maxSpeed: number,
  sepStrength: number,
  out: Vec2,
): Vec2 {
  let vx = dir.x * maxSpeed
  let vy = dir.y * maxSpeed

  const sepLen = Math.sqrt(sep.x * sep.x + sep.y * sep.y)
  if (sepLen > 1e-6 && sepStrength > 0) {
    // 归一化后再乘强度：邻居数量不该影响推力大小，
    // 否则「被 5 个邻居挤」会比「被 1 个邻居挤」推得快 5 倍，直接穿透墙。
    vx += (sep.x / sepLen) * sepStrength
    vy += (sep.y / sepLen) * sepStrength
  }

  const len = Math.sqrt(vx * vx + vy * vy)
  if (len > maxSpeed && len > 1e-6) {
    vx = (vx / len) * maxSpeed
    vy = (vy / len) * maxSpeed
  }

  out.x = vx
  out.y = vy
  return out
}

/** 便利封装：一次算完「期望方向 + 分离力 + 合成」。brain 里基本只用它。 */
export function steer(
  self: ActorSnapshot,
  target: ActorSnapshot | null,
  ctx: Pick<BrainContext, 'neighbors' | 'nav'>,
  maxSpeed: number,
  sepPad: number,
  sepStrength: number,
  out: Vec2,
): Vec2 {
  if (!target) {
    // 没目标也要分离：一堆怪挤在出生点会叠成一坨
    separation(self, ctx.neighbors, sepPad, _sep)
    return combine(ZERO, _sep, maxSpeed, sepStrength, out)
  }

  desiredDir(self.x, self.y, target.x, target.y, ctx.nav, _seek)
  separation(self, ctx.neighbors, sepPad, _sep)
  return combine(_seek, _sep, maxSpeed, sepStrength, out)
}