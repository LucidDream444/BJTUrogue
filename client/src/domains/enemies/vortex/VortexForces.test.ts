import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateEnemies } from '@/core/config'
import { deflectVortexVelocity, type VortexSnapshot } from '@/core/vortex'
import { ChargeSweep, chargeSolidHitTime } from '../charge/ChargeSweep'
import { EnemyModel } from '../model/EnemyModel'
import { makeSpec } from '../testSupport'
import { enemyVortexPull } from './VortexForces'
import { VortexField } from './VortexField'

const cfg = validateEnemies(JSON.parse(readFileSync('public/config/enemies.json', 'utf8'))).enemies.nightmare_cat.vortex

function fieldAt(ownerId: number, x: number, y = 0): VortexSnapshot {
  return new VortexField(1).start(ownerId + 1000, ownerId + 2000, ownerId, x, y, 0, cfg, cfg.damage)!
}

describe('旋风对所有活动单位的外力', () => {
  it('静止意图不妨碍外力，外力也不会改写 AI 意图', () => {
    const unit = new EnemyModel('muscovy')
    unit.respawn(makeSpec('muscovy'), 0)
    unit.velIntent.x = unit.velIntent.y = 0
    const pull = enemyVortexPull(unit.id, { x: cfg.pullRadius / 2, y: 0 }, [fieldAt(unit.id + 1, 0)])
    expect(pull.x).toBeCloseTo(-cfg.pullSpeed / 2)
    expect(pull.y).toBe(0)
    expect(unit.velIntent).toEqual({ x: 0, y: 0 })
  })

  it('猫排除自身旋风，但仍会被其他猫牵引，场结束即停止', () => {
    const own = fieldAt(1, 0)
    const other = fieldAt(2, 180)
    const point = { x: 1, y: 0 }
    expect(enemyVortexPull(1, point, [own])).toEqual({ x: 0, y: 0 })
    expect(enemyVortexPull(1, point, [own, other]).x).toBeGreaterThan(0)
    expect(enemyVortexPull(1, point, [])).toEqual({ x: 0, y: 0 })
  })

  it('双猫的外力按场编号稳定合成，反复计算不积累或改写 AI 意图', () => {
    const fields = [fieldAt(2, 0), fieldAt(3, 10)]
    const point = { x: 20, y: 0 }
    const expected = enemyVortexPull(1, point, fields)
    for (let step = 0; step < 120; step++) {
      const pull = enemyVortexPull(1, point, step % 2 ? fields : [...fields].reverse())
      expect(pull).toEqual(expected)
      expect(Math.hypot(pull.x, pull.y)).toBeLessThanOrEqual(cfg.maxPullSpeed)
    }
  })

  it('偏弹在原圈外的新外圈生效，伤害圈外已有明显拉力', () => {
    const field = fieldAt(1, 0)
    const point = { x: cfg.projectileRadius * 0.8, y: 0 }
    expect(point.x).toBeGreaterThan(cfg.damageRadius)
    const velocity = deflectVortexVelocity(point, { x: -300, y: 0 }, [field], 1 / 60)
    expect(Math.abs(velocity.y)).toBeGreaterThan(0)
    expect(Math.hypot(velocity.x, velocity.y)).toBeCloseTo(300)
    expect(enemyVortexPull(2, point, [field]).x).toBeLessThan(-50)
  })

  it('冲锋与吸力一起扫掠，侧向拉力保留且不能把冲锋单位拉穿薄墙', () => {
    const start = { x: 0, y: 0 }
    const pull = enemyVortexPull(1, start, [fieldAt(2, 0, 100)])
    const end = { x: 620 / 60, y: pull.y / 60 }
    const open = new ChargeSweep(100, 1).sweep(start, end, 2, 440, [])
    expect(open.endpoint.y).toBeGreaterThan(0)
    const blocked = new ChargeSweep(101, 1).sweep(start, end, 2, 440, [], (x0, y0, x1, y1, radius) =>
      chargeSolidHitTime({ x: x0, y: y0 }, { x: x1, y: y1 }, radius, [{ x: 5, y: -10, width: 1, height: 20 }]))
    expect(blocked.stopped).toBe(true)
    expect(blocked.endpoint.x).toBeLessThanOrEqual(3)
    expect(blocked.endpoint.y).toBeGreaterThan(0)
  })
})
