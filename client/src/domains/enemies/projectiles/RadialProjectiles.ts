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
  splitAfterMs: number
  splitCount: number
  splitSpeedScale: number
  splitDamageRatio: number
  splitSpreadRad: number
  lifetimeMs: number
  color?: number
}

export interface BossVolleyShot {
  x: number
  y: number
  angleRad: number
  speed?: number
  radius?: number
  damage?: number
  lifetimeMs?: number
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
  anglesRad?: readonly number[]
  /** Ring-only rotation; ignored when angleRad is set. */
  angleOffsetRad?: number
  spawnRadius?: number
  spawnAngleOffsetRad?: number
  shots?: readonly BossVolleyShot[]
  splitAfterMs?: number
  splitCount?: number
  splitSpeedScale?: number
  splitDamageRatio?: number
  splitSpreadRad?: number
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

interface PendingSplit {
  ownerId: number
  x: number
  y: number
  angle: number
  speed: number
  radius: number
  damage: number
  lifetimeMs: number
  color?: number
  count: number
  speedScale: number
  damageRatio: number
  spreadRad: number
}

/** Fixed slots; swept collision prevents fast shots from passing through a player between frames. */
export class RadialProjectiles {
  readonly shots: RadialShot[]
  private nextId = 1
  private volley = 0
  private readonly pendingSplits: PendingSplit[] = []

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
      splitAfterMs: 0,
      splitCount: 0,
      splitSpeedScale: 1,
      splitDamageRatio: 0,
      splitSpreadRad: 0,
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
    const explicitAngles = volley.anglesRad
    const shots = volley.shots
    const count = shots ? shots.length : explicitAngles ? explicitAngles.length : volley.count
    if (!Number.isInteger(count) || count <= 0 ||
      ![volley.speed, volley.radius, volley.lifetimeMs, speedEnd].every((value) => Number.isFinite(value) && value > 0) ||
      (shots?.some((shot) =>
        !Number.isFinite(shot.x) || !Number.isFinite(shot.y) ||
        !Number.isFinite(shot.angleRad) ||
        (shot.speed !== undefined && (!Number.isFinite(shot.speed) || shot.speed <= 0)) ||
        (shot.radius !== undefined && (!Number.isFinite(shot.radius) || shot.radius <= 0)) ||
        (shot.damage !== undefined && (!Number.isFinite(shot.damage) || shot.damage < 0)) ||
        (shot.lifetimeMs !== undefined && (!Number.isFinite(shot.lifetimeMs) || shot.lifetimeMs <= 0)),
      ) ?? false) ||
      !Number.isFinite(volley.damage) || volley.damage < 0 ||
      !Number.isFinite(speedRampMs) || speedRampMs < 0 ||
      !Number.isInteger(bounceCount) || bounceCount < 0 ||
      !Number.isFinite(lineSpacingPx) || lineSpacingPx < 0) return 0
    // Drop the whole volley on saturation so the ring never has arbitrary missing directions.
    if (this.shots.reduce((free, shot) => free + Number(!shot.active), 0) < count) return 0
    const offset = (this.volley++ * this.cfg.volleyOffsetDeg * Math.PI) / 180
    let emitted = 0
    for (const shot of this.shots) {
      if (shot.active) continue
      const spec = shots?.[emitted]
      const angle = spec
        ? spec.angleRad
        : explicitAngles
          ? explicitAngles[emitted]!
          : volley.angleRad === undefined
            ? (volley.angleOffsetRad ?? offset) + (emitted / count) * Math.PI * 2
            : volley.angleRad + (emitted - (count - 1) / 2) * (volley.spreadRad ?? 0)
      const dx = Math.cos(angle),
        dy = Math.sin(angle)
      const lineOffset = lineSpacingPx * (emitted - (count - 1) / 2)
      const px = Math.cos(angle + Math.PI / 2) * lineOffset
      const py = Math.sin(angle + Math.PI / 2) * lineOffset
      const spawnAngle = angle + (volley.spawnAngleOffsetRad ?? 0)
      const spawnRadius = volley.spawnRadius ?? this.cfg.spawnRadius
      const shotSpeed = spec?.speed ?? volley.speed
      Object.assign(shot, {
        active: true,
        id: this.nextId++,
        ownerId,
        x: spec ? x + spec.x : x + Math.cos(spawnAngle) * spawnRadius + px,
        y: spec ? y + spec.y : y + Math.sin(spawnAngle) * spawnRadius + py,
        vx: dx * shotSpeed,
        vy: dy * shotSpeed,
        damage: spec?.damage ?? volley.damage,
        radius: spec?.radius ?? volley.radius,
        speed: shotSpeed,
        speedStart: shotSpeed,
        speedEnd: spec?.speed ?? speedEnd,
        speedRampMs,
        bounceLeft: bounceCount,
        splitAfterMs: volley.splitAfterMs ?? 0,
        splitCount: volley.splitCount ?? 0,
        splitSpeedScale: volley.splitSpeedScale ?? 1,
        splitDamageRatio: volley.splitDamageRatio ?? 0,
        splitSpreadRad: volley.splitSpreadRad ?? 0,
        lifetimeMs: spec?.lifetimeMs ?? volley.lifetimeMs,
        color: volley.color,
        bornAtMs: nowMs,
        updatedAtMs: nowMs,
      })
      if (++emitted === count) break
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
      if (shot.splitAfterMs > 0 && shot.splitCount > 0 && ageMs >= shot.splitAfterMs) {
        shot.active = false
        this.pendingSplits.push({
          ownerId: shot.ownerId,
          x: shot.x,
          y: shot.y,
          angle: Math.atan2(shot.vy, shot.vx),
          speed: shot.speed,
          radius: shot.radius,
          damage: shot.damage,
          lifetimeMs: shot.lifetimeMs,
          color: shot.color,
          count: shot.splitCount,
          speedScale: shot.splitSpeedScale,
          damageRatio: shot.splitDamageRatio,
          spreadRad: shot.splitSpreadRad,
        })
        continue
      }
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
    if (this.pendingSplits.length) {
      const splits = this.pendingSplits.splice(0)
      for (const split of splits) {
        const fullRing = split.spreadRad >= Math.PI * 1.999
        this.emitCustom(split.ownerId, split.x, split.y, nowMs, {
          count: split.count,
          speed: split.speed * split.speedScale,
          radius: split.radius * 0.72,
          damage: split.damage * split.damageRatio,
          lifetimeMs: split.lifetimeMs,
          color: split.color,
          ...(fullRing
            ? { angleOffsetRad: split.angle }
            : { angleRad: split.angle, spreadRad: split.spreadRad }),
        })
      }
    }
  }

  removeOwner(id: number): void {
    for (const shot of this.shots) if (shot.ownerId === id) shot.active = false
  }

  clear(): void {
    for (const shot of this.shots) shot.active = false
    this.pendingSplits.length = 0
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
