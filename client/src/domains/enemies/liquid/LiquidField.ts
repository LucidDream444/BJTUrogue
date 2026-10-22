import type { SprayerDef } from '@/core/config'

export interface Puddle {
  active: boolean
  x: number
  y: number
  sourceId: number
  bornMs: number
  expiresMs: number
}

export interface LiquidTarget {
  id: number
  x: number
  y: number
  radius: number
  alive: boolean
}

/** 纯逻辑：容量固定；时间由 WORLD_STEP 提供；移动只认实际位移。 */
export class LiquidField {
  readonly puddles: Puddle[]
  active = false
  moving = false
  stillMs = 0
  sourceId = 0
  private playerId = 0
  private previous: { x: number; y: number } | null = null
  private lastMs: number | null = null
  private lastFrame = -1
  private movingMs = 0
  private readonly ramReady = new Map<number, number>()

  constructor(readonly cfg: SprayerDef) {
    this.puddles = Array.from({ length: cfg.spray.maxPuddles }, () => ({
      active: false,
      x: 0,
      y: 0,
      sourceId: 0,
      bornMs: 0,
      expiresMs: 0,
    }))
  }

  spray(
    sourceId: number,
    x: number,
    y: number,
    nowMs: number,
    allowed: (x: number, y: number, radius: number) => boolean,
  ): void {
    const cfg = this.cfg.spray
    for (let i = 0; i < cfg.puddlesPerSpray; i++) {
      const angle = ((i - 1) / Math.max(1, cfg.puddlesPerSpray - 1)) * Math.PI * 2
      const px = x + (i ? Math.cos(angle) * cfg.spreadDistance : 0)
      const py = y + (i ? Math.sin(angle) * cfg.spreadDistance : 0)
      if (!allowed(px, py, cfg.puddleRadius)) continue
      const slot = this.puddles.find((p) => !p.active || p.expiresMs <= nowMs)
      if (!slot) break
      Object.assign(slot, {
        active: true,
        x: px,
        y: py,
        sourceId,
        bornMs: nowMs,
        expiresMs: nowMs + cfg.lifetimeMs,
      })
    }
  }

  /** 同一渲染帧只采样一次，后台长帧最多推进 1/30 秒；不补算几百次扣血。 */
  step(nowMs: number, frameId: number, target: LiquidTarget | null): number {
    if (frameId === this.lastFrame) return 0
    this.lastFrame = frameId
    const dt = this.lastMs === null ? 0 : Math.max(0, Math.min(1000 / 30, nowMs - this.lastMs))
    this.lastMs = nowMs
    for (const p of this.puddles) if (p.expiresMs <= nowMs) p.active = false
    if (!target?.alive) {
      this.resetCoating()
      this.previous = null
      return 0
    }
    if (target.id !== this.playerId) {
      this.resetCoating()
      this.previous = null
      this.playerId = target.id
    }
    const from = this.previous ?? target
    const distance = Math.hypot(target.x - from.x, target.y - from.y)
    this.moving = dt > 0 && distance > (this.cfg.coating.stillSpeedThreshold * dt) / 1000
    const wasActive = this.active
    for (const p of this.puddles) {
      if (
        !p.active ||
        !segmentTouches(from, target, p, this.cfg.spray.puddleRadius + target.radius)
      )
        continue
      p.active = false // 踩过即消费；已沾液也消费，但不叠层、不刷新进度。
      if (!this.active) {
        this.active = true
        this.sourceId = p.sourceId
      }
    }
    this.previous = { x: target.x, y: target.y }
    if (!this.active || !wasActive) return 0
    if (!this.moving) {
      this.stillMs = Math.min(this.cfg.coating.cleanseStillMs, this.stillMs + dt)
      if (this.stillMs >= this.cfg.coating.cleanseStillMs) this.resetCoating()
      return 0
    }
    this.movingMs += dt
    if (this.movingMs < this.cfg.coating.drainIntervalMs) return 0
    this.movingMs %= this.cfg.coating.drainIntervalMs
    return this.cfg.coating.drainDamage
  }

  ram(enemyId: number, nowMs: number): number {
    if (!this.active || nowMs < (this.ramReady.get(enemyId) ?? -Infinity)) return 0
    this.ramReady.set(enemyId, nowMs + this.cfg.coating.ramCooldownMs)
    return this.cfg.coating.ramDamage
  }

  releaseEnemy(id: number): void {
    this.ramReady.delete(id)
  }

  resetCoating(): void {
    this.active = false
    this.moving = false
    this.stillMs = 0
    this.movingMs = 0
    this.sourceId = 0
    this.ramReady.clear()
  }

  clear(): void {
    for (const p of this.puddles) p.active = false
    this.resetCoating()
    this.previous = null
    this.lastMs = null
    this.lastFrame = -1
  }
}

function segmentTouches(
  a: { x: number; y: number },
  b: { x: number; y: number },
  p: { x: number; y: number },
  reach: number,
): boolean {
  const dx = b.x - a.x,
    dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
    : 0
  return (p.x - a.x - dx * t) ** 2 + (p.y - a.y - dy * t) ** 2 <= reach * reach
}
