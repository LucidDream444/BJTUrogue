/**
 * 测试场用的**假玩家**。**这不是玩家角色**（玩家角色归 D1，见《人员分工方案》）。
 *
 * 它只需要满足两个接口：
 * - `TickTarget` —— 能被伤害账本结算（肉盾砸下来、怪贴脸接触掉血）。
 *   见 `core/actor/damage.ts`：`readonly id` / `readonly spawnSeq` / `readonly alive` / `takeHit`。
 * - `PlayerView` —— 能给 `EnemySystem` 当追击目标（`EnemySystem.ts` 的 `PlayerProvider`）。
 *
 * 造型是白色方块 + 一个圆形的物理体，走动用 WASD / 方向键。
 * **命中判定是圆的**：`Actor.applyCircleBody()` 那套偏移逻辑这里不需要，
 * 因为 Rectangle 形状的 body 天然居中。
 *
 * ---
 *
 * ## 无敌帧是**测试场自己**加的，不是产品语义
 *
 * 产品里的无敌帧、受击闪白、击退全归 D1。这里加一个 `grantGrace(ms)` 只是为了
 * 「一进场就被 8 只怪围死」时不至于没法观察 —— 它默认是关闭的。
 */

import Phaser from 'phaser'
import type { HitRequest, HitResult, TickTarget } from '@/core/actor/damage'
import type { PlayerView } from '@/domains/enemies/EnemySystem'
import { textureKeyFor } from '@/core/assets'

/** 从清单取，**不写 texture key**（见 AGENTS.md §六）。清单里那条就是为测试场准备的。 */
const PLAYER_ASSET_KEY = 'player_idle'

/** 移动的加减速（px/s²）。用瞬时速度会像在冰上飘，加一点平滑更像人操作 */
const ACCEL = 2400
const FRICTION = 2600

export interface DummyPlayerOptions {
  scene: Phaser.Scene
  x: number
  y: number
  radius: number
  maxHp: number
  speed: number
  /** 活动范围。**用世界尺寸而不是画布尺寸** —— 相机不跟随时两者恰好相等，
   *  但一旦有人给某个场子加了跟随相机，夹画布尺寸就会把玩家夹在一个假的范围里。 */
  worldWidth: number
  worldHeight: number
}

export class DummyPlayer implements TickTarget {
  readonly id = -1000
  readonly spawnSeq = 0

  alive = true
  hp: number
  readonly maxHp: number
  readonly radius: number

  /** 受击到什么时候为止免疫（测试场的观察用便利，默认 0 = 不免疫） */
  private graceUntilMs = 0
  /** 永久无敌开关（`I` 键）。和 `graceMs` 分开：一个是一次性的，一个是常驻的 */
  private invulnerable = false
  /** 上一次真的挨到的时刻，用来做受击闪白 */
  private lastHitAtMs = 0

  private readonly scene: Phaser.Scene
  private readonly sprite: Phaser.Physics.Arcade.Sprite
  /**
   * 物理体**抓一次**。
   *
   * `Sprite.body` 的类型是 `Body | StaticBody | null`（引擎不知道我们建的是哪种），
   * 而这里建的一定是动态 `Body`。在构造期窄化一次，比在十几个使用点上
   * 反复写 `!` 或 `as` 好：**窄化点只有一个，也就只有一处可能写错**。
   */
  private readonly body: Phaser.Physics.Arcade.Body
  private readonly speed: number
  private readonly worldWidth: number
  private readonly worldHeight: number
  /** 按键对象**抓一次**。`addKey` 对同一个 keyCode 是幂等的（源码已核实：
   *  `if (!keys[key]) keys[key] = new Key(...)`），不会每帧分配，但没必要每帧查一次表。 */
  private keys: Phaser.Input.Keyboard.Key[] | null = null
  private graceMs = 0
  private nowMs = 0
  private vx = 0
  private vy = 0

  /** 受伤次数与总伤害。HUD 会显示，用来肉眼确认「帧伤到底结了几次」 */
  hitCount = 0
  damageTaken = 0

  constructor(opts: DummyPlayerOptions) {
    this.scene = opts.scene
    this.radius = opts.radius
    this.maxHp = opts.maxHp
    this.hp = opts.maxHp
    this.speed = opts.speed
    this.worldWidth = opts.worldWidth
    this.worldHeight = opts.worldHeight

    this.sprite = opts.scene.physics.add.sprite(
      opts.x,
      opts.y,
      // 逻辑 key → 当前实际该用的 texture key。占位期拿到的是 `player_idle__placeholder`。
      textureKeyFor(opts.scene, PLAYER_ASSET_KEY),
    )
    this.sprite.setDepth(10)
    this.body = this.sprite.body as Phaser.Physics.Arcade.Body
    // 圆形物理体，居中。**必须**：Rectangle 之外的东西默认是矩形 body，
    // 而敌人贴脸接触判定用的是圆 —— 矩形 body 会让「擦着边过去」也算贴脸。
    this.body.setCircle(opts.radius, this.sprite.width / 2 - opts.radius, this.sprite.height / 2 - opts.radius)
    this.body.setMaxVelocity(this.speed * 2)
  }

  get x(): number {
    return this.sprite.x
  }

  get y(): number {
    return this.sprite.y
  }

  /** 给 `EnemySystem` 的 `PlayerProvider`。**每帧现算**，不要缓存旧的 */
  view(): PlayerView {
    return {
      model: this,
      x: this.sprite.x,
      y: this.sprite.y,
      vx: this.vx,
      vy: this.vy,
      radius: this.radius,
      alive: this.alive,
    }
  }

  /** 开一段无敌时间（测试场的观察便利，不是产品语义）。 */
  grantGrace(ms: number): void {
    this.graceUntilMs = this.nowMs + ms
  }

  /** 惰性抓一次按键对象。场景还没建好 `input` 时返回 null，此时不移动。 */
  private resolveKeys(): Phaser.Input.Keyboard.Key[] | null {
    if (this.keys) return this.keys
    const kb = this.scene.input.keyboard
    if (!kb) return null
    const C = Phaser.Input.Keyboard.KeyCodes
    this.keys = [
      kb.addKey(C.W),
      kb.addKey(C.A),
      kb.addKey(C.S),
      kb.addKey(C.D),
      kb.addKey(C.UP),
      kb.addKey(C.LEFT),
      kb.addKey(C.DOWN),
      kb.addKey(C.RIGHT),
    ]
    return this.keys
  }

  update(deltaMs: number, aimX: number, aimY: number): void {
    this.nowMs += deltaMs
    void aimX
    void aimY

    const keys = this.resolveKeys()
    let ax = 0
    let ay = 0
    if (keys) {
      // 顺序：WASD, 方向键 —— 上下左右各两个键，任一按下即生效
      const [kW, kA, kS, kD, kUp, kLeft, kDown, kRight] = keys
      const left = kA!.isDown || kLeft!.isDown
      const right = kD!.isDown || kRight!.isDown
      const up = kW!.isDown || kUp!.isDown
      const down = kS!.isDown || kDown!.isDown
      ax = (right ? 1 : 0) - (left ? 1 : 0)
      ay = (down ? 1 : 0) - (up ? 1 : 0)
    }

    const dt = deltaMs / 1000
    if (ax !== 0 || ay !== 0) {
      const inv = 1 / Math.hypot(ax, ay)
      this.vx += ax * inv * ACCEL * dt
      this.vy += ay * inv * ACCEL * dt
    } else {
      // 松手就减速。用「朝 0 收敛」而不是「减固定值」，否则低速时会来回抖
      const v = Math.hypot(this.vx, this.vy)
      if (v > 0) {
        const drop = Math.min(v, FRICTION * dt)
        this.vx -= (this.vx / v) * drop
        this.vy -= (this.vy / v) * drop
      }
    }

    const v = Math.hypot(this.vx, this.vy)
    if (v > this.speed) {
      this.vx = (this.vx / v) * this.speed
      this.vy = (this.vy / v) * this.speed
    }

    this.body.setVelocity(this.vx, this.vy)

    // 夹在场内。**只夹位置、不夹速度**：撞到边界时速度还在朝外，
    // 松手前会贴着墙「滑」，读起来就是「被墙挡住了」，比把速度清零更自然。
    const m = this.radius + 2
    if (this.sprite.x < m) this.sprite.x = m
    if (this.sprite.x > this.worldWidth - m) this.sprite.x = this.worldWidth - m
    if (this.sprite.y < m) this.sprite.y = m
    if (this.sprite.y > this.worldHeight - m) this.sprite.y = this.worldHeight - m

    // 受击染色：白 → 红，0.2 秒回白
    if (this.nowMs - this.lastHitAtMs < 200) {
      this.sprite.setTint(0xff6666)
    } else if (this.alive) {
      this.sprite.clearTint()
    }
    if (!this.alive) this.sprite.setTint(0x444444)
  }

  /**
   * 挨打。**这是伤害账本调进来的唯一入口**（`TickTarget` 的唯一方法）。
   *
   * 恒返回 `consumed: false`：玩家不会「吃掉」攻击源 ——
   * 子弹穿过玩家继续飞、挥砍继续存在，都由 D1 决定。测试场不参与那个判断。
   */
  takeHit(req: HitRequest): HitResult {
    if (!this.alive) return { applied: 0, killed: false, consumed: false }
    if (this.invulnerable) return { applied: 0, killed: false, consumed: false }
    if (this.nowMs < this.graceUntilMs) return { applied: 0, killed: false, consumed: false }

    this.hp = Math.max(0, this.hp - req.amount)
    this.hitCount++
    this.damageTaken += req.amount
    this.lastHitAtMs = this.nowMs
    if (this.hp <= 0) this.alive = false

    return { applied: req.amount, killed: this.hp <= 0, consumed: false }
  }

  /**
   * 无敌开关（`I` 键）。
   *
   * 为什么测试场需要它：**观察敌人的行为和「活下来」是矛盾的目标。**
   * 想看一只肉盾砸三次的节奏，就得站着不动挨三下 —— 而 200 血挨不了几下。
   * 有了它，「怪的逻辑对不对」和「怪的伤害调得对不对」可以分开看。
   */
  setInvulnerable(on: boolean): void {
    this.invulnerable = on
  }

  get isInvulnerable(): boolean {
    return this.invulnerable
  }

  /** 测试场的复位键用。 */
  revive(): void {
    this.alive = true
    this.hp = this.maxHp
    this.hitCount = 0
    this.damageTaken = 0
    this.graceUntilMs = this.nowMs + this.graceMs
    this.sprite.clearTint()
  }

  /** 复位后给一段无敌（`grantGrace` 的持久版本）。 */
  setReviveGrace(ms: number): void {
    this.graceMs = ms
  }

  destroy(): void {
    this.sprite.destroy()
  }
}