import { migrateProfile } from '../profile/migrate'
import { PROFILE_SCHEMA_VERSION, type ProfileData } from '../profile/types'
import {
  cloudProfileForUpload,
  cloudProgressSummary,
  currentSyncFingerprint,
  hasMeaningfulLocalProgress,
  progressDifferences,
  syncFingerprint,
} from './projection'
import type { CloudSaveEnvelope, CloudSyncMeta, CloudSyncPlan } from './types'

type BlockedPlan = Extract<CloudSyncPlan, { kind: 'blocked' }>

export interface CloudSyncInput {
  accountKey: string
  local: ProfileData
  /** 这台设备、这个账号上一次成功同步到的云端位置。首次绑定为 null。 */
  meta: CloudSyncMeta | null
  /** GET 成功为 envelope，服务端 404 为 null。网络错误应在进入这里前单独处理。 */
  cloud: CloudSaveEnvelope | null
  /** ProfileStore.update() 是否成功写入了本机；失败时绝不能上传“只在内存里”的档。 */
  localSaveOk: boolean
}

/**
 * 纯决策函数：**不读存储、不发网络、不改任何输入**。
 *
 * 以后真实控制器只需要执行返回的 upload / download，然后在成功后写同步游标。
 * 409 也使用同一套判断：重新 GET 后把新 envelope 再喂一次，就不会静默覆盖。
 */
export function planCloudSync(input: CloudSyncInput): CloudSyncPlan {
  if (!input.localSaveOk) {
    return blocked('local-save-failed', '本地存档没有写入成功；为避免云端领先于本机，本次不上传。')
  }
  if (input.meta && input.meta.accountKey !== input.accountKey.trim()) {
    return blocked('meta-account-mismatch', '同步游标属于另一个账号。')
  }

  const localFingerprint = syncFingerprint(input.local)
  const syncedFingerprint = currentSyncFingerprint(input.meta?.lastSyncedFingerprint ?? null)
  const cloud = input.cloud ? readCloud(input.cloud) : null
  if (cloud && 'code' in cloud) return cloud

  const remote = cloud?.profile ?? null
  const remoteRevision = cloud?.revision ?? 0
  const remoteFingerprint = remote ? syncFingerprint(remote) : null

  if (input.meta && cloud && cloud.revision < input.meta.baseRevision) {
    return blocked(
      'cloud-revision-regressed',
      `云端 revision ${cloud.revision} 小于本机记录的 ${input.meta.baseRevision}，拒绝覆盖。`,
    )
  }
  if (
    input.meta &&
    cloud &&
    cloud.revision === input.meta.baseRevision &&
    syncedFingerprint !== null &&
    remoteFingerprint !== syncedFingerprint
  ) {
    return blocked(
      'cloud-changed-without-revision',
      '云端内容在 revision 不变的情况下发生变化，无法安全判断新旧。',
    )
  }

  if (remote && remoteFingerprint === localFingerprint) {
    return {
      kind: 'up-to-date',
      revision: remoteRevision,
      fingerprint: localFingerprint,
    }
  }

  if (!input.meta) {
    if (!remote) {
      return upload(input.local, 0, localFingerprint)
    }
    if (!hasMeaningfulLocalProgress(input.local)) {
      return download(remote, remoteRevision, remoteFingerprint!, input.local)
    }
    return conflict(input.local, remote, remoteRevision)
  }

  if (!remote) {
    // 云端被删除（GET 404）时，本地进度仍然是权威来源；下一次上传重新建档。
    return upload(input.local, 0, localFingerprint)
  }

  const localChanged =
    syncedFingerprint === null || syncedFingerprint !== localFingerprint
  const cloudChanged = remoteRevision !== input.meta.baseRevision

  if (localChanged && !cloudChanged) {
    return upload(input.local, input.meta.baseRevision, localFingerprint)
  }
  if (!localChanged && cloudChanged) {
    return download(remote, remoteRevision, remoteFingerprint!, input.local)
  }
  if (localChanged && cloudChanged) {
    return conflict(input.local, remote, remoteRevision)
  }
  return {
    kind: 'up-to-date',
    revision: remoteRevision,
    fingerprint: localFingerprint,
  }
}

function upload(profile: ProfileData, baseRevision: number, fingerprint: string): CloudSyncPlan {
  const revision = Math.max(profile.revision, baseRevision + 1)
  return {
    kind: 'upload',
    baseRevision,
    profile: cloudProfileForUpload(profile, revision),
    fingerprint,
  }
}

function download(
  profile: ProfileData,
  revision: number,
  fingerprint: string,
  local: ProfileData,
): CloudSyncPlan {
  return {
    kind: 'download',
    profile,
    revision,
    fingerprint,
    localFingerprint: syncFingerprint(local),
    local: cloudProgressSummary(local),
    cloud: cloudProgressSummary(profile),
  }
}

function conflict(local: ProfileData, cloud: ProfileData, cloudRevision: number): CloudSyncPlan {
  const localSummary = cloudProgressSummary(local)
  const cloudSummary = cloudProgressSummary(cloud)
  return {
    kind: 'conflict',
    baseRevision: cloudRevision,
    local: localSummary,
    cloud: cloudSummary,
    differences: progressDifferences(localSummary, cloudSummary),
  }
}

function blocked(code: BlockedPlan['code'], message: string): BlockedPlan {
  return { kind: 'blocked', code, message }
}

function readCloud(
  envelope: CloudSaveEnvelope,
): { profile: ProfileData; revision: number } | BlockedPlan {
  if (
    !Number.isSafeInteger(envelope.revision) ||
    envelope.revision < 0 ||
    !Number.isSafeInteger(envelope.schemaVersion) ||
    envelope.schemaVersion < 1
  ) {
    return blocked('invalid-cloud-save', '云端响应的 schema/revision 无效。')
  }
  const payloadSchema = schemaVersionOf(envelope.payload)
  if (payloadSchema === null || payloadSchema !== envelope.schemaVersion) {
    return blocked('invalid-cloud-save', '云端信封与 payload 的 schemaVersion 不一致。')
  }
  if (payloadSchema > PROFILE_SCHEMA_VERSION) {
    return blocked(
      'cloud-schema-newer',
      `云端存档版本 ${payloadSchema} 高于本版 ${PROFILE_SCHEMA_VERSION}，拒绝覆盖。`,
    )
  }

  const migrated = migrateProfile(envelope.payload)
  if (migrated.outcome.status === 'recovered') {
    return blocked('invalid-cloud-save', `云端存档无法迁移：${migrated.outcome.reason}`)
  }
  if (migrated.profile.revision !== envelope.revision) {
    return blocked('invalid-cloud-save', '云端信封 revision 与 payload.revision 不一致。')
  }
  return { profile: migrated.profile, revision: envelope.revision }
}

function schemaVersionOf(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
  const value = (payload as Record<string, unknown>).schemaVersion
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : null
}
