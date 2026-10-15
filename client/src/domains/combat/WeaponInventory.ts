import type { WeaponId } from './config'

/** A replacement conserves the removed weapon; callers place it into the room after equipping. */
export function planReplacement(
  inventory: readonly WeaponId[],
  slot: number,
  incoming: WeaponId,
  allowed: readonly WeaponId[],
): { inventory: WeaponId[]; dropped: WeaponId } | null {
  if (
    !Number.isInteger(slot) ||
    slot < 0 ||
    slot >= inventory.length ||
    inventory.includes(incoming) ||
    !allowed.includes(incoming)
  )
    return null
  const result = [...inventory],
    dropped = result[slot]!
  result[slot] = incoming
  return { inventory: result, dropped }
}
