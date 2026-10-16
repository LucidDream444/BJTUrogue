/**
 * 抓取怪（grabber）的 brain。**零 Phaser 依赖**，node 下可直接单测。
 *
 * ## 循环
 *
 * ```
 *   chase ──(距离 ≤ grabRange 且自身冷却+同类冷却都好了)──→ windup（站定 · 头顶「!」）
 *     ↑                                                        │
 *     │                        ┌─── 玩家跑出范围 / 目标没了 ─────┤
 *     │                        │                              │ telegraphMs 到点
 *     │                        └──────────────────────────────┤
 *     └────────────────────────────────────────────── 报 attack: grab
 *                        （抓取序列由系统接管，见 EnemySystem）
 * ```
 *
 * 三个设计意图，改数值前先读一遍：
 *
 * 1. **预警期站定不动。** 「!」是玩家识别「要被抓了」的唯一信号 ——
 *    如果它还能边走边预警，玩家就永远躲不掉，那不是难度是耍赖。
 *    （这条复用 `speedMult()` 在 windup 时返回 0 的既有语义，和肉盾的下砸同一套。）
 * 2. **预警必须能被取消。** 只有两条取消路径：玩家跑出范围、它被打死。
 *    ⚠️ 所以它的 `flinchMs` 固定 0 —— 被擦一下就把预警打断的话，
 *    「!」会变成说谎的信号，玩家学到的就是错的东西（见 `enemies.json` 的 `_design`）。
 * 3. **同类冷却挡的是「起手」，不是「抓取」。** 冷却期间它照常追人、只是不起手、也不显示「!」——
 *    挡抓取会造出「冒了 ! 、站了两秒、然后什么都不发生」，玩家只会以为游戏卡了。
 *    这个冷却**不属于它自己**（所有同类共享），所以从外面读进来。
 */

import type { Brain, BrainAttack, BrainContext, BrainOutput } from '@/core/actor/types'
import type { EnemyModel } from '../model/EnemyModel'
import { scratchIntent, steer } from './steering'

export interface GrabberBrainParams {
  /** 分离力强度（px/s） */
  sepStrength: number
  /** 分离判定余量（px） */
  sepPad: number
  /** 起手距离：进这个圈就站定、冒「!」 */
  grabRange: number
  /** 「!」窗口时长 */
  telegraphMs: number
  /** 自身冷却（从进入预警那一刻起算，照肉盾的 slam） */
  cooldownMs: number
  /**
   * **解除蓄力的距离倍数**：玩家跑到 `grabRange × 这个数` 之外才算跑掉。
   * 大于 1 的迟滞量是必须的 —— 贴着一个固定距离反复进出会让蓄力一开一关地抖，
   * 而每次进入蓄力都会写一次冷却，于是一个在边界上蹭的玩家能把它永久锁住。
   */
  releaseRangeMult: number
  /**
   * **同类冷却**的最早可起手时刻（逻辑时间，毫秒）。
   *
   * 它由系统持有（所有 grabber 共享一份），brain 只读 —— 写成读函数而不是值，
   * 是因为值会在 brain 建好之后被系统改（闭包抓的是快照就会永远用旧值）。
   */
  sameTypeReadyAtMs: () => number
}

export function makeGrabberBrain(model: EnemyModel, params: GrabberBrainParams): Brain {
  const out: BrainOutput = { vx: 0, vy: 0 }
  // 抓取本身不结算伤害（咬人是系统按节拍来的）；`radius` 只是把「起手距离」带给系统，
  // ⚠️ **系统接到这个攻击时不要再重新量一次距离** —— 和肉盾的下砸相反：
  //    下砸的前摇是「跑得掉」，而这个抓取**到点就锁死、必定扑中**。
  //    躲的窗口是那 2 秒预警本身（预警期跑出范围会取消），到了这一帧就没有第二次判定 ——
  //    否则「我明明跑到边上了」会在最后一帧被翻盘，玩家学不到任何确定的规则。
  const attack: BrainAttack = { kind: 'grab', radius: params.grabRange, damage: 0 }

  return function grabberBrain(ctx: BrainContext): BrainOutput {
    const { nowMs, self, target } = ctx
    out.attack = undefined
    out.nextState = model.state

    if (!self.alive || model.state === 'dead' || model.state === 'splitting') {
      out.vx = 0
      out.vy = 0
      return out
    }

    // ---- 被抓/被甩飞：这两段由系统接管 ----
    //
    // ⚠️ 甩飞那一段**必须把飞行速度原样喂出去**：`applyVelocityIntent()` 是全项目
    //    唯一的速度写入点，这里输出 0 等于给飞行急刹（尸体飞到一半停住）。
    if (model.state === 'flung') {
      out.vx = model.flingVx
      out.vy = model.flingVy
      return out
    }
    // 抓取期间世界是冻结的、AI 根本不跑，这条只是解冻后的兜底
    if (model.state === 'grabbing') {
      out.vx = 0
      out.vy = 0
      out.nextState = 'chase'
      return out
    }

    // ---- 预警：站定，两条取消路径 ----
    if (model.state === 'windup') {
      // ⚠️ 解除用的是**放大过的**距离（迟滞）：贴着一个固定值反复进出会让蓄力
      //    一开一关地抖，而每次进入蓄力都写一次冷却 —— 边界上蹭的玩家能把它锁死。
      const stillInRange =
        target?.alive === true &&
        Math.hypot(target.x - self.x, target.y - self.y) <=
          params.grabRange * params.releaseRangeMult
      if (!stillInRange) {
        out.vx = 0
        out.vy = 0
        out.nextState = 'chase'
        return out
      }
      if (model.stateAgeMs(nowMs) < params.telegraphMs) {
        // **蓄力期间照常朝玩家挪**（速度被 `speedMult` 按模板折过，抓取怪是半速）。
        // 这里以前写的是「站定不动」——那是抄肉盾的下砸。实测的后果是：
        // 它一蓄力就杵在原地，而玩家 200+ px/s 一走就没影，**抓取永远触发不了**。
        const v = steer(
          self,
          target,
          ctx,
          model.speedNow(nowMs),
          params.sepPad,
          params.sepStrength,
          scratchIntent,
        )
        out.vx = v.x
        out.vy = v.y
        return out
      }
      // 到点：报抓取。**接不接受由系统决定**（同一时刻只能有一只抓取），
      // 所以这里不自己切到 grabbing —— 状态由系统在接管时设置。
      out.vx = 0
      out.vy = 0
      out.attack = attack
      out.nextState = 'chase'
      return out
    }

    // ---- 起手判据：距离 + 自身冷却 + 同类冷却 ----
    const distance = target ? Math.hypot(target.x - self.x, target.y - self.y) : Infinity
    if (
      target?.alive === true &&
      distance <= params.grabRange &&
      nowMs >= model.slamReadyAtMs &&
      nowMs >= params.sameTypeReadyAtMs()
    ) {
      // 冷却从**现在**起算（进入预警的这一刻），不是抓完才起算 —— 照肉盾的第 3 条：
      // 否则「冷却 + 前摇」实际周期会等于两者之和，调参时被这个差值误导。
      model.slamReadyAtMs = nowMs + params.cooldownMs
      // 起手这一帧也照常挪 —— 输出 0 会让它每 3 秒抽一下（一帧的急停）
      steer(self, target, ctx, model.speedNow(nowMs), params.sepPad, params.sepStrength, scratchIntent)
      out.vx = scratchIntent.x
      out.vy = scratchIntent.y
      out.nextState = 'windup'
      return out
    }

    // ---- 追击 ----
    const speed = model.speedNow(nowMs)
    const v = steer(self, target, ctx, speed, params.sepPad, params.sepStrength, scratchIntent)
    out.vx = v.x
    out.vy = v.y
    out.nextState = 'chase'
    return out
  }
}
