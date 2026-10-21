import type { ConfigBundle, Difficulty } from '@/core/config'
import { deriveGrabber, deriveSplitterGeneration, deriveTank } from '@/core/config'
import { deriveStats, type CombatConfig } from './config'
/**
 * **一间房**的刷怪计划。D2 只给「这一间该有多难」的抽象量（`Room.budget`），
 * 把它折成「几只什么怪」是这里的事（`gen/budget.ts` 的文件头写着这条分工）。
 *
 * ★ 改了（2026-10-21，整层连续）：原来是 `stagePlan(bundle, cfg, difficulty, stage)`，
 * 按**第几层**算 —— 那时一层楼被拆成 16 屏「一间房 = 一关」，一屏里的怪是同一批，
 * 而层与层之间用 `arena.stageGrowth` 拉开。整层连续之后**同层之内每间房也不一样强**，
 * 而那个差别不该由层号表达：
 *
 * - D2 的 `Room.budget` 按**到楼梯间的跳数**参数化（`budget = base × growth ^ t`），
 *   离出生点越远越强 —— 这是 v5 里唯一表达「深度」的量；
 * - 这里把 `budget ÷ budgetBase` 当成**强度倍数**接着用（`t = 0` 的那间正好是 1 倍，
 *   与 `arena.initialSplitters` 那几个数一个量级，所以配置表的语义没变）。
 *
 * ⚠️ **别把层号也乘进来。** `arena.maxStages` 还在（一局几层），但那是「有几个首领」，
 * 不是「怪多强」—— 两个都乘的话，第 3 层最远的房间会是第 1 层最近那间的 4.6 倍，
 * 而 4.6 倍是没人试玩过的数。
 */
export function roomPlan(
  bundle: ConfigBundle,
  cfg: CombatConfig,
  difficulty: Difficulty,
  growth: number,
) {
  if (!Number.isFinite(growth) || growth < 0)
    // 非有限值一路乘下去会得到 `NaN`，而 `NaN` 喂给 `Math.round` 还是 `NaN`，
    // 最后落到「刷几只」上 —— `for (let i = 0; i < NaN; i++)` **一只都不刷**，
    // 不抛异常。于是「预算算错了」表现成「这一间房是空的」，而清房判定当帧就成立。
    throw new Error(`房间强度倍数非法：${growth}（威胁预算 ÷ budgetBase 才是它）`)
  const d = bundle.difficulty.difficulties[difficulty],
    a = cfg.arena
  return {
    splitters: Math.max(1, Math.round(a.initialSplitters * growth * d.enemyCount)),
    tanks: Math.max(1, Math.round(a.initialTanks * growth * d.enemyCount)),
    // ⚠️ `initialGrabbers` **允许算出 0**（另外两个轴是 `max(1, ...)`）：
    //    最靠近楼梯间的那几间就是 0 只（`growth = 1` 时 `round(0.4) = 0`）——
    //    先让玩家在近处认识「!」和抓取，再让它真的来抓人。
    //    给它套上 `max(1, ...)` 会让第一间房就出现它，那正是这一档要避免的。
    grabbers: Math.max(0, Math.round(a.initialGrabbers * growth * d.enemyCount)),
    phaseDelayMs: a.phaseBaseMs / d.enemySpeed,
    secondPhaseFraction: a.phaseCountScale,
  }
}
export function balanceReport(bundle: ConfigBundle, cfg: CombatConfig, difficulty: Difficulty) {
  const d = bundle.difficulty.difficulties[difficulty]
  const tank = deriveTank(bundle.enemies.enemies.tank, d, bundle.balance)
  const grabber = deriveGrabber(bundle.enemies.enemies.grabber, d, bundle.balance)
  const small = deriveSplitterGeneration(
    bundle.enemies.enemies.splitter.generations[0]!,
    d,
    bundle.balance,
  )
  return cfg.weapons.map((w) => {
    const s = deriveStats(bundle.balance, cfg, w, [], new Map())
    const directDps = (s.damage * s.pellets * 1000) / s.cooldownMs
    // One crossing tick is a stated estimate, not a second damage formula used by combat.
    const crossingDps =
      directDps * (1 + bundle.enemies.enemies.tank.frameDamage.bullet.tickDamageRatio)
    return {
      name: w.name,
      ...s,
      directDps,
      tankHp: tank.maxHp,
      smallHp: small.maxHp,
      tankDirectTtk: tank.maxHp / directDps,
      tankOneTickTtk: tank.maxHp / crossingDps,
      smallVolleys: Math.ceil(small.maxHp / s.damage),
      lethalSlams: Math.ceil(bundle.balance.baseline.player.maxHp / tank.slamDamage),
      // 抓取怪：一眼看清「预警窗口里打不打得死」与「要连点几下」「会被咬几口」
      grabberHp: grabber.maxHp,
      grabberPressesToEscape: grabber.pressesToEscape,
      grabberBitesToKillPlayer: grabber.bitesToKillPlayer,
      slamDamage: tank.slamDamage,
    }
  })
}
