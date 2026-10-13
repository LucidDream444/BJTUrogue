/**
 * 威胁预算曲线。**纯函数，零依赖。**
 *
 * 预算不是「刷几只怪」，而是「这一间该有多难」的抽象量。D2 只出这个数，
 * **难度档位乘在「预算 → 具体刷怪」那一步**（D1/D3 的活），所以这里不认识
 * `Difficulty` 类型，也不认识任何敌人种类。
 *
 * ---
 *
 * ## 按进度百分比参数化，不按房间序号
 *
 * ```
 * t = 主干序号 / (主干数 − 1)          t ∈ [0, 1]
 * budget(t) = round_half_up(base × growth ^ t)
 * ```
 *
 * ⚠️ **不要写成 `base × growth ^ 主干序号`。** 主干数在 8—11 之间随种子变，
 * 按序号参数化意味着 11 间的局末尾是 `growth^10`、8 间的是 `growth^7` ——
 * **长局不只是「多打几间」，而是「越往后越变态」**，两个变量叠在一起，
 * 调难度时分不清是哪个引起的。
 *
 * 按百分比参数化之后有一个直接可断言的性质：**N=8 和 N=11 的最后一间一样强**
 * （两个 `t` 都是 1）。这条在测试里钉着。
 *
 * ## 为什么用 `roundHalfUp`
 *
 * `core/config.ts` 里写着「**全项目唯一的舍入规则**，不要在别处改用 ceil/floor」。
 * 这里照办 —— 混用舍入规则的话，同一个数在两处会差 1，而差 1 的预算
 * 意味着「说好这间刷 6 只，实际 7 只」。
 */

import { roundHalfUp } from '@/core/config'
import type { RoomsConfig } from '../config'

/**
 * 进度百分比。`mainIndex` 是**主干序号**（0 到 主干数−1），不是 `order`。
 *
 * 主干只有一间时 `t` 恒为 0 —— 除以 `N-1 = 0` 会得到 `Infinity`，
 * 而 `Infinity` 喂进 `growth ** t` 的结果是 `Infinity` 或 `NaN`，
 * 一路传播到 `budget` 上，**不报错**，只是那一间的预算变成天文数字。
 */
export function progressT(mainIndex: number, mainCount: number): number {
  if (mainCount <= 1) return 0
  const clamped = Math.min(Math.max(mainIndex, 0), mainCount - 1)
  return clamped / (mainCount - 1)
}

/** 某个进度上的威胁预算。 */
export function threatBudgetAt(t: number, cfg: RoomsConfig): number {
  const raw = cfg.budgetBase * Math.pow(cfg.budgetGrowth, t)
  return Math.max(0, roundHalfUp(raw))
}

/** 主干序号 → 威胁预算。 */
export function threatBudget(mainIndex: number, mainCount: number, cfg: RoomsConfig): number {
  return threatBudgetAt(progressT(mainIndex, mainCount), cfg)
}