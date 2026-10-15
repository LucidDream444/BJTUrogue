import type { RngLike } from '@/core/rng'
import type { CombatConfig } from './config'

export type RecoveryKind = 'health' | 'shield'
export interface RecoveryDrop {
  kind: RecoveryKind
  amount: number
}

/** One total drop roll per defeated enemy; choose the resource only after the roll succeeds. */
export function rollRecoveryDrop(cfg: CombatConfig['drops'], rng: RngLike): RecoveryDrop | null {
  if (rng.next() >= cfg.chance) return null
  const kind: RecoveryKind = rng.next() < cfg.healthChance ? 'health' : 'shield'
  return { kind, amount: kind === 'health' ? cfg.healthAmount : cfg.shieldAmount }
}
