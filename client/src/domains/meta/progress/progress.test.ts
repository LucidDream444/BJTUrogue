/**
 * 局外成长的规则。**跑在 node 环境**（不碰 Phaser、不碰 DOM）。
 *
 * 这里挑的用例都是"坏掉时看起来没事"的那类：
 *
 * | 坏了的样子 | 对应用例 |
 * |---|---|
 * | 死亡时币被清掉 | 结算只加不减 |
 * | 币不够却买成了 / 扣了钱没升级 | 购买的三条分支 |
 * | 成本曲线算成"每级一样贵" | 成本随等级增长 |
 * | 玩家死亡被算成"击杀"，越死越有钱 | `RunLedger` 只数敌人（另有用例） |
 * | 线上那份 meta.json 其实解析不了 | 直接读真实文件解析 |
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TypedBus, type GameEvents } from '@/core/events'
import { RunLedger } from '../run/RunLedger'
import { createDefaultProfile } from '../profile/defaults'
import type { ProfileData } from '../profile/types'
import { MetaConfigError, costOfNextLevel, parseMetaConfig, type MetaConfig } from '../metaConfig'
import {
  buyUpgrade,
  coinsForRun,
  effectiveStats,
  formatPerLevel,
  formatTotal,
  levelOf,
  settleRun,
  totalLevelsFor,
  trackKey,
} from './progress'

/** 线上那份表。**不另抄一份**：抄的那份迟早和它漂，而这正是要防的事。 */
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

describe('meta.json 解析', () => {
  it('线上那份能解析（反向证据：这就是真表，不是测试里另搭的假表）', () => {
    expect(META.characters.student).toBeDefined()
    expect(META.characters.student.tracks.map((t) => t.id)).toEqual(['maxHp', 'magic', 'armor'])
    expect(META.skills.rapid_fire.tracks[0]?.id).toBe('attackSpeedPct')
  })

  it('坏表要当场抛，而不是静默当成"没有成长项"', () => {
    expect(() => parseMetaConfig({ schemaVersion: 1 })).toThrow(MetaConfigError)
    const bad = structuredClone(REAL_RAW) as { skills: Record<string, { tracks: unknown }> }
    ;(bad.skills.rapid_fire.tracks as { unit: string }[])[0]!.unit = 'wat'
    expect(() => parseMetaConfig(bad)).toThrow(MetaConfigError)
  })
})

describe('成本曲线', () => {
  const track = META.characters.student.tracks[0]!

  it('第一级就是 baseCost，之后按 costGrowth 涨', () => {
    const c0 = costOfNextLevel(track, 0)!
    const c1 = costOfNextLevel(track, 1)!
    expect(c0).toBe(track.baseCost)
    expect(c1).toBeGreaterThan(c0)
    expect(c1).toBe(Math.round(track.baseCost * track.costGrowth))
  })

  it('满级之后没有"下一级"', () => {
    expect(costOfNextLevel(track, track.maxLevel)).toBeNull()
    expect(costOfNextLevel(track, track.maxLevel + 5)).toBeNull()
  })
})

describe('买一级', () => {
  const track = META.characters.student.tracks[0]!

  it('够钱：扣币、升级、计数跟着走', () => {
    const p = profile()
    p.currency.coins = 1000
    const r = buyUpgrade(p, 'student', track)
    expect(r.ok).toBe(true)
    expect(p.currency.coins).toBe(1000 - r.cost)
    expect(levelOf(p, 'student', track.id)).toBe(1)
    expect(totalLevelsFor(p, 'student')).toBe(1)
  })

  it('不够钱：一分不扣，提示里说清还差多少', () => {
    const p = profile()
    p.currency.coins = 1
    const r = buyUpgrade(p, 'student', track)
    expect(r.ok).toBe(false)
    expect(p.currency.coins).toBe(1)
    expect(levelOf(p, 'student', track.id)).toBe(0)
    expect(r.notice).toContain('还差')
  })

  it('满级：不再扣币', () => {
    const p = profile()
    p.currency.coins = 999999
    p.upgrades[trackKey('student', track.id)] = track.maxLevel
    const before = p.currency.coins
    const r = buyUpgrade(p, 'student', track)
    expect(r.ok).toBe(false)
    expect(p.currency.coins).toBe(before)
    expect(r.notice).toContain('满级')
  })
})

describe('最终数值', () => {
  it('没升级时就是基础值', () => {
    const s = effectiveStats(profile(), META, 'student')
    expect(s.maxHp).toBe(META.characters.student.base.maxHp)
    expect(s.armor).toBe(META.characters.student.base.armor)
  })

  it('角色成长线与技能成长线叠在同一个结果上', () => {
    const p = profile()
    p.upgrades[trackKey('student', 'maxHp')] = 2
    p.upgrades[trackKey('rapid_fire', 'attackSpeedPct')] = 3
    const s = effectiveStats(p, META, 'student')
    const hp = META.characters.student.tracks.find((t) => t.id === 'maxHp')!
    const spd = META.skills.rapid_fire.tracks.find((t) => t.id === 'attackSpeedPct')!
    expect(s.maxHp).toBe(META.characters.student.base.maxHp + hp.perLevel * 2)
    expect(s.attackSpeedPct).toBe(spd.perLevel * 3)
  })

  it('没解锁的技能不算数（技能加成的开关就是 unlocks）', () => {
    const p = profile()
    p.unlocks.skills = []
    p.upgrades[trackKey('rapid_fire', 'attackSpeedPct')] = 5
    expect(effectiveStats(p, META, 'student').attackSpeedPct).toBe(0)
  })
})

describe('一局的收益', () => {
  it('三个来源相加，负数被夹到 0（外面传进来的脏数不该变成"倒扣"）', () => {
    const e = META.economy
    expect(coinsForRun(META, { outcome: 'dead', depth: 3, kills: 10, clearedRooms: 2 })).toBe(
      10 * e.coinsPerKill + 2 * e.coinsPerClearedRoom + 3 * e.coinsPerDepth,
    )
    expect(coinsForRun(META, { outcome: 'dead', depth: -5, kills: -3, clearedRooms: -1 })).toBe(0)
  })

  it('⚠️ 阵亡照样发币、币只加不减（这是设计的硬要求）', () => {
    const p = profile()
    p.currency.coins = 500
    const r = settleRun(p, META, { outcome: 'dead', depth: 2, kills: 8, clearedRooms: 1 })
    expect(r.coinsEarned).toBeGreaterThan(0)
    expect(p.currency.coins).toBe(500 + r.coinsEarned)
    expect(r.coinsTotal).toBe(p.currency.coins)
  })

  it('统计跟着更新：局数 / 死亡 / 最深', () => {
    const p = profile()
    settleRun(p, META, { outcome: 'dead', depth: 3, kills: 1, clearedRooms: 0 })
    settleRun(p, META, { outcome: 'cleared', depth: 7, kills: 1, clearedRooms: 0 })
    settleRun(p, META, { outcome: 'dead', depth: 2, kills: 1, clearedRooms: 0 })
    expect(p.stats.runs).toBe(3)
    expect(p.stats.deaths).toBe(2)
    expect(p.stats.wins).toBe(1)
    expect(p.stats.bestDepth).toBe(7) // 只记最好的一次，不会被后面的 2 拉回去
  })
})

describe('显示用的格式化', () => {
  it('点数与百分比各写各的后缀', () => {
    const hp = META.characters.student.tracks.find((t) => t.id === 'maxHp')!
    const spd = META.skills.rapid_fire.tracks.find((t) => t.id === 'attackSpeedPct')!
    expect(formatPerLevel(hp)).toBe(`+${hp.perLevel}`)
    expect(formatPerLevel(spd)).toBe(`+${spd.perLevel}%`)
    expect(formatTotal(spd, 3)).toBe(`+${spd.perLevel * 3}%`)
  })
})

describe('RunLedger（一局的账本）', () => {
  /** 总线上的击杀事件长这样。只填断言要用到的字段。 */
  function killed(kind: 'enemy' | 'player'): GameEvents['entity_killed'] {
    return { id: 1, kind, x: 0, y: 0, sourceId: 0 }
  }

  it('只数敌人：玩家死亡不算击杀', () => {
    const bus = new TypedBus<GameEvents>()
    const ledger = new RunLedger(bus)
    bus.emit('entity_killed', killed('enemy'))
    bus.emit('entity_killed', killed('enemy'))
    bus.emit('entity_killed', killed('player'))
    expect(ledger.kills).toBe(2)
    ledger.dispose()
  })

  it('dispose 之后不再计数（场景结束忘了退订会让下一个场景接着数）', () => {
    const bus = new TypedBus<GameEvents>()
    const ledger = new RunLedger(bus)
    ledger.dispose()
    bus.emit('entity_killed', killed('enemy'))
    expect(ledger.kills).toBe(0)
  })

  it('层数至少是 1，清房靠宿主报（C1 还没有 room_cleared）', () => {
    const bus = new TypedBus<GameEvents>()
    const ledger = new RunLedger(bus)
    ledger.setDepth(0)
    ledger.countClearedRoom()
    const input = ledger.input('dead')
    expect(input.depth).toBe(1)
    expect(input.clearedRooms).toBe(1)
    expect(input.outcome).toBe('dead')
    ledger.dispose()
  })
})
