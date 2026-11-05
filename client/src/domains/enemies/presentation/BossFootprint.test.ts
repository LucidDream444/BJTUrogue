import { describe, expect, it } from 'vitest'
import { bossFootprint } from './BossFootprint'
import { segmentHit } from '@/domains/combat/WeaponMechanics'

describe('Boss display and player-hit footprint', () => {
  const config = { bossVisualScaleMultiplier: 2, bossHitRadiusMultiplier: 2 }
  it.each([[40, 1.15], [34, 1.3]])('keeps original solid collision size (%s, %s)', (radius, scale) => {
    const result = bossFootprint(radius, scale, config)
    expect(result.visualScale).toBe(scale * 2)
    expect(result.bodyTextureRadius * result.visualScale).toBeCloseTo(radius * scale)
    expect(result.hitRadius).toBeCloseTo(radius * scale * 2)
  })
  it('hits the enlarged region while rejecting a nearby miss', () => {
    const enlarged = bossFootprint(40, 1.15, config)
    const target = { id: 1, x: 0, y: 0, radius: enlarged.hitRadius }
    expect(segmentHit({ x: -200, y: 70 }, { x: 200, y: 70 }, target, 4)).not.toBeNull()
    expect(segmentHit({ x: -200, y: 70 }, { x: 200, y: 70 }, { ...target, radius: 46 }, 4)).toBeNull()
    expect(segmentHit({ x: -200, y: 100 }, { x: 200, y: 100 }, target, 4)).toBeNull()
  })
})
