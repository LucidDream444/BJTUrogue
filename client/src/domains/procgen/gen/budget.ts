/**
 * 威胁预算曲线。**纯函数，零依赖。**
 *
 * 预算不是「刷几只怪」，而是「这一间该有多难」的抽象量。D2 只出这个数，
 * **难度档位乘在「预算 → 具体刷怪」那一步**（D1/D3 的活），所以这里不认识
 * `Difficulty` 类型，也不认识任何敌人种类。
 *
 * ---
 *
 * ## 按**到楼梯间的跳数**参数化
 *
 * ```
 * t = 跳数 / 本层战斗关里最远的跳数          t ∈ [0, 1]
 * budget(t) = round_half_up(base × growth ^ t)
 * ```
 *
 * v4 用的是 `主干序号 ÷ 主干数`，因为那时房间排在一条进度轴上、序号就是深度。
 * v5 里玩家**随意挑房间进**（用户 2026-10-19），`order` 退化成了
 * 「楼梯间 + 其余按 id 升序」的下标 —— **它跟难度再没有任何关系**：
 * `YF601` 的 `order` 比 `YF604` 小，单纯因为数字小。
 *
 * 分子用**跳数**而不是直线距离：一张真实平面图里，隔着一堵墙的两间房
 * 直线距离可能只有 40px，走起来要绕整整半个走廊。跳数量的是**玩家要花多少步走到**，
 * 那才是难度该跟着走的量。
 *
 * ⚠️ **不要写成 `base × growth ^ 跳数`。** 跳数的上界随平面图的形状变（今天最远 5 跳），
 * 按跳数本身参数化意味着「层数越深、走廊越长，末尾就越变态」——
 * 而那是几何改动顺手改变的难度，改一间房的位置会让全层变强。
 *
 * 按百分比参数化之后有一个直接可断言的性质：**不管最远是 3 跳还是 8 跳，
 * 最远的那间战斗关一样强**（两个 `t` 都是 1）。这条在测试里钉着。
 *
 * ## 三个边界值各自为什么是那个样子
 *
 * - `maxDist <= 0`（这一层没有战斗关，或最远的战斗关就在楼梯间里）→ `t = 0`。
 *   除以 0 会得到 `NaN`，而 `NaN` 喂进 `growth ** t` 还是 `NaN`，
 *   一路传到 `budget` 上 —— **不报错**，只是 `budget` 变成 `NaN`。
 * - `hop` 是 `Infinity`（房间走不到楼梯间）→ **夹到 1，不是夹到 0**。
 *   走不到的房间比最远的还难，而不是比出生点还安全。夹到 0 的话，
 *   一个走不到的房间会安静地变成全层最弱的一间，而真正的问题（它走不到）
 *   在数据里看不出来。
 * - 非战斗关别**根本不进这个函数** —— 它们的预算由 `layout.ts` 直接写 0。
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
 * 进度百分比：`hop` 是到楼梯间的 BFS 跳数，`maxDist` 是**本层战斗关**里最大的那个。
 *
 * 两个夹取都写出来而不是靠上游保证：上游换了（种子决定的关别让最远的战斗关
 * 从这一间变成那一间）时，这里不会跟着错。
 */
export function progressT(hop: number, maxDist: number): number {
  if (!(maxDist > 0)) return 0
  if (!Number.isFinite(hop)) return 1
  return Math.min(Math.max(hop / maxDist, 0), 1)
}

/** 某个进度上的威胁预算。 */
export function threatBudgetAt(t: number, cfg: RoomsConfig): number {
  const raw = cfg.budgetBase * Math.pow(cfg.budgetGrowth, t)
  return Math.max(0, roundHalfUp(raw))
}

/**
 * 跳数 → 威胁预算。
 *
 * @param hop     这间房到楼梯间的跳数（`layout.ts` 的 `hopDistances()` 给）
 * @param maxDist 本层战斗关里最大的跳数。**非战斗关不进这里**
 */
export function threatBudget(hop: number, maxDist: number, cfg: RoomsConfig): number {
  return threatBudgetAt(progressT(hop, maxDist), cfg)
}