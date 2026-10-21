/**
 * 版本判定 + 逐版本迁移 + 形状收敛。**零依赖、零 Phaser**，node 下可直接单测。
 *
 * ## 迁移是**显式的一步一步**，不是"尽力修补"
 *
 * 迁移表是 `旧版本号 → 一步函数`。从 v1 到 v4 就是走三步，每一步只负责
 * 「加 / 改这一版引入的东西」。
 *
 * 为什么不用「读到什么字段就补什么字段」那种宽容式修补：那样**没有中间状态**，
 * 一次启动从 v1 直接跳到 v4，中间三步的语义差异全被抹平。等发现某个字段的语义
 * 在 v2 和 v3 之间变过（比如"金币"从"总局数"改成"当前余额"），
 * 已经没有任何地方能表达这件事了。
 *
 * 迁移表里**缺一步就报 recovered**，不猜。
 *
 * ## 收敛（`normalizeProfile`）负责的另一半
 *
 * 迁移之后、以及每次改动落盘之前，形状都过一遍 `normalizeProfile()`。
 * 它只做三件事：**缺字段补默认、越界值钳制、类型不对换默认**。它不负责版本 ——
 * 版本已经在进来之前判定完了。
 *
 * 「每次改动都收敛一遍」是刻意的：任何一处改动代码写错（把音量改成 5、
 * 把难度写成 `'normal '`）都会在落盘**之前**被夹回合法范围，
 * 而不是变成一个要等下次启动才炸的坏档。
 */

import { DIFFICULTIES, type Difficulty } from '@/core/config'
import { createDefaultProfile } from './defaults'
import {
  PROFILE_SCHEMA_VERSION,
  type DisplayMode,
  type LoadOutcome,
  type ProfileData,
  type ProfileSettings,
  type ProfileUpgrades,
} from './types'

/** 一步迁移：吃上一版的原始对象，吐下一版的对象。**不要在这里读配置或碰引擎。** */
export type MigrationStep = (data: Record<string, unknown>) => Record<string, unknown>

/** `旧版本号 → 一步函数`。 */
export type MigrationRegistry = Readonly<Record<number, MigrationStep>>

export const MIGRATIONS: MigrationRegistry = {
  1: migrateV1ToV2,
}

/**
 * 迁移步数的上限。**这不是"够用就行"的数字，是防死循环的。**
 * 迁移表里写错一个指针（比如 2 → 2）就会原地打转，
 * 而没有上限时它表现为「打开游戏卡死」，查起来毫无头绪。
 */
const MAX_MIGRATION_STEPS = 64

/** 金币上限。防的是坏档 / 调参手滑写出 `Number.MAX_SAFE_INTEGER`，界面上一串数字溢出。 */
const MAX_COINS = 999_999_999

/** 各项计数的上限，同上。 */
const MAX_COUNTER = 999_999_999

/** 解锁列表的长度上限。**不做去重**：重复 id 无害，而静默去重会掩盖写入方的 bug。 */
const MAX_IDS = 64

const DISPLAY_MODES: readonly DisplayMode[] = ['fullscreen', 'windowed']

export interface ProfileLoadResult {
  profile: ProfileData
  outcome: LoadOutcome
}

export type MigrationOutcome =
  | { ok: true; data: Record<string, unknown>; from: number; to: number }
  | { ok: false; reason: string }

/**
 * 从 `from` 走到 `to`，每一步都必须在表里。
 *
 * **单独导出是为了能测它。** 真实迁移表和注入表都可能出错，而"迁移链断了一节"
 * 恰恰是那种要等玩家跨版本升级时才炸的东西。`to` 可传，测试就能用一张假表把
 * 「三步链走通 / 中间缺一步 / 表打转」三种情况都跑一遍。
 */
export function runMigrations(
  data: Record<string, unknown>,
  from: number,
  to: number,
  migrations: MigrationRegistry = MIGRATIONS,
): MigrationOutcome {
  let current = data
  let cursor = from
  let steps = 0
  while (cursor < to) {
    const step = migrations[cursor]
    if (!step) return { ok: false, reason: `迁移链断了：没有 ${cursor} → ${cursor + 1} 这一步` }
    current = step(current)
    cursor += 1
    steps += 1
    if (steps > MAX_MIGRATION_STEPS) {
      return { ok: false, reason: '迁移步数超限（迁移表打转了）' }
    }
  }
  return { ok: true, data: current, from, to: cursor }
}

/**
 * 把一份**已经 `JSON.parse` 过**的东西变成一份合法档 + 一个结论。
 *
 * `migrations` 可注入，是为了能测「迁移链走通了没有」；它恰恰是最不能出错的一段。
 */
export function migrateProfile(
  raw: unknown,
  migrations: MigrationRegistry = MIGRATIONS,
): ProfileLoadResult {
  if (raw === null || raw === undefined) {
    return { profile: createDefaultProfile(), outcome: { status: 'fresh' } }
  }

  const root = asRecord(raw)
  const version = readVersion(root)
  if (version === null) {
    return recovered('存档里没有可用的 schemaVersion（这不是一份本项目的档）')
  }
  if (version > PROFILE_SCHEMA_VERSION) {
    return recovered(
      `存档版本 ${version} 比本版（${PROFILE_SCHEMA_VERSION}）新 —— 不覆盖它，另起一份新档`,
    )
  }

  const stepped = runMigrations(root, version, PROFILE_SCHEMA_VERSION, migrations)
  if (!stepped.ok) return recovered(stepped.reason)

  const profile = normalizeProfile(stepped.data)
  return {
    profile,
    outcome:
      stepped.to === version
        ? { status: 'loaded' }
        : { status: 'migrated', from: version, to: stepped.to },
  }
}

/**
 * 把任意形状收敛成一份合法档。**同版本内缺字段补默认，不报错。**
 *
 * 为什么同版本内的缺失不报错：字段仍可能随小版本调整。
 * 「当前版本的档少了一个当前字段」只可能是这一版自己写坏的，
 * 而这种情况下**补默认继续玩**远好于把玩家的档判死。
 */
export function normalizeProfile(raw: unknown): ProfileData {
  const root = asRecord(raw)
  const fallback = createDefaultProfile()
  const settings = asRecord(root.settings)
  const unlocks = asRecord(root.unlocks)
  const currency = asRecord(root.currency)
  const stats = asRecord(root.stats)
  const selected = asRecord(root.selected)
  const selectedId = id(selected.characterId, fallback.selected.characterId)

  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    settings: {
      bgmVolume: unit(settings.bgmVolume, fallback.settings.bgmVolume),
      sfxVolume: unit(settings.sfxVolume, fallback.settings.sfxVolume),
      displayMode: asDisplayMode(settings.displayMode, fallback.settings.displayMode),
    },
    unlocks: {
      characters: idList(unlocks.characters, fallback.unlocks.characters).filter(
        (characterId) => characterId !== 'leader',
      ),
      skills: idList(unlocks.skills, fallback.unlocks.skills),
    },
    currency: {
      coins: boundedInt(currency.coins, fallback.currency.coins, 0, MAX_COINS),
    },
    upgrades: upgradeMap(root.upgrades),
    stats: {
      runs: boundedInt(stats.runs, 0, 0, MAX_COUNTER),
      wins: boundedInt(stats.wins, 0, 0, MAX_COUNTER),
      deaths: boundedInt(stats.deaths, 0, 0, MAX_COUNTER),
      bestDepth: boundedInt(stats.bestDepth, 0, 0, MAX_COUNTER),
    },
    selected: {
      characterId: selectedId === 'leader' ? fallback.selected.characterId : selectedId,
      difficulty: asDifficulty(selected.difficulty, fallback.selected.difficulty),
    },
  }
}

/** 同一份档的深拷贝。档是纯 JSON 形状，所以这条最短的路径就是对的。 */
export function cloneProfile(profile: ProfileData): ProfileData {
  return JSON.parse(JSON.stringify(profile)) as ProfileData
}

// ------------------------------------------------------------------ 内部

function recovered(reason: string): ProfileLoadResult {
  return { profile: createDefaultProfile(), outcome: { status: 'recovered', reason } }
}

/**
 * v2 把局外「护甲」改成「护盾上限」、把「能量上限」的旧 key `magic`
 * 改成 `maxEnergy`，同时删除第四角色「社团长」。
 *
 * 数值语义仍然都是“点”，所以不换算 `+1` 与 `+5` 的历史等级：
 * 迁移的是**玩家已经买的等级**，不是当时的属性效果。升到几级就保留几级；
 * v2 配置里的每级增量从 1 点变成 5 点，会在下一次计算最终护盾时自然生效。
 */
function migrateV1ToV2(data: Record<string, unknown>): Record<string, unknown> {
  const upgrades = { ...asRecord(data.upgrades) }
  for (const [key, value] of Object.entries(upgrades)) {
    const suffix = key.endsWith(':armor')
      ? ':armor'
      : key.endsWith(':magic')
        ? ':magic'
        : null
    if (suffix === null) continue
    const nextKey =
      key.slice(0, -suffix.length) + (suffix === ':armor' ? ':maxShield' : ':maxEnergy')
    const oldLevel = num(value, 0)
    const existing = num(upgrades[nextKey], 0)
    upgrades[nextKey] = Math.max(existing, oldLevel)
    delete upgrades[key]
  }
  const unlocks = asRecord(data.unlocks)
  const characters = Array.isArray(unlocks.characters)
    ? unlocks.characters.filter((id) => id !== 'leader')
    : unlocks.characters
  const selected = asRecord(data.selected)
  return {
    ...data,
    schemaVersion: 2,
    upgrades,
    unlocks: { ...unlocks, characters },
    selected: {
      ...selected,
      characterId: selected.characterId === 'leader' ? 'student' : selected.characterId,
    },
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

function readVersion(root: Record<string, unknown>): number | null {
  const v = root.schemaVersion
  // v1 是**第一版**，所以 0 / 负数 / 非整数都算"不是本项目的档"。
  // 等到真要引入 v0（比如内测包）时，条件放宽到下界 0，并补一条 0 → 1 的迁移。
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return null
  return v
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function boundedInt(v: unknown, fallback: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(num(v, fallback))))
}

/** 0..1 的比例（音量）。**超界钳制而不是取默认** —— 写 5 显然是想表达"最大声"。 */
function unit(v: unknown, fallback: number): number {
  return Math.min(1, Math.max(0, num(v, fallback)))
}

function id(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback
}

/**
 * 解锁 id 列表。数组就照收（**空数组是合法的**：玩家可以什么都没解锁），
 * 非数组才回落到默认。
 *
 * **不校验 id 是否存在**：角色 / 技能目录还没定稿，而且丢掉一个本版不认识的 id
 * 等于永久删除玩家的解锁 —— 那个 id 可能只是来自更新的版本。
 * 「本版认不认得」由界面渲染时按目录过滤，不是丢掉数据的理由。
 */
function idList(v: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(v)) return [...fallback]
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0).slice(0, MAX_IDS)
}

function upgradeMap(v: unknown): ProfileUpgrades {
  const out: ProfileUpgrades = {}
  for (const [key, value] of Object.entries(asRecord(v))) {
    if (key.length === 0) continue
    out[key] = boundedInt(value, 0, 0, MAX_COUNTER)
  }
  return out
}

function asDifficulty(v: unknown, fallback: Difficulty): Difficulty {
  return typeof v === 'string' && (DIFFICULTIES as readonly string[]).includes(v)
    ? (v as Difficulty)
    : fallback
}

function asDisplayMode(v: unknown, fallback: DisplayMode): DisplayMode {
  return typeof v === 'string' && (DISPLAY_MODES as readonly string[]).includes(v)
    ? (v as DisplayMode)
    : fallback
}

/** 给 `ProfileStore` 用的：把设置 patch 合进一份草稿。 */
export function mergeSettings(
  current: ProfileSettings,
  patch: Partial<ProfileSettings>,
): ProfileSettings {
  return { ...current, ...patch }
}
