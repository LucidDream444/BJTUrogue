import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseBossSkillsTable } from './BossSkillRuntime'
import { parseBossPools, pickLayerBosses } from './bossPools'

const CONFIG_DIR = fileURLToPath(new URL('../../../public/config/', import.meta.url))
const readJson = (name: string): unknown => JSON.parse(readFileSync(CONFIG_DIR + name, 'utf8')) as unknown
const skills = parseBossSkillsTable(readJson('boss-skills.json'))
const raw = readJson('boss-pools.json') as Record<string, unknown>

describe('首领名册与精英池（boss-pools.json）', () => {
  it('七位常规首领，抽两位当层首领，其余五位进精英池，奶龙固定最终', () => {
    const config = parseBossPools(raw, skills, 2)
    expect(config.roster).toHaveLength(7)
    expect(config.layerBossCount).toBe(2)
    expect(config.finalBoss).toBe('nailong')
    expect(config.roster).not.toContain('nailong')
  })

  it('同一 runSeed 复现同一组层首领；层首领不重复，精英池为余下五位', () => {
    const config = parseBossPools(raw, skills, 2)
    const a = pickLayerBosses(20261119, config, skills, 2)
    const b = pickLayerBosses(20261119, config, skills, 2)
    expect(a.layers.map((entry) => entry.id)).toEqual(b.layers.map((entry) => entry.id))
    expect(a.layers).toHaveLength(2)
    expect(new Set(a.layers.map((entry) => entry.id)).size).toBe(2)
    expect(a.elites).toHaveLength(5)
    expect(new Set([...a.layers, ...a.elites].map((entry) => entry.id)).size).toBe(7)
    expect(a.finalBoss).toMatchObject({ id: 'nailong', profile: 9, name: '奶龙' })
    for (const entry of [...a.layers, ...a.elites]) expect(entry.profile).toBeGreaterThanOrEqual(2)
  })

  it('不同种子会抽到不同的层首领组合', () => {
    const config = parseBossPools(raw, skills, 2)
    const seen = new Set<string>()
    for (let seed = 1; seed <= 100; seed++)
      seen.add(pickLayerBosses(seed, config, skills, 2).layers.map((entry) => entry.id).join('/'))
    expect(seen.size).toBeGreaterThan(1)
  })

  it('重复名册 / 未知 id / 最终首领进名册 / 层数不符都当场抛', () => {
    const bad = (patch: Record<string, unknown>) =>
      ({ ...raw, ...patch })
    expect(() => parseBossPools(bad({ roster: ['coursework', 'coursework', 'paper_kite'] }), skills, 2)).toThrow(/重复/)
    expect(() => parseBossPools(bad({ roster: ['nope', 'coursework', 'paper_kite'] }), skills, 2)).toThrow(/不存在/)
    expect(() => parseBossPools(bad({ roster: ['nailong', 'coursework', 'paper_kite'], layerBossCount: 2 }), skills, 2)).toThrow(/最终首领/)
    expect(() => parseBossPools(bad({ layerBossCount: 3 }), skills, 2)).toThrow(/本局层数/)
  })
})
