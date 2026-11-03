import { describe, expect, it } from 'vitest'
import { advanceDashMovement, advancePlayerMovement } from './MovementForces'
import { earliestObstacleHit, sweepEnabledBarriers } from './BarrierSweep'

describe('玩家控制速度与旋风外力分离', () => {
  it('主动冲刺也受侧向拉力，30/60/144Hz位移一致', () => {
    for (const fps of [30, 60, 144]) {
      let position = { x: 0, y: 0 }
      for (let frame = 0; frame < fps; frame++) {
        const step = advanceDashMovement(position, { x: 260 / fps, y: 0 }, { x: -40, y: 80 }, 1 / fps, () => false)
        expect(step.blocked).toBe(false)
        position = step.position
      }
      expect(position.x).toBeCloseTo(220)
      expect(position.y).toBeCloseTo(80)
    }
  })
  it('吸力改变冲刺路径后重新扫掠墙体，阻挡时只推进至安全位置', () => {
    const step = advanceDashMovement({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 100 }, 0.1,
      (_from, to) => to.y >= 5)
    expect(step.blocked).toBe(true)
    expect(step.position.y).toBeLessThan(5)
    expect(step.position.y).toBeCloseTo(5, 3)
    expect(step.position.x).toBe(step.position.y)
  })
  it('侧向吸力不能把冲刺拉穿关闭门，打开的门允许通过', () => {
    let closed = true
    const crossesSolid = (from: { x: number; y: number }, to: { x: number; y: number }) => earliestObstacleHit(
      null,
      sweepEnabledBarriers(from, to, 1, [{ x: 4, y: 5, width: 2, height: 1 }], () => closed),
    ) !== null
    const blocked = advanceDashMovement({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 100 }, 0.1, crossesSolid)
    expect(blocked.blocked).toBe(true)
    expect(blocked.position.y).toBeLessThan(4)
    expect(blocked.position.y).toBeCloseTo(4, 3)
    closed = false
    expect(advanceDashMovement({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 100 }, 0.1, crossesSolid))
      .toEqual({ position: { x: 10, y: 10 }, blocked: false })
  })
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
