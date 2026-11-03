import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseConfigBundle } from '@/core/config'
import { parseCombatConfig } from './config'
import { roomPlan } from './balance'

const json = (name: string) => JSON.parse(readFileSync(new URL(`../../../public/config/${name}`, import.meta.url), 'utf8')) as unknown
const bundle = parseConfigBundle({ balance: json('balance.json'), difficulty: json('difficulty.json'), enemies: json('enemies.json') })
const cfg = parseCombatConfig(json('combat.json'))

describe('校园动物正式房间计划', () => {
  it('新怪在设定楼层前为零，在对应楼层依预算和难度出现', () => {
    const first = roomPlan(bundle, cfg, 'normal', 2, 1)
    expect(first.muscovies).toBe(0)
    expect(first.nightmareCats).toBe(0)
    const later = roomPlan(bundle, cfg, 'normal', 2, cfg.arena.nightmareCatMinFloor)
    expect(later.muscovies).toBeGreaterThan(0)
    expect(later.nightmareCats).toBeGreaterThan(0)
    const hard = roomPlan(bundle, cfg, 'hard', 2, cfg.arena.maxStages)
    expect(hard.muscovies).toBeGreaterThanOrEqual(later.muscovies)
    expect(hard.nightmareCats).toBeGreaterThanOrEqual(later.nightmareCats)
  })
  it('最终身份位于第八层，并提供唯一配置收益引用', () => {
    expect(cfg.arena.maxStages).toBe(8)
    expect(cfg.arena.finale).toMatchObject({ floor: 8, displayName: '心魔', finalRewardId: 'heart_demon' })
  })
})
