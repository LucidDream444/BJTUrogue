import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FixedRng, Rng } from '@/core/rng'
import { parseCombatConfig } from './config'
import { rollRecoveryDrop } from './dropPolicy'
const raw = JSON.parse(
  readFileSync(new URL('../../../public/config/combat.json', import.meta.url), 'utf8'),
)
const cfg = parseCombatConfig(raw).drops
const roll = (a: number, b: number) => {
  const rng = new FixedRng(0),
    draws = [a, b]
  rng.next = () => draws.shift()!
  return rollRecoveryDrop(cfg, rng)
}
describe('enemy recovery drops', () => {
  it('rolls one total chance before selecting a resource', () => {
    expect(cfg.chance).toBe(0.62)
    expect(roll(0.62, 0)).toBeNull()
    expect(roll(0.999, 0)).toBeNull()
    expect(roll(0.619, 0)).toEqual({ kind: 'stamina', amount: 40 })
  })
  it('gives stamina most of the distribution and still supports health and shield', () => {
    expect(roll(0, 0.599999)).toEqual({ kind: 'stamina', amount: 40 })
    expect(roll(0, 0.6)).toEqual({ kind: 'health', amount: 20 })
    expect(roll(0, 0.799999)).toEqual({ kind: 'health', amount: 20 })
    expect(roll(0, 0.800001)).toEqual({ kind: 'shield', amount: 10 })
  })
  it('matches the configured joint drop probabilities across a seeded sample', () => {
    const rng = new Rng(813),
      counts = { stamina: 0, health: 0, shield: 0, none: 0 }
    for (let i = 0; i < 10000; i++) counts[rollRecoveryDrop(cfg, rng)?.kind ?? 'none']++
    expect(counts.stamina / 10000).toBeCloseTo(0.372, 1)
    expect(counts.none / 10000).toBeCloseTo(0.38, 1)
    expect(counts.stamina).toBeGreaterThan(counts.health + counts.shield)
  })
  it('rejects impossible resource weights and nonpositive stamina recovery', () => {
    expect(() =>
      parseCombatConfig({ ...raw, drops: { ...cfg, staminaChance: 0.9, healthChance: 0.3 } }),
    ).toThrow()
    expect(() => parseCombatConfig({ ...raw, drops: { ...cfg, staminaAmount: 0 } })).toThrow()
  })
})
