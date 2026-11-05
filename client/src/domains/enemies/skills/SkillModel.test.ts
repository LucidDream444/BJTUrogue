import { describe, expect, it } from 'vitest'
import { EnemyModel } from '../model/EnemyModel'
import { makeSpec } from '../testSupport'

describe('boss skill effects on enemy models', () => {
  it('protects all damage paths until the logical deadline', () => {
    const model = new EnemyModel('tank')
    model.respawn(makeSpec('tank'), 0)
    model.skillInvulnerableUntilMs = 1000
    const request = { sourceId: 999, hitKey: 'hit', sourceKind: 'bullet' as const,
      mode: 'instant' as const, amount: 50, nowMs: 999, frameId: 1 }
    expect(model.takeHit(request).applied).toBe(0)
    expect(model.hp).toBe(100)
    expect(model.takeHit({ ...request, nowMs: 1000, frameId: 2 }).applied).toBe(50)
  })
  it('heals living units and emits normal death once without allowing snapshot resurrection', () => {
    const model = new EnemyModel('tank')
    model.respawn(makeSpec('tank'), 0)
    let kills = 0
    model.sink = { onDamaged() {}, onKilled() { kills++ } }
    expect(model.setHealthFromSkill(20, 0, 1)).toBe(true)
    expect(model.setHealthFromSkill(1000, 0, 1)).toBe(true)
    expect(model.hp).toBe(model.maxHp)
    expect(model.setHealthFromSkill(0, 0, 1)).toBe(true)
    expect(kills).toBe(1)
    expect(model.setHealthFromSkill(100, 1, 2)).toBe(false)
    expect(kills).toBe(1)
    expect(model.alive).toBe(false)
  })
  it('temporary speed, stun, invulnerability, and scripted control never leak through pooling', () => {
    const model = new EnemyModel('tank')
    const spec = makeSpec('tank')
    model.respawn(spec, 0)
    model.skillSpeedMultiplier = 2
    model.skillSpeedUntilMs = 1000
    expect(model.speedNow(500)).toBe(spec.stats.speed * 2)
    expect(model.speedNow(1000)).toBe(spec.stats.speed)
    model.skillStunnedUntilMs = 1000
    expect(model.speedNow(500)).toBe(0)
    model.skillControlledUntilMs = model.skillInvulnerableUntilMs = 2000
    model.skillRallyUntilMs = 3000
    model.skillStationary = true
    model.respawn(spec, 10)
    expect(model.skillInvulnerableUntilMs).toBe(0)
    expect(model.skillStunnedUntilMs).toBe(0)
    expect(model.skillControlledUntilMs).toBe(0)
    expect(model.skillRallyUntilMs).toBe(0)
    expect(model.skillStationary).toBe(false)
    expect(model.speedNow(500)).toBe(spec.stats.speed)
  })
})
