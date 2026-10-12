/**
 * 确定性随机数。
 *
 * **为什么要自己写而不是 `Math.random()`：** 地牢生成要求「同一个种子 → 同一张地图」，
 * 否则无法复现 bug、无法做每日挑战、无法写可重放的测试。
 *
 * **接口归 D2。** 这个 `RngLike` 只是 D3 需要的一个最小形状（爆炸扇形、粒子抖动要用），
 * D2 冻结自己的 RNG 接口时以他那份为准；只要形状兼容，D3 这边不用改。
 * 实现用的是 mulberry32 —— 32 位状态、快、分布够好，且不需要任何依赖。
 */

export interface RngLike {
  /** [0, 1) */
  next(): number
  /** 整数，**含两端**（与 Phaser.Math.Between 语义一致） */
  between(min: number, max: number): number
  /** 浮点，[min, max) */
  floatBetween(min: number, max: number): number
  pick<T>(items: readonly T[]): T
  readonly seed: number
}

export class Rng implements RngLike {
  readonly seed: number
  private state: number

  constructor(seed: number) {
    this.seed = seed >>> 0
    // 种子 0 会让 mulberry32 的第一轮退化，偏移一下
    this.state = (this.seed + 0x6d2b79f5) >>> 0
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  between(min: number, max: number): number {
    const lo = Math.ceil(min)
    const hi = Math.floor(max)
    if (hi < lo) return lo
    return lo + Math.floor(this.next() * (hi - lo + 1))
  }

  floatBetween(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: 空数组')
    return items[this.between(0, items.length - 1)]!
  }
}

/** 固定返回同一个数的假随机，测试用。 */
export class FixedRng implements RngLike {
  readonly seed = 0
  constructor(private readonly value = 0.5) {}
  next(): number {
    return this.value
  }
  between(min: number, max: number): number {
    return Math.round(min + this.value * (max - min))
  }
  floatBetween(min: number, max: number): number {
    return min + this.value * (max - min)
  }
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: 空数组')
    return items[Math.floor(this.value * items.length)]!
  }
}