import { describe, expect, it } from 'vitest'
import { bossHealthBarLayout } from './BossHealthBarLayout'

describe('boss health HUD placement', () => {
  it.each([0.65, 1, 1.8, 2.6])('keeps the same screen position and size at zoom %s', (zoom) => {
    const camera = { width: 1344, height: 832, zoom, originX: 0.5, originY: 0.5 }
    const baseline = bossHealthBarLayout({ ...camera, zoom: 1 })
    const layout = bossHealthBarLayout(camera)
    const screenX = (layout.x - camera.width * camera.originX) * zoom + camera.width * camera.originX
    const screenY = (layout.y - camera.height * camera.originY) * zoom + camera.height * camera.originY
    expect(screenX).toBeCloseTo(baseline.x)
    expect(screenY).toBeCloseTo(16)
    expect(layout.width * layout.scale * zoom).toBeCloseTo(baseline.width)
  })

  it.each([1120, 1160, 1344, 1920])('leaves both top corners free at width %s', (width) => {
    const layout = bossHealthBarLayout({ width, height: 832, zoom: 1, originX: 0.5, originY: 0.5 })
    expect(layout.x - 10).toBeGreaterThanOrEqual(460)
    expect(layout.x + layout.width + 10).toBeLessThanOrEqual(width - 320)
    expect(layout.y).toBe(16)
  })

  it.each([360, 640, 1000])('stays on-screen below the player HUD at width %s', (width) => {
    const layout = bossHealthBarLayout({ width, height: 720, zoom: 1, originX: 0.5, originY: 0.5 })
    expect(layout.x - 10).toBeGreaterThanOrEqual(0)
    expect(layout.x + layout.width + 10).toBeLessThanOrEqual(width)
    const uiScale = Math.min(1, Math.max(0.3, (width - 36) / 450))
    expect(layout.y - 5).toBeGreaterThan(16 + 150 * uiScale)
  })
})
