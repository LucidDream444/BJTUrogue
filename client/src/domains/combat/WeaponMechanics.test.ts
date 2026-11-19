import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCombatConfig } from './config'
import {
  angleDelta,
  arcTargets,
  chainTargets,
  homingTurn,
  lifestealHeal,
  segmentHit,
  splashTargets,
  splitAngles,
  WeaponStatuses,
  type EffectTargetPort,
  type WeaponTarget,
} from './WeaponMechanics'
const raw = JSON.parse(
  readFileSync(new URL('../../../public/config/combat.json', import.meta.url), 'utf8'),
)
const cfg = parseCombatConfig(raw)
const venom = cfg.weapons.find((w) => w.id === 'venom')!,
  smg = cfg.weapons.find((w) => w.id === 'smg')!
const target = (id: number, x = 0, y = 0): WeaponTarget => ({ id, x, y, radius: 10 })
function fixture(capacity = 10) {
  const alive = new Map([
    [1, target(1)],
    [2, target(2)],
  ])
  const hits: { id: number; damage: number; tick: number | null }[] = [],
    slows: { id: number; multiplier: number; untilMs: number }[] = []
  const port: EffectTargetPort = {
    target: (id) => alive.get(id) ?? null,
    hit: (id, _sourceId, damage, tick) => {
      hits.push({ id, damage, tick })
      return { applied: damage, killed: false, consumed: false }
    },
    slow: (id, multiplier, untilMs) => {
      slows.push({ id, multiplier, untilMs })
    },
  }
  return { alive, hits, slows, statuses: new WeaponStatuses(port, capacity) }
}

describe('advanced weapon mechanics', () => {
  it.each([30, 60, 144])('poison uses the configured duration and tick count at %i Hz', (fps) => {
    const f = fixture()
    const ticks = venom.poisonDurationMs! / venom.poisonTickMs!
    f.statuses.poison(1, 100, venom, 0)
    for (let frame = 0; frame <= (fps * venom.poisonDurationMs!) / 1000 + 1; frame++)
      f.statuses.step((frame * 1000) / fps, frame, () => {})
    expect(f.hits).toHaveLength(ticks)
    expect(f.hits.reduce((sum, h) => sum + h.damage, 0)).toBe(venom.poisonTickDamage! * ticks)
    expect(f.statuses.poisons.size).toBe(0)
    f.statuses.step(15000, 10000, () => {})
    expect(f.hits).toHaveLength(ticks)
  })
  it('refreshes one poison without adding stacks or starving its next tick', () => {
    const f = fixture()
    f.statuses.poison(1, 100, venom, 0)
    f.statuses.poison(1, 101, venom, 450)
    f.statuses.step(500, 1, () => {})
    expect(f.hits).toHaveLength(1)
    expect(f.statuses.poisons.get(1)?.untilMs).toBe(450 + venom.poisonDurationMs!)
    f.statuses.step(500, 1, () => {})
    expect(f.hits).toHaveLength(1)
    f.statuses.step(5500, 2, () => {})
    expect(f.hits).toHaveLength(2)
    expect(f.statuses.poisons.size).toBe(0)
  })
  it('logical pause freezes poison and all targets tick independently', () => {
    const f = fixture()
    f.statuses.poison(1, 100, venom, 0)
    f.statuses.poison(2, 101, venom, 0)
    for (let i = 0; i < 100; i++) f.statuses.step(499, i, () => {})
    expect(f.hits).toHaveLength(0)
    f.statuses.step(500, 101, () => {})
    expect(f.hits.map((h) => h.id)).toEqual([1, 2])
  })
  it('dead or recycled targets never hand their poison to a new occupant', () => {
    const f = fixture()
    f.statuses.poison(1, 100, venom, 0)
    f.alive.delete(1)
    f.alive.set(3, target(3))
    f.statuses.step(500, 1, () => {})
    expect(f.hits).toEqual([])
    expect(f.statuses.poisons.size).toBe(0)
  })
  it('caps status targets and clears poison/slow on room reset', () => {
    const f = fixture(1)
    f.statuses.poison(1, 100, venom, 0)
    f.statuses.poison(2, 101, venom, 0)
    expect(f.statuses.poisons.size).toBe(1)
    f.statuses.chill(1, smg, 100)
    expect(f.slows[0]).toEqual({ id: 1, multiplier: 0.75, untilMs: 1300 })
    f.statuses.clear()
    expect(f.statuses.poisons.size).toBe(0)
    expect(f.statuses.chills.size).toBe(0)
    expect(f.slows.at(-1)).toEqual({ id: 1, multiplier: 1, untilMs: 0 })
  })
  it('slow refreshes its expiry instead of stacking exponentially', () => {
    const f = fixture()
    f.statuses.chill(1, smg, 0)
    f.statuses.chill(1, smg, 500)
    expect(f.slows.map((s) => s.multiplier)).toEqual([0.75, 0.75])
    f.statuses.step(1699, 1, () => {})
    expect(f.statuses.chills.has(1)).toBe(true)
    f.statuses.step(1700, 2, () => {})
    expect(f.statuses.chills.has(1)).toBe(false)
  })
  it('melee arc respects distance, angle, wall blocking and angle wrapping', () => {
    const ts = [target(1, 50, 0), target(2, 0, 50), target(3, 50, 40), target(4, -50, 0), target(5, 95, 0)]
    const origin = { x: 0, y: 0 }
    expect(arcTargets(ts, origin, 0, 100, Math.PI / 2, 0, () => false).map((t) => t.id)).toEqual([
      1, 3, 5,
    ])
    expect(
      arcTargets(ts, origin, Math.PI, 100, Math.PI / 2, 0, (_a, b) => b.id === 4).map((t) => t.id),
    ).toEqual([])
    expect(arcTargets(ts, origin, Math.PI, 100, Math.PI / 2, 0, () => false).map((t) => t.id)).toEqual([
      4,
    ])
    expect(angleDelta(Math.PI * 1.9, -Math.PI * 0.1)).toBeCloseTo(0)
  })
  it('homing, split and lifesteal helpers stay bounded', () => {
    expect(homingTurn(0, Math.PI / 2, 0.1)).toBeCloseTo(0.1)
    expect(homingTurn(0, -0.05, 0.1)).toBeCloseTo(-0.05)
    expect(homingTurn(0, Math.PI * 2 - 0.05, 0.1)).toBeCloseTo(-0.05)
    expect(splitAngles(0, 4, 1, true)).toEqual([
      0,
      Math.PI / 2,
      Math.PI,
      (3 * Math.PI) / 2,
    ])
    expect(splitAngles(0, 3, Math.PI / 2, false)).toEqual([
      -Math.PI / 4,
      0,
      Math.PI / 4,
    ])
    expect(splitAngles(1, 1, Math.PI, false)).toEqual([1])
    expect(splitAngles(0, 0, 1, false)).toEqual([])
    expect(lifestealHeal(20, 0.2)).toBe(4)
    expect(lifestealHeal(20, 0.2, 3)).toBe(3)
    expect(lifestealHeal(0, 0.2)).toBe(0)
  })
  it('sweeps fast shots and sorts successive hits along the ray', () => {
    const from = { x: 0, y: 0 },
      to = { x: 1000, y: 0 }
    expect(segmentHit(from, to, target(1, 400), 4)).toBeCloseTo(0.386)
    expect(segmentHit(from, to, target(2, 900), 4)).toBeCloseTo(0.886)
    expect(segmentHit(from, to, target(3, 400, 50), 4)).toBeNull()
    expect(segmentHit(from, from, target(4, 0), 4)).toBe(0)
  })
  it('splash excludes direct target, far targets and enemies behind walls', () => {
    const ts = [target(1, 0), target(2, 60), target(3, 300), target(4, 70)]
    expect(splashTargets(ts, 1, 0, 0, 92, (_a, b) => b.id === 4).map((t) => t.id)).toEqual([2])
  })
  it('chain chooses nearby distinct targets and respects walls and target limit', () => {
    const first = target(1),
      ts = [first, target(2, 60), target(3, 120), target(4, 170)]
    expect(chainTargets(ts, first, 2, 100, () => false).map((t) => t.id)).toEqual([2, 3])
    expect(chainTargets(ts, first, 2, 100, (_a, b) => b.id === 2)).toEqual([])
  })
  it('rejects invalid durations, intervals, pierce counts and unbounded particle capacities', () => {
    for (const [key, value] of [
      ['poisonTickMs', 0],
      ['poisonDurationMs', 100],
    ] as const) {
      const c = structuredClone(raw)
      c.weapons.find((w: { id: string }) => w.id === 'venom')[key] = value
      expect(() => parseCombatConfig(c)).toThrow()
    }
    const c = structuredClone(raw)
    c.weapons.find((w: { id: string }) => w.id === 'rail').pierceTargets = 1.5
    expect(() => parseCombatConfig(c)).toThrow()
    c.weaponEffects.maxParticles = Infinity
    expect(() => parseCombatConfig(c)).toThrow()
  })
})
