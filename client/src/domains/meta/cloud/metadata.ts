import type { ProfileStorage } from '../profile/storage'
import type { CloudSyncMeta } from './types'

export const CLOUD_SYNC_META_SCHEMA_VERSION = 1
export const CLOUD_SYNC_META_KEY_PREFIX = 'bjtu-rogue:cloud-sync:'

function accountKeyOf(value: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error('云同步 accountKey 不能为空')
  return normalized
}

/** 账号标识只作为本地 key 的一部分，不会进入 ProfileData 或云存档载荷。 */
export function cloudSyncMetaStorageKey(accountKey: string): string {
  return `${CLOUD_SYNC_META_KEY_PREFIX}${encodeURIComponent(accountKeyOf(accountKey))}`
}

export function createCloudSyncMeta(accountKey: string): CloudSyncMeta {
  return {
    schemaVersion: CLOUD_SYNC_META_SCHEMA_VERSION,
    accountKey: accountKeyOf(accountKey),
    baseRevision: 0,
    lastSyncedFingerprint: null,
    lastSyncedAtMs: null,
  }
}

/** 一次成功上传或下载之后，推进设备游标。 */
export function markCloudSynced(
  accountKey: string,
  revision: number,
  fingerprint: string,
  nowMs: number,
): CloudSyncMeta {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error('云同步 revision 必须是非负安全整数')
  }
  if (!fingerprint) throw new Error('云同步指纹不能为空')
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error('云同步时间必须是非负安全整数')
  }
  return {
    schemaVersion: CLOUD_SYNC_META_SCHEMA_VERSION,
    accountKey: accountKeyOf(accountKey),
    baseRevision: revision,
    lastSyncedFingerprint: fingerprint,
    lastSyncedAtMs: nowMs,
  }
}

/**
 * 元数据损坏或属于另一个账号时返回 `null`，让上层按“首次绑定”重新判断。
 * 这份数据只影响是否需要拉取/上传，丢失它不会丢玩家进度。
 */
export function parseCloudSyncMeta(raw: unknown, accountKey: string): CloudSyncMeta | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (value.schemaVersion !== CLOUD_SYNC_META_SCHEMA_VERSION) return null
  if (value.accountKey !== accountKeyOf(accountKey)) return null
  if (!Number.isSafeInteger(value.baseRevision) || (value.baseRevision as number) < 0) return null
  const fingerprint = value.lastSyncedFingerprint
  if (fingerprint !== null && (typeof fingerprint !== 'string' || fingerprint.length === 0)) {
    return null
  }
  const at = value.lastSyncedAtMs
  if (at !== null && (!Number.isSafeInteger(at) || (at as number) < 0)) return null
  return {
    schemaVersion: 1,
    accountKey: accountKeyOf(accountKey),
    baseRevision: value.baseRevision as number,
    lastSyncedFingerprint: fingerprint,
    lastSyncedAtMs: at as number | null,
  }
}

/**
 * 同步游标的本地存储。它和 ProfileStore 共用后端接口，但使用独立 key；
 * token 不属于这里，后续鉴权层应另存并在退出账号时清理。
 */
export class CloudSyncMetaStore {
  private readonly key: string
  private error: string | null = null

  constructor(
    private readonly storage: ProfileStorage,
    private readonly accountKey: string,
  ) {
    this.key = cloudSyncMetaStorageKey(accountKey)
  }

  get lastError(): string | null {
    return this.error
  }

  load(): CloudSyncMeta | null {
    try {
      const raw = this.storage.read(this.key)
      this.error = null
      if (raw === null) return null
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        this.error = '云同步游标不是合法 JSON'
        return null
      }
      const meta = parseCloudSyncMeta(parsed, this.accountKey)
      if (meta === null) this.error = '云同步游标损坏或属于其他账号'
      return meta
    } catch (err) {
      this.error = `云同步游标读不出来：${messageOf(err)}`
      return null
    }
  }

  save(meta: CloudSyncMeta): boolean {
    if (meta.accountKey !== accountKeyOf(this.accountKey)) {
      this.error = '云同步游标账号不匹配'
      return false
    }
    try {
      this.storage.write(this.key, JSON.stringify(meta))
      this.error = null
      return true
    } catch (err) {
      this.error = `云同步游标写不进去：${messageOf(err)}`
      return false
    }
  }

  clear(): boolean {
    try {
      this.storage.remove(this.key)
      this.error = null
      return true
    } catch (err) {
      this.error = `云同步游标清不掉：${messageOf(err)}`
      return false
    }
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
