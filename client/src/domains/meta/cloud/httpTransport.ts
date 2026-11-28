/**
 * 真实 HTTP transport:把 `/api/profile/save/` 接到云同步协调器。
 *
 * 实现 `CloudSyncTransport`(见 `types.ts`)。协调器完全不知道这里在发 HTTP ——
 * 它只见到 `load()` / `upload()` 的语义化结果。这里负责:
 * - 信封字段 snake_case → camelCase(`schema_version` → `schemaVersion`);
 * - 404 映射成 `empty`(客户端第一次同步);
 * - 401 先刷新 access 再重试一次,还不行就归为 `error`(离线优先,绝不让游戏等网络);
 * - 409 从响应体里挖出服务端当前 `revision`,交给协调器决定是否重新 GET。
 */
import type { ProfileData } from '../profile/types'
import type {
  CloudLoadResponse,
  CloudSaveEnvelope,
  CloudSyncTransport,
  CloudUploadResponse,
} from './types'
import { apiUrl, HttpError, jsonRequest } from './api'
import type { FetchLike } from './api'
import type { AuthSession } from './auth'

/** 服务端信封(字段是 snake_case)。 */
interface RawEnvelope {
  payload: unknown
  schema_version: number
  revision: number
  updated_at: string | null
}

function toEnvelope(raw: RawEnvelope): CloudSaveEnvelope {
  return {
    payload: raw.payload,
    schemaVersion: raw.schema_version,
    revision: raw.revision,
    updatedAt: raw.updated_at,
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 请求失败时如果是 401,刷新一次 access 再重试;否则把错误原样抛回。 */
async function withRefresh<T>(
  session: AuthSession,
  run: (token: string | null) => Promise<T>,
): Promise<T> {
  try {
    return await run(session.accessToken)
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      const refreshed = await session.refresh()
      if (refreshed) return await run(session.accessToken)
    }
    throw err
  }
}

/**
 * 构造一个真实 HTTP 的云同步 transport。`session` 提供 access token 与刷新能力,
 * `fetchImpl` 可注入(测试用假 fetch)。
 */
export function createHttpCloudSyncTransport(
  session: AuthSession,
  fetchImpl: FetchLike,
): CloudSyncTransport {
  return {
    async load(): Promise<CloudLoadResponse> {
      try {
        return await withRefresh(session, async (token) => {
          const raw = await jsonRequest<RawEnvelope>(fetchImpl, apiUrl('profile/save/'), {
            method: 'GET',
            token,
          })
          return { kind: 'found', save: toEnvelope(raw) } as CloudLoadResponse
        })
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) return { kind: 'empty' }
        return { kind: 'error', message: messageOf(err) }
      }
    },

    async upload(baseRevision: number, profile: ProfileData): Promise<CloudUploadResponse> {
      try {
        return await withRefresh(session, async (token) => {
          const raw = await jsonRequest<RawEnvelope>(fetchImpl, apiUrl('profile/save/'), {
            method: 'PUT',
            token,
            body: { base_revision: baseRevision, profile },
          })
          return { kind: 'saved', save: toEnvelope(raw) } as CloudUploadResponse
        })
      } catch (err) {
        if (err instanceof HttpError && err.status === 409) {
          const body = err.body as { revision?: unknown } | undefined
          const revision = typeof body?.revision === 'number' ? body.revision : 0
          return { kind: 'conflict', revision }
        }
        return { kind: 'error', message: messageOf(err) }
      }
    },
  }
}
