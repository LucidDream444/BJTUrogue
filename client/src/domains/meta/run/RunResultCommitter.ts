import type { RunResultCommitted, RunResultSnapshot } from '@/core/events'
import type { MetaConfig } from '../metaConfig'
import type { ProfileStore } from '../profile/ProfileStore'
import { coinsForRun, settleRun, type RunInput } from '../progress/progress'

export interface CommittedRunResult extends RunResultCommitted {
  readonly input: Readonly<RunInput>
}

/** 本局结果与面板生命周期分开；写盘失败的重试只能调用 ProfileStore.save。 */
export class RunResultCommitter {
  private readonly results = new Map<string, CommittedRunResult>()

  constructor(private readonly store: ProfileStore, private readonly meta: MetaConfig) {}

  get(runId: string): CommittedRunResult | null { return this.results.get(runId) ?? null }

  commit(source: RunResultSnapshot): CommittedRunResult {
    const previous = this.results.get(source.runId)
    if (previous) return previous
    if (!source.runId.trim()) throw new Error('结算缺少 runId')
    for (const value of [source.depth, source.kills, source.clearedRooms, source.elapsedMs]) {
      if (!Number.isFinite(value) || value < 0) throw new Error('结算计数必须是有限非负数')
    }
    const snapshot = Object.freeze({ ...source })
    const input: Readonly<RunInput> = Object.freeze({
      outcome: snapshot.outcome,
      depth: snapshot.depth,
      kills: snapshot.kills,
      clearedRooms: snapshot.clearedRooms,
    })
    const reward = snapshot.outcome === 'cleared' && snapshot.finalRewardId
      ? this.meta.finalRewards[snapshot.finalRewardId]
      : undefined
    if (snapshot.outcome === 'cleared' && snapshot.finalRewardId && !reward)
      throw new Error(`最终收益配置不存在：${snapshot.finalRewardId}`)
    const finalCoins = Math.round(reward?.coins ?? 0)
    const coinsEarned = coinsForRun(this.meta, input) + finalCoins
    const provisional: CommittedRunResult = Object.freeze({
      runId: snapshot.runId, snapshot, input, coinsEarned,
      coinsTotal: this.store.profile.currency.coins + coinsEarned, saved: false,
    })
    // 先立防重闸，再发出 ProfileStore 的同步更新通知，防止订阅回调重入。
    this.results.set(snapshot.runId, provisional)
    let mutated = false
    const saved = this.store.update((draft) => {
      settleRun(draft, this.meta, input)
      draft.currency.coins += finalCoins
      mutated = true
    })
    if (!mutated) {
      this.results.delete(snapshot.runId)
      throw new Error(this.store.lastError ?? '本局结果未能提交')
    }
    const result = Object.freeze({ ...provisional, coinsTotal: this.store.profile.currency.coins, saved })
    this.results.set(snapshot.runId, result)
    return result
  }
}
