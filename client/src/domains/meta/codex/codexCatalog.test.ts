import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CONFIG_FILE_NAMES, deriveTank, parseConfigBundle } from '@/core/config'
import { bossSkillNotes, codexBossSkillConfig } from './bossCodexNotes'
import { buildCodexEntries, codexAnimationKey, codexEncounterConfig, moveCodexIndex } from './codexCatalog'

function readConfig(name: (typeof CONFIG_FILE_NAMES)[number]): unknown {
  return JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../../../public/config/${name}`, import.meta.url)),
      'utf8',
    ),
  )
}

function bundle() {
  return parseConfigBundle({
    balance: readConfig('balance.json'),
    difficulty: readConfig('difficulty.json'),
    enemies: readConfig('enemies.json'),
  })
}

describe('怪物图鉴目录', () => {
  it('普通敌人按代际展开，包含两种校园动物与七位首领', () => {
    const entries = buildCodexEntries(bundle(), 'normal')
    expect(entries.map((entry) => entry.id)).toEqual([
      'splitter-0',
      'splitter-1',
      'splitter-2',
      'tank',
      'grabber',
      'sprayer',
      'muscovy',
      'nightmare_cat',
      'first-boss',
      'stage2-boss',
      'acid-boss',
      'sports-boss',
      'rollcall-boss',
      'banana-cat-boss',
      'fat-cat-boss',
      'nailong-final',
    ])
    expect(entries.filter((entry) => entry.category === '首领')).toHaveLength(8)
  })

  it('数值来自当前难度派生，不在图鉴里复制一份', () => {
    const b = bundle()
    const normal = buildCodexEntries(b, 'normal')
    const hard = buildCodexEntries(b, 'hard')
    const normalTank = normal.find((entry) => entry.id === 'tank')!
    const hardTank = hard.find((entry) => entry.id === 'tank')!
    const normalHp = deriveTank(
      b.enemies.enemies.tank,
      b.difficulty.difficulties.normal,
      b.balance,
    ).maxHp
    const hardHp = deriveTank(
      b.enemies.enemies.tank,
      b.difficulty.difficulties.hard,
      b.balance,
    ).maxHp
    expect(normalTank.stats.find((stat) => stat.label === '生命值')?.value).toBe(String(normalHp))
    expect(hardTank.stats.find((stat) => stat.label === '生命值')?.value).toBe(String(hardHp))
  })

  it('已交付的普通敌人都有可播放的循环待机动画', () => {
    const entries = buildCodexEntries(bundle(), 'normal').filter(
      (entry) => entry.category === '普通敌人',
    )
    for (const entry of entries) expect(codexAnimationKey(entry.textureKey)).toBeTruthy()
  })

  it('首领展示独立正式美术，最终身份是奶龙', () => {
    const boss = buildCodexEntries(bundle(), 'normal').find((entry) => entry.id === 'stage2-boss')!
    expect(boss.hasArt).toBe(true)
    expect(codexAnimationKey(boss.textureKey)).toBe('boss_pigeon_idle_loop')
    expect(buildCodexEntries(bundle(), 'normal').find((entry) => entry.id === 'nailong-final')?.name).toBe('奶龙')
  })

  it('校园动物的攻击数值读取配置，文案解释互伤与猫的安全退场', () => {
    const config = bundle()
    const entries = buildCodexEntries(config, 'normal')
    const duck = entries.find((entry) => entry.id === 'muscovy')!
    const cat = entries.find((entry) => entry.id === 'nightmare_cat')!
    expect(duck.stats.find((value) => value.label === '冲刺距离')?.value).toBe(`${config.enemies.enemies.muscovy.charge.dashDistance}px`)
    expect(duck.role).toContain('其他敌人')
    expect(cat.role).toContain('双方飞行子弹')
    expect(cat.lorePlaceholder).toContain('去掉黑化')
  })

  it('完整战斗笔记明确抓取连点、敌我互伤与数值', () => {
    const config = bundle()
    config.enemies.enemies.nightmare_cat.vortex.pullSpeed = 187
    config.enemies.enemies.nightmare_cat.vortex.turnRateRadPerSec = 2.7
    const encounter = codexEncounterConfig({ encounter: {
      bossHp: 900, bossHpPerStage: 300, bossDamageMultiplier: 1.5,
      bossReinforcements: { cooldownMs: 8000, spawnCount: 2, maxAlive: 6 },
    } })!
    const entries = buildCodexEntries(config, 'hard', encounter)
    for (const entry of entries) expect(entry.combatNotes.length).toBeGreaterThan(0)
    const grabber = entries.find((entry) => entry.id === 'grabber')!
    expect(grabber.combatNotes.join('')).toContain('持续快速点击鼠标左键')
    expect(grabber.combatNotes.join('')).toContain('长按不代替连点')
    expect(entries.find((entry) => entry.id === 'muscovy')!.combatNotes.join('')).toContain('冲刺敌我不分')
    const cat = entries.find((entry) => entry.id === 'nightmare_cat')!
    expect(cat.combatNotes.join('')).toContain('187px/s')
    expect(cat.combatNotes.join('')).toContain('2.7rad/s')
    const paper = entries.find((entry) => entry.id === 'stage2-boss')!
    expect(paper.combatNotes.join('')).toContain(`单次攻击伤害${Math.round(config.enemies.stage2Boss.projectile.damage * config.difficulty.difficulties.hard.enemyDamage * 1.5)}`)
    expect(paper.combatNotes.join('')).toContain('第1层生命900')
    expect(paper.combatNotes.join('')).toContain('每8秒')
    const final = entries.find((entry) => entry.id === 'nailong-final')!
    expect(final.combatNotes.join('')).toContain('近身范围下砸')
    expect(final.combatNotes.join('')).toContain('第3层生命1800')
    expect(codexEncounterConfig({ encounter: { bossHp: 'oops' } })).toBeUndefined()
  })

  it('用户背景文案独立保留，三代纸团共享北交信纸介绍', () => {
    const entries = buildCodexEntries(bundle(), 'normal')
    for (const entry of entries.filter((candidate) => candidate.id.startsWith('splitter-')))
      expect(entry.lorePlaceholder).toContain('北京交通大学信纸')
    expect(entries.find((entry) => entry.id === 'tank')!.lorePlaceholder).toContain('计组太多知识')
    expect(entries.find((entry) => entry.id === 'sprayer')!.lorePlaceholder).toContain('大学澡堂')
    expect(entries.find((entry) => entry.id === 'stage2-boss')!.lorePlaceholder).toContain('千纸鹤')
  })

  it('七位首领技能表完整加载，战斗笔记覆盖全部配置技能和数值', () => {
    const raw = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../public/config/boss-skills.json', import.meta.url)), 'utf8'))
    const table = codexBossSkillConfig(raw)!
    expect(table).toBeTruthy()
    const entries = buildCodexEntries(bundle(), 'normal', undefined, table)
    const ids = ['first-boss', 'stage2-boss', 'acid-boss', 'sports-boss', 'rollcall-boss', 'banana-cat-boss', 'fat-cat-boss', 'nailong-final']
    for (const [index, id] of ids.entries()) {
      const boss = table.bosses[String(index + 2)]!
      const entry = entries.find((candidate) => candidate.id === id)!
      expect(entry.name).toBe(boss.name)
      expect(entry.combatNotes.filter((note) => note.startsWith('技能'))).toHaveLength(boss.skills.length)
      expect(entry.combatNotes.join('')).not.toContain('技能记录正在整理')
    }
    expect(bossSkillNotes(table, 2, 1).join('')).toContain('8～12只')
    expect(bossSkillNotes(table, 4, 1).join('')).toContain('强制直线滑出')
    expect(bossSkillNotes(table, 9, 1).join('')).toContain('3秒')
    table.bosses['3']!.skills.find((skill) => skill.id === 'radial')!.damage = 27
    const kite = buildCodexEntries(bundle(), 'normal', undefined, table).find((entry) => entry.id === 'stage2-boss')!
    expect(kite.stats.find((stat) => stat.label === '基础单发伤害')?.value).toBe('27')
    expect(kite.combatNotes.join('')).toContain('每发27点伤害')
    expect(codexBossSkillConfig({ schemaVersion: 1, bosses: {} })).toBeUndefined()
  })

  it('战斗笔记一页内，且英文/数字旁没有空格', () => {
    const raw = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../public/config/boss-skills.json', import.meta.url)), 'utf8'))
    const table = codexBossSkillConfig(raw)!
    const encounter = codexEncounterConfig({ encounter: {
      bossHp: 900, bossHpPerStage: 300, bossDamageMultiplier: 1.5,
      bossReinforcements: { cooldownMs: 8000, spawnCount: 2, maxAlive: 6 },
    } })!
    const entries = buildCodexEntries(bundle(), 'normal', encounter, table)
    for (const entry of entries) {
      const notes = entry.combatNotes.join('\n\n')
      expect(notes.length, `${entry.id} 的战斗笔记 ${notes.length} 字`).toBeLessThanOrEqual(180)
      for (const value of [
        entry.variant,
        entry.role,
        entry.lorePlaceholder,
        ...entry.stats.map((stat) => stat.value),
        ...entry.combatNotes,
      ])
        expect(value, entry.id).not.toMatch(/[ \t]/)
    }
  })

  it('列表选择首尾环绕', () => {
    expect(moveCodexIndex(0, -1, 6)).toBe(5)
    expect(moveCodexIndex(5, 1, 6)).toBe(0)
    expect(moveCodexIndex(0, 1, 0)).toBe(0)
  })
})
