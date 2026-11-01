import { describe, expect, it } from 'vitest'
import { advancePlayerMovement } from './MovementForces'

describe('玩家控制速度与旋风外力分离', () => {
  it('静止持续受吸引一秒，30/60/144Hz均只叠本帧外力', () => {
    for (const fps of [30, 60, 144]) {
      let control = { x: 0, y: 0 }
      let body = { x: 0, y: 0 }
      for (let frame = 0; frame < fps; frame++) {
        const result = advancePlayerMovement(control, { x: 0, y: 0 }, 260, 1800, 2000, 1 / fps, { x: -40, y: 0 })
        control = result.control
        body = result.body
        expect(body.x).toBe(-40)
      }
      expect(control).toEqual({ x: 0, y: 0 })
      expect(body).toEqual({ x: -40, y: 0 })
    }
  })
  it('主动移动可抵抗吸力，场结束后不残留惯性', () => {
    let control = { x: 0, y: 0 }
    let body = { x: 0, y: 0 }
    for (let frame = 0; frame < 120; frame++) {
      const result = advancePlayerMovement(control, { x: 1, y: 0 }, 260, 1800, 2000, 1 / 120, { x: -40, y: 0 })
      control = result.control; body = result.body
    }
    expect(control.x).toBe(260)
    expect(body.x).toBe(220)
    const released = advancePlayerMovement({ x: 0, y: 0 }, { x: 0, y: 0 }, 260, 1800, 2000, 1 / 120, { x: 0, y: 0 })
    expect(released.body).toEqual({ x: 0, y: 0 })
  })
})
