/**
 * 打击感的**决策层**。**零 Phaser 依赖**，node 下可直接单测。
 *
 * `JuiceDirector` 负责「怎么做」（暂停物理、震屏、调音量），本文件负责「做不做、做多少」。
 * 分开的理由和 `ContactResolver` 一样：决策是纯的、能测；执行是 Phaser 的、测不了。
 * 而这里每一条决策的失败方式都是**静默变难玩**，不是报错。
 *
 * ---
 *
 * ## 三条被工程化的「爽感」，以及它们各自的失败方式
 *
 * ### 1. 顿帧预算 —— 防止「割草割成幻灯片」
 *
 * 顿帧作用在**全体**上。十几只怪连锁死亡时每只都请求 45ms，叠起来画面就卡住了。
 * 预算是「窗口内顿帧总时长 ≤ 窗口 × ratio」，额度不够就**整次跳过**，
 * 不截断成更短的顿帧 —— 截断出来的 8ms 顿帧既感觉不到，又照样吃掉了额度。
 *
 * 窗口与额度用 `core/time.ts` 的 `HitstopBudget`（它用**真实时间**计量，
 * 因为顿帧期间逻辑时间是停的，用逻辑时间的窗口永远滑不动，预算会把自己锁死）。
 *
 * ### 2. 连杀音调 —— 让「咔嚓咔嚓咔嚓」听起来是连击
 *
 * 连续击杀时受击音效的音调逐级升高。窗口 `comboWindowMs` 内连续击杀才算连击，
 * 超时归零 —— **必须归零**，否则玩家打完一波、走十分钟、再打，音调已经高到听不见了。
 *
 * ### 3. 受击反馈的限频 —— 肉盾的帧伤不能每 100ms 放一次音
 *
 * 肉盾是**帧伤**怪：一发子弹在它体内停留 ~150ms，期间按 `tickMs`（配置 100ms）结算。
 * 玩家贴脸用近战砍，一秒钟就是 10 次结算。每次结算都：
 * - 放一次受击音 → 10 次/秒的同一个音叠起来是一团噪声，不是「持续输出的爽感」；
 * - 飘一次字 → 屏幕上全是数字，看不见战况；
 * - 闪一次白 → 闪烁频率超过 ~10Hz 就开始恶心，而不是有力。
 *
 * 所以三条各自限频：音效按 `hitSfxMinIntervalMs`、飘字按 `damageEventBatchMs`、
 * 闪白/挤压走连续正弦波（`flashHz` / `jitterHz` / `squashHz`）而不是「每 hit 触发一次」。
 * **连续波是这里唯一正确的做法**：触发式的闪白会随伤害频率变化，
 * 而帧伤的频率取决于玩家的武器 —— 换一把武器就会从「有力」变成「癫痫警告」。
 */

import { HitstopBudget } from '@/core/time'
import type { EnemyKind } from '@/core/events'

export interface JuicePolicyParams {
  /** 顿帧预算窗口（真实时间 ms） */
  hitstopWindowMs: number
  /** 窗口内顿帧总时长占比上限 */
  hitstopBudgetRatio: number
  /** 震屏强度上限。**再想加也别超过它** —— 这不是「保守」，是前庭不适的阈值 */
  traumaCap: number
  /** 两次震屏之间的最小间隔（真实时间 ms） */
  shakeMinIntervalMs: number
  /** 连击窗口（真实时间 ms） */
  comboWindowMs: number
  /** 连击到几次放「花式」表现（闪光 + 特殊音效） */
  comboFlourishAt: number
  /** 每级连击的音调增量（音分） */
  pitchStepCents: number
  /** 肉盾受击音效的最小间隔 */
  tankHitSfxMinIntervalMs: number
  /** 肉盾伤害事件的攒批窗口（飘字合并用） */
  tankDamageEventBatchMs: number
}

/** 一次命中的表现输入。**派生数值由调用方从配置取**，本文件不认识配置类型。 */
export interface HitFeedbackInput {
  enemyKind: EnemyKind
  gen: number
  killed: boolean
  /** 这次命中该给的基础顿帧时长（0 = 不给） */
  baseHitstopMs: number
  /** 这次命中该给的基础震屏创伤 */
  baseTrauma: number
}

export interface HitFeedback {
  /** 真正给出的顿帧时长（0 = 没给，可能被预算挡了） */
  hitstopMs: number
  /** 震屏创伤增量（可能被上限截断或间隔闸门挡成 0） */
  trauma: number
  /** 这一批的连击级数（0 = 没在连击）。表现层用它算音调 */
  combo: number
  /** 是否到达「花式」阈值：闪光 + 特殊音效 */
  flourish: boolean
}

/**
 * 震屏创伤的半衰期。
 *
 * **按半衰期衰减，不按「每帧减一个固定量」** —— 后者是帧率相关的：
 * 同一个配置在 144Hz 机器上衰减快 2.4 倍，玩家换台机器手感就变了，
 * 而且因为差异只出现在「抖动持续多久」上，没人会把它和帧率联系起来。
 *
 * 220ms 是「一次击杀的余震刚好够看清」的长度（人眼对这个量级的余震
 * 已经读不出内容了，再长就是画面在晃而不是打中了）。
 */
const TRAUMA_HALF_LIFE_MS = 220

/** 衰到这个值以下就归零，省掉一串永远到不了 0 的浮点尾数 */
const TRAUMA_EPSILON = 0.01

export class JuicePolicy {
  private readonly budget: HitstopBudget
  private readonly p: JuicePolicyParams

  /** 连击数 */
  private combo = 0
  /** 累积震屏创伤。**由表现层每帧拿来算抖动强度**，衰减也在本类里做（纯逻辑，可测） */
  private accumTrauma = 0
  /** 上一次击杀的真实时刻 */
  private lastComboAtMs = Number.NEGATIVE_INFINITY
  /** 上一次震屏的真实时刻 */
  private lastShakeAtMs = Number.NEGATIVE_INFINITY
  /** 肉盾上一次放受击音的真实时刻 */
  private lastTankSfxAtMs = Number.NEGATIVE_INFINITY
  /**
   * 肉盾攒批的起点。**`-1` = 当前没有在攒。**
   *
   * ⚠️ 这里**不能用 0 当「没有在攒」的哨兵** —— `0` 是一个合法的时刻
   * （开局第一帧、`reset()` 之后第一帧的 `realNowMs` 就是 0）。
   * 用 0 的话，`shouldFlushTankDamage(0)` 会「开窗口」并写下 `start = 0`，
   * 下一次调用又看见 `start === 0`，于是再开一次窗口、再返回 false ——
   * 第一次飘字会被整整推迟一个窗口，而且只在「刚好在计时原点上打肉盾」时出现。
   */
  private tankBatchStartMs = -1

  constructor(params: JuicePolicyParams) {
    this.p = params
    this.budget = new HitstopBudget(params.hitstopWindowMs, params.hitstopBudgetRatio)
  }

  get comboCount(): number {
    return this.combo
  }

  /**
   * 当前累积的震屏创伤（0..`traumaCap`）。
   *
   * 创伤**存在这里而不是表现层**：它是一个「多打就多晃、停下就衰减」的连续量，
   * 而它的每一条规则（上限、半衰期、间隔闸门）都是纯数学。放进 Phaser 那一侧
   * 就等于放弃了对它的测试，而它坏掉的方式是「画面一直在抖」这种说不清的现象。
   */
  get trauma(): number {
    return this.accumTrauma
  }

  /** 加创伤。**已经过 `shakeMinIntervalMs` 闸门的增量**才加进来（`onHit` 的返回值）。 */
  addTrauma(amount: number): void {
    if (amount <= 0) return
    this.accumTrauma = Math.min(this.p.traumaCap, this.accumTrauma + amount)
  }

  /**
   * 按真实时间衰减。**每渲染帧调一次，`dtMs` 是真实时间差。**
   *
   * 不用逻辑时间：顿帧期间逻辑时间是停的，而震屏恰恰大多发生在顿帧里 ——
   * 用逻辑时间的话，「击杀 → 顿帧 60ms → 恢复」这段时间里创伤一点没减，
   * 顿帧一结束画面才开始抖，抖的时机和打中的时机对不上。
   */
  decayTrauma(dtMs: number): void {
    if (this.accumTrauma <= 0 || dtMs <= 0) return
    this.accumTrauma *= Math.pow(0.5, dtMs / TRAUMA_HALF_LIFE_MS)
    if (this.accumTrauma < TRAUMA_EPSILON) this.accumTrauma = 0
  }

  /**
   * 一次命中（受击或击杀）该给什么表现。
   *
   * @param realNowMs `clock.realNowMs` —— **不是 `nowMs`**。
   *        顿帧期间逻辑时间是停的，用逻辑时间做窗口的后果是
   *        「顿帧一开，连击窗口和震屏间隔全部冻结」，连锁击杀会全部算成同一时刻。
   */
  onHit(input: HitFeedbackInput, realNowMs: number): HitFeedback {
    // ---- 连击 ----
    // ⚠️ 连击**一定要在「顿帧/震屏都是 0 就提前返回」之前算**。
    // 第三代的配置是 `hitstopMs: 0, trauma: 0.05` —— 任何「先判空、再算连击」
    // 的写法都会让最后一代**不计入连杀**，而最后一代恰恰是数量最多的那一代
    // （2 → 8 只）。表现是「连杀音调永远升不上去」，不报错、不改数值，
    // 只是那点爽感无声无息地没了。
    if (input.killed && input.enemyKind === 'splitter') {
      this.combo = realNowMs - this.lastComboAtMs <= this.p.comboWindowMs ? this.combo + 1 : 1
      this.lastComboAtMs = realNowMs
    } else if (input.killed) {
      // 肉盾的死亡是个**句号**，不该接在分裂怪的连击尾巴上
      this.combo = 0
      this.lastComboAtMs = Number.NEGATIVE_INFINITY
    }

    // ---- 顿帧 ----
    // 群体混战时预算会自动降档：这就是「预算是把爽工程化成可配置的量」的意思。
    const hitstopMs = this.requestHitstop(input.baseHitstopMs, realNowMs)

    // ---- 震屏 ----
    let trauma = 0
    if (input.baseTrauma > 0 && realNowMs - this.lastShakeAtMs >= this.p.shakeMinIntervalMs) {
      this.lastShakeAtMs = realNowMs
      trauma = Math.min(input.baseTrauma, this.p.traumaCap)
    }

    return {
      hitstopMs,
      trauma,
      combo: this.combo,
      // 只在**恰好达到**阈值那一次放花式，不是「达到之后每次都放」。
      // 后者在一场 30 连杀里会闪 25 次 —— 花式变成噪音，还堆了 25 次闪屏风险。
      // 连击窗口一旦超时归零，下一次达到 5 会重新触发，所以每波都能拿到一次。
      flourish: this.combo === this.p.comboFlourishAt,
    }
  }

  /**
   * 申请一次顿帧，走预算。**返回真正给出的时长**（0 = 额度不够，整次跳过）。
   *
   * 单独开成 public 是因为 `JuiceDirector` 还有一条不经过 `onHit` 的路径：
   * 肉盾下砸（`EnemySystemHooks.onSlam`）。那条路径也要吃同一份预算 ——
   * 否则一场混战里「下砸不给顿帧」而「连杀给顿帧」，降档逻辑等于没写。
   */
  requestHitstop(ms: number, realNowMs: number): number {
    if (ms <= 0) return 0
    return this.budget.tryGrant(ms, realNowMs) ? ms : 0
  }

  /** 顿帧预算还剩多少（调试 HUD 用）。 */
  budgetRemaining(realNowMs: number): number {
    return this.budget.remaining(realNowMs)
  }

  /** 连击音调（音分）。`combo = 1` 时是 0 —— 第一声不该已经变调 */
  pitchCentsFor(combo: number): number {
    return combo <= 1 ? 0 : (combo - 1) * this.p.pitchStepCents
  }

  /**
   * 肉盾的帧伤：**这一批该不该出表现**。返回 true 后调用方必须调 `flushTankDamage()`。
   *
   * 攒批的语义是「把这一窗口内的所有帧伤合并成一次飘字 / 一次音效」。
   * 判据全部用真实时间，理由同上。
   */
  shouldFlushTankDamage(realNowMs: number): boolean {
    if (this.tankBatchStartMs < 0) {
      this.tankBatchStartMs = realNowMs
      return false
    }
    return realNowMs - this.tankBatchStartMs >= this.p.tankDamageEventBatchMs
  }

  /** 一批帧伤结算完了。 */
  flushTankDamage(realNowMs: number): void {
    this.tankBatchStartMs = realNowMs
  }

  /** 肉盾受击音效的限频闸门。**返回 true 才放音**，并且它会记下这次。 */
  tryTankHitSfx(realNowMs: number): boolean {
    if (realNowMs - this.lastTankSfxAtMs < this.p.tankHitSfxMinIntervalMs) return false
    this.lastTankSfxAtMs = realNowMs
    return true
  }

  /** 换局 / 重开。**预算和创伤也必须重置** —— 否则上一局末尾的顿帧与震动会把新开局的前几秒吃掉。 */
  reset(): void {
    this.budget.reset()
    this.combo = 0
    this.accumTrauma = 0
    this.lastComboAtMs = Number.NEGATIVE_INFINITY
    this.lastShakeAtMs = Number.NEGATIVE_INFINITY
    this.lastTankSfxAtMs = Number.NEGATIVE_INFINITY
    this.tankBatchStartMs = -1
  }
}

/** 从配置的 `juice` 段 + 敌人各自的 juice 段拼出策略参数。**唯一的配置入口。** */
export function juiceParamsFromConfig(
  balance: {
    juice: {
      hitstopBudgetRatio: number
      hitstopWindowMs: number
      traumaCap: number
      shakeMinIntervalMs: number
    }
  },
  splitterJuice: { comboWindowMs: number; comboFlourishAt: number; pitchStepCents: number },
  tankJuice: { hitSfxMinIntervalMs: number; damageEventBatchMs: number },
): JuicePolicyParams {
  return {
    hitstopWindowMs: balance.juice.hitstopWindowMs,
    hitstopBudgetRatio: balance.juice.hitstopBudgetRatio,
    traumaCap: balance.juice.traumaCap,
    shakeMinIntervalMs: balance.juice.shakeMinIntervalMs,
    comboWindowMs: splitterJuice.comboWindowMs,
    comboFlourishAt: splitterJuice.comboFlourishAt,
    pitchStepCents: splitterJuice.pitchStepCents,
    tankHitSfxMinIntervalMs: tankJuice.hitSfxMinIntervalMs,
    tankDamageEventBatchMs: tankJuice.damageEventBatchMs,
  }
}