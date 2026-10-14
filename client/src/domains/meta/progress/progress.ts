/**
 * 局外成长的**规则**：算等级、算成本、算最终数值、买一级、算一局的收益。
 * **零 Phaser、零 DOM**，node 下全被测。
 *
 * ## 一条设计决定：成长线的 key 是 `"<归属者>:<成长项>"`
 *
 * 档里的 `upgrades` 本来就是 `Record<string, number>`，所以**不用改 schema**
 * （也就没有迁移）：键从"角色 id"变成 `"student:maxHp"` 这种复合键即可。
 * 好处是角色成长线与技能成长线用同一套代码、同一个字段 —— 两者的差别只有
 * "归属者是谁"，而"归属者是谁"本来就不该影响算法。
 *
 * ## MVP 的简化（都记在改动日志的缺口清单里）
 *
 * - **解锁即生效**：档里 `unlocks.skills` 里的技能全都算数，没有"装备哪几个"的概念。
 *   设计上「一个角色可以选择多个技能」—— 那需要一个选择界面，下一版做。
 * - **属性只有四项**：生命上限 / 魔法上限 / 护甲 / 攻速，直接相加。
 *   没有乘区、没有阈值、没有互相影响 —— 演示够用，也不会把数值调歪。
 */

import type { MetaConfig, TrackUnit, UpgradeTrackDef } from '../metaConfig'
import { costOfNextLevel } from '../metaConfig'
import type { ProfileData } from '../profile/types'

/** `"student:maxHp"`。**唯一拼 key 的地方**，别在别处手写冒号。 */
export function trackKey(ownerId: string, trackId: string): string {
  return `${ownerId}:${trackId}`
}

export function levelOf(profile: ProfileData, ownerId: string, trackId: string): number {
  return profile.upgrades[trackKey(ownerId, trackId)] ?? 0
}

/** 某个角色（含它名下的技能）一共升了几级 —— 暂停菜单的「升级次数」用它 */
export function totalLevelsFor(profile: ProfileData, ownerId: string): number {
  const prefix = `${ownerId}:`
  let sum = 0
  for (const [key, level] of Object.entries(profile.upgrades)) {
    if (key.startsWith(prefix)) sum += level
  }
  return sum
}

export interface EffectiveStats {
  maxHp: number
  magic: number
  armor: number
  /** 攻速加成的百分比（5 表示 +5%），**不是倍率** —— 战斗侧自己决定怎么用 */
  attackSpeedPct: number
}

/**
 * 算这份档下某个角色的最终数值。**这是战斗侧唯一该问的函数** ——
 * 别的地方自己去翻 `profile.upgrades` 的话，加一条成长线就要改好几处。
 */
export function effectiveStats(
  profile: ProfileData,
  meta: MetaConfig,
  characterId: string,
): EffectiveStats {
  const def = meta.characters[characterId]
  const gain = (ownerId: string, trackId: string): number => {
    const track = def?.tracks.find((t) => t.id === trackId)
    if (!track) return 0
    return levelOf(profile, ownerId, trackId) * track.perLevel
  }

  const stats: EffectiveStats = {
    maxHp: (def?.base.maxHp ?? 0) + gain(characterId, 'maxHp'),
    magic: (def?.base.magic ?? 0) + gain(characterId, 'magic'),
    armor: (def?.base.armor ?? 0) + gain(characterId, 'armor'),
    attackSpeedPct: 0,
  }

  // 技能加成叠在同一个数上。MVP 里解锁即生效（见文件头的简化说明）。
  for (const skillId of profile.unlocks.skills) {
    const skill = meta.skills[skillId]
    if (!skill) continue
    const track = skill.tracks.find((t) => t.id === 'attackSpeedPct')
    if (!track) continue
    stats.attackSpeedPct += levelOf(profile, skillId, 'attackSpeedPct') * track.perLevel
  }
  return stats
}

export interface BuyResult {
  ok: boolean
  /** 花掉多少币（失败时是"本来要花多少"，界面上用它解释"还差多少"） */
  cost: number
  notice: string
}

/**
 * 买一级。**直接改传进来的 draft**（调用方负责把它交给 `ProfileStore.update`）：
 * "能不能买"和"买完变成什么"必须基于同一份数据判断。
 */
export function buyUpgrade(draft: ProfileData, ownerId: string, track: UpgradeTrackDef): BuyResult {
  const level = levelOf(draft, ownerId, track.id)
  const cost = costOfNextLevel(track, level)
  if (cost === null) return { ok: false, cost: 0, notice: `${track.name}已经满级` }
  if (draft.currency.coins < cost) {
    return { ok: false, cost, notice: `币不够：还差 ${cost - draft.currency.coins}` }
  }
  draft.currency.coins -= cost
  draft.upgrades[trackKey(ownerId, track.id)] = level + 1
  return { ok: true, cost, notice: `${track.name} +1` }
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

/** `+20` / `+5%`：成长项每级的增量，界面直接用 */
export function formatPerLevel(track: UpgradeTrackDef): string {
  return `+${track.perLevel}${suffix(track.unit)}`
}

/** 当前累计值，例如升了 3 级的 `+5%` → `+15%` */
export function formatTotal(track: UpgradeTrackDef, level: number): string {
  return `+${track.perLevel * level}${suffix(track.unit)}`
}

function suffix(unit: TrackUnit): string {
  return unit === 'percent' ? '%' : ''
}
