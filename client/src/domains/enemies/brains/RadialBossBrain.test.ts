import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { validateEnemies } from '@/core/config'
import { EnemyFixture, makePlayerSnapshot } from '../testSupport'
import { makeRadialBossBrain } from './RadialBossBrain'

const cfg = validateEnemies(
  JSON.parse(readFileSync('public/config/enemies.json', 'utf8')),
).stage2Boss
const fixture = (x = 350) =>
  new EnemyFixture({
    kind: 'tank',
    target: makePlayerSnapshot(x, 0),
    brain: (model) => makeRadialBossBrain(model, cfg),
  })

describe('second-stage ranged boss', () => {
  it('starts a stationary windup at range, releases once, and observes recovery/cooldown', () => {
    const f = fixture()
    expect(f.step().nextState).toBe('windup')
    expect(f.x).toBe(0)
    f.step(cfg.windupMs - 1)
    expect(f.lastAttack).toBeUndefined()
    expect(f.step(1).attack?.kind).toBe('radial')
    expect(f.model.state).toBe('recover')
    expect(f.step(0).attack).toBeUndefined()
    f.step(cfg.recoverMs)
    expect(f.model.state).toBe('chase')
    expect(f.lastAttack).toBeUndefined()
    f.step(cfg.cooldownMs - cfg.windupMs - cfg.recoverMs)
    expect(f.model.state).toBe('windup')
  })

  it('does not advance or emit when logical time is stopped', () => {
    const f = fixture()
    f.step()
    for (let i = 0; i < 60; i++) {
      expect(f.step(0).attack).toBeUndefined()
      expect(f.model.state).toBe('windup')
    }
  })

  it('never releases the spell after dying during the windup', () => {
    const f = fixture()
    f.step()
    f.model.despawn()
    expect(f.step(cfg.windupMs).attack).toBeUndefined()
  })

  it('patrols left and right during cooldown without attempting melee attacks', () => {
    const f = fixture(200)
    f.model.slamReadyAtMs = 10000
    const out = f.step()
    expect(out.vx).toBeGreaterThan(0)
    expect(out.vy).toBe(0)
    expect(out.attack).toBeUndefined()
    expect(f.step(cfg.strafeTurnMs).vx).toBeLessThan(0)
  })

  it('turns away from a blocked patrol direction', () => {
    const f = new EnemyFixture({
      kind: 'tank',
      target: makePlayerSnapshot(200, 0),
      nav: { hasLineOfSight: (x0, _y0, x1) => x1 === 200 || x1 < x0, dirAt: () => null },
      brain: (model) => makeRadialBossBrain(model, cfg),
    })
    f.model.slamReadyAtMs = 10000
    expect(f.step().vx).toBeLessThan(0)
  })

  it('moves around blocked sight lines before starting the spell', () => {
    const f = new EnemyFixture({
      kind: 'tank',
      target: makePlayerSnapshot(350, 0),
      nav: { hasLineOfSight: () => false, dirAt: () => ({ x: 0, y: 1 }) },
      brain: (model) => makeRadialBossBrain(model, cfg),
    })
    const out = f.step()
    expect(out.nextState).toBe('chase')
    expect(out.vy).toBeGreaterThan(0)
    expect(out.attack).toBeUndefined()
  })
})
