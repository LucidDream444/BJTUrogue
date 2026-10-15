import Phaser from 'phaser'
import { D1_ART, D1_ANIMS } from '@/core/d1AssetManifest'
import { textureKeyFor } from '@/core/assets'
import type { GameClock } from '@/core/time'
import type { TypedBus } from '@/core/events'
import type { CombatEvents } from './events'
import type { CombatConfig, WeaponDef } from './config'
import { PlayerModel, moveVelocity } from './PlayerModel'
import { gunMuzzlePosition } from './gunPose'
import type { PlayerPort } from './EnemyBridge'
import type { BalanceConfig } from '@/core/config'
type Art = (typeof D1_ART)[number]
export const PLAYER_ART = {
  pulseRun: D1_ART.find((a) => a.group === 'pulse_run')!,
  pulseShoot: D1_ART.find((a) => a.group === 'pulse_shoot')!,
  pulseHurt: D1_ART.find((a) => a.group === 'pulse_hurt')!,
  hurt: D1_ART.find((a) => a.group === 'hurt')!,
  sword: D1_ART.find((a) => a.group === '1')!,
  shoot: D1_ART.find((a) => a.group === '2')!,
  runGun: D1_ART.find((a) => a.group === '4')!,
  run: D1_ART.find((a) => a.group === '8')!,
  idle: D1_ART.filter((a) => a.group === '3' && a.frameWidth === 64),
}
function artFrame(art: Art, nowMs: number): number {
  const anim = D1_ANIMS.find((a) => a.textureKey === art.key)
  const frames = anim?.frames ?? [0]
  return frames[Math.floor(nowMs / (1000 / (anim?.frameRate ?? 1))) % frames.length] ?? 0
}
/** Render an exported animation using the shared logical clock, not Sprite's real-time update. */
export function displayArt(
  sprite: Phaser.GameObjects.Sprite,
  art: Art,
  nowMs: number,
  flip = false,
  scale = 1,
  stillFrame?: number,
): void {
  const frame = stillFrame ?? artFrame(art, nowMs)
  const anchor = art.anchors[frame] ?? art.anchors[0]!
  sprite.setTexture(textureKeyFor(sprite.scene, art.key), frame).setFlipX(flip).setScale(scale)
  sprite.setOrigin(flip ? 1 - anchor[0] : anchor[0], anchor[1])
}
export class Player {
  readonly model: PlayerModel
  readonly body: Phaser.Physics.Arcade.Body
  readonly sprite: Phaser.GameObjects.Sprite
  readonly anchor: Phaser.GameObjects.Zone
  private readonly keys: Record<string, Phaser.Input.Keyboard.Key>
  private aimX = 0
  private aimY = 0
  private facingLeft = false
  private moving = false
  private runAnimationMs = 0
  private weaponIdValue: WeaponDef['id'] = 'pencil'
  maxStamina: number
  stamina: number
  private readonly shadow: Phaser.GameObjects.Ellipse
  constructor(
    scene: Phaser.Scene,
    private readonly clock: GameClock,
    private readonly cfg: CombatConfig,
    balance: BalanceConfig,
    bus: TypedBus<CombatEvents>,
    x: number,
    y: number,
  ) {
    this.maxStamina = cfg.player.maxStamina
    this.stamina = this.maxStamina
    this.model = new PlayerModel(
      balance.baseline.player,
      clock,
      cfg.player.hurtMs,
      cfg.player.maxShield,
    )
    this.model.onHurt = (req, hpDamage, shieldDamage) => {
      this.body.stop()
      bus.emit('player_hurt', {
        id: this.model.id,
        hpDamage,
        shieldDamage,
        sourceKind: req.sourceKind,
        frameId: req.frameId,
      })
    }
    this.model.iframeMs = balance.baseline.player.iframeMs
    this.model.protectedUntilMs = clock.nowMs + cfg.player.spawnGraceMs
    const radius = this.model.stats.radius
    this.anchor = scene.add.zone(x, y, radius * 2, radius * 2)
    scene.physics.add.existing(this.anchor)
    this.body = this.anchor.body as Phaser.Physics.Arcade.Body
    this.body.setCircle(radius).setCollideWorldBounds(true)
    this.shadow = scene.add.ellipse(x, y, radius * 2, radius, 0x000000, 0.3)
    this.sprite = scene.add.sprite(
      x,
      y,
      textureKeyFor(scene, PLAYER_ART.shoot.key),
      cfg.player.gunIdleFrame,
    )
    this.keys = scene.input.keyboard!.addKeys('W,A,S,D') as Record<
      string,
      Phaser.Input.Keyboard.Key
    >
    this.model.sink = {
      onDamaged: (e) => {
        if (e.amount <= 0) return
        bus.emit('entity_damaged', { ...e, targetKind: 'player', batched: false, tickCount: 1 })
      },
      onKilled: (e) => {
        this.body.stop()
        bus.emit('entity_killed', {
          id: e.targetId,
          kind: 'player',
          x: this.x,
          y: this.y,
          sourceId: e.sourceId,
        })
      },
    }
  }
  get weaponId(): WeaponDef['id'] {
    return this.weaponIdValue
  }

  setWeapon(weapon: WeaponDef): void {
    this.weaponIdValue = weapon.id
  }

  get x(): number {
    return this.body.center.x
  }
  get y(): number {
    return this.body.center.y
  }
  get feetY(): number {
    return this.y + this.model.stats.radius
  }
  view(): PlayerPort {
    return {
      model: this.model,
      x: this.x,
      y: this.y,
      vx: this.body.velocity.x,
      vy: this.body.velocity.y,
      radius: this.model.stats.radius,
      alive: this.model.alive,
    }
  }
  move(dtMs: number, enabled: boolean): void {
    if (!enabled || !this.model.alive) {
      this.body.stop()
      this.moving = false
      this.runAnimationMs = 0
      return
    }
    const dx = Number(this.keys.D!.isDown) - Number(this.keys.A!.isDown),
      dy = Number(this.keys.S!.isDown) - Number(this.keys.W!.isDown)
    // Movement sets the default facing; active mouse fire can override it afterwards.
    if (dx !== 0) this.facingLeft = dx < 0
    const v = moveVelocity(
      this.body.velocity.x,
      this.body.velocity.y,
      dx,
      dy,
      this.model.stats.speed,
      this.cfg.player.acceleration,
      this.cfg.player.deceleration,
      dtMs / 1000,
    )
    this.body.setVelocity(v.x, v.y)
    const speed = Math.hypot(v.x, v.y)
    this.moving = speed > 1
    if (this.moving) this.runAnimationMs += (Math.max(0, dtMs) * speed) / this.model.stats.speed
    else this.runAnimationMs = 0
  }
  applyStaminaLimit(maximum: number): void {
    this.maxStamina = maximum
    this.stamina = Math.min(this.stamina, maximum)
  }
  advanceStamina(deltaMs: number, firing: boolean): void {
    if (
      firing ||
      !this.model.alive ||
      this.clock.paused ||
      this.clock.frozen ||
      !Number.isFinite(deltaMs)
    )
      return
    this.stamina = Math.min(
      this.maxStamina,
      this.stamina + (this.cfg.player.staminaRegenPerSec * Math.max(0, deltaMs)) / 1000,
    )
  }

  restoreStamina(amount: number): number {
    if (
      !this.model.alive ||
      this.clock.paused ||
      this.clock.frozen ||
      !Number.isFinite(amount) ||
      amount <= 0
    )
      return 0
    const restored = Math.min(amount, this.maxStamina - this.stamina)
    this.stamina += restored
    return restored
  }

  spendStamina(amount: number): boolean {
    if (
      !Number.isFinite(amount) ||
      amount < 0 ||
      !this.model.alive ||
      this.clock.paused ||
      this.clock.frozen
    )
      return false
    if (this.stamina < amount) return false
    this.stamina -= amount
    return true
  }
  aim(worldX: number, worldY: number, faceTarget = false): void {
    this.aimX = worldX
    this.aimY = worldY
    if (faceTarget) this.facingLeft = worldX < this.x
  }
  get angle(): number {
    const muzzle = this.muzzle()
    return Math.atan2(this.aimY - muzzle.y, this.aimX - muzzle.x)
  }
  private weaponArt(type: 'run' | 'shoot' | 'hurt'): Art {
    if (this.weaponIdValue === 'pencil')
      return type === 'run'
        ? PLAYER_ART.runGun
        : type === 'shoot'
          ? PLAYER_ART.shoot
          : PLAYER_ART.hurt
    const group = '' + this.weaponIdValue + '_' + type
    return (
      D1_ART.find((a) => a.group === group) ??
      (type === 'run'
        ? PLAYER_ART.pulseRun
        : type === 'shoot'
          ? PLAYER_ART.pulseShoot
          : PLAYER_ART.pulseHurt)
    )
  }
  private muzzleKey(type: 'run' | 'shoot'): string {
    if (this.weaponIdValue === 'pencil') return type === 'run' ? 'runGun' : 'shoot'
    return this.weaponIdValue + (type === 'run' ? 'Run' : 'Shoot')
  }
  private pose(): { art: Art; frame: number; point: [number, number] } {
    const type = this.moving ? 'run' : 'shoot',
      art = this.weaponArt(type),
      key = this.muzzleKey(type)
    const attack = this.clock.nowMs < this.model.attackUntilMs
    const frame = this.moving
      ? Math.floor((this.runAnimationMs * this.cfg.player.gunRunFrameRate) / 1000) % art.count
      : attack
        ? artFrame(
            art,
            Math.max(
              0,
              this.clock.nowMs - (this.model.attackUntilMs - this.cfg.player.attackPoseMs),
            ),
          )
        : this.cfg.player.gunIdleFrame
    const points = this.cfg.gunMuzzles[key] ?? this.cfg.gunMuzzles.shoot
    return { art, frame, point: points[Math.min(frame, points.length - 1)]! }
  }
  muzzle(): { x: number; y: number } {
    const { art, frame, point } = this.pose()
    return gunMuzzlePosition(
      { x: this.x, y: this.feetY },
      art,
      art.anchors[frame]!,
      point,
      this.cfg.player.visualScale,
      this.facingLeft,
    )
  }
  draw(): void {
    this.model.syncState(this.moving)
    const hurt = this.model.alive && this.clock.nowMs < this.model.hurtUntilMs
    const art = this.weaponArt(hurt ? 'hurt' : this.moving ? 'run' : 'shoot')
    let frame = this.pose().frame
    if (hurt) {
      const frames = D1_ANIMS.find((a) => a.textureKey === art.key)!.frames
      const progress = (this.clock.nowMs - this.model.hurtAtMs) / this.cfg.player.hurtMs
      frame = frames[Math.min(frames.length - 1, Math.floor(progress * frames.length))]!
    }
    this.sprite.setPosition(this.x, this.feetY).setDepth(this.feetY)
    displayArt(
      this.sprite,
      art,
      this.clock.nowMs,
      this.facingLeft,
      this.cfg.player.visualScale,
      frame,
    )
    this.sprite
      .setRotation(this.model.alive ? 0 : -Math.PI / 2)
      .setAlpha(this.model.alive ? 1 : 0.45)
    if (hurt && this.clock.nowMs - this.model.hurtAtMs < this.cfg.feedback.hurtFlashMs)
      this.sprite.setTint(0xffb5b5)
    else this.sprite.clearTint()
    this.shadow.setPosition(this.x, this.feetY).setDepth(this.feetY - 1)
  }
  clearInput(): void {
    for (const key of Object.values(this.keys)) key.reset()
    this.body.stop()
  }
  destroy(): void {
    this.model.sink = null
    this.model.onHurt = null
    this.sprite.destroy()
    this.shadow.destroy()
    this.anchor.destroy()
  }
}
