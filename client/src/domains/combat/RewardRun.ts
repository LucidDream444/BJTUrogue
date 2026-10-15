import type { RngLike } from '@/core/rng'
import type { RewardDef, WeaponId } from './config'
/** Pure run state. No independent timer, damage model or RNG. */
export class RewardRun {
  readonly stacks = new Map<string, number>()
  readonly completedRooms = new Set<string>()
  offered: readonly RewardDef[] = []
  roomId: string | null = null
  constructor(
    readonly defs: readonly RewardDef[],
    readonly rng: RngLike,
  ) {}
  legal(weapon: WeaponId, hp: number, maxHp: number): RewardDef[] {
    return this.defs.filter(
      (r) =>
        (r.maxStacks === 0 || (this.stacks.get(r.id) ?? 0) < r.maxStacks) &&
        (!r.weapons.length || r.weapons.includes(weapon)) &&
        r.requires.every((id) => (this.stacks.get(id) ?? 0) > 0) &&
        !r.excludes.some((id) => (this.stacks.get(id) ?? 0) > 0) &&
        !this.defs.some(
          (other) => (this.stacks.get(other.id) ?? 0) > 0 && other.excludes.includes(r.id),
        ) &&
        (!r.effects.every((e) => e.stat === 'heal') || hp < maxHp),
    )
  }
  offer(
    roomId: string,
    weapon: WeaponId,
    hp: number,
    maxHp: number,
    hasBenefit: (reward: RewardDef) => boolean = () => true,
  ): readonly RewardDef[] | null {
    if (this.roomId !== null || this.completedRooms.has(roomId)) return null
    this.roomId = roomId
    const candidates = this.legal(weapon, hp, maxHp).filter(hasBenefit),
      result: RewardDef[] = []
    while (result.length < 3 && candidates.length) {
      let draw = this.rng.next() * candidates.reduce((s, r) => s + r.weight, 0)
      let index = candidates.length - 1
      for (let i = 0; i < candidates.length; i++) {
        draw -= candidates[i]!.weight
        if (draw < 0) {
          index = i
          break
        }
      }
      result.push(candidates.splice(index, 1)[0]!)
    }
    this.offered = result
    if (!result.length) this.finish()
    return result
  }
  choose(id: string): RewardDef | null {
    const r = this.offered.find((r) => r.id === id)
    if (!r || this.roomId === null) return null
    this.stacks.set(id, (this.stacks.get(id) ?? 0) + 1)
    this.finish()
    return r
  }
  private finish(): void {
    if (this.roomId !== null) this.completedRooms.add(this.roomId)
    this.roomId = null
    this.offered = []
  }
}
