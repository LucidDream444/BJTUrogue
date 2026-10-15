import Phaser from 'phaser'
import { ASSETS, PROJECTILE_ART } from '@/core/assetManifest'
import { textureKeyFor } from '@/core/assets'
import { allocActorId } from '@/core/actor/ActorModel'
import type { GameClock } from '@/core/time'
import type { RngLike } from '@/core/rng'
import type { CombatConfig, EffectiveStats, WeaponDef } from './config'
import type { BulletContactPort } from './EnemyBridge'
import { AttackPool, type AttackSlot } from './AttackPool'
import { FireGate } from './PlayerModel'
import type { Player } from './Player'
import type { TerrainMap } from './TerrainMap'
import {
  chainTargets,
  segmentHit,
  splashTargets,
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
}

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
  private lastWeapon: WeaponDef
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
    private readonly onShot: () => void,
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
        previous: { x: 0, y: 0 },
        origin: { x: 0, y: 0 },
        angle: 0,
        nextTrailMs: 0,
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

  update(stats: EffectiveStats, weapon: WeaponDef): void {
    const now = this.clock.nowMs
    for (const b of this.bullets)
      if (b.slot.active && (b.pending || now - b.slot.bornMs >= b.slot.lifeMs)) this.recycle(b)
    if (
      !this.firing ||
      !this.player.model.alive ||
      now < this.player.model.hurtUntilMs ||
      !this.gate.ready(now) ||
      this.player.stamina < weapon.staminaCost
    )
      return
    const slots = this.pool.acquire(weapon.id === 'pulse' ? 1 : stats.pellets, now, stats.lifeMs)
    if (!slots.length) return
    this.gate.fired(now, stats.cooldownMs)
    this.player.spendStamina(weapon.staminaCost)
    this.shots++
    this.onShot()
    this.firedAtMs = now
    this.lastWeapon = weapon
    this.player.model.attackUntilMs = now + this.cfg.player.attackPoseMs
    const muzzle = this.player.muzzle(),
      key = weapon.id === 'pencil' ? this.bulletKey : PROJECTILE_ART[weapon.id]!
    this.fx.muzzle(weapon, muzzle.x, muzzle.y, this.player.angle)
    for (const slot of slots) {
      const b = this.bullets[this.pool.slots.indexOf(slot)]!
      b.weapon = weapon
      b.damage = stats.damage
      b.pending = false
      b.hitIds.clear()
      b.nextTrailMs = now
      b.angle =
        this.player.angle +
        (this.rng.floatBetween(-stats.spreadDeg / 2, stats.spreadDeg / 2) * Math.PI) / 180
      b.previous.x = b.origin.x = muzzle.x
      b.previous.y = b.origin.y = muzzle.y
      b.sprite
        .setTexture(textureKeyFor(this.scene, key))
        .setActive(true)
        .setVisible(true)
        .setScale(1)
        .setRotation(weapon.id === 'pulse' ? b.angle : 0)
        .setDepth(2000)
      if (weapon.id === 'pulse') b.sprite.clearTint()
      else b.sprite.setTint(weapon.color)
      const r = this.cfg.projectiles.radius
      b.body.setCircle(r, b.sprite.width / 2 - r, b.sprite.height / 2 - r)
      this.world.add(b.body)
      b.body.enable = true
      b.body.reset(muzzle.x, muzzle.y)
      b.body.updateFromGameObject()
      b.body.setVelocity(
        Math.cos(b.angle) * stats.bulletSpeed,
        Math.sin(b.angle) * stats.bulletSpeed,
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
    if (this.terrain.crossesSolid(b.previous, b.body.center, this.cfg.projectiles.radius)) return
    const result = this.port.contact(b.slot.id, target, b.damage)
    if (result.consumed) {
      b.pending = true
      b.body.stop()
    }
  }

  private onWorldStep(): void {
    if (this.clock.paused || this.clock.frozen || !this.player.model.alive) return
    const now = this.clock.nowMs
    const targets = this.bullets.some(
      (b) => b.slot.active && !b.pending && b.weapon.id !== 'pencil',
    )
      ? this.port.targets()
      : []
    for (const b of this.bullets) {
      if (!b.slot.active || b.pending) continue
      const to = b.body.center,
        from = b.previous,
        wall = this.terrain.solidHitTime(from, to, this.cfg.projectiles.radius)
      if (b.weapon.id !== 'pencil') {
        const hits = targets
          .filter((t) => !b.hitIds.has(t.id))
          .map((t) => ({ target: t, t: segmentHit(from, to, t, this.cfg.projectiles.radius) }))
          .filter(
            (h): h is { target: WeaponTarget; t: number } =>
              h.t !== null && (wall === null || h.t < wall),
          )
          .sort((a, b) => a.t - b.t)
        for (const hit of hits) {
          const target = this.port.target(hit.target.id)
          if (!target) continue
          b.hitIds.add(target.id)
          const x = from.x + (to.x - from.x) * hit.t,
            y = from.y + (to.y - from.y) * hit.t
          const result = this.port.hit(target.id, b.slot.id, b.damage, null)
          if (result.applied > 0) {
            this.fx.impact(b.weapon, x, y, b.angle)
            this.specialImpact(b, target, targets, x, y)
          }
          if (b.hitIds.size >= (b.weapon.pierceTargets ?? 1)) {
            b.pending = true
            b.body.stop()
            break
          }
        }
        if (now >= b.nextTrailMs && !b.pending) {
          this.fx.trail(b.weapon, to.x, to.y, b.angle)
          b.nextTrailMs = now + this.cfg.weaponEffects.trailIntervalMs
        }
      }
      if (wall !== null && !b.pending) {
        const t = Math.max(0, wall - 0.001),
          x = from.x + (to.x - from.x) * t,
          y = from.y + (to.y - from.y) * t
        this.fx.impact(b.weapon, x, y, b.angle)
        if (b.weapon.id === 'flare') this.explode(b, -1, x, y, targets)
        if (b.weapon.id === 'rail') this.fx.beam('rail', b.origin.x, b.origin.y, x, y)
        b.pending = true
        b.body.stop()
      }
      from.x = to.x
      from.y = to.y
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
    const w = b.weapon,
      source = allocActorId()
    for (const target of splashTargets(targets, primaryId, x, y, w.splashRadius!, (a, b) =>
      this.terrain.crossesSolid(a, b),
    ))
      this.port.hit(target.id, source, b.damage * w.splashDamageRatio!, null)
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
    this.player.model.attackUntilMs = 0
    this.muzzleFlash.clear()
  }
  clear(): void {
    this.stopFiring()
    for (const b of this.bullets) if (b.slot.active) this.recycle(b)
    this.statuses.clear()
    this.fx.clear()
  }
  draw(): void {
    const now = this.clock.nowMs
    const poison = []
    const duration = this.cfg.weapons.find((w) => w.id === 'venom')!.poisonDurationMs!
    for (const p of this.statuses.poisons.values()) {
      const target = this.port.target(p.id)
      if (target) poison.push({ target, remaining: p.untilMs - now, duration })
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
