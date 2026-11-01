import { describe, expect, it } from 'vitest'
import { deflectVortexVelocity, vortexPullVelocity, type VortexSnapshot } from './vortex'

const field: VortexSnapshot = {
  fieldId: 1, sourceId: 2, ownerId: 3, x: 0, y: 0, startedAtMs: 0, endsAtMs: 3000,
  damageRadius: 100, pullRadius: 200, pullSpeed: 50, maxPullSpeed: 60,
  projectileRadius: 150, turnRateRadPerSec: 2, maxTurnRateRadPerSec: 3, rotationSign: 1,
}

describe('旋风共享数学', () => {
  it('多场吸力稳定且有总速度上限，中心/边界不产生NaN', () => {
    const fields = [field, { ...field, fieldId: 4, x: -10 }]
    const a = vortexPullVelocity({ x: 10, y: 0 }, fields)
    expect(a).toEqual(vortexPullVelocity({ x: 10, y: 0 }, [...fields].reverse()))
    expect(Math.hypot(a.x, a.y)).toBeLessThanOrEqual(field.maxPullSpeed)
    expect(a.x).toBeLessThan(0)
    expect(vortexPullVelocity({ x: 0, y: 0 }, [field])).toEqual({ x: 0, y: 0 })
    expect(vortexPullVelocity({ x: 200, y: 0 }, [field])).toEqual({ x: 0, y: 0 })
  })

  it('子弹只改变方向，保留速率且不超过总转角', () => {
    const velocity = { x: -100, y: 0 }
    const fields = [field, { ...field, fieldId: 5 }]
    const output = deflectVortexVelocity({ x: 50, y: 0 }, velocity, fields, 0.1)
    expect(Math.hypot(output.x, output.y)).toBeCloseTo(100)
    const angle = Math.atan2(output.y, output.x)
    expect(Math.abs(Math.atan2(Math.sin(angle - Math.PI), Math.cos(angle - Math.PI))))
      .toBeLessThanOrEqual(field.maxTurnRateRadPerSec * 0.1 + Number.EPSILON)
    expect(output).toEqual(deflectVortexVelocity({ x: 50, y: 0 }, velocity, [...fields].reverse(), 0.1))
  })

  it('停住的弹、无场或范围外均保持轨道', () => {
    expect(deflectVortexVelocity({ x: 0, y: 0 }, { x: 0, y: 0 }, [field], 0.1)).toEqual({ x: 0, y: 0 })
    const velocity = { x: 30, y: 40 }
    const out = deflectVortexVelocity({ x: 200, y: 0 }, velocity, [field], 0.1)
    expect(out.x).toBeCloseTo(velocity.x)
    expect(out.y).toBeCloseTo(velocity.y)
  })
})
