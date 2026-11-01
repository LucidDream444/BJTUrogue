import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CONFIG_FILE_NAMES, parseConfigBundle } from '@/core/config'
import { buildCodexEntries, codexAnimationKey, moveCodexIndex } from './codexCatalog'

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
  it('普通敌人按代际展开，包含两种校园动物与三种首领', () => {
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
      'heart-demon',
    ])
    expect(entries.filter((entry) => entry.category === '首领')).toHaveLength(3)
  })

  it('数值来自当前难度派生，不在图鉴里复制一份', () => {
    const normal = buildCodexEntries(bundle(), 'normal')
    const hard = buildCodexEntries(bundle(), 'hard')
    const normalTank = normal.find((entry) => entry.id === 'tank')!
    const hardTank = hard.find((entry) => entry.id === 'tank')!
    expect(normalTank.stats.find((stat) => stat.label === '生命值')?.value).toBe('520')
    expect(hardTank.stats.find((stat) => stat.label === '生命值')?.value).toBe('676')
  })

  it('已交付的普通敌人都有可播放的循环待机动画', () => {
    const entries = buildCodexEntries(bundle(), 'normal').filter(
      (entry) => entry.category === '普通敌人',
    )
    for (const entry of entries) expect(codexAnimationKey(entry.textureKey)).toBeTruthy()
  })

  it('首领展示独立正式美术，最终身份是心魔', () => {
    const boss = buildCodexEntries(bundle(), 'normal').find((entry) => entry.id === 'stage2-boss')!
    expect(boss.hasArt).toBe(true)
    expect(codexAnimationKey(boss.textureKey)).toBe('enemy_stage2_idle_anim')
    expect(buildCodexEntries(bundle(), 'normal').find((entry) => entry.id === 'heart-demon')?.name).toBe('心魔')
  })

  it('校园动物的攻击数值读取配置，文案解释互伤与猫的安全退场', () => {
    const config = bundle()
    const entries = buildCodexEntries(config, 'normal')
    const duck = entries.find((entry) => entry.id === 'muscovy')!
    const cat = entries.find((entry) => entry.id === 'nightmare_cat')!
    expect(duck.stats.find((value) => value.label === '冲刺距离')?.value).toBe(`${config.enemies.enemies.muscovy.charge.dashDistance} px`)
    expect(duck.role).toContain('其他敌人')
    expect(cat.role).toContain('双方飞行子弹')
    expect(cat.lorePlaceholder).toContain('恢复正常')
  })

  it('列表选择首尾环绕', () => {
    expect(moveCodexIndex(0, -1, 6)).toBe(5)
    expect(moveCodexIndex(5, 1, 6)).toBe(0)
    expect(moveCodexIndex(0, 1, 0)).toBe(0)
  })
})
