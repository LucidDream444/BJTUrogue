/**
 * 局外档的读写门面。**这就是 D4 对外提供的「存档接口」**（《人员分工方案》§四）：
 * 界面、以及别的域要持久化自己的数据时，都走它，**不自己碰 `localStorage`**。
 *
 * ## 三条不变式（每条都有单测钉着）
 *
 * 1. **`load()` 永不抛异常。** 存储读不出来（隐私模式、被清、配额满）只反映在
 *    返回的 `LoadOutcome` 上。游戏的核心循环不该因为存档挂掉 —— 这跟红线 1
 *    「服务端挂掉不影响游戏」是同一个态度，只是对象换成了本地存储。
 * 2. **`update()` 是先克隆再改，改完才落盘。** mutator 抛异常时内存档保持原样
 *    （不会改到一半），落盘失败时内存档照常可用 —— 玩家这一局继续玩，
 *    只是这一次没存上。
 * 3. **看不懂的档不覆盖。** 版本比本版新 / JSON 坏了 / 迁移链断了，都把原文
 *    **原样备份**到 `PROFILE_BACKUP_KEY`，再另起一份新档。
 *
 * ## 为什么每次 `update()` 都要过一遍 `normalizeProfile()`
 *
 * 它把"改动写错了"从一个**要等下次启动才炸的坏档**，变成一次当场被夹回合法范围的
 * 赋值。代价是每次改动多一次对象构造，量级上可以忽略（这个档只有几十个字段）。
 */

import { createDefaultProfile } from './defaults'
import {
  cloneProfile,
  mergeSettings,
  migrateProfile,
  normalizeProfile,
  type MigrationRegistry,
} from './migrate'
import type { ProfileStorage } from './storage'
import {
  PROFILE_BACKUP_KEY,
  PROFILE_STORAGE_KEY,
  type LoadOutcome,
  type ProfileData,
  type ProfileSelection,
  type ProfileSettings,
} from './types'

/** 档发生变化时通知谁。**设置界面与暂停菜单同步靠的就是它**（需求 §4.5）。 */
export type ProfileStoreEvent = 'loaded' | 'updated' | 'reset'

export type ProfileListener = (profile: ProfileData, event: ProfileStoreEvent) => void

export interface ProfileStoreOptions {
  storage: ProfileStorage
  key?: string
  backupKey?: string
  /** 注入迁移表。**只给测试用**，产品里不传，走真表 */
  migrations?: MigrationRegistry
}

export class ProfileStore {
  private readonly storage: ProfileStorage
  private readonly key: string
  private readonly backupKey: string
  private readonly migrations: MigrationRegistry | undefined

  private current: ProfileData = createDefaultProfile()
  private outcome: LoadOutcome = { status: 'fresh' }
  private error: string | null = null
  private readonly listeners = new Set<ProfileListener>()

  constructor(options: ProfileStoreOptions) {
    this.storage = options.storage
    this.key = options.key ?? PROFILE_STORAGE_KEY
    this.backupKey = options.backupKey ?? PROFILE_BACKUP_KEY
    this.migrations = options.migrations
  }

  // ------------------------------------------------------------------ 读

  /**
   * 从存储读一份档。**把结论返回给调用方，不抛异常。**
   *
   * 迁移成功后**立刻落一次盘**：不落的话下次启动还会走同一条迁移，而
   * "迁移只在内存里发生过"这件事在玩家那边完全看不出来 —— 只有等到某天
   * 那条迁移被删掉，档才会开始读不出来。
   *
   * 全新档**不立刻落盘**：让存储保持空的，直到玩家真的改了什么。
   * 这样"从没玩过的人"和"玩过但没做任何持久化改动的人"在存储里长得一样。
   */
  load(): LoadOutcome {
    let raw: string | null
    try {
      raw = this.storage.read(this.key)
    } catch (err) {
      return this.recover(`存储读不出来：${messageOf(err)}`, null)
    }

    if (raw === null) {
      this.current = createDefaultProfile()
      this.error = null
      return this.finish({ status: 'fresh' })
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return this.recover('存档不是合法 JSON', raw)
    }

    const result = this.migrations
      ? migrateProfile(parsed, this.migrations)
      : migrateProfile(parsed)

    if (result.outcome.status === 'recovered') {
      return this.recover(result.outcome.reason, raw)
    }

    this.current = result.profile
    this.error = null
    if (result.outcome.status === 'migrated') this.save()
    return this.finish(result.outcome)
  }

  /** 当前档。**只读约定** —— 要改走 `update()`，否则改动不会落盘。 */
  get profile(): ProfileData {
    return this.current
  }

  /** 上一次 `load()` 的结论。界面用它决定要不要提示玩家。 */
  get lastOutcome(): LoadOutcome {
    return this.outcome
  }

  /** 上一次存储操作的错误。`null` = 一切正常。 */
  get lastError(): string | null {
    return this.error
  }

  // ------------------------------------------------------------------ 写

  /**
   * 改档并落盘。返回「落盘成功了没有」。
   *
   * ⚠️ 返回 `false` **不代表改动没生效** —— 内存档已经改了，玩家这一局照常玩。
   * 它只表示"这一次没存上"。要提示玩家的话，看 `lastError` 里的原因。
   */
  update(mutate: (draft: ProfileData) => void): boolean {
    let draft: ProfileData
    try {
      draft = cloneProfile(this.current)
      mutate(draft)
    } catch (err) {
      // mutator 自己炸了：**内存档一点不动**。改到一半的档比不改更糟，
      // 它会以一个"看起来正常"的样子落盘。
      this.error = `改档失败：${messageOf(err)}`
      return false
    }

    this.current = normalizeProfile(draft)
    const ok = this.save()
    this.emit('updated')
    return ok
  }

  /** 落盘。存储不可用 / 配额满 → 返回 `false`，不抛。 */
  save(): boolean {
    try {
      this.storage.write(this.key, JSON.stringify(this.current))
      this.error = null
      return true
    } catch (err) {
      this.error = `存档写不进去：${messageOf(err)}`
      // 控制台留一份：画面上有没有提示是界面的事，但排查的人要能看到原因。
      console.warn('[profile]', this.error)
      return false
    }
  }

  /** 清档并写回默认。**只该由玩家主动触发。** */
  reset(): boolean {
    this.current = createDefaultProfile()
    let removed = true
    try {
      this.storage.remove(this.key)
    } catch (err) {
      this.error = `清档失败：${messageOf(err)}`
      removed = false
    }
    const saved = this.save()
    this.emit('reset')
    return removed && saved
  }

  // ------------------------------------------------------------- 常用改动

  /**
   * 改设置。**暂停菜单的「游戏音量」与设置菜单的「BGM 音量」调的是同一个方法**
   * —— 需求 §4.5 那句"改一处两边同步"就是靠"只有一处状态"实现的。
   */
  setSettings(patch: Partial<ProfileSettings>): boolean {
    return this.update((draft) => {
      draft.settings = mergeSettings(draft.settings, patch)
    })
  }

  /** 记住主菜单上的角色 / 难度选择（需求 §4.4：从升级页返回后要保留）。 */
  setSelection(patch: Partial<ProfileSelection>): boolean {
    return this.update((draft) => {
      draft.selected = { ...draft.selected, ...patch }
    })
  }

  // ------------------------------------------------------------- 订阅

  /** 订阅变化。**返回退订函数，场景 shutdown 里必须调**（同 `core/events.ts` 的约定）。 */
  subscribe(fn: ProfileListener): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  // ------------------------------------------------------------- 内部

  /**
   * 走「看不懂的档」这条路：**先把原文备份掉，再换成默认档**。
   *
   * 顺序不能反：先换档后备份的话，中间任何一步失败都会把原文永久丢掉。
   */
  private recover(reason: string, raw: string | null): LoadOutcome {
    if (raw !== null) this.backup(raw)
    this.current = createDefaultProfile()
    return this.finish({ status: 'recovered', reason })
  }

  /** 备份是**尽力而为**：备份失败不能把"继续玩"也一起拖下水。 */
  private backup(raw: string): void {
    try {
      this.storage.write(this.backupKey, raw)
    } catch {
      // 存储本来就坏了，备份写不进去是预期内的事。
      // 这里**不能**改 this.error —— 那条信息是给界面"存档坏了"用的，
      // 被备份的失败覆盖掉的话，玩家看到的提示会变成一句无关的话。
    }
  }

  private finish(outcome: LoadOutcome): LoadOutcome {
    this.outcome = outcome
    this.emit('loaded')
    return outcome
  }

  private emit(event: ProfileStoreEvent): void {
    // 复制一份再遍历：订阅者在回调里退订不会让迭代器失效（同 `TypedBus.emit`）。
    for (const fn of [...this.listeners]) {
      try {
        fn(this.current, event)
      } catch (err) {
        // 一个订阅者炸掉不能拖垮其他订阅者，更不能中断游戏主循环。
        console.error('[profile] 订阅者抛异常：', err)
      }
    }
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
