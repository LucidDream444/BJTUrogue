import type { RunContext, RunResultSnapshot, StoryRequest } from '@/core/events'

export type RunPhase = 'intro' | 'playing' | 'ending' | 'settlement'

/** 流程只收归并后的逻辑结果，不依赖事件到达顺序或任何表现层对象。 */
export class RunFlow {
  private currentPhase: RunPhase = 'intro'
  private finalKilled = false
  private settled: RunResultSnapshot | null = null
  readonly context: RunContext

  constructor(context: RunContext) { this.context = Object.freeze({ ...context }) }
  get phase(): RunPhase { return this.currentPhase }
  get result(): RunResultSnapshot | null { return this.settled }
  get activeStory(): StoryRequest | null {
    if (this.currentPhase !== 'intro' && this.currentPhase !== 'ending') return null
    return { ...this.context, kind: this.currentPhase, requestId: `${this.context.runId}:${this.currentPhase}` }
  }

  finishStory(runId: string, requestId: string): boolean {
    const active = this.activeStory
    if (!active || active.runId !== runId || active.requestId !== requestId) return false
    this.currentPhase = active.kind === 'intro' ? 'playing' : 'settlement'
    return true
  }

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
    this.currentPhase = snapshot.outcome === 'cleared' ? 'ending' : 'settlement'
    return true
  }
}
