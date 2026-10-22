import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateEnemies } from '@/core/config'
import { EnemyFixture, makePlayerSnapshot } from '../testSupport'
import { makeSprayerBrain, type SprayAttack } from './SprayerBrain'

const cfg = validateEnemies(JSON.parse(readFileSync('public/config/enemies.json', 'utf8'))).enemies
  .sprayer
const fixture = (target = makePlayerSnapshot(250, 0)) =>
  new EnemyFixture({
    kind: 'sprayer',
    target,
    brain: (model) => makeSprayerBrain(model, cfg),
  })

describe('喷洒怪：追踪、锁定落点、前摇、喷洒与恢复', () => {
  it('预警锁定旧落点，玩家可以走出预警；每次前摇只喷一轮', () => {
    const target = makePlayerSnapshot(250, 0),
      f = fixture(target)
    expect(f.step().nextState).toBe('windup')
    target.x = 600
    f.step(cfg.spray.windupMs - 1)
    expect(f.lastAttack).toBeUndefined()
    const attack = f.step(1).attack as SprayAttack
    expect([attack.kind, attack.x, attack.y]).toEqual(['spray', 250, 0])
    expect(f.model.state).toBe('recover')
    expect(f.step(0).attack).toBeUndefined()
    f.step(cfg.spray.recoverMs)
    expect(f.model.state).toBe('chase')
    expect(f.lastAttack).toBeUndefined()
  })

  it('逻辑时间停走时不提前喷；前摇中死亡取消喷洒', () => {
    const f = fixture()
    f.step()
    for (let i = 0; i < 50; i++) expect(f.step(0).attack).toBeUndefined()
    f.model.despawn()
    expect(f.step(cfg.spray.windupMs).attack).toBeUndefined()
  })

  it('目标超出射程时追击，冷却期间保持距离，不生成隐形近战', () => {
    const f = fixture(makePlayerSnapshot(cfg.spray.range + 50, 0))
    expect(f.step().vx).toBeGreaterThan(0)
    expect(f.lastAttack).toBeUndefined()
    const close = fixture(makePlayerSnapshot(cfg.spray.keepDistance - 10, 0))
    close.model.slamReadyAtMs = 10000
    expect(close.step().vx).toBe(0)
    expect(close.lastAttack).toBeUndefined()
  })

  it('被墙挡住时先绕墙，不透墙起手', () => {
    const f = new EnemyFixture({
      kind: 'sprayer',
      target: makePlayerSnapshot(100, 0),
      nav: { hasLineOfSight: () => false, dirAt: () => ({ x: 0, y: 1 }) },
      brain: (model) => makeSprayerBrain(model, cfg),
    })
    expect(f.step().vy).toBeGreaterThan(0)
    expect(f.model.state).toBe('chase')
    expect(f.lastAttack).toBeUndefined()
  })

  it('恢复结束仍等待冷却到点，池化重生不带旧落点', () => {
    const f = fixture()
    f.step()
    f.step(cfg.spray.windupMs)
    f.step(cfg.spray.recoverMs)
    expect(f.model.state).toBe('chase')
    f.step(cfg.spray.cooldownMs - cfg.spray.windupMs - cfg.spray.recoverMs)
    expect(f.model.state).toBe('windup')
    f.model.sprayX = 999
    // 复用相同模板时模型出生接口负责清零，不靠脑闭包记住旧值。
    f.model.respawn(
      {
        kind: 'sprayer',
        gen: 0,
        stats: f.model.stats,
        pierceImmune: false,
        graceMs: 0,
        graceMoveMult: 1,
        flinchMs: 0,
        slowPerHit: 0,
        slowMaxStacks: 0,
        slowDurationMs: 0,
        slowMultPerStack: 1,
        minSpeedMult: 1,
        vulnerableMult: 1,
        windupMoveMult: 0,
      },
      0,
    )
    expect([f.model.sprayX, f.model.sprayY]).toEqual([0, 0])
  })
})
