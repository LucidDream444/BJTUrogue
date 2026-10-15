import { describe, expect, it } from 'vitest'
import { gunMuzzlePosition } from './gunPose'

describe('gun muzzle follows the artwork', () => {
  const size = { frameWidth: 72, frameHeight: 72 }
  const anchor = [48.5 / 72, 1]
  const muzzle = [66, 38.5] as const
  it('attaches to the idle handgun at the configured visual scale', () => {
    const point = gunMuzzlePosition({ x: 100, y: 200 }, size, anchor, muzzle, 1.15, false)
    expect(point.x).toBeCloseTo(120.125)
    expect(point.y).toBeCloseTo(161.475)
  })
  it('reflects around the feet without moving the muzzle vertically', () => {
    const point = gunMuzzlePosition({ x: 100, y: 200 }, size, anchor, muzzle, 1.15, true)
    expect(point.x).toBeCloseTo(79.875)
    expect(point.y).toBeCloseTo(161.475)
  })
  it('uses a running frame own dimensions and raised foot anchor', () => {
    const point = gunMuzzlePosition(
      { x: 100, y: 200 },
      { frameWidth: 71, frameHeight: 71 },
      [58 / 71, 67 / 71],
      [71, 34.5],
      1.15,
      false,
    )
    expect(point.x).toBeCloseTo(114.95)
    expect(point.y).toBeCloseTo(162.625)
  })
  it('scales only the attachment offset, leaving world translation unchanged', () => {
    const point = gunMuzzlePosition({ x: 500, y: 600 }, size, anchor, muzzle, 2, false)
    expect(point).toEqual({ x: 535, y: 533 })
  })
})
