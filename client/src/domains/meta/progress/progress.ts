/**
 * 局外成长规则：角色被动、统一技能等级、解锁、收益与结算。
 * 零 Phaser、零 DOM，node 下可直接测试。
 */

import type { MetaConfig } from '../metaConfig'
import type { ProfileData } from '../profile/types'

export const SKILL_TRACK_ID = 'skill'
export const SKILL_MAX_LEVEL = 4

/** `"student:maxHp"`。**唯一拼 key 的地方**，别在别处手写冒号。 */
export function trackKey(ownerId: string, trackId: string): string {
  return `${ownerId}:${trackId}`
}

export function levelOf(profile: ProfileData, ownerId: string, trackId: string): number {
  return profile.upgrades[trackKey(ownerId, trackId)] ?? 0
}

/** 某个角色已经付费买过的技能升级次数。 */
export function totalLevelsFor(profile: ProfileData, ownerId: string): number {
  const prefix = `${ownerId}:`
  let sum = 0
  for (const [key, level] of Object.entries(profile.upgrades)) {
    if (key.startsWith(prefix)) sum += level
  }
  return sum
}

export interface EffectiveStats {
  /** 角色被动：生命上限百分比、移动速度百分比与能量恢复百分比。 */
  maxHpPct: number
  moveSpeedPct: number
  energyRegenPct: number
}

/**
 * 算这份档下某个角色的最终数值。**这是战斗侧唯一该问的函数** ——
 * 别的地方自己去翻 `profile.upgrades` 的话，加一条成长线就要改好几处。
 */
export function effectiveStats(
  _profile: ProfileData,
  meta: MetaConfig,
  characterId: string,
): EffectiveStats {
  const def = meta.characters[characterId]

  const stats: EffectiveStats = {
    maxHpPct: def?.combat.maxHpPct ?? 0,
    moveSpeedPct: def?.combat.moveSpeedPct ?? 0,
    energyRegenPct: def?.combat.energyRegenPct ?? 0,
  }

  return stats
}

/** 角色固定技能等级。角色已解锁但还没买过升级时，默认就是 1 级。 */
export function skillLevelOf(
  profile: ProfileData,
  meta: MetaConfig,
  characterId: string,
): number {
  const skill = meta.characters[characterId]?.skill
  if (!skill) return 0
  const stored = levelOf(profile, characterId, SKILL_TRACK_ID)
  if (stored > 0) return Math.min(SKILL_MAX_LEVEL, stored + 1)
  return isUnlocked(profile, characterId) ? 1 : 0
}

/** 当前角色已经付费买了多少次技能升级。 */
export function skillUpgradeCount(profile: ProfileData, meta: MetaConfig, characterId: string): number {
  return Math.max(0, skillLevelOf(profile, meta, characterId) - 1)
}

/** 升到下一级的费用；满级返回 null。 */
export function skillUpgradeCost(
  profile: ProfileData,
  meta: MetaConfig,
  characterId: string,
): number | null {
  const skill = meta.characters[characterId]?.skill
  const level = skillLevelOf(profile, meta, characterId)
  if (!skill || level <= 0 || level >= SKILL_MAX_LEVEL) return null
  return skill.upgradeCosts[level - 1] ?? null
}

/** 三个角色共用的唯一技能升级入口。 */
export function buySkillUpgrade(
  draft: ProfileData,
  meta: MetaConfig,
  characterId: string,
): BuyResult {
  const skill = meta.characters[characterId]?.skill
  if (!skill) return { ok: false, cost: 0, notice: '没有这个角色技能' }
  const level = skillLevelOf(draft, meta, characterId)
  const cost = skillUpgradeCost(draft, meta, characterId)
  if (level >= SKILL_MAX_LEVEL || cost === null) {
    return { ok: false, cost: 0, notice: `${skill.name}已经满级` }
  }
  if (draft.currency.coins < cost) {
    return { ok: false, cost, notice: `币不够：还差 ${cost - draft.currency.coins}` }
  }
  draft.currency.coins -= cost
  // 存的是“已升过几次”，所以 1 级默认不写字段，暂停菜单可直接当升级次数显示。
  draft.upgrades[trackKey(characterId, SKILL_TRACK_ID)] = level
  return { ok: true, cost, notice: `${skill.name}升到 ${level + 1} 级` }
}

/** 战斗最终生命上限 = D1 的基础生命 + D4 的永久成长加成。 */
export function effectiveMaxHp(
  baseMaxHp: number,
  stats: Pick<EffectiveStats, 'maxHpPct'>,
): number {
  return Math.max(1, Math.round(baseMaxHp * (1 + stats.maxHpPct / 100)))
}

/** 战斗最终护盾上限 = D1 的基础护盾 + D4 的永久成长加成。 */
export function effectiveMaxShield(
  baseShield: number,
): number {
  return Math.max(0, Math.round(baseShield))
}

/** 战斗最终能量上限 = D1 的基础能量 + D4 的永久成长加成。 */
export function effectiveMaxEnergy(
  baseMaxEnergy: number,
): number {
  return Math.max(0, Math.round(baseMaxEnergy))
}

export interface BuyResult {
  ok: boolean
  /** 花掉多少币（失败时是"本来要花多少"，界面上用它解释"还差多少"） */
  cost: number
  notice: string
}

/** 解锁角色。技能随角色一起开放，不再单独解锁。 */
export function unlock(draft: ProfileData, meta: MetaConfig, id: string): BuyResult {
  const character = meta.characters[id]
  const cost = character?.unlockCost ?? 0

  if (!character) return { ok: false, cost: 0, notice: `没有这个角色：${id}` }
  if (isUnlocked(draft, id)) return { ok: false, cost: 0, notice: `${id} 已经解锁了` }
  if (draft.currency.coins < cost) {
    return { ok: false, cost, notice: `币不够：还差 ${cost - draft.currency.coins}` }
  }

  draft.currency.coins -= cost
  draft.unlocks.characters.push(id)
  return { ok: true, cost, notice: `解锁角色：${id}` }
}

/** 角色是否已解锁。旧 `unlocks.skills` 只为存档兼容保留，不参与门禁。 */
export function isUnlocked(profile: ProfileData, id: string): boolean {
  return profile.unlocks.characters.includes(id)
}

/** 一局的原始计数。**谁统计由宿主决定**（见 `run/RunLedger.ts`）。 */
export interface RunInput {
  outcome: 'dead' | 'cleared' | 'quit'
  /** 到达的层数 */
  depth: number
  kills: number
  clearedRooms: number
}

/**
 * 一局该给多少币。**死亡也给，而且不打折** —— 设计上"角色死亡不会丢失货币"，
 * 所以这里没有任何与 `outcome` 相关的分支。将来要加"通关奖励"时另开一项，
 * 别把它写成"死了就少给"。
 */
export function coinsForRun(meta: MetaConfig, input: RunInput): number {
  const e = meta.economy
  return (
    Math.max(0, Math.round(input.kills)) * e.coinsPerKill +
    Math.max(0, Math.round(input.clearedRooms)) * e.coinsPerClearedRoom +
    Math.max(0, Math.round(input.depth)) * e.coinsPerDepth
  )
}

export interface SettleOutcome {
  coinsEarned: number
  /** 结算之后档里一共多少币。界面要显示这个，好让人看到"攒下来了" */
  coinsTotal: number
}

/**
 * 把一局的结果记进档：**发币 + 更新统计**。改 draft，不落盘。
 *
 * ⚠️ **只加不减** —— 这是"死亡不丢币"那条设计的落点。将来若要有扣币的机制，
 * 必须写在这里，而不是在结算界面里随手改：那样"结算不会扣币"就没有地方保证了。
 */
export function settleRun(draft: ProfileData, meta: MetaConfig, input: RunInput): SettleOutcome {
  const coinsEarned = coinsForRun(meta, input)
  draft.currency.coins += coinsEarned
  draft.stats.runs += 1
  if (input.outcome === 'cleared') draft.stats.wins += 1
  if (input.outcome === 'dead') draft.stats.deaths += 1
  draft.stats.bestDepth = Math.max(draft.stats.bestDepth, Math.max(0, Math.round(input.depth)))
  return { coinsEarned, coinsTotal: draft.currency.coins }
}
