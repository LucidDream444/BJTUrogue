/**
 * 真实 HTTP 层的共享底座。**零 Phaser 依赖、fetch 可注入**,所以能在 node 下单测。
 *
 * 为什么把 `fetch` 做成参数而不是直接用全局:单测要模拟 404 / 401 / 409 / 断网,
 * 全局 fetch 没法按 case 换;注入一个长得像 fetch 的函数,断言和造假都直接。
 */

/** 与浏览器 `fetch` 兼容的最小形状,便于测试注入。 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** 服务端返回非 2xx 时抛出。`body` 是尽力解析出来的响应体(拿不到就是 undefined)。 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

/**
 * API 基地址。同源部署(游戏和 API 由同一个 waitress 吐出)时用相对 `/api/` 即可,
 * 零 CORS 问题;以后做安卓(Capacitor)或独立域名部署时,用 `VITE_API_BASE_URL`
 * 覆盖成绝对地址。
 */
export function apiBase(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env
  const base = env?.VITE_API_BASE_URL
  return base ?? '/api/'
}

/** 拼接 API 路径(不含查询串),保证只有一个斜杠。 */
export function apiUrl(path: string): string {
  const base = apiBase()
  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base
  const rel = path.startsWith('/') ? path : `/${path}`
  return `${trimmed}${rel}`
}

/** 从错误响应里尽力挖一个可读的 `detail` 或字段级错误(如 password),挖不到就用状态码兜底。 */
export async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as Record<string, unknown>
    if (typeof body.detail === 'string') return body.detail
    // DRF 字段级错误:{ password: ["太短", "太常见"] } → 拼成一条可读消息。
    for (const [field, value] of Object.entries(body)) {
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
        return `${field}: ${value.join('; ')}`
      }
    }
  } catch {
    // 忽略解析失败
  }
  return `HTTP ${res.status}`
}

/**
 * 带 JSON 请求体 + 可选 Bearer 头的请求。2xx 返回解析后的 JSON(204 返回 undefined),
 * 其余一律抛 `HttpError`。**不在这里做重试/刷新** —— 那是 transport 和 auth 的职责。
 */
export async function jsonRequest<T>(
  fetchImpl: FetchLike,
  url: string,
  init: { method: string; body?: unknown; token?: string | null },
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (init.token) headers['Authorization'] = `Bearer ${init.token}`

  const res = await fetchImpl(url, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })

  if (res.status >= 200 && res.status < 300) {
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = undefined
  }
  throw new HttpError(res.status, await errorMessage(res), body)
}
