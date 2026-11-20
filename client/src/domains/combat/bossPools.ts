/**
 * `boss-pools.json`：每局从常规首领名册里抽两位作为两层首领，其余进入精英房池；
 * 最终首领固定为奶龙（profile 9）。
 *
 * 常规首领的稳定身份是 `boss-skills.json` 条目里的 `id`；数组里写 id，解析时换成
 * `{ id, profile, name }`。`profile` 是 `boss-skills` 的键（"2".."9"）。
 */
import { ConfigError } from '@/core/config'
import { Rng } from '@/core/rng'
import type { BossSkillsTable } from './BossSkillRuntime'

export interface BossPoolEntry {
  readonly id: string
  readonly profile: number
  readonly name: string
}

export interface BossPoolsConfig {
  readonly schemaVersion: number
  readonly roster: readonly string[]
  readonly layerBossCount: number
  readonly finalBoss: string
}

export interface BossPicks {
  readonly layers: readonly BossPoolEntry[]
  /** The remaining regular bosses; elite rooms may repeat any of them. */
  readonly elites: readonly BossPoolEntry[]
  readonly finalBoss: BossPoolEntry
}

function needObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ConfigError(path, `要一个对象，拿到 ${JSON.stringify(value)}`)
  return value as Record<string, unknown>
}

function needString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new ConfigError(path, `要一个非空字符串，拿到 ${JSON.stringify(value)}`)
  return value
}

function needArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new ConfigError(path, `要一个数组，拿到 ${JSON.stringify(value)}`)
  if (value.length === 0) throw new ConfigError(path, '至少要有 1 个首领')
  return value
}

/** Parse and validate `boss-pools.json`; `bossSkills` must already be validated. */
export function parseBossPools(
  raw: unknown,
  bossSkills: BossSkillsTable,
  expectedLayers: number,
): BossPoolsConfig {
  const root = needObject(raw, 'boss-pools')
  if (root.schemaVersion !== 2)
    throw new ConfigError('boss-pools.schemaVersion', '必须为 2（常规首领名册 + 精英池）')
  const roster = needArray(root.roster, 'boss-pools.roster').map((value, i) =>
    needString(value, `boss-pools.roster[${i}]`),
  )
  if (new Set(roster).size !== roster.length)
    throw new ConfigError('boss-pools.roster', '常规首领名册不能重复')
  const layerBossCount = root.layerBossCount
  if (
    typeof layerBossCount !== 'number' ||
    !Number.isInteger(layerBossCount) ||
    layerBossCount < 1 ||
    layerBossCount >= roster.length
  )
    throw new ConfigError('boss-pools.layerBossCount', '必须为正整数，且至少留 1 位首领给精英池')
  if (layerBossCount !== expectedLayers)
    throw new ConfigError('boss-pools.layerBossCount', `必须等于本局层数 ${expectedLayers}`)

  const byId = new Map<string, BossPoolEntry>()
  for (const [profile, boss] of Object.entries(bossSkills.bosses)) {
    if (byId.has(boss.id)) throw new ConfigError('boss-skills.bosses', `首领 id 重复：${boss.id}`)
    byId.set(boss.id, { id: boss.id, profile: Number(profile), name: boss.name })
  }
  for (const id of roster)
    if (!byId.has(id)) throw new ConfigError('boss-pools.roster', `首领不存在于 boss-skills：${id}`)

  const finalBoss = needString(root.finalBoss, 'boss-pools.finalBoss')
  if (!byId.has(finalBoss)) throw new ConfigError('boss-pools.finalBoss', `最终首领不存在于 boss-skills：${finalBoss}`)
  if (roster.includes(finalBoss))
    throw new ConfigError('boss-pools.finalBoss', `最终首领不能进入常规名册：${finalBoss}`)

  return { schemaVersion: 2, roster, layerBossCount, finalBoss }
}

/** 按 `runSeed` 抽两层首领；余下的常规首领进入精英池，奶龙固定最终。 */
export function pickLayerBosses(
  runSeed: number,
  config: BossPoolsConfig,
  bossSkills: BossSkillsTable,
  layers: number,
): BossPicks {
  if (layers !== config.layerBossCount)
    throw new ConfigError('boss-pools.layerBossCount', `配置为 ${config.layerBossCount}，本局需要 ${layers}`)
  const byId = new Map<string, BossPoolEntry>()
  for (const [profile, boss] of Object.entries(bossSkills.bosses))
    byId.set(boss.id, { id: boss.id, profile: Number(profile), name: boss.name })

  const rng = new Rng((runSeed ^ 0x424f5353) >>> 0)
  const remaining = [...config.roster]
  for (let i = remaining.length - 1; i > 0; i--) {
    const j = rng.between(0, i)
    ;[remaining[i], remaining[j]] = [remaining[j]!, remaining[i]!]
  }
  const picks = remaining.slice(0, layers).map((id) => {
    const entry = byId.get(id)
    if (!entry) throw new ConfigError('boss-pools.roster', `首领不存在：${id}`)
    return entry
  })
  const elites = remaining.slice(layers).map((id) => {
    const entry = byId.get(id)
    if (!entry) throw new ConfigError('boss-pools.roster', `首领不存在：${id}`)
    return entry
  })
  const final = byId.get(config.finalBoss)
  if (!final) throw new ConfigError('boss-pools.finalBoss', `最终首领不存在：${config.finalBoss}`)
  return { layers: picks, elites, finalBoss: final }
}
