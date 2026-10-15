interface Batch {
  amount: number
  x: number
  y: number
  due: number
  player: boolean
}
/** Bounded, per-target damage aggregation. Only valid settled damage may enter. */
export class DamageBatches {
  readonly pending = new Map<number, Batch>()
  constructor(
    private readonly interval: number,
    private readonly capacity: number,
  ) {}
  add(id: number, amount: number, x: number, y: number, now: number, player: boolean): void {
    if (amount <= 0) return
    const prior = this.pending.get(id)
    if (prior) {
      prior.amount += amount
      prior.x = x
      prior.y = y
      return
    }
    if (this.pending.size >= this.capacity) return
    this.pending.set(id, { amount, x, y, due: now + this.interval, player })
  }
  flush(now: number): Batch[] {
    const out: Batch[] = []
    for (const [id, b] of this.pending)
      if (now >= b.due) {
        out.push(b)
        this.pending.delete(id)
      }
    return out
  }
}
