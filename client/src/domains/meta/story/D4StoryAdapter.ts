import type Phaser from 'phaser'
import type { StoryRequest } from '@/core/events'
import type { MetaConfig } from '../metaConfig'
import type { ProfileStore } from '../profile/ProfileStore'
import { RunResultCommitter } from '../run/RunResultCommitter'
import { SettlementOverlay } from '../settlement/SettlementOverlay'
import { StoryCoordinator, type StoryBus } from './StoryCoordinator'
import { StoryOverlay } from './StoryOverlay'
import type { StoryConfig } from './storyConfig'

export interface D4StoryAdapterOptions {
  scene: Phaser.Scene
  bus: StoryBus
  store: ProfileStore
  meta: MetaConfig
  story: StoryConfig
}

/** D1 只负责构造和生命周期；所有运行中请求/动作经 C1，未接收任何战斗内部引用。 */
export class D4StoryAdapter {
  private readonly story: StoryOverlay
  private readonly settlement: SettlementOverlay
  private readonly coordinator: StoryCoordinator
  private disposed = false
  private displayedRunId: string | null = null

  constructor({ scene, bus, store, meta, story }: D4StoryAdapterOptions) {
    this.settlement = new SettlementOverlay({
      scene, store, meta,
      host: {
        restart: () => this.action(bus, 'restart'),
        backToMenu: () => this.action(bus, 'menu'),
        goToUpgrade: () => this.action(bus, 'upgrade'),
      },
    })
    this.story = new StoryOverlay(scene, story, (request, result) => {
      this.coordinator.finishStory(request.runId, request.requestId, result)
    }, store)
    this.coordinator = new StoryCoordinator(bus, new RunResultCommitter(store, meta), {
      story: (request) => this.story.show(request),
      settlement: (result) => {
        this.displayedRunId = result.runId
        this.settlement.show(result)
      },
    })
  }

  get storyOpen(): boolean { return this.story.isOpen }
  get settlementOpen(): boolean { return this.settlement.isOpen }
  get activeRequest(): StoryRequest | null { return this.coordinator.activeRequest }

  destroy(): void {
    if (this.disposed) return
    this.disposed = true
    this.coordinator.destroy()
    this.story.destroy()
    this.settlement.destroy()
  }

  private action(bus: StoryBus, action: 'restart' | 'menu' | 'upgrade'): void {
    if (this.displayedRunId) bus.emit('settlement_action_requested', { runId: this.displayedRunId, action })
  }
}
