/**
 * 巨型肉盾怪的 brain。**零 Phaser 依赖**，node 下可直接单测。
 *
 * 设计目标：**给玩家持续输出的爽感**。它是一个会走路的靶子 —— 血厚、慢、
 * 子弹穿透它、每一发都在它身上跳字。所有设计都在服务这一件事：
 * 玩家能一直打它，而它偶尔逼你挪一下脚。
 *
 * ## 下砸循环（唯一的威胁，也是唯一的节奏点）
 *
 * ```
 *   chase ──(距离 < range 且冷却好了)──→ windup(站定 700ms) ──→ 砸！ ──→ recover(900ms, 受伤 ×1.25)
 *     ↑                                                                        │
 *     └──────────────────────(距离被拉开 / recover 走完)────────────────────────┘
 * ```
 *
 * 三个设计意图，改数值前先读一遍：
 *
 * 1. **前摇站定不动**（`speedMult()` 在 windup 时返回 0）。
 *    这是玩家识别「要砸了」的唯一信号 —— 一个很慢的怪，如果前摇还能边走边蓄力，
 *    玩家永远躲不掉，那不是难度是耍赖。
 * 2. **`recover` 期间受伤 ×1.25**。这是把「贪刀」变成有意义的选择：
 *    想打得快就得在它砸完之后贴上去打。没有这个窗口，最优解永远是「离远了慢慢磨」，
 *    而那就没有「持续输出的爽感」可言了。
 * 3. **冷却从进入 windup 时就开始算**，不是砸完才起算 ——
 *    否则「冷却 2400ms + 前摇 700ms + 恢复 900ms」实际周期是 4000ms，
 *    跟配置里写的 2400 对不上，调参时会被这个差值误导。
 *
 * ## 反卡死（不是因为怪会寻路失败，是因为**玩家会故意卡它**）
 *
 * 肉盾体型大、速度慢，玩家很容易把它顶在墙角 —— 然后它就永远贴在那儿，
 * 变成一个不动的木桩（更好打，但也更无聊，而且看起来像 bug）。
 * 所以有两条逃逸：撞墙久了先侧向滑动，还不行就直接往玩家反方向倒一段。
 * 两条都由配置的 `antiPin` 控制时长。
 */

import type { Brain, BrainAttack, BrainContext, BrainOutput } from '@/core/actor/types'
import type { EnemyModel } from '../model/EnemyModel'
import { scratchIntent, steer, dirTo, type Vec2 } from './steering'

export interface TankBrainParams {
  /** 分离力强度（px/s） */
  sepStrength: number
  /** 分离判定余量（px） */
  sepPad: number

  // ---- 下砸 ----
  /** 进入下砸的距离 */
  slamRange: number
  /** 前摇时长。**同时是「冷却起算点」**，见文件头 */
  slamWindupMs: number
  /** 冷却时长（从前摇开始算） */
  slamCooldownMs: number
  /** 恢复（易伤窗口）时长 */
  slamRecoverMs: number
  /** 砸击伤害 */
  slamDamage: number
  /** 砸击半径 */
  slamRadius: number
  /** 击退强度 */
  slamKnockback: number
  /** 砸击的顿帧时长 */
  slamHitstopMs: number

  // ---- 反卡死 ----
  /** 朝目标走、但实际几乎没动，持续多久算「卡住了」 */
  unstuckMs: number
  /** 判定「没动」的速度阈值（px/s） */
  stuckSpeedThreshold: number
  /** 侧向逃逸持续多久 */
  lateralEscapeMs: number
  /** 侧向逃逸的速度倍数 */
  lateralSpeedMult: number

  // ---- 踉跄 ----
  /** 减速叠满后踉跄多久 */
  staggerMs: number
  /** 踉跄的速度倍数（0 = 完全站定） */
  staggerSpeedMult: number
  /** 两次踉跄之间至少隔多久。没有它会在减速叠满期间无限踉跄（见 EnemyModel.staggerReadyAtMs） */
  staggerCooldownMs: number
}

/** 侧向逃逸时，速度方向与「指向目标」的夹角（90°，即纯侧向）。 */
const LATERAL_ANGLE_RAD = Math.PI / 2

/**
 * 一个怪的减速是不是「叠满了」。踉跄触发判据。
 * 抽出来是因为「叠满」的定义散在 brain 与 model 两边的话必然会漂。
 */
export function isSlowSaturated(model: EnemyModel): boolean {
  return model.slowMaxStacks > 0 && model.slowStacks >= model.slowMaxStacks
}

export function makeTankBrain(model: EnemyModel, params: TankBrainParams): Brain {
  const out: BrainOutput = { vx: 0, vy: 0 }
  // 击退的**原点**每 tick 重写（砸击以自己为圆心），强度与半径不变。
  // 用局部 const 拿住引用，是为了不在热路径上写 `attack.knockback!` ——
  // 非空断言放在每帧都跑的分支里，一旦有人把 `knockback` 改成可选/可空，
  // 它不会报错，只会在运行时炸。
  const kb = { x: 0, y: 0, strength: params.slamKnockback }
  const attack: BrainAttack = {
    kind: 'slam',
    radius: params.slamRadius,
    damage: params.slamDamage,
    knockback: kb,
    hitstopMs: params.slamHitstopMs,
  }

  // 侧向逃逸的转向方向。放在闭包里是因为它必须**跨 tick 保持不变** ——
  // 每 tick 重新取一个垂直方向的话，两帧之间会左右横跳，实际位移接近 0，
  // 看起来就是「卡住的怪在原地抽搐」。
  let lateralAngle = LATERAL_ANGLE_RAD
  const lateralDir: Vec2 = { x: 0, y: 0 }
  const toTarget: Vec2 = { x: 0, y: 0 }

  return function tankBrain(ctx: BrainContext): BrainOutput {
    const { nowMs, self, target } = ctx
    let next = model.state

    out.attack = undefined

    // ---- 已死 / 死亡过场：站着别动 ----
    if (!self.alive || next === 'dead' || next === 'splitting') {
      out.vx = 0
      out.vy = 0
      out.nextState = next
      return out
    }

    // ---- 踉跄：叠满减速后停一下。优先级高于一切移动 ----
    // 这是「持续输出」的正反馈：玩家打得越猛，它越走不动，越好打。
    if (next === 'stagger') {
      if (nowMs < model.staggerUntilMs) {
        // 踉跄期间速度用 staggerSpeedMult（通常是 0），但**不进 windup、不打断已有恢复**
        const sp = model.speedNow(nowMs) * params.staggerSpeedMult
        dirTo(self.x, self.y, target?.x ?? self.x, target?.y ?? self.y, toTarget)
        out.vx = toTarget.x * sp
        out.vy = toTarget.y * sp
        out.nextState = 'stagger'
        return out
      }
      next = 'chase'
    }

    // ---- 前摇：站定，倒计时结束就砸 ----
    if (next === 'windup') {
      // A retreating player cancels the attack instead of leaving an attack loop running at range.
      if (!target?.alive || Math.hypot(target.x - self.x, target.y - self.y) > params.slamRange) {
        out.vx = 0
        out.vy = 0
        out.nextState = 'chase'
        return out
      }
      if (model.stateAgeMs(nowMs) < params.slamWindupMs) {
        out.vx = 0
        out.vy = 0
        out.nextState = 'windup'
        return out // 蓄力中：不输出攻击，攻击由「前摇结束」这一 tick 发出
      }
      // 前摇结束 → 发出砸击 → 进入恢复窗
      kb.x = self.x
      kb.y = self.y
      out.vx = 0
      out.vy = 0
      out.attack = attack
      out.nextState = 'recover'
      return out
    }

    // ---- 恢复窗（易伤 ×1.25）：继续慢慢挪，但不再攻击 ----
    if (next === 'recover') {
      if (model.stateAgeMs(nowMs) < params.slamRecoverMs) {
        const sp = model.speedNow(nowMs) * 0.35 // 恢复期间挪得很慢，让玩家看清这个窗口
        steer(self, target, ctx, sp, params.sepPad, params.sepStrength, scratchIntent)
        out.vx = scratchIntent.x
        out.vy = scratchIntent.y
        out.nextState = 'recover'
        return out
      }
      next = 'chase'
    }

    // ---- 想站定砸一个：只在冷却好了、且在射程内才起手 ----
    const distance = target ? Math.hypot(target.x - self.x, target.y - self.y) : Infinity
    if (target && distance <= params.slamRange && nowMs >= model.slamReadyAtMs) {
      // 冷却从**现在**起算（进入前摇的这一刻），见文件头第 3 点
      model.slamReadyAtMs = nowMs + params.slamCooldownMs
      out.vx = 0
      out.vy = 0
      out.nextState = 'windup'
      return out
    }

    // ---- 反卡死：贴着目标却动不了 → 侧滑；再不行就往反方向倒 ----
    const speed = model.speedNow(nowMs)
    const moving = Math.hypot(self.vx, self.vy)
    const wantToMove = speed > 0 && target !== null
    if (wantToMove && moving < params.stuckSpeedThreshold) {
      if (model.stuckSinceMs === 0) {
        model.stuckSinceMs = nowMs
      } else if (nowMs - model.stuckSinceMs >= params.unstuckMs) {
        // 触发侧向逃逸。方向**只在这里定一次**：取「指向目标」旋转 90°，
        // 并用 id 的奇偶决定往哪边转，免得所有怪都往同一侧绕。
        if (model.unstuckUntilMs <= nowMs) {
          const sign = model.lateralSign >= 0 ? 1 : -1
          lateralAngle = LATERAL_ANGLE_RAD * sign
          model.unstuckUntilMs = nowMs + params.lateralEscapeMs
        }
      }
    } else {
      model.stuckSinceMs = 0
    }

    if (nowMs < model.unstuckUntilMs && target) {
      dirTo(self.x, self.y, target.x, target.y, toTarget)
      // 把「指向目标」旋转 ±90°
      const cos = Math.cos(lateralAngle)
      const sin = Math.sin(lateralAngle)
      lateralDir.x = toTarget.x * cos - toTarget.y * sin
      lateralDir.y = toTarget.x * sin + toTarget.y * cos

      const sp = speed * params.lateralSpeedMult
      out.vx = lateralDir.x * sp
      out.vy = lateralDir.y * sp
      out.nextState = 'chase'
      return out
    }

    // ---- 正常追击 ----
    const v = steer(self, target, ctx, speed, params.sepPad, params.sepStrength, scratchIntent)
    out.vx = v.x
    out.vy = v.y

    // ---- 叠满减速 → 踉跄一下（下一 tick 由上面的 stagger 分支接管）----
    //
    // ⚠️ 冷却判据必须是 `staggerReadyAtMs`，不能写成 `nowMs >= staggerUntilMs`。
    // 后者在「减速一直叠满」时会变成无限踉跄：踉跄一结束就立刻再次满足，
    // 肉盾从此彻底站定 —— 而配置里 `minSpeedMult` 那道速度地板正是为了
    // 防止「被罚站死」，这个 bug 会绕过它，且完全不报错。
    if (isSlowSaturated(model) && params.staggerMs > 0 && nowMs >= model.staggerReadyAtMs) {
      model.staggerUntilMs = nowMs + params.staggerMs
      model.staggerReadyAtMs = nowMs + params.staggerCooldownMs
      out.nextState = 'stagger'
      return out
    }

    out.nextState = next
    return out
  }
}
