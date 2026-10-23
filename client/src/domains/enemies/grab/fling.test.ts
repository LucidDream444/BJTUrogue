import { describe, expect, it } from 'vitest'
import { FLING_DIRECTIONS, landingPoint, pickFlingDirection, shouldLand } from './fling'
import { targetsInBlast } from './blast'

/**
 * 甩出与落地爆炸的测试。
 *
 * 方向选择这几条盯的是**「可复现」**：同一个场面必须永远选同一个方向 ——
 * 否则玩家看到的是一次掷骰子，学不到任何东西。
 */

const D = 280
const R = 300
const at = (x: number, y: number) => ({ x, y })

describe('pickFlingDirection — 朝人堆甩', () => {
  it('左边三只、右边一只 → 往左甩', () => {
    const dir = pickFlingDirection(at(0, 0), D, R, [at(-D, 0), at(-D - 40, 20), at(-D + 30, -30), at(D, 0)])
    // 走向左侧**那一半**就够了：多个相邻候选会并列（比如 120° 和 180° 都罩得住那三只），
    // 平手取先到的那个 —— 这一条由「平手结果确定」那条测试单独盯。
    expect(dir.x, '应当朝左侧（人多的那一边）').toBeLessThan(0)
  })

  it('平手时结果确定：两次调用完全相同，且取角度最小的那个', () => {
    // 两只分别在正右与正左：任何落点都罩不住两只 → 处处平手
    const targets = [at(D, 0), at(-D, 0)]
    const a = pickFlingDirection(at(0, 0), D, R, targets)
    const b = pickFlingDirection(at(0, 0), D, R, targets)
    expect(a).toEqual(b)
    expect(a.x, '平手取角度最小的那个（+x）').toBeCloseTo(1, 6)
  })

  it('场上没有别的敌人 → 退化成确定的 +x，不是随机的', () => {
    const dir = pickFlingDirection(at(0, 0), D, R, [])
    expect(dir).toEqual({ x: 1, y: 0 })
  })

  it('够不着的候选不算数（不然数出来的人数和实际炸到的对不上）', () => {
    // 左边三只在「墙后」：判据说从玩家飞不到那边
    const blocked = (_a: { x: number; y: number }, b: { x: number; y: number }) => b.x < -1
    const dir = pickFlingDirection(at(0, 0), D, R, [at(-D, 0), at(-D, 20), at(D, 0)], blocked)
    expect(dir.x, '墙后人多也不去，改去够得着的右边').toBeGreaterThan(0.9)
  })

  it('所有方向都被挡住 → 仍旧给一个确定方向（照常飞、撞墙炸）', () => {
    const dir = pickFlingDirection(at(0, 0), D, R, [at(D, 0)], () => true)
    expect(dir).toEqual({ x: 1, y: 0 })
  })

  it('落点算式：圆心 + 方向 × 距离', () => {
    expect(landingPoint(at(10, 20), { x: 0, y: 1 }, 100)).toEqual({ x: 10, y: 120 })
  })

  it('候选方向的数量是定死的常量（它决定平手的粒度）', () => {
    expect(FLING_DIRECTIONS).toBe(24)
  })
})

describe('shouldLand — 什么时候算落地', () => {
  const cfg = { flingTimeMs: 400 }

  it('飞满固定时长 → 落地', () => {
    expect(shouldLand(cfg, 399, 10, 0, 16).land).toBe(false)
    expect(shouldLand(cfg, 400, 10, 0, 16).land).toBe(true)
  })

  it('撞墙不动 → 提前落地', () => {
    let stuck = 0
    let landed = false
    for (let t = 0; t < 200; t += 16) {
      const r = shouldLand(cfg, t, 0, stuck, 16)
      stuck = r.stuckForMs
      if (r.land) {
        landed = true
        break
      }
    }
    expect(landed, '一直没动就该判落地').toBe(true)
  })

  it('「没动」按毫秒累计，不按帧数（30fps 与 144fps 语义一致）', () => {
    // 4 帧 × 25ms = 100ms 没动 → 落地
    let stuck = 0
    for (let i = 0; i < 3; i++) stuck = shouldLand(cfg, 0, 0, stuck, 25).stuckForMs
    expect(shouldLand(cfg, 0, 0, stuck, 25).land).toBe(true)
  })

  it('动起来了就重新计时', () => {
    // stepPx 要**大于**阈值才算「在动」：0 是「没动」，正是要清零的反面
    const r = shouldLand(cfg, 100, 10, 70, 16)
    expect(r.stuckForMs).toBe(0)
    expect(r.land).toBe(false)
  })
})

describe('targetsInBlast — 只炸敌人', () => {
  it('半径内的都中，半径外的不中', () => {
    const ids = targetsInBlast(at(0, 0), 100, [
      { ...at(50, 0), id: 1 },
      { ...at(150, 0), id: 2 },
      { ...at(0, -99), id: 3 },
    ])
    expect(ids).toEqual([1, 3])
  })

  it('胖敌人擦边也算（用「距离 ≤ 半径 + 目标半径」）', () => {
    const fat = { x: 120, y: 0, id: 7, radius: 40 }
    expect(targetsInBlast(at(0, 0), 100, [fat])).toEqual([7])
  })

  it('已经死掉的不再被炸一次', () => {
    expect(targetsInBlast(at(0, 0), 100, [{ x: 10, y: 0, id: 3, alive: false }])).toEqual([])
  })
})
