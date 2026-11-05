import { createDefaultProfile } from '../profile/defaults'
import { cloneProfile, migrateProfile } from '../profile/migrate'
import type { ProfileData } from '../profile/types'
import type { CloudProgressSummary } from './types'

/**
 * 局外内容指纹。**刻意不含 revision 和 settings**：
 *
 * - revision 会因调音量而前进，拿它判断“要不要上传”会把设备设置也算进云同步；
 * - 数组和对象按稳定顺序编码，避免角色解锁顺序或对象插入顺序制造假变化。
 */
export function syncFingerprint(profile: ProfileData): string {
  const upgrades = Object.fromEntries(
    Object.entries(profile.upgrades).sort(([a], [b]) => a.localeCompare(b)),
  )
  return JSON.stringify({
    schemaVersion: profile.schemaVersion,
    unlocks: {
      characters: [...profile.unlocks.characters].sort(),
      skills: [...profile.unlocks.skills].sort(),
    },
    currency: {
      coins: profile.currency.coins,
    },
    upgrades,
    stats: {
      runs: profile.stats.runs,
      wins: profile.stats.wins,
      deaths: profile.stats.deaths,
      bestDepth: profile.stats.bestDepth,
    },
    selected: {
      characterId: profile.selected.characterId,
      difficulty: profile.selected.difficulty,
    },
    onboarding: {
      tutorialSeen: profile.onboarding.tutorialSeen,
    },
    encounteredEnemyKinds: [...profile.encounteredEnemyKinds].sort(),
  })
}

/** 旧设备游标记录的是旧 schema 的投影；先迁移再比较，避免升级被误判为云端静默改档。 */
export function currentSyncFingerprint(fingerprint: string | null): string | null {
  if (fingerprint === null) return null
  try {
    const migrated = migrateProfile(JSON.parse(fingerprint))
    return migrated.outcome.status === 'recovered' ? fingerprint : syncFingerprint(migrated.profile)
  } catch {
    return fingerprint
  }
}

/**
 * 生成符合 C3 形状的上传载荷。
 *
 * 契约要求 `profile` 是完整 `ProfileData`，所以这里保留字段，只把设备本地的
 * settings 换成默认值；下载端无论如何都保留本机 settings。这样不需要改 C3，
 * 也不会把某台设备的音量带到其他设备。
 */
export function cloudProfileForUpload(profile: ProfileData, revision: number): ProfileData {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error('云存档 revision 必须是非负安全整数')
  }
  const copy = cloneProfile(profile)
  copy.revision = revision
  copy.settings = { ...createDefaultProfile().settings }
  return copy
}

/**
 * 第一次绑定账号时，是否值得把本地档当成“有进度”的一方。
 *
 * 只看局外内容，不看 settings、revision 或本次选择的角色/难度：
 * 新玩家刚调完音量、看完引导就登录，不应该因此覆盖已有云档。
 */
export function hasMeaningfulLocalProgress(profile: ProfileData): boolean {
  const defaults = createDefaultProfile()
  const hasNewCharacter = profile.unlocks.characters.some(
    (id) => !defaults.unlocks.characters.includes(id),
  )
  const hasNewSkillUnlock = profile.unlocks.skills.some(
    (id) => !defaults.unlocks.skills.includes(id),
  )
  return (
    profile.currency.coins > 0 ||
    profile.stats.runs > 0 ||
    profile.stats.wins > 0 ||
    profile.stats.deaths > 0 ||
    profile.stats.bestDepth > 0 ||
    hasNewCharacter ||
    hasNewSkillUnlock ||
    Object.values(profile.upgrades).some((level) => level > 0) ||
    profile.encounteredEnemyKinds.length > 0
  )
}

export function cloudProgressSummary(profile: ProfileData): CloudProgressSummary {
  return {
    coins: profile.currency.coins,
    runs: profile.stats.runs,
    wins: profile.stats.wins,
    deaths: profile.stats.deaths,
    bestDepth: profile.stats.bestDepth,
    unlockedCharacters: [...profile.unlocks.characters].sort(),
    skillUpgrades: Object.fromEntries(
      Object.entries(profile.upgrades).sort(([a], [b]) => a.localeCompare(b)),
    ),
    characterId: profile.selected.characterId,
    difficulty: profile.selected.difficulty,
    tutorialSeen: profile.onboarding.tutorialSeen,
    encounteredEnemyKinds: [...profile.encounteredEnemyKinds].sort(),
  }
}

const SUMMARY_FIELDS: readonly [keyof CloudProgressSummary, string][] = [
  ['coins', '金币'],
  ['runs', '累计冒险'],
  ['wins', '通关记录'],
  ['deaths', '失败记录'],
  ['bestDepth', '最深抵达'],
  ['unlockedCharacters', '角色解锁'],
  ['skillUpgrades', '技能等级'],
  ['characterId', '出战角色'],
  ['difficulty', '难度'],
  ['tutorialSeen', '首次引导'],
  ['encounteredEnemyKinds', '怪物图鉴'],
]

/** 冲突页显示“到底哪些字段不同”；不做任何自动合并。 */
export function progressDifferences(
  local: CloudProgressSummary,
  cloud: CloudProgressSummary,
): string[] {
  return SUMMARY_FIELDS.filter(
    ([field]) => JSON.stringify(local[field]) !== JSON.stringify(cloud[field]),
  ).map(([, label]) => label)
}
