import { allocActorId } from '@/core/actor/ActorModel'
export interface AttackSlot {
  active: boolean
  id: number
  volleyId: number
  bornMs: number
  lifeMs: number
}
/** Source lifetime owns release. Shared allocator prevents collisions with enemy contact IDs. */
export class AttackPool {
  readonly slots: AttackSlot[]
  constructor(
    capacity: number,
    private readonly releaseSource: (id: number) => void,
  ) {
    this.slots = Array.from({ length: capacity }, () => ({
      active: false,
      id: 0,
      volleyId: 0,
      bornMs: 0,
      lifeMs: 0,
    }))
  }
  acquire(count: number, nowMs: number, lifeMs: number): AttackSlot[] {
    const free = this.slots.filter((s) => !s.active).slice(0, count)
    if (free.length < count) return []
    const volleyId = allocActorId()
    for (const s of free) {
      s.active = true
      s.id = allocActorId()
      s.volleyId = volleyId
      s.bornMs = nowMs
      s.lifeMs = lifeMs
    }
    return free
  }
  release(slot: AttackSlot): void {
    if (!slot.active) return
    this.releaseSource(slot.id)
    slot.active = false
    slot.id = 0
    slot.volleyId = 0
  }
  clear(): void {
    for (const slot of this.slots) this.release(slot)
  }
}
