import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  aimBand,
  aimFrame,
  equippedMuzzle,
  shotRecoil,
  validateAimArt,
  type AimArtConfig,
} from './AimPose'
import { gunMuzzlePosition } from './gunPose'
const raw = JSON.parse(
  readFileSync(new URL('../../../public/config/combat.json', import.meta.url), 'utf8'),
)
const art = raw.aimArt as AimArtConfig

describe('whole character aim poses from folder 11', () => {
  it('preserves both supplied sheets byte-for-byte, including all 16 complete frames', () => {
    const hashes = {
      up: '2e6df52b0f22eacc1fb9121da317835a388f365c663fb8083a99d17b1678b105',
      down: '9ca530866007433be845a4388a6b788ff97bb29c61f83e80c0dc5eff84c45f45',
    }
    for (const sheet of ['up', 'down'] as const) {
      const png = readFileSync(
        new URL(
          '../../../public/assets/sprites/player/player_student_aim_' + sheet + '.png',
          import.meta.url,
        ),
      )
      expect(createHash('sha256').update(png).digest('hex')).toBe(hashes[sheet])
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([284, 284])
    }
  })
  it('selects raised and lowered whole-body poses equally on both facings', () => {
    for (const dx of [-200, 200]) {
      expect(aimBand(art, dx, -300)).toBe(3)
      expect(aimBand(art, dx, 200)).toBe(0)
      expect(aimBand(art, dx, 0)).toBe(1)
    }
  })
  it('keeps the current pose near an angle boundary to avoid flicker', () => {
    const target = (degrees: number) => -200 * Math.tan((degrees * Math.PI) / 180)
    expect(aimBand(art, 200, target(23), 1)).toBe(1)
    expect(aimBand(art, 200, target(21), 2)).toBe(2)
    expect(aimBand(art, 200, target(30), 1)).toBe(2)
  })
  it('loops only the selected directional movement frames and keeps flash frames out of idle', () => {
    art.bands.forEach((band, i) => {
      for (let t = 0; t < 4000; t += 63)
        expect(band.frames).toContain(aimFrame(art, i, true, t)!.frame)
    })
    expect(aimFrame(art, 1, false, 0)).toEqual({ sheet: 'up', state: 'stand', frame: 0 })
    expect(aimFrame(art, 0, false, 1000)).toEqual({ sheet: 'down', state: 'stand', frame: 8 })
    expect(aimFrame(art, 0, false, 3000)).toEqual(aimFrame(art, 0, false, 0))
  })
  it('mirrors the visible frame muzzle with the whole character', () => {
    for (const sheet of ['up', 'down'] as const)
      for (const muzzle of art.muzzles[sheet]) {
        const right = gunMuzzlePosition({ x: 300, y: 400 }, art, art.anchor, muzzle, 1.3, false)
        const left = gunMuzzlePosition({ x: 300, y: 400 }, art, art.anchor, muzzle, 1.3, true)
        expect(left.x + right.x).toBeCloseTo(600)
        expect(left.y).toBe(right.y)
      }
  })
  it('settles after each shot without persisting recoil into idle or drifting one facing', () => {
    expect(shotRecoil(art, null, 220, false)).toEqual({ x: 0, y: 0 })
    expect(shotRecoil(art, 220, 220, false)).toEqual({ x: 0, y: 0 })
    const a = shotRecoil(art, 80, 220, false),
      b = shotRecoil(art, 80, 220, true)
    expect(a.x).toBe(-b.x)
    expect(a.y).toBe(b.y)
    expect(a.y).toBeGreaterThan(0)
  })
  it('switches equipment muzzles with the same transform as the baked gun', () => {
    const pose = aimFrame(art, 0, false, 0)
    const feet = { x: 300, y: 400 }
    const pistol = equippedMuzzle(art, pose, feet, 1.3, false)
    for (const weapon of ['pulse', 'venom', 'flare', 'rail', 'smg']) {
      const muzzle = raw.gunMuzzles[weapon + 'Shoot'][0]
      const right = equippedMuzzle(art, pose, feet, 1.3, false, muzzle)
      const left = equippedMuzzle(art, pose, feet, 1.3, true, muzzle)
      expect(right).not.toEqual(pistol)
      expect(right.x + left.x).toBeCloseTo(600)
      expect(right.y).toBe(left.y)
    }
  })
  it('rejects missing directions and out-of-range frames at load time', () => {
    expect(() => validateAimArt(art)).not.toThrow()
    const invalid = structuredClone(art)
    invalid.bands[0]!.frames = [16]
    expect(() => validateAimArt(invalid)).toThrow()
    const missing = structuredClone(art)
    missing.muzzles.down = []
    expect(() => validateAimArt(missing)).toThrow()
  })
})
