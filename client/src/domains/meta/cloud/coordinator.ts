import type { ProfileStore } from '../profile/ProfileStore'
import type { CloudSyncMetaStore } from './metadata'
import { markCloudSynced } from './metadata'
import { syncFingerprint } from './projection'
import { planCloudSync } from './reconcile'
import type {
  CloudLoadResponse,
  CloudSaveEnvelope,
  CloudSyncMeta,
  CloudSyncPlan,
  CloudSyncRunResult,
  CloudSyncTransport,
} from './types'

export interface CloudSyncCoordinatorOptions {
  accountKey: string
  store: ProfileStore
  metaStore: CloudSyncMetaStore
  transport: CloudSyncTransport
  /** 单测注入固定时间；产品默认 Date.now。 */
  now?: () => number
}

/**
 * 一次云同步会话。
 *
 * 它不自动挂到游戏循环上：只能在主菜单/设置页里主动触发，或由同步层在
 * `ProfileStore` 保存成功后的异步回调中调用。战斗循环永远不等待这里。
 *
 * 409 的处理是“重新 GET → 重新判断”，不是立刻拿本地覆盖云端：
 * 如果上次上传其实成功但响应丢了，重新 GET 会得到相同内容并进 up-to-date；
 * 如果两端都真的变过，就停在 conflict 等玩家选择。
 */
export class CloudSyncCoordinator {
  private readonly now: () => number
  private busy = false
  private last: CloudSyncRunResult | null = null

  constructor(private readonly options: CloudSyncCoordinatorOptions) {
    this.now = options.now ?? (() => Date.now())
  }

  get isRunning(): boolean {
    return this.busy
  }

  get lastResult(): CloudSyncRunResult | null {
    return this.last
  }

  async sync(): Promise<CloudSyncRunResult> {
    if (this.busy) return this.remember({ kind: 'busy' })
    this.busy = true
    try {
      // 本地都没写成功时连 GET 都不发：任何“同步成功”提示都会是假的。
      if (this.options.store.lastError !== null) {
        return this.remember({
          kind: 'blocked',
          code: 'local-save-failed',
          message: '本地存档没有写入成功；为避免云端领先于本机，本次不上传。',
        })
      }

      const meta = this.options.metaStore.load()
      if (this.options.metaStore.lastError !== null) {
        return this.remember({
          kind: 'blocked',
          code: 'meta-read-failed',
          message: this.options.metaStore.lastError,
        })
      }

      let loaded = await this.options.transport.load()
      if (loaded.kind === 'error') return this.remember(offline(loaded))

      // 第一次执行；如果 PUT 返回 409，则重新 GET 后再判断一次，最多两轮。
      for (let attempt = 0; attempt < 2; attempt++) {
        const plan = this.plan(loaded, meta)
        if (plan.kind === 'conflict' || plan.kind === 'blocked') return this.remember(plan)
        if (plan.kind === 'download') {
          if (syncFingerprint(this.options.store.profile) !== plan.localFingerprint) {
            return this.remember({
              kind: 'blocked',
              code: 'local-changed-during-sync',
              message: '等待云端期间本地进度又发生了变化，请重新同步。',
            })
          }
          if (!this.options.store.applyCloudProfile(plan.profile)) {
            return this.remember({
              kind: 'blocked',
              code: 'cloud-apply-failed',
              message: '云端档已取回，但无法安全应用到本机。',
            })
          }
          return this.remember(this.finish('downloaded', plan.revision, plan.fingerprint))
        }
        if (plan.kind === 'up-to-date') {
          return this.remember(this.finish('up-to-date', plan.revision, plan.fingerprint))
        }

        const uploaded = await this.options.transport.upload(plan.baseRevision, plan.profile)
        if (uploaded.kind === 'saved') {
          return this.remember(this.finish('uploaded', uploaded.save.revision, plan.fingerprint))
        }
        if (uploaded.kind === 'error') return this.remember(offline(uploaded))
        loaded = await this.options.transport.load()
        if (loaded.kind === 'error') return this.remember(offline(loaded))
      }

      return this.remember({
        kind: 'blocked',
        code: 'invalid-cloud-save',
        message: '云端冲突在重新拉取后仍未收敛，停止自动同步。',
      })
    } catch (err) {
      return this.remember({ kind: 'offline', message: messageOf(err) })
    } finally {
      this.busy = false
    }
  }

  private plan(loaded: CloudLoadResponse, meta: CloudSyncMeta | null): CloudSyncPlan {
    return planCloudSync({
      accountKey: this.options.accountKey,
      local: this.options.store.profile,
      meta,
      cloud: envelopeOf(loaded),
      localSaveOk: this.options.store.lastError === null,
    })
  }

  private finish(
    kind: 'uploaded' | 'downloaded' | 'up-to-date',
    revision: number,
    fingerprint: string,
  ): CloudSyncRunResult {
    const meta = markCloudSynced(this.options.accountKey, revision, fingerprint, this.now())
    if (!this.options.metaStore.save(meta)) {
      return {
        kind: 'meta-write-failed',
        synced: true,
        message: this.options.metaStore.lastError ?? '云同步游标写入失败',
      }
    }
    return { kind, revision, fingerprint }
  }

  private remember(result: CloudSyncRunResult): CloudSyncRunResult {
    this.last = result
    return result
  }
}

function envelopeOf(response: CloudLoadResponse): CloudSaveEnvelope | null {
  return response.kind === 'found' ? response.save : null
}

function offline(response: { message: string }): CloudSyncRunResult {
  return { kind: 'offline', message: response.message }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
