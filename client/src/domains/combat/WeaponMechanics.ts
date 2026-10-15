import type { HitResult } from '@/core/actor/damage'
import type { WeaponDef } from './config'

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
    if (!this.port.target(id)) return
    const active = this.poisons.get(id)
    if (active && active.untilMs >= nowMs) {
      active.untilMs = nowMs + weapon.poisonDurationMs!
      active.damage = Math.max(active.damage, weapon.poisonTickDamage!)
      return
    }
    if (!active && this.poisons.size >= this.capacity) return
    this.poisons.set(id, {
      id,
      sourceId,
      untilMs: nowMs + weapon.poisonDurationMs!,
      nextTickMs: nowMs + weapon.poisonTickMs!,
      tickMs: weapon.poisonTickMs!,
      damage: weapon.poisonTickDamage!,
      tick: 0,
      lastFrame: -1,
    })
  }

  chill(id: number, weapon: WeaponDef, nowMs: number): void {
    if (!this.port.target(id) || (!this.chills.has(id) && this.chills.size >= this.capacity)) return
    const until = nowMs + weapon.slowDurationMs!
    this.chills.set(id, until)
    this.port.slow(id, weapon.slowMultiplier!, until)
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
