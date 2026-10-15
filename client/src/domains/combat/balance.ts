import type { ConfigBundle, Difficulty } from '@/core/config'
import { deriveSplitterGeneration, deriveTank } from '@/core/config'
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
    phaseDelayMs: a.phaseBaseMs / d.enemySpeed,
    secondPhaseFraction: a.phaseCountScale,
  }
}
export function balanceReport(bundle: ConfigBundle, cfg: CombatConfig, difficulty: Difficulty) {
  const d = bundle.difficulty.difficulties[difficulty]
  const tank = deriveTank(bundle.enemies.enemies.tank, d, bundle.balance)
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
      slamDamage: tank.slamDamage,
    }
  })
}
