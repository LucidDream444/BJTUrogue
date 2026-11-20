import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FixedRng, Rng } from '@/core/rng'
import { BossSkillRuntime, parseBossSkillsTable, type BossSkillAppearance, type BossSkillPort, type BossSkillUnit, type BossSkillVolley } from './BossSkillRuntime'

const rawTable = (): Record<string, unknown> => JSON.parse(readFileSync(new URL('../../../public/config/boss-skills.json', import.meta.url), 'utf8'))
const table = parseBossSkillsTable(rawTable())

function fixture(stage = 9, rng = new Rng(20261105)) {
  const units = new Map<number, BossSkillUnit>()
  const boss: BossSkillUnit = { id: 100, x: 0, y: 0, hp: 900, maxHp: 900, kind: 'tank', gen: 0, radius: 20, vx: 0, vy: 0, bossStage: stage }
  units.set(100, boss)
  let nextId = 101
  const controls = new Map<number, number>(), invulnerability = new Map<number, number>(), stuns = new Map<number, number>()
  const appearance = new Map<number, BossSkillAppearance>()
  const boosts = new Map<number, { multiplier: number; untilMs: number }>()
  const volleys: BossSkillVolley[] = [], damage: { id: number; amount: number }[] = []
  const slows: { multiplier: number; untilMs: number }[] = [], casts: string[] = [], laughs: { id: number; untilMs: number }[] = [], transforms: string[] = []
  const rallies = new Map<number, number>(), moves: { id: number; x: number; y: number }[] = []
  const addMinion = (kind: BossSkillUnit['kind'] = 'tank', hp = 100, x = 50, y = 50): number => {
    const id = nextId++
    units.set(id, { ...boss, id, x, y, hp, maxHp: hp, kind, bossStage: undefined })
    return id
  }
  const port: BossSkillPort = {
    rng, damageMultiplier: 1.5, normalEnemyKinds: ['tank', 'muscovy', 'grabber'],
    units: () => [...units.values()].map((value) => ({ ...value })),
    player: () => ({ id: 1, x: 200, y: 0, radius: 10, alive: true, player: true, vx: 1, vy: 0 }),
    bounds: () => ({ left: -500, top: -500, right: 500, bottom: 500 }),
    safeSpawn: (x, y, radius) => ({ x: Math.max(-500 + radius, Math.min(500 - radius, x)), y: Math.max(-500 + radius, Math.min(500 - radius, y)) }),
    projectileBlocked: () => false,
    setUnitPosition: (id, x, y) => { const unit = units.get(id); if (!unit) return false; unit.x = x; unit.y = y; moves.push({ id, x, y }); return true },
    setUnitHp: (id, hp) => { const unit = units.get(id); if (!unit) return false; unit.hp = hp; return true },
    setUnitSpeedBoost: (id, multiplier, untilMs) => { boosts.set(id, { multiplier, untilMs }) },
    setBossInvulnerable: (id, untilMs) => { invulnerability.set(id, untilMs) },
    setBossControlled: (id, untilMs) => { controls.set(id, untilMs) },
    setUnitStunned: (id, untilMs) => { stuns.set(id, untilMs) },
    setBossAppearance: (id, options) => { appearance.set(id, options) },
    fireBossVolley: (_id, options) => { volleys.push(options); return options.count },
    summonSkillEnemy: (kind, _gen, x, y) => addMinion(kind, 100, x, y),
    spawnBossClone: (_owner, x, y, hp) => addMinion('tank', hp, x, y),
    despawnSkillUnit: (id) => { units.delete(id) },
    transformMinions: (kind) => { transforms.push(kind); let count = 0; for (const unit of units.values()) if (unit.bossStage === undefined) { unit.kind = kind; count++ } return count },
    playerSlow: (multiplier, untilMs) => { slows.push({ multiplier, untilMs }) },
    damage: (id, amount) => { damage.push({ id, amount }) },
    rallyMinion: (id, untilMs) => { rallies.set(id, untilMs) },
    onCast: (_id, _floor, skill) => { casts.push(skill) },
    onLaugh: (id, untilMs) => { laughs.push({ id, untilMs }) },
  }
  const runtime = new BossSkillRuntime(table, port)
  runtime.update(0, 16, 100, stage)
  const step = (now: number, dt = 16) => runtime.update(now, dt, 100, stage)
  return { runtime, port, units, boss, controls, invulnerability, stuns, appearance, boosts, volleys, damage, slows, casts, laughs, transforms, rallies, moves, addMinion, step }
}

describe('首领技能配置', () => {
  it('正式八位首领配置完整解析', () => {
    expect(Object.keys(table.bosses)).toEqual(['2', '3', '4', '5', '6', '7', '8', '9'])
    expect(table.bosses['9']!.skills.map((skill) => skill.id)).toEqual(['mimic_chain', 'rewind', 'player_shadow'])
    expect(Object.keys(table.barrages)).toEqual(['2', '3', '4', '5', '6', '7', '8', '9'])
    for (const floor of Object.keys(table.barrages)) {
      const patterns = table.barrages[floor]!.patterns
      expect(patterns, floor).toHaveLength(3)
      for (const pattern of patterns) {
        expect(pattern.bursts ?? 1, `${floor}/${pattern.id}`).toBeGreaterThanOrEqual(1)
        expect(pattern.bounceCount ?? 0, `${floor}/${pattern.id}`).toBeGreaterThanOrEqual(0)
        if (pattern.pattern === 'line' && pattern.count > 1)
          expect(pattern.lineSpacingPx, `${floor}/${pattern.id}`).toBeGreaterThan(0)
      }
    }
  })
  it('拒绝非法的连发/反弹/直线间距参数', () => {
    for (const mutate of [
      (raw: ReturnType<typeof rawTable>) => {
        ;(raw.barrages as Record<string, { patterns: { bursts: number }[] }>)['7']!.patterns[0]!.bursts = 0
      },
      (raw: ReturnType<typeof rawTable>) => {
        ;(raw.barrages as Record<string, { patterns: { bounceCount: number }[] }>)['7']!.patterns[0]!.bounceCount = 1.5
      },
      (raw: ReturnType<typeof rawTable>) => {
        ;(raw.barrages as Record<string, { patterns: { lineSpacingPx: number }[] }>)['7']!.patterns[2]!.lineSpacingPx = -1
      },
    ]) {
      const raw = rawTable()
      mutate(raw)
      expect(() => parseBossSkillsTable(raw)).toThrow()
    }
  })
  it('拒绝缺失、数量不对或未知形状的弹幕', () => {
    const missing = rawTable() as unknown as { barrages: Record<string, { patterns: unknown[] }> }
    missing.barrages['7']!.patterns.pop()
    expect(() => parseBossSkillsTable(missing)).toThrow()
    const unknown = rawTable() as unknown as { barrages: Record<string, { patterns: { pattern: string }[] }> }
    unknown.barrages['7']!.patterns[0]!.pattern = 'spiral'
    expect(() => parseBossSkillsTable(unknown)).toThrow()
  })
  it.each([
    (raw: Record<string, unknown>) => { raw.schemaVersion = 2 },
    (raw: Record<string, unknown>) => { delete (raw.bosses as Record<string, unknown>)['7'] },
    (raw: Record<string, unknown>) => { (raw.bosses as Record<string, { skills: unknown[] }>)['2']!.skills = [] },
    (raw: Record<string, unknown>) => { (raw.bosses as Record<string, { skillIntervalMs: number }>)['2']!.skillIntervalMs = Infinity },
  ])('错误版本、缺楼层、空技能或无效节拍都立即拒绝', (mutate) => {
    const raw = rawTable(); mutate(raw)
    expect(() => parseBossSkillsTable(raw)).toThrow()
  })
  it.each([
    { cooldownMs: 0 }, { initialDelayMs: -1 }, { speedMultiplier: 0 }, { durationMs: NaN },
    { damage: -1 }, { cooldownMs: true }, { id: 'unknown' },
  ])('拒绝错误技能字段 %j', (changes) => {
    const raw = rawTable() as unknown as { bosses: Record<string, { skills: Record<string, unknown>[] }> }
    Object.assign(raw.bosses['2']!.skills[0]!, changes)
    expect(() => parseBossSkillsTable(raw)).toThrow()
  })
  it('整数数量和上下限不能写反', () => {
    const raw = rawTable() as unknown as { bosses: Record<string, { skills: Record<string, unknown>[] }> }
    raw.bosses['2']!.skills[1]!.countMax = 7
    expect(() => parseBossSkillsTable(raw)).toThrow()
    raw.bosses['2']!.skills[1]!.countMax = 8.5
    expect(() => parseBossSkillsTable(raw)).toThrow()
  })
})

describe('独立技能冷却与总间隔', () => {
  it('100秒内按配置顺序公平循环所有已就绪技能，不随机连续抽中同一招', () => {
    const f = fixture(3)
    for (let now = 100; now <= 100000; now += 100) f.step(now, 100)
    const order = ['radial', 'triangle', 'haste']
    expect(f.casts.length).toBeGreaterThanOrEqual(15)
    expect(f.casts).toEqual(f.casts.map((_skill, index) => order[index % order.length]))
    const counts = order.map((skill) => f.casts.filter((id) => id === skill).length)
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
  })

  it('初始延迟、总间隔和单技能冷却共同限制，不因长帧补放多招', () => {
    const f = fixture(2)
    f.step(4999)
    expect(f.casts).toEqual([])
    f.step(5000)
    expect(f.casts).toEqual(['campus_slow'])
    expect(f.slows[0]).toEqual({ multiplier: 0.55, untilMs: 9500 })
    f.step(10000)
    expect(f.casts).toHaveLength(1)
    f.step(11500)
    expect(f.casts).toEqual(['campus_slow', 'paper_summon'])
    f.step(100000)
    const count = f.casts.length
    f.step(100000)
    expect(f.casts).toHaveLength(count)
    expect(count).toBe(3)
  })
  it('最终奶龙不自动放前六位或自己的技能，手动盗取仍执行定时任务', () => {
    const f = fixture()
    f.step(100000)
    expect(f.casts).toEqual([])
    const until = f.runtime.castSkill(100, 3, 'radial', 100000)
    expect(until).toBe(102000)
    f.step(100875)
    expect(f.volleys).toHaveLength(1)
    expect(f.volleys[0]).toMatchObject({ count: 24, damage: 21 })
    f.step(102000)
    expect(f.controls.get(100)).toBe(102000)
  })
})

describe('牛来与咕咕嘎嘎', () => {
  it('校园减速同时影响玩家、首领本人和场上全部怪物', () => {
    const f = fixture()
    const enemy = f.addMinion('muscovy')
    f.runtime.castSkill(100, 2, 'campus_slow', 100)
    expect(f.slows.at(-1)).toEqual({ multiplier: 0.55, untilMs: 4600 })
    expect(f.boosts.get(100)).toEqual({ multiplier: 0.55, untilMs: 4600 })
    expect(f.boosts.get(enemy)).toEqual({ multiplier: 0.55, untilMs: 4600 })
  })

  it('召唤8—12个纸团使用专用豁免入口，按100ms快速出现且不追赶漏掉的轮次', () => {
    const f = fixture()
    const until = f.runtime.castSkill(100, 2, 'paper_summon', 0)
    f.step(0)
    expect(f.units.size).toBe(2)
    f.step(10000)
    expect(f.units.size).toBe(3)
    for (let now = 10100; now <= 11200; now += 100) f.step(now)
    const papers = [...f.units.values()].filter((unit) => unit.kind === 'splitter')
    expect(papers.length).toBeGreaterThanOrEqual(8)
    expect(papers.length).toBeLessThanOrEqual(12)
    expect(until).toBe((papers.length - 1) * 100)
  })
  it('纸团多于16个跳过，正好16个时仍允许施放', () => {
    const f = fixture()
    for (let i = 0; i < 17; i++) f.addMinion('splitter')
    f.runtime.castSkill(100, 2, 'paper_summon', 0); f.step(0)
    expect(f.units.size).toBe(18)
    f.units.delete([...f.units.keys()].at(-1)!)
    f.runtime.castSkill(100, 2, 'paper_summon', 1); f.step(1)
    expect(f.units.size).toBe(18)
  })
  it('以玩家为中心生成大三角形，三次瞬移后回到原位', () => {
    const f = fixture()
    f.runtime.castSkill(100, 3, 'triangle', 0)
    f.step(650); f.step(1300); f.step(1950)
    // 3 teleports + 1 return to the pre-cast origin.
    expect(f.moves).toHaveLength(4)
    expect(f.moves.at(-1)).toMatchObject({ x: 0, y: 0 })
    const lines = f.runtime.hazards.snapshot.filter((field) => field.kind === 'line')
    expect(lines).toHaveLength(3)
    for (const line of lines)
      expect(line).toMatchObject({ damage: 27, activatesMs: 2600, expiresMs: 6100 })
    f.step(6100)
    expect(f.runtime.hazards.snapshot).toEqual([])
  })
  it('短时急速只改变倍率与期限，不修改首领原始位置或血量', () => {
    const f = fixture()
    expect(f.runtime.castSkill(100, 3, 'haste', 100)).toBe(2600)
    expect(f.boosts.get(100)).toEqual({ multiplier: 3.2, untilMs: 2600 })
    expect(f.boss.hp).toBe(900)
  })
})

describe('酸池、水面与体育器材', () => {
  it('酸池与水面各自限制16个，放置在房内，酸池伤害只缩放一次', () => {
    const f = fixture()
    for (let i = 0; i < 5; i++) {
      f.runtime.castSkill(100, 7, 'acid_pools', 0)
      f.runtime.castSkill(100, 7, 'water_pools', 0)
    }
    const acids = f.runtime.hazards.snapshot.filter((field) => field.kind === 'acid')
    const waters = f.runtime.hazards.snapshot.filter((field) => field.kind === 'water')
    expect(acids).toHaveLength(16)
    expect(waters).toHaveLength(16)
    expect(acids[0]).toMatchObject({ damage: 9, activatesMs: 900, expiresMs: 15900 })
    expect(waters[0]).toMatchObject({ speed: 400, expiresMs: 16700 })
    for (const field of [...acids, ...waters]) expect(Math.max(Math.abs(field.x), Math.abs(field.y)) + field.radius).toBeLessThanOrEqual(500)
    f.step(15900)
    f.runtime.castSkill(100, 7, 'acid_pools', 15900)
    expect(f.runtime.hazards.snapshot.filter((field) => field.kind === 'acid')).toHaveLength(4)
  })
  it('冲撞预警后移动并无敌，同一目标按500ms节拍受伤', () => {
    const f = fixture()
    f.port.rng = new FixedRng(0)
    f.port.player = () => ({ id: 1, x: 10, y: 0, radius: 10, alive: true, player: true })
    f.runtime.castSkill(100, 5, 'ricochet_charge', 0)
    f.step(999)
    expect(f.moves).toEqual([])
    f.step(1000)
    expect(f.moves).toHaveLength(1)
    expect(f.damage).toEqual([{ id: 1, amount: 24 }])
    f.step(1016)
    expect(f.damage).toHaveLength(1)
    expect(f.invulnerability.get(100)).toBe(7500)
    f.step(7500)
    expect(f.invulnerability.get(100)).toBe(7500)
    expect(f.controls.get(100)).toBe(7500)
  })
  it('与障碍碰撞三次即停止并提前撤销无敌和控制', () => {
    const f = fixture()
    f.port.rng = new FixedRng(0)
    f.port.bounds = () => ({ left: -40, top: -40, right: 40, bottom: 40 })
    f.runtime.castSkill(100, 5, 'ricochet_charge', 0)
    for (let now = 1000; now <= 2000; now += 16) f.step(now)
    const stoppedAt = f.controls.get(100)!
    expect(stoppedAt).toBeGreaterThan(1100)
    expect(stoppedAt).toBeLessThan(2000)
    expect(f.invulnerability.get(100)).toBe(stoppedAt)
    expect(f.moves.every((point) => Math.abs(point.x) <= 20)).toBe(true)
    const signs = f.moves.slice(1).map((point, index) => Math.sign(point.x - f.moves[index]!.x))
      .filter((sign, index, all) => sign !== 0 && (index === 0 || sign !== all[index - 1]))
    expect(signs).toEqual([1, -1, 1])
  })
  it('起点嵌入家具时先安全脱嵌，随机始终朝墙仍能反弹三次而非直接终止', () => {
    const f = fixture()
    f.port.rng = new FixedRng(0)
    f.port.safeSpawn = (_x, _y, _radius) => ({ x: 60, y: 0 })
    // 桌子在[-20,20]，加上首领半径20后，中心不能进入[-40,40]。
    f.port.projectileBlocked = (x1, y1, x2, y2, radius) => {
      const minX = -20 - radius, maxX = 20 + radius
      const minY = -20 - radius, maxY = 20 + radius
      let low = 0, high = 1
      for (const [from, to, min, max] of [[x1, x2, minX, maxX], [y1, y2, minY, maxY]]) {
        const delta = to! - from!
        if (delta === 0) { if (from! < min! || from! > max!) return false; continue }
        const a = (min! - from!) / delta, b = (max! - from!) / delta
        low = Math.max(low, Math.min(a, b)); high = Math.min(high, Math.max(a, b))
        if (low > high) return false
      }
      return true
    }
    f.runtime.castSkill(100, 5, 'ricochet_charge', 0)
    for (let now = 1000; now <= 7000; now += 1000 / 30) f.step(now, 1000 / 30)
    expect(f.moves[0]).toEqual({ id: 100, x: 60, y: 0 })
    expect(f.moves.every((point) => point.x > 40 && point.x <= 480)).toBe(true)
    expect(f.controls.get(100)).toBeGreaterThan(3000)
    expect(f.controls.get(100)).toBeLessThan(7500)
    for (let i = 1; i < f.moves.length; i++)
      expect(Math.abs(f.moves[i]!.x - f.moves[i - 1]!.x)).toBeLessThanOrEqual(520 / 30 + 1e-6)
    const signs = f.moves.slice(1).map((point, index) => Math.sign(point.x - f.moves[index]!.x))
      .filter((sign, index, all) => sign !== 0 && (index === 0 || sign !== all[index - 1]))
    expect(signs).toEqual([1, -1, 1])
  })
  it('大跳锁定玩家面前，预警后隐身飞跃，落地对双方造成AOE和短晕眩', () => {
    const f = fixture()
    f.addMinion('tank', 100, 280, 0)
    f.runtime.castSkill(100, 5, 'leap_slam', 0)
    expect(f.runtime.hazards.snapshot[0]).toMatchObject({ kind: 'slam', x: 280, y: 0, activatesMs: 2000 })
    f.step(1300)
    expect(f.appearance.get(100)).toEqual({ hidden: true })
    const commands = f.step(2000)
    expect(f.appearance.get(100)).toEqual({})
    expect(commands.filter((command) => command.type === 'damage').map((command) => command.id)).toEqual([1, 101])
    expect(commands.filter((command) => command.type === 'stun')).toEqual([
      { type: 'stun', id: 1, sourceId: 100, untilMs: 3500 },
      { type: 'stun', id: 101, sourceId: 100, untilMs: 3500 },
    ])
  })
})

describe('点名册与奶龙', () => {
  it('三个分身各为当前HP的1/3，打任何分身都不扣本体；真身打破后晕2秒', () => {
    const f = fixture()
    f.port.rng = new FixedRng(0)
    f.runtime.castSkill(100, 6, 'clones', 0)
    // During the cast GIF the boss is visible and not invulnerable.
    expect(f.units.size).toBe(1)
    expect(f.appearance.get(100)).toBeUndefined()
    expect(f.invulnerability.get(100)).toBeUndefined()
    f.step(1100)
    expect([...f.units.values()].filter((unit) => unit.bossStage === undefined).map((unit) => unit.hp)).toEqual([300, 300, 300])
    expect(new Set([...f.units.values()].filter((unit) => unit.bossStage === undefined).map((unit) => `${unit.x}:${unit.y}`)).size).toBe(3)
    expect(f.appearance.get(100)).toEqual({ hidden: true })
    f.units.delete(102)
    f.step(1200)
    expect(f.boss.hp).toBe(900)
    f.units.get(101)!.hp = 200
    f.step(1300)
    expect(f.boss.hp).toBe(900)
    f.units.delete(101)
    f.step(1400)
    expect(f.boss.hp).toBe(900)
    expect(f.units.size).toBe(1)
    expect(f.appearance.get(100)).toEqual({})
    expect(f.invulnerability.get(100)).toBe(1400)
    expect(f.stuns.get(100)).toBe(3400)
    expect(f.runtime.busyUntil).toBe(3400)
  })
  it('分身不会超时自动结束；清理时才恢复本体并撤销无敌', () => {
    const f = fixture()
    f.runtime.castSkill(100, 6, 'clones', 0)
    f.step(14000)
    expect(f.units.size).toBe(4)
    expect(f.appearance.get(100)).toEqual({ hidden: true })
    f.runtime.clear(14000)
    expect(f.units.size).toBe(1)
    expect(f.appearance.get(100)).toEqual({})
    expect(f.controls.get(100)).toBe(14000)
    expect(f.stuns.size).toBe(0)
    expect(f.damage).toEqual([])
  })
  it('全场小怪变成同一种随机怪，预警时不提前变化', () => {
    const f = fixture()
    f.addMinion('muscovy'); f.addMinion('grabber')
    f.runtime.castSkill(100, 6, 'transmute', 0)
    f.step(999)
    expect(f.transforms).toEqual([])
    f.step(1000)
    expect(f.transforms).toHaveLength(1)
    expect(new Set([...f.units.values()].filter((unit) => unit.bossStage === undefined).map((unit) => unit.kind)).size).toBe(1)
    expect(f.boss.bossStage).toBe(9)
  })
  it('笑声激励所有远近小怪加速追玩家，也覆盖期间新增的小怪', () => {
    const f = fixture()
    const id = f.addMinion('tank', 100, 4000, 4000)
    f.runtime.castSkill(100, 4, 'rally', 0)
    f.step(0)
    expect(f.boosts.get(id)).toEqual({ multiplier: 1.9, untilMs: 5500 })
    expect(f.rallies.get(id)).toBe(5500)
    const later = f.addMinion()
    f.step(550)
    expect(f.rallies.get(later)).toBe(5500)
    expect(f.laughs).toHaveLength(2)
    expect(f.laughs).toEqual([{ id: 100, untilMs: 5500 }, { id: 100, untilMs: 5500 }])
  })
  it('连续5—7轮蓝色环弹，逐轮旋转且不因长帧齐发', () => {
    const f = fixture()
    f.runtime.castSkill(100, 4, 'blue_barrage', 0)
    f.step(0)
    expect(f.volleys).toHaveLength(1)
    f.step(10000)
    expect(f.volleys).toHaveLength(2)
    for (let now = 10450; now <= 12700; now += 450) f.step(now)
    expect(f.volleys.length).toBeGreaterThanOrEqual(5)
    expect(f.volleys.length).toBeLessThanOrEqual(7)
    expect(f.volleys[0]).toMatchObject({ count: 18, damage: 18, color: 4238335 })
    expect(f.volleys[0]!.angleRad).not.toBe(f.volleys[1]!.angleRad)
  })
})

describe('运行时清理', () => {
  it('取消盗技能恢复当前时刻控制/无敌/外观，并撤销慢速和未执行任务', () => {
    const f = fixture()
    f.runtime.castSkill(100, 6, 'clones', 0)
    f.runtime.castSkill(100, 2, 'campus_slow', 0)
    f.runtime.castSkill(100, 4, 'blue_barrage', 0)
    f.runtime.clear(100)
    // The cast GIF had not finished, so the boss was never hidden.
    expect(f.appearance.get(100)).toBeUndefined()
    expect(f.controls.get(100)).toBe(100)
    expect(f.invulnerability.get(100)).toBeUndefined()
    expect(f.slows.at(-1)).toEqual({ multiplier: 1, untilMs: 100 })
    expect(f.units.size).toBe(1)
    f.step(10000)
    expect(f.volleys).toEqual([])
    expect(f.runtime.hazards.snapshot).toEqual([])
  })
  it('首领死亡后不再执行召唤或弹幕，清空地面效果', () => {
    const f = fixture()
    f.runtime.castSkill(100, 2, 'paper_summon', 0)
    f.runtime.castSkill(100, 7, 'acid_pools', 0)
    f.units.delete(100)
    f.step(1000)
    expect(f.units.size).toBe(0)
    expect(f.runtime.hazards.snapshot).toEqual([])
  })
})
