import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TypedBus, type GameEvents } from '@/core/events'
import { RunLedger } from '../run/RunLedger'
import { createDefaultProfile } from '../profile/defaults'
import type { ProfileData } from '../profile/types'
import { MetaConfigError, parseMetaConfig, type MetaConfig } from '../metaConfig'
import {
  SKILL_MAX_LEVEL,
  buySkillUpgrade,
  coinsForRun,
  effectiveStats,
  isUnlocked,
  settleRun,
  skillLevelOf,
  skillUpgradeCost,
  trackKey,
  unlock,
} from './progress'

const REAL_RAW: unknown = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../public/config/meta.json', import.meta.url)),
    'utf8',
  ),
)
const META: MetaConfig = parseMetaConfig(REAL_RAW)

function profile(): ProfileData {
  return createDefaultProfile()
}

describe('meta.json 角色技能', () => {
  it('三个角色都恰好四级，并有三笔统一结构的升级费用', () => {
    expect(Object.keys(META.characters)).toEqual(['student', 'athlete', 'scholar'])
    for (const character of Object.values(META.characters)) {
      expect(character.skill.levels).toHaveLength(SKILL_MAX_LEVEL)
      expect(character.skill.upgradeCosts).toHaveLength(SKILL_MAX_LEVEL - 1)
    }
  })

  it('坏表在解析时当场拒绝', () => {
    expect(() => parseMetaConfig({ schemaVersion: 2 })).toThrow(MetaConfigError)
    const bad = structuredClone(REAL_RAW) as {
      characters: Record<string, { skill: { levels: unknown[] } }>
    }
    bad.characters.student!.skill.levels.pop()
    expect(() => parseMetaConfig(bad)).toThrow(MetaConfigError)
  })

  it('角色固定战斗身份仍从同一份配置读取', () => {
    const p = profile()
    expect(effectiveStats(p, META, 'student')).toMatchObject({
      maxHpPct: 10,
      moveSpeedPct: 0,
      energyRegenPct: 0,
    })
    expect(effectiveStats(p, META, 'athlete').moveSpeedPct).toBe(20)
    expect(effectiveStats(p, META, 'scholar').energyRegenPct).toBe(50)
  })
})

describe('统一技能升级流程', () => {
  it('已解锁角色默认 1 级，未解锁角色 0 级', () => {
    const p = profile()
    expect(skillLevelOf(p, META, 'student')).toBe(1)
    expect(skillLevelOf(p, META, 'athlete')).toBe(0)
  })

  it('新生按 1→2→3→4 顺序购买，费用来自同一数组', () => {
    const p = profile()
    p.currency.coins = 10_000
    for (let level = 1; level < SKILL_MAX_LEVEL; level++) {
      expect(skillLevelOf(p, META, 'student')).toBe(level)
      expect(skillUpgradeCost(p, META, 'student')).toBe(
        META.characters.student!.skill.upgradeCosts[level - 1],
      )
      expect(buySkillUpgrade(p, META, 'student').ok).toBe(true)
    }
    expect(skillLevelOf(p, META, 'student')).toBe(4)
    expect(skillUpgradeCost(p, META, 'student')).toBeNull()
  })

  it('三个角色共用同一个升级入口和相同次数', () => {
    const p = profile()
    p.unlocks.characters.push('athlete', 'scholar')
    p.currency.coins = 10_000
    for (const id of ['student', 'athlete', 'scholar']) {
      for (let i = 0; i < 3; i++) expect(buySkillUpgrade(p, META, id).ok).toBe(true)
      expect(skillLevelOf(p, META, id)).toBe(4)
    }
  })

  it('币不足时不扣款、不升级', () => {
    const p = profile()
    p.currency.coins = 1
    const cost = skillUpgradeCost(p, META, 'student')!
    const result = buySkillUpgrade(p, META, 'student')
    expect(result.ok).toBe(false)
    expect(p.currency.coins).toBe(1)
    expect(skillLevelOf(p, META, 'student')).toBe(1)
    expect(result.notice).toContain(String(cost - 1))
  })
})

describe('一局的收益', () => {
  it('三个来源相加，负数被夹到 0', () => {
    const e = META.economy
    expect(coinsForRun(META, { outcome: 'dead', depth: 3, kills: 10, clearedRooms: 2 })).toBe(
      10 * e.coinsPerKill + 2 * e.coinsPerClearedRoom + 3 * e.coinsPerDepth,
    )
    expect(coinsForRun(META, { outcome: 'dead', depth: -5, kills: -3, clearedRooms: -1 })).toBe(0)
  })

  it('阵亡照样发币，币只加不减', () => {
    const p = profile()
    p.currency.coins = 500
    const r = settleRun(p, META, { outcome: 'dead', depth: 2, kills: 8, clearedRooms: 1 })
    expect(r.coinsEarned).toBeGreaterThan(0)
    expect(p.currency.coins).toBe(500 + r.coinsEarned)
  })
})

describe('RunLedger', () => {
  function killed(kind: 'enemy' | 'player'): GameEvents['entity_killed'] {
    return { id: 1, kind, x: 0, y: 0, sourceId: 0 }
  }

  it('只数敌人，玩家死亡不算击杀', () => {
    const bus = new TypedBus<GameEvents>()
    const ledger = new RunLedger(bus)
    bus.emit('entity_killed', killed('enemy'))
    bus.emit('entity_killed', killed('enemy'))
    bus.emit('entity_killed', killed('player'))
    expect(ledger.kills).toBe(2)
    ledger.dispose()
  })

  it('dispose 后停止计数', () => {
    const bus = new TypedBus<GameEvents>()
    const ledger = new RunLedger(bus)
    ledger.dispose()
    bus.emit('entity_killed', killed('enemy'))
    expect(ledger.kills).toBe(0)
  })
})

describe('解锁', () => {
  it('够钱：扣币并放行角色', () => {
    const p = profile()
    p.currency.coins = 1000
    const r = unlock(p, META, 'athlete')
    expect(r.ok).toBe(true)
    expect(p.currency.coins).toBe(1000 - META.characters.athlete!.unlockCost)
    expect(isUnlocked(p, 'athlete')).toBe(true)
    expect(skillLevelOf(p, META, 'athlete')).toBe(1)
  })

  it('不够钱和重复解锁都不扣款', () => {
    const p = profile()
    p.currency.coins = 10
    expect(unlock(p, META, 'athlete').ok).toBe(false)
    p.currency.coins = 1000
    expect(unlock(p, META, 'athlete').ok).toBe(true)
    const before = p.currency.coins
    expect(unlock(p, META, 'athlete').ok).toBe(false)
    expect(p.currency.coins).toBe(before)
  })

  it('不再存在独立技能解锁或旧快速击发', () => {
    expect(unlock(profile(), META, 'rapid_fire').ok).toBe(false)
    expect(profile().upgrades[trackKey('student', 'skill')]).toBeUndefined()
  })
})
