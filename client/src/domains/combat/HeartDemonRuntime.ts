import type {
  BossSkillPort,
  BossSkillsTable,
  BossSkillSpec,
  BossSkillUnit,
} from './BossSkillRuntime'

export interface ShadowWeapon {
  textureKey: string
  artKey: string
  damage: number
  cooldownMs: number
  speed: number
  radius: number
  lifetimeMs: number
  pellets: number
  spreadDeg: number
  color: number
}
export interface HeartDemonPort extends BossSkillPort {
  weaponSnapshot(): ShadowWeapon
  playerStun(untilMs: number): void
  screenRewind(active: boolean, alpha: number): void
  tickSound(): void
  shadowWeapon(weapon: ShadowWeapon | null, bossId: number): void
  castBorrowed(bossId: number, floor: number, skillId: string, nowMs: number): number
  cancelBorrowed(): void
}
interface Frame {
  at: number
  units: readonly BossSkillUnit[]
}
interface Rewind {
  start: number
  end: number
  historyMs: number
  frames: readonly Frame[]
  eligibleIds: ReadonlySet<number>
  nextTick: number
  tickMs: number
}
interface Shadow {
  until: number
  shotAt: number
  weapon: ShadowWeapon
  skill: BossSkillSpec
}
interface Mimic {
  remaining: number
  nextAt: number
  restoreAt: number
  skill: BossSkillSpec
}
const number = (spec: BossSkillSpec, field: string): number => {
  const value = spec[field]
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw Error(`heart skill ${spec.id}.${field}`)
  return value
}

/** Rewinds living units only; snapshots never become a resurrection or an external clock. */
export class HeartDemonRuntime {
  private frames: Frame[] = []
  private lastSnapshot = -Infinity
  private bossId: number | null = null
  private startedAt = 0
  private nextCastAt = 0
  private readonly due = new Map<string, number>()
  private rewind: Rewind | null = null
  private shadow: Shadow | null = null
  private mimic: Mimic | null = null
  constructor(
    readonly config: BossSkillsTable,
    readonly port: HeartDemonPort,
  ) {}

  update(nowMs: number, dtMs: number, bossId: number): void {
    const boss = this.port.units().find((u) => u.id === bossId && u.hp > 0)
    if (!boss) {
      this.clear()
      return
    }
    if (this.bossId !== bossId) {
      this.clear()
      this.bossId = bossId
      this.startedAt = nowMs
      for (const spec of this.skills) this.due.set(spec.id, nowMs + spec.initialDelayMs)
    }
    const rewindSpec = this.skills.find((s) => s.id === 'rewind')!
    if (!this.rewind && nowMs - this.lastSnapshot >= number(rewindSpec, 'snapshotIntervalMs')) {
      this.frames.push({ at: nowMs, units: this.port.units().map((u) => ({ ...u })) })
      const oldest =
        nowMs - number(rewindSpec, 'historyMs') - number(rewindSpec, 'snapshotIntervalMs')
      while (this.frames.length > 1 && this.frames[1]!.at < oldest) this.frames.shift()
      this.lastSnapshot = nowMs
    }
    if (this.rewind) {
      this.updateRewind(nowMs)
      return
    }
    if (this.shadow) {
      this.updateShadow(nowMs, dtMs, boss)
      return
    }
    if (this.mimic) {
      this.updateMimic(nowMs, bossId)
      return
    }
    if (nowMs < this.nextCastAt) return
    const ready = this.skills
      .filter((s) => nowMs >= (this.due.get(s.id) ?? this.startedAt + s.initialDelayMs))
      .sort((a, b) => (this.due.get(a.id) ?? 0) - (this.due.get(b.id) ?? 0))[0]
    if (ready) this.castSkill(ready.id, nowMs, bossId)
  }
  get isRewinding(): boolean {
    return this.rewind !== null
  }
  get shadowState(): Readonly<Shadow> | null {
    return this.shadow
  }
  private get skills(): readonly BossSkillSpec[] {
    return this.config.bosses['8']?.skills ?? []
  }

  castSkill(id: string, nowMs: number, bossId: number = this.bossId ?? -1): void {
    const spec = this.skills.find((s) => s.id === id)
    const boss = this.port.units().find((u) => u.id === bossId && u.hp > 0)
    if (!spec || !boss || this.rewind || this.shadow || this.mimic) return
    this.bossId = bossId
    this.due.set(id, nowMs + spec.cooldownMs)
    this.nextCastAt = nowMs + (this.config.bosses['8']?.skillIntervalMs ?? spec.cooldownMs)
    this.port.onCast?.(bossId, 8, id, this.nextCastAt)
    if (id === 'mimic_chain') {
      this.mimic = {
        remaining: number(spec, 'count'),
        nextAt: nowMs,
        restoreAt: nowMs,
        skill: spec,
      }
      this.updateMimic(nowMs, bossId)
    } else if (id === 'rewind') {
      if (!this.frames.length) return
      const end = nowMs + number(spec, 'durationMs')
      this.port.cancelBorrowed()
      const targetAt = nowMs - number(spec, 'historyMs')
      // A newborn may have recent samples, but must not partially rewind before its birth.
      const boundary =
        [...this.frames].reverse().find((frame) => frame.at <= targetAt) ??
        this.frames.find((frame) => frame.at <= targetAt + number(spec, 'snapshotIntervalMs'))
      const eligibleIds = new Set(
        boundary?.units.filter((unit) => unit.hp > 0).map((unit) => unit.id) ?? [],
      )
      this.rewind = {
        start: nowMs,
        end,
        historyMs: number(spec, 'historyMs'),
        frames: [...this.frames],
        eligibleIds,
        nextTick: nowMs,
        tickMs: number(spec, 'tickIntervalMs'),
      }
      for (const unit of this.port.units()) if (unit.hp > 0) this.port.setUnitStunned(unit.id, end)
      this.port.setBossControlled(bossId, end)
      this.port.setBossAppearance(bossId, { stationary: true })
      this.port.playerStun(end)
      this.port.screenRewind(true, number(spec, 'overlayAlpha'))
      this.updateRewind(nowMs)
    } else if (id === 'player_shadow') {
      const weapon = { ...this.port.weaponSnapshot() }
      const until = nowMs + number(spec, 'durationMs')
      this.shadow = { until, shotAt: nowMs, weapon, skill: spec }
      this.port.setBossControlled(bossId, until)
      this.port.setBossAppearance(bossId, {
        playerTextureKey: weapon.textureKey,
        monochrome: true,
        visualScale: number(spec, 'visualScale'),
      })
      this.port.shadowWeapon(weapon, bossId)
    }
  }
  private updateMimic(now: number, bossId: number): void {
    const mimic = this.mimic!
    if (mimic.remaining > 0 && now >= mimic.nextAt) {
      const floor = this.port.rng.between(
        number(mimic.skill, 'sourceFloorMin'),
        number(mimic.skill, 'sourceFloorMax'),
      )
      const skills = this.config.bosses[String(floor)]!.skills
      const skill = this.port.rng.pick(skills)
      this.port.setBossAppearance(bossId, { skinBossStage: floor, black: true })
      const until = this.port.castBorrowed(bossId, floor, skill.id, now)
      mimic.remaining--
      mimic.restoreAt = Math.max(now, until)
      mimic.nextAt = mimic.restoreAt + number(mimic.skill, 'intervalMs')
    }
    if (mimic.remaining === 0 && now >= mimic.restoreAt) {
      this.port.setBossAppearance(bossId, {})
      this.mimic = null
      this.nextCastAt = Math.max(this.nextCastAt, now + number(mimic.skill, 'intervalMs'))
    }
  }
  private updateRewind(now: number): void {
    const rewind = this.rewind!,
      id = this.bossId!
    const progress = Math.min(1, Math.max(0, (now - rewind.start) / (rewind.end - rewind.start)))
    const sampleAt = rewind.start - progress * rewind.historyMs
    let before = rewind.frames[0]!,
      after = rewind.frames[rewind.frames.length - 1]!
    for (const frame of rewind.frames) {
      if (frame.at <= sampleAt) before = frame
      if (frame.at >= sampleAt) {
        after = frame
        break
      }
    }
    const t = Math.min(1, Math.max(0, (sampleAt - before.at) / (after.at - before.at || 1)))
    for (const live of this.port.units()) {
      if (live.hp <= 0 || !rewind.eligibleIds.has(live.id)) continue
      const a = before.units.find((u) => u.id === live.id),
        b = after.units.find((u) => u.id === live.id)
      if (!a || !b || a.hp <= 0 || b.hp <= 0) continue
      this.port.setUnitPosition(live.id, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
      this.port.setUnitHp(live.id, a.hp + (b.hp - a.hp) * t)
      this.port.setUnitStunned(live.id, rewind.end)
    }
    this.port.playerStun(rewind.end)
    if (now >= rewind.nextTick && now < rewind.end) {
      this.port.tickSound()
      rewind.nextTick = now + rewind.tickMs
    }
    if (now >= rewind.end) {
      this.rewind = null
      this.frames = []
      this.lastSnapshot = -Infinity
      this.port.setBossAppearance(id, {})
      this.port.screenRewind(false, 0)
      this.releaseStuns(id)
      this.nextCastAt = Math.max(this.nextCastAt, now + this.config.bosses['8']!.skillIntervalMs)
    }
  }
  private updateShadow(now: number, dtMs: number, boss: BossSkillUnit): void {
    const shadow = this.shadow!
    if (now >= shadow.until) {
      this.shadow = null
      this.port.setBossAppearance(boss.id, {})
      this.port.shadowWeapon(null, boss.id)
      this.nextCastAt = Math.max(this.nextCastAt, now + this.config.bosses['8']!.skillIntervalMs)
      return
    }
    const player = this.port.player(),
      dx = player.x - boss.x,
      dy = player.y - boss.y,
      distance = Math.hypot(dx, dy)
    if (distance > number(shadow.skill, 'keepDistance')) {
      const travel = Math.min(
        distance - number(shadow.skill, 'keepDistance'),
        (number(shadow.skill, 'followSpeed') * Math.min(dtMs, 1000 / 30)) / 1000,
      )
      const point = this.port.safeSpawn(
        boss.x + (dx / distance) * travel,
        boss.y + (dy / distance) * travel,
        boss.radius,
      )
      if (!this.port.projectileBlocked(boss.x, boss.y, point.x, point.y, boss.radius))
        this.port.setUnitPosition(boss.id, point.x, point.y)
    }
    if (now >= shadow.shotAt) {
      const w = shadow.weapon
      this.port.fireBossVolley(boss.id, {
        count: w.pellets,
        speed: w.speed,
        radius: w.radius,
        damage: Math.max(1, Math.round(w.damage * number(shadow.skill, 'weaponDamageMultiplier'))),
        lifetimeMs: w.lifetimeMs,
        color: w.color,
        angleRad: Math.atan2(dy, dx),
        spreadRad: (w.spreadDeg * Math.PI) / 180,
      })
      shadow.shotAt = now + w.cooldownMs * number(shadow.skill, 'attackIntervalMultiplier')
    }
  }
  clear(): void {
    this.port.cancelBorrowed()
    if (this.bossId !== null) {
      this.port.setBossAppearance(this.bossId, {})
      this.port.shadowWeapon(null, this.bossId)
      this.releaseStuns(this.bossId)
    } else this.port.playerStun(0)
    this.port.screenRewind(false, 0)
    this.frames = []
    this.due.clear()
    this.bossId = null
    this.rewind = null
    this.shadow = null
    this.mimic = null
    this.lastSnapshot = -Infinity
    this.nextCastAt = 0
  }
  private releaseStuns(bossId: number): void {
    this.port.playerStun(0)
    this.port.setBossControlled(bossId, 0)
    for (const unit of this.port.units()) this.port.setUnitStunned(unit.id, 0)
  }
}
