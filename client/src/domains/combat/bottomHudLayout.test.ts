import { describe, expect, it } from 'vitest'
import { bottomHudLayout } from './bottomHudLayout'

describe('bottom HUD responsive placement', () => {
  it.each([
    [320, 568],
    [390, 844],
    [640, 360],
    [800, 600],
    [1280, 720],
    [1920, 1080],
    [2560, 1080],
  ])('keeps both HUDs on screen and disjoint at %dx%d', (width, height) => {
    const { loadout, skill } = bottomHudLayout(width, height)
    for (const box of [loadout, skill]) {
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      expect(box.y + box.height).toBeLessThanOrEqual(height)
      expect(box.scale).toBeGreaterThan(0)
    }
    const intersectWidth =
      Math.min(loadout.x + loadout.width, skill.x + skill.width) - Math.max(loadout.x, skill.x)
    const intersectHeight =
      Math.min(loadout.y + loadout.height, skill.y + skill.height) - Math.max(loadout.y, skill.y)
    expect(intersectWidth <= 0 || intersectHeight <= 0).toBe(true)
  })
  it('stacks narrow screens instead of shrinking text to fit one row', () => {
    const layout = bottomHudLayout(640, 600)
    expect(layout.stacked).toBe(true)
    expect(layout.skill.scale).toBe(1)
    expect(layout.skill.y + layout.skill.height).toBeLessThan(layout.loadout.y)
  })
})
