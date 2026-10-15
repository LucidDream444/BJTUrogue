import { describe, it, expect } from 'vitest'
import { GameClock } from '@/core/time'
import type { HitRequest } from '@/core/actor/damage'
import { PlayerModel } from './PlayerModel'

function setup() {
  const clock = new GameClock()
  const player = new PlayerModel({ maxHp: 200, speed: 200, radius: 12 }, clock, 180, 100)
  player.iframeMs = 500
  const hit = (amount: number, key = 'contact') =>
    player.takeHit({
      sourceId: 99,
      hitKey: key,
      mode: 'instant',
      sourceKind: 'contact',
      amount,
      frameId: clock.frameId,
      nowMs: clock.nowMs,
    } satisfies HitRequest)
  return { player, clock, hit }
}

describe('player shield resource', () => {
  it('signals a hit even when the shield absorbs it, and does not signal invulnerable hits', () => {
    const { player, clock, hit } = setup()
    const feedback: Array<[number, number]> = []
    player.onHurt = (_req, hp, shield) => feedback.push([hp, shield])
    hit(2)
    expect(feedback).toEqual([[0, 2]])
    expect(player.hurtAtMs).toBe(clock.nowMs)
    hit(2)
    expect(feedback).toHaveLength(1)
    clock.advance(500)
    hit(120)
    expect(feedback[1]).toEqual([22, 98])
  })
  it('starts full, absorbs first, then spills only the excess into health', () => {
    const { player, clock, hit } = setup()
    expect([player.hp, player.shield]).toEqual([200, 100])
    expect(hit(80).applied).toBe(0)
    expect([player.hp, player.shield]).toEqual([200, 20])
    clock.advance(500)
    expect(hit(35).applied).toBe(15)
    expect([player.hp, player.shield]).toEqual([185, 0])
    clock.advance(500)
    expect(hit(20).applied).toBe(20)
    expect([player.hp, player.shield]).toEqual([165, 0])
  })
  it('preserves spawn protection, invulnerability, pause and duplicate-hit guards', () => {
    const { player, clock, hit } = setup()
    player.protectedUntilMs = 1000
    hit(20)
    expect(player.shield).toBe(100)
    clock.advance(1000)
    hit(20)
    hit(20)
    expect(player.shield).toBe(80)
    clock.pause()
    clock.advance(2000)
    hit(20)
    expect(player.shield).toBe(80)
    clock.resume()
    clock.advance(500)
    player.iframeMs = 0
    hit(20)
    hit(20)
    expect(player.shield).toBe(60)
  })
  it('time never restores HP or shield; only matching pickups recover them', () => {
    const { player, clock, hit } = setup()
    hit(150)
    expect([player.hp, player.shield]).toEqual([150, 0])
    clock.advance(60000)
    player.syncState(false)
    expect([player.hp, player.shield]).toEqual([150, 0])
    expect(player.restoreFromPickup('shield', 25)).toBe(25)
    expect([player.hp, player.shield]).toEqual([150, 25])
    expect(player.restoreFromPickup('health', 30)).toBe(30)
    expect([player.hp, player.shield]).toEqual([180, 25])
  })
  it('full, invalid, paused and dead pickups cannot waste or overfill resources', () => {
    const { player, clock, hit } = setup()
    expect(player.restoreFromPickup('health', 30)).toBe(0)
    expect(player.restoreFromPickup('shield', 25)).toBe(0)
    hit(130)
    expect(player.restoreFromPickup('health', -10)).toBe(0)
    expect(player.restoreFromPickup('shield', NaN)).toBe(0)
    clock.pause()
    expect(player.restoreFromPickup('health', 30)).toBe(0)
    expect(player.restoreFromPickup('shield', 25)).toBe(0)
    clock.resume()
    expect(player.restoreFromPickup('health', 100)).toBe(30)
    expect(player.restoreFromPickup('shield', 1000)).toBe(100)
    clock.advance(500)
    hit(9999)
    expect(player.restoreFromPickup('health', 200)).toBe(0)
    expect(player.restoreFromPickup('shield', 100)).toBe(0)
  })
  it('increasing the HP limit never secretly heals the player', () => {
    const { player, hit } = setup()
    hit(120)
    player.applyStats(230, 200, 500)
    expect([player.hp, player.maxHp, player.shield]).toEqual([180, 230, 0])
  })
})
