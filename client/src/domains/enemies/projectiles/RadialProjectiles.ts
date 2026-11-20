import type { RadialProjectileConfig } from '@/core/config'
import { deflectVortexVelocity, type VortexSnapshot } from '@/core/vortex'

export interface RadialShot {
  active: boolean
  id: number
  ownerId: number
  x: number
  y: number
  vx: number
  vy: number
  damage: number
  bornAtMs: number
  updatedAtMs: number
  radius: number
  speed: number
  speedStart: number
  speedEnd: number
  speedRampMs: number
  bounceLeft: number
  lifetimeMs: number
  color?: number
}

export interface BossVolley {
  count: number
  speed: number
  radius: number
  damage: number
  lifetimeMs: number
  color?: number
  angleRad?: number
  spreadRad?: number
  /** Ring-only rotation; ignored when angleRad is set. */
  angleOffsetRad?: number
  speedEnd?: number
  speedRampMs?: number
  bounceCount?: number
  lineSpacingPx?: number
}

export interface ProjectileTarget {
  x: number
  y: number
  radius: number
  alive: boolean
}

/** Fixed slots; swept collision prevents fast shots from passing through a player between frames. */
export class RadialProjectiles {
  readonly shots: RadialShot[]
  private nextId = 1
  private volley = 0

  constructor(readonly cfg: RadialProjectileConfig) {
    this.shots = Array.from({ length: cfg.maxActive }, () => ({
      active: false,
      id: 0,
      ownerId: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      damage: 0,
      bornAtMs: 0,
      updatedAtMs: 0,
      radius: cfg.radius,
      speed: cfg.speed,
      speedStart: cfg.speed,
      speedEnd: cfg.speed,
      speedRampMs: 0,
      bounceLeft: 0,
      lifetimeMs: cfg.lifetimeMs,
    }))
  }

  emit(ownerId: number, x: number, y: number, nowMs: number, damage: number): number {
    return this.emitCustom(ownerId, x, y, nowMs, { ...this.cfg, damage })
  }

  emitCustom(ownerId: number, x: number, y: number, nowMs: number, volley: BossVolley): number {
    const speedEnd = volley.speedEnd ?? volley.speed
    const speedRampMs = volley.speedRampMs ?? 0
    const bounceCount = volley.bounceCount ?? 0
    const lineSpacingPx = volley.lineSpacingPx ?? 0
    if (!Number.isInteger(volley.count) || volley.count <= 0 ||
      ![volley.speed, volley.radius, volley.lifetimeMs, speedEnd].every((value) => Number.isFinite(value) && value > 0) ||
      !Number.isFinite(volley.damage) || volley.damage < 0 ||
      !Number.isFinite(speedRampMs) || speedRampMs < 0 ||
      !Number.isInteger(bounceCount) || bounceCount < 0 ||
      !Number.isFinite(lineSpacingPx) || lineSpacingPx < 0) return 0
    // Drop the whole volley on saturation so the ring never has arbitrary missing directions.
    if (this.shots.reduce((free, shot) => free + Number(!shot.active), 0) < volley.count) return 0
    const offset = (this.volley++ * this.cfg.volleyOffsetDeg * Math.PI) / 180
    let emitted = 0
    for (const shot of this.shots) {
      if (shot.active) continue
      const angle = volley.angleRad === undefined
        ? (volley.angleOffsetRad ?? offset) + (emitted / volley.count) * Math.PI * 2
        : volley.angleRad + (emitted - (volley.count - 1) / 2) * (volley.spreadRad ?? 0)
      const dx = Math.cos(angle),
        dy = Math.sin(angle)
      const lineOffset = lineSpacingPx * (emitted - (volley.count - 1) / 2)
      const px = Math.cos(angle + Math.PI / 2) * lineOffset
      const py = Math.sin(angle + Math.PI / 2) * lineOffset
      Object.assign(shot, {
        active: true,
        id: this.nextId++,
        ownerId,
        x: x + dx * this.cfg.spawnRadius + px,
        y: y + dy * this.cfg.spawnRadius + py,
        vx: dx * volley.speed,
        vy: dy * volley.speed,
        damage: volley.damage,
        radius: volley.radius,
        speed: volley.speed,
        speedStart: volley.speed,
        speedEnd,
        speedRampMs,
        bounceLeft: bounceCount,
        lifetimeMs: volley.lifetimeMs,
        color: volley.color,
        bornAtMs: nowMs,
        updatedAtMs: nowMs,
      })
      if (++emitted === volley.count) break
    }
    return emitted
  }

  step(
    nowMs: number,
    target: ProjectileTarget | null,
    ownerAlive: (id: number) => boolean,
    canTravel: (x0: number, y0: number, x1: number, y1: number, radius: number) => boolean,
    hit: (shot: RadialShot) => void,
    fields: readonly VortexSnapshot[] = [],
  ): void {
    for (const shot of this.shots) {
      if (!shot.active) continue
      if (!ownerAlive(shot.ownerId)) {
        shot.active = false
        continue
      }
      const expiresAt = shot.bornAtMs + shot.lifetimeMs
      const nextAt = Math.min(nowMs, expiresAt)
      if (nowMs >= expiresAt) {
        shot.active = false
        continue
      }
      if (nextAt <= shot.updatedAtMs) continue
      const dt = (nextAt - shot.updatedAtMs) / 1000
      const x0 = shot.x,
        y0 = shot.y
      const ageMs = Math.max(0, nextAt - shot.bornAtMs)
      const targetSpeed =
        shot.speedRampMs > 0
          ? shot.speedStart +
            (shot.speedEnd - shot.speedStart) * Math.min(1, ageMs / shot.speedRampMs)
          : shot.speedEnd
      if (targetSpeed !== shot.speed) {
        const magnitude = Math.hypot(shot.vx, shot.vy) || shot.speed
        const scale = targetSpeed / magnitude
        shot.vx *= scale
        shot.vy *= scale
        shot.speed = targetSpeed
      }
      const velocity = deflectVortexVelocity(shot, { x: shot.vx, y: shot.vy }, fields, dt)
      shot.vx = velocity.x
      shot.vy = velocity.y
      shot.speed = Math.hypot(shot.vx, shot.vy)
      shot.x += shot.vx * dt
      shot.y += shot.vy * dt
      shot.updatedAtMs = nextAt
      if (!canTravel(x0, y0, shot.x, shot.y, shot.radius)) {
        if (shot.bounceLeft <= 0) {
          shot.active = false
          continue
        }
        // Axis-separated reflection: use the existing line-of-sight predicate as
        // the wall test, so bouncing shares the same collision rules as flight.
        const canX = canTravel(x0, y0, shot.x, y0, shot.radius)
        const canY = canTravel(x0, y0, x0, shot.y, shot.radius)
        if (!canX) shot.vx = -shot.vx
        if (!canY) shot.vy = -shot.vy
        if (canX && canY) {
          shot.vx = -shot.vx
          shot.vy = -shot.vy
        }
        shot.bounceLeft--
        shot.x = x0
        shot.y = y0
        continue
      }
      if (target?.alive && intersectsTarget(x0, y0, shot.x, shot.y, target, shot.radius)) {
        shot.active = false
        hit(shot)
      }
    }
  }

  removeOwner(id: number): void {
    for (const shot of this.shots) if (shot.ownerId === id) shot.active = false
  }

  clear(): void {
    for (const shot of this.shots) shot.active = false
    this.volley = 0
  }
}

function intersectsTarget(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  target: ProjectileTarget,
  radius: number,
): boolean {
  const dx = x1 - x0,
    dy = y1 - y0
  const lengthSq = dx * dx + dy * dy
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((target.x - x0) * dx + (target.y - y0) * dy) / lengthSq))
  return Math.hypot(x0 + dx * t - target.x, y0 + dy * t - target.y) <= target.radius + radius
}
