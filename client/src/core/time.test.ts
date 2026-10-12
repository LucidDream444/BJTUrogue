import { describe, expect, it } from 'vitest'
import { GameClock, HitstopBudget } from './time'

/**
 * 逻辑时钟。
 *
 * 这里钉的不是「代码能不能跑」，而是三条会静默出错的语义：
 *   ① 暂停/顿帧期间逻辑时间与 `frameId` 必须一起停 —— 否则伤害账本的
 *      「单帧最多推进一次 tick」门控会失效（同帧号复用 → 一串 tick 被吞掉）。
 *   ② 顿帧时长必须**精确**，不能因为一帧跨过结束点就吞掉整帧或超发。
 *   ③ 顿帧预算的滑动窗口必须真的滑得动（它用的是不走逻辑时间的真实时间）。
 */

describe('GameClock — 基本推进', () => {
  it('advance 推逻辑时间与 frameId', () => {
    const clock = new GameClock()
    expect(clock.nowMs).toBe(0)
    expect(clock.frameId).toBe(0)

    clock.advance(16)
    clock.advance(16)
    expect(clock.nowMs).toBe(32)
    expect(clock.frameId).toBe(2)
    expect(clock.realNowMs).toBe(32)
  })

  it('非法 delta 不推任何东西（NaN / 0 / 负数）', () => {
    const clock = new GameClock()
    clock.advance(16)

    clock.advance(Number.NaN)
    clock.advance(Number.POSITIVE_INFINITY)
    clock.advance(0)
    clock.advance(-5)

    expect(clock.nowMs).toBe(16)
    expect(clock.frameId).toBe(1)
    expect(clock.realNowMs).toBe(16)
  })
})

describe('GameClock — 暂停', () => {
  it('暂停期间逻辑时间与 frameId 都停，真实时间照走', () => {
    const clock = new GameClock()
    clock.advance(100)
    clock.pause()

    for (let i = 0; i < 10; i++) clock.advance(50)

    expect(clock.nowMs).toBe(100) // 逻辑停
    expect(clock.frameId).toBe(1) // 帧号也停 —— 账本门控的关键
    expect(clock.realNowMs).toBe(600) // 真实照走
    expect(clock.paused).toBe(true)

    clock.resume()
    clock.advance(20)
    expect(clock.nowMs).toBe(120) // 恢复后不追赶：只加这一帧
    expect(clock.frameId).toBe(2)
  })

  it('暂停会丢弃未走完的顿帧（暂停优先）', () => {
    const clock = new GameClock()
    clock.freeze(500)
    clock.pause()
    expect(clock.frozen).toBe(false)
    expect(clock.freezeRemainingMs).toBe(0)

    clock.resume()
    clock.advance(50)
    expect(clock.nowMs).toBe(50) // 那 500ms 不会在恢复后接着生效
  })

  it('暂停期间请求顿帧无效', () => {
    const clock = new GameClock()
    clock.pause()
    clock.freeze(100)
    expect(clock.frozen).toBe(false)
  })
})

describe('GameClock — 顿帧', () => {
  it('顿帧期间逻辑时间与 frameId 停，真实时间走', () => {
    const clock = new GameClock()
    clock.advance(16)
    clock.freeze(100)

    clock.advance(20)
    clock.advance(20)

    expect(clock.nowMs).toBe(16)
    expect(clock.frameId).toBe(1)
    expect(clock.realNowMs).toBe(56)
    expect(clock.frozen).toBe(true)
    expect(clock.freezeRemainingMs).toBe(60)
  })

  it('跨过顿帧结束的那一帧：多出来的部分算逻辑时间，既不吞也不超发', () => {
    const clock = new GameClock()
    clock.advance(16) // 逻辑 16
    clock.freeze(50)

    clock.advance(20) // 用掉 20，剩 30
    clock.advance(20) // 用掉 20，剩 10
    expect(clock.nowMs).toBe(16)

    clock.advance(20) // 第 3 帧跨过结束点：50 用满，余下 10 计入逻辑
    expect(clock.frozen).toBe(false)
    expect(clock.freezeRemainingMs).toBe(0)
    expect(clock.nowMs).toBe(26) // 16 + 10，不是 16 也不是 36
    expect(clock.frameId).toBe(2) // 这一帧是有效的，帧号推进

    clock.advance(20)
    expect(clock.nowMs).toBe(46) // 之后完全恢复正常
  })

  it('顿帧总量精确等于请求值（60 帧内统计）', () => {
    const clock = new GameClock()
    clock.freeze(60)
    let real = 0
    for (let i = 0; i < 60; i++) {
      clock.advance(1000 / 60)
      real += 1000 / 60
    }
    // 逻辑时间 = 真实流逝 - 顿帧时长（浮点误差内）
    expect(clock.nowMs).toBeCloseTo(real - 60, 6)
  })

  it('重复请求取较长者，连锁击杀不会互相吞掉', () => {
    const clock = new GameClock()
    clock.freeze(40)
    clock.freeze(25) // 比剩余的短，不该把它缩短
    expect(clock.freezeRemainingMs).toBe(40)

    clock.freeze(80)
    expect(clock.freezeRemainingMs).toBe(80)
  })

  it('非法顿帧请求被忽略', () => {
    const clock = new GameClock()
    clock.freeze(0)
    clock.freeze(-100)
    clock.freeze(Number.NaN)
    expect(clock.frozen).toBe(false)
    clock.advance(16)
    expect(clock.nowMs).toBe(16)
  })

  it('reset 清干净一切（重开一局用）', () => {
    const clock = new GameClock()
    clock.advance(100)
    clock.freeze(500)
    clock.pause()
    clock.reset()

    expect(clock.nowMs).toBe(0)
    expect(clock.realNowMs).toBe(0)
    expect(clock.frameId).toBe(0)
    expect(clock.paused).toBe(false)
    expect(clock.frozen).toBe(false)
  })
})

describe('HitstopBudget — 滑动窗口内的顿帧总时长上限', () => {
  it('额度用尽后拒绝发放（跳过，而不是截断成更短的顿帧）', () => {
    const budget = new HitstopBudget(2000, 0.25) // 容量 500ms
    expect(budget.remaining(0)).toBe(500)

    expect(budget.tryGrant(45, 0)).toBe(true)
    expect(budget.used(0)).toBe(45)
    expect(budget.remaining(0)).toBe(455)

    // 连续连锁击杀：45ms × 11 = 495 塞得进，第 12 次越界
    for (let i = 1; i <= 10; i++) expect(budget.tryGrant(45, i)).toBe(true)
    expect(budget.used(10)).toBe(495)

    expect(budget.tryGrant(45, 11)).toBe(false)
    expect(budget.used(11)).toBe(495) // 被拒的**不记账**
    expect(budget.remaining(11)).toBe(5)
  })

  it('窗口滑过去之后额度恢复', () => {
    const budget = new HitstopBudget(2000, 0.25)
    expect(budget.tryGrant(500, 0)).toBe(true)
    expect(budget.tryGrant(1, 100)).toBe(false)

    // nowMs - 2000 >= 0 → 第一条过期
    expect(budget.used(2000)).toBe(0)
    expect(budget.remaining(2000)).toBe(500)
    expect(budget.tryGrant(500, 2000)).toBe(true)
  })

  it('时间戳乱序（误传逻辑时间导致倒退）也不会静默失效', () => {
    const budget = new HitstopBudget(2000, 0.25)
    budget.tryGrant(45, 1000)
    budget.tryGrant(45, 500)
    budget.tryGrant(45, 0)
    expect(budget.used(1000)).toBe(135)

    // 只看队首的实现会在这里卡住：队首是 atMs=1000 的那条，cutoff=600 剪不掉它，
    // 于是 atMs=500 与 atMs=0 那两条**永远**留在窗口里，预算白扣一大半（135 而不是 45）。
    expect(budget.used(2600)).toBe(45) // 窗口 = (600, 2600]，只有 atMs=1000 的在里面
    expect(budget.remaining(2600)).toBe(455)
  })

  it('reset 清空窗口', () => {
    const budget = new HitstopBudget(2000, 0.25)
    budget.tryGrant(500, 0)
    budget.reset()
    expect(budget.used(0)).toBe(0)
    expect(budget.remaining(0)).toBe(500)
  })

  it('非正的顿帧请求直接被拒，不记账', () => {
    const budget = new HitstopBudget(2000, 0.25)
    expect(budget.tryGrant(0, 0)).toBe(false)
    expect(budget.tryGrant(-10, 0)).toBe(false)
    expect(budget.used(0)).toBe(0)
  })
})