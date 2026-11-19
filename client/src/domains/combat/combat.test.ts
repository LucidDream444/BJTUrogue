import { readFileSync } from 'node:fs'
import { describe, it, expect, vi } from 'vitest'
import { parseConfigBundle, deriveTank } from '@/core/config'
import { GameClock } from '@/core/time'
import { Rng } from '@/core/rng'
import { DamageLedger } from '@/core/actor/damage'
import { ContactResolver } from '../enemies/contact/ContactResolver'
import { EnemyModel, specFromTank } from '../enemies/model/EnemyModel'
import { AttackPool } from './AttackPool'
import { PlayerModel, moveVelocity, FireGate } from './PlayerModel'
import { RewardRun } from './RewardRun'
import { DamageBatches } from './DamageBatches'
import { parseCombatConfig, parseRewards, deriveStats } from './config'
import { roomPlan, roomPointBudget } from './balance'
const read = (name: string) =>
  JSON.parse(readFileSync(new URL('../../../public/config/' + name, import.meta.url), 'utf8'))
const bundle = parseConfigBundle({
  balance: read('balance.json'),
  difficulty: read('difficulty.json'),
  enemies: read('enemies.json'),
})
const cfg = parseCombatConfig(read('combat.json')),
  defs = parseRewards(read('rewards.json'))
describe('D1 movement and clock', () => {
  it('normalizes diagonal and decelerates without overshoot', () => {
    const a = moveVelocity(0, 0, 1, 0, 200, 1500, 2000, 1),
      b = moveVelocity(0, 0, 1, 1, 200, 1500, 2000, 1)
    expect(Math.hypot(b.x, b.y)).toBeCloseTo(a.x)
    expect(moveVelocity(b.x, b.y, 0, 0, 200, 1500, 2000, 1)).toEqual({ x: 0, y: 0 })
  })
  it('paused clock cannot accumulate shots', () => {
    const c = new GameClock(),
      g = new FireGate()
    g.fired(c.nowMs, 250)
    c.pause()
    c.advance(30000)
    expect(g.ready(c.nowMs)).toBe(false)
    c.resume()
    c.advance(249)
    expect(g.ready(c.nowMs)).toBe(false)
    c.advance(1)
    expect(g.ready(c.nowMs)).toBe(true)
    g.fired(c.nowMs, 250)
    expect(g.ready(c.nowMs)).toBe(false)
  })
  it('player uses single HP model, protection and death', () => {
    const c = new GameClock(),
      p = new PlayerModel(
        bundle.balance.baseline.player,
        c,
        cfg.player.hurtMs,
        cfg.player.maxShield,
      )
    p.iframeMs = 500
    const hit = () =>
      p.takeHit({
        sourceId: 1,
        hitKey: 'test',
        mode: 'instant',
        sourceKind: 'bullet',
        amount: 20,
        frameId: c.frameId,
        nowMs: c.nowMs,
      })
    expect(p.maxHp).toBe(50)
    expect(p.maxShield).toBe(20)
    expect(hit().applied).toBe(0)
    expect(p.shield).toBe(0)
    expect(p.hp).toBe(50)
    const until = p.hurtUntilMs
    c.advance(100)
    expect(hit().applied).toBe(0)
    expect(p.hurtUntilMs).toBe(until)
    c.advance(400)
    expect(hit().applied).toBe(20)
    expect(p.shield).toBe(0)
    expect(p.hp).toBe(30)
    c.pause()
    c.advance(1000)
    expect(hit().applied).toBe(0)
    c.resume()
    c.advance(500)
    p.restoreFromPickup('shield', 5)
    const overflow = p.takeHit({
      sourceId: 3,
      hitKey: 'overflow',
      mode: 'instant',
      sourceKind: 'aoe',
      amount: 10,
      frameId: c.frameId,
      nowMs: c.nowMs,
    })
    expect(overflow.applied).toBe(5)
    expect(p.shield).toBe(0)
    expect(p.hp).toBe(25)
    c.advance(p.iframeMs)
    p.takeHit({
      sourceId: 2,
      hitKey: 'kill',
      mode: 'instant',
      sourceKind: 'aoe',
      amount: 9999,
      frameId: c.frameId,
      nowMs: c.nowMs,
    })
    p.syncState(true)
    expect(p.state).toBe('dead')
    expect(hit().applied).toBe(0)
  })
})
describe('D1 pool with existing damage bridge', () => {
  it('deduplicates across frames; recycle clears both ledgers and renews IDs', () => {
    const c = new GameClock(),
      ledger = new DamageLedger(),
      resolver = new ContactResolver(ledger, c),
      pool = new AttackPool(1, (id) => resolver.release(id))
    const def = bundle.enemies.enemies.tank,
      m = new EnemyModel('tank')
    m.respawn(
      specFromTank(deriveTank(def, bundle.difficulty.difficulties.normal, bundle.balance), def),
      0,
    )
    const slot = pool.acquire(1, 0, 900)[0]!,
      id = slot.id
    expect(resolver.contact(id, m, 'bullet', 10, 3, 3)).toMatchObject({
      applied: 10,
      consumed: false,
    })
    expect(resolver.contact(id, m, 'bullet', 10, 3, 3).applied).toBe(0)
    c.advance(16)
    expect(resolver.contact(id, m, 'bullet', 10, 3, 3).applied).toBe(0)
    expect(ledger.entryCount).toBe(1)
    pool.release(slot)
    expect(ledger.entryCount).toBe(0)
    expect(resolver.trackedSources).toBe(0)
    const next = pool.acquire(1, 16, 900)[0]!
    expect(next).toBe(slot)
    expect(next.id).toBeGreaterThan(id)
    expect(resolver.contact(next.id, m, 'bullet', 10, 3, 3).applied).toBe(10)
    pool.clear()
    expect(ledger.entryCount).toBe(0)
  })
  it('each pellet has an ID; one volley is atomic at capacity', () => {
    const release = vi.fn(),
      pool = new AttackPool(5, release),
      slots = pool.acquire(5, 0, 500)
    expect(new Set(slots.map((s) => s.id)).size).toBe(5)
    expect(new Set(slots.map((s) => s.volleyId)).size).toBe(1)
    expect(pool.acquire(1, 0, 500)).toEqual([])
    pool.clear()
    pool.clear()
    expect(release).toHaveBeenCalledTimes(5)
  })
})
describe('pulse loadout balance', () => {
  it('includes all six weapons with a playable cannon stamina cost', () => {
    expect(cfg.weapons.map((w) => w.id)).toEqual(
      expect.arrayContaining(['pencil', 'pulse', 'venom', 'flare', 'rail', 'smg']),
    )
    expect(cfg.weapons.find((w) => w.id === 'pulse')!.staminaCost).toBe(14)
  })
  it('cannon damage is target-independent and remains single-shot after pistol multishot', () => {
    const gun = cfg.weapons.find((w) => w.id === 'pulse')!
    const before = deriveStats(bundle.balance, cfg, gun, defs, new Map())
    expect(before.damage).toBe(24)
    // Boss health is not a weapon-damage input. The old ratio formula made F8 weaker
    // against bosses than F2 and also applied the inflated number to ordinary enemies.
    expect(deriveStats(
      bundle.balance,
      { ...cfg, encounter: { ...cfg.encounter, bossHp: 9999 } },
      gun,
      defs,
      new Map(),
    ).damage).toBe(24)
    expect(before.pellets).toBe(1)
    const after = deriveStats(
      bundle.balance,
      cfg,
      gun,
      defs,
      new Map([
        ['double_shot', 3],
        ['sharp', 1],
      ]),
    )
    expect(after.pellets).toBe(1)
    expect(after.damage).toBeCloseTo(before.damage * 1.3)
  })
  it('rejects missing cannon mechanics and invalid boss health', () => {
    const bad = structuredClone(cfg)
    delete bad.weapons[1]!.chainTargets
    expect(() => parseCombatConfig(bad)).toThrow()
    expect(() =>
      parseCombatConfig({ ...cfg, encounter: { ...cfg.encounter, bossHp: 0 } }),
    ).toThrow()
  })
  it.each([0, -1, NaN, Infinity, undefined])('rejects invalid boss damage multiplier %s', (value) => {
    expect(() => parseCombatConfig({
      ...cfg, encounter: { ...cfg.encounter, bossDamageMultiplier: value },
    })).toThrow('Boss伤害倍率')
  })
  it.each([
    { cooldownMs: 0 }, { cooldownMs: Infinity },
    { maxAlive: 0 }, { maxAlive: 1.5 }, { spawnCount: -1 }, { spawnCount: 0.5 },
  ])('rejects invalid boss reinforcement setting %j', (patch) => {
    expect(() => parseCombatConfig({
      ...cfg,
      encounter: {
        ...cfg.encounter,
        bossReinforcements: { ...cfg.encounter.bossReinforcements, ...patch },
      },
    })).toThrow('Boss补怪')
  })
})

describe('permanent meta growth bridge', () => {
  it('changes starting HP, energy and fire interval before the first shot', () => {
    const gun = cfg.weapons[0]!
    const base = deriveStats(bundle.balance, cfg, gun, defs, new Map())
    const grown = deriveStats(bundle.balance, cfg, gun, defs, new Map(), {
      maxHp: 260,
      maxStamina: 700,
      maxShield: 30,
      attackSpeedPct: 50,
      moveSpeedPct: 0,
      energyRegenPct: 0,
    })
    expect(grown.maxHp).toBe(260)
    expect(grown.maxStamina).toBe(700)
    expect(grown.cooldownMs).toBeCloseTo(base.cooldownMs / 1.5)
  })

  it('adds permanent attack speed to in-run tempo before the shared cap', () => {
    const gun = cfg.weapons[0]!
    const grown = deriveStats(bundle.balance, cfg, gun, defs, new Map([['tempo', 1]]), {
      maxHp: 200,
      maxStamina: 500,
      maxShield: 5,
      attackSpeedPct: 50,
      moveSpeedPct: 0,
      energyRegenPct: 0,
    })
    const baseInterval = bundle.balance.baseline.bullet.fireIntervalMs * gun.cooldownScale
    expect(grown.cooldownMs).toBeCloseTo(baseInterval / 1.7)
  })

  it('new-student temporary haste enters the same cooldown formula', () => {
    const gun = cfg.weapons[0]!
    const base = deriveStats(bundle.balance, cfg, gun, defs, new Map())
    const hasted = deriveStats(bundle.balance, cfg, gun, defs, new Map(), undefined, 80)
    expect(hasted.cooldownMs).toBeCloseTo(base.cooldownMs / 1.8)
  })

  it('applies the athlete movement identity through the same permanent bridge', () => {
    const gun = cfg.weapons[0]!
    const base = deriveStats(bundle.balance, cfg, gun, defs, new Map())
    const goose = deriveStats(bundle.balance, cfg, gun, defs, new Map(), {
      maxHp: 50,
      maxStamina: 500,
      maxShield: 5,
      attackSpeedPct: 0,
      moveSpeedPct: 20,
      energyRegenPct: 0,
    })
    expect(goose.moveSpeed).toBeCloseTo(base.moveSpeed * 1.2)
  })
})
describe('D1 rewards', () => {
  it('same seed has same unique choices', () => {
    const a = new RewardRun(defs, new Rng(42)),
      b = new RewardRun(defs, new Rng(42))
    expect(a.offer('r1', 'pencil', 200, 200)).toEqual(b.offer('r1', 'pencil', 200, 200))
    expect(new Set(a.offered.map((r) => r.id)).size).toBe(3)
  })
  it('keeps useful choices available while stacks remain below their caps', () => {
    const r = new RewardRun(defs, new Rng(1))
    for (const def of defs) r.stacks.set(def.id, Math.max(0, def.maxStacks - 1))
    const options = r.legal('pencil', 50, 50)
    expect(options).toHaveLength(defs.length)
    const before = deriveStats(bundle.balance, cfg, cfg.weapons[0]!, defs, r.stacks)
    for (const option of options) {
      const next = new Map(r.stacks)
      next.set(option.id, next.get(option.id)! + 1)
      expect(deriveStats(bundle.balance, cfg, cfg.weapons[0]!, defs, next)).not.toEqual(before)
    }
    expect(defs.some((r) => r.effects.some((e) => e.stat === 'heal'))).toBe(false)
    expect(r.offer('round1001', 'pencil', 50, 50)).toHaveLength(3)
  })
  it('filters upgrades that no longer improve the effective stats', () => {
    const r = new RewardRun(defs, new Rng(1))
    const options = r.offer('filtered', 'pencil', 50, 50, (reward) => reward.id !== 'tempo')!
    expect(options.map((x) => x.id)).not.toContain('tempo')
    expect(options).toHaveLength(3)
  })
  it('one choice only and same room cannot reoffer', () => {
    const r = new RewardRun(defs, new Rng(1))
    const id = r.offer('r', 'pencil', 200, 200)![0]!.id
    expect(r.choose('invalid')).toBeNull()
    expect(r.choose(id)).not.toBeNull()
    expect(r.choose(id)).toBeNull()
    expect(r.stacks.get(id)).toBe(1)
    expect(r.offer('r', 'pencil', 200, 200)).toBeNull()
  })
  it('fewer than three and zero candidates terminate', () => {
    const one = { ...defs[0]!, maxStacks: 1 },
      r = new RewardRun([one], new Rng(1))
    expect(r.offer('one', 'pencil', 200, 200)).toHaveLength(1)
    r.choose(one.id)
    expect(r.offer('empty', 'pencil', 200, 200)).toEqual([])
    expect(r.roomId).toBeNull()
    expect(r.completedRooms.has('empty')).toBe(true)
  })
  it('mutual exclusion works in both directions', () => {
    const a = { ...defs[0]!, excludes: [defs[1]!.id] },
      b = defs[1]!,
      r = new RewardRun([a, b], new Rng(1))
    r.stacks.set(a.id, 1)
    expect(r.legal('pencil', 200, 200).map((x) => x.id)).not.toContain(b.id)
    r.stacks.clear()
    r.stacks.set(b.id, 1)
    expect(r.legal('pencil', 200, 200).map((x) => x.id)).not.toContain(a.id)
  })
  it('separates attack frequency, projectiles per attack and stamina capacity', () => {
    const before = deriveStats(bundle.balance, cfg, cfg.weapons[0]!, defs, new Map())
    const after = deriveStats(
      bundle.balance,
      cfg,
      cfg.weapons[0]!,
      defs,
      new Map([
        ['tempo', 1],
        ['double_shot', 1],
        ['reserves', 1],
      ]),
    )
    expect(1000 / after.cooldownMs).toBeCloseTo((1000 / before.cooldownMs) * 1.2)
    expect(after.pellets).toBe(before.pellets + 1)
    expect(after.maxStamina).toBe(650)
  })
  it('offers different useful rewards until the finite upgrade pool is capped', () => {
    const r = new RewardRun(defs, new Rng(20261013))
    let sawExhaustion = false
    for (let round = 1; round <= 200; round++) {
      const before = deriveStats(bundle.balance, cfg, cfg.weapons[0]!, defs, r.stacks)
      const options = r.offer('round' + round, 'pencil', 50, before.maxHp, (reward) => {
        const next = new Map(r.stacks)
        next.set(reward.id, (next.get(reward.id) ?? 0) + 1)
        return (
          JSON.stringify(deriveStats(bundle.balance, cfg, cfg.weapons[0]!, defs, next)) !==
          JSON.stringify(before)
        )
      })!
      expect(options.length).toBeGreaterThan(0)
      expect(options.length).toBeLessThanOrEqual(3)
      expect(new Set(options.map((x) => x.id)).size).toBe(options.length)
      if (options.length < 3) {
        sawExhaustion = true
        break
      }
      r.choose(options[round % 3]!.id)
    }
    expect(sawExhaustion).toBe(true)
  })
  it('derived stats do not drift and new run resets', () => {
    const stacks = new Map([
        ['sharp', 4],
        ['lunch', 3],
      ]),
      a = deriveStats(bundle.balance, cfg, cfg.weapons[0]!, defs, stacks)
    expect(a.damage).toBeCloseTo(22)
    expect(a.maxHp).toBe(95)
    for (let i = 0; i < 100; i++)
      expect(deriveStats(bundle.balance, cfg, cfg.weapons[0]!, defs, stacks)).toEqual(a)
    const r = new RewardRun(defs, new Rng(1))
    expect(deriveStats(bundle.balance, cfg, cfg.weapons[0]!, defs, r.stacks).damage).toBe(10)
  })
})
it('aggregates valid damage within bounded capacity', () => {
  const b = new DamageBatches(100, 1)
  b.add(1, 0, 0, 0, 0, false)
  expect(b.pending.size).toBe(0)
  b.add(1, 10, 0, 0, 0, false)
  b.add(1, 5, 1, 2, 50, false)
  b.add(2, 10, 0, 0, 50, false)
  expect(b.pending.size).toBe(1)
  expect(b.flush(99)).toEqual([])
  expect(b.flush(100)[0]!.amount).toBe(15)
  expect(b.pending.size).toBe(0)
})
it('difficulty scales the room point budget once and keeps each monster cost fixed', () => {
  const easyBudget = roomPointBudget(cfg, 'easy', 10, 1, 0.75)
  const normalBudget = roomPointBudget(cfg, 'normal', 10, 1, 1)
  const hardBudget = roomPointBudget(cfg, 'hard', 10, 1, 1.25)
  expect(easyBudget).toBeLessThan(normalBudget)
  expect(hardBudget).toBeGreaterThan(normalBudget)

  const costs = new Map(
    Object.entries(bundle.enemies.enemies).map(([kind, def]) => [kind, def.monsterPoints]),
  )
  for (const budget of [easyBudget, normalBudget, hardBudget]) {
    const plan = roomPlan(bundle, cfg, 'normal', budget, 1, 17)
    const spent = plan.units.reduce((sum, unit) => sum + costs.get(unit.kind)!, 0)
    expect(plan.pointSpent).toBe(spent)
    expect(plan.pointSpent).toBeLessThanOrEqual(budget)
  }
})
it('invalid config and duplicate reward IDs fail early', () => {
  expect(() => parseCombatConfig({ ...cfg, projectiles: { capacity: 1, radius: 4 } })).toThrow()
  expect(() => parseRewards({ schemaVersion: 1, rewards: [defs[0], defs[0]] })).toThrow()
})

it('一局八层，且非法点数预算或楼层当场抛', () => {
  expect(cfg.arena.maxStages).toBe(8)
  expect(() => roomPlan(bundle, cfg, 'normal', Number.NaN, 1)).toThrow()
  expect(() => roomPlan(bundle, cfg, 'normal', -1, 1)).toThrow()
  expect(() => roomPlan(bundle, cfg, 'normal', 10, 0)).toThrow()
  expect(() => roomPlan(bundle, cfg, 'normal', 10, 9)).toThrow()
  expect(() => roomPointBudget(cfg, 'normal', 10, 1, Number.NaN)).toThrow()
})
