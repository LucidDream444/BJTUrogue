import { describe, expect, it } from 'vitest'
import { armPose, gunMuzzlePosition } from './gunPose'

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

describe('arm layer aims the barrel at the cursor', () => {
  const size = { frameWidth: 96, frameHeight: 80 }
  const anchor = [0.5468741666666667, 0.95]
  const pivot = [52, 43.5] as const
  const muzzle = [79, 41.5] as const
  const scale = 1.3
  const feet = { x: 400, y: 300 }
  const slack = 0.2
  // [朝向, 鼠标 x, 鼠标 y]。每个朝向只列落在它那半边的瞄准点 ——
  // 落在反侧的会被夹进半圆，那是下面单独一条测试的事。
  const cases: [boolean, number, number][] = [
    [false, 620, 140],
    [false, 760, 300],
    [false, 640, 460],
    [false, 470, 210],
    [true, 180, 140],
    [true, 120, 300],
    [true, 220, 460],
    [true, 330, 210],
  ]

  const barrelOf = (pose: ReturnType<typeof armPose>) =>
    Math.atan2(pose.muzzle.y - pose.pivot.y, pose.muzzle.x - pose.pivot.x)

  it('keeps the muzzle on the pivot→cursor ray for every aim inside the facing', () => {
    for (const [flip, ax, ay] of cases) {
      const pose = armPose(feet, size, anchor, pivot, muzzle, scale, flip, ax, ay)
      const toAim = { x: ax - pose.pivot.x, y: ay - pose.pivot.y }
      const toMuzzle = { x: pose.muzzle.x - pose.pivot.x, y: pose.muzzle.y - pose.pivot.y }
      // 叉积为 0 = 共线；点积为正 = 同向，排除反向的那条延长线
      expect(Math.abs(toAim.x * toMuzzle.y - toAim.y * toMuzzle.x)).toBeLessThan(1e-9)
      expect(toAim.x * toMuzzle.x + toAim.y * toMuzzle.y).toBeGreaterThan(0)
    }
  })

  it('holds the arm length constant instead of stretching toward the cursor', () => {
    const expected = Math.hypot((muzzle[0] - pivot[0]) * scale, (muzzle[1] - pivot[1]) * scale)
    for (const [flip, ax, ay] of cases) {
      const pose = armPose(feet, size, anchor, pivot, muzzle, scale, flip, ax, ay)
      expect(Math.hypot(pose.muzzle.x - pose.pivot.x, pose.muzzle.y - pose.pivot.y)).toBeCloseTo(
        expected,
        9,
      )
    }
  })

  it('leaves the barrel pointing at the cursor on both facings', () => {
    // 回归测试：镜像已经算进 baseAngle 里了，所以两支必须用同一个式子。
    // 早先朝左那一支多减了一个 π，表现为朝左瞄准时枪管上下颠倒。
    for (const [flip, ax, ay] of cases) {
      const pose = armPose(feet, size, anchor, pivot, muzzle, scale, flip, ax, ay)
      const mirror = flip ? -1 : 1
      const baseAngle = Math.atan2(
        (muzzle[1] - pivot[1]) * scale,
        (muzzle[0] - pivot[0]) * scale * mirror,
      )
      const aimAngle = Math.atan2(ay - pose.pivot.y, ax - pose.pivot.x)
      expect(Math.cos(baseAngle + pose.rotation - aimAngle)).toBeCloseTo(1, 9)
    }
  })

  it('clamps the barrel into the facing hemisphere instead of crossing the body', () => {
    // 朝右、鼠标却在正左：枪管最多偏离正前方 π/2 + 余量，绝不横穿身体。
    const pose = armPose(feet, size, anchor, pivot, muzzle, scale, false, 60, 300)
    const barrel = barrelOf(pose)
    expect(Math.abs(barrel)).toBeLessThanOrEqual(Math.PI / 2 + slack + 1e-9)
    expect(Math.abs(barrel)).toBeGreaterThan(Math.PI / 2)
  })

  it('clamps the other way when facing left with the cursor on the right', () => {
    const pose = armPose(feet, size, anchor, pivot, muzzle, scale, true, 760, 300)
    const deviation = Math.abs(
      Math.atan2(Math.sin(barrelOf(pose) - Math.PI), Math.cos(barrelOf(pose) - Math.PI)),
    )
    expect(deviation).toBeLessThanOrEqual(Math.PI / 2 + slack + 1e-9)
    expect(deviation).toBeGreaterThan(Math.PI / 2)
  })

  it('mirrors the pivot to the other side of the body when facing left', () => {
    const right = armPose(feet, size, anchor, pivot, muzzle, scale, false, 600, 300)
    const left = armPose(feet, size, anchor, pivot, muzzle, scale, true, 200, 300)
    expect(left.pivot.x - feet.x).toBeCloseTo(-(right.pivot.x - feet.x), 9)
    expect(left.pivot.y).toBeCloseTo(right.pivot.y, 9)
  })
})
