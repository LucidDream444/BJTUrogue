import { describe, expect, it } from 'vitest'
import { WEAPON_IDS } from './config'
import { WEAPON_SFX, sfxProfileFor } from './WeaponSfxProfiles'

describe('procedural weapon sfx profiles', () => {
  it('covers all 36 weapons and every profile is synthesizable', () => {
    for (const id of WEAPON_IDS) {
      const profile = WEAPON_SFX[id]
      expect(profile, id).toBeDefined()
      expect(profile.duration, id).toBeGreaterThan(0)
      expect(profile.duration, id).toBeLessThanOrEqual(0.4)
      expect(profile.volume, id).toBeGreaterThan(0)
      expect(profile.volume, id).toBeLessThanOrEqual(1)
      expect(profile.freq, id).toBeGreaterThan(0)
      expect(profile.freqEnd, id).toBeGreaterThan(0)
      expect(profile.noise ?? 0, id).toBeGreaterThanOrEqual(0)
      expect(profile.noise ?? 0, id).toBeLessThanOrEqual(1)
      if (profile.bitDepth !== undefined) {
        expect(Number.isInteger(profile.bitDepth), id).toBe(true)
        expect(profile.bitDepth, id).toBeGreaterThanOrEqual(2)
      }
      if (profile.filter) expect(profile.filter.frequency, id).toBeGreaterThan(0)
      if (profile.pulses !== undefined) {
        expect(Number.isInteger(profile.pulses), id).toBe(true)
        expect(profile.pulses, id).toBeGreaterThanOrEqual(1)
      }
    }
    expect(Object.keys(WEAPON_SFX)).toHaveLength(WEAPON_IDS.length)
  })

  it('gives heavy and light melee audibly different recipes', () => {
    const knife = sfxProfileFor('pencil_knife')
    const maul = sfxProfileFor('eraser_maul')
    expect(maul.duration).toBeGreaterThan(knife.duration)
    expect(maul.freq).toBeLessThan(knife.freq)
    expect(maul.noise!).toBeGreaterThan(knife.noise!)
  })
})
