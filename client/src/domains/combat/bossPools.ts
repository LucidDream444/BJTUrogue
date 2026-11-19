/**
 * `boss-pools.json`：一局三层的首领池 + 固定的最终首领（心魔）。
 *
 * 首领的**稳定身份**是 `boss-skills.json` 条目里的 `id`（coursework / paper_kite / …）；
 * 数组里写的是 id，解析时换成 `{ id, profile, name }`。`profile` 是 `boss-skills` 的键
 * （"2".."8"），只用于技能/美术/皮肤查表；`bossLayer` 是 1..3 的场次层号。
 *
 * 心魔 MUST NOT 出现在任何层池里：它固定在第 3 层池内首领之后，作为最终首领。
 */
import { ConfigError } from '@/core/config'
import { Rng } from '@/core/rng'
import { floorSeeds } from './DungeonStages'
import type { BossSkillsTable } from './BossSkillRuntime'

export interface BossPoolEntry {
  readonly id: string
  readonly profile: number
  readonly name: string
}

export interface BossPoolsConfig {
  readonly schemaVersion: number
  readonly pools: Readonly<Record<number, readonly string[]>>
  readonly finalBoss: string
}

export interface BossPicks {
  readonly layers: readonly BossPoolEntry[]
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

/** 解析并校验 `boss-pools.json`；`bossSkills` 必须是已经校验过的技能表。 */
export function parseBossPools(
  raw: unknown,
  bossSkills: BossSkillsTable,
  expectedLayers: number,
): BossPoolsConfig {
  const root = needObject(raw, 'boss-pools')
  if (root.schemaVersion !== 1) throw new ConfigError('boss-pools.schemaVersion', '必须为 1')
  const poolsRaw = needObject(root.pools, 'boss-pools.pools')
  const expected = Array.from({ length: expectedLayers }, (_, i) => String(i + 1))
  const keys = Object.keys(poolsRaw).sort((a, b) => Number(a) - Number(b))
  if (keys.join(',') !== expected.join(','))
    throw new ConfigError(
      'boss-pools.pools',
      `键必须恰好是 ${expected.join(' / ')}（一局 ${expectedLayers} 层），拿到 ${keys.join(' / ') || '空'}`,
    )

  const byId = new Map<string, BossPoolEntry>()
  for (const [profile, boss] of Object.entries(bossSkills.bosses)) {
    if (byId.has(boss.id)) throw new ConfigError('boss-skills.bosses', `首领 id 重复：${boss.id}`)
    byId.set(boss.id, { id: boss.id, profile: Number(profile), name: boss.name })
  }

  const pools: Record<number, readonly string[]> = {}
  const seen = new Map<string, number>()
  for (const key of expected) {
    const list = needArray(poolsRaw[key], `boss-pools.pools.${key}`).map((value, i) =>
      needString(value, `boss-pools.pools.${key}[${i}]`),
    )
    for (const id of list) {
      if (!byId.has(id)) throw new ConfigError(`boss-pools.pools.${key}`, `首领池里的 id 不存在于 boss-skills：${id}`)
      const previous = seen.get(id)
      if (previous !== undefined)
        throw new ConfigError(
          `boss-pools.pools.${key}`,
          `同一个首领不能出现在两个池：${id} 已在第 ${previous} 层`,
        )
      seen.set(id, Number(key))
    }
    pools[Number(key)] = list
  }

  const finalBoss = needString(root.finalBoss, 'boss-pools.finalBoss')
  if (!byId.has(finalBoss)) throw new ConfigError('boss-pools.finalBoss', `最终首领不存在于 boss-skills：${finalBoss}`)
  if (seen.has(finalBoss))
    throw new ConfigError('boss-pools.finalBoss', `最终首领不能参与层池抽取：${finalBoss}`)

  return { schemaVersion: 1, pools, finalBoss }
}

/** 按 `runSeed` 抽第 1/2/3 层首领；心魔固定。 */
export function pickLayerBosses(
  runSeed: number,
  config: BossPoolsConfig,
  bossSkills: BossSkillsTable,
  layers: number,
): BossPicks {
  const byId = new Map<string, BossPoolEntry>()
  for (const [profile, boss] of Object.entries(bossSkills.bosses)) {
    byId.set(boss.id, { id: boss.id, profile: Number(profile), name: boss.name })
  }
  const seeds = floorSeeds(runSeed, layers + 1)
  const picks: BossPoolEntry[] = []
  for (let layer = 1; layer <= layers; layer++) {
    const pool = config.pools[layer]
    if (!pool || pool.length === 0)
      throw new ConfigError(`boss-pools.pools.${layer}`, `第 ${layer} 层没有首领池`)
    const rng = new Rng((seeds[layer]! ^ 0x424f5353) >>> 0)
    const id = rng.pick(pool)
    const entry = byId.get(id)
    if (!entry) throw new ConfigError(`boss-pools.pools.${layer}`, `首领池里的 id 不存在：${id}`)
    picks.push(entry)
  }
  const finalBoss = byId.get(config.finalBoss)
  if (!finalBoss) throw new ConfigError('boss-pools.finalBoss', `最终首领不存在：${config.finalBoss}`)
  return { layers: picks, finalBoss }
}
