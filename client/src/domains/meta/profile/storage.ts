/**
 * 存档的存储后端。**接口在这里，实现有两个：浏览器 `localStorage` 和内存。**
 *
 * ## 为什么必须有一层接口
 *
 * 单测跑在 **node** 环境（`vite.config.ts` 里钉死的），那里没有 `localStorage`。
 * 如果 `ProfileStore` 直接摸 `localStorage`，整个存档模块就**一行都测不到** ——
 * 而存档正是那种「坏了要等玩家丢了进度才发现」的东西。
 *
 * 顺带还有一个好处：内存实现让测试场能在**不碰真存储**的前提下演示
 * 「存储不可用的时候，游戏照常能玩」这条路径。
 *
 * ## 三个方法都会抛
 *
 * `read` / `write` / `remove` **允许抛异常**，这不是设计缺陷，是现实：
 * 隐私模式下的 Safari 连读 `localStorage` 这个属性本身都会抛；
 * 配额满了 `setItem` 会抛 `QuotaExceededError`。
 *
 * 所以约定是：**后端只管抛，`ProfileStore` 负责接住。**
 * 这样"存储坏了怎么办"只有一个地方要想，而不是每个调用点各想一遍。
 */

/** 存档后端。key 由 `ProfileStore` 决定，后端不解释它。 */
export interface ProfileStorage {
  read(key: string): string | null
  write(key: string, value: string): void
  remove(key: string): void
}

/** 内存后端。单测与测试场用；**不持久化，刷新就没**。 */
export class MemoryProfileStorage implements ProfileStorage {
  private readonly map = new Map<string, string>()

  constructor(initial?: Record<string, string>) {
    for (const [k, v] of Object.entries(initial ?? {})) this.map.set(k, v)
  }

  read(key: string): string | null {
    return this.map.get(key) ?? null
  }

  write(key: string, value: string): void {
    this.map.set(key, value)
  }

  remove(key: string): void {
    this.map.delete(key)
  }

  /** 现在存了哪些 key。给单测与测试场看的读数 */
  keys(): string[] {
    return [...this.map.keys()].sort()
  }
}

/**
 * `localStorage` 的最小形状。
 *
 * **故意不 import DOM 的 `Storage` 类型**：单测要构造一个"写就抛"的假后端来验
 * 配额路径，自己声明这三个方法，假后端只要长得像就行。
 */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * 浏览器的 `localStorage` 后端。
 *
 * 取后端本身包在 try 里：有些环境**读 `globalThis.localStorage` 就会抛**
 * （Safari 隐私模式、以及被策略禁掉存储的 iframe）。那种情况下 `backend` 是
 * `null`，`read` 返回 `null`、`write` 抛异常后由 `ProfileStore` 接住 ——
 * 表现出来是"这一局玩得下去，只是没存上"，而不是进场就白屏。
 */
export class LocalStorageProfileStorage implements ProfileStorage {
  private readonly backend: StorageLike | null

  constructor(backend: StorageLike | null = defaultBackend()) {
    this.backend = backend
  }

  /** 存储到底能不能用。**界面要能说出"存档不可用"**，而不是让玩家以为存上了。 */
  get available(): boolean {
    return this.backend !== null
  }

  read(key: string): string | null {
    if (!this.backend) return null
    return this.backend.getItem(key)
  }

  write(key: string, value: string): void {
    if (!this.backend) throw new Error('这个环境下没有可用的 localStorage')
    this.backend.setItem(key, value)
  }

  remove(key: string): void {
    if (!this.backend) return
    this.backend.removeItem(key)
  }
}

function defaultBackend(): StorageLike | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}
