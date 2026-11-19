import type { HitResult } from '@/core/actor/damage'
import type { WeaponDef, WeaponStatusDef } from './config'

export interface WeaponTarget {
  id: number
  x: number
  y: number
  radius: number
}
export interface EffectTargetPort {
  target(id: number): WeaponTarget | null
  hit(id: number, sourceId: number, amount: number, tick: number | null): HitResult
  slow(id: number, multiplier: number, untilMs: number): void
}
export interface PoisonState {
  id: number
  sourceId: number
  untilMs: number
  nextTickMs: number
  tickMs: number
  damage: number
  tick: number
  lastFrame: number
  /** 本次状态的总时长，供 UI 画进度环（不同毒武器时长不同）。 */
  durationMs: number
}

/** Independent of projectile lifetime and immune to pooled actor reuse (IDs never repeat). */
export class WeaponStatuses {
  readonly poisons = new Map<number, PoisonState>()
  readonly chills = new Map<number, number>()
  constructor(
    private readonly port: EffectTargetPort,
    private readonly capacity: number,
  ) {}

  poison(id: number, sourceId: number, weapon: WeaponDef, nowMs: number): void {
    this.poisonWith(
      id,
      sourceId,
      {
        kind: 'poison',
        durationMs: weapon.poisonDurationMs!,
        tickMs: weapon.poisonTickMs!,
        tickDamage: weapon.poisonTickDamage!,
      },
      nowMs,
    )
  }

  chill(id: number, weapon: WeaponDef, nowMs: number): void {
    this.chillWith(
      id,
      { kind: 'slow', durationMs: weapon.slowDurationMs!, slowMultiplier: weapon.slowMultiplier! },
      nowMs,
    )
  }

  /** 新武器的配置化状态入口。 */
  apply(id: number, sourceId: number, status: WeaponStatusDef, nowMs: number): void {
    if (status.kind === 'poison') this.poisonWith(id, sourceId, status, nowMs)
    else this.chillWith(id, status, nowMs)
  }

  private poisonWith(
    id: number,
    sourceId: number,
    status: WeaponStatusDef,
    nowMs: number,
  ): void {
    if (!this.port.target(id)) return
    const active = this.poisons.get(id)
    if (active && active.untilMs >= nowMs) {
      active.untilMs = nowMs + status.durationMs
      active.durationMs = status.durationMs
      active.damage = Math.max(active.damage, status.tickDamage!)
      return
    }
    if (!active && this.poisons.size >= this.capacity) return
    this.poisons.set(id, {
      id,
      sourceId,
      untilMs: nowMs + status.durationMs,
      nextTickMs: nowMs + status.tickMs!,
      tickMs: status.tickMs!,
      damage: status.tickDamage!,
      tick: 0,
      lastFrame: -1,
      durationMs: status.durationMs,
    })
  }

  private chillWith(id: number, status: WeaponStatusDef, nowMs: number): void {
    if (!this.port.target(id) || (!this.chills.has(id) && this.chills.size >= this.capacity)) return
    const until = nowMs + status.durationMs
    this.chills.set(id, until)
    this.port.slow(id, status.slowMultiplier!, until)
  }

  step(nowMs: number, frameId: number, onTick: (target: WeaponTarget) => void): void {
    for (const [id, p] of this.poisons) {
      const target = this.port.target(id)
      if (!target) {
        this.poisons.delete(id)
        continue
      }
      // One tick per pair per logical frame; late frames never produce a damage avalanche.
      if (nowMs >= p.nextTickMs && p.nextTickMs <= p.untilMs && p.lastFrame !== frameId) {
        p.lastFrame = frameId
        const result = this.port.hit(id, p.sourceId, p.damage, ++p.tick)
        if (result.applied > 0) onTick(target)
        p.nextTickMs += (Math.floor((nowMs - p.nextTickMs) / p.tickMs) + 1) * p.tickMs
      }
      if (nowMs >= p.untilMs || !this.port.target(id)) this.poisons.delete(id)
    }
    for (const [id, until] of this.chills)
      if (nowMs >= until || !this.port.target(id)) this.chills.delete(id)
  }

  clear(): void {
    for (const id of this.chills.keys()) this.port.slow(id, 1, 0)
    this.chills.clear()
    this.poisons.clear()
  }
}

/** 归一化到 (-π, π]，供扇形判定使用。 */
export function angleDelta(a: number, b: number): number {
  let d = a - b
  while (d > Math.PI) d -= Math.PI * 2
  while (d <= -Math.PI) d += Math.PI * 2
  return d
}

/**
 * 近战扇形判定：距离 + 夹角 + 墙体视线。
 * `blocked` 与 `splashTargets` / `chainTargets` 同一套语义（墙/关着的门挡刀）。
 */
export function arcTargets(
  targets: readonly WeaponTarget[],
  origin: { x: number; y: number },
  angle: number,
  range: number,
  arcRad: number,
  padding: number,
  blocked: (from: { x: number; y: number }, to: WeaponTarget) => boolean,
): WeaponTarget[] {
  const half = Math.max(0, arcRad) / 2
  return targets.filter((t) => {
    const dx = t.x - origin.x,
      dy = t.y - origin.y,
      distance = Math.hypot(dx, dy)
    if (distance > range + t.radius + padding) return false
    if (distance > 1e-6 && Math.abs(angleDelta(Math.atan2(dy, dx), angle)) > half) return false
    return !blocked(origin, t)
  })
}

/** 追踪转向：把当前角度朝目标角度转，单帧最多转 `maxTurn` 弧度。 */
export function homingTurn(current: number, desired: number, maxTurn: number): number {
  const delta = angleDelta(desired, current)
  return current + Math.max(-maxTurn, Math.min(maxTurn, delta))
}

/** 分裂弹的角度分布：放射状均分，或沿父弹方向的扇形。 */
export function splitAngles(
  baseAngle: number,
  count: number,
  spreadRad: number,
  radial: boolean,
): number[] {
  if (!Number.isInteger(count) || count <= 0) return []
  if (radial) return Array.from({ length: count }, (_, i) => (i / count) * Math.PI * 2)
  if (count === 1) return [baseAngle]
  return Array.from(
    { length: count },
    (_, i) => baseAngle + (i / (count - 1) - 0.5) * spreadRad,
  )
}

/** 吸血量：按实际伤害比例，受单次上限约束。 */
export function lifestealHeal(applied: number, ratio: number, maxPerHit?: number): number {
  if (!(applied > 0) || !(ratio > 0)) return 0
  return Math.min(maxPerHit ?? Infinity, applied * ratio)
}

/** Continuous circle hit fraction; fast rail shots cannot tunnel through small enemies. */
export function segmentHit(
  from: { x: number; y: number },
  to: { x: number; y: number },
  target: WeaponTarget,
  padding: number,
): number | null {
  const x = from.x - target.x,
    y = from.y - target.y,
    dx = to.x - from.x,
    dy = to.y - from.y,
    r = target.radius + padding
  const c = x * x + y * y - r * r
  if (c <= 0) return 0
  const a = dx * dx + dy * dy
  if (a === 0) return null
  const b = x * dx + y * dy,
    disc = b * b - a * c
  if (disc < 0) return null
  const t = (-b - Math.sqrt(disc)) / a
  return t >= 0 && t <= 1 ? t : null
}

export function splashTargets(
  targets: readonly WeaponTarget[],
  primaryId: number,
  x: number,
  y: number,
  radius: number,
  blocked: (a: WeaponTarget, b: WeaponTarget) => boolean,
): WeaponTarget[] {
  const origin = { id: primaryId, x, y, radius: 0 }
  return targets.filter(
    (t) =>
      t.id !== primaryId &&
      Math.hypot(t.x - x, t.y - y) <= radius + t.radius &&
      !blocked(origin, t),
  )
}

export function chainTargets(
  targets: readonly WeaponTarget[],
  first: WeaponTarget,
  count: number,
  radius: number,
  blocked: (a: WeaponTarget, b: WeaponTarget) => boolean,
): WeaponTarget[] {
  const selected: WeaponTarget[] = [],
    used = new Set([first.id])
  let from = first
  while (selected.length < count) {
    let best: WeaponTarget | null = null,
      distance = Infinity
    for (const target of targets) {
      if (used.has(target.id) || blocked(from, target)) continue
      const d = Math.hypot(target.x - from.x, target.y - from.y)
      if (d <= radius && d < distance) {
        best = target
        distance = d
      }
    }
    if (!best) break
    selected.push(best)
    used.add(best.id)
    from = best
  }
  return selected
}
