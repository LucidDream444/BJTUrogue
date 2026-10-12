/**
 * 分裂链的**排布几何**。纯函数、零依赖，node 下可直接单测。
 *
 * 单独成文件是因为它虽然是「刷怪」，但一行 AI、一行物理都没有 ——
 * 它只是一个「把 N 个点摆成一个扇形」的数学问题。混在 `EnemySystem` 里的话，
 * 想验证「4 个孩子有没有对称展开」就得先把整个系统搭起来。
 *
 * ## 为什么要扇形，而不是原地叠着刷
 *
 * 原地刷出来的 4 只怪会**完全重合**。分离力能推开它们，但推开需要时间，
 * 玩家会先看到「一坨怪」再看到「它们炸开」—— 而且那一瞬间如果玩家正好在开火，
 * 4 只怪叠在一起会让子弹的去重逻辑看起来像是「打中一只掉了 4 次血」。
 *
 * 扇形排布 + `spawnStaggerMs` 的错峰延迟一起，让分裂读起来像
 * 「砰 —— 一只 → 两只 → 四只」，这是割草爽感的节奏来源，不是可选的美化。
 */

export interface SplitChildPlan {
  x: number
  y: number
  /** 相对 `nowMs` 的延迟（毫秒）。第 i 个孩子是 `spawnStaggerMs * i` */
  delayMs: number
}

export interface SplitFanOptions {
  parentX: number
  parentY: number
  /** 展开的总张角（度）。2 个孩子 60°、4 个孩子 110°（见 enemies.json） */
  fanAngleDeg: number
  /** 孩子离父亲多远 */
  spawnRadius: number
  childCount: number
  /** 错峰延迟的步长 */
  spawnStaggerMs: number
  /**
   * 扇形的中心朝向（弧度）。**用父亲的移动方向**，
   * 这样「你打退它、它朝你反方向炸开」，而不是永远朝地图右方炸。
   */
  baseAngleRad: number
}

/**
 * 把 `childCount` 个孩子均匀摆在一段圆弧上。
 *
 * 边界：
 * - `childCount <= 0` → 空数组（第三代 `childCount: 0`，是正常的终止条件，不是错误）；
 * - `childCount === 1` → 就摆在 `baseAngleRad` 方向上，不做除法；
 * - `spawnRadius === 0` → 全叠在父亲位置上，但错峰延迟仍然生效。
 */
export function planSplitChildren(opts: SplitFanOptions): SplitChildPlan[] {
  const n = Math.floor(opts.childCount)
  if (n <= 0) return []

  const out: SplitChildPlan[] = []
  const fan = (opts.fanAngleDeg * Math.PI) / 180

  for (let i = 0; i < n; i++) {
    // n === 1 时不除以 0：单个孩子直接摆在中心朝向上。
    // 写成 `(i / (n - 1) - 0.5) * fan` 的话，n=1 会算成 0/0 = NaN，
    // 然后 sin/cos 把 NaN 一路传进坐标里 —— 怪会刷在 (NaN, NaN)，
    // 而 Arcade 对 NaN 坐标的表现是「静静地什么都不做」，最难查的那种。
    const t = n === 1 ? 0 : i / (n - 1) - 0.5
    const a = opts.baseAngleRad + t * fan
    out.push({
      x: opts.parentX + Math.cos(a) * opts.spawnRadius,
      y: opts.parentY + Math.sin(a) * opts.spawnRadius,
      delayMs: opts.spawnStaggerMs * i,
    })
  }

  return out
}

/**
 * 一条分裂链一共会产出多少只怪（不含最初那只）。
 *
 * `total = childCount + (children 的 children) + …`，用来：
 * ① 校验配置里的代数真的会终止（第三代 `childCount: 0`）；
 * ② 契约测试断言「一只第一代怪 = 1 + 2 + 8 = 11 只」。
 *
 * 传一个按代际取 `childCount` 的函数，是为了不让这里认识配置类型。
 */
export function countSplitChain(
  firstGen: number,
  maxGen: number,
  childCountOf: (gen: number) => number,
): number {
  let total = 0
  let n = childCountOf(firstGen)
  for (let gen = firstGen + 1; gen <= maxGen && n > 0; gen++) {
    total += n
    n *= childCountOf(gen)
  }
  return total
}