/**
 * 把「子弹 / 近战碰到了怪」翻译成伤害。**零 Phaser 依赖**，node 下可直接单测。
 *
 * ## 它为什么单独存在
 *
 * 这段逻辑只有 20 行，但它守着一个**只在高负载机器上才复现**的 bug，
 * 而 `EnemySystem` 本身是 Phaser 的接线层、node 测不了。所以把它抠出来：
 * 一个 `DamageLedger` + 一个读 `nowMs/frameId` 的钟，就能把整套语义锁死在测试里。
 *
 * ## 规则
 *
 * | 接触的第几次 | 冲击伤害 | tick 伤害 | `consumed` |
 * |---|---|---|---|
 * | 第一次 | 算（`amount = impactDamage`） | 登记，之后按 `tickMs` 结算 | 怪自己回答 |
 * | 第二次及以后 | **不算** | 登记（刷新接触时刻） | 怪自己回答 |
 *
 * ## ⚠️ 为什么「第二次以后不算冲击」必须显式挡着
 *
 * Arcade 的 overlap 回调**没有 enter/stay/exit 语义**：持续重叠时每个物理步都触发。
 * 普通敌人碰一次就被 `consumed: true` 收走了子弹，所以永远不会来第二次 ——
 * 这个 bug 一直藏着。**肉盾是穿透的**（`consumed: false`），子弹留在它身体里，
 * 于是每一个物理步都来一次回调。
 *
 * 不挡的话：一发子弹的冲击伤害会按物理步数翻倍。而物理步数在掉帧时会变多
 * （`World.update` 的补步循环）—— 表现是「卡的时候反而打得更疼」，
 * 帧率越高伤害越低，在开发机上永远复现不出来。
 *
 * ## ⚠️ 为什么 `consumed` 在「第二次以后」也要如实回答
 *
 * 顺手写成 `consumed: true`（「反正这次什么都没发生」）是最自然的错误。
 * 后果是穿透弹在**第二个物理步**就被 D1 回收，帧伤只剩一下 ——
 * 肉盾的核心手感（一整梭子打上去一路跳字）直接没了，而且不报错。
 * `consumed` 回答的是「这个源该不该被销毁」，不是「这一次有没有打中」。
 */

import type { DamageLedger, DamageSourceKind, HitResult } from '@/core/actor/damage'
import type { EnemyModel } from '../model/EnemyModel'

/** 只要求两个读数，`GameClock` 天然满足 —— 本文件因此不需要认识 Phaser。 */
export interface ContactClock {
  readonly nowMs: number
  readonly frameId: number
}

export class ContactResolver {
  /**
   * 已经结算过「冲击那一发」的 (源, 怪) 对。
   *
   * 真正的去重（同一帧同一 hitKey 只算一次）在 `ActorModel.isDuplicateHit` 里，
   * 那是**帧内**的闸门；这一张是**跨帧**的 —— 它回答的是
   * 「这发子弹是不是早就撞过这只怪了」，与帧号无关。
   * 两个都要有，作用域不同。
   */
  private readonly impactDone = new Map<number, Set<number>>()

  constructor(
    private readonly ledger: DamageLedger,
    private readonly clock: ContactClock,
  ) {}

  /** 调试 / HUD 用：还在跟踪多少个攻击源。漏调 `release()` 时它会一直涨 */
  get trackedSources(): number {
    return this.impactDone.size
  }

  isImpactDone(sourceId: number, targetId: number): boolean {
    return this.impactDone.get(sourceId)?.has(targetId) ?? false
  }

  /**
   * @param sourceId 子弹的 `shotId` / 挥砍的 `swingId`。**必须单调递增、永不复用**，
   *                 否则上一发子弹的冲击记录会算到这一发头上。
   * @param impactDamage 冲击那一发的伤害
   * @param tickDamage 接触期间每 tick 的伤害（0 = 只要冲击，不要帧伤）
   * @param maxTicks 同一个源最多结算几次 tick
   */
  contact(
    sourceId: number,
    model: EnemyModel,
    kind: DamageSourceKind,
    impactDamage: number,
    tickDamage: number,
    maxTicks: number,
  ): HitResult {
    if (!model.alive) {
      // 打在一具已死 / 正在分裂的尸体上。
      // 返回 `consumed: true` 让子弹**回池** —— 否则流弹会穿过尸体继续飞，
      // 玩家看到的是「子弹打中了却什么都没发生」，而子弹池会被慢慢掏空。
      return { applied: 0, killed: false, consumed: true }
    }

    const nowMs = this.clock.nowMs
    const frameId = this.clock.frameId

    let seen = this.impactDone.get(sourceId)
    if (!seen) {
      seen = new Set()
      this.impactDone.set(sourceId, seen)
    }

    let result: HitResult
    if (seen.has(model.id)) {
      result = { applied: 0, killed: false, consumed: model.blocksSourceForResult(kind) }
    } else {
      seen.add(model.id)
      result = model.takeHit({
        sourceId,
        hitKey: `${kind}:${sourceId}`,
        mode: 'instant',
        amount: impactDamage,
        frameId,
        nowMs,
        sourceKind: kind,
      })
    }

    // 每次接触都登记 tick —— 包括「冲击已经算过」的那些，
    // 那正是穿透弹持续结算帧伤的方式。结算节拍由账本按 tickMs 管，
    // 接触一断就靠 ttlMs 自动清理，不需要在这里判「是不是离开了」。
    if (model.alive && tickDamage > 0) {
      this.ledger.touch(
        sourceId,
        model,
        { sourceKind: kind, amountPerTick: tickDamage, maxTicks },
        nowMs,
      )
    }

    return result
  }

  /** 攻击源被回收（子弹进池、挥砍结束）时调。**漏调只涨内存，不算错伤害**（敌人 id 不复用）。 */
  release(sourceId: number): void {
    this.ledger.releaseSource(sourceId)
    this.impactDone.delete(sourceId)
  }

  /** 换局 / 场景 shutdown。 */
  clear(): void {
    this.impactDone.clear()
  }
}