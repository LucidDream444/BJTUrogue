import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { deriveBossSpeed, parseConfigBundle } from '@/core/config'

const read = (file: string): unknown =>
  JSON.parse(readFileSync(new URL('../../../public/config/' + file, import.meta.url), 'utf8'))
const bundle = parseConfigBundle({
  balance: read('balance.json'),
  difficulty: read('difficulty.json'),
  enemies: read('enemies.json'),
})
const pools = read('boss-pools.json') as {
  pools: Record<string, string[]>
  finalBoss: string
}

describe('boss movement speed', () => {
  it('covers every boss that can appear in a run', () => {
    const ids = [...Object.values(pools.pools).flat(), pools.finalBoss]
    for (const id of ids) expect(bundle.enemies.bossSpeeds[id], id).toBeGreaterThan(0)
  })

  it('uses per-boss overrides for every pool boss', () => {
    const e = bundle.enemies
    expect(deriveBossSpeed(e, 'coursework', 1, 1)).toBe(80)
    expect(deriveBossSpeed(e, 'paper_kite', 1, 1)).toBe(80)
    expect(deriveBossSpeed(e, 'acid_sprinkler', 2, 1)).toBe(78)
    expect(deriveBossSpeed(e, 'sports_gear', 2, 1)).toBe(84)
    expect(deriveBossSpeed(e, 'roll_call', 3, 1)).toBe(64)
    expect(deriveBossSpeed(e, 'nailong', 3, 1)).toBe(72)
    expect(deriveBossSpeed(e, 'heart_demon', 3, 1)).toBe(86)
  })

  it('falls back to the default for an unknown boss id', () => {
    expect(deriveBossSpeed(bundle.enemies, 'unknown-boss', 1, 1)).toBe(80)
  })

  it('applies the difficulty speed multiplier exactly once', () => {
    expect(deriveBossSpeed(bundle.enemies, 'coursework', 1, 1.1)).toBe(88)
    expect(deriveBossSpeed(bundle.enemies, 'nailong', 3, 1.1)).toBe(79)
  })

  it('keeps the regular tank template slow', () => {
    const tank = bundle.enemies.enemies.tank.speed
    expect(tank).toBe(52)
    expect(deriveBossSpeed(bundle.enemies, 'coursework', 1, 1)).toBeGreaterThan(tank)
  })
})
