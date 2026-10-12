/**
 * 逻辑时钟。**零 Phaser 依赖**，可在 node 下直测。
 *
 * 要解决的问题：Phaser 的渲染帧 delta 不是一条可靠的时间轴。
 * 低端机掉到 20fps 时单帧 delta = 50ms 是**合法**的，你不希望它变成 3 次伤害跳字、
 * 3 次受击音效；切标签页回来更是如此（Phaser 已把 delta 钳到 16.667ms，但游戏语义
 * 仍需要自己兜住）。
 *
 * ## 两个时间轴，别搞混
 *
 * | 属性 | 走不走 · 暂停时 | 走不走 · 顿帧时 | 谁用 |
 * |---|---|---|---|
 * | `nowMs`（逻辑） | 停 | 停 | 伤害 tick、AI 计时、分裂延迟 |
 * | `realNowMs`（真实） | **走** | **走** | 只用于「顿帧预算」这类按玩家真实体感计的窗口 |
 *
 * `realNowMs` 两栏都是「走」：它按定义就是玩家真实经历的时间，暂停菜单开着的时候
 * 世界也在流逝。`frameId` 则与逻辑时间同步——暂停与顿帧期间都不自增。
 *
 * ## 顿帧（hitstop）为什么不碰 `physics.world.timeScale`
 *
 * `[源码]` `physics/arcade/World.js`：
 * `msPerFrame = this._frameTimeMS * this.timeScale`，随后 `while (this._elapsed >= msPerFrame)`。
 * **`timeScale = 0` 会让 `msPerFrame` 变成 0，那个 while 永不退出**——直接把浏览器卡死。
 *
 * 正确做法是 `world.pause()`：`World.update()` 的第一句就是
 * `if (this.isPaused || this.bodies.size === 0) { return; }`，**在累加 `_elapsed` 之前就返回**，
 * 所以暂停期间不累积时间，恢复后不会「追赶补步」。
 *
 * **光冻结这个时钟是不够的**：它只是各域自愿查询的包装器，物理积分、子弹位移、sprite 位置
 * 都不受它影响。真正的顿帧必须 `clock.freeze(ms)` 与 `physics.world.pause()` 一起上，
 * 由表现层的 `JuiceDirector` 负责配对（见 `domains/enemies/presentation/JuiceDirector.ts`）。
 */

export class GameClock {
  private _logicalMs = 0
  private _realMs = 0
  private _frameId = 0
  private _paused = false
  private _freezeRemainingMs = 0

  /**
   * 每个**有效的**渲染帧自增一次（暂停与顿帧期间不自增）。
   *
   * 这是伤害账本「单帧最多推进一次 tick」的门控依据，也是 `HitRequest.frameId` 的唯一来源。
   * **不允许任何调用方自己造帧号**——D1 构造子弹请求、调试场点击、敌人接触登记三方必须取同一个源，
   * 否则同帧去重会静默失效。
   */
  get frameId(): number {
    return this._frameId
  }

  /** 逻辑时间（毫秒）。暂停与顿帧期间停走。伤害 tick、AI 计时一律用它。 */
  get nowMs(): number {
    return this._logicalMs
  }

  /** 真实时间（毫秒）。只要 `advance()` 被调用就在走，顿帧/暂停期间也走。只给预算窗口用。 */
  get realNowMs(): number {
    return this._realMs
  }

  get paused(): boolean {
    return this._paused
  }

  /** 顿帧是否仍在生效。表现层据此决定要不要 `physics.world.resume()`。 */
  get frozen(): boolean {
    return this._freezeRemainingMs > 0
  }

  /** 剩余顿帧时长（毫秒），供 HUD 调试显示。 */
  get freezeRemainingMs(): number {
    return this._freezeRemainingMs
  }

  /**
   * 每渲染帧调用一次。**传 Phaser 给你的 delta，不要自己用 `performance.now()` 算差值**
   * （那会让 Phaser 内建的失焦钳制完全失效）。
   */
  advance(realDeltaMs: number): void {
    if (!Number.isFinite(realDeltaMs) || realDeltaMs <= 0) return

    this._realMs += realDeltaMs

    if (this._paused) return

    if (this._freezeRemainingMs > 0) {
      this._freezeRemainingMs -= realDeltaMs
      if (this._freezeRemainingMs > 0) return
      // 顿帧在本帧内结束：把多出来的那一点补进逻辑时间，不丢时间也不追赶
      realDeltaMs = -this._freezeRemainingMs
      this._freezeRemainingMs = 0
    }

    this._logicalMs += realDeltaMs
    this._frameId++
  }

  /**
   * 请求顿帧。表现层负责同时 `physics.world.pause()`。
   * 重复请求取**较长者**（叠加而不是覆盖），这样连锁击杀不会互相吞掉。
   */
  freeze(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) return
    if (this._paused) return
    this._freezeRemainingMs = Math.max(this._freezeRemainingMs, ms)
  }

  pause(): void {
    this._paused = true
    this._freezeRemainingMs = 0 // 暂停优先，把未走完的顿帧丢弃
  }

  resume(): void {
    this._paused = false
  }

  /** 测试与「重开一局」用。 */
  reset(): void {
    this._logicalMs = 0
    this._realMs = 0
    this._frameId = 0
    this._paused = false
    this._freezeRemainingMs = 0
  }
}

/**
 * 顿帧预算：**滑动窗口内的顿帧总时长不得超过窗口的 `ratio`**。
 *
 * 为什么需要它：顿帧是「打击感」的核心手段，但它作用在**全体**上。
 * 十几个敌人同时连锁死亡时，每个都请求 45ms，叠起来画面就变成幻灯片。
 * 预算是把「爽」工程化成可配置的量，群体混战时自动降档，而不是靠感觉调参。
 *
 * 用 `realNowMs`（真实时间）而不是逻辑时间：顿帧期间逻辑时间是停的，
 * 用逻辑时间的窗口永远滑不动，预算会把自己锁死。
 */
export class HitstopBudget {
  private grants: { atMs: number; ms: number }[] = []

  constructor(
    private readonly windowMs: number,
    private readonly ratio: number,
  ) {}

  /** 窗口内已用掉的顿帧时长。 */
  used(nowMs: number): number {
    this.prune(nowMs)
    let sum = 0
    for (const g of this.grants) sum += g.ms
    return sum
  }

  remaining(nowMs: number): number {
    return Math.max(0, this.windowMs * this.ratio - this.used(nowMs))
  }

  /** 申请一次顿帧。额度够就记账并返回 true；不够则**跳过**（不是截断成更短的顿帧）。 */
  tryGrant(ms: number, nowMs: number): boolean {
    if (ms <= 0) return false
    if (ms > this.remaining(nowMs)) return false
    this.grants.push({ atMs: nowMs, ms })
    return true
  }

  reset(): void {
    this.grants = []
  }

  private prune(nowMs: number): void {
    const cutoff = nowMs - this.windowMs
    // 不假设 grants 按 atMs 有序。用「只看队首就 shift」的写法，一旦调用方误传了
    // 逻辑时间（顿帧期间它是不走的 → 时间戳会倒退），队首就卡住不再前进，
    // 过期条目全留着，预算**静默**失效（该降档时不降档，画面变幻灯片）。
    // 原地压缩没有这个假设，顺序多乱都对，也不产生垃圾。
    let w = 0
    for (let i = 0; i < this.grants.length; i++) {
      const g = this.grants[i]!
      if (g.atMs <= cutoff) continue
      this.grants[w++] = g
    }
    this.grants.length = w
  }
}