import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FixedRng } from '@/core/rng'
import { parseCombatConfig } from './config'
import { rollRecoveryDrop } from './dropPolicy'
const cfg = parseCombatConfig(
  JSON.parse(readFileSync(new URL('../../../public/config/combat.json', import.meta.url), 'utf8')),
).drops

describe('enemy recovery drops', () => {
  it('uses one 10% total drop probability rather than a separate roll per resource', () => {
    expect(cfg.chance).toBe(0.1)
    expect(rollRecoveryDrop(cfg, new FixedRng(0.1))).toBeNull()
    expect(rollRecoveryDrop(cfg, new FixedRng(0.999))).toBeNull()
    expect(rollRecoveryDrop(cfg, new FixedRng(0.099999))?.kind).toBe('health')
  })
  it('splits successful drops evenly between health and shield', () => {
    const rng = new FixedRng(0)
    let rolls = [0.05, 0.49]
    rng.next = () => rolls.shift()!
    expect(rollRecoveryDrop(cfg, rng)).toEqual({ kind: 'health', amount: 30 })
    rolls = [0.05, 0.5]
    expect(rollRecoveryDrop(cfg, rng)).toEqual({ kind: 'shield', amount: 25 })
  })
})
