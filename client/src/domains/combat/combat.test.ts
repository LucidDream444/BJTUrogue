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
import { stagePlan } from './balance'
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
    expect(p.maxShield).toBe(5)
    expect(hit().applied).toBe(15)
    expect(p.shield).toBe(0)
    expect(p.hp).toBe(35)
    const until = p.hurtUntilMs
    c.advance(100)
    expect(hit().applied).toBe(0)
    expect(p.hurtUntilMs).toBe(until)
    c.advance(400)
    expect(hit().applied).toBe(20)
    expect(p.shield).toBe(0)
    expect(p.hp).toBe(15)
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
    expect(p.hp).toBe(10)
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
  it('includes all six weapons with reduced cannon stamina cost', () => {
    expect(cfg.weapons.map((w) => w.id)).toEqual(
      expect.arrayContaining(['pencil', 'pulse', 'venom', 'flare', 'rail', 'smg']),
    )
    expect(cfg.weapons.find((w) => w.id === 'pulse')!.staminaCost).toBe(18)
  })
  it('boosted cannon impact uses the configured boss ratio and remains single-shot after pistol multishot', () => {
    const gun = cfg.weapons.find((w) => w.id === 'pulse')!
    const before = deriveStats(bundle.balance, cfg, gun, defs, new Map())
    expect(before.damage).toBe(cfg.encounter.bossHp * gun.bossDamageRatio!)
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
    expect(after.damage).toBeCloseTo(before.damage * 1.2)
  })
  it('rejects missing cannon ratios and invalid boss health', () => {
    const bad = structuredClone(cfg)
    delete bad.weapons[1]!.bossDamageRatio
    expect(() => parseCombatConfig(bad)).toThrow()
    expect(() =>
      parseCombatConfig({ ...cfg, encounter: { ...cfg.encounter, bossHp: 0 } }),
    ).toThrow()
  })
})
describe('D1 rewards', () => {
  it('same seed has same unique choices', () => {
    const a = new RewardRun(defs, new Rng(42)),
      b = new RewardRun(defs, new Rng(42))
    expect(a.offer('r1', 'pencil', 200, 200)).toEqual(b.offer('r1', 'pencil', 200, 200))
    expect(new Set(a.offered.map((r) => r.id)).size).toBe(3)
  })
  it('limits capped upgrades but keeps three useful repeatable upgrades for every round', () => {
    const r = new RewardRun(defs, new Rng(1))
    for (const def of defs) r.stacks.set(def.id, def.maxStacks || 1000)
    const options = r.legal('pencil', 50, 50)
    expect(options.map((x) => x.id).sort()).toEqual(['lunch', 'reserves', 'sharp'])
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
    expect(1000 / after.cooldownMs).toBeCloseTo((1000 / before.cooldownMs) * 1.15)
    expect(after.pellets).toBe(before.pellets + 1)
    expect(after.maxStamina).toBe(600)
  })
  it('offers exactly three different useful rewards over repeated rounds', () => {
    const r = new RewardRun(defs, new Rng(20261013))
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
      expect(options).toHaveLength(3)
      expect(new Set(options.map((x) => x.id)).size).toBe(3)
      r.choose(options[round % 3]!.id)
    }
  })
  it('derived stats do not drift and new run resets', () => {
    const stacks = new Map([
        ['sharp', 4],
        ['lunch', 3],
      ]),
      a = deriveStats(bundle.balance, cfg, cfg.weapons[0]!, defs, stacks)
    expect(a.damage).toBeCloseTo(18)
    expect(a.maxHp).toBe(80)
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
it('difficulty count applied once and pacing differs', () => {
  const easy = stagePlan(bundle, cfg, 'easy', 1),
    hard = stagePlan(bundle, cfg, 'hard', 1)
  expect(easy.splitters).toBe(2)
  expect(hard.splitters).toBe(4)
  expect(hard.phaseDelayMs).toBeLessThan(easy.phaseDelayMs)
})
it('invalid config and duplicate reward IDs fail early', () => {
  expect(() => parseCombatConfig({ ...cfg, projectiles: { capacity: 1, radius: 4 } })).toThrow()
  expect(() => parseRewards({ schemaVersion: 1, rewards: [defs[0], defs[0]] })).toThrow()
})

it('抓取怪的刷怪轴：第一层 0 只，之后按曲线出现', () => {
  // 第 1 层不刷抓取怪是**刻意的**：先让玩家在别处认识「!」与抓取，
  // 再让它真的来抓人。这条也顺手把「有人给它套上 max(1, ...)」挡住。
  expect(stagePlan(bundle, cfg, 'normal', 1).grabbers).toBe(0)
  expect(stagePlan(bundle, cfg, 'normal', 3).grabbers).toBeGreaterThanOrEqual(1)
  // 另外两个轴照旧：任何一层都至少有一只
  for (const stage of [1, 2, 3]) {
    const p = stagePlan(bundle, cfg, 'normal', stage)
    expect(p.splitters).toBeGreaterThan(0)
    expect(p.tanks).toBeGreaterThan(0)
    expect(p.grabbers).toBeGreaterThanOrEqual(0)
  }
})

it('limits the run to exactly three floors and rejects a fourth spawn plan', () => {
  expect(cfg.arena.maxStages).toBe(3)
  for (const stage of [1, 2, 3])
    expect(stagePlan(bundle, cfg, 'normal', stage).splitters).toBeGreaterThan(0)
  expect(() => stagePlan(bundle, cfg, 'normal', 4)).toThrow()
  expect(() => stagePlan(bundle, cfg, 'normal', 0)).toThrow()
})
