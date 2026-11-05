import { describe, expect, it } from 'vitest'
import { BossHazards, type BossHazardCommand, type BossHazardUnit } from './BossHazards'

const unit = (id = 1, changes: Partial<BossHazardUnit> = {}): BossHazardUnit =>
  ({ id, x: 0, y: 0, radius: 10, alive: true, player: true, ...changes })

const acid = { x: 0, y: 0, radius: 50, damage: 7, tickMs: 250, activatesMs: 0, expiresMs: 2000, sourceId: 99 }
const water = { x: 0, y: 0, radius: 50, speed: 100, activatesMs: 0, expiresMs: 2000, sourceId: 99 }
const line = { x1: 0, y1: 0, x2: 100, y2: 0, width: 20, damage: 12, activatesMs: 0, expiresMs: 2000, sourceId: 99 }
const slam = { x: 0, y: 0, radius: 50, damage: 25, stunMs: 600, activatesMs: 500, expiresMs: 900, sourceId: 99 }

function damage(commands: readonly BossHazardCommand[]) {
  return commands.filter((command) => command.type === 'damage')
}

function moves(commands: readonly BossHazardCommand[]) {
  return commands.filter((command) => command.type === 'move')
}

describe('首领酸液的时间与命中', () => {
  it.each([30, 60, 144])('%i Hz 下独立目标都受到相同的八跳伤害', (fps) => {
    const hazards = new BossHazards()
    hazards.addAcid(acid)
    const hits: BossHazardCommand[] = []
    for (let frame = 0; frame <= fps * 2; frame++)
      hits.push(...hazards.update(frame * 1000 / fps, 1000 / fps, [unit(1), unit(2, { player: false })]))
    expect(damage(hits).filter((hit) => hit.id === 1).map((hit) => hit.damage)).toEqual(Array(8).fill(7))
    expect(damage(hits).filter((hit) => hit.id === 2).map((hit) => hit.damage)).toEqual(Array(8).fill(7))
    expect(hazards.snapshot).toHaveLength(0)
  })

  it('同一时间槽重复调用、重复实体快照和退出后重入均不重复伤害', () => {
    const hazards = new BossHazards()
    hazards.addAcid(acid)
    expect(damage(hazards.update(0, 16, [unit(), unit()]))).toHaveLength(1)
    expect(hazards.update(100, 16, [unit(1, { x: 100 })])).toEqual([])
    expect(hazards.update(200, 16, [unit()])).toEqual([])
    expect(damage(hazards.update(250, 16, [unit()]))).toHaveLength(1)
  })

  it('预警期不伤害，激活瞬间伤害，到期瞬间移除', () => {
    const hazards = new BossHazards()
    hazards.addAcid({ ...acid, activatesMs: 500, expiresMs: 1000 })
    expect(hazards.update(499, 16, [unit()])).toEqual([])
    expect(damage(hazards.update(500, 16, [unit()]))).toHaveLength(1)
    expect(hazards.update(1000, 16, [unit()])).toEqual([])
    expect(hazards.snapshot).toEqual([])
  })

  it('长帧只结算当前时间槽，不补发错过的伤害', () => {
    const hazards = new BossHazards()
    hazards.addAcid(acid)
    hazards.update(0, 16, [unit()])
    expect(damage(hazards.update(1750, 1750, [unit()]))).toHaveLength(1)
    expect(hazards.update(1750, 0, [unit()])).toEqual([])
  })

  it('边缘按目标半径计算，死者和施法者不会受伤', () => {
    const hazards = new BossHazards()
    hazards.addAcid(acid)
    expect(damage(hazards.update(0, 16, [
      unit(1, { x: 60 }), unit(2, { x: 60.01 }), unit(3, { alive: false }), unit(99),
    ])).map((hit) => hit.id)).toEqual([1])
  })

  it('新目标进入当前时间槽仍能受伤，旧目标出生序号变化也不继承旧账本', () => {
    const hazards = new BossHazards()
    hazards.addAcid(acid)
    hazards.update(0, 16, [unit(1, { spawnSeq: 1 })])
    expect(damage(hazards.update(100, 16, [unit(1, { spawnSeq: 2 }), unit(2)]))
      .map((hit) => hit.id)).toEqual([1, 2])
  })

  it('相互重叠的酸池各有独立伤害标记', () => {
    const hazards = new BossHazards()
    hazards.addAcid(acid)
    hazards.addAcid(acid)
    const hits = damage(hazards.update(0, 16, [unit()]))
    expect(hits).toHaveLength(2)
    expect(new Set(hits.map((hit) => hit.hitKey)).size).toBe(2)
  })

  it('只影响玩家的酸液不会伤害其他怪物，允许显式影响施法者', () => {
    const hazards = new BossHazards()
    hazards.addAcid({ ...acid, affects: 'player', includeSource: true })
    expect(damage(hazards.update(0, 16, [unit(1), unit(2, { player: false }), unit(99)]))
      .map((hit) => hit.id)).toEqual([1, 99])
  })
})

describe('首领水面的滑行', () => {
  it('以进入水面时的速度方向锁定，改按其他方向也继续原方向滑行', () => {
    const hazards = new BossHazards()
    hazards.addWater(water)
    expect(moves(hazards.update(0, 10, [unit(1, { vx: 3, vy: 4 })]))).toEqual([
      { type: 'move', id: 1, x: 0.6, y: 0.8, vx: 60, vy: 80 },
    ])
    expect(moves(hazards.update(10, 10, [unit(1, { x: 0.6, y: 0.8, vx: -3, vy: -4 })]))[0])
      .toMatchObject({ x: 1.2, y: 1.6, vx: 60, vy: 80 })
  })

  it('离开后释放方向，再次进入使用新的方向', () => {
    const hazards = new BossHazards()
    hazards.addWater(water)
    hazards.update(0, 10, [unit(1, { vx: 1 })])
    expect(hazards.update(10, 10, [unit(1, { x: 100, vx: -1 })])).toEqual([])
    expect(moves(hazards.update(20, 10, [unit(1, { vx: -1 })]))[0])
      .toMatchObject({ x: -1, y: 0, vx: -100, vy: 0 })
  })

  it('仍在水内时持续锁定方向，不会在1.5秒后自动解除', () => {
    const hazards = new BossHazards()
    hazards.addWater({ ...water, expiresMs: 5000 })
    hazards.update(0, 10, [unit(1, { vx: 1 })])
    expect(moves(hazards.update(3000, 10, [unit(1, { vx: -1 })]))[0])
      .toMatchObject({ vx: 100, vy: 0 })
  })

  it('没有速度数据时可根据进入前后的实际位移确定方向', () => {
    const hazards = new BossHazards()
    hazards.addWater(water)
    hazards.update(0, 16, [unit(1, { x: -100 })])
    expect(moves(hazards.update(16, 10, [unit(1, { x: -40 })]))[0])
      .toMatchObject({ x: -39, vx: 100, vy: 0 })
  })

  it('显式速度优先于位移；静止进入先等待首次移动', () => {
    const hazards = new BossHazards()
    hazards.addWater(water)
    expect(hazards.update(0, 16, [unit()])).toEqual([])
    expect(moves(hazards.update(16, 10, [unit(1, { x: 5, vx: 0, vy: -2 })]))[0])
      .toMatchObject({ x: 5, y: -1, vx: 0, vy: -100 })
  })

  it('重叠水面每个实体每帧只移动一次，到期后保持方向交给另一水面', () => {
    const hazards = new BossHazards()
    hazards.addWater({ ...water, speed: 100, expiresMs: 500 })
    hazards.addWater({ ...water, speed: 200, expiresMs: 1000 })
    expect(moves(hazards.update(0, 10, [unit(1, { vx: 1 }), unit(1, { vx: 1 })]))).toHaveLength(1)
    expect(moves(hazards.update(500, 10, [unit(1, { vx: 0, vy: 1 })]))[0])
      .toMatchObject({ x: 2, y: 0, vx: 200, vy: 0 })
  })

  it('长帧移动按1/30秒钳制，零delta不产生位移指令', () => {
    const hazards = new BossHazards()
    hazards.addWater({ ...water, speed: 300 })
    expect(moves(hazards.update(0, 10000, [unit(1, { vx: 1 })]))[0].x).toBe(10)
    expect(hazards.update(0, 0, [unit(1, { vx: 1 })])).toEqual([])
  })

  it('死者、只影响敌人的筛选和水面到期都能停止滑行', () => {
    const hazards = new BossHazards()
    hazards.addWater({ ...water, affects: 'enemies' })
    expect(moves(hazards.update(0, 10, [unit(1, { vx: 1 }), unit(2, { player: false, vx: 1 })]))
      .map((move) => move.id)).toEqual([2])
    expect(hazards.update(10, 10, [unit(2, { player: false, vx: 1, alive: false })])).toEqual([])
    expect(hazards.update(2000, 10, [unit(2, { player: false, vx: 1 })])).toEqual([])
  })
})

describe('瞬移连线的胶囊形命中', () => {
  it('完整线宽加目标半径，线外、端点之外和退化线段都有正确边界', () => {
    const hazards = new BossHazards()
    hazards.addLine(line)
    expect(damage(hazards.update(0, 16, [
      unit(1, { x: 50, y: 20 }), unit(2, { x: 50, y: 20.01 }),
      unit(3, { x: 120 }), unit(4, { x: 120.01 }),
    ])).map((hit) => hit.id)).toEqual([1, 3])
    const point = new BossHazards()
    point.addLine({ ...line, x2: 0 })
    expect(damage(point.update(0, 16, [unit(1, { x: 20 }), unit(2, { x: 20.01 })]))
      .map((hit) => hit.id)).toEqual([1])
  })

  it('默认触碰一次，离开再进入也不会每帧反复扣血', () => {
    const hazards = new BossHazards()
    hazards.addLine(line)
    expect(damage(hazards.update(0, 16, [unit()]))).toHaveLength(1)
    hazards.update(100, 16, [unit(1, { y: 100 })])
    expect(hazards.update(500, 16, [unit()])).toEqual([])
  })

  it('明确配置节拍时按时间槽结算，预警与到期边界也有效', () => {
    const hazards = new BossHazards()
    hazards.addLine({ ...line, activatesMs: 500, expiresMs: 1000, tickMs: 250 })
    expect(hazards.update(499, 16, [unit()])).toEqual([])
    expect(damage(hazards.update(500, 16, [unit(), unit()]))).toHaveLength(1)
    expect(hazards.update(749, 16, [unit()])).toEqual([])
    expect(damage(hazards.update(750, 16, [unit()]))).toHaveLength(1)
    expect(hazards.update(1000, 16, [unit()])).toEqual([])
  })
})

describe('首领落地AOE与生命周期', () => {
  it('预警后落地命中范围内单位一次并给出晕眩结束时间', () => {
    const hazards = new BossHazards()
    hazards.addSlam(slam)
    expect(hazards.update(499, 16, [unit()])).toEqual([])
    const commands = hazards.update(500, 16, [unit(), unit(2, { x: 60 }), unit(3, { x: 60.01 })])
    expect(damage(commands).map((hit) => hit.id)).toEqual([1, 2])
    expect(commands.filter((command) => command.type === 'stun')).toEqual([
      { type: 'stun', id: 1, sourceId: 99, untilMs: 1100 },
      { type: 'stun', id: 2, sourceId: 99, untilMs: 1100 },
    ])
    expect(hazards.update(501, 16, [unit(), unit(4)])).toEqual([])
    expect(hazards.snapshot).toHaveLength(1)
    expect(hazards.update(900, 16, [unit()])).toEqual([])
    expect(hazards.snapshot).toEqual([])
  })

  it('立即落地去重目标，不对范围外、死者和施法者结算', () => {
    const hazards = new BossHazards()
    const commands = hazards.slam(slam, 1000, [unit(), unit(), unit(2, { alive: false }), unit(3, { x: 100 }), unit(99)])
    expect(damage(commands)).toHaveLength(1)
    expect(commands).toContainEqual({ type: 'stun', id: 1, sourceId: 99, untilMs: 1600 })
    expect(hazards.snapshot).toEqual([])
  })

  it('零伤害仍可晕眩，零晕眩时间不产生多余指令', () => {
    const hazards = new BossHazards()
    expect(hazards.slam({ ...slam, damage: 0 }, 0, [unit()])).toEqual([
      { type: 'stun', id: 1, sourceId: 99, untilMs: 600 },
    ])
    expect(damage(hazards.slam({ ...slam, stunMs: 0 }, 0, [unit()]))).toHaveLength(1)
  })

  it('移除单个来源、单个效果与清房清理不会误伤其他来源', () => {
    const hazards = new BossHazards()
    const id = hazards.addAcid(acid)
    hazards.addLine({ ...line, sourceId: 100 })
    hazards.addWater(water)
    hazards.remove(id)
    expect(hazards.snapshot.map((field) => field.kind)).toEqual(['line', 'water'])
    hazards.removeSource(99)
    expect(hazards.snapshot.map((field) => field.sourceId)).toEqual([100])
    hazards.clear()
    expect(hazards.update(0, 16, [unit(1, { vx: 1 })])).toEqual([])
    expect(hazards.snapshot).toEqual([])
  })

  it('快照冻结且保留游戏时间，供表现层读取预警进度', () => {
    const hazards = new BossHazards()
    hazards.update(100, 16, [])
    hazards.addSlam(slam)
    expect(hazards.snapshot[0]).toMatchObject({ kind: 'slam', createdMs: 100, activatesMs: 500, expiresMs: 900 })
    expect(Object.isFrozen(hazards.snapshot[0])).toBe(true)
  })

  it('拒绝零伤害节拍、负半径和无效持续期，避免无限循环或永久技能', () => {
    const hazards = new BossHazards()
    expect(() => hazards.addAcid({ ...acid, tickMs: 0 })).toThrow(RangeError)
    expect(() => hazards.addWater({ ...water, radius: -1 })).toThrow(RangeError)
    expect(() => hazards.addLine({ ...line, expiresMs: Infinity })).toThrow(RangeError)
    expect(() => hazards.addSlam({ ...slam, expiresMs: 500 })).toThrow(RangeError)
  })
})
