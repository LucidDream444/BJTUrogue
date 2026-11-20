import { describe, expect, it } from 'vitest'
import { GameClock } from '@/core/time'
import { PlayerModel } from './PlayerModel'

function setup() {
  const clock = new GameClock()
  const player = new PlayerModel({ maxHp: 50, speed: 200, radius: 12 }, clock, 100, 5)
  const hit = (amount: number) =>
    player.takeHit({
      sourceId: 1,
      hitKey: 'test',
      mode: 'instant',
      sourceKind: 'contact',
      amount,
      frameId: clock.frameId,
      nowMs: clock.nowMs,
    })
  return { clock, player, hit }
}

describe('passive shield recovery', () => {
  it('stays still during the post-damage delay and then recovers slowly', () => {
    const { player, hit } = setup()
    hit(3)
    expect(player.shield).toBe(2)
    expect(player.advanceShield(3999, 1000, 1, 4000)).toBe(0)
    expect(player.advanceShield(4000, 1000, 1, 4000)).toBe(1)
    expect(player.shield).toBe(3)
    expect(player.advanceShield(5000, 1000, 1, 4000)).toBe(1)
    expect(player.shield).toBe(4)
  })

  it('caps at max shield and does not recover while paused', () => {
    const { clock, player, hit } = setup()
    hit(3)
    clock.pause()
    expect(player.advanceShield(10000, 1000, 10, 0)).toBe(0)
    clock.resume()
    expect(player.advanceShield(10000, 1000, 10, 0)).toBe(3)
    expect(player.shield).toBe(5)
  })

  it('resets the delay on health damage and liquid drain', () => {
    const { clock, player, hit } = setup()
    hit(8)
    expect(player.shield).toBe(0)
    expect(player.advanceShield(3999, 1000, 1, 4000)).toBe(0)
    clock.advance(4000)
    player.takeLiquidDrain(1, 9, clock.frameId, clock.nowMs)
    expect(player.advanceShield(7999, 1000, 1, 4000)).toBe(0)
    expect(player.advanceShield(8000, 1000, 1, 4000)).toBe(1)
  })
})
