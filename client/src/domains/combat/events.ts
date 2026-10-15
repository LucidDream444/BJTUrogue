import type { WeaponId } from './config'
import type { GameEvents } from '@/core/events'
export interface CombatEvents extends GameEvents {
  weapon_replaced: { dropped: WeaponId; equipped: WeaponId; slot: number; x: number; y: number }
  player_hurt: {
    id: number
    hpDamage: number
    shieldDamage: number
    sourceKind: GameEvents['entity_damaged']['sourceKind']
    frameId: number
  }
  room_cleared: { runId: string; roomId: string }
  reward_offered: { runId: string; roomId: string; ids: string[] }
  reward_selected: { runId: string; roomId: string; rewardId: string; stacks: number }
  reward_finished: { runId: string; roomId: string; reason: 'selected' | 'empty' }
}
