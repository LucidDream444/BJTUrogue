import { describe, expect, it } from 'vitest'
import {
  castRayDistances,
  isPointLit,
  rayRectDistance,
  segmentBlocked,
  type LightRect,
} from './lighting'

/** 一块挡在 (50, -10) 到 (70, 10) 的墙。 */
const WALL: LightRect = { x: 50, y: -10, width: 20, height: 20 }

describe('光照几何', () => {
  it('射线命中墙的近面', () => {
    // 矩形按 0.5px 容差外扩，所以命中距离是 49.5 而不是 50。
    expect(rayRectDistance(0, 0, 1, 0, 200, WALL)).toBeCloseTo(49.5, 5)
  })

  it('射线没碰到墙时返回最大距离', () => {
    expect(rayRectDistance(0, 0, 0, 1, 200, WALL)).toBe(200)
  })

  it('线段被墙挡住 / 从墙外绕过', () => {
    expect(segmentBlocked(0, 0, 100, 0, [WALL])).toBe(true)
    expect(segmentBlocked(0, 40, 100, 40, [WALL])).toBe(false)
  })

  it('可见光扇在墙处截断、空处到达半径', () => {
    const out = new Float32Array(8)
    castRayDistances({ x: 0, y: 0 }, 200, [WALL], 8, out)
    expect(out[0]).toBeCloseTo(49.5, 4)
    expect(out[2]).toBe(200)
  })

  it('玩家光能照到墙前，照不到墙后', () => {
    const player = { x: 0, y: 0, radius: 200 }
    expect(isPointLit(40, 0, player, [], [WALL])).toBe(true)
    expect(isPointLit(100, 0, player, [], [WALL])).toBe(false)
  })

  it('子弹的少量光源能照亮玩家半径之外的点', () => {
    const player = { x: 0, y: 0, radius: 50 }
    const bullet = { x: 120, y: 120, radius: 40 }
    expect(isPointLit(120, 120, player, [], [])).toBe(false)
    expect(isPointLit(120, 120, player, [bullet], [])).toBe(true)
  })

  it('子弹光同样被墙挡住', () => {
    const bullet = { x: 0, y: 0, radius: 200 }
    expect(isPointLit(100, 0, { x: 999, y: 999, radius: 1 }, [bullet], [WALL])).toBe(false)
  })

  it('家具会被光覆盖到外沿 + 余量，但光不再继续穿到后面', () => {
    const desk: LightRect = { x: 50, y: -10, width: 20, height: 20, furniture: true }
    const out = new Float32Array(8)
    castRayDistances({ x: 0, y: 0 }, 200, [desk], 8, out, 12)
    // 近面 49.5、远面 70.5，再给 12px 余量覆盖家具贴图
    expect(out[0]).toBeCloseTo(82.5, 4)
  })

  it('家具后面的墙不会把光挡在家具前面', () => {
    const desk: LightRect = { x: 40, y: -10, width: 20, height: 20, furniture: true }
    const wall: LightRect = { x: 100, y: -30, width: 20, height: 60 }
    const out = new Float32Array(8)
    castRayDistances({ x: 0, y: 0 }, 200, [desk, wall], 8, out, 10)
    // 光覆盖桌子（远面 60.5 + 10 = 70.5），而不是停在墙的近面 99.5
    expect(out[0]).toBeCloseTo(70.5, 4)
  })

  it('墙在家具前面时仍然先停在墙的近面', () => {
    const wall: LightRect = { x: 40, y: -10, width: 20, height: 20 }
    const desk: LightRect = { x: 100, y: -10, width: 20, height: 20, furniture: true }
    const out = new Float32Array(8)
    castRayDistances({ x: 0, y: 0 }, 200, [wall, desk], 8, out, 10)
    expect(out[0]).toBeCloseTo(39.5, 4)
  })
})
