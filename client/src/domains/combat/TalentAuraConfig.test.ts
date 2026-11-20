import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { TALENT_KINDS } from './TalentRun'
import { parseCombatConfig, validateTalentFx } from './config'

const read = (): unknown =>
  JSON.parse(readFileSync(new URL('../../../public/config/combat.json', import.meta.url), 'utf8'))
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

describe('talent aura configuration', () => {
  it('covers every talent kind exactly once', () => {
    const cfg = parseCombatConfig(read())
    expect(cfg.talentFx).toBeDefined()
    expect(Object.keys(cfg.talentFx!.entries).sort()).toEqual([...TALENT_KINDS].sort())
    expect(new Set(Object.values(cfg.talentFx!.entries).map((entry) => entry.glyph)).size).toBeGreaterThan(5)
    expect(cfg.talentFx!.idleAlpha).toBeLessThan(cfg.talentFx!.activeAlpha)
  })

  it('rejects a missing or unknown talent profile', () => {
    const raw = clone(read()) as { talentFx: { entries: Record<string, unknown> } }
    delete raw.talentFx.entries.split
    expect(() => validateTalentFx(raw.talentFx)).toThrow(/TALENT_KINDS/)

    const bad = clone(read()) as { talentFx: { entries: { split: { glyph: string } } } }
    bad.talentFx.entries.split.glyph = 'not-a-glyph'
    expect(() => validateTalentFx(bad.talentFx)).toThrow(/glyph/)
  })

  it('rejects invalid colors and orbit values', () => {
    const badColor = clone(read()) as { talentFx: { entries: { split: { color: number } } } }
    badColor.talentFx.entries.split.color = 0x1000000
    expect(() => validateTalentFx(badColor.talentFx)).toThrow(/color/)

    const badRadius = clone(read()) as { talentFx: { orbitRadius: number } }
    badRadius.talentFx.orbitRadius = 0
    expect(() => validateTalentFx(badRadius.talentFx)).toThrow(/orbitRadius/)
  })
})
