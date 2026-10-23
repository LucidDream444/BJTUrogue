/**
 * 抓取期间的规则。**零 Phaser**，node 下可直接单测。
 *
 * 它只管三件事：数按下、算咬人节拍、判断什么时候结束。
 * 所有数值都是**派生好的**（`deriveGrabber()` 给的 `pressDamage` / `biteDamage`），
 * 这里不再做任何「百分比 → 伤害」的换算 —— 换算只有一处，免得两边各算一遍然后漂移。
 *
 * ## ⚠️ 它吃的是「电影时间」，不是玩法时钟
 *
 * 抓取期间世界是冻结的（`GameClock.nowMs` 停），所以传进来的是由 D1 每帧喂的**表现时间**。
 * 这样有两个正确的副作用：
 *
 * - 世界冻结时它照走 → 头顶的倒计时会动；
 * - 标签页切走时 rAF 停、喂进来的时间也就停 → **玩家不会在看不见的时候被咬**。
 *
 * 用 `clock.nowMs` 会当场死锁（冻结的时间永远到不了咬击时刻）；用
 * `performance.now()` 会让切走的玩家继续挨咬。两条都是静的错，所以口径写在这儿。
 *
 * ## 不追赶
 *
 * 掉帧时一帧最多咬一口，`nextBiteAtMs` 用**赋值**而不是 `+=`
 * —— 和伤害账本（`core/actor/damage.ts`）同一条规则，理由也一样：
 * 「按时间累积的东西一次性结算好几次」是这类系统最经典的 bug。
 */

export interface GrabQteConfig {
  /** 每次按下扣它多少血。**派生值**（= 最大血量 × `pressDamageRatio`，取整） */
  pressDamage: number
  /** 咬人节拍（毫秒） */
  biteIntervalMs: number
  /** 每口咬玩家多少。**派生值**（已乘难度 `enemyDamage`） */
  biteDamage: number
  /**
   * 硬上限：抓取持续超过它就直接结束（兜底）。
   *
   * 它不是玩法的一部分（玩家要么挣脱、要么被咬死），存在的理由是**保证抓取一定能解开**
   * —— 抓取期间世界冻结，一个解不开的抓取就是永久卡死。
   */
  hardLimitMs: number
}

export type GrabOutcome = 'ongoing' | 'escaped' | 'timeout'

export class GrabQte {
  /** 玩家一共按了多少次（读数与测试用） */
  presses = 0
  /** 一共咬了几口（读数与测试用） */
  bites = 0
  private state: GrabOutcome = 'ongoing'
  private nextBiteAtMs: number

  constructor(
    private readonly cfg: GrabQteConfig,
    readonly startedAtMs: number,
  ) {
    if (
      !(cfg.pressDamage > 0) ||
      !(cfg.biteIntervalMs > 0) ||
      !(cfg.hardLimitMs > 0) ||
      !(cfg.biteDamage >= 0)
    ) {
      throw new Error('GrabQte: 参数必须为正（咬人伤害允许为 0）')
    }
    this.nextBiteAtMs = startedAtMs + cfg.biteIntervalMs
  }

  get outcome(): GrabOutcome {
    return this.state
  }

  /** 下一次咬击还剩多久（毫秒）。表现层用它画头顶那行红色倒计时。 */
  msUntilNextBite(nowMs: number): number {
    return Math.max(0, this.nextBiteAtMs - nowMs)
  }

  /**
   * 玩家按下一次攻击键。
   *
   * @param hpNow 它**现在**的血量（真值在 `EnemyModel` 上，这里不存第二份）
   * @returns 这一次该扣它多少血；`escaped` = 这一下把它压到了「再一下就会死」
   *
   * ⚠️ 挣脱是**在扣血之前**判定的：它到 0 就死了，而死了的实体在 D3 会立刻被 park
   * （位置冻住、走死亡过场），**尸体飞不起来**。所以「落地才死」这条设计要求
   * 挣脱那一刻它留着 1 点血飞出去。
   */
  press(hpNow: number): { damage: number; escaped: boolean } {
    if (this.state !== 'ongoing') return { damage: 0, escaped: false }
    this.presses++
    const damage = this.cfg.pressDamage
    const escaped = hpNow - damage <= 0
    if (escaped) this.state = 'escaped'
    return { damage, escaped }
  }

  /** 推进到 `nowMs`。返回这一帧该不该咬玩家一口。 */
  tick(nowMs: number): { bite: boolean; damage: number; timedOut: boolean } {
    if (this.state !== 'ongoing') return { bite: false, damage: 0, timedOut: false }
    if (nowMs - this.startedAtMs >= this.cfg.hardLimitMs) {
      this.state = 'timeout'
      return { bite: false, damage: 0, timedOut: true }
    }
    if (nowMs < this.nextBiteAtMs) return { bite: false, damage: 0, timedOut: false }
    this.bites++
    this.nextBiteAtMs = nowMs + this.cfg.biteIntervalMs
    return { bite: true, damage: this.cfg.biteDamage, timedOut: false }
  }
}
