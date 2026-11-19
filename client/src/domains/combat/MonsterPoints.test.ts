import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseConfigBundle } from '@/core/config'
import { parseCombatConfig } from './config'
import { effectiveDifficultyModifiers, roomPlan, roomPointBudget } from './balance'

const read = (name: string) =>
  JSON.parse(readFileSync(new URL('../../../public/config/' + name, import.meta.url), 'utf8'))
const bundle = parseConfigBundle({
  balance: read('balance.json'),
  difficulty: read('difficulty.json'),
  enemies: read('enemies.json'),
})
const cfg = parseCombatConfig(read('combat.json'))

describe('怪物点数机制', () => {
  it('所有小怪都有固定的正整数点数，危险模板更贵', () => {
    const enemies = bundle.enemies.enemies
    expect(enemies.splitter.monsterPoints).toBe(1)
    expect(enemies.sprayer.monsterPoints).toBe(3)
    expect(enemies.grabber.monsterPoints).toBe(4)
    expect(enemies.muscovy.monsterPoints).toBe(4)
    expect(enemies.nightmare_cat.monsterPoints).toBe(5)
    expect(enemies.tank.monsterPoints).toBe(6)
    for (const def of Object.values(enemies)) {
      expect(Number.isInteger(def.monsterPoints)).toBe(true)
      expect(def.monsterPoints).toBeGreaterThan(0)
    }
  })

  it('逐只扣点，永不超支；房间名单最终恰好花完固定预算', () => {
    const costs = Object.fromEntries(
      Object.entries(bundle.enemies.enemies).map(([kind, def]) => [kind, def.monsterPoints]),
    )
    for (let seed = 1; seed <= 100; seed++) {
      const plan = roomPlan(bundle, cfg, 'normal', 37, 6, seed)
      expect(plan.pointSpent).toBe(plan.pointBudget)
      expect(plan.pointSpent).toBe(
        plan.units.reduce((sum, unit) => sum + costs[unit.kind]!, 0),
      )
    }
  })

  it('同一房间种子复现同一组合，不同种子会换组合', () => {
    const a = roomPlan(bundle, cfg, 'normal', 42, 5, 991)
    const b = roomPlan(bundle, cfg, 'normal', 42, 5, 991)
    expect(a).toEqual(b)
    const combinations = new Set(
      Array.from({ length: 30 }, (_, seed) =>
        roomPlan(bundle, cfg, 'normal', 42, 5, seed + 1)
          .units.map((unit) => unit.kind)
          .join(','),
      ),
    )
    expect(combinations.size).toBeGreaterThan(1)
  })

  it('楼层与难度各自放大总预算，不改变单只怪点数', () => {
    const budgets = Array.from({ length: cfg.arena.maxStages }, (_, i) =>
      roomPointBudget(cfg, 'normal', 10, i + 1, 1),
    )
    for (let i = 1; i < budgets.length; i++)
      expect(budgets[i], `第 ${i + 1} 层`).toBeGreaterThan(budgets[i - 1]!)

    const easy = roomPointBudget(cfg, 'easy', 10, 4, 0.75)
    const normal = roomPointBudget(cfg, 'normal', 10, 4, 1)
    const hard = roomPointBudget(cfg, 'hard', 10, 4, 1.25)
    expect(easy).toBeLessThan(normal)
    expect(normal).toBeLessThan(hard)
    expect(bundle.enemies.enemies.tank.monsterPoints).toBe(6)
  })

  it('普通怪的生命、伤害、速度逐层严格增强，F1 保持基准', () => {
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const floors = Array.from({ length: cfg.arena.maxStages }, (_, i) =>
        effectiveDifficultyModifiers(bundle, cfg, difficulty, i + 1),
      )
      const base = bundle.difficulty.difficulties[difficulty]
      expect(floors[0]).toEqual({ ...base })
      for (let i = 1; i < floors.length; i++) {
        expect(floors[i]!.enemyHp, `${difficulty} F${i + 1} HP`).toBeGreaterThan(
          floors[i - 1]!.enemyHp,
        )
        expect(floors[i]!.enemyDamage, `${difficulty} F${i + 1} 伤害`).toBeGreaterThan(
          floors[i - 1]!.enemyDamage,
        )
        expect(floors[i]!.enemySpeed, `${difficulty} F${i + 1} 速度`).toBeGreaterThanOrEqual(
          floors[i - 1]!.enemySpeed,
        )
        expect(floors[i]!.enemyCount).toBe(base.enemyCount)
      }
    }
  })

  it('解锁楼层独立生效：高威胁怪不会因房间预算高而提前出现', () => {
    const firstFloor = Array.from({ length: 20 }, (_, seed) =>
      roomPlan(bundle, cfg, 'normal', 100, 1, seed + 1),
    )
    expect(firstFloor.every((plan) => plan.counts.grabber === 0)).toBe(true)
    expect(firstFloor.every((plan) => plan.counts.muscovy === 0)).toBe(true)
    expect(firstFloor.every((plan) => plan.counts.nightmare_cat === 0)).toBe(true)

    const secondFloor = Array.from({ length: 20 }, (_, seed) =>
      roomPlan(bundle, cfg, 'normal', 100, 2, seed + 1),
    )
    expect(secondFloor.reduce((sum, plan) => sum + plan.counts.grabber, 0)).toBeGreaterThan(0)
    expect(secondFloor.reduce((sum, plan) => sum + plan.counts.muscovy, 0)).toBeGreaterThan(0)
  })

  it('分裂纸团只按母体扣点，并限制它吃掉整间预算', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const plan = roomPlan(bundle, cfg, 'normal', 50, 8, seed)
      expect(plan.pointBudget - plan.pointSpent).toBe(0)
      expect(plan.counts.splitter).toBeLessThanOrEqual(
        Math.ceil(50 * cfg.arena.monsterPointSplitterShareCap) + 2,
      )
      expect(plan.units.every((unit) => unit.gen === 0)).toBe(true)
    }
  })
})
