import type { StoryConfig, StoryKind, StoryPage } from './storyConfig'

export interface StorySequenceRequest {
  readonly runId: string
  readonly requestId: string
  readonly characterId: string
  readonly difficulty: 'easy' | 'normal' | 'hard'
  readonly kind: StoryKind
}
export type StoryCompletion = 'completed' | 'skipped'

/** 每次请求的纯逻辑序列。没有定时器、DOM 或战斗时钟依赖。 */
export class StorySequence {
  readonly request: Readonly<StorySequenceRequest>
  readonly pages: readonly StoryPage[]
  private indexValue = 0
  private elapsed = 0
  private completionValue: StoryCompletion | null = null

  constructor(private readonly config: StoryConfig, request: StorySequenceRequest) {
    this.request = Object.freeze({ ...request })
    const characterId = request.characterId
    if (characterId !== 'student' && characterId !== 'athlete' && characterId !== 'scholar')
      throw new Error(`未知故事角色 ${characterId}`)
    this.pages = config.branches[characterId][request.kind].map((id) => config.pages[id]!)
  }

  get index(): number { return this.indexValue }
  get page(): StoryPage { return this.pages[this.indexValue]! }
  get completion(): StoryCompletion | null { return this.completionValue }
  get done(): boolean { return this.completionValue !== null }

  /** 长帧最多推进一页；后台时间完全不累计，手动推进后旧页没有计时器可迟到。 */
  tick(deltaMs: number, hidden = false): StoryCompletion | null {
    if (this.done || hidden || !this.config.presentation.autoPlay) return null
    const dt = Number.isFinite(deltaMs) ? Math.max(0, Math.min(deltaMs, this.config.presentation.maxDeltaMs)) : 0
    this.elapsed += dt
    if (this.elapsed >= this.page.durationMs) return this.next()
    return null
  }

  next(): StoryCompletion | null {
    if (this.done) return null
    this.elapsed = 0
    if (this.indexValue + 1 < this.pages.length) {
      this.indexValue++
      return null
    }
    this.completionValue = 'completed'
    return this.completionValue
  }

  skip(): StoryCompletion | null {
    if (this.done) return null
    this.completionValue = 'skipped'
    return this.completionValue
  }
}
