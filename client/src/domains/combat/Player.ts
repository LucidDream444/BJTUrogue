import Phaser from 'phaser'
import { D1_ART, D1_ANIMS } from '@/core/d1AssetManifest'
import { textureKeyFor } from '@/core/assets'
import type { GameClock } from '@/core/time'
import type { TypedBus } from '@/core/events'
import type { CombatEvents } from './events'
import type { CombatConfig, WeaponDef } from './config'
import { PlayerModel, moveVelocity } from './PlayerModel'
import { aimBand, aimFrame, equippedMuzzle, shotRecoil } from './AimPose'
import type { PlayerPort } from './EnemyBridge'
import type { BalanceConfig } from '@/core/config'
import { GOOSE_ART } from '@/core/assetManifest'
import { GooseView } from './GooseView'
import { gooseDirection, gooseFrame, goosePose, type GooseDirection } from './GoosePose'
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
  private goose: GooseView | null = null
  private gooseFacing: GooseDirection = 'right'
  private deathAtMs = 0
  private runAnimationMs = 0
  private aimBandValue = 1
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
    // 初始朝右，整帧姿态由鼠标所在的方向档决定。
    this.aimX = x + 1
    this.aimY = y
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
        this.deathAtMs = this.clock.realNowMs
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

  /** 只换美术，存档身份和角色战斗数值继续由宿主决定。 */
  setCharacter(characterId: string): void {
    if (characterId === GOOSE_ART.characterId) this.goose ??= new GooseView(this.sprite)
    else {
      this.goose?.destroy()
      this.goose = null
    }
    this.draw()
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
      bite: (amount, sourceId, nowMs) => this.model.takeGrabBite(amount, sourceId, nowMs),
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
    this.gooseFacing = gooseDirection(dx, dy, this.gooseFacing)
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
    // Mirror the complete equipped pose toward the cursor; a deadzone prevents vertical-aim flicker.
    const offset = worldX - this.x
    if (faceTarget || Math.abs(offset) > this.cfg.player.facingDeadzonePx)
      this.facingLeft = offset < 0
    this.aimBandValue = aimBand(
      this.cfg.aimArt,
      offset,
      worldY - (this.feetY - this.cfg.aimArt.aimOriginOffsetY * this.cfg.player.visualScale),
      this.aimBandValue,
    )
  }
  get angle(): number {
    // 鼠标在长脖子内侧时也保持枪管方向，不能从枪口反算后突然倒射。
    if (this.goose) return this.goosePose().angle
    const muzzle = this.muzzle()
    return Math.atan2(this.aimY - muzzle.y, this.aimX - muzzle.x)
  }
  private visualPose() {
    const art = this.cfg.aimArt
    const elapsed =
      this.clock.nowMs < this.model.attackUntilMs
        ? Math.max(0, this.clock.nowMs - (this.model.attackUntilMs - this.cfg.player.attackPoseMs))
        : null
    const pose = aimFrame(art, this.aimBandValue, this.moving, this.runAnimationMs)
    const recoil = shotRecoil(art, elapsed, this.cfg.player.attackPoseMs, this.facingLeft)
    return {
      ...pose,
      position: { x: this.x + recoil.x, y: this.feetY + recoil.y },
      key: 'player_' + this.weaponIdValue + '_aim_' + pose.sheet + '_' + pose.state,
    }
  }
  muzzle(): { x: number; y: number } {
    if (this.goose) return this.goosePose().muzzle
    const pose = this.visualPose()
    const weaponMuzzle =
      this.weaponIdValue === 'pencil'
        ? undefined
        : this.cfg.gunMuzzles[this.weaponIdValue + 'Shoot']![0]
    return equippedMuzzle(
      this.cfg.aimArt,
      pose,
      pose.position,
      this.cfg.player.visualScale,
      this.facingLeft,
      weaponMuzzle,
    )
  }
  draw(): void {
    this.model.syncState(this.moving)
    const hurt = this.model.alive && this.clock.nowMs < this.model.hurtUntilMs
    if (this.goose) {
      const attack = this.clock.nowMs < this.model.attackUntilMs
      const action = !this.model.alive ? 'death' : hurt ? 'hurt' : attack ? 'shoot' : this.moving ? 'run' : 'idle'
      // 死亡后玩法时钟立即暂停；倒地收尾仅使用表现时间，不推进任何战斗状态。
      const elapsed = !this.model.alive ? this.clock.realNowMs - this.deathAtMs
        : hurt ? this.clock.nowMs - this.model.hurtAtMs
        : attack ? this.clock.nowMs - (this.model.attackUntilMs - this.cfg.player.attackPoseMs)
        : this.moving ? this.runAnimationMs : this.clock.nowMs
      const duration = hurt ? this.cfg.player.hurtMs : attack ? this.cfg.player.attackPoseMs : undefined
      this.goose.draw({ x: this.x, y: this.feetY }, this.gooseFacing, gooseFrame(action, elapsed, duration),
        this.cfg.player.visualScale * GOOSE_ART.visualScale, { x: this.aimX, y: this.aimY },
        this.weaponIdValue, this.model.alive,
        hurt && this.clock.nowMs - this.model.hurtAtMs < this.cfg.feedback.hurtFlashMs)
      this.shadow.setPosition(this.x, this.feetY).setDepth(this.feetY - 1)
      return
    }
    const pose = this.visualPose(),
      art = this.cfg.aimArt
    const anchorX = (art.anchor[0] * art.frameWidth + art.render.offset[0]) / art.render.frameWidth
    const anchorY =
      (art.anchor[1] * art.frameHeight + art.render.offset[1]) / art.render.frameHeight
    this.sprite
      .setPosition(pose.position.x, pose.position.y)
      .setDepth(this.feetY)
      .setTexture(textureKeyFor(this.sprite.scene, pose.key), pose.frame)
      .setFlipX(this.facingLeft)
      .setScale(this.cfg.player.visualScale)
      .setOrigin(this.facingLeft ? 1 - anchorX : anchorX, anchorY)
    if (hurt) {
      // These whole-body hurt sheets already include the equipped weapon and both arms.
      const hurtArt =
        this.weaponIdValue === 'pencil'
          ? PLAYER_ART.hurt
          : (D1_ART.find((a) => a.group === this.weaponIdValue + '_hurt') ?? PLAYER_ART.pulseHurt)
      const frames = D1_ANIMS.find((a) => a.textureKey === hurtArt.key)!.frames
      const progress = Phaser.Math.Clamp(
        (this.clock.nowMs - this.model.hurtAtMs) / this.cfg.player.hurtMs,
        0,
        1,
      )
      const frame = frames[Math.min(frames.length - 1, Math.floor(progress * frames.length))]!
      this.sprite.setPosition(this.x, this.feetY)
      displayArt(
        this.sprite,
        hurtArt,
        this.clock.nowMs,
        this.facingLeft,
        this.cfg.player.visualScale,
        frame,
      )
    }
    this.sprite.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
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
  private goosePose() {
    return goosePose({ x: this.x, y: this.feetY }, this.gooseFacing,
      this.cfg.player.visualScale * GOOSE_ART.visualScale, { x: this.aimX, y: this.aimY })
  }
  destroy(): void {
    this.model.sink = null
    this.model.onHurt = null
    this.goose?.destroy()
    this.sprite.destroy()
    this.shadow.destroy()
    this.anchor.destroy()
  }
}
