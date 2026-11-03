import { describe, expect, it } from 'vitest'
import { earliestObstacleHit, sweepEnabledBarriers } from './BarrierSweep'

const door = { x: 100, y: 20, width: 8, height: 60 }
const from = { x: 40, y: 50 }, to = { x: 200, y: 50 }

describe('关闭门的高速攻击扫掠', () => {
  it('一物理步跨过整块薄门时按实体半径提前截断，开门当场允许通过', () => {
    let closed = true
    const query = () => sweepEnabledBarriers(from, to, 12, [door], () => closed)
    expect(query()).toBeCloseTo((100 - 12 - 40) / 160)
    closed = false
    expect(query()).toBeNull()
    closed = true
    expect(query()).not.toBeNull()
  })

  it('半径擦到门角也不能漏判，门洞外的平行路径不被误挡', () => {
    expect(sweepEnabledBarriers({ x: 40, y: 10 }, { x: 200, y: 10 }, 12, [door], () => true)).not.toBeNull()
    expect(sweepEnabledBarriers({ x: 40, y: 5 }, { x: 200, y: 5 }, 12, [door], () => true)).toBeNull()
  })

  it('起点已接触门时立即停，空路径和反向穿门仍有确定结果', () => {
    expect(sweepEnabledBarriers({ x: 95, y: 50 }, to, 12, [door], () => true)).toBe(0)
    expect(sweepEnabledBarriers({ x: 40, y: 50 }, { x: 40, y: 50 }, 12, [door], () => true)).toBeNull()
    expect(sweepEnabledBarriers(to, from, 12, [door], () => true)).toBeCloseTo((200 - 120) / 160)
  })

  it('只有启用门参与，墙和门合并后选择更近的阻挡位置', () => {
    const far = { ...door, x: 150 }
    const near = { ...door, x: 90 }
    const barrier = sweepEnabledBarriers(from, to, 12, [far, near], (index) => index === 0)
    expect(barrier).toBeCloseTo((150 - 12 - 40) / 160)
    expect(earliestObstacleHit(0.2, barrier)).toBe(0.2)
    expect(earliestObstacleHit(0.9, barrier)).toBe(barrier)
    expect(earliestObstacleHit(null, barrier)).toBe(barrier)
    expect(earliestObstacleHit(null, null)).toBeNull()
  })
})
