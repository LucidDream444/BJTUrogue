import Phaser from 'phaser'
import { deflectVortexVelocity, type VortexSnapshot } from '@/core/vortex'
import { ASSETS, PROJECTILE_ART } from '@/core/assetManifest'
import { textureKeyFor } from '@/core/assets'
import { allocActorId } from '@/core/actor/ActorModel'
import type { GameClock } from '@/core/time'
import type { RngLike } from '@/core/rng'
import { LEGACY_WEAPON_IDS, type CombatConfig, type EffectiveStats, type WeaponDef, type WeaponTrait } from './config'
import type { BulletContactPort } from './EnemyBridge'
import { AttackPool, type AttackSlot } from './AttackPool'
import { FireGate } from './PlayerModel'
import type { Player } from './Player'
import type { SolidHit, TerrainMap } from './TerrainMap'
import {
  arcTargets,
  chainTargets,
  homingTurn,
  lifestealHeal,
  segmentHit,
  splashTargets,
  splitAngles,
  WeaponStatuses,
  type WeaponTarget,
} from './WeaponMechanics'
import { WeaponFx } from './WeaponFx'

interface Projectile {
  slot: AttackSlot
  sprite: Phaser.GameObjects.Sprite
  body: Phaser.Physics.Arcade.Body
  weapon: WeaponDef
  damage: number
  pending: boolean
  hitIds: Set<number>
  previous: { x: number; y: number }
  origin: { x: number; y: number }
  angle: number
  nextTrailMs: number
  /** 上一次为「穿透命中的目标」触发特殊效果的时刻。**按帧伤节拍限频**，见 `update()` */
  nextPierceSpecialMs: number
  bounces: number
  depth: number
  phase: 'out' | 'back'
  returnAtMs: number
  fuseAtMs: number
  nextWallAtMs: number
  splitDone: boolean
  lastSteerMs: number
}

interface Swing {
  weapon: WeaponDef
  /** 每一段挥砍分配新的 sourceId：同帧内两段也会被去重键区分开。 */
  sourceId: number
  damage: number
  angle: number
  x: number
  y: number
  endMs: number
  nextSegmentMs: number
  segmentsDone: number
  segments: number
  segmentIntervalMs: number
  segmentDamageRatio: number
  hit: Set<number>
}

interface BurstState {
  weapon: WeaponDef
  stats: EffectiveStats
  angle: number
  remaining: number
  intervalMs: number
  nextAtMs: number
}

/**
 * 玩家武器执行层。
 *
 * - 旧六把继续走它们的历史分支（毒/减速/溅射/穿透/连锁），不重写；
 * - 新武器按 `mode` 与 `traits` 执行（近战扇形、burst、beam、bounce、homing、
 *   boomerang、split、fuse、lifesteal、knockback）；
 * - 扫掠命中统一走 `bulletRayContact()`，保留「冲击只算一次、帧伤按 tick」契约。
 */
export class Weapons {
  readonly pool: AttackPool
  readonly gate = new FireGate()
  readonly statuses: WeaponStatuses
  private readonly fx: WeaponFx
  private readonly world: Phaser.Physics.Arcade.World
  private readonly bullets: Projectile[] = []
  private readonly bySprite = new Map<Phaser.GameObjects.GameObject, Projectile>()
  private readonly collider: Phaser.Physics.Arcade.Collider
  private readonly bulletKey = ASSETS.find((a) => a.key === 'bullet_default')!.key
  private readonly muzzleFlash: Phaser.GameObjects.Graphics
  private readonly legacy = new Set<string>(LEGACY_WEAPON_IDS)
  private lastWeapon: WeaponDef
  private swing: Swing | null = null
  private burst: BurstState | null = null
  firing = false
  shots = 0
  firedAtMs = -Infinity

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly clock: GameClock,
    private readonly cfg: CombatConfig,
    private readonly rng: RngLike,
    private readonly port: BulletContactPort,
    private readonly player: Player,
    private readonly terrain: TerrainMap,
    private readonly onShot: (weapon: WeaponDef) => void,
  ) {
    this.world = scene.physics.world
    this.lastWeapon = cfg.weapons[0]!
    this.pool = new AttackPool(cfg.projectiles.capacity, (id) => port.release(id))
    this.statuses = new WeaponStatuses(port, cfg.weaponEffects.maxStatuses)
    this.fx = new WeaponFx(scene, clock, cfg.weaponEffects)
    for (const slot of this.pool.slots) {
      const sprite = scene.add.sprite(0, 0, textureKeyFor(scene, this.bulletKey))
      scene.physics.add.existing(sprite)
      const body = sprite.body as Phaser.Physics.Arcade.Body
      this.world.disableBody(body)
      sprite.setActive(false).setVisible(false)
      const b: Projectile = {
        slot,
        sprite,
        body,
        weapon: cfg.weapons[0]!,
        damage: 0,
        pending: false,
        hitIds: new Set(),
        nextPierceSpecialMs: 0,
        previous: { x: 0, y: 0 },
        origin: { x: 0, y: 0 },
        angle: 0,
        nextTrailMs: 0,
        bounces: 0,
        depth: 0,
        phase: 'out',
        returnAtMs: 0,
        fuseAtMs: 0,
        nextWallAtMs: 0,
        splitDone: false,
        lastSteerMs: 0,
      }
      this.bullets.push(b)
      this.bySprite.set(sprite, b)
    }
    // The starter pistol retains its contact/armor-tick behavior. Special shots use swept hits.
    this.collider = scene.physics.add.overlap(
      this.bullets.map((b) => b.sprite),
      port.group,
      (a, b) =>
        this.contact(a as Phaser.GameObjects.GameObject, b as Phaser.GameObjects.GameObject),
    )
    this.muzzleFlash = scene.add.graphics()
    this.world.on(Phaser.Physics.Arcade.Events.WORLD_STEP, this.onWorldStep, this)
  }

  applyVortices(fields: readonly VortexSnapshot[], dtSec: number): void {
    if (!fields.length || this.clock.paused || this.clock.frozen) return
    for (const b of this.bullets) {
      if (!b.slot.active || b.pending) continue
      const velocity = deflectVortexVelocity(b.body.center, b.body.velocity, fields, dtSec)
      b.body.setVelocity(velocity.x, velocity.y)
      b.angle = Math.atan2(velocity.y, velocity.x)
      b.sprite.setRotation(b.angle)
    }
  }

  update(stats: EffectiveStats, weapon: WeaponDef): void {
    const now = this.clock.nowMs
    for (const b of this.bullets)
      if (b.slot.active && (b.pending || now - b.slot.bornMs >= b.slot.lifeMs)) this.recycle(b)
    this.updateFuse(now)
    for (const b of this.bullets) if (b.slot.active && b.pending) this.recycle(b)
    this.updateBurst(now)

    if (weapon.mode === 'melee' || this.swing) {
      this.updateMelee(now, stats, weapon)
      if (weapon.mode === 'melee' || this.swing) return
    }

    if (weapon.mode === 'beam') {
      this.updateBeam(now, stats, weapon)
      return
    }
    if (this.burst) return
    if (!this.canFire(now) || this.player.stamina < weapon.staminaCost) return

    const burst = this.trait(weapon, 'burst')
    if (burst) {
      if (!this.fireVolley(stats, weapon, this.player.angle, now)) return
      this.gate.fired(now, stats.cooldownMs)
      if (burst.count > 1)
        this.burst = {
          weapon,
          stats,
          angle: this.player.angle,
          remaining: burst.count - 1,
          intervalMs: burst.intervalMs,
          nextAtMs: now + burst.intervalMs,
        }
      return
    }
    if (this.fireVolley(stats, weapon, this.player.angle, now))
      this.gate.fired(now, stats.cooldownMs)
  }

  private canFire(now: number): boolean {
    return (
      this.firing &&
      this.player.model.alive &&
      now >= this.player.model.hurtUntilMs &&
      this.gate.ready(now)
    )
  }

  private trait<K extends WeaponTrait['kind']>(
    weapon: WeaponDef,
    kind: K,
  ): Extract<WeaponTrait, { kind: K }> | undefined {
    return weapon.traits?.find(
      (t): t is Extract<WeaponTrait, { kind: K }> => t.kind === kind,
    )
  }

  private pierceCount(weapon: WeaponDef): number {
    return Math.max(1, this.trait(weapon, 'pierce')?.targets ?? weapon.pierceTargets ?? 1)
  }

  private attackPoseMs(weapon: WeaponDef): number {
    return weapon.mode === 'melee'
      ? (weapon.swingMs ?? this.cfg.player.attackPoseMs)
      : this.cfg.player.attackPoseMs
  }

  private updateBurst(now: number): void {
    const b = this.burst
    if (!b) return
    if (!this.player.model.alive || this.clock.paused || this.clock.frozen) {
      this.burst = null
      return
    }
    if (now < b.nextAtMs) return
    if (b.remaining <= 0) {
      this.burst = null
      return
    }
    if (!this.fireVolley(b.stats, b.weapon, b.angle, now)) {
      this.burst = null
      return
    }
    b.remaining--
    b.nextAtMs = now + b.intervalMs
    if (b.remaining <= 0) this.burst = null
  }

  private updateFuse(now: number): void {
    for (const b of this.bullets) {
      if (!b.slot.active || b.pending || b.fuseAtMs <= 0 || now < b.fuseAtMs) continue
      const fuse = this.trait(b.weapon, 'fuse')
      const center = b.body.center
      if (fuse)
        this.explodeAt(
          b,
          -1,
          center.x,
          center.y,
          this.port.targets(),
          fuse.splashRadius,
          fuse.splashDamageRatio,
        )
      this.fx.impact(b.weapon, center.x, center.y, b.angle)
      b.pending = true
      b.body.stop()
    }
  }

  private fireVolley(
    stats: EffectiveStats,
    weapon: WeaponDef,
    angle: number,
    now: number,
  ): boolean {
    if (this.player.stamina < weapon.staminaCost) return false
    const count = weapon.id === 'pulse' ? 1 : stats.pellets
    const slots = this.pool.acquire(count, now, stats.lifeMs)
    if (!slots.length) return false
    this.player.spendStamina(weapon.staminaCost)
    this.shots++
    this.onShot(weapon)
    this.firedAtMs = now
    this.lastWeapon = weapon
    this.player.model.attackUntilMs = now + this.attackPoseMs(weapon)
    const muzzle = this.player.muzzle()
    this.fx.muzzle(weapon, muzzle.x, muzzle.y, this.player.angle)
    for (const slot of slots) {
      const spread = this.rng.floatBetween(-stats.spreadDeg / 2, stats.spreadDeg / 2)
      this.initProjectile(
        slot,
        weapon,
        stats.damage,
        angle + (spread * Math.PI) / 180,
        muzzle.x,
        muzzle.y,
        now,
        0,
        stats.bulletSpeed,
      )
    }
    return true
  }

  private initProjectile(
    slot: AttackSlot,
    weapon: WeaponDef,
    damage: number,
    angle: number,
    x: number,
    y: number,
    now: number,
    depth: number,
    speed: number,
  ): void {
    const b = this.bullets[this.pool.slots.indexOf(slot)]!
    const fuse = this.trait(weapon, 'fuse')
    const boomerang = this.trait(weapon, 'boomerang')
    b.weapon = weapon
    b.damage = damage
    b.pending = false
    b.hitIds.clear()
    b.depth = depth
    b.bounces = 0
    b.phase = 'out'
    b.returnAtMs = boomerang ? now + boomerang.outMs : 0
    b.fuseAtMs = fuse ? now + fuse.fuseMs : 0
    b.nextWallAtMs = 0
    b.splitDone = false
    b.lastSteerMs = now
    b.nextTrailMs = now
    b.nextPierceSpecialMs = 0
    b.angle = angle
    b.previous.x = b.origin.x = x
    b.previous.y = b.origin.y = y
    const key = weapon.projectileArt ?? PROJECTILE_ART[weapon.id] ?? this.bulletKey
    b.sprite
      .setTexture(textureKeyFor(this.scene, key))
      .setActive(true)
      .setVisible(true)
      .setScale(1)
      .setRotation(weapon.id === 'pulse' || !this.legacy.has(weapon.id) ? angle : 0)
      .setDepth(2000)
    if (weapon.id === 'pencil') b.sprite.clearTint()
    else b.sprite.setTint(weapon.color)
    const r = weapon.projectileRadius ?? this.cfg.projectiles.radius
    b.body.setCircle(r, b.sprite.width / 2 - r, b.sprite.height / 2 - r)
    this.world.add(b.body)
    b.body.enable = true
    b.body.reset(x, y)
    b.body.updateFromGameObject()
    b.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed)
  }

  private updateMelee(now: number, stats: EffectiveStats, weapon: WeaponDef): void {
    const active = this.swing
    if (active) {
      this.applySwing(now, active)
      if (now >= active.endMs && active.nextSegmentMs === Infinity) this.swing = null
    }
    if (
      weapon.mode !== 'melee' ||
      this.swing ||
      !this.canFire(now) ||
      this.player.stamina < weapon.staminaCost
    )
      return
    const multi = this.trait(weapon, 'multiHit')
    const segments = multi?.count ?? 1
    const interval = multi?.intervalMs ?? 0
    const swingMs = weapon.swingMs ?? this.cfg.player.attackPoseMs
    const angle = this.player.meleeAngle
    const x = this.player.x
    const y = this.player.feetY
    this.player.spendStamina(weapon.staminaCost)
    this.gate.fired(now, stats.cooldownMs)
    this.shots++
    this.onShot(weapon)
    this.player.model.attackUntilMs = now + swingMs
    this.swing = {
      weapon,
      sourceId: 0,
      damage: stats.damage,
      angle,
      x,
      y,
      endMs: now + Math.max(swingMs, interval * (segments - 1) + 1),
      nextSegmentMs: now,
      segmentsDone: 0,
      segments,
      segmentIntervalMs: interval,
      segmentDamageRatio: multi?.damageRatio ?? 1,
      hit: new Set(),
    }
    this.fx.slash(weapon, x, y, angle, weapon.range, weapon.arcDeg, swingMs)
    this.applySwing(now, this.swing)
  }

  private applySwing(now: number, swing: Swing): void {
    const weapon = swing.weapon
    if (this.trait(weapon, 'destroyShot'))
      this.port.destroyShotsInArc(
        swing.x,
        swing.y,
        weapon.range,
        swing.angle,
        (weapon.arcDeg * Math.PI) / 180,
      )
    while (swing.segmentsDone < swing.segments && now >= swing.nextSegmentMs) {
      swing.sourceId = allocActorId()
      const all = this.port.targets()
      const targets = arcTargets(
        all,
        { x: swing.x, y: swing.y },
        swing.angle,
        weapon.range,
        (weapon.arcDeg * Math.PI) / 180,
        0,
        (a, b) => this.terrain.crossesSolid(a, b),
      )
      const damage = swing.damage * (swing.segmentsDone === 0 ? 1 : swing.segmentDamageRatio)
      for (const target of targets) {
        if (swing.hit.has(target.id)) continue
        const result = this.port.hit(target.id, swing.sourceId, damage, null)
        swing.hit.add(target.id)
        if (result.applied > 0) {
          this.fx.impact(
            weapon,
            target.x,
            target.y,
            Math.atan2(target.y - swing.y, target.x - swing.x),
          )
          this.applyHitTraits(weapon, target, target.x, target.y, all, damage, result.applied)
        }
      }
      swing.segmentsDone++
      if (swing.segmentsDone >= swing.segments) swing.nextSegmentMs = Infinity
      else {
        swing.hit.clear()
        swing.nextSegmentMs += Math.max(1, swing.segmentIntervalMs)
      }
    }
  }

  private updateBeam(now: number, stats: EffectiveStats, weapon: WeaponDef): void {
    if (!this.canFire(now) || this.player.stamina < weapon.staminaCost) return
    this.gate.fired(now, stats.cooldownMs)
    this.player.spendStamina(weapon.staminaCost)
    this.shots++
    this.onShot(weapon)
    this.player.model.attackUntilMs = now + this.attackPoseMs(weapon)
    const muzzle = this.player.muzzle()
    const angle = this.player.angle
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    const maxEnd = { x: muzzle.x + dx * weapon.range, y: muzzle.y + dy * weapon.range }
    const wallT = this.terrain.solidHitTime(muzzle, maxEnd, 0) ?? 1
    const end = { x: muzzle.x + dx * weapon.range * wallT, y: muzzle.y + dy * weapon.range * wallT }
    const all = this.port.targets()
    const hits = all
      .map((target) => ({ target, t: segmentHit(muzzle, end, target, 0) }))
      .filter((h): h is { target: WeaponTarget; t: number } => h.t !== null)
      .sort((a, b) => a.t - b.t)
    const pierce = this.trait(weapon, 'pierce')?.targets ?? 1
    const source = allocActorId()
    let count = 0
    for (const hit of hits) {
      if (count >= pierce) break
      const x = muzzle.x + (end.x - muzzle.x) * hit.t
      const y = muzzle.y + (end.y - muzzle.y) * hit.t
      const result = this.port.hit(hit.target.id, source, stats.damage, null)
      if (result.applied > 0) {
        this.fx.impact(weapon, x, y, angle)
        this.applyHitTraits(weapon, hit.target, x, y, all, stats.damage, result.applied, angle)
      }
      count++
    }
    this.fx.beam('laser', muzzle.x, muzzle.y, end.x, end.y)
  }

  private applyHitTraits(
    weapon: WeaponDef,
    target: WeaponTarget,
    x: number,
    y: number,
    all: readonly WeaponTarget[],
    baseDamage: number,
    applied: number,
    knockAngle?: number,
  ): void {
    if (weapon.status) this.statuses.apply(target.id, allocActorId(), weapon.status, this.clock.nowMs)
    const knockback = this.trait(weapon, 'knockback')
    if (knockback) {
      const angle =
        knockAngle ?? Math.atan2(target.y - this.player.feetY, target.x - this.player.x)
      this.port.knockback(
        target.id,
        Math.cos(angle) * knockback.strength,
        Math.sin(angle) * knockback.strength,
        180,
      )
    }
    const lifesteal = this.trait(weapon, 'lifesteal')
    if (lifesteal) {
      const heal = lifestealHeal(applied, lifesteal.ratio, lifesteal.maxPerHit)
      if (heal > 0) this.player.model.restoreFromPickup('health', heal)
    }
    const splash = this.trait(weapon, 'splash')
    if (splash) {
      const source = allocActorId()
      for (const other of splashTargets(all, target.id, x, y, splash.radius, (a, b) =>
        this.terrain.crossesSolid(a, b),
      )) {
        const result = this.port.hit(other.id, source, baseDamage * splash.damageRatio, null)
        if (result.applied > 0)
          this.fx.impact(weapon, other.x, other.y, Math.atan2(other.y - y, other.x - x))
      }
    }
    const chain = this.trait(weapon, 'chain')
    if (chain) {
      const source = allocActorId()
      for (const next of chainTargets(all, target, chain.targets, chain.radius, (a, b) =>
        this.terrain.crossesSolid(a, b),
      )) {
        const result = this.port.hit(next.id, source, baseDamage * chain.damageRatio, null)
        if (result.applied > 0) {
          this.fx.beam('pulse', x, y, next.x, next.y)
          this.fx.impact(weapon, next.x, next.y, Math.atan2(next.y - y, next.x - x))
        }
      }
    }
  }

  private steer(b: Projectile, targets: readonly WeaponTarget[], now: number): void {
    const weapon = b.weapon
    const boomerang = this.trait(weapon, 'boomerang')
    if (boomerang) {
      if (b.phase === 'out' && b.returnAtMs > 0 && now >= b.returnAtMs) {
        b.phase = 'back'
        b.hitIds.clear()
      }
      if (b.phase === 'back') {
        const dx = this.player.x - b.body.center.x
        const dy = this.player.feetY - b.body.center.y
        const d = Math.hypot(dx, dy)
        if (d < 28) {
          b.pending = true
          b.body.stop()
          return
        }
        const speed =
          Math.hypot(b.body.velocity.x, b.body.velocity.y) * (boomerang.returnSpeedScale ?? 1)
        const angle = Math.atan2(dy, dx)
        b.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed)
        b.angle = angle
        b.sprite.setRotation(angle)
        return
      }
    }
    const homing = this.trait(weapon, 'homing')
    if (!homing) return
    const maxRange = homing.range ?? Infinity
    let best: WeaponTarget | null = null
    let bestDistance = Infinity
    for (const t of targets) {
      if (b.hitIds.has(t.id)) continue
      const d = Math.hypot(t.x - b.body.center.x, t.y - b.body.center.y)
      if (d <= maxRange && d < bestDistance) {
        best = t
        bestDistance = d
      }
    }
    if (!best) return
    const desired = Math.atan2(best.y - b.body.center.y, best.x - b.body.center.x)
    const dt = Math.max(0.001, Math.min(0.05, (now - b.lastSteerMs) / 1000))
    b.lastSteerMs = now
    const maxTurn = homing.turnRateRadPerSec * dt
    const angle = homingTurn(b.angle, desired, maxTurn)
    const probe = {
      x: b.body.center.x + Math.cos(angle) * 12,
      y: b.body.center.y + Math.sin(angle) * 12,
    }
    if (this.terrain.crossesSolid(b.body.center, probe, 0)) return
    const speed = Math.hypot(b.body.velocity.x, b.body.velocity.y)
    b.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed)
    b.angle = angle
    b.sprite.setRotation(angle)
  }

  private reflect(b: Projectile, wall: SolidHit, bounce: Extract<WeaponTrait, { kind: 'bounce' }>, now: number): void {
    const vx = b.body.velocity.x
    const vy = b.body.velocity.y
    const dot = vx * wall.nx + vy * wall.ny
    let rx = vx - 2 * dot * wall.nx
    let ry = vy - 2 * dot * wall.ny
    const speed = Math.hypot(vx, vy) * (bounce.speedRetain ?? 1)
    const length = Math.hypot(rx, ry) || 1
    rx = (rx / length) * speed
    ry = (ry / length) * speed
    const from = b.previous
    const to = b.body.center
    const hitX = from.x + (to.x - from.x) * wall.t
    const hitY = from.y + (to.y - from.y) * wall.t
    b.body.reset(hitX + wall.nx * 0.5, hitY + wall.ny * 0.5)
    b.body.setVelocity(rx, ry)
    b.previous.x = b.body.center.x
    b.previous.y = b.body.center.y
    b.angle = Math.atan2(ry, rx)
    b.sprite.setRotation(b.angle)
    b.bounces++
    b.nextWallAtMs = now + 30
  }

  private splitProjectile(b: Projectile, x: number, y: number): void {
    const split = this.trait(b.weapon, 'split')
    if (!split || b.splitDone || b.depth >= (split.maxDepth ?? 1)) return
    b.splitDone = true
    const now = this.clock.nowMs
    const slots = this.pool.acquire(
      split.count,
      now,
      Math.max(300, b.slot.lifeMs * 0.6),
    )
    if (!slots.length) return
    const speed = Math.hypot(b.body.velocity.x, b.body.velocity.y) * 0.9
    const spread = ((split.spreadDeg ?? 18) * Math.PI) / 180
    const angles = splitAngles(b.angle, slots.length, spread, split.radial ?? false)
    for (let i = 0; i < slots.length; i++) {
      const angle = angles[i]!
      this.initProjectile(
        slots[i]!,
        b.weapon,
        b.damage * split.damageRatio,
        angle,
        x,
        y,
        now,
        b.depth + 1,
        speed,
      )
    }
  }

  private contact(a: Phaser.GameObjects.GameObject, target: Phaser.GameObjects.GameObject): void {
    const b = this.bySprite.get(a)
    if (
      !b?.slot.active ||
      b.pending ||
      b.weapon.id !== 'pencil' ||
      this.clock.paused ||
      this.clock.frozen
    )
      return
    if (
      this.terrain.crossesSolid(
        b.previous,
        b.body.center,
        b.weapon.projectileRadius ?? this.cfg.projectiles.radius,
      )
    )
      return
    const result = this.port.contact(b.slot.id, target, b.damage)
    if (result.consumed) {
      b.pending = true
      b.body.stop()
    }
  }

  private onWorldStep(): void {
    if (this.clock.paused || this.clock.frozen || !this.player.model.alive) return
    const now = this.clock.nowMs
    const targets = this.bullets.some((b) => b.slot.active && !b.pending)
      ? this.port.targets()
      : []
    for (const b of this.bullets) {
      if (!b.slot.active || b.pending) continue
      const weapon = b.weapon
      this.steer(b, targets, now)
      if (b.pending) continue
      const radius = weapon.projectileRadius ?? this.cfg.projectiles.radius
      const to = b.body.center
      const from = b.previous
      const wall = this.terrain.solidHit(from, to, radius)
      const wallT = wall?.t ?? null
      const hits = targets
        .filter((t) => !b.hitIds.has(t.id))
        .map((t) => ({ target: t, t: segmentHit(from, to, t, radius) }))
        .filter(
          (h): h is { target: WeaponTarget; t: number } =>
            h.t !== null && (wallT === null || h.t < wallT),
        )
        .sort((a, c) => a.t - c.t)
      for (const hit of hits) {
        const target = this.port.target(hit.target.id)
        if (!target) continue
        const x = from.x + (to.x - from.x) * hit.t
        const y = from.y + (to.y - from.y) * hit.t
        // Pencil keeps the contact/armor-tick path through the overlap callback.
        const result = this.port.bulletRayContact(b.slot.id, target.id, b.damage)
        if (weapon.id === 'pencil') {
          if (result.consumed) {
            b.pending = true
            b.body.stop()
            break
          }
          continue
        }
        if (result.consumed) b.hitIds.add(target.id)
        if (result.applied > 0) {
          this.fx.impact(weapon, x, y, b.angle)
          if (this.legacy.has(weapon.id)) this.specialImpact(b, target, targets, x, y)
          this.applyHitTraits(weapon, target, x, y, targets, b.damage, result.applied, b.angle)
          if (this.trait(weapon, 'split')) this.splitProjectile(b, x, y)
          const fuse = this.trait(weapon, 'fuse')
          if (fuse?.explodeOnImpact) {
            this.explodeAt(
              b,
              target.id,
              x,
              y,
              targets,
              fuse.splashRadius,
              fuse.splashDamageRatio,
            )
            b.pending = true
            b.body.stop()
            break
          }
        } else if (!result.consumed && now >= b.nextPierceSpecialMs) {
          b.nextPierceSpecialMs = now + this.port.pierceTickMs
          this.fx.impact(weapon, x, y, b.angle)
          if (this.legacy.has(weapon.id)) this.specialImpact(b, target, targets, x, y)
        }
        if (b.hitIds.size >= this.pierceCount(weapon)) {
          b.pending = true
          b.body.stop()
          break
        }
      }
      if (weapon.id !== 'pencil' && now >= b.nextTrailMs && !b.pending) {
        this.fx.trail(weapon, to.x, to.y, b.angle)
        b.nextTrailMs = now + this.cfg.weaponEffects.trailIntervalMs
      }
      let reflected = false
      if (wall && !b.pending) {
        const t = Math.max(0, wall.t - 0.001)
        const x = from.x + (to.x - from.x) * t
        const y = from.y + (to.y - from.y) * t
        this.fx.impact(weapon, x, y, b.angle)
        const fuse = this.trait(weapon, 'fuse')
        const splash = this.trait(weapon, 'splash')
        const bounce = this.trait(weapon, 'bounce')
        const split = this.trait(weapon, 'split')
        if (fuse) {
          this.explodeAt(b, -1, x, y, targets, fuse.splashRadius, fuse.splashDamageRatio)
          b.pending = true
          b.body.stop()
        } else if (bounce && b.bounces < bounce.maxBounces && now >= b.nextWallAtMs) {
          if (split && (split.on === 'wall' || split.on === 'both'))
            this.splitProjectile(b, x, y)
          this.reflect(b, wall, bounce, now)
          reflected = true
        } else {
          if (weapon.id === 'flare') this.explode(b, -1, x, y, targets)
          if (weapon.id === 'rail') this.fx.beam('rail', b.origin.x, b.origin.y, x, y)
          if (splash) this.explodeAt(b, -1, x, y, targets, splash.radius, splash.damageRatio)
          if (split && (split.on === 'wall' || split.on === 'both'))
            this.splitProjectile(b, x, y)
          b.pending = true
          b.body.stop()
        }
      }
      if (!reflected) {
        from.x = to.x
        from.y = to.y
      }
    }
    this.statuses.step(now, this.clock.frameId, (t) => this.fx.poisonTick(t))
  }

  private specialImpact(
    b: Projectile,
    target: WeaponTarget,
    targets: WeaponTarget[],
    x: number,
    y: number,
  ): void {
    const w = b.weapon
    if (w.id === 'venom') this.statuses.poison(target.id, allocActorId(), w, this.clock.nowMs)
    else if (w.id === 'smg') this.statuses.chill(target.id, w, this.clock.nowMs)
    else if (w.id === 'flare') this.explode(b, target.id, x, y, targets)
    else if (w.id === 'rail') this.fx.beam('rail', b.origin.x, b.origin.y, x, y)
    else if (w.id === 'pulse') {
      let previous = target
      const source = allocActorId()
      for (const next of chainTargets(targets, target, w.chainTargets!, w.chainRadius!, (a, b) =>
        this.terrain.crossesSolid(a, b),
      )) {
        if (!this.port.target(next.id)) continue
        this.port.hit(next.id, source, b.damage * w.chainDamageRatio!, null)
        this.fx.beam('pulse', previous.x, previous.y, next.x, next.y)
        this.fx.impact(w, next.x, next.y, b.angle)
        previous = next
      }
    }
  }

  private explode(
    b: Projectile,
    primaryId: number,
    x: number,
    y: number,
    targets: WeaponTarget[],
  ): void {
    const w = b.weapon
    if (w.splashRadius !== undefined && w.splashDamageRatio !== undefined)
      this.explodeAt(b, primaryId, x, y, targets, w.splashRadius, w.splashDamageRatio)
  }

  private explodeAt(
    b: Projectile,
    primaryId: number,
    x: number,
    y: number,
    targets: WeaponTarget[],
    radius: number,
    ratio: number,
  ): void {
    const source = allocActorId()
    const lifesteal = this.trait(b.weapon, 'lifesteal')
    for (const target of splashTargets(targets, primaryId, x, y, radius, (a, b) =>
      this.terrain.crossesSolid(a, b),
    )) {
      const result = this.port.hit(target.id, source, b.damage * ratio, null)
      if (result.applied <= 0) continue
      this.fx.impact(b.weapon, target.x, target.y, Math.atan2(target.y - y, target.x - x))
      if (lifesteal) {
        const heal = lifestealHeal(result.applied, lifesteal.ratio, lifesteal.maxPerHit)
        if (heal > 0) this.player.model.restoreFromPickup('health', heal)
      }
    }
  }

  /** Recycle outside the physics iteration; stop flags keep each hit single-use meanwhile. */
  resolveTerrain(): void {
    for (const b of this.bullets) if (b.slot.active && b.pending) this.recycle(b)
  }
  private recycle(b: Projectile): void {
    this.pool.release(b.slot)
    b.body.stop()
    this.world.disableBody(b.body)
    b.sprite.setActive(false).setVisible(false)
    b.hitIds.clear()
    b.pending = false
  }
  stopFiring(): void {
    this.firing = false
    this.firedAtMs = -Infinity
    this.burst = null
    if (!this.swing) this.player.model.attackUntilMs = 0
    this.muzzleFlash.clear()
  }
  clear(): void {
    this.stopFiring()
    this.swing = null
    this.burst = null
    for (const b of this.bullets) if (b.slot.active) this.recycle(b)
    this.statuses.clear()
    this.fx.clear()
  }
  draw(): void {
    const now = this.clock.nowMs
    const poison = []
    for (const p of this.statuses.poisons.values()) {
      const target = this.port.target(p.id)
      if (target) poison.push({ target, remaining: p.untilMs - now, duration: p.durationMs })
    }
    const chill = []
    for (const id of this.statuses.chills.keys()) {
      const target = this.port.target(id)
      if (target) chill.push(target)
    }
    this.fx.draw({ poison, chill })
    for (const b of this.bullets)
      if (b.slot.active && !b.pending)
        this.fx.projectile(b.weapon, b.body.center.x, b.body.center.y, b.angle, b.slot.bornMs)
    this.muzzleFlash.clear()
    if (
      this.lastWeapon.id === 'pencil' &&
      this.player.model.alive &&
      now >= this.player.model.hurtUntilMs &&
      now - this.firedAtMs < this.cfg.feedback.flashMs
    ) {
      const m = this.player.muzzle()
      this.muzzleFlash
        .fillStyle(0xffffcc)
        .fillCircle(m.x, m.y, 5)
        .setDepth(this.player.feetY + 2)
    }
  }
  destroy(): void {
    this.world.off(Phaser.Physics.Arcade.Events.WORLD_STEP, this.onWorldStep, this)
    this.clear()
    this.collider.destroy()
    for (const b of this.bullets) b.sprite.destroy()
    this.bySprite.clear()
    this.muzzleFlash.destroy()
    this.fx.destroy()
  }
}
