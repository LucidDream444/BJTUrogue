import { describe, expect, it } from 'vitest'
import { GrabQte, type GrabQteConfig } from './grabQte'

/**
 * 抓取规则的测试。
 *
 * 这里盯的是**几条不能漂的口径**：
 * 按下扣的是派生值（不是再算一遍百分比）、咬人不追赶、硬上限一定到得了。
 * 手感（20 下要按多久、咬几口死）由数值与真机决定，不在这里。
 */

const CFG: GrabQteConfig = {
  pressDamage: 5,
  biteIntervalMs: 4000,
  biteDamage: 17,
  hardLimitMs: 8000,
}

const qte = (over: Partial<GrabQteConfig> = {}, startMs = 0) =>
  new GrabQte({ ...CFG, ...over }, startMs)

describe('GrabQte — 连点扣血', () => {
  it('每次按下扣的就是派生好的那个数（这里不再算百分比）', () => {
    const q = qte()
    expect(q.press(100)).toEqual({ damage: 5, escaped: false })
    expect(q.press(95)).toEqual({ damage: 5, escaped: false })
    expect(q.presses).toBe(2)
  })

  it('扣到 ≤ 0 的那一下判为挣脱（它留着 1 血飞出去，不是死在这儿）', () => {
    const q = qte()
    expect(q.press(5).escaped, '正好够扣光 = 挣脱').toBe(true)
    expect(q.outcome).toBe('escaped')
  })

  it('挣脱之后再按不计数（画面上还在连点，但这一局已经结束了）', () => {
    const q = qte()
    q.press(5)
    expect(q.press(5)).toEqual({ damage: 0, escaped: false })
    expect(q.presses, '结束之后的按下不该再涨').toBe(1)
  })

  it('满血按 20 下脱离（100 血 × 5% = 5/下）', () => {
    const q = qte()
    let hp = 100
    let presses = 0
    while (q.outcome === 'ongoing' && presses < 100) {
      const r = q.press(hp)
      hp -= r.damage
      presses++
    }
    expect(presses).toBe(20)
    expect(q.outcome).toBe('escaped')
  })
})

describe('GrabQte — 咬人节拍', () => {
  it('到点咬一口，伤害是派生好的那个数', () => {
    const q = qte()
    expect(q.tick(3999)).toEqual({ bite: false, damage: 0, timedOut: false })
    expect(q.tick(4000)).toEqual({ bite: true, damage: 17, timedOut: false })
    expect(q.bites).toBe(1)
  })

  it('**不追赶**：一帧跨过好几个节拍，也只咬一口', () => {
    // 这一条要跨过两个节拍（4000 / 8000），所以把兜底上限放到 60 秒 ——
    // 默认的 8000 会在 8 秒那一刻判超时（那是另一条测试的事）
    const q = qte({ hardLimitMs: 60000 })
    q.tick(4000)
    // 模拟一次长卡顿：直接跳到 13 秒（本该是第 2、3 口的时间）
    expect(q.tick(13000).bite).toBe(true)
    expect(q.bites).toBe(2)
    // 下一口从**实际**咬到的时刻起算，不是从本该咬的时刻
    expect(q.tick(16000).bite).toBe(false)
    expect(q.tick(17000).bite).toBe(true)
  })

  it('倒计时读数按真实时刻走（表现层画头顶那行红字用它）', () => {
    const q = qte()
    expect(q.msUntilNextBite(0)).toBe(4000)
    expect(q.msUntilNextBite(1500)).toBe(2500)
    expect(q.msUntilNextBite(9999), '过期不返回负数').toBe(0)
  })

  it('硬上限到点直接结束（兜底：抓取一定要能解开）', () => {
    const q = qte()
    expect(q.tick(7999).timedOut).toBe(false)
    const r = q.tick(8000)
    expect(r.timedOut).toBe(true)
    expect(q.outcome).toBe('timeout')
    expect(q.tick(12000), '结束之后不再咬人').toEqual({ bite: false, damage: 0, timedOut: false })
  })

  it('参数不合法当场抛（免得配出「永远解不开的抓取」）', () => {
    expect(() => qte({ pressDamage: 0 })).toThrow()
    expect(() => qte({ biteIntervalMs: 0 })).toThrow()
    expect(() => qte({ hardLimitMs: 0 })).toThrow()
  })
})
