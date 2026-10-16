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
import type {
  DerivedGrabber,
  DerivedSplitterGeneration,
  DerivedTank,
  GrabberDef,
  SplitterDef,
  TankDef,
} from '@/core/config'

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
  /** 抓取怪专用：已经抓住玩家（吸附状态）。**这段时间世界是冻结的**，它不做任何自主行动 */
  | 'grabbing'
  /**
   * 抓取怪专用：被挣脱时甩出去，正在飞。
   *
   * ⚠️ **飞行期间它是活的**（刻意保留 1 点血）—— 死了的实体在 D3 会被立刻 park、
   * 位置冻住，尸体飞不起来。落地那一刻才走死亡流程。
   */
  | 'flung'
  | 'dead'

/** 一只怪「该长什么样」的全部参数。回池复用时整份重写，不做增量更新。 */
export interface EnemySpec {
  kind: EnemyKind
  gen: number
  stats: ActorStats
  /**
   * **子弹不穿过我**（攻击源被我消耗）。
   *
   * 默认 `false`：**肉盾（蘑菇怪）是穿透的**，那是它的身份。
   * `true` 只给首领 —— 首领和肉盾是同一个 `enemyKind`（`requestBoss()` 走
   * `specFor('tank', 0)`，因为怪物模板太少），只判 `kind` 的话首领也会被
   * 穿透 + 按 100ms 一帧的帧伤融掉：一个 520 血的终焉蛛王几秒就没了。
   * 「允许穿透」是**普通蘑菇怪**这个身份的特性，不是 `tank` 这个模板的特性。
   *
   * ⚠️ 它必须在 `spec` 里、由 `respawn()` 整份重写，**不能做成一个
   * 「出生时记得推一下」的开关**：模型是池化复用的，上一只首领用过的那只
   * 下一秒就会变成普通蘑菇怪，漏推一次就是「这只蘑菇免疫穿透」——
   * 不报错、也不崩，只是玩家怎么打都打不动它。
   */
  pierceImmune: boolean
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
  /**
   * **前摇期间的移动速度倍数**。0 = 钉在原地（肉盾的下砸：那是它唯一的可读信号），
   * 0.5 上下 = 蓄力期间仍然慢慢逼过来（抓取怪：站定会让它永远抓不到人）。
   */
  windupMoveMult: number
}

export function specFromSplitter(g: DerivedSplitterGeneration, def: SplitterDef): EnemySpec {
  return {
    kind: 'splitter',
    gen: g.gen,
    stats: { maxHp: g.maxHp, speed: g.speed, radius: g.radius },
    pierceImmune: false,
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
    windupMoveMult: 0,
  }
}

/**
 * 抓取怪的 spec。
 *
 * 它**不叠减速、没有易伤窗口** —— 它的强弱只由「抓没抓到」决定，
 * 再把「越打越慢」叠上去会让「打死它 = 取消抓取」这条反制变得太容易。
 */
export function specFromGrabber(g: DerivedGrabber, def: GrabberDef): EnemySpec {
  return {
    kind: 'grabber',
    gen: 0,
    stats: { maxHp: g.maxHp, speed: g.speed, radius: g.radius },
    pierceImmune: false,
    graceMs: 0,
    graceMoveMult: 1,
    // ⚠️ 硬直固定 0：预警**不能被擦伤打断**，否则「!」就成了说谎的信号
    //（取消只有「跑开」和「被打死」两条，见 enemies.json 的 _design）
    flinchMs: 0,
    slowPerHit: 0,
    slowMaxStacks: 0,
    slowDurationMs: 0,
    slowMultPerStack: 1,
    minSpeedMult: 1,
    vulnerableMult: 1,
    windupMoveMult: def.grab.windupMoveMult,
  }
}

export function specFromTank(t: DerivedTank, def: TankDef): EnemySpec {
  return {
    kind: 'tank',
    gen: 0,
    stats: { maxHp: t.maxHp, speed: t.speed, radius: t.radius },
    // 普通蘑菇怪：子弹穿过去。首领走 `EnemySystem.requestBoss()`，在那里改成 true
    pierceImmune: false,
    graceMs: 0,
    graceMoveMult: 1,
    flinchMs: def.ai.flinchMs,
    slowPerHit: def.hitSlow.stackPerHit,
    slowMaxStacks: def.hitSlow.maxStacks,
    slowDurationMs: def.hitSlow.stackDurationMs,
    slowMultPerStack: def.hitSlow.speedMultPerStack,
    minSpeedMult: def.hitSlow.minSpeedMult,
    vulnerableMult: def.slam.vulnerableDamageMult,
    // 肉盾**前摇钉在原地**：那是「要砸了」的唯一信号（它很慢，边走边蓄力玩家就永远躲不掉）
    windupMoveMult: 0,
  }
}

export class EnemyModel extends ActorModel<EnemyState> {
  readonly enemyKind: EnemyKind
  /** 从 spec 灌入：子弹不穿过我。见 `EnemySpec.pierceImmune` */
  pierceImmune = false

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
  /** 前摇期间的移动速度倍数（见 `EnemySpec.windupMoveMult`） */
  windupMoveMult = 0
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

  /**
   * 抓取怪被甩出去时的**飞行速度**（px/s）。由系统在挣脱那一刻写好，brain 在 `flung`
   * 状态里原样喂给唯一的速度写入点（`Actor.applyVelocityIntent()`）。
   *
   * ⚠️ **不能靠「系统直接给物理体设一次速度」**：意图每步都会覆盖物理体的速度，
   * 设一次等于下一帧就被抹掉。飞行是**意图**，不是一次性的冲量。
   */
  flingVx = 0
  flingVy = 0

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
    this.pierceImmune = spec.pierceImmune
    this.flinchMs = spec.flinchMs
    this.slowPerHit = spec.slowPerHit
    this.slowMaxStacks = spec.slowMaxStacks
    this.slowDurationMs = spec.slowDurationMs
    this.slowMultPerStack = spec.slowMultPerStack
    this.minSpeedMult = spec.minSpeedMult
    this.vulnerableMult = spec.vulnerableMult
    this.windupMoveMult = spec.windupMoveMult
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
    this.flingVx = 0
    this.flingVy = 0
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
    // 前摇期间的速度倍数**按模板给**：肉盾是 0（「要砸了」的唯一信号，不能边走边蓄力），
    // 抓取怪是 0.5 上下（它是一路逼过来的 —— 站定会让它永远抓不到人）
    if (this.state === 'windup') m *= this.windupMoveMult
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

  /**
   * **落地死亡。**
   *
   * ⚠️ **必须绕过 `takeHit` 那条路**：飞行的整段（`flung`）对外来伤害是免疫的
   * （它只剩 1 血，而玩家此刻正握着枪），但落地的击杀用的也是同一条通路 ——
   * 走 `takeHit` 会被那条免伤**一起挡掉**，后果是它带着 1 血永远飞下去：
   * 飞行的收尾已经清空、没有任何东西会结束它，而且它免疫一切伤害。
   * 这个洞是实测抓出来的（无头驱动：`hp:1, state:'flung'` 一直不变、爆炸计数恒 0）。
   *
   * 走 `onKilled` 就等于走完整条死亡流程（回池、`entity_killed`、表现）——
   * 和被打死的死法**没有区别**，只是没人能拦。
   */
  dieOnLanding(nowMs: number): void {
    if (!this.alive) return
    this.hp = 0
    this.onKilled({
      sourceId: this.id,
      hitKey: 'grab-landing',
      mode: 'instant',
      amount: 0,
      frameId: 0,
      nowMs,
      sourceKind: 'aoe',
    })
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
    // ⚠️ **首领不吃穿透**，哪怕它用的是肉盾模板（见 `EnemySpec.pierceImmune`）。
    if (this.pierceImmune) return true
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
    // ⚠️ **被甩飞的这段路上免疫一切伤害。** 挣脱那一刻它只剩 1 血（故意的：
    //    死了的实体会被立刻 park、尸体飞不起来），而玩家此刻正握着枪在连点 ——
    //    顺手一梭子就能在半空中把它打死，于是「落地才死 → 落地爆炸」这条链
    //    **静默消失**（实测：玩家看到爆炸的圈，场里其它敌人一点血没掉）。
    //    这 400ms 的免疫换来的是「挣脱一定有回报」。
    if (this.state === 'flung') return 0
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
