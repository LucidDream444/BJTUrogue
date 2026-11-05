import type { EnemyKind } from '@/core/events'

/** Stable values only: never expose pooled models to a boss skill. */
export interface EnemySkillUnit {
  id: number
  x: number
  y: number
  hp: number
  maxHp: number
  kind: EnemyKind
  gen: number
  bossStage?: number
  radius: number
  vx: number
  vy: number
}

export interface BossAppearance {
  skinBossStage?: number
  playerTextureKey?: string
  black?: boolean
  monochrome?: boolean
  hidden?: boolean
  visualScale?: number
  stationary?: boolean
}

/** HP rewind is a living-unit operation. A corpse can never be revived by an old snapshot. */
export function skillHealth(hpNow: number, maxHp: number, alive: boolean, requested: number): number | null {
  if (!alive || hpNow <= 0 || !Number.isFinite(requested)) return null
  return Math.max(0, Math.min(maxHp, requested))
}

/** New model HP keeps the old percentage, including fractional health near death. */
export function transformedHealth(hp: number, maxHp: number, nextMaxHp: number): number {
  return Math.max(0, Math.min(nextMaxHp, nextMaxHp * hp / maxHp))
}
