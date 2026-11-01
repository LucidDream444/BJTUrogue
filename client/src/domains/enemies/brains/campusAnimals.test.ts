import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateEnemies } from '@/core/config'
import { EnemyFixture, makePlayerSnapshot, makeSpec } from '../testSupport'
import { makeMuscovyBrain, finishMuscovyAttack } from './MuscovyBrain'
import { makeVortexCatBrain } from './VortexCatBrain'

const cfg = validateEnemies(JSON.parse(readFileSync('public/config/enemies.json', 'utf8'))).enemies
describe('校园动物攻击阶段', () => {
  it('蓄力开始锁向，玩家移动/丢失不追踪，冷却从实际结束算起', () => {
    const player = makePlayerSnapshot(50, 0)
    const duck = new EnemyFixture({ kind: 'muscovy', target: player, brain: (model) => makeMuscovyBrain(model, cfg.muscovy) })
    duck.step()
    expect(duck.model.state).toBe('windup')
    player.x = 0; player.y = 5000; player.alive = false
    duck.step(cfg.muscovy.charge.windupMs)
    expect(duck.model.state).toBe('dash')
    expect(duck.vx).toBe(cfg.muscovy.charge.dashSpeed)
    expect(duck.vy).toBe(0)
    finishMuscovyAttack(duck.model, cfg.muscovy.charge, duck.nowMs)
    const ended = duck.nowMs
    expect(duck.model.attackReadyAtMs).toBe(ended + cfg.muscovy.charge.cooldownMs)
    player.alive = true; player.x = duck.x + 20; player.y = duck.y
    duck.step(cfg.muscovy.charge.recoverMs)
    expect(duck.model.state).toBe('cooldown')
    duck.step(Math.max(0, duck.model.attackReadyAtMs - duck.nowMs))
    expect(duck.model.state).toBe('windup')
  })
  it('目标重合使用有效回退方向，冲刺期正常受伤和死亡，出生清空旧阶段', () => {
    const duck = new EnemyFixture({ kind: 'muscovy', target: makePlayerSnapshot(0, 0), brain: (model) => makeMuscovyBrain(model, cfg.muscovy) })
    duck.step(); duck.step(cfg.muscovy.charge.windupMs)
    expect(Number.isFinite(duck.vx + duck.vy)).toBe(true)
    const hit = duck.model.takeHit({ sourceId: 600, hitKey: 'shot', mode: 'instant', sourceKind: 'bullet', amount: 1, nowMs: duck.nowMs, frameId: 1 })
    expect(hit.applied).toBe(1)
    duck.model.takeHit({ sourceId: 601, hitKey: 'fatal', mode: 'instant', sourceKind: 'bullet', amount: 999, nowMs: duck.nowMs, frameId: 2 })
    duck.step()
    expect(duck.vx).toBe(0)
    duck.model.attackSourceId = 90; duck.model.dashTravelled = 99
    duck.model.respawn(makeSpec('muscovy'), duck.nowMs)
    expect(duck.model.attackSourceId).toBe(0)
    expect(duck.model.dashTravelled).toBe(0)
    expect(duck.model.state).toBe('chase')
  })
  it('猫蓄力后保持固定圆心，不因目标离开而追踪，旋转完成才计冷却', () => {
    const player = makePlayerSnapshot(20, 0)
    const cat = new EnemyFixture({ kind: 'nightmare_cat', target: player, brain: (model) => makeVortexCatBrain(model, cfg.nightmare_cat) })
    cat.step(); cat.step(cfg.nightmare_cat.vortex.windupMs)
    expect(cat.model.state).toBe('spin')
    const center = [cat.x, cat.y]
    player.x = 5000; player.alive = false
    cat.step(cfg.nightmare_cat.vortex.durationMs - 1)
    expect([cat.x, cat.y]).toEqual(center)
    expect(cat.model.state).toBe('spin')
    cat.step(1)
    expect(cat.model.state).toBe('recover')
    expect(cat.model.attackReadyAtMs).toBe(cat.nowMs + cfg.nightmare_cat.vortex.cooldownMs)
  })
})
