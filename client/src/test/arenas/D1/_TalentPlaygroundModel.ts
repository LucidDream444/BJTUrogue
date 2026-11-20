import { Rng } from '@/core/rng'

export type TalentEffect =
  | 'split'
  | 'homing'
  | 'crit'
  | 'bounce'
  | 'pierce'
  | 'scatter'
  | 'lightning'
  | 'chain'
  | 'return'
  | 'orbit'
  | 'blackhole'
  | 'explosion'
export interface TalentCard {
  id: TalentEffect
  name: string
  icon: string
  text: string
}
export interface TalentPreset {
  id: string
  name: string
  short: string
  accent: string
  color: number
  description: string
  cards: TalentCard[]
}
export interface PlaygroundConfig {
  schemaVersion: number
  world: { width: number; height: number; padding: number }
  tuning: Record<
    | 'seed'
    | 'playerSpeed'
    | 'playerRadius'
    | 'fireIntervalMs'
    | 'bulletSpeed'
    | 'bulletDamage'
    | 'bulletRadius'
    | 'bulletLifeMs'
    | 'maxBullets'
    | 'maxEffects'
    | 'maxDeltaMs'
    | 'muzzleDistance'
    | 'enemyHp'
    | 'enemyRadius'
    | 'enemyCount'
    | 'enemyRespawnMs'
    | 'enemyMotionRadius'
    | 'enemyMotionSpeed'
    | 'critChance'
    | 'critMultiplier'
    | 'splitChance'
    | 'splitDamageRatio'
    | 'splitCount'
    | 'splitSpreadRad'
    | 'homingRange'
    | 'homingTurnRate'
    | 'bounceCount'
    | 'bounceDamageBonus'
    | 'pierceCount'
    | 'scatterCount'
    | 'scatterAngleRad'
    | 'scatterDamageRatio'
    | 'lightningDamage'
    | 'lightningCooldownMs'
    | 'skillCooldownMs'
    | 'chainCount'
    | 'chainRange'
    | 'chainDamageRatio'
    | 'returnAfterMs'
    | 'returnSpeedScale'
    | 'orbitRadius'
    | 'orbitSpeed'
    | 'orbitLifeMs'
    | 'orbitEveryShots'
    | 'orbitDamageRatio'
    | 'blackholeRadius'
    | 'blackholeDurationMs'
    | 'blackholeCooldownMs'
    | 'blackholePull'
    | 'blackholeDamage'
    | 'explosionRadius'
    | 'explosionDamageRatio'
    | 'hitEffectMs'
    | 'lightningEffectMs'
    | 'explosionEffectMs'
    | 'damageNumberMs'
    | 'muzzleEffectMs',
    number
  >
  presets: TalentPreset[]
}
interface Point {
  x: number
  y: number
}
export interface LabTarget extends Point {
  id: number
  anchorX: number
  anchorY: number
  hp: number
  respawnAt: number
  flash: number
}
export interface LabBullet extends Point {
  id: number
  vx: number
  vy: number
  damage: number
  age: number
  life: number
  secondary: boolean
  crit: boolean
  bounces: number
  hitIds: Set<number>
  returning: boolean
  orbit: boolean
  phase: number
  bonus: boolean
  splitDone: boolean
}
export interface LabEffect extends Point {
  kind: 'hit' | 'number' | 'lightning' | 'explosion' | 'field' | 'muzzle' | 'bounce'
  age: number
  life: number
  size: number
  value: number
  crit: boolean
  points?: Point[]
}
export interface LabInput {
  moveX: number
  moveY: number
  aimX: number
  aimY: number
  fire: boolean
}

/** Swept segment test: fast projectiles cannot tunnel through small targets. */
export function segmentCircleFraction(
  a: Point,
  b: Point,
  center: Point,
  radius: number,
): number | null {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    fx = a.x - center.x,
    fy = a.y - center.y
  const c = fx * fx + fy * fy - radius * radius
  if (c <= 0) return 0
  const length = dx * dx + dy * dy
  if (length <= 0) return null
  const term = 2 * (fx * dx + fy * dy),
    discriminant = term * term - 4 * length * c
  if (discriminant < 0) return null
  const t = (-term - Math.sqrt(discriminant)) / (2 * length)
  return t >= 0 && t <= 1 ? t : null
}

/** Preview-only pure simulation; it is deliberately not a dependency of the product battle. */
export class TalentPlayground {
  readonly player = { x: 270, y: 360 }
  readonly targets: LabTarget[] = []
  bullets: LabBullet[] = []
  effects: LabEffect[] = []
  enabled = new Set<TalentEffect>()
  stats = { shots: 0, hits: 0, kills: 0, damage: 0, splits: 0, bounces: 0, lightning: 0, fields: 0 }
  now = 0
  frame = 0
  presetId = 'swarm'
  private rng: Rng
  private nextShot = 0
  private nextLightning = 0
  private nextField = 0
  private nextId = 1
  private nextSkill = 0

  constructor(readonly config: PlaygroundConfig) {
    this.rng = new Rng(config.tuning.seed)
    this.reset()
    this.select('swarm')
  }

  reset(): void {
    const { width, height } = this.config.world
    const t = this.config.tuning
    this.rng = new Rng(t.seed)
    this.now = this.frame = this.nextShot = this.nextLightning = this.nextField = this.nextSkill = 0
    this.nextId = 1
    this.player.x = width * 0.21
    this.player.y = height * 0.5
    this.bullets = []
    this.effects = []
    this.stats = {
      shots: 0,
      hits: 0,
      kills: 0,
      damage: 0,
      splits: 0,
      bounces: 0,
      lightning: 0,
      fields: 0,
    }
    this.targets.length = 0
    for (let i = 0; i < t.enemyCount; i++) {
      const column = i % 6,
        row = Math.floor(i / 6)
      const x = width * (0.44 + column * 0.08),
        y = height * (0.28 + row * 0.22)
      this.targets.push({
        id: i + 1,
        x,
        y,
        anchorX: x,
        anchorY: y,
        hp: t.enemyHp,
        respawnAt: 0,
        flash: 0,
      })
    }
  }

  select(id: string): void {
    this.presetId = id
    this.enabled = new Set(
      this.config.presets.find((p) => p.id === id)?.cards.map((c) => c.id) ?? [],
    )
    this.reset()
  }

  toggle(effect: TalentEffect): void {
    if (this.enabled.has(effect)) this.enabled.delete(effect)
    else this.enabled.add(effect)
    // Do not leave old projectiles with a changed set of rules mid-flight.
    this.bullets = []
    this.effects = []
  }

  aimTarget(): Point {
    const alive = this.targets.filter((t) => t.hp > 0)
    if (!alive.length)
      return { x: this.config.world.width * 0.8, y: this.config.world.height * 0.5 }
    return alive.reduce((a, b) =>
      Math.hypot(a.x - this.player.x, a.y - this.player.y) <
      Math.hypot(b.x - this.player.x, b.y - this.player.y)
        ? a
        : b,
    )
  }

  step(deltaMs: number, input: LabInput): void {
    const t = this.config.tuning,
      w = this.config.world
    const delta = Math.max(0, Math.min(deltaMs, t.maxDeltaMs)),
      dt = delta / 1000
    this.now += delta
    this.frame++
    const length = Math.hypot(input.moveX, input.moveY)
    if (length > 0) {
      this.player.x += (input.moveX / length) * t.playerSpeed * dt
      this.player.y += (input.moveY / length) * t.playerSpeed * dt
    }
    const margin = w.padding + t.playerRadius
    this.player.x = Math.max(margin, Math.min(w.width - margin, this.player.x))
    this.player.y = Math.max(margin, Math.min(w.height - margin, this.player.y))
    for (const target of this.targets) {
      if (target.hp <= 0 && this.now >= target.respawnAt) {
        target.hp = t.enemyHp
        target.x = target.anchorX
        target.y = target.anchorY
      }
      target.flash = Math.max(0, target.flash - delta)
      if (target.hp > 0) {
        target.x +=
          (target.anchorX +
            Math.sin((this.now / 1000) * t.enemyMotionSpeed + target.id) * t.enemyMotionRadius -
            target.x) *
          dt
        target.y +=
          (target.anchorY +
            Math.cos((this.now / 1200) * t.enemyMotionSpeed + target.id) * t.enemyMotionRadius -
            target.y) *
          dt
      }
    }
    for (const effect of this.effects) effect.age += delta
    const expiredFields = this.effects.filter((e) => e.kind === 'field' && e.age >= e.life)
    this.effects = this.effects.filter((e) => e.age < e.life)
    for (const field of this.effects.filter((e) => e.kind === 'field')) {
      for (const target of this.targets) {
        const distance = Math.hypot(target.x - field.x, target.y - field.y)
        if (target.hp > 0 && distance < field.size && distance > t.enemyRadius * 0.5) {
          const pull = Math.min(distance, t.blackholePull * dt)
          target.x += ((field.x - target.x) / distance) * pull
          target.y += ((field.y - target.y) / distance) * pull
        }
      }
    }
    for (const field of expiredFields) this.explode(field, t.blackholeRadius, t.blackholeDamage)
    if (input.fire && this.now >= this.nextShot) {
      this.shoot(Math.atan2(input.aimY - this.player.y, input.aimX - this.player.x))
      this.nextShot = this.now + t.fireIntervalMs
    }
    const spawned: LabBullet[] = []
    for (const bullet of this.bullets) {
      bullet.age += delta
      if (bullet.age >= bullet.life) continue
      const previous = { x: bullet.x, y: bullet.y }
      if (bullet.orbit) {
        const angle = bullet.phase + (bullet.age / 1000) * t.orbitSpeed
        bullet.x = this.player.x + Math.cos(angle) * t.orbitRadius
        bullet.y = this.player.y + Math.sin(angle) * t.orbitRadius
      } else {
        if (
          this.enabled.has('return') &&
          !bullet.secondary &&
          !bullet.returning &&
          bullet.age >= t.returnAfterMs
        ) {
          bullet.returning = true
          bullet.hitIds.clear()
        }
        if (bullet.returning) {
          const dx = this.player.x - bullet.x,
            dy = this.player.y - bullet.y,
            dist = Math.hypot(dx, dy)
          if (dist <= t.playerRadius + t.bulletSpeed * t.returnSpeedScale * dt) {
            bullet.age = bullet.life
            continue
          }
          bullet.vx = (dx / dist) * t.bulletSpeed * t.returnSpeedScale
          bullet.vy = (dy / dist) * t.bulletSpeed * t.returnSpeedScale
        } else if (this.enabled.has('homing')) this.home(bullet, dt)
        bullet.x += bullet.vx * dt
        bullet.y += bullet.vy * dt
        const hitX = bullet.x < w.padding || bullet.x > w.width - w.padding
        const hitY = bullet.y < w.padding || bullet.y > w.height - w.padding
        if (hitX || hitY) {
          if (this.enabled.has('bounce') && bullet.bounces < t.bounceCount) {
            if (hitX) bullet.vx *= -1
            if (hitY) bullet.vy *= -1
            bullet.x = Math.max(w.padding, Math.min(w.width - w.padding, bullet.x))
            bullet.y = Math.max(w.padding, Math.min(w.height - w.padding, bullet.y))
            bullet.bounces++
            bullet.bonus = true
            this.stats.bounces++
            this.addEffect('bounce', bullet, t.hitEffectMs, 20)
          } else {
            bullet.age = bullet.life
            continue
          }
        }
      }
      const contacts = this.targets
        .filter((target) => target.hp > 0 && !bullet.hitIds.has(target.id))
        .map((target) => ({
          target,
          fraction: segmentCircleFraction(previous, bullet, target, t.enemyRadius + t.bulletRadius),
        }))
        .filter((hit): hit is { target: LabTarget; fraction: number } => hit.fraction !== null)
        .sort((a, b) => a.fraction - b.fraction)
      for (const { target } of contacts) {
        bullet.hitIds.add(target.id)
        const amount =
          bullet.damage *
          (bullet.crit ? t.critMultiplier : 1) *
          (bullet.bonus ? 1 + t.bounceDamageBonus : 1)
        bullet.bonus = false
        this.hit(target, amount, bullet.crit)
        if (bullet.crit && this.enabled.has('lightning') && this.now >= this.nextLightning)
          this.lightning(target)
        if (!bullet.secondary && !bullet.splitDone) {
          bullet.splitDone = true
          if (this.enabled.has('split') && this.rng.next() < t.splitChance) {
            for (let i = 0; i < t.splitCount; i++) {
              const angle =
                Math.atan2(bullet.vy, bullet.vx) + (i - (t.splitCount - 1) / 2) * t.splitSpreadRad
              const child = this.makeBullet(
                target.x,
                target.y,
                angle,
                bullet.damage * t.splitDamageRatio,
                true,
              )
              child.hitIds.add(target.id)
              spawned.push(child)
            }
            this.stats.splits++
          }
          if (this.enabled.has('blackhole') && this.now >= this.nextField) {
            this.addEffect('field', target, t.blackholeDurationMs, t.blackholeRadius)
            this.nextField = this.now + t.blackholeCooldownMs
            this.stats.fields++
          }
          if (this.enabled.has('explosion'))
            this.explode(
              target,
              t.explosionRadius,
              bullet.damage * t.explosionDamageRatio,
              target.id,
            )
        }
        const limit = this.enabled.has('pierce') ? t.pierceCount : 1
        if (!bullet.orbit && bullet.hitIds.size >= limit) {
          if (this.enabled.has('return') && !bullet.secondary && !bullet.returning) {
            bullet.age = Math.max(bullet.age, t.returnAfterMs)
          } else bullet.age = bullet.life
          break
        }
      }
    }
    this.bullets = this.bullets
      .filter((b) => b.age < b.life)
      .concat(spawned)
      .slice(0, t.maxBullets)
  }

  skill(aim: Point): boolean {
    if (!this.enabled.has('lightning') || this.now < this.nextSkill) return false
    const target = this.nearest(aim, this.config.world.width)
    if (!target) return false
    this.lightning(target)
    this.nextSkill = this.now + this.config.tuning.skillCooldownMs
    return true
  }

  private shoot(angle: number): void {
    const t = this.config.tuning
    this.stats.shots++
    const scatter = this.enabled.has('scatter'),
      count = scatter ? t.scatterCount : 1
    for (let i = 0; i < count && this.bullets.length < t.maxBullets; i++) {
      this.bullets.push(
        this.makeBullet(
          this.player.x + Math.cos(angle) * t.muzzleDistance,
          this.player.y + Math.sin(angle) * t.muzzleDistance,
          angle + (i - (count - 1) / 2) * t.scatterAngleRad,
          t.bulletDamage * (scatter ? t.scatterDamageRatio : 1),
          false,
        ),
      )
    }
    if (
      this.enabled.has('orbit') &&
      this.stats.shots % t.orbitEveryShots === 0 &&
      this.bullets.length < t.maxBullets
    ) {
      const bullet = this.makeBullet(
        this.player.x,
        this.player.y,
        angle,
        t.bulletDamage * t.orbitDamageRatio,
        true,
      )
      bullet.orbit = true
      bullet.phase = angle
      bullet.life = t.orbitLifeMs
      bullet.x += Math.cos(angle) * t.orbitRadius
      bullet.y += Math.sin(angle) * t.orbitRadius
      this.bullets.push(bullet)
    }
    this.addEffect(
      'muzzle',
      {
        x: this.player.x + Math.cos(angle) * t.muzzleDistance,
        y: this.player.y + Math.sin(angle) * t.muzzleDistance,
      },
      t.muzzleEffectMs,
      15,
    )
  }

  private makeBullet(
    x: number,
    y: number,
    angle: number,
    damage: number,
    secondary: boolean,
  ): LabBullet {
    const t = this.config.tuning
    return {
      id: this.nextId++,
      x,
      y,
      vx: Math.cos(angle) * t.bulletSpeed,
      vy: Math.sin(angle) * t.bulletSpeed,
      damage,
      age: 0,
      life: t.bulletLifeMs,
      secondary,
      crit: this.enabled.has('crit') && this.rng.next() < t.critChance,
      bounces: 0,
      hitIds: new Set(),
      returning: false,
      orbit: false,
      phase: angle,
      bonus: false,
      splitDone: false,
    }
  }

  private nearest(point: Point, range: number, except = new Set<number>()): LabTarget | undefined {
    let result: LabTarget | undefined,
      best = range
    for (const target of this.targets) {
      if (target.hp <= 0 || except.has(target.id)) continue
      const distance = Math.hypot(target.x - point.x, target.y - point.y)
      if (distance < best) {
        best = distance
        result = target
      }
    }
    return result
  }

  private home(bullet: LabBullet, dt: number): void {
    const t = this.config.tuning,
      target = this.nearest(bullet, t.homingRange, bullet.hitIds)
    if (!target) return
    const current = Math.atan2(bullet.vy, bullet.vx),
      wanted = Math.atan2(target.y - bullet.y, target.x - bullet.x)
    const difference = Math.atan2(Math.sin(wanted - current), Math.cos(wanted - current))
    const angle =
      current + Math.max(-t.homingTurnRate * dt, Math.min(t.homingTurnRate * dt, difference))
    bullet.vx = Math.cos(angle) * t.bulletSpeed
    bullet.vy = Math.sin(angle) * t.bulletSpeed
  }

  private hit(target: LabTarget, amount: number, crit = false): void {
    if (target.hp <= 0) return
    const actual = Math.min(target.hp, amount)
    target.hp -= amount
    target.flash = this.config.tuning.hitEffectMs
    this.stats.hits++
    this.stats.damage += actual
    this.addEffect('hit', target, this.config.tuning.hitEffectMs, 22)
    const number = this.addEffect('number', target, this.config.tuning.damageNumberMs, 0)
    if (number) {
      number.value = Math.round(amount)
      number.crit = crit
    }
    if (target.hp <= 0) {
      this.stats.kills++
      target.respawnAt = this.now + this.config.tuning.enemyRespawnMs
      this.addEffect('explosion', target, this.config.tuning.hitEffectMs, 34)
    }
  }

  private lightning(target: LabTarget): void {
    const t = this.config.tuning
    const points: Point[] = [
      { x: target.x - 16, y: this.config.world.padding },
      { x: target.x, y: target.y },
    ]
    const seen = new Set([target.id])
    this.hit(target, t.lightningDamage)
    let previous = { x: target.x, y: target.y }
    if (this.enabled.has('chain'))
      for (let i = 0; i < t.chainCount; i++) {
        const next = this.nearest(previous, t.chainRange, seen)
        if (!next) break
        seen.add(next.id)
        this.hit(next, t.lightningDamage * t.chainDamageRatio)
        points.push({ x: next.x, y: next.y })
        previous = next
      }
    const effect = this.addEffect('lightning', target, t.lightningEffectMs, 0)
    if (effect) effect.points = points
    this.nextLightning = this.now + t.lightningCooldownMs
    this.stats.lightning++
  }

  private explode(point: Point, radius: number, damage: number, except?: number): void {
    this.addEffect('explosion', point, this.config.tuning.explosionEffectMs, radius)
    for (const target of this.targets)
      if (
        target.hp > 0 &&
        target.id !== except &&
        Math.hypot(target.x - point.x, target.y - point.y) <= radius
      )
        this.hit(target, damage)
  }

  private addEffect(
    kind: LabEffect['kind'],
    point: Point,
    life: number,
    size: number,
  ): LabEffect | undefined {
    if (this.effects.length >= this.config.tuning.maxEffects) {
      if (kind !== 'field') return undefined
      const disposable = this.effects.findIndex((effect) => effect.kind !== 'field')
      if (disposable >= 0) this.effects.splice(disposable, 1)
    }
    const effect: LabEffect = {
      kind,
      x: point.x,
      y: point.y,
      life,
      size,
      age: 0,
      value: 0,
      crit: false,
    }
    this.effects.push(effect)
    return effect
  }
}
