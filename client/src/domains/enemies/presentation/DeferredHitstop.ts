import type { GameClock } from '@/core/time'

/** 本帧的打击反馈延至全部伤害和胜负归并后；请求仍按最长时长合并。 */
export class DeferredHitstop {
  private pendingMs = 0
  constructor(private readonly clock: GameClock) {}
  request(durationMs: number): void { this.pendingMs = Math.max(this.pendingMs, durationMs) }
  flush(): void {
    const durationMs = this.pendingMs
    this.pendingMs = 0
    if (!this.clock.paused && durationMs > 0) this.clock.freeze(durationMs)
  }
  clear(): void { this.pendingMs = 0 }
}
