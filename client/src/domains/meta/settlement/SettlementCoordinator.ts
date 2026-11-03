import type { GameEvents, RunResultSnapshot, TypedBus } from '@/core/events'
import type { CommittedRunResult, RunResultCommitter } from '../run/RunResultCommitter'

export type SettlementBus = Pick<TypedBus<GameEvents>, 'on' | 'emit'>

export interface SettlementPresentation {
  settlement(result: CommittedRunResult): void
}

/** 每个战斗场景只接受一局结果；提交、通知和展示分别只执行一次。 */
export class SettlementCoordinator {
  private result: CommittedRunResult | null = null
  private committing = false
  private shown = false
  private disposed = false
  private readonly requestedRuns = new Set<string>()
  private readonly unsubs: (() => void)[]

  constructor(
    private readonly bus: SettlementBus,
    private readonly committer: RunResultCommitter,
    private readonly presentation: SettlementPresentation,
  ) {
    this.unsubs = [
      bus.on('run_result_ready', (snapshot) => this.commit(snapshot)),
      bus.on('settlement_requested', ({ runId }) => {
        if (this.disposed || (this.result && this.result.runId !== runId)) return
        this.requestedRuns.add(runId)
        this.showSettlement()
      }),
    ]
  }

  destroy(): void {
    if (this.disposed) return
    this.disposed = true
    for (const off of this.unsubs) off()
    this.requestedRuns.clear()
  }

  private commit(snapshot: RunResultSnapshot): void {
    if (this.disposed || this.result || this.committing) return
    this.committing = true
    try {
      this.result = this.committer.commit(snapshot)
    } finally {
      this.committing = false
    }
    if (this.disposed) return
    this.bus.emit('run_result_committed', this.result)
    this.showSettlement()
  }

  private showSettlement(): void {
    if (this.disposed || this.shown || !this.result || !this.requestedRuns.has(this.result.runId)) return
    // 先关闸再调用表现层，表现回调同步重发事件也不能重复打开。
    this.shown = true
    this.requestedRuns.clear()
    this.presentation.settlement(this.result)
  }
}
