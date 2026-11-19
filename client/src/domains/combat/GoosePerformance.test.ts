import { describe, expect, it } from 'vitest'
import {
  GoosePerformance,
  songManaSpend,
  type PerformanceConfig,
} from './GoosePerformance'

function config(overrides: Partial<PerformanceConfig> = {}): PerformanceConfig {
  return {
    beatPeriodMs: 1000,
    beatHitWindowMs: 200,
    songCooldownMs: 200,
    maxStacks: 5,
    stackDurationMs: 4000,
    redDamage: 10,
    redDamagePerStackPct: 20,
    redRadius: 260,
    damageBonusPctPerStack: 6,
    moveSpeedPctPerStack: 4,
    shieldPerStack: 5,
    blueShieldRestore: 2,
    ...overrides,
  }
}

describe('大鹅演奏节拍与叠层', () => {
  it('每首歌消耗固定魔力，最后一首可以扣光剩余值', () => {
    expect(songManaSpend(500, 20)).toBe(20)
    expect(songManaSpend(12, 20)).toBe(12)
    expect(songManaSpend(0, 20)).toBe(0)
    expect(songManaSpend(Number.NaN, 20)).toBe(0)
  })

  it('节拍窗口之前只结算保底红歌，不加层', () => {
    const p = new GoosePerformance(config())
    expect(p.start(0)).toBe(true)
    const hit = p.press('red', 500)
    expect(hit).toMatchObject({
      color: 'red',
      onBeat: false,
      stacks: 0,
      damage: 10,
      radius: 260,
    })
    expect(p.snapshot(500).beatProgress).toBeCloseTo(500 / 800)
  })

  it('实心圆到达右侧后的命中窗内叠层，并按新层数放大红歌伤害', () => {
    const p = new GoosePerformance(config())
    p.start(0)
    expect(p.press('red', 900)).toMatchObject({
      onBeat: true,
      stacks: 1,
      damage: 10,
    })
    expect(p.press('red', 1900)).toMatchObject({
      onBeat: true,
      stacks: 2,
      damage: 12,
    })
    expect(p.snapshot(1900).beatProgress).toBe(1)
  })

  it('红蓝输入各有独立 200ms 冷却，同一帧可以各演奏一次', () => {
    const p = new GoosePerformance(config())
    p.start(0)
    expect(p.press('red', 900)).not.toBeNull()
    expect(p.press('blue', 900)).not.toBeNull()
    expect(p.press('red', 1050)).toBeNull()
    expect(p.press('blue', 1050)).toBeNull()
    expect(p.press('red', 1100)).not.toBeNull()
    expect(p.press('blue', 1100)).not.toBeNull()
  })

  it('最多五层；满层命中仍刷新颜色自己的持续时间', () => {
    const p = new GoosePerformance(config())
    p.start(0)
    for (let i = 0; i < 5; i++) p.press('red', 900 + i * 1000)
    const maxed = p.press('red', 5900)
    expect(maxed).toMatchObject({ onBeat: true, stacks: 5 })
    expect(p.snapshot(5900).redStacks).toBe(5)
  })

  it('演奏不会随时间自动结束；手动停止后红蓝叠层仍独立过期', () => {
    const p = new GoosePerformance(
      config({ stackDurationMs: 4000 }),
    )
    p.start(0)
    p.press('red', 900)
    p.press('blue', 1900)
    expect(p.snapshot(2900)).toMatchObject({
      active: true,
      redStacks: 1,
      blueStacks: 1,
    })
    expect(p.snapshot(4900)).toMatchObject({
      active: true,
      redStacks: 0,
      blueStacks: 1,
    })
    expect(p.snapshot(100000).active).toBe(true)
    p.stop()
    expect(p.snapshot(100000)).toMatchObject({
      active: false,
      redStacks: 0,
      blueStacks: 0,
    })
  })
})
