/** 首领地面技能的纯逻辑。宿主提供游戏时钟与实体快照，并统一执行输出指令。 */
export interface BossHazardUnit {
  id: number
  x: number
  y: number
  radius: number
  alive: boolean
  player: boolean
  vx?: number
  vy?: number
  /** 对象池复用同一 id 时传入出生序号；产品敌人 id 本来就不会重复。 */
  spawnSeq?: number
}

export type BossHazardAffects = 'all' | 'player' | 'enemies'

interface HazardOptions {
  sourceId: number
  expiresMs: number
  activatesMs?: number
  affects?: BossHazardAffects
  includeSource?: boolean
}

interface CircleOptions {
  x: number
  y: number
  radius: number
}

export interface BossAcidOptions extends HazardOptions, CircleOptions {
  damage: number
  tickMs: number
}

export interface BossWaterOptions extends HazardOptions, CircleOptions {
  /** 滑行速度，px/s；所有玩法数值由 boss-skills.json 的调用方提供。 */
  speed: number
}

export interface BossLineOptions extends HazardOptions {
  x1: number
  y1: number
  x2: number
  y2: number
  /** 线段的完整宽度，不是半径。 */
  width: number
  damage: number
  /** 不填时每次连线对同一目标只伤害一次；填写则按固定节拍造成伤害。 */
  tickMs?: number
}

export interface BossSlamOptions extends HazardOptions, CircleOptions {
  damage: number
  stunMs: number
  activatesMs: number
}

export type BossSlamImpact = Omit<BossSlamOptions, 'expiresMs' | 'activatesMs'>

type Timed<T> = Readonly<T & { id: number; createdMs: number; activatesMs: number }>
export type BossHazardSnapshot =
  | Timed<BossAcidOptions & { kind: 'acid' }>
  | Timed<BossWaterOptions & { kind: 'water' }>
  | Timed<BossLineOptions & { kind: 'line' }>
  | Timed<BossSlamOptions & { kind: 'slam' }>

type HazardInput = (BossAcidOptions & { kind: 'acid' }) | (BossWaterOptions & { kind: 'water' }) |
  (BossLineOptions & { kind: 'line' }) | (BossSlamOptions & { kind: 'slam' })

export type BossHazardCommand =
  | { type: 'damage'; id: number; sourceId: number; damage: number; hitKey: string }
  | { type: 'move'; id: number; x: number; y: number; vx: number; vy: number }
  | { type: 'stun'; id: number; sourceId: number; untilMs: number }

interface HazardState {
  snapshot: BossHazardSnapshot
  settledTicks: Map<string, number>
  resolved: boolean
}

interface Slide {
  hazardId: number
  dx: number
  dy: number
}

const identityOf = (unit: BossHazardUnit): string => `${unit.id}:${unit.spawnSeq ?? 0}`

function nonnegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} 必须是有限非负数`)
}

function positive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} 必须是有限正数`)
}

function hitsCircle(circle: CircleOptions, unit: BossHazardUnit): boolean {
  return Math.hypot(unit.x - circle.x, unit.y - circle.y) <= circle.radius + unit.radius
}

function hitsLine(line: BossLineOptions, unit: BossHazardUnit): boolean {
  const dx = line.x2 - line.x1
  const dy = line.y2 - line.y1
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((unit.x - line.x1) * dx + (unit.y - line.y1) * dy) / lengthSquared,
  ))
  return Math.hypot(unit.x - line.x1 - dx * t, unit.y - line.y1 - dy * t) <=
    line.width / 2 + unit.radius
}

function affects(options: { sourceId: number; affects?: BossHazardAffects; includeSource?: boolean }, unit: BossHazardUnit): boolean {
  if (!unit.alive || (!options.includeSource && unit.id === options.sourceId)) return false
  return options.affects === 'player' ? unit.player : options.affects === 'enemies' ? !unit.player : true
}

/**
 * update 只在有效游戏时间推进时调用；伤害使用固定时间槽，卡帧只结算当前槽。
 * move 是地面效果要求的位置/速度，宿主仍需经地形碰撞或 safeSpawn 后落地。
 */
export class BossHazards {
  private readonly hazards = new Map<number, HazardState>()
  private readonly slides = new Map<string, Slide>()
  private readonly positions = new Map<string, { x: number; y: number }>()
  private nextId = 1
  private nowMs = 0

  get snapshot(): readonly BossHazardSnapshot[] {
    return [...this.hazards.values()].map((entry) => entry.snapshot)
  }

  addAcid(options: BossAcidOptions): number {
    positive(options.tickMs, 'tickMs')
    nonnegative(options.damage, 'damage')
    this.checkCircle(options)
    return this.add({ ...options, kind: 'acid' })
  }

  addWater(options: BossWaterOptions): number {
    positive(options.speed, 'speed')
    this.checkCircle(options)
    return this.add({ ...options, kind: 'water' })
  }

  addLine(options: BossLineOptions): number {
    positive(options.width, 'width')
    nonnegative(options.damage, 'damage')
    if (options.tickMs !== undefined) positive(options.tickMs, 'tickMs')
    for (const key of ['x1', 'y1', 'x2', 'y2'] as const)
      if (!Number.isFinite(options[key])) throw new RangeError(`${key} 必须是有限数`)
    return this.add({ ...options, kind: 'line' })
  }

  /** 自动在 activatesMs 结算一次，expiresMs 之前保留落地后的视觉快照。 */
  addSlam(options: BossSlamOptions): number {
    nonnegative(options.damage, 'damage')
    nonnegative(options.stunMs, 'stunMs')
    this.checkCircle(options)
    return this.add({ ...options, kind: 'slam' })
  }

  /** 立即落地用；需要预警圈或落地残影时使用 addSlam。 */
  slam(options: BossSlamImpact, nowMs: number, units: readonly BossHazardUnit[]): BossHazardCommand[] {
    nonnegative(options.damage, 'damage')
    nonnegative(options.stunMs, 'stunMs')
    this.checkCircle(options)
    const commands: BossHazardCommand[] = []
    const id = this.nextId++
    const seen = new Set<string>()
    for (const unit of units) {
      const identity = identityOf(unit)
      if (seen.has(identity) || !affects(options, unit) || !hitsCircle(options, unit)) continue
      seen.add(identity)
      this.impact(options, unit, nowMs, `boss-slam:${id}`, commands)
    }
    return commands
  }

  update(nowMs: number, dtMs: number, units: readonly BossHazardUnit[]): BossHazardCommand[] {
    this.nowMs = nowMs
    const commands: BossHazardCommand[] = []
    const live = units.filter((unit) => unit.alive)
    const liveIds = new Set(live.map(identityOf))
    for (const identity of this.slides.keys()) if (!liveIds.has(identity)) this.slides.delete(identity)
    for (const identity of this.positions.keys()) if (!liveIds.has(identity)) this.positions.delete(identity)

    for (const [id, entry] of this.hazards) {
      const field = entry.snapshot
      if (nowMs >= field.expiresMs) {
        // 本帧后半段仍可让重叠水面接管既有滑行方向。
        this.hazards.delete(id)
        continue
      }
      if (nowMs < field.activatesMs || field.kind === 'water') continue
      if (field.kind === 'slam') {
        if (!entry.resolved) {
          entry.resolved = true
          commands.push(...this.slam(field, nowMs, live))
        }
        continue
      }
      const tick = field.kind === 'line' && field.tickMs === undefined ? 0 :
        Math.floor((nowMs - field.activatesMs) / field.tickMs! + 1e-9)
      for (const unit of live) {
        const identity = identityOf(unit)
        if (!affects(field, unit) || (entry.settledTicks.get(identity) ?? -1) >= tick) continue
        if (!(field.kind === 'line' ? hitsLine(field, unit) : hitsCircle(field, unit))) continue
        entry.settledTicks.set(identity, tick)
        if (field.damage > 0) commands.push({
          type: 'damage', id: unit.id, damage: field.damage,
          sourceId: field.sourceId, hitKey: `boss-${field.kind}:${field.id}:${tick}`,
        })
      }
    }

    const waters = this.snapshot.filter((field): field is Extract<BossHazardSnapshot, { kind: 'water' }> =>
      field.kind === 'water' && nowMs >= field.activatesMs,
    )
    const processed = new Set<string>()
    for (const unit of live) {
      const identity = identityOf(unit)
      if (processed.has(identity)) continue
      processed.add(identity)
      const overlaps = waters.filter((field) => affects(field, unit) && hitsCircle(field, unit))
      const previous = this.slides.get(identity)
      // 重叠水面沿用进入时方向；所属水面到期后由另一块承接，不叠加速度。
      const water = overlaps.find((field) => field.id === previous?.hazardId) ?? overlaps[0]
      if (water === undefined) {
        this.slides.delete(identity)
      } else {
        let slide = previous
        if (slide === undefined) {
          const last = this.positions.get(identity)
          const vx = unit.vx ?? 0
          const vy = unit.vy ?? 0
          const velocityLength = Math.hypot(vx, vy)
          const dx = velocityLength > 0 ? vx : last === undefined ? 0 : unit.x - last.x
          const dy = velocityLength > 0 ? vy : last === undefined ? 0 : unit.y - last.y
          const length = Math.hypot(dx, dy)
          // 静止落入水面没有可锁的方向，等第一次实际移动再锁定。
          if (length > 0) slide = { hazardId: water.id, dx: dx / length, dy: dy / length }
        }
        if (slide !== undefined) {
          slide.hazardId = water.id
          this.slides.set(identity, slide)
          // 与游戏核心相同的 delta 上限，切回浏览器标签时不瞬移穿墙。
          const seconds = Math.min(Math.max(dtMs, 0), 1000 / 30) / 1000
          if (seconds > 0) {
            const vx = slide.dx * water.speed
            const vy = slide.dy * water.speed
            commands.push({ type: 'move', id: unit.id, x: unit.x + vx * seconds, y: unit.y + vy * seconds, vx, vy })
          }
        }
      }
      this.positions.set(identity, { x: unit.x, y: unit.y })
    }
    return commands
  }

  remove(id: number): void {
    this.hazards.delete(id)
    for (const [identity, slide] of this.slides) if (slide.hazardId === id) this.slides.delete(identity)
  }

  removeSource(sourceId: number): void {
    for (const [id, entry] of this.hazards) if (entry.snapshot.sourceId === sourceId) this.remove(id)
  }

  clear(): void {
    this.hazards.clear()
    this.slides.clear()
    this.positions.clear()
  }

  private checkCircle(options: CircleOptions): void {
    positive(options.radius, 'radius')
    if (!Number.isFinite(options.x) || !Number.isFinite(options.y)) throw new RangeError('中心坐标必须是有限数')
  }

  private add(options: HazardInput): number {
    const activatesMs = options.activatesMs ?? this.nowMs
    if (!Number.isFinite(activatesMs) || !Number.isFinite(options.expiresMs) || options.expiresMs <= activatesMs)
      throw new RangeError('expiresMs 必须晚于有限的 activatesMs')
    const id = this.nextId++
    const snapshot: BossHazardSnapshot = Object.freeze({ ...options, id, createdMs: this.nowMs, activatesMs })
    this.hazards.set(id, { snapshot, settledTicks: new Map(), resolved: false })
    return id
  }

  private impact(options: BossSlamImpact, unit: BossHazardUnit, nowMs: number, hitKey: string, commands: BossHazardCommand[]): void {
    if (options.damage > 0) commands.push({ type: 'damage', id: unit.id, sourceId: options.sourceId, damage: options.damage, hitKey })
    if (options.stunMs > 0) commands.push({ type: 'stun', id: unit.id, sourceId: options.sourceId, untilMs: nowMs + options.stunMs })
  }
}
