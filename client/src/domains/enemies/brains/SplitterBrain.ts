/**
 * 分裂怪的 brain。**零 Phaser 依赖**，node 下可直接单测。
 *
 * 设计目标只有一句话：**让玩家打群怪割草**。所以它的行为刻意做得很简单 ——
 * 直着冲过来、被打了顿一下、然后死。所有「聪明」的地方都在别处：
 * 分裂链的节奏（`EnemySystem` + 配置）、受击反馈的音高递增（`JuiceDirector`）。
 *
 * ## brain 是**只读**的：读 model，返回意图，自己不写任何东西
 *
 * `core/actor/types.ts` 已经把 brain 定义成纯函数（「给一份上下文，出一个意图」）。
 * 所以这里**不写 `model.velIntent`、不调 `model.setState()`**——
 * 一切写回都由 `EnemySystem` 按返回值统一执行。
 *
 * 这样做的实际好处：brain 的单测只需要「喂一个 ctx，断言返回值」，
 * 不用先把 model 的状态摆好再检查它被改成了什么；也不会出现
 * 「brain 改了状态、system 又照着返回值改一遍」这种双写。
 *
 * ## 状态转移
 *
 * ```
 *   spawning ──(graceMs 到)──→ chase
 *      │                         │
 *      └────(被打)──────────────→ flinch ──(flinchMs 到)──→ chase
 *                                  │
 *                              chase ──(hp 归零)──→ splitting / dead
 *                                                  ↑ 由 EnemySystem 切，brain 不碰
 * ```
 *
 * ⚠️ `splitting` / `dead` **既不由 brain 进入也不由 brain 离开**：那是死亡过场，
 * 归 `EnemySystem`。brain 看到这两个状态必须原地不动 —— 否则会出现
 * 「已经死了的怪还在追人」。
 */

import type { Brain, BrainContext, BrainOutput } from '@/core/actor/types'
import type { EnemyModel } from '../model/EnemyModel'
import { scratchIntent, steer } from './steering'

export interface SplitterBrainParams {
  /** 分离力强度（px/s），取配置 `ai.separationPad` 之外的另一个数 */
  sepStrength: number
  /** 分离判定余量（px），取配置 `ai.separationPad` */
  sepPad: number
}

/**
 * 造一个 brain。**每个敌人一份**（要读自己的 `model`），但闭包本身不分配可变状态 ——
 * 可变状态全在 `model` 上，闭包只捕获一个引用与 `out` 对象。
 */
export function makeSplitterBrain(model: EnemyModel, params: SplitterBrainParams): Brain {
  // 复用同一个输出对象：每帧 × 200 只怪，全在分配的话 GC 会在最需要帧率的时候插一脚。
  // ⚠️ 调用方**不许把它存起来**，下一步就被覆写了。
  const out: BrainOutput = { vx: 0, vy: 0 }

  return function splitterBrain(ctx: BrainContext): BrainOutput {
    const { nowMs, self, target } = ctx

    // ⚠️ 状态用**局部变量**一路推导，不能每处都写 `out.nextState = model.state`。
    // 硬直刚好走完的那一 tick，`model.state` 还是 'flinch'（system 还没写回），
    // 照着它报告就会让这只怪永远停在 flinch —— 它算出了移动意图，却被自己的状态报告否掉。
    let next = model.state

    // ---- 死亡过场 / 已死：原地不动 ----
    if (!self.alive || next === 'splitting' || next === 'dead') {
      out.vx = 0
      out.vy = 0
      out.nextState = next
      out.attack = undefined
      return out
    }

    // ---- 受击硬直：停住。时长用「进入时刻 + 时长」比，暂停/顿帧时天然冻结 ----
    if (next === 'flinch' && nowMs < model.flinchUntilMs) {
      out.vx = 0
      out.vy = 0
      out.nextState = 'flinch'
      out.attack = undefined
      return out
    }
    if (next === 'flinch') next = 'chase' // 硬直走完

    // ---- 生成宽限结束 → 转入追击 ----
    if (next === 'spawning' && !model.inGrace(nowMs)) next = 'chase'

    // ---- 移动 ----
    // `speedNow` 已经把生成宽限的减速乘进去了（见 EnemyModel.speedMult），
    // 这里**不要**再乘一次 `graceMoveMult`。
    const speed = model.speedNow(nowMs)
    const v = steer(self, target, ctx, speed, params.sepPad, params.sepStrength, scratchIntent)

    out.vx = v.x
    out.vy = v.y
    out.nextState = next

    // ---- 攻击 ----
    // 分裂怪不由 brain 报攻击：接触伤害走物理 overlap → 伤害账本（见 EnemySystem）。
    // 放进 brain 会变成「每帧按距离判一次」，而账本需要的是**每个物理步**的接触事实；
    // 而且那样伤害会被 AI 的远近 LOD 降频影响 —— 远处的怪摸到你却不掉血，说不通。
    out.attack = undefined

    return out
  }
}