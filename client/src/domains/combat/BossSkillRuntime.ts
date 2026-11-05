import type { EnemyKind } from '@/core/events'
import type { RngLike } from '@/core/rng'
import { BossHazards, type BossHazardCommand, type BossHazardUnit } from './BossHazards'

export interface BossSkillSpec {
  id: string
  cooldownMs: number
  initialDelayMs: number
  [key: string]: string | number | boolean | undefined
}

export interface BossFloorSkills {
  id: string
  name: string
  skillIntervalMs: number
  skills: readonly BossSkillSpec[]
}

export interface BossSkillsTable {
  schemaVersion?: 1
  bosses: Readonly<Record<string, BossFloorSkills>>
}

const REQUIRED_NUMBERS: Readonly<Record<string, readonly string[]>> = {
  campus_slow: ['durationMs', 'speedMultiplier'],
  paper_summon: ['countMin', 'countMax', 'maxExisting', 'spawnIntervalMs', 'spawnRadius'],
  radial: ['windupMs', 'recoverMs', 'count', 'projectileSpeed', 'projectileRadius', 'damage', 'lifetimeMs', 'volleyOffsetDeg'],
  triangle: ['teleportCount', 'teleportIntervalMs', 'teleportDistance', 'lineWidth', 'damage', 'damageTickMs', 'lineDurationMs', 'warningMs'],
  haste: ['durationMs', 'speedMultiplier'],
  acid_pools: ['count', 'radius', 'warningMs', 'lifetimeMs', 'damage', 'damageTickMs', 'maxActive'],
  water_pools: ['count', 'radius', 'warningMs', 'lifetimeMs', 'slideSpeed', 'maxActive'],
  ricochet_charge: ['warningMs', 'speed', 'bounceCount', 'maxDurationMs', 'damage', 'hitRadius', 'damageTickMs'],
  leap_slam: ['warningMs', 'flightMs', 'targetOffsetRadius', 'radius', 'damage', 'stunMs'],
  clones: ['count', 'hpDivisor', 'spawnRadius', 'durationMs', 'bossStunMs'],
  transmute: ['warningMs'],
  rally: ['durationMs', 'speedMultiplier', 'aggroRadius', 'laughPulseMs'],
  blue_barrage: ['roundsMin', 'roundsMax', 'roundIntervalMs', 'count', 'projectileSpeed', 'projectileRadius', 'damage', 'lifetimeMs', 'volleyOffsetDeg', 'color'],
  mimic_chain: ['count', 'intervalMs', 'sourceFloorMin', 'sourceFloorMax', 'blackTint'],
  rewind: ['historyMs', 'durationMs', 'snapshotIntervalMs', 'tickIntervalMs', 'overlayAlpha'],
  player_shadow: ['durationMs', 'visualScale', 'followSpeed', 'keepDistance', 'weaponDamageMultiplier', 'attackIntervalMultiplier', 'blackTint'],
}

/** 启动时核对完整技能表；玩法循环不再反复解析或读外部文件。 */
export function parseBossSkillsTable(raw: unknown): BossSkillsTable {
  const object = (value: unknown, path: string): Record<string, unknown> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${path} 必须是对象`)
    return value as Record<string, unknown>
  }
  const text = (value: unknown, path: string): string => {
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path} 必须是非空字符串`)
    return value
  }
  const number = (value: unknown, path: string, positive = false): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || positive && value === 0)
      throw new Error(`${path} 必须是有限${positive ? '正' : '非负'}数`)
    return value
  }
  const root = object(raw, 'boss-skills')
  if (root.schemaVersion !== 1) throw new Error('boss-skills.schemaVersion 必须为 1')
  const entries = object(root.bosses, 'boss-skills.bosses')
  const expectedFloors = ['2', '3', '4', '5', '6', '7', '8']
  if (Object.keys(entries).sort().join(',') !== expectedFloors.join(','))
    throw new Error('boss-skills.bosses 必须完整包含第 2—8 层七位首领')
  const bosses: Record<string, BossFloorSkills> = {}
  for (const floor of expectedFloors) {
    const path = `boss-skills.bosses.${floor}`
    const boss = object(entries[floor], path)
    const id = text(boss.id, `${path}.id`), name = text(boss.name, `${path}.name`)
    const skillIntervalMs = number(boss.skillIntervalMs, `${path}.skillIntervalMs`, true)
    if (!Array.isArray(boss.skills) || boss.skills.length === 0) throw new Error(`${path}.skills 必须是非空数组`)
    const ids = new Set<string>()
    const skills = boss.skills.map((rawSkill, index): BossSkillSpec => {
      const skillPath = `${path}.skills[${index}]`
      const source = object(rawSkill, skillPath)
      const skillId = text(source.id, `${skillPath}.id`)
      if (ids.has(skillId) || REQUIRED_NUMBERS[skillId] === undefined) throw new Error(`${skillPath}.id 重复或尚未实现：${skillId}`)
      ids.add(skillId)
      const spec: BossSkillSpec = { id: skillId, cooldownMs: number(source.cooldownMs, `${skillPath}.cooldownMs`, true),
        initialDelayMs: number(source.initialDelayMs, `${skillPath}.initialDelayMs`) }
      for (const [key, value] of Object.entries(source)) {
        if (key === 'id') continue
        if (typeof value === 'boolean') {
          if (!['bypassMinionCap', 'invulnerable'].includes(key)) throw new Error(`${skillPath}.${key} 不允许布尔值`)
          spec[key] = value
          continue
        }
        const numeric = number(value, `${skillPath}.${key}`)
        const positive = /(?:Multiplier|Divisor|Speed|Radius|Width|IntervalMs|TickMs)$/.test(key) ||
          ['cooldownMs', 'durationMs', 'lifetimeMs', 'flightMs', 'maxDurationMs', 'historyMs'].includes(key) ||
          ['speed', 'radius', 'count', 'countMin', 'countMax', 'roundsMin', 'roundsMax', 'teleportCount', 'bounceCount', 'maxActive', 'visualScale'].includes(key)
        if (positive && numeric === 0) throw new Error(`${skillPath}.${key} 必须大于 0`)
        if (/^(?:count|countMin|countMax|roundsMin|roundsMax|teleportCount|bounceCount|maxActive|maxExisting|sourceFloorMin|sourceFloorMax|color|blackTint)$/.test(key) && !Number.isInteger(numeric))
          throw new Error(`${skillPath}.${key} 必须是整数`)
        if (['color', 'blackTint'].includes(key) && numeric > 0xffffff) throw new Error(`${skillPath}.${key} 超出颜色范围`)
        if (key === 'overlayAlpha' && numeric > 1) throw new Error(`${skillPath}.${key} 必须在 0—1 内`)
        spec[key] = numeric
      }
      for (const key of REQUIRED_NUMBERS[skillId]!) number(spec[key], `${skillPath}.${key}`)
      for (const [min, max] of [['countMin', 'countMax'], ['roundsMin', 'roundsMax'], ['sourceFloorMin', 'sourceFloorMax']] as const)
        if (typeof spec[min] === 'number' && typeof spec[max] === 'number' && spec[min] > spec[max]) throw new Error(`${skillPath}.${max} 不得小于 ${min}`)
      if (skillId === 'mimic_chain' && (n(spec, 'sourceFloorMin') < 2 || n(spec, 'sourceFloorMax') > 7))
        throw new Error(`${skillPath} 只能偷取第 2—7 层技能`)
      return spec
    })
    bosses[floor] = { id, name, skillIntervalMs, skills }
  }
  return { schemaVersion: 1, bosses }
}

export interface BossSkillUnit {
  id: number
  x: number
  y: number
  hp: number
  maxHp: number
  kind: EnemyKind
  gen: number
  radius: number
  vx: number
  vy: number
  bossStage?: number
}

export interface BossSkillAppearance {
  skinBossStage?: number
  playerTextureKey?: string
  black?: boolean
  monochrome?: boolean
  hidden?: boolean
  visualScale?: number
  stationary?: boolean
}

export interface BossSkillVolley {
  count: number
  speed: number
  radius: number
  damage: number
  lifetimeMs: number
  color?: number
  angleRad?: number
  spreadRad?: number
}

/** 只包含公开命令与只读快照；BattleScene 适配到 EnemyBridge 和 Player。 */
export interface BossSkillPort {
  rng: RngLike
  damageMultiplier: number
  normalEnemyKinds: readonly EnemyKind[]
  units(): readonly BossSkillUnit[]
  player(): BossHazardUnit
  bounds(): { left: number; top: number; right: number; bottom: number }
  safeSpawn(x: number, y: number, radius: number): { x: number; y: number }
  projectileBlocked(x1: number, y1: number, x2: number, y2: number, radius: number): boolean
  setUnitPosition(id: number, x: number, y: number): boolean
  setUnitHp(id: number, hp: number): boolean
  setUnitSpeedBoost(id: number, multiplier: number, untilMs: number): void
  setBossInvulnerable(id: number, untilMs: number): void
  setBossControlled(id: number, untilMs: number): void
  setUnitStunned(id: number, untilMs: number): void
  setBossAppearance(id: number, appearance: BossSkillAppearance): void
  fireBossVolley(id: number, options: BossSkillVolley): number
  summonSkillEnemy(kind: EnemyKind, gen: number, x: number, y: number): number | null
  spawnBossClone(ownerId: number, x: number, y: number, hp: number): number | null
  despawnSkillUnit(id: number): void
  transformMinions(kind: EnemyKind): number
  playerSlow(multiplier: number, untilMs: number): void
  /** 心魔等外部运行时也可复用的统一命中入口。 */
  damage(id: number, damage: number, sourceId: number, hitKey: string): void
  /** 有值时强制普通怪朝玩家追击，解除时传 0。 */
  rallyMinion?(id: number, untilMs: number): void
  onCast?(bossId: number, sourceFloor: number, skillId: string, busyUntilMs: number): void
  onLaugh?(bossId: number, untilMs: number): void
}

interface Scheduled {
  bossId: number
  atMs: number
  action: (nowMs: number) => void
}

interface CloneGroup {
  bossId: number
  ids: number[]
  trueId: number
  expiresMs: number
  stunMs: number
  lastTrue: { x: number; y: number }
  initialHp: number
  cloneHp: number
}

interface Charge {
  bossId: number
  startsMs: number
  expiresMs: number
  speed: number
  remainingBounces: number
  damage: number
  radius: number
  tickMs: number
  dx: number
  dy: number
  hits: Map<number, number>
  lastSafe: { x: number; y: number } | null
}

const n = (skill: BossSkillSpec, key: string): number => {
  const value = skill[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`首领技能 ${skill.id}.${key} 缺少有限数值`)
  return value
}

/** 第2—7层技能的确定性调度；第8层仅继续既有技能，不自动抽技能。 */
export class BossSkillRuntime {
  readonly hazards = new BossHazards()
  busyUntil = 0
  private readonly jobs: Scheduled[] = []
  private readonly clones: CloneGroup[] = []
  private readonly charges: Charge[] = []
  private readonly nextSkills = new Map<string, number>()
  private activeBossId: number | null = null
  private activeStage = 0
  private nextCastMs = 0
  private nextSkillIndex = 0
  private lastNowMs = 0
  private readonly controlled = new Set<number>()
  private readonly invulnerable = new Set<number>()
  private readonly appearances = new Set<number>()
  private readonly boosted = new Set<number>()

  constructor(readonly config: BossSkillsTable, readonly port: BossSkillPort) {}

  update(nowMs: number, dtMs: number, bossId: number, stage: number): BossHazardCommand[] {
    this.lastNowMs = nowMs
    if (this.unit(bossId) === undefined) {
      this.clear(nowMs)
      return []
    }
    this.beginBoss(bossId, stage, nowMs)
    this.runJobs(nowMs)
    this.updateClones(nowMs)
    this.updateCharges(nowMs, dtMs)
    this.scheduleNext(bossId, stage, nowMs)
    const units = this.port.units().map((unit): BossHazardUnit => ({ ...unit, alive: unit.hp > 0, player: false }))
    return this.hazards.update(nowMs, dtMs, [this.port.player(), ...units])
  }

  castSkill(bossId: number, sourceFloor: number, skillId: string, nowMs: number): number {
    this.lastNowMs = nowMs
    const skill = this.config.bosses[String(sourceFloor)]?.skills.find((entry) => entry.id === skillId)
    const boss = this.unit(bossId)
    if (skill === undefined || boss === undefined) return Math.max(nowMs, this.busyUntil)
    const until = this.execute(boss, sourceFloor, skill, nowMs)
    this.busyUntil = Math.max(this.busyUntil, until)
    this.port.onCast?.(bossId, sourceFloor, skillId, until)
    return until
  }

  clear(nowMs = this.lastNowMs): void {
    this.hazards.clear()
    this.jobs.length = 0
    this.charges.length = 0
    for (const group of this.clones) this.restoreCloneGroup(group, nowMs, false)
    this.clones.length = 0
    this.nextSkills.clear()
    this.activeBossId = null
    this.activeStage = 0
    this.nextCastMs = 0
    this.nextSkillIndex = 0
    this.busyUntil = 0
    for (const id of this.controlled) this.port.setBossControlled(id, nowMs)
    for (const id of this.invulnerable) this.port.setBossInvulnerable(id, nowMs)
    for (const id of this.appearances) this.port.setBossAppearance(id, {})
    for (const id of this.boosted) {
      this.port.setUnitSpeedBoost(id, 1, nowMs)
      this.port.rallyMinion?.(id, 0)
    }
    this.port.playerSlow(1, nowMs)
    this.controlled.clear()
    this.invulnerable.clear()
    this.appearances.clear()
    this.boosted.clear()
  }

  private unit(id: number): BossSkillUnit | undefined { return this.port.units().find((unit) => unit.id === id && unit.hp > 0) }

  private beginBoss(bossId: number, stage: number, nowMs: number): void {
    if (bossId === this.activeBossId && stage === this.activeStage) return
    if (this.activeBossId !== null && (bossId !== this.activeBossId || this.activeStage !== 0)) this.clear(nowMs)
    this.activeBossId = bossId
    this.activeStage = stage
    this.nextCastMs = nowMs
    for (const skill of this.config.bosses[String(stage)]?.skills ?? [])
      this.nextSkills.set(skill.id, nowMs + skill.initialDelayMs)
  }

  private runJobs(nowMs: number): void {
    // 先摘出本帧任务，新建的连发任务从本次实际执行时间计下一次，不追赶补发。
    const ready = this.jobs.filter((job) => job.atMs <= nowMs)
    for (let i = this.jobs.length - 1; i >= 0; i--)
      if (this.jobs[i]!.atMs <= nowMs) this.jobs.splice(i, 1)
    ready.sort((a, b) => a.atMs - b.atMs)
    for (const job of ready) if (this.unit(job.bossId) !== undefined) job.action(nowMs)
  }

  private updateClones(nowMs: number): void {
    for (let i = this.clones.length - 1; i >= 0; i--) {
      const group = this.clones[i]!
      const owner = this.unit(group.bossId)
      const real = this.unit(group.trueId)
      if (real !== undefined) {
        group.lastTrue = { x: real.x, y: real.y }
        // 真分身承受的伤害回到本体；假分身不改变首领血量。
        if (owner !== undefined)
          this.port.setUnitHp(owner.id, Math.min(owner.hp, group.initialHp - Math.max(0, group.cloneHp - real.hp)))
      }
      if (owner !== undefined && real !== undefined && nowMs < group.expiresMs) continue
      this.restoreCloneGroup(group, nowMs, real === undefined && owner !== undefined)
      this.clones.splice(i, 1)
    }
  }

  private updateCharges(nowMs: number, dtMs: number): void {
    const seconds = Math.min(Math.max(dtMs, 0), 1000 / 30) / 1000
    for (let i = this.charges.length - 1; i >= 0; i--) {
      const charge = this.charges[i]!
      const boss = this.unit(charge.bossId)
      if (boss === undefined || nowMs >= charge.expiresMs) {
        this.stopCharge(charge, nowMs)
        this.charges.splice(i, 1)
        continue
      }
      if (nowMs < charge.startsMs) continue
      const from = this.chargeOrigin(charge, boss)
      // 外部碰撞把首领推入家具时，先脱嵌，不把“起点已经堵了”误算成一连串反弹。
      if (from === null) continue
      const to = { x: from.x + charge.dx * charge.speed * seconds, y: from.y + charge.dy * charge.speed * seconds }
      if (this.blocked(from, to, boss.radius)) {
        const contact = this.lastClearOnSegment(from, to, boss.radius)
        this.port.setUnitPosition(boss.id, contact.x, contact.y)
        charge.lastSafe = contact
        charge.remainingBounces--
        if (charge.remainingBounces <= 0) {
          this.stopCharge(charge, nowMs)
          this.charges.splice(i, 1)
          continue
        }
        // 碰到障碍后重新抽取可向内行进的角度，避免同一面墙连续耗光反弹次数。
        let reflected = false
        for (let attempt = 0; attempt < 16; attempt++) {
          const angle = this.port.rng.floatBetween(0, Math.PI * 2)
          const dx = Math.cos(angle), dy = Math.sin(angle)
          if (this.blocked(contact, { x: contact.x + dx * charge.speed * seconds, y: contact.y + dy * charge.speed * seconds }, boss.radius)) continue
          charge.dx = dx
          charge.dy = dy
          reflected = true
          break
        }
        if (!reflected) {
          // 随机数极端地反复朝墙时仍能沿来路反弹，不能仅因16次抽样失败就提前结束。
          for (const [dx, dy] of [[-charge.dx, -charge.dy], [-charge.dy, charge.dx], [charge.dy, -charge.dx]]) {
            if (this.blocked(contact, { x: contact.x + dx! * charge.speed * seconds, y: contact.y + dy! * charge.speed * seconds }, boss.radius)) continue
            charge.dx = dx!
            charge.dy = dy!
            break
          }
        }
        continue
      }
      this.port.setUnitPosition(boss.id, to.x, to.y)
      charge.lastSafe = to
      const targets = [this.port.player(), ...this.port.units().filter((u) => u.id !== boss.id)
        .map((u) => ({ ...u, alive: u.hp > 0, player: false }))]
      for (const target of targets) {
        if (!target.alive || nowMs < (charge.hits.get(target.id) ?? -Infinity)) continue
        const dx = to.x - from.x, dy = to.y - from.y
        const length = dx * dx + dy * dy
        const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((target.x - from.x) * dx + (target.y - from.y) * dy) / length))
        if (Math.hypot(target.x - from.x - dx * t, target.y - from.y - dy * t) > charge.radius + target.radius) continue
        charge.hits.set(target.id, nowMs + charge.tickMs)
        this.port.damage(target.id, charge.damage, boss.id, `boss-charge:${boss.id}:${nowMs}`)
      }
    }
  }

  private scheduleNext(bossId: number, stage: number, nowMs: number): void {
    if (stage === 8 || nowMs < this.busyUntil || nowMs < this.nextCastMs) return
    const config = this.config.bosses[String(stage)]
    if (config === undefined) return
    let selected = -1
    for (let offset = 0; offset < config.skills.length; offset++) {
      const index = (this.nextSkillIndex + offset) % config.skills.length
      const skill = config.skills[index]!
      if (nowMs >= (this.nextSkills.get(skill.id) ?? Infinity)) { selected = index; break }
    }
    if (selected < 0) return
    const skill = config.skills[selected]!
    this.nextSkillIndex = (selected + 1) % config.skills.length
    this.nextSkills.set(skill.id, nowMs + skill.cooldownMs)
    this.nextCastMs = nowMs + config.skillIntervalMs
    this.castSkill(bossId, stage, skill.id, nowMs)
  }

  private execute(boss: BossSkillUnit, _sourceFloor: number, skill: BossSkillSpec, nowMs: number): number {
    switch (skill.id) {
      case 'campus_slow': {
        const until = nowMs + n(skill, 'durationMs')
        this.port.playerSlow(n(skill, 'speedMultiplier'), until)
        for (const unit of this.port.units()) this.boost(unit.id, n(skill, 'speedMultiplier'), until)
        return until
      }
      case 'paper_summon': {
        if (this.port.units().filter((unit) => unit.bossStage === undefined && unit.kind === 'splitter').length > n(skill, 'maxExisting')) return nowMs
        const count = this.port.rng.between(n(skill, 'countMin'), n(skill, 'countMax'))
        const interval = n(skill, 'spawnIntervalMs')
        this.repeat(boss.id, count, interval, nowMs, () => {
          const center = this.unit(boss.id)
          if (center === undefined) return
          const point = this.around(center, n(skill, 'spawnRadius'), center.radius)
          this.port.summonSkillEnemy('splitter', 0, point.x, point.y)
        })
        return nowMs + Math.max(0, count - 1) * interval
      }
      case 'radial': {
        const fireAt = nowMs + n(skill, 'windupMs')
        const until = fireAt + n(skill, 'recoverMs')
        this.control(boss.id, until)
        this.schedule(boss.id, fireAt, () => this.volley(boss.id, skill, 0))
        this.schedule(boss.id, until, (now) => this.control(boss.id, now))
        return until
      }
      case 'triangle': {
        const count = n(skill, 'teleportCount')
        const interval = n(skill, 'teleportIntervalMs')
        const warning = n(skill, 'warningMs')
        const until = nowMs + warning + Math.max(0, count - 1) * interval
        this.control(boss.id, until)
        const points: { x: number; y: number }[] = []
        this.repeat(boss.id, count, interval, nowMs + warning, (now, index) => {
          const current = this.unit(boss.id)
          if (current === undefined) return
          const point = this.around(current, n(skill, 'teleportDistance'), current.radius)
          this.port.setUnitPosition(boss.id, point.x, point.y)
          points.push(point)
          if (index !== count - 1) return
          for (let i = 0; i < points.length; i++) {
            const a = points[i]!, b = points[(i + 1) % points.length]!
            this.hazards.addLine({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, width: n(skill, 'lineWidth'),
              damage: this.scaled(skill), tickMs: n(skill, 'damageTickMs'), activatesMs: now + warning,
              expiresMs: now + warning + n(skill, 'lineDurationMs'), sourceId: boss.id })
          }
          this.control(boss.id, now)
        })
        return until + warning
      }
      case 'haste': {
        const until = nowMs + n(skill, 'durationMs')
        this.boost(boss.id, n(skill, 'speedMultiplier'), until)
        return until
      }
      case 'acid_pools':
      case 'water_pools': {
        const kind = skill.id === 'acid_pools' ? 'acid' : 'water'
        const active = this.hazards.snapshot.filter((field) => field.sourceId === boss.id && field.kind === kind && field.expiresMs > nowMs).length
        const count = Math.max(0, Math.min(n(skill, 'count'), n(skill, 'maxActive') - active))
        const activatesMs = nowMs + n(skill, 'warningMs')
        const expiresMs = activatesMs + n(skill, 'lifetimeMs')
        for (let i = 0; i < count; i++) {
          const point = this.randomPoint(n(skill, 'radius'))
          const common = { ...point, radius: n(skill, 'radius'), activatesMs, expiresMs, sourceId: boss.id }
          if (kind === 'acid') this.hazards.addAcid({ ...common, damage: this.scaled(skill), tickMs: n(skill, 'damageTickMs') })
          else this.hazards.addWater({ ...common, speed: n(skill, 'slideSpeed') })
        }
        return activatesMs
      }
      case 'ricochet_charge': {
        const angle = this.port.rng.floatBetween(0, Math.PI * 2)
        const startsMs = nowMs + n(skill, 'warningMs')
        const expiresMs = startsMs + n(skill, 'maxDurationMs')
        this.control(boss.id, expiresMs)
        if (skill.invulnerable === true) this.invulnerableUntil(boss.id, expiresMs)
        this.charges.push({ bossId: boss.id, startsMs, expiresMs, speed: n(skill, 'speed'),
          remainingBounces: n(skill, 'bounceCount'), damage: this.scaled(skill), radius: n(skill, 'hitRadius'),
          tickMs: n(skill, 'damageTickMs'), dx: Math.cos(angle), dy: Math.sin(angle), hits: new Map(),
          lastSafe: this.blocked(boss, boss, boss.radius) ? null : { x: boss.x, y: boss.y } })
        return expiresMs
      }
      case 'leap_slam': {
        const player = this.port.player()
        let dx = player.vx ?? 0, dy = player.vy ?? 0
        if (Math.hypot(dx, dy) === 0) { dx = player.x - boss.x; dy = player.y - boss.y }
        const length = Math.hypot(dx, dy) || 1
        const point = this.port.safeSpawn(player.x + dx / length * n(skill, 'targetOffsetRadius'),
          player.y + dy / length * n(skill, 'targetOffsetRadius'), boss.radius)
        const flightAt = nowMs + n(skill, 'warningMs')
        const landAt = flightAt + n(skill, 'flightMs')
        this.control(boss.id, landAt)
        this.hazards.addSlam({ ...point, radius: n(skill, 'radius'), damage: this.scaled(skill), stunMs: n(skill, 'stunMs'),
          activatesMs: landAt, expiresMs: landAt + n(skill, 'flightMs'), sourceId: boss.id })
        this.schedule(boss.id, flightAt, () => {
          this.appearance(boss.id, { hidden: true })
          this.invulnerableUntil(boss.id, landAt)
        })
        this.schedule(boss.id, landAt, (now) => {
          this.port.setUnitPosition(boss.id, point.x, point.y)
          this.appearance(boss.id, {})
          this.invulnerableUntil(boss.id, now)
          this.control(boss.id, now)
        })
        return landAt
      }
      case 'clones': {
        if (this.clones.some((group) => group.bossId === boss.id)) return this.busyUntil
        const hp = Math.max(1, boss.hp / n(skill, 'hpDivisor'))
        const ids: number[] = []
        const count = n(skill, 'count'), phase = this.port.rng.floatBetween(0, Math.PI * 2)
        for (let i = 0; i < count; i++) {
          const angle = phase + i * Math.PI * 2 / count
          const point = this.port.safeSpawn(boss.x + Math.cos(angle) * n(skill, 'spawnRadius'),
            boss.y + Math.sin(angle) * n(skill, 'spawnRadius'), boss.radius)
          const id = this.port.spawnBossClone(boss.id, point.x, point.y, hp)
          if (id !== null) ids.push(id)
        }
        if (ids.length === 0) return nowMs
        const until = nowMs + n(skill, 'durationMs')
        this.appearance(boss.id, { hidden: true })
        this.invulnerableUntil(boss.id, until)
        this.control(boss.id, until)
        this.clones.push({ bossId: boss.id, ids, trueId: this.port.rng.pick(ids), expiresMs: until,
          stunMs: n(skill, 'bossStunMs'), lastTrue: { x: boss.x, y: boss.y }, initialHp: boss.hp, cloneHp: hp })
        return until
      }
      case 'transmute': {
        const until = nowMs + n(skill, 'warningMs')
        this.schedule(boss.id, until, () => {
          if (this.port.normalEnemyKinds.length > 0) this.port.transformMinions(this.port.rng.pick(this.port.normalEnemyKinds))
        })
        return until
      }
      case 'rally': {
        const until = nowMs + n(skill, 'durationMs')
        const pulse = n(skill, 'laughPulseMs')
        this.repeat(boss.id, Math.ceil(n(skill, 'durationMs') / pulse), pulse, nowMs, () => {
          for (const unit of this.port.units()) {
            if (unit.bossStage !== undefined) continue
            this.boost(unit.id, n(skill, 'speedMultiplier'), until)
            this.port.rallyMinion?.(unit.id, until)
          }
          this.port.onLaugh?.(boss.id, until)
        })
        return until
      }
      case 'blue_barrage': {
        const rounds = this.port.rng.between(n(skill, 'roundsMin'), n(skill, 'roundsMax'))
        const interval = n(skill, 'roundIntervalMs')
        this.repeat(boss.id, rounds, interval, nowMs, (_now, index) => this.volley(boss.id, skill, index))
        return nowMs + Math.max(0, rounds - 1) * interval
      }
      default: return nowMs
    }
  }

  private restoreCloneGroup(group: CloneGroup, nowMs: number, stunned: boolean): void {
    const owner = this.unit(group.bossId)
    const real = this.unit(group.trueId)
    if (owner !== undefined) {
      if (stunned) this.port.setUnitHp(owner.id, Math.min(owner.hp, group.initialHp - group.cloneHp))
      const position = real ?? group.lastTrue
      const safe = this.port.safeSpawn(position.x, position.y, owner.radius)
      this.port.setUnitPosition(owner.id, safe.x, safe.y)
      this.appearance(owner.id, {})
      this.invulnerableUntil(owner.id, nowMs)
      this.control(owner.id, stunned ? nowMs + group.stunMs : nowMs)
      if (stunned) {
        this.port.setUnitStunned(owner.id, nowMs + group.stunMs)
        this.busyUntil = nowMs + group.stunMs
      }
    }
    for (const id of group.ids) this.port.despawnSkillUnit(id)
  }

  private scaled(skill: BossSkillSpec): number { return Math.round(n(skill, 'damage') * this.port.damageMultiplier) }

  private schedule(bossId: number, atMs: number, action: Scheduled['action']): void { this.jobs.push({ bossId, atMs, action }) }

  private repeat(bossId: number, count: number, intervalMs: number, startsMs: number, action: (nowMs: number, index: number) => void): void {
    const next = (index: number, nowMs: number): void => {
      action(nowMs, index)
      if (index + 1 < count) this.schedule(bossId, nowMs + intervalMs, (now) => next(index + 1, now))
    }
    if (count > 0) this.schedule(bossId, startsMs, (now) => next(0, now))
  }

  private randomPoint(radius: number): { x: number; y: number } {
    const bounds = this.port.bounds()
    const x = this.port.rng.floatBetween(Math.min(bounds.left + radius, (bounds.left + bounds.right) / 2), Math.max(bounds.right - radius, (bounds.left + bounds.right) / 2))
    const y = this.port.rng.floatBetween(Math.min(bounds.top + radius, (bounds.top + bounds.bottom) / 2), Math.max(bounds.bottom - radius, (bounds.top + bounds.bottom) / 2))
    return this.port.safeSpawn(x, y, radius)
  }

  private around(center: { x: number; y: number }, distance: number, radius: number): { x: number; y: number } {
    const angle = this.port.rng.floatBetween(0, Math.PI * 2)
    return this.port.safeSpawn(center.x + Math.cos(angle) * distance, center.y + Math.sin(angle) * distance, radius)
  }

  private blocked(from: { x: number; y: number }, to: { x: number; y: number }, radius: number): boolean {
    const bounds = this.port.bounds()
    return to.x - radius < bounds.left || to.y - radius < bounds.top || to.x + radius > bounds.right || to.y + radius > bounds.bottom ||
      this.port.projectileBlocked(from.x, from.y, to.x, to.y, radius)
  }

  private stopCharge(charge: Charge, nowMs: number): void {
    this.control(charge.bossId, nowMs)
    this.invulnerableUntil(charge.bossId, nowMs)
  }

  private chargeOrigin(charge: Charge, boss: BossSkillUnit): { x: number; y: number } | null {
    const from = { x: boss.x, y: boss.y }
    if (!this.blocked(from, from, boss.radius)) {
      charge.lastSafe = from
      return from
    }
    const nearest = this.port.safeSpawn(from.x, from.y, boss.radius)
    const candidates = charge.lastSafe === null ? [nearest] : [charge.lastSafe, nearest]
    for (const to of candidates) {
      if (this.blocked(to, to, boss.radius)) continue
      // 只允许离开当前重叠区；一旦已经出来，沿路再遇任何墙就拒绝这条脱嵌路径。
      const distance = Math.hypot(to.x - from.x, to.y - from.y)
      const steps = Math.max(1, Math.ceil(distance / Math.max(1, boss.radius)))
      let outside = false, safe = true
      for (let step = 1; step <= steps; step++) {
        const point = { x: from.x + (to.x - from.x) * step / steps, y: from.y + (to.y - from.y) * step / steps }
        const blocked = this.blocked(point, point, boss.radius)
        if (blocked && outside) { safe = false; break }
        if (!blocked) outside = true
      }
      if (!safe) continue
      this.port.setUnitPosition(boss.id, to.x, to.y)
      charge.lastSafe = { ...to }
      return to
    }
    return null
  }

  private lastClearOnSegment(from: { x: number; y: number }, to: { x: number; y: number }, radius: number): { x: number; y: number } {
    let low = 0, high = 1
    for (let step = 0; step < 20; step++) {
      const middle = (low + high) / 2
      const point = { x: from.x + (to.x - from.x) * middle, y: from.y + (to.y - from.y) * middle }
      if (this.blocked(from, point, radius)) high = middle
      else low = middle
    }
    return { x: from.x + (to.x - from.x) * low, y: from.y + (to.y - from.y) * low }
  }

  private control(id: number, untilMs: number): void { this.controlled.add(id); this.port.setBossControlled(id, untilMs) }
  private invulnerableUntil(id: number, untilMs: number): void { this.invulnerable.add(id); this.port.setBossInvulnerable(id, untilMs) }
  private appearance(id: number, options: BossSkillAppearance): void { this.appearances.add(id); this.port.setBossAppearance(id, options) }
  private boost(id: number, multiplier: number, untilMs: number): void { this.boosted.add(id); this.port.setUnitSpeedBoost(id, multiplier, untilMs) }

  private volley(bossId: number, skill: BossSkillSpec, index: number): void {
    const count = n(skill, 'count'), spread = Math.PI * 2 / count
    this.port.fireBossVolley(bossId, { count, speed: n(skill, 'projectileSpeed'), radius: n(skill, 'projectileRadius'),
      damage: this.scaled(skill), lifetimeMs: n(skill, 'lifetimeMs'),
      color: typeof skill.color === 'number' ? skill.color : undefined,
      angleRad: index * n(skill, 'volleyOffsetDeg') * Math.PI / 180 + (count - 1) / 2 * spread, spreadRad: spread })
  }
}
