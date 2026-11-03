import { describe, expect, it } from 'vitest'
import { ChargeSweep, chargeSolidHitTime, type ChargeTarget } from './ChargeSweep'

const target = (id: number, x: number, y = 0): ChargeTarget => ({ id, spawnSeq: id, x, y, radius: 2, alive: true })
describe('番鸭直线扫掠', () => {
  it('矩形地形扫掠考虑实体半径，薄墙也会截断', () => {
    expect(chargeSolidHitTime({ x: 0, y: 0 }, { x: 100, y: 0 }, 5, [{ x: 50, y: -10, width: 1, height: 20 }])).toBe(0.45)
    expect(chargeSolidHitTime({ x: 0, y: 40 }, { x: 100, y: 40 }, 5, [{ x: 50, y: -10, width: 1, height: 20 }])).toBeNull()
  })
  it('高速跨过多个单位，每次攻击每个目标只命中一次，排除自己', () => {
    const run = new ChargeSweep(20, 1)
    const targets = [target(1, 0), target(2, 30), target(3, 80), target(4, 100, 40)]
    expect(run.sweep({ x: 0, y: 0 }, { x: 120, y: 0 }, 3, 200, targets).targets.map((t) => t.id)).toEqual([2, 3])
    expect(run.sweep({ x: 0, y: 0 }, { x: 120, y: 0 }, 3, 200, targets).targets).toEqual([])
    expect(new ChargeSweep(21, 1).sweep({ x: 0, y: 0 }, { x: 120, y: 0 }, 3, 200, targets).targets).toHaveLength(2)
  })
  it('墙/家具/封门先截断位置，再排除障碍后的目标；打开的门可通过', () => {
    const targets = [target(2, 20), target(3, 80)]
    const blocked = new ChargeSweep(20, 1).sweep({ x: 0, y: 0 }, { x: 100, y: 0 }, 3, 200, targets, () => 0.5)
    expect(blocked.endpoint).toEqual({ x: 50, y: 0 })
    expect(blocked.stopped).toBe(true)
    expect(blocked.targets.map((t) => t.id)).toEqual([2])
    expect(new ChargeSweep(21, 1).sweep({ x: 0, y: 0 }, { x: 100, y: 0 }, 3, 200, targets, () => null).targets).toHaveLength(2)
  })
  it('冲刺距离封顶，复用目标以重生身份隔离', () => {
    const run = new ChargeSweep(20, 1)
    const first = target(2, 20)
    const result = run.sweep({ x: 0, y: 0 }, { x: 100, y: 0 }, 3, 30, [first, target(3, 70)])
    expect(result.distance).toBe(30)
    expect(result.endpoint.x).toBe(30)
    expect(result.targets).toEqual([first])
    expect(run.sweep({ x: 0, y: 0 }, { x: 30, y: 0 }, 3, 30, [{ ...first, spawnSeq: 9 }]).targets).toHaveLength(1)
  })
})
