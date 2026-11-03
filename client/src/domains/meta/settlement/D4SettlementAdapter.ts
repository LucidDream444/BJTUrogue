import type Phaser from 'phaser'
import type { MetaConfig } from '../metaConfig'
import type { ProfileStore } from '../profile/ProfileStore'
import { RunResultCommitter } from '../run/RunResultCommitter'
import { SettlementCoordinator, type SettlementBus } from './SettlementCoordinator'
import { SettlementOverlay } from './SettlementOverlay'

export interface D4SettlementAdapterOptions {
  scene: Phaser.Scene
  bus: SettlementBus
  store: ProfileStore
  meta: MetaConfig
}

/** 战斗只装配生命周期，结果提交、结算展示与用户动作通过 C1 通信。 */
export class D4SettlementAdapter {
  private readonly settlement: SettlementOverlay
  private readonly coordinator: SettlementCoordinator
  private disposed = false
  private displayedRunId: string | null = null

  constructor({ scene, bus, store, meta }: D4SettlementAdapterOptions) {
    this.settlement = new SettlementOverlay({
      scene, store, meta,
      host: {
        restart: () => this.action(bus, 'restart'),
        backToMenu: () => this.action(bus, 'menu'),
        goToUpgrade: () => this.action(bus, 'upgrade'),
      },
    })
    this.coordinator = new SettlementCoordinator(bus, new RunResultCommitter(store, meta), {
      settlement: (result) => {
        this.displayedRunId = result.runId
        this.settlement.show(result)
      },
    })
  }

  get settlementOpen(): boolean { return this.settlement.isOpen }

  destroy(): void {
    if (this.disposed) return
    this.disposed = true
    this.coordinator.destroy()
    this.settlement.destroy()
  }

  private action(bus: SettlementBus, action: 'restart' | 'menu' | 'upgrade'): void {
    if (this.disposed || !this.displayedRunId) return
    const runId = this.displayedRunId
    this.displayedRunId = null
    bus.emit('settlement_action_requested', { runId, action })
  }
}
