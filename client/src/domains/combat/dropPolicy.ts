import type { RngLike } from '@/core/rng'
import type { CombatConfig } from './config'

export type RecoveryKind = 'health' | 'shield' | 'stamina'
export interface RecoveryDrop {
  kind: RecoveryKind
  amount: number
}

/** One drop roll, followed by a weighted resource roll. Full resources never bias the loot. */
export function rollRecoveryDrop(cfg: CombatConfig['drops'], rng: RngLike): RecoveryDrop | null {
  if (rng.next() >= cfg.chance) return null
  const resource = rng.next()
  const kind: RecoveryKind =
    resource < cfg.staminaChance
      ? 'stamina'
      : resource < cfg.staminaChance + cfg.healthChance
        ? 'health'
        : 'shield'
  const amount =
    kind === 'stamina' ? cfg.staminaAmount : kind === 'health' ? cfg.healthAmount : cfg.shieldAmount
  return { kind, amount }
}
