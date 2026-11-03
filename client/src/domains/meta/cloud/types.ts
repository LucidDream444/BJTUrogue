import type { ProfileData } from '../profile/types'

/**
 * D5 的 `/api/profile/save/` 响应。适配层负责把 snake_case HTTP 字段
 * 转成这里的 camelCase；云同步内核不直接碰 fetch。
 */
export interface CloudSaveEnvelope {
  payload: unknown
  /** 服务端 `schema_version`，必须与 payload.schemaVersion 一致。 */
  schemaVersion: number
  /** 服务端 `revision`，也是下一次上传使用的 `base_revision`。 */
  revision: number
  updatedAt: string | null
}

/**
 * 每台设备、每个账号各自保存的同步游标。
 *
 * **它不是 ProfileData 的一部分，也不上云**：
 * - `baseRevision` 是这台设备最后一次见过的云端 revision；
 * - `lastSyncedFingerprint` 是当时真正同步的局外内容指纹；
 * - 本地只改音量/显示模式时，ProfileData.revision 会前进，但这里的指纹不变，
 *   所以不会产生一次无意义的云端更新。
 */
export interface CloudSyncMeta {
  schemaVersion: 1
  accountKey: string
  baseRevision: number
  lastSyncedFingerprint: string | null
  lastSyncedAtMs: number | null
}

/** 给冲突界面展示的摘要；只列会影响云档的字段。 */
export interface CloudProgressSummary {
  coins: number
  runs: number
  wins: number
  deaths: number
  bestDepth: number
  unlockedCharacters: string[]
  skillUpgrades: Record<string, number>
  characterId: string
  difficulty: string
  tutorialSeen: boolean
}

export type CloudSyncBlockedCode =
  | 'local-save-failed'
  | 'meta-read-failed'
  | 'meta-account-mismatch'
  | 'invalid-cloud-save'
  | 'cloud-schema-newer'
  | 'cloud-revision-regressed'
  | 'cloud-changed-without-revision'
  | 'cloud-apply-failed'
  | 'local-changed-during-sync'

/**
 * 纯同步决策。真正的 HTTP、JWT、重试队列在后续适配层实现；
 * 这一层只回答“下一步该做什么”，所以能完整跑在 node 测试里。
 */
export type CloudSyncPlan =
  | {
      kind: 'upload'
      baseRevision: number
      profile: ProfileData
      fingerprint: string
    }
  | {
      kind: 'download'
      profile: ProfileData
      revision: number
      fingerprint: string
      /** 发起下载时的本地内容指纹；应用前再次核对，防止网络等待期间本地又变了。 */
      localFingerprint: string
      local: CloudProgressSummary
      cloud: CloudProgressSummary
    }
  | {
      kind: 'up-to-date'
      revision: number
      fingerprint: string
    }
  | {
      kind: 'conflict'
      baseRevision: number
      local: CloudProgressSummary
      cloud: CloudProgressSummary
      differences: string[]
    }
  | {
      kind: 'blocked'
      code: CloudSyncBlockedCode
      message: string
    }

/** 真实 HTTP 适配层把 404 映射成 empty、401/网络错误映射成 error。 */
export type CloudLoadResponse =
  | { kind: 'found'; save: CloudSaveEnvelope }
  | { kind: 'empty' }
  | { kind: 'error'; message: string }

export type CloudUploadResponse =
  | { kind: 'saved'; save: CloudSaveEnvelope }
  | { kind: 'conflict'; revision: number }
  | { kind: 'error'; message: string }

/**
 * 网络只由适配层实现；本接口故意不带账号/密码字段，
 * JWT、refresh 和 Authorization 头都封装在具体 transport 内。
 */
export interface CloudSyncTransport {
  load(): Promise<CloudLoadResponse>
  upload(baseRevision: number, profile: ProfileData): Promise<CloudUploadResponse>
}

export type CloudSyncRunResult =
  | { kind: 'uploaded'; revision: number; fingerprint: string }
  | { kind: 'downloaded'; revision: number; fingerprint: string }
  | { kind: 'up-to-date'; revision: number; fingerprint: string }
  | Extract<CloudSyncPlan, { kind: 'conflict' | 'blocked' }>
  | { kind: 'offline'; message: string }
  | { kind: 'busy' }
  | { kind: 'meta-write-failed'; message: string; synced: boolean }
