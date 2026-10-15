import { describe, expect, it } from 'vitest'
import { planReplacement } from './WeaponInventory'
import type { WeaponId } from './config'
const allowed: WeaponId[] = ['pencil', 'pulse', 'venom', 'flare', 'rail', 'smg']
describe('weapon replacement conservation', () => {
  it('returns the displaced weapon and replaces only the selected slot', () => {
    const before: WeaponId[] = ['pencil', 'venom']
    const plan = planReplacement(before, 0, 'flare', allowed)!
    expect(plan).toEqual({ inventory: ['flare', 'venom'], dropped: 'pencil' })
    expect(before).toEqual(['pencil', 'venom'])
  })
  it('allows the dropped weapon to be picked back up without loss or duplication', () => {
    let inventory: WeaponId[] = ['pencil', 'venom'],
      ground: WeaponId = 'flare'
    const expected = [...inventory, ground].sort()
    for (let i = 0; i < 20; i++) {
      const next: NonNullable<ReturnType<typeof planReplacement>> = planReplacement(
        inventory,
        i % 2,
        ground,
        allowed,
      )!
      inventory = next.inventory
      ground = next.dropped
      expect([...inventory, ground].sort()).toEqual(expected)
    }
  })
  it('rejects duplicate, unknown and invalid-slot requests without mutation', () => {
    const inventory: WeaponId[] = ['pencil', 'rail']
    expect(planReplacement(inventory, 0, 'rail', allowed)).toBeNull()
    for (const slot of [-1, 2, 1.5, NaN])
      expect(planReplacement(inventory, slot, 'flare', allowed)).toBeNull()
    expect(planReplacement(inventory, 0, 'bad' as WeaponId, allowed)).toBeNull()
    expect(inventory).toEqual(['pencil', 'rail'])
  })
})
