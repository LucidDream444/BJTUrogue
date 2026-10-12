/**
 * 实体逻辑基类 —— **玩家与敌人是同一种实体**，共用这一份。
 *
 * **零 Phaser 运行时依赖**，node 下可直接单测。
 *
 * ## 它故意不含 `x` / `y`
 *
 * 位置真值是 Arcade body，不是这里（见 `types.ts` 文件头）。把位置放在模型上，
 * 就等于开了第二套坐标系，早晚会和物理引擎对不上。模型只输出 `velIntent`，
 * 由 `Actor.syncFromBody()` 每步回读快照喂给 brain。
 *
 * ## 唯一的受击入口
 *
 * 所有伤害都走 `takeHit(req)`：D1 的武器打敌人、敌人接触打玩家、
 * 测试场的调试点击 —— 全部同一条路径、同一个 `HitResult` 形状。
 * **任何绕过它直接改 `hp` 的代码都会静默破坏账本的去重与配对语义**，
 * 而且不会有任何报错。`architecture.test.ts` 会扫描并阻止这种写法。
 *
 * ## 泛型 `S` 是为了不让 core 认识任何域的状态集合
 *
 * 如果这里写 `state: EnemyState | 'alive'`，`core/` 就得 import `domains/enemies/`——
 * **共用层反向依赖某个域**，那 D1 想扩展基类就得改 core，而 core 改动需全员同意。
 * 所以状态联合由各域自己定义：`EnemyModel extends ActorModel<EnemyState>`。
 */

import type { DamageSourceKind, HitRequest, HitResult, TickTarget } from './damage'
import type { ActorKind } from '../events'

export interface ActorStats {
  maxHp: number
  /** 基础移动速度，px/s */
  speed: number
  /** 碰撞半径（与贴图尺寸解耦） */
  radius: number
}

export interface DamageEventInfo {
  targetId: number
  amount: number
  hpAfter: number
  sourceId: number
  sourceKind: DamageSourceKind
  mode: 'instant' | 'tick'
  frameId: number
}

export interface KillEventInfo {
  targetId: number
  sourceId: number
  frameId: number
}

/**
 * 模型把「发生了什么」告诉外界的方式。
 *
 * 用**注入的 sink** 而不是直接 import 全局事件总线，有两个好处：
 * 单元测试里塞一个记录数组就能断言，不需要起总线；模型也不知道总线存在。
 * `EnemySystem` 负责把它接到 `core/events.ts` 的 `TypedBus` 上。
 */
export interface ActorEventSink {
  onDamaged(info: DamageEventInfo): void
  onKilled(info: KillEventInfo): void
}

let idCounter = 0

/**
 * 分配一个实体 id：**单调递增、永不复用**。
 *
 * 「永不复用」不是洁癖 —— 伤害账本以 `sourceId` 为键做去重与配对，
 * 一旦复用，池子回收的那把子弹的 tick 会算到新敌人头上。
 */
export function allocActorId(): number {
  return ++idCounter
}

/** 测试用：把计数器归零，让断言里能写死 id。 */
export function resetActorIdsForTest(): void {
  idCounter = 0
}

export class ActorModel<S extends string = string> implements TickTarget {
  readonly kind: ActorKind

  /** 本次 spawn 分配到的 id。**回池再 spawn 会换一个新的。** */
  id = 0
  stats: ActorStats
  hp = 0
  state: S
  alive = false
  /** 速度意图，px/s。由 brain 写入、由 `Actor.applyVelocityIntent()` 消费。 */
  velIntent = { x: 0, y: 0 }
  sink: ActorEventSink | null = null

  /** 账本用它校验「我还是不是当初那个实体」（不变式 ④）。 */
  get spawnSeq(): number {
    return this.id
  }

  get maxHp(): number {
    return this.stats.maxHp
  }

  constructor(kind: ActorKind, stats: ActorStats, initialState: S) {
    this.kind = kind
    this.stats = stats
    this.state = initialState
  }

  /**
   * 从池里取出并「出生」：分配新 id、回满血、恢复存活。
   * `x` / `y` 由调用方交给 `Actor.wake()` 设置到物理体上——模型不管位置。
   */
  spawn(stats: ActorStats, initialState: S): void {
    this.id = allocActorId()
    this.stats = stats
    this.hp = stats.maxHp
    this.state = initialState
    this.alive = true
    this.velIntent.x = 0
    this.velIntent.y = 0
  }

  /** 回池。**调用方必须同时 `ledger.releaseTarget(this)`**（不变式 ④）。 */
  despawn(): void {
    this.alive = false
    this.velIntent.x = 0
    this.velIntent.y = 0
  }

  /**
   * **唯一的受击入口。**
   *
   * 顺序很重要：先判死亡 → 再去重 → 再算减伤 → 再扣血 → 再通知。
   * 反过来的话，死亡后的重复命中会触发假的受击音效与飘字。
   */
  takeHit(req: HitRequest): HitResult {
    // 已经死了 / 正在死亡的过场里：不结算、也**不挡**攻击源。
    // 让子弹穿过去而不是被一具尸体吃掉，手感明显更好。
    if (!this.alive) return { applied: 0, killed: false, consumed: false }

    const consumed = this.blocksSource(req.sourceKind)

    // 同一 (frameId, hitKey) 只算一次。
    // 物理回调在持续重叠时**每个物理步都会触发**，这一步是防重复结算的第一道闸。
    if (this.isDuplicateHit(req)) return { applied: 0, killed: false, consumed }

    const amount = Math.max(0, this.modifyIncomingDamage(req.amount, req))
    const applied = Math.min(amount, this.hp)
    this.hp -= applied

    const killed = this.hp <= 0
    if (killed) this.hp = 0

    this.onDamageApplied(req, applied)
    this.sink?.onDamaged({
      targetId: this.id,
      amount: applied,
      hpAfter: this.hp,
      sourceId: req.sourceId,
      sourceKind: req.sourceKind,
      mode: req.mode,
      frameId: req.frameId,
    })

    if (killed) this.onKilled(req)

    return { applied, killed, consumed }
  }

  private hitFrameId = -1
  private readonly hitKeys = new Set<string>()

  /**
   * 同一 (frameId, hitKey) 只算一次。
   *
   * ⚠️ 换帧时**只清空，不提前 return**。写成「换帧 → 清空 → return false」的话，
   * 每一帧的**头一次**命中都不会把 key 记进去，于是同一帧里的第二次命中
   * 判不出重复 —— 去重实际上要等到第三次才生效。
   *
   * 为什么这会真的咬人：一帧内可能跑好几个物理步（掉帧时的补步循环），
   * 每个物理步都会跑一次碰撞回调。于是一发子弹的接触伤害在那一帧里被算两次，
   * 之后才被挡住。表现是「偶尔一次伤害翻倍」—— 频率取决于帧率，
   * 只在高负载或低配机上复现，最难查的那一类。
   */
  private isDuplicateHit(req: HitRequest): boolean {
    if (req.frameId !== this.hitFrameId) {
      this.hitFrameId = req.frameId
      this.hitKeys.clear()
    }
    if (this.hitKeys.has(req.hitKey)) return true
    this.hitKeys.add(req.hitKey)
    return false
  }

  // ---- 子类钩子 ----

  /**
   * **是否挡下这个攻击源**（决定 `HitResult.consumed`）。
   *
   * 默认全挡。**巨型肉盾怪返回 `false`（什么都不挡）** —— 子弹穿透、近战持续结算
   * 都是那个怪的身份，不是特例。D1 那边永远是同一句
   * `if (result.consumed) recycleBullet()`。
   */
  protected blocksSource(_kind: DamageSourceKind): boolean {
    return true
  }

  /** 减伤 / 易伤。肉盾的 `recover` 状态在这里乘 1.25。 */
  protected modifyIncomingDamage(amount: number, _req: HitRequest): number {
    return amount
  }

  /** 扣血之后、发事件之前。肉盾的「受击叠减速」挂在这里。 */
  protected onDamageApplied(_req: HitRequest, _applied: number): void {}

  /** 默认直接进入死亡；子类（分裂怪）要覆盖它来启动分裂链。 */
  protected onKilled(req: HitRequest): void {
    this.alive = false
    this.sink?.onKilled({ targetId: this.id, sourceId: req.sourceId, frameId: req.frameId })
  }
}