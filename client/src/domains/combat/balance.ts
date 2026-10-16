import type { ConfigBundle, Difficulty } from '@/core/config'
import { deriveGrabber, deriveSplitterGeneration, deriveTank } from '@/core/config'
import { deriveStats, type CombatConfig } from './config'
/** D2 may use this public plan; enemy stat multipliers remain solely in core derivation. */
export function stagePlan(
  bundle: ConfigBundle,
  cfg: CombatConfig,
  difficulty: Difficulty,
  stage: number,
) {
  if (!Number.isInteger(stage) || stage < 1 || stage > cfg.arena.maxStages)
    throw new Error('关卡超出本局层数上限')
  const d = bundle.difficulty.difficulties[difficulty],
    a = cfg.arena
  const growth = 1 + Math.max(0, stage - 1) * a.stageGrowth
  return {
    splitters: Math.max(1, Math.round(a.initialSplitters * growth * d.enemyCount)),
    tanks: Math.max(1, Math.round(a.initialTanks * growth * d.enemyCount)),
    // ⚠️ `initialGrabbers` **允许算出 0**（另外两个轴是 `max(1, ...)`）：
    //    第 1 层就是 0 只 —— 先让玩家认识「!」，再让它来抓人。
    //    给它套上 `max(1, ...)` 会让第一层就出现它，那正是这一档要避免的。
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
