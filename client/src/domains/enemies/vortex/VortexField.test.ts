import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateEnemies } from '@/core/config'
import { vortexPullVelocity, deflectVortexVelocity } from '@/core/vortex'
import { VortexField, type VortexDamage, type VortexTarget } from './VortexField'

const cfg = { ...validateEnemies(JSON.parse(readFileSync('public/config/enemies.json', 'utf8'))).enemies.nightmare_cat.vortex, durationMs: 5000, damageTickMs: 100 }
const unit = (id: number, x = 1): VortexTarget => ({ id, spawnSeq: id, x, y: 0, radius: 2, alive: true })
const start = (fields: VortexField, id = 2, owner = 1) => fields.start(id, id + 100, owner, 0, 0, 0, cfg, 5)!
describe('锚定旋风场', () => {
  it('移动猫时事件引用同步圆心，伤害随场移动且保留既有节拍与只读描述', () => {
    const fields = new VortexField(2)
    const started = start(fields)
    const other = start(fields, 3, 5)
    expect(Object.isFrozen(started)).toBe(true)
    const hit: VortexDamage[] = []
    fields.step(0, 0, [unit(6)], (request) => hit.push(request))
    fields.moveOwner(1, cfg.damageRadius * 4, 15)
    expect(fields.snapshots[0]).toBe(started)
    expect([started.x, started.y]).toEqual([cfg.damageRadius * 4, 15])
    expect([other.x, other.y]).toEqual([0, 0])
    fields.step(100, 1, [unit(6), { ...unit(7, started.x), y: started.y }], (request) => hit.push(request))
    expect(hit.filter((request) => request.sourceId === started.sourceId).map((request) => request.targetId)).toEqual([6, 7])
    expect(started.startedAtMs).toBe(0)
    expect(started.endsAtMs).toBe(cfg.durationMs)
    expect(fields.removeOwner(1)).toEqual([started])
    expect(fields.snapshots).toEqual([other])
  })
  it('30/60/144Hz同样刻度数量，不受8跳上限或接触TTL截断', () => {
    const counts = [30, 60, 144].map((hz) => {
      const fields = new VortexField(4); start(fields)
      let count = 0
      for (let frame = 0; frame < hz * 5; frame++) fields.step(frame * 1000 / hz, frame, [unit(9)], () => count++)
      return count
    })
    expect(counts).toEqual([50, 50, 50])
  })
  it('所有其他单位各结算，排除自身，圆形距离不因隔墙变化', () => {
    const fields = new VortexField(4); start(fields)
    const requests: VortexDamage[] = []
    fields.step(0, 0, [unit(1), unit(2), unit(3), unit(4, cfg.damageRadius + 3)], (r) => requests.push(r))
    expect(requests.map((r) => r.targetId)).toEqual([2, 3])
    expect(requests.every((r) => r.mode === 'tick' && r.sourceKind === 'aoe')).toBe(true)
  })
  it('离开即停，重新进入等公共刻度；长帧只跳一次且同帧配对限一次', () => {
    const fields = new VortexField(4); start(fields)
    let count = 0
    const apply = () => count++
    fields.step(0, 1, [unit(3)], apply)
    fields.step(100, 2, [unit(3, 10000)], apply)
    fields.step(150, 3, [unit(3)], apply)
    expect(count).toBe(1)
    fields.step(200, 4, [unit(3)], apply)
    fields.step(1000, 4, [unit(3)], apply)
    expect(count).toBe(2)
    fields.step(4000, 5, [unit(3)], apply)
    expect(count).toBe(3)
  })
  it('一个来源死亡可即时阻止其后续配对，不误删别的场；清场与重生隔离', () => {
    const fields = new VortexField(2); start(fields, 2, 1); start(fields, 3, 5)
    const requests: VortexDamage[] = []
    fields.step(0, 0, [unit(6), unit(7)], (r) => { requests.push(r); if (r.sourceId === 102) fields.removeOwner(1) })
    expect(requests.map((r) => r.sourceId)).toEqual([102, 103, 103])
    expect(fields.snapshots).toHaveLength(1)
    fields.clear()
    expect(fields.snapshots).toHaveLength(0)
    start(fields, 4, 1)
    fields.step(0, 0, [{ ...unit(6), spawnSeq: 66 }], (r) => requests.push(r))
    expect(requests.at(-1)?.targetSpawnSeq).toBe(66)
  })
  it('零距离安全，多场稳定顺序合成有上限，偏转保持速率', () => {
    const fields = new VortexField(4); const a = start(fields, 2), b = start(fields, 3, 5)
    expect(vortexPullVelocity({ x: 0, y: 0 }, [a])).toEqual({ x: 0, y: 0 })
    const point = { x: 10, y: 0 }
    const pull = vortexPullVelocity(point, [a, b])
    expect(pull).toEqual(vortexPullVelocity(point, [b, a]))
    expect(Math.hypot(pull.x, pull.y)).toBeLessThanOrEqual(cfg.maxPullSpeed)
    const velocity = deflectVortexVelocity(point, { x: 100, y: 0 }, [a, b], 0.1)
    expect(velocity).toEqual(deflectVortexVelocity(point, { x: 100, y: 0 }, [b, a], 0.1))
    expect(Math.hypot(velocity.x, velocity.y)).toBeCloseTo(100)
    expect(Math.abs(Math.atan2(velocity.y, velocity.x))).toBeLessThanOrEqual(cfg.maxTurnRateRadPerSec * 0.1)
  })
})
