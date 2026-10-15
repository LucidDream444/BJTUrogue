import Phaser from 'phaser'
import { ASSETS, PROJECTILE_ART } from '@/core/assetManifest'
import { textureKeyFor } from '@/core/assets'
import type { GameClock } from '@/core/time'
import type { RngLike } from '@/core/rng'
import type { CombatConfig, EffectiveStats, WeaponDef } from './config'
import type { BulletContactPort } from './EnemyBridge'
import { AttackPool, type AttackSlot } from './AttackPool'
import { FireGate } from './PlayerModel'
import type { Player } from './Player'
interface Projectile {
  slot: AttackSlot
  sprite: Phaser.GameObjects.Sprite
  body: Phaser.Physics.Arcade.Body
  damage: number
  pulse: boolean
  effect: WeaponDef['effect']
}
export class Weapons {
  readonly pool: AttackPool
  readonly gate = new FireGate()
  private readonly bullets: Projectile[] = []
  private readonly bySprite = new Map<Phaser.GameObjects.GameObject, Projectile>()
  private readonly collider: Phaser.Physics.Arcade.Collider
  private readonly bulletKey = ASSETS.find((a) => a.key === 'bullet_default')!.key
  firing = false
  shots = 0
  firedAtMs = -Infinity
  private lastPulse = false
  private readonly muzzleFlash: Phaser.GameObjects.Graphics
  private readonly effects: Phaser.GameObjects.Graphics
  private impacts: { x: number; y: number; at: number; effect: WeaponDef['effect'] }[] = []
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly clock: GameClock,
    private readonly cfg: CombatConfig,
    private readonly rng: RngLike,
    private readonly port: BulletContactPort,
    private readonly player: Player,
  ) {
    this.pool = new AttackPool(cfg.projectiles.capacity, (id) => port.release(id))
    for (const slot of this.pool.slots) {
      const sprite = scene.add.sprite(0, 0, textureKeyFor(scene, this.bulletKey))
      scene.physics.add.existing(sprite)
      const body = sprite.body as Phaser.Physics.Arcade.Body
      scene.physics.world.disableBody(body)
      sprite.setActive(false).setVisible(false)
      const b = {
        slot,
        sprite,
        body,
        damage: 0,
        pulse: false,
        effect: 'bullet' as WeaponDef['effect'],
      }
      this.bullets.push(b)
      this.bySprite.set(sprite, b)
    }
    this.collider = scene.physics.add.overlap(
      this.bullets.map((b) => b.sprite),
      port.group,
      (a, b) =>
        this.contact(a as Phaser.GameObjects.GameObject, b as Phaser.GameObjects.GameObject),
    )
    this.muzzleFlash = scene.add.graphics()
    this.effects = scene.add.graphics().setDepth(2600)
  }
  update(stats: EffectiveStats, weapon: WeaponDef): void {
    const now = this.clock.nowMs
    for (const b of this.bullets)
      if (b.slot.active && now - b.slot.bornMs >= b.slot.lifeMs) this.recycle(b)
    if (
      !this.firing ||
      !this.player.model.alive ||
      now < this.player.model.hurtUntilMs ||
      !this.gate.ready(now)
    )
      return
    if (this.player.stamina < weapon.staminaCost) return
    const pulse = weapon.id === 'pulse'
    const projectileKey =
      weapon.id === 'pencil' ? this.bulletKey : (PROJECTILE_ART[weapon.id] ?? PROJECTILE_ART.pulse)
    const slots = this.pool.acquire(pulse ? 1 : stats.pellets, now, stats.lifeMs)
    if (!slots.length) return
    this.gate.fired(now, stats.cooldownMs)
    this.player.spendStamina(weapon.staminaCost)
    this.shots++
    this.firedAtMs = now
    this.lastPulse = pulse
    this.player.model.attackUntilMs = now + this.cfg.player.attackPoseMs
    const muzzle = this.player.muzzle()
    for (const slot of slots) {
      const b = this.bullets[this.pool.slots.indexOf(slot)]!
      const angle =
        this.player.angle +
        (this.rng.floatBetween(-stats.spreadDeg / 2, stats.spreadDeg / 2) * Math.PI) / 180
      b.damage = stats.damage
      b.pulse = pulse
      b.effect = weapon.effect
      b.sprite
        .setTexture(textureKeyFor(this.scene, projectileKey))
        .setActive(true)
        .setVisible(true)
        .setScale(1)
        .setRotation(pulse ? angle : 0)
        .setDepth(2000)
      if (pulse) b.sprite.clearTint()
      else b.sprite.setTint(weapon.color)
      const radius = this.cfg.projectiles.radius
      b.body.setCircle(radius, b.sprite.width / 2 - radius, b.sprite.height / 2 - radius)
      this.scene.physics.world.add(b.body)
      b.body.enable = true
      b.body.reset(muzzle.x, muzzle.y)
      b.body.updateFromGameObject()
      b.body.setVelocity(Math.cos(angle) * stats.bulletSpeed, Math.sin(angle) * stats.bulletSpeed)
    }
  }
  private contact(a: Phaser.GameObjects.GameObject, target: Phaser.GameObjects.GameObject): void {
    const b = this.bySprite.get(a)
    if (!b?.slot.active || this.clock.paused || this.clock.frozen) return
    const result = b.pulse
      ? this.port.pulseContact(b.slot.id, target, b.damage)
      : this.port.contact(b.slot.id, target, b.damage)
    if (b.pulse) {
      this.impacts.push({
        x: b.body.center.x,
        y: b.body.center.y,
        at: this.clock.nowMs,
        effect: b.effect,
      })
      if (this.impacts.length > this.cfg.feedback.maxParticles) this.impacts.shift()
      this.scene.cameras.main.shake(
        this.cfg.feedback.hurtShakeMs,
        this.cfg.feedback.hurtShakeIntensity,
      )
    }
    if (result.consumed) this.recycle(b)
  }
  private recycle(b: Projectile): void {
    this.pool.release(b.slot)
    b.body.stop()
    this.scene.physics.world.disableBody(b.body)
    b.sprite.setActive(false).setVisible(false)
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
    this.impacts = []
    this.effects.clear()
  }
  draw(): void {
    this.effects.clear()
    const now = this.clock.nowMs
    const duration = this.cfg.weapons.find((w) => w.id === this.player.weaponId)!.effectMs
    this.impacts = this.impacts.filter((i) => now - i.at < duration)
    for (const hit of this.impacts) {
      const t = (now - hit.at) / duration
      const palette: Record<string, number> = {
        bullet: 0xffffcc,
        energy: 0x70eeff,
        poison: 0x91ff75,
        explosion: 0xffbd48,
        pierce: 0xffe4a4,
        rapid: 0xcceaff,
      }
      const color = palette[hit.effect] ?? 0xffffff
      const radius = hit.effect === 'explosion' ? 52 : hit.effect === 'poison' ? 25 : 32
      this.effects
        .lineStyle(4 * (1 - t), color, 1 - t)
        .strokeCircle(hit.x, hit.y, 8 + radius * t)
        .lineStyle(2, 0xffffff, (1 - t) * 0.8)
        .strokeCircle(hit.x, hit.y, 4 + 20 * t)
      if (hit.effect === 'poison')
        this.effects.fillStyle(0x8dff7a, (1 - t) * 0.35).fillCircle(hit.x, hit.y, 12 + 16 * t)
      if (hit.effect === 'explosion')
        this.effects.lineStyle(3, color, (1 - t) * 0.7).strokeCircle(hit.x, hit.y, 22 + 45 * t)
    }
    this.muzzleFlash.clear()
    if (!this.player.model.alive || now < this.player.model.hurtUntilMs) return
    if (now - this.firedAtMs < this.cfg.feedback.flashMs) {
      const m = this.player.muzzle()
      this.muzzleFlash
        .fillStyle(this.lastPulse ? 0x8cf7ff : 0xffffcc)
        .fillCircle(m.x, m.y, this.lastPulse ? 9 : 5)
        .setDepth(this.player.feetY + 2)
    }
  }
  destroy(): void {
    this.clear()
    this.collider.destroy()
    for (const b of this.bullets) b.sprite.destroy()
    this.bySprite.clear()
    this.muzzleFlash.destroy()
    this.effects.destroy()
  }
}
