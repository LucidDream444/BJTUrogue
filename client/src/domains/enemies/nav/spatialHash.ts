/**
 * 均匀网格空间哈希 —— 给分离力（separation）用的邻居查询。**零 Phaser 依赖。**
 *
 * ## 为什么自己写一个，而不是用 Phaser 的 `world.tree`
 *
 * Arcade 内部确实有一棵 RTree（`world.tree`），但：
 *
 * 1. 它在**物理体空间**里，只有物理步进行中才是有效的（每步被 clear + load）；
 * 2. 用它等于让 brain 逻辑依赖 Phaser —— 而 brain 必须在 node 下能直测
 *    （见 `core/actor/types.ts` 与 `architecture.test.ts`）。
 *
 * 所以自己维护一份。反正每帧重建是 O(n)，比增量维护更简单也更不容易错。
 *
 * ## 用法（每个渲染帧一次）
 *
 * ```ts
 * hash.clear()
 * for (const e of aliveEnemies) hash.insert(e.snapshot, snap.x, snap.y)
 * // 然后每个 enemy 查询：
 * const n = hash.query(sx, sy, sepRadius, neighborsBuf)
 * ```
 *
 * 查询结果写进调用方给的数组（**复用，不分配**）。数组的 `length` 会被设成结果数，
 * 所以同一个 buffer 不能在两次查询之间被持有 —— 与 `ActorSnapshot` 的约定一致。
 *
 * ## 格子大小怎么选
 *
 * 建议取「最大查询半径」的 1 倍左右。查询会扫 `ceil(radius/cellSize)` 圈，
 * 所以 cellSize ≥ radius 时只扫 3×3 = 9 个格子。格子太小 → 扫的格子多；
 * 格子太大 → 每个格子里挤一堆实体，退化回 O(n²)。
 */

interface Entry<T> {
  ref: T
  x: number
  y: number
}

export class SpatialHash<T> {
  /** 只存倒数：查询里每帧要乘几千次，除法比乘法贵。`cellSize` 本身不需要留。 */
  private readonly invCellSize: number
  /** key = (cx * 73856093) ^ (cy * 19349663)，见 `keyOf()` */
  private readonly buckets = new Map<number, number[]>()
  private readonly entries: Entry<T>[] = []
  private count = 0

  constructor(cellSize: number) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new Error('SpatialHash: cellSize 必须 > 0')
    }
    this.invCellSize = 1 / cellSize
  }

  get size(): number {
    return this.count
  }

  /** 每个渲染帧调一次，然后重新 insert 全部。 */
  clear(): void {
    // 只把每个桶的长度归零，**不删 Map 条目** —— 桶数组跨帧复用，这是零分配的关键。
    // 切场景 / 实体数骤降时桶会一直留着（内存是 cells 量级，可忽略）。
    for (const bucket of this.buckets.values()) bucket.length = 0
    this.count = 0
  }

  insert(ref: T, x: number, y: number): void {
    let entry = this.entries[this.count]
    if (!entry) {
      entry = { ref, x: 0, y: 0 }
      this.entries[this.count] = entry
    }
    entry.ref = ref
    entry.x = x
    entry.y = y
    this.count++

    const key = this.keyOf(this.cellOf(x), this.cellOf(y))
    const bucket = this.bucketFor(key)
    bucket.push(this.count - 1)
  }

  /**
   * 查 `(x, y)` 半径 `radius` 内的所有实体，写进 `out`。
   *
   * - 返回命中数；`out.length` 被设成该数值。
   * - **包含查询点自身**（如果它也被 insert 过）—— 调用方自己按 id 过滤掉自己，
   *   因为「谁是自己」这件事只有调用方知道。
   * - 距离用平方比较，不开方。
   */
  query(x: number, y: number, radius: number, out: T[]): number {
    const r2 = radius * radius
    const minCx = this.cellOf(x - radius)
    const maxCx = this.cellOf(x + radius)
    const minCy = this.cellOf(y - radius)
    const maxCy = this.cellOf(y + radius)

    let n = 0
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.buckets.get(this.keyOf(cx, cy))
        if (!bucket || bucket.length === 0) continue

        for (let i = 0; i < bucket.length; i++) {
          const e = this.entries[bucket[i]!]!
          const dx = e.x - x
          const dy = e.y - y
          if (dx * dx + dy * dy > r2) continue
          out[n++] = e.ref
        }
      }
    }

    out.length = n
    return n
  }

  private cellOf(v: number): number {
    // Math.floor 而不是 |0：|0 对负数会向 0 截断，导致 -0.5 和 0.5 落进同一格，
    // 格子边界上会出现「明明很近却查不到」的玄学。
    return Math.floor(v * this.invCellSize)
  }

  /**
   * 把 (cx, cy) 压成一个数值 key。
   *
   * 用两个大质数异或（经典 spatial hash 做法），比字符串 `${cx},${cy}` 快得多，
   * 也不产生垃圾。**已知会碰撞**（不同格 → 同 key）：碰撞的后果只是那几个格子里的
   * 实体一起被算进候选，随后被距离判定过滤掉 —— 正确性不受影响，只是慢一点。
   */
  private keyOf(cx: number, cy: number): number {
    return (cx * 73856093) ^ (cy * 19349663)
  }

  private bucketFor(key: number): number[] {
    let bucket = this.buckets.get(key)
    if (!bucket) {
      bucket = []
      this.buckets.set(key, bucket)
    }
    return bucket
  }
}