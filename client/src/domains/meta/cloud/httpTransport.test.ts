import { describe, expect, it } from 'vitest'
import { createDefaultProfile } from '../profile/defaults'
import { MemoryProfileStorage } from '../profile/storage'
import type { FetchLike } from './api'
import { AuthSession } from './auth'
import { createHttpCloudSyncTransport } from './httpTransport'

function response(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 按 URL 分派的假 fetch,没匹配到就返回 500。 */
function fakeFetch(routes: Record<string, (init?: RequestInit) => Response>): FetchLike {
  return async (input, init) => {
    const url = String(input)
    for (const [key, fn] of Object.entries(routes)) {
      if (url.includes(key)) return fn(init)
    }
    return response(500, { detail: `未匹配的 URL: ${url}` })
  }
}

function rawEnvelope(revision = 1): unknown {
  return {
    payload: { schemaVersion: 6, revision },
    schema_version: 6,
    revision,
    updated_at: '2026-11-28T00:00:00Z',
  }
}

describe('AuthSession', () => {
  it('login 后缓存 access/refresh 并落盘', async () => {
    const storage = new MemoryProfileStorage()
    const fetch = fakeFetch({
      'auth/token/': () => response(200, { access: 'A', refresh: 'R' }),
    })
    const session = new AuthSession(fetch, storage)

    await session.login('alice', 'pw123456')

    expect(session.isLoggedIn).toBe(true)
    expect(session.accessToken).toBe('A')
    // 落盘后,新会话能直接恢复(免登录)
    const reloaded = new AuthSession(fetch, storage)
    expect(reloaded.isLoggedIn).toBe(true)
    expect(reloaded.accessToken).toBe('A')
  })

  it('register 先注册再登录', async () => {
    const calls: string[] = []
    const fetch = fakeFetch({
      'auth/register/': () => {
        calls.push('register')
        return response(201, { username: 'alice' })
      },
      'auth/token/': () => {
        calls.push('token')
        return response(200, { access: 'A', refresh: 'R' })
      },
    })
    const session = new AuthSession(fetch, new MemoryProfileStorage())

    await session.register('alice', 'pw123456')

    expect(calls).toEqual(['register', 'token'])
    expect(session.isLoggedIn).toBe(true)
  })

  it('refresh 成功后替换 access 并保留 refresh', async () => {
    const storage = new MemoryProfileStorage()
    const fetch = fakeFetch({
      'auth/token/': () => response(200, { access: 'OLD', refresh: 'R' }),
      'auth/refresh/': () => response(200, { access: 'NEW' }),
    })
    const session = new AuthSession(fetch, storage)
    await session.login('alice', 'pw123456')

    const ok = await session.refresh()

    expect(ok).toBe(true)
    expect(session.accessToken).toBe('NEW')
  })

  it('refresh 失败会登出', async () => {
    const storage = new MemoryProfileStorage()
    const fetch = fakeFetch({
      'auth/token/': () => response(200, { access: 'A', refresh: 'R' }),
      'auth/refresh/': () => response(401, { detail: '过期' }),
    })
    const session = new AuthSession(fetch, storage)
    await session.login('alice', 'pw123456')

    const ok = await session.refresh()

    expect(ok).toBe(false)
    expect(session.isLoggedIn).toBe(false)
  })
})

describe('createHttpCloudSyncTransport', () => {
  const profile = createDefaultProfile()
  const token = { access: 'A', refresh: 'R' }

  async function loggedInSession(routes: Record<string, (init?: RequestInit) => Response>) {
    const fetch = fakeFetch({
      'auth/token/': () => response(200, token),
      ...routes,
    })
    const session = new AuthSession(fetch, new MemoryProfileStorage())
    await session.login('alice', 'pw123456')
    return { session, fetch }
  }

  it('load: 200 映射成 found,信封转 camelCase', async () => {
    const { session } = await loggedInSession({
      'profile/save/': () => response(200, rawEnvelope(7)),
    })
    const transport = createHttpCloudSyncTransport(session, async () =>
      response(200, rawEnvelope(7)),
    )

    const result = await transport.load()

    expect(result).toEqual({
      kind: 'found',
      save: {
        payload: { schemaVersion: 6, revision: 7 },
        schemaVersion: 6,
        revision: 7,
        updatedAt: '2026-11-28T00:00:00Z',
      },
    })
  })

  it('load: 404 映射成 empty', async () => {
    const { session } = await loggedInSession({})
    const transport = createHttpCloudSyncTransport(
      session,
      fakeFetch({ 'profile/save/': () => response(404, { detail: '还没有云存档' }) }),
    )

    expect(await transport.load()).toEqual({ kind: 'empty' })
  })

  it('load: 网络错误映射成 error(不抛)', async () => {
    const { session } = await loggedInSession({})
    const transport = createHttpCloudSyncTransport(session, async () => {
      throw new Error('network down')
    })

    const result = await transport.load()
    expect(result.kind).toBe('error')
  })

  it('upload: 409 映射成 conflict,并带回服务端 revision', async () => {
    const { session } = await loggedInSession({})
    const transport = createHttpCloudSyncTransport(
      session,
      fakeFetch({
        'profile/save/': () =>
          response(409, { detail: '冲突', revision: 9, updated_at: '2026-11-28T00:00:00Z' }),
      }),
    )

    expect(await transport.upload(3, profile)).toEqual({ kind: 'conflict', revision: 9 })
  })

  it('load: 401 时先 refresh 再重试一次', async () => {
    const { session } = await loggedInSession({
      'auth/refresh/': () => response(200, { access: 'NEW' }),
    })
    let loadCount = 0
    const transport = createHttpCloudSyncTransport(session, async () => {
      loadCount++
      if (loadCount === 1) return response(401, { detail: '过期' })
      return response(200, rawEnvelope(2))
    })

    const result = await transport.load()

    expect(loadCount).toBe(2)
    expect(session.accessToken).toBe('NEW')
    expect(result.kind).toBe('found')
  })
})
