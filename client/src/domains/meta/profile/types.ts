/**
 * 局外档（profile）的数据形状。**零依赖**：不 import Phaser、不 import 任何域，
 * node 下可直接单测。
 *
 * 这是 D4 的**主档**：解锁、货币、升级次数、设置、统计、上次选择全在里面。
 * 所有界面（主菜单 / 暂停菜单 / 设置 / 结算 / 升级页）都读它，
 * **不各自留一份状态** —— 需求 §4.5 明确要求「暂停菜单的『游戏音量』与设置菜单的
 * 『BGM 音量』是同一组设置，改一处两边同步」，两份状态就是这条需求必然失败的原因。
 *
 * ---
 *
 * ## 红线 3：为什么版本号放在**载荷内部**而不是 key 里
 *
 * 《人员分工方案》§9.4 第 3 条要求「所有本地存档数据带 `schemaVersion` 字段」。
 *
 * 看起来更省事的做法是把版本写进 key（`bjtu-rogue:profile:v1`），但那样
 * **V1 的代码永远找不到 V2 写的档** —— 「迁移」这件事在物理上就没法发生，
 * 新版只会安静地另写一份新档，玩家看到的是解锁凭空消失。
 *
 * 放在载荷内部，新版才读得到旧档、才有机会显式迁移。
 *
 * ## ⚠️ 版本比本版更新时**绝不覆盖**
 *
 * 对应风险 R08 与用例 UC11（版本发布与回退）：玩家用新版玩过之后回退到旧版，
 * 旧版读到一个自己看不懂的档。教科书式错误是「看不懂就当损坏、直接重置」——
 * 那会把玩家在新版里的解锁**原地抹掉**，而且没有任何提示。
 *
 * 本项目的做法是**原样备份、另起一份新档、继续玩**（见 `ProfileStore`），
 * 与《技术选型》§7「回退前检查存档兼容性，不用旧版强行覆盖新存档」一致。
 */

import type { Difficulty } from '@/core/config'

/** 当前 schema 版本。**改字段语义时加一**，并在 `migrate.ts` 里补一步迁移。 */
export const PROFILE_SCHEMA_VERSION = 3

/** 存储 key。**只有一个，且版本不在 key 里**（理由见文件头）。 */
export const PROFILE_STORAGE_KEY = 'bjtu-rogue:profile'

/**
 * 存档「看不懂」时，原文**原样挪到这里，不删**。
 *
 * 为什么不删：那份档里可能装着玩家几十局的解锁，而「看不懂」可能只是一次回退
 * 造成的。删掉不可恢复；留着最多几 KB。真需要清理时，由知道发生了什么的人手动做。
 */
export const PROFILE_BACKUP_KEY = 'bjtu-rogue:profile:backup'

/**
 * 显示模式。默认 **`windowed`** —— **不是**需求 §4.5 草图上写的 `fullscreen`，
 * 理由见 [`defaults.ts`](./defaults.ts) 文件头那条 ⚠️（一句话：浏览器不许页面
 * 在加载时自动进全屏，默认值写全屏 = 设置界面第一帧就在说假话）。
 *
 * **它只是一个偏好值**，应用它必须发生在一次用户点击里（`AGENTS.md` §九 第 3 条）。
 */
export type DisplayMode = 'fullscreen' | 'windowed'

export interface ProfileSettings {
  /** 0..1。需求 §4.5 默认 60%，与暂停菜单的「游戏音量」是同一个值 */
  bgmVolume: number
  /** 0..1。需求 §4.5 默认 80% */
  sfxVolume: number
  displayMode: DisplayMode
}

/**
 * 永久解锁。**死亡不清除** —— 这是需求术语表里「永久解锁」的定义，
 * 也是用户故事验收标准里「已获得的永久解锁不因死亡清除」那一条。
 */
export interface ProfileUnlocks {
  characters: string[]
  skills: string[]
}

export interface ProfileCurrency {
  coins: number
}

/** `"<角色 id>:skill"` → 已付费购买过的技能升级次数（0..3）。 */
export type ProfileUpgrades = Record<string, number>

export interface ProfileStats {
  runs: number
  wins: number
  deaths: number
  /** 到达过的最深层数 —— 结算界面要展示的「到达进度」（需求 UC05） */
  bestDepth: number
}

/**
 * 主菜单上的选择。
 *
 * 为什么要存：需求 §4.4 备注写着「返回后保留主菜单的角色与难度选择」。
 * 只在内存里记的话，刷新一次就回到默认 —— 而那正好是玩家刚调完选择的时候。
 */
export interface ProfileSelection {
  characterId: string
  difficulty: Difficulty
}

export interface ProfileData {
  schemaVersion: number
  settings: ProfileSettings
  unlocks: ProfileUnlocks
  currency: ProfileCurrency
  upgrades: ProfileUpgrades
  stats: ProfileStats
  selected: ProfileSelection
}

/**
 * 一次 `load()` 的结果。**给界面看的**，所以是判别联合而不是一个布尔。
 *
 * 界面对这四种结果该做不同的事：`fresh` 什么都不用说；`migrated` 可以安静通过；
 * `recovered` 则**必须**有个可见的说法 —— 玩家刚丢了一部分进度，
 * 而「存档没读出来」如果只写进控制台，玩家的体验就是「我的解锁莫名其妙没了」。
 */
export type LoadOutcome =
  | { status: 'fresh' }
  | { status: 'loaded' }
  | { status: 'migrated'; from: number; to: number }
  | { status: 'recovered'; reason: string }
