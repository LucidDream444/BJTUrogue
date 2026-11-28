/**
 * 账号会话:注册 / 登录 / 刷新 / 登出,以及 token 落盘。**不做任何 UI**。
 *
 * token 存哪、怎么存,这里只依赖一个极小的 `AuthStorage`(和 `ProfileStorage`
 * 一个形状),所以浏览器用 localStorage、测试用内存,同一个类都不变。
 *
 * 为什么要缓存 token:主菜单打开时不该每次都弹登录。登录一次,把 access/refresh
 * 记下来,后续云同步直接带 access;access 过期(30 分钟)用 refresh 换新的。
 */
import { apiUrl, jsonRequest } from './api'
import type { FetchLike } from './api'

export interface AuthTokens {
  access: string
  refresh: string
}

/** token 的存储后端(和 `ProfileStorage` 同形状,但用独立 key)。 */
export interface AuthStorage {
  read(key: string): string | null
  write(key: string, value: string): void
  remove(key: string): void
}

const TOKEN_KEY = 'bjtu-rogue:auth:tokens'

export class AuthSession {
  private tokens: AuthTokens | null

  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly storage: AuthStorage,
  ) {
    this.tokens = this.loadTokens()
  }

  get isLoggedIn(): boolean {
    return this.tokens !== null
  }

  /** 当前缓存的 access token;未登录为 null。 */
  get accessToken(): string | null {
    return this.tokens?.access ?? null
  }

  /** 注册成功后立即登录,拿到 token。 */
  async register(username: string, password: string): Promise<void> {
    await jsonRequest(this.fetchImpl, apiUrl('auth/register/'), {
      method: 'POST',
      body: { username, password },
    })
    await this.login(username, password)
  }

  async login(username: string, password: string): Promise<void> {
    const tokens = await jsonRequest<AuthTokens>(this.fetchImpl, apiUrl('auth/token/'), {
      method: 'POST',
      body: { username, password },
    })
    this.setTokens(tokens)
  }

  /** 用 refresh token 换新 access;失败返回 false 并清空会话。 */
  async refresh(): Promise<boolean> {
    if (!this.tokens) return false
    try {
      const data = await jsonRequest<{ access: string }>(
        this.fetchImpl,
        apiUrl('auth/refresh/'),
        { method: 'POST', body: { refresh: this.tokens.refresh } },
      )
      this.tokens = { access: data.access, refresh: this.tokens.refresh }
      this.persist()
      return true
    } catch {
      this.clear()
      return false
    }
  }

  logout(): void {
    this.clear()
  }

  private setTokens(tokens: AuthTokens): void {
    this.tokens = tokens
    this.persist()
  }

  private clear(): void {
    this.tokens = null
    try {
      this.storage.remove(TOKEN_KEY)
    } catch {
      // 清不掉也不影响:内存里已经登出
    }
  }

  private persist(): void {
    if (!this.tokens) return
    try {
      this.storage.write(TOKEN_KEY, JSON.stringify(this.tokens))
    } catch {
      // 写盘失败只影响"下次免登录",不影响本次会话
    }
  }

  private loadTokens(): AuthTokens | null {
    try {
      const raw = this.storage.read(TOKEN_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as AuthTokens
      if (typeof parsed.access !== 'string' || typeof parsed.refresh !== 'string') return null
      return parsed
    } catch {
      return null
    }
  }
}
