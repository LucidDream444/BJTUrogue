import { describe, expect, it } from 'vitest'
import { BossReinforcements } from './BossReinforcements'

const CONFIG = { cooldownMs: 8_000, spawnCount: 2, maxAlive: 6 }

describe('首领房补怪调度', () => {
  it('首次检测到存活首领后等待完整冷却，到期最多补两只', () => {
    const scheduler = new BossReinforcements(CONFIG)
    expect(scheduler.update(1_000, true, 0)).toBe(0)
    expect(scheduler.update(8_999, true, 0)).toBe(0)
    expect(scheduler.update(9_000, true, 0)).toBe(2)
    expect(scheduler.update(9_000, true, 0)).toBe(0)
    expect(scheduler.update(16_999, true, 0)).toBe(0)
    expect(scheduler.update(17_000, true, 0)).toBe(2)
  })

  it('活着与等待生成的小怪一起占名额，场上最多六只', () => {
    const scheduler = new BossReinforcements(CONFIG)
    scheduler.update(0, true, 0)
    expect(scheduler.update(8_000, true, 5)).toBe(1)
    expect(scheduler.update(16_000, true, 6)).toBe(0)
    expect(scheduler.update(24_000, true, 9)).toBe(0)
    expect(scheduler.update(32_000, true, 4)).toBe(2)
  })

  it('满槽时消耗这次机会，小怪刚死亡不会立刻补一波', () => {
    const scheduler = new BossReinforcements(CONFIG)
    scheduler.update(0, true, 6)
    expect(scheduler.update(8_000, true, 6)).toBe(0)
    expect(scheduler.update(8_001, true, 0)).toBe(0)
    expect(scheduler.update(16_000, true, 0)).toBe(2)
  })

  it('跳过很长游戏时间只补一批，后续冷却从当前时间算，不追赶错过波次', () => {
    const scheduler = new BossReinforcements(CONFIG)
    scheduler.update(0, true, 0)
    expect(scheduler.update(100_000, true, 0)).toBe(2)
    expect(scheduler.update(100_000, true, 2)).toBe(0)
    expect(scheduler.update(107_999, true, 2)).toBe(0)
    expect(scheduler.update(108_000, true, 2)).toBe(2)
  })

  it('暂停期间游戏时间不前进，不受重复update次数或现实经过多久影响', () => {
    const scheduler = new BossReinforcements(CONFIG)
    scheduler.update(0, true, 0)
    for (let i = 0; i < 100; i++) expect(scheduler.update(4_000, true, 0)).toBe(0)
    expect(scheduler.update(7_999, true, 0)).toBe(0)
    expect(scheduler.update(8_000, true, 0)).toBe(2)
  })

  it('最后一只首领死亡立即停止；再次开始一场首领战重新等完整冷却', () => {
    const scheduler = new BossReinforcements(CONFIG)
    scheduler.update(0, true, 0)
    expect(scheduler.update(8_000, false, 0)).toBe(0)
    expect(scheduler.update(20_000, false, 0)).toBe(0)
    expect(scheduler.update(30_000, true, 0)).toBe(0)
    expect(scheduler.update(37_999, true, 0)).toBe(0)
    expect(scheduler.update(38_000, true, 0)).toBe(2)
  })

  it('离开或重置房间会清除计时，哪怕新房间同样有首领', () => {
    const scheduler = new BossReinforcements(CONFIG)
    scheduler.update(0, true, 0)
    scheduler.reset()
    expect(scheduler.update(7_000, true, 0)).toBe(0)
    expect(scheduler.update(14_999, true, 0)).toBe(0)
    expect(scheduler.update(15_000, true, 0)).toBe(2)
    scheduler.reset()
    // 新的一局时钟可以从零重新开始。
    expect(scheduler.update(0, true, 0)).toBe(0)
    expect(scheduler.update(8_000, true, 0)).toBe(2)
  })

  it('冷却、每批数量和上限全部由配置决定', () => {
    const scheduler = new BossReinforcements({ cooldownMs: 500, spawnCount: 3, maxAlive: 4 })
    expect(scheduler.update(0, true, 0)).toBe(0)
    expect(scheduler.update(499, true, 0)).toBe(0)
    expect(scheduler.update(500, true, 0)).toBe(3)
    expect(scheduler.update(1_000, true, 3)).toBe(1)
    expect(scheduler.update(1_500, true, 4)).toBe(0)
  })
})
