import type { GameEvents, StoryRequest, TypedBus } from '@/core/events'
import type { CommittedRunResult, RunResultCommitter } from '../run/RunResultCommitter'
import type { StoryCompletion } from './StorySequence'

export type StoryBus = Pick<TypedBus<GameEvents>, 'on' | 'emit'>
export interface StoryPresentation {
  story(request: StoryRequest): void
  settlement(result: CommittedRunResult): void
}

/** C1 装配逻辑保持纯函数依赖，浏览器与白箱使用同一条提交/完成路径。 */
export class StoryCoordinator {
  private runId: string | null = null
  private active: StoryRequest | null = null
  private readonly completions = new Map<string, GameEvents['story_finished']>()
  private readonly startedKinds = new Set<StoryRequest['kind']>()
  private endingFinished = false
  private settlementRequested = false
  private readonly unsubs: (() => void)[]

  constructor(
    private readonly bus: StoryBus,
    private readonly committer: RunResultCommitter,
    private readonly presentation: StoryPresentation,
  ) {
    this.unsubs = [
      bus.on('story_requested', (request) => this.requestStory(request)),
      bus.on('run_result_ready', (snapshot) => {
        if (!this.accept(snapshot.runId)) return
        const result = this.committer.commit(snapshot)
        this.bus.emit('run_result_committed', result)
      }),
      bus.on('settlement_requested', ({ runId }) => {
        if (!this.accept(runId)) return
        this.settlementRequested = true
        this.showSettlement()
      }),
    ]
  }

  get activeRequest(): StoryRequest | null { return this.active }

  finishStory(runId: string, requestId: string, result: StoryCompletion): void {
    if (!this.active || this.active.runId !== runId || this.active.requestId !== requestId) return
    const request = this.active
    const completion = Object.freeze({ runId, requestId, kind: request.kind, result })
    this.completions.set(requestId, completion)
    this.active = null
    if (request.kind === 'ending') this.endingFinished = true
    this.bus.emit('story_finished', completion)
    this.showSettlement()
  }

  destroy(): void {
    for (const off of this.unsubs) off()
    this.active = null
  }

  private accept(runId: string): boolean {
    if (this.runId === null) this.runId = runId
    return this.runId === runId
  }

  private requestStory(source: StoryRequest): void {
    if (!this.accept(source.runId)) return
    const previous = this.completions.get(source.requestId)
    if (previous) {
      if (previous.kind === source.kind) this.bus.emit('story_finished', previous)
      return
    }
    if (this.active || this.startedKinds.has(source.kind)) return
    if (source.kind === 'ending' && this.committer.get(source.runId)?.snapshot.outcome !== 'cleared') return
    if (source.kind === 'intro' && this.committer.get(source.runId)) return
    this.active = Object.freeze({ ...source })
    this.startedKinds.add(source.kind)
    this.presentation.story(this.active)
  }

  private showSettlement(): void {
    if (!this.settlementRequested || this.runId === null || this.active) return
    const result = this.committer.get(this.runId)
    if (!result || (result.snapshot.outcome === 'cleared' && !this.endingFinished)) return
    this.presentation.settlement(result)
  }
}
