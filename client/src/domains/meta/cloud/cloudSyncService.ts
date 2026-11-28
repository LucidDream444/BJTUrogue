/**
 * 账号云同步服务:把 AuthSession + HTTP transport + CloudSyncCoordinator 接到一个
 * ProfileStore 上。**纯逻辑,不碰 UI** —— 界面(登录框/同步按钮)由场景负责。
 *
 * 登录后会自动订阅 store 的 `saved` 事件做异步上传(战斗结算落盘后触发)。
 * 账号名(accountKey)与 token 一起持久化,刷新页面后能自动恢复会话。
 */
import type { ProfileStore } from '../profile/ProfileStore'
import { LocalStorageProfileStorage } from '../profile/storage'
import type { FetchLike } from './api'
import { AuthSession, type AuthStorage } from './auth'
import { CloudSyncCoordinator } from './coordinator'
import { CloudSyncMetaStore } from './metadata'
import { createHttpCloudSyncTransport } from './httpTransport'
import type { CloudSyncRunResult } from './types'

const ACCOUNT_KEY = 'bjtu-rogue:auth:account'

const DEFAULT_FETCH: FetchLike = (input, init) => fetch(input, init)

export class CloudSyncService {
  private readonly auth: AuthSession
  private readonly storage: AuthStorage
  private readonly fetchImpl: FetchLike
  private coordinator: CloudSyncCoordinator | null = null
  private accountKey: string | null = null
  private unsubscribe: (() => void) | null = null

  constructor(
    private readonly store: ProfileStore,
    fetchImpl: FetchLike = DEFAULT_FETCH,
    storage?: AuthStorage,
  ) {
    this.fetchImpl = fetchImpl
    this.storage = storage ?? new LocalStorageProfileStorage()
    this.auth = new AuthSession(fetchImpl, this.storage)
    // 刷新后 token 还在 → 恢复账号名并重建协调器。
    const restored = this.readAccount()
    if (this.auth.isLoggedIn && restored) this.attach(restored)
  }

  get isLoggedIn(): boolean {
    return this.auth.isLoggedIn
  }

  get currentAccountKey(): string | null {
    return this.accountKey
  }

  async register(username: string, password: string): Promise<void> {
    await this.auth.register(username, password)
    this.persistAccount(username)
    this.attach(username)
  }

  async login(username: string, password: string): Promise<void> {
    await this.auth.login(username, password)
    this.persistAccount(username)
    this.attach(username)
  }

  logout(): void {
    this.auth.logout()
    try {
      this.storage.remove(ACCOUNT_KEY)
    } catch {
      // 忽略
    }
    this.detach()
  }

  /** 立即同步一次。未登录返回 offline。 */
  async sync(): Promise<CloudSyncRunResult> {
    if (!this.coordinator) return { kind: 'offline', message: '未登录' }
    return this.coordinator.sync()
  }

  private attach(username: string): void {
    this.accountKey = username
    const metaStore = new CloudSyncMetaStore(this.storage, username)
    const transport = createHttpCloudSyncTransport(this.auth, this.fetchImpl)
    this.coordinator = new CloudSyncCoordinator({
      accountKey: username,
      store: this.store,
      metaStore,
      transport,
    })
    // 本地写盘成功后异步上传。结算走 `update()` 触发 `updated`,这里 fire-and-forget;
    // 指纹不含音量/显示模式,改设置不会产生无意义的云端上传(见 projection.syncFingerprint)。
    this.unsubscribe = this.store.subscribe((_profile, event) => {
      if ((event === 'updated' || event === 'saved') && this.coordinator) {
        void this.coordinator.sync()
      }
    })
  }

  private detach(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.coordinator = null
    this.accountKey = null
  }

  private persistAccount(username: string): void {
    try {
      this.storage.write(ACCOUNT_KEY, username)
    } catch {
      // 写失败只影响下次免登录,不影响本次
    }
  }

  private readAccount(): string | null {
    try {
      const value = this.storage.read(ACCOUNT_KEY)
      return value && value.trim() ? value.trim() : null
    } catch {
      return null
    }
  }
}
