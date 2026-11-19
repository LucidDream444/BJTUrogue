import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseConfigBundle } from '@/core/config'
import { parseCombatConfig } from './config'
import { roomPlan, roomPointBudget } from './balance'

const json = (name: string) => JSON.parse(readFileSync(new URL(`../../../public/config/${name}`, import.meta.url), 'utf8')) as unknown
const bundle = parseConfigBundle({ balance: json('balance.json'), difficulty: json('difficulty.json'), enemies: json('enemies.json') })
const cfg = parseCombatConfig(json('combat.json'))

describe('校园动物正式房间计划', () => {
  it('新怪在设定楼层前为零，解锁后进入权重池', () => {
    const first = roomPlan(bundle, cfg, 'normal', 60, 1, 1)
    expect(first.counts.muscovy).toBe(0)
    expect(first.counts.nightmare_cat).toBe(0)

    const unlocked = Array.from({ length: 30 }, (_, seed) =>
      roomPlan(bundle, cfg, 'normal', 60, cfg.arena.monsterPointUnlockFloors.nightmare_cat, seed + 1),
    )
    expect(unlocked.reduce((sum, plan) => sum + plan.counts.muscovy, 0)).toBeGreaterThan(0)
    expect(unlocked.reduce((sum, plan) => sum + plan.counts.nightmare_cat, 0)).toBeGreaterThan(0)
  })
  it('难度只放大房间预算，不改变单只怪点数', () => {
    const easy = roomPointBudget(cfg, 'easy', 10, 1, 0.75)
    const normal = roomPointBudget(cfg, 'normal', 10, 1, 1)
    const hard = roomPointBudget(cfg, 'hard', 10, 1, 1.25)
    expect(easy).toBeLessThan(normal)
    expect(normal).toBeLessThan(hard)
  })
  it('最终身份位于第八层，并提供唯一配置收益引用', () => {
    expect(cfg.arena.maxStages).toBe(8)
    expect(cfg.arena.finale).toMatchObject({ floor: 8, displayName: '心魔', finalRewardId: 'heart_demon' })
  })
})
