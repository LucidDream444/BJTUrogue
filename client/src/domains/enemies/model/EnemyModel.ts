/**
 * 敌人的逻辑模型。**零 Phaser 依赖**，node 下可直接单测。
 *
 * 继承 `ActorModel`（玩家与敌人共用的那份），只加敌人专有的状态：
 * 代际、生成宽限、受击硬直、减速叠层、前摇/恢复窗口、反卡死计时。
 *
 * ## 状态机是**一张联合类型 + 一个进入时刻**，不是一个状态机框架
 *
 * 项目明确不用状态机库（见《技术选型》）。约定：
 * - `state` 只能是 `EnemyState` 里的值；
 * - 每次切状态走 `setState()`，它顺便记下 `stateEnteredAtMs`；
 * - 判断「这个状态还要持续多久」一律用 `nowMs - stateEnteredAtMs` 与配置时长比，
 *   **不要在 model 上存「剩余时长」** —— 那样每帧都要减，暂停/顿帧时还会算错。
 *   存「进入时刻」就天然免疫暂停：逻辑时间停了，差值就不变。
 *
 * ## 配置怎么进到这里：`EnemySpec`
 *
 * 从 `DerivedSplitterGeneration` / `DerivedTank` 到 model 参数的映射**只有一处**
 * （`specFromSplitter` / `specFromTank`）。好处是回池复用时 `respawn(spec)` 会把
 * **所有**参数一起重写 —— 不会出现「上一只怪的减速参数留在池槽位里」这种串味。
 */

import { ActorModel, type ActorStats } from '@/core/actor/ActorModel'
import type { DamageSourceKind, HitRequest } from '@/core/actor/damage'
import type { EnemyKind } from '@/core/events'
import type { DerivedSplitterGeneration, DerivedTank, SplitterDef, TankDef } from '@/core/config'

export type EnemyState =
  /** 刚生成，生成宽限期内：会动但减速，且不打人 */
  | 'spawning'
  /** 正常追击 */
  | 'chase'
  /** 受击硬直：短暂停住，播放受击表现 */
  | 'flinch'
  /** 肉盾专用：下砸前摇，站定不动 —— 这是玩家唯一的「快跑」信号，必须看得见 */
  | 'windup'
  /** 肉盾专用：砸完的恢复窗，**受伤 ×1.25** —— 这是玩家的输出窗口 */
  | 'recover'
  /** 肉盾专用：叠满减速后的踉跄，速度地板到底 */
  | 'stagger'
  /** 分裂怪专用：死亡过场，等 `splitDelayMs` 后在原地分裂 */
  | 'splitting'
  | 'dead'

/** 一只怪「该长什么样」的全部参数。回池复用时整份重写，不做增量更新。 */
export interface EnemySpec {
  kind: EnemyKind
  gen: number
  stats: ActorStats
  /** 生成宽限时长（0 = 不宽限） */
  graceMs: number
  graceMoveMult: number
  /** 受击硬直时长（0 = 不硬直，肉盾就是 0） */
  flinchMs: number
  /** 减速：每次受击叠几层、最多几层、多久整批过期、每层乘多少、地板是多少 */
  slowPerHit: number
  slowMaxStacks: number
  slowDurationMs: number
  slowMultPerStack: number
  minSpeedMult: number
  /** 易伤窗口的倍数（肉盾 recover 期间） */
  vulnerableMult: number
}

export function specFromSplitter(g: DerivedSplitterGeneration, def: SplitterDef): EnemySpec {
  return {
    kind: 'splitter',
    gen: g.gen,
    stats: { maxHp: g.maxHp, speed: g.speed, radius: g.radius },
    graceMs: g.graceMs,
    graceMoveMult: g.graceMoveMult,
    flinchMs: def.ai.flinchMs,
    // 分裂怪不叠减速（它们是一枪一个的，叠了也看不出来）
    slowPerHit: 0,
    slowMaxStacks: 0,
    slowDurationMs: 0,
    slowMultPerStack: 1,
    minSpeedMult: 1,
    vulnerableMult: 1,
  }
}

export function specFromTank(t: DerivedTank, def: TankDef): EnemySpec {
  return {
    kind: 'tank',
    gen: 0,
    stats: { maxHp: t.maxHp, speed: t.speed, radius: t.radius },
    graceMs: 0,
    graceMoveMult: 1,
    flinchMs: def.ai.flinchMs,
    slowPerHit: def.hitSlow.stackPerHit,
    slowMaxStacks: def.hitSlow.maxStacks,
    slowDurationMs: def.hitSlow.stackDurationMs,
    slowMultPerStack: def.hitSlow.speedMultPerStack,
    minSpeedMult: def.hitSlow.minSpeedMult,
    vulnerableMult: def.slam.vulnerableDamageMult,
  }
}

export class EnemyModel extends ActorModel<EnemyState> {
  readonly enemyKind: EnemyKind

  /** 分裂怪的代际，0/1/2。肉盾恒为 0。 */
  gen = 0

  /** 基础速度（已含难度乘数）。**实际速度要再过 `speedMult()`**。 */
  baseSpeed = 0

  // ---- 从 spec 灌入的参数（回池时整份重写）----

  flinchMs = 0
  slowPerHit = 0
  slowMaxStacks = 0
  slowDurationMs = 0
  slowMultPerStack = 1
  /** 速度地板。肉盾的「越打越慢」靠它兜底 —— 没有地板就会罚站死，玩家白嫖反而不爽 */
  minSpeedMult = 1
  /** 易伤窗口倍数（肉盾 `recover` 期间） */
  vulnerableMult = 1
  graceMoveMult = 1

  // ---- 计时（全部是「逻辑时间戳」，不是「剩余时长」，见文件头）----

  stateEnteredAtMs = 0
  graceUntilMs = 0
  flinchUntilMs = 0
  /** 肉盾下砸的冷却结束时刻 */
  slamReadyAtMs = 0
  /** 踉跄的结束时刻 */
  staggerUntilMs = 0
  /**
   * 下一次踉跄的最早时刻。**必须和 `staggerUntilMs` 分开。**
   *
   * 只用一个 `staggerUntilMs` 会死循环：踉跄走完的那一 tick，
   * `nowMs >= staggerUntilMs` 又开始成立，而减速此时仍然叠满 ——
   * 于是怪立刻再次踉跄，永远走不动。它看起来不报错、不崩，
   * 只是「这只怪怎么站着不动」，非常难查。
   */
  staggerReadyAtMs = 0
  /** 撞墙/卡住的起始时刻；连续卡住才累积到触发反卡死 */
  stuckSinceMs = 0
  /** 反卡死的侧向逃逸结束时刻 */
  unstuckUntilMs = 0
  /** 侧向逃逸方向（+1 / -1）。进入逃逸时定一次，避免每帧翻来覆去地抖 */
  lateralSign = 1
  /** 分裂怪：该在什么时刻分裂 */
  splitAtMs = 0

  // ---- 减速叠层 ----

  weaponSlowMultiplier = 1
  weaponSlowUntilMs = 0
  slowStacks = 0
  /** 整批一起到期的时刻（Arcade 风格：不逐层独立计时） */
  slowExpireAtMs = 0
  lastDecayAtMs = 0

  /** 挨过多少次「真的掉血」的结算（含 tick）。HUD 与「持续输出」手感验证用。 */
  hitCount = 0

  constructor(kind: EnemyKind) {
    super('enemy', { maxHp: 1, speed: 1, radius: 1 }, 'chase')
    this.enemyKind = kind
  }

  /** 从池里取出并出生。`spec` 整份重写，**不会有上一只怪的残留参数**。 */
  respawn(spec: EnemySpec, nowMs: number): void {
    this.spawn(spec.stats, spec.graceMs > 0 ? 'spawning' : 'chase')

    this.gen = spec.gen
    this.baseSpeed = spec.stats.speed
    this.flinchMs = spec.flinchMs
    this.slowPerHit = spec.slowPerHit
    this.slowMaxStacks = spec.slowMaxStacks
    this.slowDurationMs = spec.slowDurationMs
    this.slowMultPerStack = spec.slowMultPerStack
    this.minSpeedMult = spec.minSpeedMult
    this.vulnerableMult = spec.vulnerableMult
    this.graceMoveMult = spec.graceMoveMult

    this.stateEnteredAtMs = nowMs
    this.graceUntilMs = spec.graceMs > 0 ? nowMs + spec.graceMs : 0
    this.flinchUntilMs = 0
    this.slamReadyAtMs = nowMs
    this.staggerUntilMs = 0
    this.staggerReadyAtMs = 0
    this.stuckSinceMs = 0
    this.unstuckUntilMs = 0
    this.lateralSign = 1
    this.splitAtMs = 0
    this.slowStacks = 0
    this.slowExpireAtMs = 0
    this.lastDecayAtMs = nowMs
    this.hitCount = 0
  }

  // ---- 状态 ----

  /** 切状态。**唯一该改 `state` 的地方。** 同一个状态重复调用是 no-op（不刷新进入时刻）。 */
  setState(next: EnemyState, nowMs: number): void {
    if (this.state === next) return
    this.state = next
    this.stateEnteredAtMs = nowMs
  }

  /** 当前状态已经持续了多久。逻辑时间停了它就不变，所以天然免疫暂停。 */
  stateAgeMs(nowMs: number): number {
    return nowMs - this.stateEnteredAtMs
  }

  inGrace(nowMs: number): boolean {
    return nowMs < this.graceUntilMs
  }

  // ---- 速度 ----

  /**
   * 当前速度倍数。**唯一的速度计算入口。**
   *
   * brain 只读这个值，不要自己再乘一遍 —— 否则调平衡时会有两个地方要改。
   */
  speedMult(nowMs: number): number {
    let m = 1
    if (this.inGrace(nowMs)) m *= this.graceMoveMult
    if (this.slowStacks > 0) {
      if (nowMs >= this.slowExpireAtMs) this.slowStacks = 0
      else m *= this.slowMult()
    }
    if (nowMs < this.weaponSlowUntilMs) m *= this.weaponSlowMultiplier
    // 前摇时钉在原地：这是「要砸了」的唯一信号，不能让它边走边蓄力
    if (this.state === 'windup') m = 0
    return m
  }

  /** 当前实际速度上限（px/s）。 */
  speedNow(nowMs: number): number {
    return this.baseSpeed * this.speedMult(nowMs)
  }

  /** 纯函数版减速倍数，不改任何状态。HUD 与测试用。 */
  slowMult(): number {
    return Math.max(this.minSpeedMult, Math.pow(this.slowMultPerStack, this.slowStacks))
  }

  // ---- 减速叠层 ----

  /**
   * 叠一层减速。**在 `onDamageApplied` 里调** —— 只有真的掉血才叠，
   * 被无敌帧/去重挡掉的命中不该让它变慢。
   */
  addSlowStack(nowMs: number): void {
    if (this.slowMaxStacks <= 0 || this.slowPerHit <= 0) return
    this.slowStacks = Math.min(this.slowMaxStacks, this.slowStacks + this.slowPerHit)
    this.slowExpireAtMs = nowMs + this.slowDurationMs
  }

  /**
   * 减速衰减。返回 true 表示这次掉了层。
   *
   * 必须按 `decayIntervalMs` 节流：逐帧衰减会让「叠层」在 30fps 和 144fps 下强度完全不同。
   * 掉帧时按「过了几个 interval」一次掉几层，但**不追赶超过当前层数**。
   */
  decaySlow(nowMs: number, intervalMs: number): boolean {
    if (this.slowStacks <= 0) return false

    if (nowMs >= this.slowExpireAtMs) {
      this.slowStacks = 0
      return true
    }

    const elapsed = nowMs - this.lastDecayAtMs
    if (elapsed < intervalMs) return false

    const steps = Math.floor(elapsed / intervalMs)
    this.lastDecayAtMs += steps * intervalMs
    const before = this.slowStacks
    this.slowStacks = Math.max(0, this.slowStacks - steps)
    return this.slowStacks !== before
  }

  // ---- ActorModel 钩子 ----

  /**
   * **肉盾什么都不挡**（`false` = 攻击源不被它消耗）。
   *
   * - 子弹：穿透。一整梭子打上去，子弹继续飞、它身上一路跳字 ——
   *   这是「持续输出的爽感」的物理基础。
   * - 近战：挥砍**不被它吃掉**，接触期间持续结算帧伤。
   *   如果这里对近战返回 `true`，而 D1 又恰好用 `consumed` 来结束一次挥砍，
   *   肉盾的近战帧伤就会静默退化成「一次挥砍只掉一下」——
   *   功能没了，但不报错，也不崩，只是不好玩了。
   *
   * ⚠️ 这不等于「无脑返回 false」。其他敌人必须返回 `true`，
   * 否则 D1 那句 `if (result.consumed) recycleBullet()` 永远不会回收子弹 ——
   * 子弹池会瞬间掏空，然后整个游戏一枪都打不出来。
   */
  protected override blocksSource(_kind: DamageSourceKind): boolean {
    return this.enemyKind !== 'tank'
  }

  /**
   * `blocksSource` 的**只读转出**。
   *
   * `EnemySystem` 有一条路径不经过 `takeHit()`：同一个源在同一只怪身上的
   * 「第二次及以后」的接触（肉盾穿透时每物理步都会来一次）。
   * 那条路径自己造 `HitResult`，但 `consumed` 必须和 `takeHit()` 的回答完全一致 ——
   * 不一致的话，穿透弹会在第二个物理步就被 D1 回收，帧伤只剩一下。
   *
   * 单独开一个 public 方法而不是把 `blocksSource` 改成 public：
   * 那个钩子**只该由基类的 `takeHit()` 调用**（它决定了整个 `consumed` 语义），
   * 放开成 public 就等于邀请别人到处调它，早晚会有人用它来做伤害判断。
   */
  blocksSourceForResult(kind: DamageSourceKind): boolean {
    return this.blocksSource(kind)
  }

  /**
   * 易伤窗口：肉盾砸完的 `recover` 期间受伤 ×1.25。
   *
   * 这是把「贪刀」变成有意义的选择：想打得快，就得贴着它、挑它砸完之后输出。
   */
  protected override modifyIncomingDamage(amount: number, _req: HitRequest): number {
    if (this.enemyKind === 'tank' && this.state === 'recover' && this.vulnerableMult !== 1) {
      return amount * this.vulnerableMult
    }
    return amount
  }

  protected override onDamageApplied(req: HitRequest, applied: number): void {
    if (applied <= 0) return // 被无敌帧或去重吃掉的命中：不掉血、不叠减速、不硬直
    this.hitCount++

    if (this.enemyKind === 'tank') {
      this.addSlowStack(req.nowMs)
      return
    }

    // 分裂怪：受击硬直。但**不打断正在进行的死亡过场** ——
    // 否则「打死 → 还没分裂 → 又被擦一下」会让整条分裂链消失，割草爽感直接没了。
    if (this.flinchMs > 0 && this.state !== 'splitting' && this.state !== 'dead') {
      this.flinchUntilMs = req.nowMs + this.flinchMs
    }
  }
}
