import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseBossSkillsTable } from './BossSkillRuntime'
import { parseBossPools, pickLayerBosses } from './bossPools'

const CONFIG_DIR = fileURLToPath(new URL('../../../public/config/', import.meta.url))
const readJson = (name: string): unknown => JSON.parse(readFileSync(CONFIG_DIR + name, 'utf8')) as unknown
const skills = parseBossSkillsTable(readJson('boss-skills.json'))
const raw = readJson('boss-pools.json')

describe('首领池（boss-pools.json）', () => {
  it('三层各 2 个候选，心魔是固定最终首领且不在池里', () => {
    const config = parseBossPools(raw, skills, 3)
    expect(config.pools[1]).toEqual(['coursework', 'paper_kite'])
    expect(config.pools[2]).toEqual(['acid_sprinkler', 'sports_gear'])
    expect(config.pools[3]).toEqual(['roll_call', 'nailong'])
    expect(config.finalBoss).toBe('heart_demon')
    expect(Object.values(config.pools).flat()).not.toContain('heart_demon')
  })

  it('同一 runSeed 复现同一组首领；每层一个且互不重复', () => {
    const config = parseBossPools(raw, skills, 3)
    const a = pickLayerBosses(20261119, config, skills, 3)
    const b = pickLayerBosses(20261119, config, skills, 3)
    expect(a.layers.map((entry) => entry.id)).toEqual(b.layers.map((entry) => entry.id))
    expect(a.layers).toHaveLength(3)
    expect(new Set(a.layers.map((entry) => entry.id)).size).toBe(3)
    for (const entry of a.layers) expect(entry.profile).toBeGreaterThanOrEqual(2)
    expect(a.finalBoss).toMatchObject({ id: 'heart_demon', profile: 8, name: '心魔' })
  })

  it('不同种子会抽到不同的层首领组合', () => {
    const config = parseBossPools(raw, skills, 3)
    const seen = new Set<string>()
    for (let seed = 1; seed <= 100; seed++) {
      seen.add(pickLayerBosses(seed, config, skills, 3).layers.map((entry) => entry.id).join('/'))
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('池之间重复 / 未知 id / 心魔进池 / 缺层都当场抛', () => {
    expect(() =>
      parseBossPools({ ...(raw as object), pools: { '1': ['coursework'], '2': ['coursework'], '3': ['nailong'] } }, skills, 3),
    ).toThrow(/两个池/)
    expect(() =>
      parseBossPools({ ...(raw as object), pools: { '1': ['nope'], '2': ['acid_sprinkler'], '3': ['nailong'] } }, skills, 3),
    ).toThrow(/不存在/)
    expect(() =>
      parseBossPools({ ...(raw as object), pools: { '1': ['heart_demon'], '2': ['acid_sprinkler'], '3': ['nailong'] } }, skills, 3),
    ).toThrow(/最终首领/)
    expect(() =>
      parseBossPools({ ...(raw as object), pools: { '1': ['coursework'], '2': ['acid_sprinkler'] } }, skills, 3),
    ).toThrow(/键必须/)
  })
})
