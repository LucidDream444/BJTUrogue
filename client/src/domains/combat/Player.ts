import Phaser from 'phaser'
import { D1_ART, D1_ANIMS, D1_ART_LAYERS } from '@/core/d1AssetManifest'
import { textureKeyFor } from '@/core/assets'
import type { GameClock } from '@/core/time'
import type { TypedBus } from '@/core/events'
import type { CombatEvents } from './events'
import type { CombatConfig, WeaponDef } from './config'
import { PlayerModel, moveVelocity } from './PlayerModel'
import { armPose, type ArmPose } from './gunPose'
import type { PlayerPort } from './EnemyBridge'
import type { BalanceConfig } from '@/core/config'
type Art = (typeof D1_ART)[number] | (typeof D1_ART_LAYERS)[number]
const LAYER_ART = (group: string): Art | undefined => D1_ART_LAYERS.find((a) => a.group === group)
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
  /**
   * 手臂+枪的独立图层，绕肩旋转指向鼠标。
   *
   * 受击与死亡时**藏起来**：那些姿势的手臂是烘焙在 `hurt` 图里的，没有分层素材，
   * 而 `hurt` 图本身就带着枪 —— 两层同时画会出两条枪。
   */
  readonly armSprite: Phaser.GameObjects.Sprite
  /**
   * 枪械图层：每把枪一张图，跟着手臂刚性旋转。**画在手臂之下** ——
   * 原图里手指是压在枪身上的，反了会把手指盖住。
   * 手枪没有这一层（它只有一把武器，没有跨武器复用，枪留在手臂图里）。
   */
  readonly gunSprite: Phaser.GameObjects.Sprite
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
    // 初始瞄准点默认朝右，免得第一帧的手臂朝着世界原点转过去。
    this.aimX = x + 1
    this.aimY = y
    this.armSprite = scene.add.sprite(
      x,
      y,
      textureKeyFor(scene, PLAYER_ART.shoot.key),
      cfg.player.gunIdleFrame,
    )
    this.gunSprite = scene.add.sprite(
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
    // 朝向决定手臂能转到哪半边（`gunPose.ts` 会把枪管夹进那半圆），所以它不能只跟
    // 移动方向走 —— 否则「跑向右、鼠标指向左」时手臂会横穿身体。死区是为了鼠标正好
    // 在身体正上/正下时不会来回翻面。
    const offset = worldX - this.x
    if (faceTarget || Math.abs(offset) > this.cfg.player.facingDeadzonePx)
      this.facingLeft = offset < 0
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
  private pose(): {
    type: 'run' | 'shoot'
    art: Art
    frame: number
    point: [number, number]
    pivot: [number, number]
  } {
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
    // 各武器没单独配枢轴时退回基准键，和枪口坐标的兜底策略一致。
    const pivots = this.cfg.gunPivots[key] ?? this.cfg.gunPivots[type === 'run' ? 'runGun' : 'shoot']
    return { type, art, frame, point: points[Math.min(frame, points.length - 1)]!, pivot: pivots }
  }
  /** 手臂图层的姿态：枢轴世界坐标、旋转角、枪口。推导见 `gunPose.ts`。 */
  private armState(p: ReturnType<Player['pose']>): ArmPose {
    return armPose(
      { x: this.x, y: this.feetY },
      p.art,
      p.art.anchors[p.frame]!,
      p.pivot,
      p.point,
      this.cfg.player.visualScale,
      this.facingLeft,
      this.aimX,
      this.aimY,
    )
  }
  muzzle(): { x: number; y: number } {
    return this.armState(this.pose()).muzzle
  }
  /** 素材族：步枪 5 把共用一套身体与手臂，手枪自成一族（尺寸都不同）。 */
  private artFamily(): 'rifle' | 'pencil' {
    return this.weaponIdValue === 'pencil' ? 'pencil' : 'rifle'
  }
  private layerArt(type: 'run' | 'shoot', role: 'body' | 'arm'): Art {
    return LAYER_ART(`${role}_${this.artFamily()}_${type}`) ?? this.weaponArt(type)
  }
  /** 手枪没有独立的枪图层（见 `gunSprite` 的说明）。 */
  private gunArt(): Art | undefined {
    return this.weaponIdValue === 'pencil' ? undefined : LAYER_ART(`gun_${this.weaponIdValue}`)
  }
  /**
   * 枪相对**导出时那一帧**的位移，帧坐标。枪是刚体，它的位移和枪口位移是同一个 ——
   * 所以直接用 `gunMuzzles` 推，不用另开一张表。
   */
  private gunDelta(type: 'run' | 'shoot'): { x: number; y: number } {
    const cur = this.cfg.gunMuzzles[this.muzzleKey(type)] ?? this.cfg.gunMuzzles.shoot
    // 枪图是从**射击状态的第 0 帧**导出的（见 split_arm_layers.py 的 GUN_REFERENCE_STATE）
    const ref = this.cfg.gunMuzzles[this.weaponIdValue + 'Shoot']?.[0] ?? cur[0]!
    const now = cur[Math.min(this.pose().frame, cur.length - 1)] ?? ref
    return { x: now[0] - ref[0], y: now[1] - ref[1] }
  }
  draw(): void {
    this.model.syncState(this.moving)
    const hurt = this.model.alive && this.clock.nowMs < this.model.hurtUntilMs
    // 受击与死亡用**原始图**（手臂和枪烘焙在里面），手臂图层藏起来 —— 那两种姿势
    // 没有分层素材，硬画会在身体上出现第两条枪。
    const layered = !hurt && this.model.alive
    const pose = this.moving ? 'run' : 'shoot'
    const p = this.pose()
    const art = layered ? this.layerArt(pose, 'body') : this.weaponArt(hurt ? 'hurt' : pose)
    let frame = p.frame
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
    this.drawLayers(layered, pose, frame, p)
    this.shadow.setPosition(this.x, this.feetY).setDepth(this.feetY - 1)
  }
  /** 手臂 + 枪两层：都绕肩旋转到鼠标方向，画在身体之上、同一帧。 */
  private drawLayers(
    layered: boolean,
    pose: 'run' | 'shoot',
    frame: number,
    p: ReturnType<Player['pose']>,
  ): void {
    if (!layered) {
      this.armSprite.setVisible(false)
      this.gunSprite.setVisible(false)
      return
    }
    const armArt = this.layerArt(pose, 'arm')
    const { pivot, rotation } = this.armState(p)
    // 原点设在肩上，`setRotation` 才是绕肩转 —— 绕帧中心转会把手甩到身体外面去。
    const ox = p.pivot[0] / armArt.frameWidth
    const oy = p.pivot[1] / armArt.frameHeight
    const originX = this.facingLeft ? 1 - ox : ox
    const scale = this.cfg.player.visualScale

    this.armSprite
      .setVisible(true)
      .setTexture(textureKeyFor(this.sprite.scene, armArt.key), frame)
      .setFlipX(this.facingLeft)
      .setScale(scale)
      .setOrigin(originX, oy)
      .setPosition(pivot.x, pivot.y)
      .setRotation(rotation)
      // 略高于自身身体的排序值，保证压在身体之上，但不越过别人。
      .setDepth(this.feetY + 0.1)

    const gunArt = this.gunArt()
    if (!gunArt) {
      this.gunSprite.setVisible(false)
      return
    }
    // 枪的逐帧位移在手臂的**局部坐标**里，得跟着手臂的镜像与旋转一起走。
    const d = this.gunDelta(pose)
    const dx = d.x * scale * (this.facingLeft ? -1 : 1)
    const dy = d.y * scale
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    this.gunSprite
      .setVisible(true)
      .setTexture(textureKeyFor(this.sprite.scene, gunArt.key), 0)
      .setFlipX(this.facingLeft)
      .setScale(scale)
      .setOrigin(originX, oy)
      .setPosition(pivot.x + cos * dx - sin * dy, pivot.y + sin * dx + cos * dy)
      .setRotation(rotation)
      // **枪画在手臂之下**：原图里手指压在枪身上，反了会盖住手指。
      .setDepth(this.feetY + 0.05)
  }
  clearInput(): void {
    for (const key of Object.values(this.keys)) key.reset()
    this.body.stop()
  }
  destroy(): void {
    this.model.sink = null
    this.model.onHurt = null
    this.sprite.destroy()
    this.armSprite.destroy()
    this.gunSprite.destroy()
    this.shadow.destroy()
    this.anchor.destroy()
  }
}
