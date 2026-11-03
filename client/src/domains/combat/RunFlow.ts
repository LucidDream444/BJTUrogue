import type { RunContext, RunResultSnapshot } from '@/core/events'

export type RunPhase = 'playing' | 'settlement'

/** 流程只收归并后的逻辑结果，不依赖事件到达顺序或任何表现层对象。 */
export class RunFlow {
  private currentPhase: RunPhase = 'playing'
  private finalKilled = false
  private settled: RunResultSnapshot | null = null
  readonly context: RunContext

  constructor(context: RunContext) { this.context = Object.freeze({ ...context }) }
  get phase(): RunPhase { return this.currentPhase }
  get result(): RunResultSnapshot | null { return this.settled }

  recordFinalBossDeath(): void {
    if (this.currentPhase === 'playing') this.finalKilled = true
  }

  /** 在本步所有伤害/死亡生产者完成后调用，死亡优先。 */
  adjudicate(playerAlive: boolean): 'dead' | 'cleared' | null {
    if (this.currentPhase !== 'playing') return null
    if (!playerAlive) return 'dead'
    return this.finalKilled ? 'cleared' : null
  }

  commit(snapshot: RunResultSnapshot): boolean {
    if (snapshot.runId !== this.context.runId || this.settled) return false
    this.settled = Object.freeze({ ...snapshot, ...this.context })
    this.currentPhase = 'settlement'
    return true
  }
}
