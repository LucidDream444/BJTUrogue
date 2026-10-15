/**
 * 刷怪队列。**零 Phaser 依赖**，node 下可直接单测。
 *
 * 存在的理由：**刷怪不能是同步的、想刷就刷的**。
 *
 * 一只第一代分裂怪被打死会在 180ms 后炸出 2 只，那 2 只再各炸出 4 只。
 * 如果 `EnemySystem` 在致死那一帧直接 `pool.acquire()` 8 次，会有三个后果：
 * ① 同一帧里 8 只怪同时出生、同时进入物理世界，那一帧的帧时间直接顶到天花板；
 * ② 8 个 `entity_spawned` 事件在同一帧发出，表现层（音效、粒子）会同时开 8 路音；
 * ③ 玩家看不到「一只变成两只、两只变成四只」的过程，只看到凭空冒出一堆。
 *
 * 所以：**所有出生都先进队列、带一个 `atMs`，由 `update()` 每帧限额取走**。
 *
 * ## 三个闸门，别把它们混成一个
 *
 * | 闸门 | 作用 | 超了怎么办 |
 * |---|---|---|
 * | `maxSpawnsPerFrame` | 单帧**速率**上限 | 推后到下一帧（不丢） |
 * | `maxAliveSoft`     | 场上数量**软**上限 | 整队推后 `overflowStaggerMs` |
 * | `maxAliveHard`     | 场上数量**硬**上限 | 继续等（不丢），并开始丢**最老的**积压 |
 *
 * 软/硬的区别是**意图**：软上限是「慢一点、别一下子堆满屏幕」，
 * 硬上限是「再刷就要崩了」。硬上限也不丢正在等的请求 ——
 * 分裂怪的孩子被丢掉，玩家看到的就是「打爆了但什么都没出来」，
 * 这正好把整个割草爽感机制抹掉。只有队列本身积压太久（超过 `maxQueueAgeMs`）
 * 才丢，并且**丢的时候一定会 `console.warn`**：静默截断会让「覆盖了全部情况」
 * 变成一句假话。
 */

import type { EnemySpec } from '../model/EnemyModel'

export type SpawnReason = 'wave' | 'split' | 'debug'

export interface SpawnRequest {
  spec: EnemySpec
  x: number
  y: number
  /** 逻辑时间戳。到点才会被取走。**被节流时会被推后** */
  atMs: number
  /**
   * 入队时刻。**积压判定只能用它，不能用 `atMs`。**
   *
   * 用 `atMs` 判积压的话，「场上满员时把整队推后」和「等太久了该丢」会互相抵消：
   * 队里每一条都被推成了「刚入队」，于是永远不积压、永远不丢，队列无限增长。
   */
  enqueuedAtMs: number
  bossStage?: number
  finalBoss?: boolean
  reason: SpawnReason
  /** 来源怪的 id（分裂时是父亲）。只为调试时能回答「这只为什么刷出来了」 */
  fromId?: number
}

export interface SpawnQueueConfig {
  maxSpawnsPerFrame: number
  overflowStaggerMs: number
  maxAliveSoft: number
  maxAliveHard: number
  /**
   * 队列里最老的请求最多等多久。超过就丢掉并 warn。
   *
   * 这是防「场上一直满员 → 队列无限增长 → 内存慢慢爬」的兜底。
   * 设得**远大于**一次正常分裂链的时长（几秒），否则正常玩法就会开始丢怪。
   */
  maxQueueAgeMs: number
  /** 队列长度上限，同上，第二道兜底 */
  maxQueueLength: number
}

export interface SpawnDrainResult {
  /** 这一帧真正出生的请求 */
  spawned: SpawnRequest[]
  /** 还在队列里等（含被推后的） */
  pending: number
  /** 这一帧因为积压太久被丢掉的 */
  dropped: number
  /** 当前是不是处在「场上满了在等」的状态，表现层可以据此收敛特效 */
  throttled: boolean
}

export class SpawnQueue {
  /** 按 `atMs` 升序维护。插入时二分定位，`drain` 因此可以从头扫、遇到未到期的就停 */
  private queue: SpawnRequest[] = []
  private readonly cfg: SpawnQueueConfig

  constructor(cfg: SpawnQueueConfig) {
    if (cfg.maxSpawnsPerFrame < 1) throw new Error('SpawnQueue: maxSpawnsPerFrame 必须 ≥ 1')
    if (cfg.maxAliveHard < cfg.maxAliveSoft) {
      throw new Error('SpawnQueue: maxAliveHard 不能小于 maxAliveSoft')
    }
    this.cfg = cfg
  }

  get length(): number {
    return this.queue.length
  }

  /** 清空（切场景 / 重开）。**不回池** —— 池归 `EnemyPool`，它有自己的 `releaseAll` */
  clear(): void {
    this.queue.length = 0
  }

  /** 入队。返回 false = 队列已满，这条请求被拒了（调用方应知道自己在丢怪） */
  push(req: SpawnRequest): boolean {
    if (this.queue.length >= this.cfg.maxQueueLength) {
      console.warn(
        `[SpawnQueue] 队列已满（${this.cfg.maxQueueLength}），拒绝一只 ${req.spec.kind}:${req.spec.gen}（${req.reason}）`,
      )
      return false
    }

    // 按 atMs 插入，保持升序。队头永远是最早该刷的那个。
    let lo = 0
    let hi = this.queue.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.queue[mid]!.atMs <= req.atMs) lo = mid + 1
      else hi = mid
    }
    this.queue.splice(lo, 0, req)
    return true
  }

  /** 立刻入队（`atMs = nowMs`）。 */
  pushNow(req: Omit<SpawnRequest, 'atMs' | 'enqueuedAtMs'>, nowMs: number): boolean {
    return this.push({ ...req, atMs: nowMs, enqueuedAtMs: nowMs })
  }

  /**
   * 把到期的请求取出来。**由 `EnemySystem` 每帧调一次**（`WORLD_STEP` 里）。
   *
   * `aliveCount` 是场上活着的敌人数（`pool.live`）。软上限超出时整队推后
   * `overflowStaggerMs` —— 注意是**整队**推后，不是只推队头：
   * 只推队头的话，下一帧队头又到期、又被推后，队列里其余请求反而变得更「老」，
   * 积压判定会被误触发。
   */
  drain(nowMs: number, aliveCount: number): SpawnDrainResult {
    const spawned: SpawnRequest[] = []
    let dropped = 0

    // 超软上限：这一帧一只都不刷，把队里所有到期的推后。
    //
    // ⚠️ 是**钳到 `nowMs + overflowStaggerMs`**，不是 `atMs += overflowStaggerMs`。
    // 累加的写法有两个后果，而且都很难查：
    //   ① 场上满员 10 秒 → 每条请求的 atMs 被推了 40ms × 600 帧 = 24 秒。
    //      等场上空了，那些怪要 24 秒后才出来 —— 看起来像「分裂链断了」。
    //   ② 积压兜底彻底失效：每条都变得「刚刚入队」，永远判不出等太久。
    // 钳法是幂等的：连推 600 帧的效果和推 1 帧一样。
    // 而且它保持数组有序（前缀被抬到 minAt，后缀本来就不小于 minAt）。
    const overSoft = aliveCount >= this.cfg.maxAliveSoft
    if (overSoft) {
      const minAt = nowMs + this.cfg.overflowStaggerMs
      for (const r of this.queue) {
        if (r.atMs < minAt) r.atMs = minAt
      }
    }

    while (this.queue.length > 0) {
      const head = this.queue[0]!

      // 积压兜底：等太久了就丢，**并且一定出声**。
      // 判据用 enqueuedAtMs —— 用 atMs 的话会被上面的钳法一直刷新，永远触发不了。
      if (nowMs - head.enqueuedAtMs > this.cfg.maxQueueAgeMs) {
        this.queue.shift()
        dropped++
        console.warn(
          `[SpawnQueue] 一条 ${head.spec.kind}:${head.spec.gen}（${head.reason}）等了 ` +
            `${Math.round(nowMs - head.enqueuedAtMs)}ms 还没刷出来，丢弃`,
        )
        continue
      }

      if (head.atMs > nowMs) break // 队头还没到点，后面更晚
      if (spawned.length >= this.cfg.maxSpawnsPerFrame) break // 单帧速率上限
      if (aliveCount + spawned.length >= this.cfg.maxAliveHard) break // 硬上限：继续等

      this.queue.shift()
      spawned.push(head)
    }

    return {
      spawned,
      pending: this.queue.length,
      dropped,
      throttled: overSoft || this.queue.length > 0,
    }
  }

  /** 立刻取出**全部**到期请求，忽略所有上限。只有测试场和调试用。 */
  drainUncapped(nowMs: number): SpawnRequest[] {
    const out = this.queue.filter((r) => r.atMs <= nowMs)
    this.queue = this.queue.filter((r) => r.atMs > nowMs)
    return out
  }

  /** 调试：看一眼队列里都是些什么（不要改它） */
  peek(): readonly SpawnRequest[] {
    return this.queue
  }
}
