/**
 * 测试场的**调试枪**。**这不是武器系统**（武器归 D1，武器表也归 D1 起草）。
 *
 * 它存在的唯一理由是：肉盾与分裂怪的手感都要靠「打」才能验证，
 * 而 D1 的武器系统还没接上。所以这里是一个**最简的、够用的**开火器：
 *
 * - 左键按住连射：一发白方块，直线飞，`speed` 来自 `baseline.bullet.speed`；
 * - 右键按住挥砍：一个跟随玩家的圆形判定，接触期间按 `tickMs` 结算（持续源）；
 * - **肉盾穿透靠的是 `HitResult.consumed`**，这里没有任何 `if (enemy is tank)`。
 *
 * 最后一条是这个文件最重要的性质：它证明了「肉盾穿透 + 帧伤」
 * **不需要 D1 知道任何关于肉盾的事**。D1 的武器代码就应该是这个形状 ——
 *
 * ```ts
 * const r = enemies.bulletContact(shotId, enemy, impact, tickDamage, maxTicks)
 * if (r.consumed) recycleBullet(bullet)     // ← 永远只有这一句
 * ```
 *
 * ## ⚠️ `shotId` 必须单调递增、永不复用
 *
 * 它是 `ContactResolver.impactDone` 的键。复用 id 会让**上一发子弹的冲击记录**
 * 算到这一发头上 —— 表现是「子弹飞过某只怪时撞击伤害凭空消失」。
 * 所以这里用一个只增不减的计数器，子弹池复用时**分配新 id**，不复用旧的。
 *
 * ## ⚠️ 子弹回池必须调 `releaseBullet()`
 *
 * 漏掉的后果不是「伤害算错」，是两张表缓慢泄漏：
 * `impactDone` 的条目和账本里的 `(子弹, 怪)` 配对会一直留到 TTL 过期。
 * 一次连射几百发之后，长局游玩会慢慢吃内存 —— 而且**没有任何报错**。
 */

import Phaser from 'phaser'
import type { GameClock } from '@/core/time'
import type { EnemySystem } from '@/domains/enemies/EnemySystem'
import type { ArenaTune } from './ArenaBase'
import type { DummyPlayer } from './DummyPlayer'
import { textureKeyFor } from '@/core/assets'

/** 从清单取，**不写 texture key**。 */
const BULLET_ASSET_KEY = 'bullet_default'

/** 子弹存活上限（ms）。没有它，一发没打中的子弹会永远飞下去 */
const BULLET_TTL_MS = 2000
/** 子弹池容量。连射 250ms 一发、活 2 秒 → 同时最多 8 发；64 有充足余量 */
const BULLET_POOL = 64
/** 挥砍持续时间（ms）。持续源，靠 `meleeContact` 的 tick 结算 */
const SWING_MS = 180
/** 挥砍的视觉半径相对判定半径的放大倍数（看得见就行） */
const SWING_VISUAL_SCALE = 1.6

interface Bullet {
  sprite: Phaser.Physics.Arcade.Sprite
  /**
   * 物理体。`Sprite.body` 的静态类型是 `Body | StaticBody | null`，
   * 而这里一定是动态 `Body` —— 在池初始化的那一刻窄化一次，记在条目上。
   *
   * ⚠️ 这个引用在 `disableBody` / `enableBody` 之后**依然有效**：
   * `World.enableBody()` 是复用已有的 body 再 `world.add()`，不是新建一个。
   * （换成「每次开火重新 `add.sprite`」的写法，这个缓存就会失效 —— 别那么写。）
   */
  body: Phaser.Physics.Arcade.Body
  shotId: number
  bornAtMs: number
  active: boolean
}

export class DebugGun {
  /** 瞄准点（鼠标世界坐标）。假玩家用它决定朝向，场子也可以读 */
  aimX = 0
  aimY = 0

  private readonly scene: Phaser.Scene
  private readonly enemies: EnemySystem
  private readonly player: DummyPlayer
  private readonly tune: ArenaTune
  private readonly clock: GameClock

  private readonly bullets: Bullet[] = []
  private nextShotId = 1
  private nextSwingId = 1_000_000
  private swingId = 0
  private swingUntilMs = 0
  private swingCircle: Phaser.GameObjects.Arc | null = null
  private lastFireAtMs = -Infinity
  private firing = false
  private swinging = false

  /** 统计：打了几发、每发平均打出几次结算。HUD 显示 */
  shotsFired = 0
  contactsResolved = 0

  constructor(opts: {
    scene: Phaser.Scene
    enemies: EnemySystem
    player: DummyPlayer
    tune: ArenaTune
    clock: GameClock
  }) {
    this.scene = opts.scene
    this.enemies = opts.enemies
    this.player = opts.player
    this.tune = opts.tune
    this.clock = opts.clock
  }

  create(): void {
    this.aimX = this.player.x
    this.aimY = this.player.y

    for (let i = 0; i < BULLET_POOL; i++) {
      const sprite = this.scene.physics.add.sprite(
        0,
        0,
        textureKeyFor(this.scene, BULLET_ASSET_KEY),
      )
      sprite.setActive(false).setVisible(false).setDepth(20)
      const body = sprite.body as Phaser.Physics.Arcade.Body
      this.scene.physics.world.disableBody(body)
      this.bullets.push({ sprite, body, shotId: 0, bornAtMs: 0, active: false })
    }

    // 挥砍的视觉：一个半透明圆。**纯装饰**，真正的判定是 `meleeContact`。
    this.swingCircle = this.scene.add
      .circle(0, 0, this.tune.meleeRange * SWING_VISUAL_SCALE, 0x66ccff, 0.18)
      .setStrokeStyle(2, 0x88ddff, 0.5)
      .setDepth(15)
      .setVisible(false)

    this.scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this)
    this.scene.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this)

    // 子弹 × 敌人：**唯一的碰撞接线**。
    // 注意用 `enemies.group` —— 停放的怪还在组里，但 body 已停用，
    // `collideSpriteVsGroup` 的两条路径都会跳过它（源码已核实）。
    this.scene.physics.add.overlap(
      this.bullets.map((b) => b.sprite),
      this.enemies.group,
      (a, b) => this.onBulletHit(a as Phaser.GameObjects.GameObject, b as Phaser.GameObjects.GameObject),
    )
  }

  shutdown(): void {
    this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this)
    this.scene.input.off(Phaser.Input.Events.POINTER_UP, this.onUp, this)
    for (const b of this.bullets) {
      if (b.active) {
        this.enemies.releaseBullet(b.shotId)
        b.active = false
      }
      b.sprite.destroy()
    }
    this.bullets.length = 0
    if (this.swingId !== 0) {
      this.enemies.releaseMelee(this.swingId)
      this.swingId = 0
    }
    this.swingCircle?.destroy()
    this.swingCircle = null
  }

  update(): void {
    const pointer = this.scene.input.activePointer
    // 用 `pointer.x/y` + 相机滚动，而不是 `pointer.worldX`：
    // 后者只在指针**移动过**之后才更新，鼠标静止时读到的是上一次的位置。
    const cam = this.scene.cameras.main
    this.aimX = pointer.x + cam.scrollX
    this.aimY = pointer.y + cam.scrollY

    const nowMs = this.clock.realNowMs

    // ---- 开火 ----
    if (this.firing && nowMs - this.lastFireAtMs >= this.tune.fireIntervalMs) {
      this.lastFireAtMs = nowMs
      this.fire()
    }

    // ---- 子弹存活与回收 ----
    for (const b of this.bullets) {
      if (!b.active) continue
      if (nowMs - b.bornAtMs > BULLET_TTL_MS) this.recycle(b)
    }

    // ---- 挥砍 ----
    if (this.swinging) {
      if (this.swingExpired(nowMs)) this.endSwing()
      else this.applySwing()
    }
    if (this.swingCircle) this.swingCircle.setPosition(this.player.x, this.player.y)
  }

  /** 当前有没有在挥砍（HUD 用） */
  get swingActive(): boolean {
    return this.swinging
  }

  // ------------------------------------------------------------ 内部

  private swingExpired(nowMs: number): boolean {
    return this.swingUntilMs > 0 && nowMs >= this.swingUntilMs
  }

  private onDown(pointer: Phaser.Input.Pointer): void {
    if (pointer.leftButtonDown()) {
      this.firing = true
      // 立刻来一发，不等 250ms 的间隔 —— 点一下要能立刻看到反应
      this.lastFireAtMs = -Infinity
    }
    if (pointer.rightButtonDown()) this.startSwing()
  }

  private onUp(pointer: Phaser.Input.Pointer): void {
    if (pointer.leftButtonReleased()) this.firing = false
    if (pointer.rightButtonReleased()) this.swinging = false
  }

  private fire(): void {
    const b = this.bullets.find((x) => !x.active)
    if (!b) return

    const angle = Math.atan2(this.aimY - this.player.y, this.aimX - this.player.x)
    b.active = true
    // **每发新 id**，绝不复用（见文件头）。子弹池复用槽位，但 shotId 不复用。
    b.shotId = this.nextShotId++
    b.bornAtMs = this.clock.realNowMs

    b.sprite.setActive(true).setVisible(true).setPosition(this.player.x, this.player.y)
    this.scene.physics.world.enableBody(b.sprite, Phaser.Physics.Arcade.DYNAMIC_BODY)
    b.body.setCircle(
      this.tune.bulletRadius,
      b.sprite.width / 2 - this.tune.bulletRadius,
      b.sprite.height / 2 - this.tune.bulletRadius,
    )
    b.body.setVelocity(
      Math.cos(angle) * this.tune.bulletSpeed,
      Math.sin(angle) * this.tune.bulletSpeed,
    )
    this.shotsFired++
  }

  private recycle(b: Bullet): void {
    if (!b.active) return
    b.active = false
    // ⚠️ 一定要 release：不调的话 impactDone 与账本配对会缓慢泄漏（见文件头）
    this.enemies.releaseBullet(b.shotId)
    b.shotId = 0
    b.sprite.setActive(false).setVisible(false)
    b.body.stop()
    this.scene.physics.world.disableBody(b.body)
  }

  private onBulletHit(
    bulletGO: Phaser.GameObjects.GameObject,
    enemyGO: Phaser.GameObjects.GameObject,
  ): void {
    const b = this.bullets.find((x) => x.sprite === bulletGO && x.active)
    if (!b) return

    // ⚠️ **这里没有任何 `if (enemy is tank)`。** 肉盾穿透完全由 `consumed` 表达：
    // 普通敌人返回 true（挡下子弹），肉盾返回 false（子弹继续飞，overlap 继续响，
    // 每 100ms 结算一次帧伤）。D1 的武器代码也只该有这么一句判断。
    const result = this.enemies.bulletContact(
      b.shotId,
      enemyGO,
      this.tune.bulletDamage,
      this.tune.tankPierceTickDamage,
      this.tune.tankBulletMaxTicks,
    )
    this.contactsResolved++
    if (result.consumed) this.recycle(b)
  }

  private startSwing(): void {
    if (this.swinging) return
    this.swinging = true
    this.swingId = this.nextSwingId++
    this.swingUntilMs = this.clock.realNowMs + SWING_MS
    this.swingCircle?.setVisible(true)
  }

  private endSwing(): void {
    this.swinging = false
    this.swingUntilMs = 0
    this.swingCircle?.setVisible(false)
    if (this.swingId !== 0) {
      // 挥砍是一个持续存在的源，结束时要显式释放 —— 否则账本里那条配对会留到 TTL
      this.enemies.releaseMelee(this.swingId)
      this.swingId = 0
    }
  }

  /**
   * 这一帧，挥砍碰到了谁。
   *
   * 这里是**手写的圆 vs 圆**，没有用 Arcade 的 overlap —— 因为挥砍的判定半径
   * 与玩家的物理体无关（它是「武器范围」，不是「玩家身体」），
   * 而 Arcade 只能对已有的 body 做判定。手写一遍反而更短、更清楚。
   *
   * **每个接触的怪每帧调一次 `meleeContact`**：这就是「帧伤」的接触侧。
   * 结算节拍由账本按 `tickMs` 管，所以这里每帧调是**正确**的，不是重复结算。
   */
  private applySwing(): void {
    const range = this.tune.meleeRange
    for (const entry of this.enemies.liveEnemies) {
      const dx = entry.view.x - this.player.x
      const dy = entry.view.y - this.player.y
      const reach = range + entry.model.stats.radius
      if (dx * dx + dy * dy > reach * reach) continue

      this.enemies.meleeContact(
        this.swingId,
        entry.view,
        this.tune.meleeDamage,
        this.tune.meleeDamage,
        this.tune.tankBulletMaxTicks,
      )
    }
  }

  /** 场子可以调它做「自动开火」，省得手动按。参数是朝向（弧度） */
  autoFireToward(angleRad: number): void {
    const b = this.bullets.find((x) => !x.active)
    if (!b) return
    const nowMs = this.clock.realNowMs
    if (nowMs - this.lastFireAtMs < this.tune.fireIntervalMs) return
    this.lastFireAtMs = nowMs
    this.aimX = this.player.x + Math.cos(angleRad) * 100
    this.aimY = this.player.y + Math.sin(angleRad) * 100
    // `fire()` 用的是同一个「上一发时刻」闸门，所以自动开火不会比手动快
    this.fire()
  }
}