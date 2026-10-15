import type { RadialProjectileConfig } from '@/core/config'

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
    }))
  }

  emit(ownerId: number, x: number, y: number, nowMs: number, damage: number): number {
    // Drop the whole volley on saturation so the ring never has arbitrary missing directions.
    if (this.shots.reduce((free, shot) => free + Number(!shot.active), 0) < this.cfg.count) return 0
    const offset = (this.volley++ * this.cfg.volleyOffsetDeg * Math.PI) / 180
    let emitted = 0
    for (const shot of this.shots) {
      if (shot.active) continue
      const angle = offset + (emitted / this.cfg.count) * Math.PI * 2
      const dx = Math.cos(angle),
        dy = Math.sin(angle)
      Object.assign(shot, {
        active: true,
        id: this.nextId++,
        ownerId,
        x: x + dx * this.cfg.spawnRadius,
        y: y + dy * this.cfg.spawnRadius,
        vx: dx * this.cfg.speed,
        vy: dy * this.cfg.speed,
        damage,
        bornAtMs: nowMs,
        updatedAtMs: nowMs,
      })
      if (++emitted === this.cfg.count) break
    }
    return emitted
  }

  step(
    nowMs: number,
    target: ProjectileTarget | null,
    ownerAlive: (id: number) => boolean,
    canTravel: (x0: number, y0: number, x1: number, y1: number) => boolean,
    hit: (shot: RadialShot) => void,
  ): void {
    for (const shot of this.shots) {
      if (!shot.active) continue
      if (!ownerAlive(shot.ownerId)) {
        shot.active = false
        continue
      }
      const expiresAt = shot.bornAtMs + this.cfg.lifetimeMs
      const nextAt = Math.min(nowMs, expiresAt)
      if (nextAt <= shot.updatedAtMs) continue
      const dt = (nextAt - shot.updatedAtMs) / 1000
      const x0 = shot.x,
        y0 = shot.y
      shot.x += shot.vx * dt
      shot.y += shot.vy * dt
      shot.updatedAtMs = nextAt
      if (!canTravel(x0, y0, shot.x, shot.y)) {
        shot.active = false
        continue
      }
      if (target?.alive && intersectsTarget(x0, y0, shot.x, shot.y, target, this.cfg.radius)) {
        shot.active = false
        hit(shot)
      }
      if (nowMs >= expiresAt) shot.active = false
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
