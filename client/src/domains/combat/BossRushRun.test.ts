/**
 * BOSSRUSH 的纯规则：每层首领组合、成长倍率、经验/天赋/金币。
 *
 * 这些断言全部跑在 node 下，不需要 Phaser —— 场景接得对不对是另一回事，
 * 但「第八层是不是奶龙」「普通/困难一层几位」「高层的血是不是更高」
 * 不该靠人开浏览器看。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Difficulty } from '@/core/config'
import { parseBossSkillsTable } from './BossSkillRuntime'
import { parseBossPools } from './bossPools'
import { parseCombatConfig } from './config'
import {
  BossRushRun,
  parseBossRushConfig,
  type BossRushConfig,
} from './BossRushRun'

const CONFIG_DIR = fileURLToPath(new URL('../../../public/config/', import.meta.url))
const readJson = (name: string): unknown =>
  JSON.parse(readFileSync(CONFIG_DIR + name, 'utf8')) as unknown

const skills = parseBossSkillsTable(readJson('boss-skills.json'))
const pools = parseBossPools(readJson('boss-pools.json'), skills, 3)
const raw = readJson('bossrush.json') as Record<string, unknown>

function config(): BossRushConfig {
  return parseBossRushConfig(raw, pools, skills)
}

function runFor(difficulty: Difficulty, seed = 20261128): BossRushRun {
  return new BossRushRun(config(), pools, skills, seed, difficulty)
}

describe('BOSSRUSH 配置（bossrush.json）', () => {
  it('总层数 = 常规首领 7 + 最终首领 1；每层数量与血量缩放按难度分开', () => {
    const c = config()
    expect(c.totalFloors).toBe(8)
    expect(c.finalBoss).toBe('nailong')
    expect(c.chestCount).toBe(3)
    expect(c.talentMaxOwned).toBeGreaterThan(12)
    expect(c.bossesPerFloor).toEqual({ easy: 1, normal: 2, hard: 3 })
    expect(c.bossHpScale.easy).toBe(1)
    expect(c.bossHpScale.normal).toBeLessThan(1)
    expect(c.bossHpScale.hard).toBeLessThan(c.bossHpScale.normal)
    expect(c.bossDamageScale.easy).toBe(1)
    expect(c.bossDamageScale.normal).toBeLessThan(1)
    expect(c.bossDamageScale.hard).toBeLessThan(c.bossDamageScale.normal)
  })

  it('总层数 / 最终首领写错会当场抛', () => {
    expect(() => parseBossRushConfig({ ...raw, totalFloors: 7 }, pools, skills)).toThrow(/totalFloors/)
    expect(() => parseBossRushConfig({ ...raw, finalBoss: 'coursework' }, pools, skills)).toThrow(/finalBoss/)
    expect(() =>
      parseBossRushConfig(
        { ...raw, bossesPerFloor: { easy: 1, normal: 2, hard: 8 } },
        pools,
        skills,
      ),
    ).toThrow(/每层要/)
  })
})

describe('BOSSRUSH 首领组合', () => {
  it('简单：每层 1 位，前七层不重复，第八层固定奶龙', () => {
    const run = runFor('easy')
    expect(run.bossesPerFloor).toBe(1)
    expect(run.groups).toHaveLength(8)
    for (const group of run.groups) expect(group).toHaveLength(1)
    const firstSeven = run.groups.slice(0, 7).map((group) => group[0]!.id)
    expect(new Set(firstSeven).size).toBe(7)
    expect(firstSeven).not.toContain('nailong')
    expect(run.groups[7]![0]).toMatchObject({ id: 'nailong', profile: 9 })
    expect(firstSeven.sort()).toEqual([...pools.roster].sort())
  })

  it('普通/困难：每层 2/3 位、层内不重复；第八层含且仅含一位奶龙', () => {
    for (const [difficulty, count] of [
      ['normal', 2],
      ['hard', 3],
    ] as const) {
      const run = runFor(difficulty)
      expect(run.bossesPerFloor, difficulty).toBe(count)
      expect(run.groups).toHaveLength(8)
      for (const group of run.groups) {
        expect(group, difficulty).toHaveLength(count)
        expect(new Set(group.map((boss) => boss.id)).size, difficulty).toBe(count)
      }
      for (const group of run.groups.slice(0, 7))
        expect(group.some((boss) => boss.id === 'nailong'), difficulty).toBe(false)
      const final = run.groups[7]!
      expect(final.filter((boss) => boss.id === 'nailong'), difficulty).toHaveLength(1)
    }
  })

  it('优先用没出现过的常规首领，全部上过场后才从旧组合里补', () => {
    for (const difficulty of ['normal', 'hard'] as const) {
      const run = runFor(difficulty)
      const seen = new Set<string>()
      for (const group of run.groups) {
        const regular = group.filter((boss) => boss.id !== 'nailong')
        const unseenBefore = pools.roster.filter((id) => !seen.has(id))
        const expectedFromUnseen = Math.min(unseenBefore.length, regular.length)
        expect(
          regular.filter((boss) => unseenBefore.includes(boss.id)),
          `${difficulty} · 第 ${run.groups.indexOf(group) + 1} 层`,
        ).toHaveLength(expectedFromUnseen)
        for (const boss of regular) seen.add(boss.id)
      }
      expect(seen.size, difficulty).toBe(pools.roster.length)
    }
  })

  it('同一颗种子 + 同一难度复现同一组合；不同种子会换组合', () => {
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const a = runFor(difficulty, 20261128)
      const b = runFor(difficulty, 20261128)
      expect(a.groups.map((group) => group.map((boss) => boss.id))).toEqual(
        b.groups.map((group) => group.map((boss) => boss.id)),
      )
      const seen = new Set<string>()
      for (let seed = 1; seed <= 40; seed++) {
        const run = runFor(difficulty, seed)
        seen.add(run.groups.map((group) => group.map((boss) => boss.id).join('/')).join('|'))
      }
      expect(seen.size, difficulty).toBeGreaterThan(1)
    }
  })
})

describe('BOSSRUSH 数值成长', () => {
  it('简单难度血量逐层上升，最后一层额外乘最终倍率', () => {
    const run = runFor('easy', 7)
    const hp = Array.from({ length: run.totalFloors }, (_, i) => run.scalingFor(i + 1).hp)
    for (let i = 1; i < hp.length; i++) expect(hp[i]!).toBeGreaterThan(hp[i - 1]!)
    const configHp = config()
    const rawGrowth = Math.round(
      configHp.hpBase *
        Math.pow(configHp.hpGrowth, run.totalFloors - 1) *
        configHp.finalHpMultiplier,
    )
    expect(hp[hp.length - 1]!).toBe(rawGrowth)
    // 用户实测 2000 血十秒内会被融掉；最终层必须显著高于这个量级。
    expect(hp[hp.length - 1]!).toBeGreaterThan(10_000)
  })

  it('多首领时单只血量按难度缩：层总血量约为 1 / 1.4 / 1.65 倍', () => {
    const c = config()
    const floor1 = (difficulty: Difficulty) => runFor(difficulty).scalingFor(1).hp
    expect(floor1('easy')).toBe(c.hpBase)
    expect(floor1('normal')).toBe(Math.round(c.hpBase * c.bossHpScale.normal))
    expect(floor1('hard')).toBe(Math.round(c.hpBase * c.bossHpScale.hard))
    const total = (difficulty: Difficulty) =>
      runFor(difficulty).scalingFor(1).hp * runFor(difficulty).bossesPerFloor
    expect(total('normal') / total('easy')).toBeCloseTo(1.4, 1)
    expect(total('hard') / total('easy')).toBeCloseTo(1.65, 1)
    // 多首领同时开火，单只伤害也略降：总伤害密度约为 1 / 1.7 / 2.1 倍。
    expect(runFor('easy').scalingFor(1).damageMultiplier).toBe(1)
    expect(runFor('normal').scalingFor(1).damageMultiplier).toBeCloseTo(
      c.bossDamageScale.normal,
    )
    expect(runFor('hard').scalingFor(1).damageMultiplier).toBeCloseTo(
      c.bossDamageScale.hard,
    )
    // 最终层即使困难也仍显著高于「十秒被融」的 2000。
    for (const difficulty of ['easy', 'normal', 'hard'] as const)
      expect(runFor(difficulty).scalingFor(8).hp, difficulty).toBeGreaterThan(10_000)
  })

  it('移速 / 弹幕频率 / 弹幕速度 / 技能频率 / 伤害都随层数单调上升', () => {
    const run = runFor('normal', 7)
    const keys = [
      'speedMultiplier',
      'barrageRate',
      'projectileSpeedMultiplier',
      'skillRate',
      'damageMultiplier',
    ] as const
    for (const key of keys) {
      let previous = 0
      for (let floor = 1; floor <= run.totalFloors; floor++) {
        const value = run.scalingFor(floor)[key]
        expect(value, `${key} 第 ${floor} 层`).toBeGreaterThan(previous)
        previous = value
      }
    }
    expect(run.scalingFor(1).speedMultiplier).toBe(1)
    expect(run.scalingFor(1).barrageRate).toBe(1)
  })
})

describe('BOSSRUSH 开局武器', () => {
  it('武器表里至少各有一把近战 / 远程，开局「一击一远」抽得齐', () => {
    const combat = parseCombatConfig(readJson('combat.json'))
    expect(combat.weapons.some((weapon) => weapon.mode === 'melee')).toBe(true)
    expect(combat.weapons.some((weapon) => weapon.mode !== 'melee')).toBe(true)
  })
})

describe('BOSSRUSH 奖励与经验', () => {
  it('金币按「层」和「这一层几位首领」发；经验按层发', () => {
    const easy = runFor('easy', 1)
    const normal = runFor('normal', 1)
    const hard = runFor('hard', 1)
    const easyReward = easy.defeatCurrentBoss()
    const normalReward = normal.defeatCurrentBoss()
    const hardReward = hard.defeatCurrentBoss()
    expect(easyReward.coins).toBe(config().coinsPerBossBase)
    expect(normalReward.coins).toBe(config().coinsPerBossBase * 2)
    expect(hardReward.coins).toBe(config().coinsPerBossBase * 3)
    for (const reward of [easyReward, normalReward, hardReward]) {
      expect(reward.xpGained).toBe(config().xpPerBossBase)
      expect(reward.levelUps).toBe(1)
      expect(reward.talentChoices).toBe(config().talentChoicesPerLevel)
    }
  })

  it('八层打完共 8 次升级、16 次天赋（高于闯关模式的 12 次上限）', () => {
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const run = runFor(difficulty, 1)
      let talentChoices = 0
      for (let floor = 1; floor <= run.totalFloors; floor++) {
        const reward = run.defeatCurrentBoss()
        expect(reward.floor).toBe(floor)
        talentChoices += reward.talentChoices
      }
      expect(talentChoices, difficulty).toBe(16)
      expect(run.level, difficulty).toBe(9)
      expect(run.allDefeated).toBe(true)
      expect(run.currentFloor).toBe(8)
      expect(() => run.defeatCurrentBoss()).toThrow(/全部通关/)
    }
  })
})
