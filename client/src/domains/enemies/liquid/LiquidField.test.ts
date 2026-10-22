import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { deriveSprayer, parseConfigBundle, validateEnemies } from '@/core/config'
import { ActorModel } from '@/core/actor/ActorModel'
import { LiquidField } from './LiquidField'

const raw = () => JSON.parse(readFileSync('public/config/enemies.json', 'utf8'))
const cfg = validateEnemies(raw()).enemies.sprayer

function setup() {
  const field = new LiquidField(cfg)
  const player = { id: 1, x: 0, y: 0, radius: 12, alive: true }
  let now = 0,
    frame = 0
  const tick = (move: boolean, dt = 20) => {
    now += dt
    if (move) player.x += dt / 10
    return field.step(now, ++frame, player)
  }
  field.spray(9, 0, 0, now, () => true)
  field.step(now, frame, player)
  return { field, player, tick }
}

describe('催化液：拾取、累计静止与移动代价', () => {
  it('踩过即消费，快跑穿过液滩也不会漏拾取', () => {
    const field = new LiquidField(cfg)
    const target = { id: 1, x: -100, y: 0, radius: 12, alive: true }
    field.spray(9, 0, 0, 0, () => true)
    field.step(0, 0, target)
    expect(field.active).toBe(false)
    target.x = 100
    field.step(20, 1, target)
    expect(field.active).toBe(true)
    expect(field.puddles[0]!.active).toBe(false)
    expect(field.sourceId).toBe(9)
  })

  it('静止分两段累计三秒；中间移动不重置进度，也不在静止时扣血', () => {
    const { field, tick } = setup()
    for (let i = 0; i < 75; i++) expect(tick(false)).toBe(0)
    expect(field.stillMs).toBe(1500)
    let damage = 0
    for (let i = 0; i < 50; i++) damage += tick(true)
    expect(damage).toBe(cfg.coating.drainDamage)
    expect(field.stillMs).toBe(1500)
    for (let i = 0; i < 74; i++) tick(false)
    expect(field.active).toBe(true)
    tick(false)
    expect(field.active).toBe(false)
    expect(field.stillMs).toBe(0)
  })

  it('沾液时再次踩液不叠加、不重置静止/移动计时', () => {
    const { field, player, tick } = setup()
    for (let i = 0; i < 50; i++) tick(false)
    field.spray(10, player.x, player.y, 1000, () => true)
    tick(false)
    expect(field.stillMs).toBe(1020)
    expect(field.sourceId).toBe(9)
    expect(field.puddles.filter((p) => p.active && p.x === 0 && p.y === 0)).toHaveLength(0)
  })

  it('移动掉血按累计移动时长，不按帧数或渲染刷新率', () => {
    for (const dt of [10, 20, 25]) {
      const { tick } = setup()
      let damage = 0
      for (let ms = 0; ms < 2000; ms += dt) damage += tick(true, dt)
      expect(damage).toBe(cfg.coating.drainDamage * 2)
    }
  })

  it('累计移动四秒清除，耗血每秒两点并封顶四跳，之后不再扣血', () => {
    const { field, tick } = setup()
    const drains: number[] = []
    for (let i = 0; i < 199; i++) {
      const damage = tick(true)
      if (damage) drains.push(damage)
    }
    expect(field.active).toBe(true)
    expect(field.movingMs).toBe(3980)
    drains.push(tick(true))
    expect(field.active).toBe(false)
    expect(field.movingMs).toBe(0)
    expect(drains).toEqual([2, 2, 2, 2])
    for (let i = 0; i < 100; i++) expect(tick(true)).toBe(0)
  })

  it('移动和静止分别累计，交替走停不会刷新任何一种清除进度', () => {
    const { field, tick } = setup()
    for (let i = 0; i < 100; i++) tick(true)
    for (let i = 0; i < 50; i++) tick(false)
    expect([field.movingMs, field.stillMs]).toEqual([2000, 1000])
    for (let i = 0; i < 99; i++) tick(true)
    expect([field.movingMs, field.stillMs]).toEqual([3980, 1000])
    tick(true)
    expect(field.active).toBe(false)
  })

  it('移动中再次踩液不刷新移动计时和扣血节拍，清除后重新沾液从零开始', () => {
    const { field, player, tick } = setup()
    for (let i = 0; i < 25; i++) tick(true)
    field.spray(10, player.x, player.y, 500, () => true)
    for (let i = 0; i < 24; i++) expect(tick(true)).toBe(0)
    expect(field.movingMs).toBe(980)
    expect(tick(true)).toBe(2)
    field.resetCoating()
    field.spray(11, player.x, player.y, 1000, () => true)
    tick(false)
    expect([field.movingMs, field.stillMs]).toEqual([0, 0])
    for (let i = 0; i < 49; i++) expect(tick(true)).toBe(0)
    expect(tick(true)).toBe(2)
  })

  it('后台长帧与重复物理步不会补扣血或瞬间清除', () => {
    const { field, player } = setup()
    expect(field.step(60000, 1, player)).toBe(0)
    expect(field.stillMs).toBeCloseTo(1000 / 30)
    field.step(120000, 1, player)
    expect(field.stillMs).toBeCloseTo(1000 / 30)
    expect(field.active).toBe(true)
    player.x += 100
    field.step(180000, 2, player)
    expect(field.movingMs).toBeCloseTo(1000 / 30)
    expect(field.active).toBe(true)
  })

  it('液滩有容量和生命周期限制；墙内落点被拒绝；击杀来源不会清掉地面液体', () => {
    const field = new LiquidField(cfg)
    field.spray(1, 0, 0, 0, () => false)
    expect(field.puddles.some((p) => p.active)).toBe(false)
    for (let i = 0; i < cfg.spray.maxPuddles; i++) field.spray(i, 1000, 1000, 0, () => true)
    expect(field.puddles.filter((p) => p.active)).toHaveLength(cfg.spray.maxPuddles)
    field.releaseEnemy(enemy())
    expect(field.puddles.filter((p) => p.active)).toHaveLength(cfg.spray.maxPuddles)
    field.step(cfg.spray.lifetimeMs, 1, null)
    expect(field.puddles.some((p) => p.active)).toBe(false)
  })

  it('死亡、换角色或换层都清理状态', () => {
    const { field, player, tick } = setup()
    player.alive = false
    tick(false)
    expect(field.active).toBe(false)
    const another = setup()
    another.player.id++
    another.tick(false)
    expect(another.field.active).toBe(false)
    const third = setup()
    third.field.clear()
    expect(third.field.active).toBe(false)
    expect(third.field.puddles.some((p) => p.active)).toBe(false)
  })

  it('亚像素抖动算静止，实际位移算移动', () => {
    const { field, player } = setup()
    player.x += 0.01
    field.step(20, 1, player)
    expect(field.moving).toBe(false)
    player.x += 10
    field.step(40, 2, player)
    expect(field.moving).toBe(true)
  })
})

function enemy() {
  const stats = { maxHp: 1000, speed: 0, radius: 12 }
  const target = new ActorModel('enemy', stats, 'alive')
  target.spawn(stats, 'alive')
  return target
}

describe('沾液接触帧伤：仅按持续接触结算', () => {
  it('首次触碰只登记，每个节拍持续掉血，没有额外的 80 点撞击', () => {
    const { field } = setup(),
      target = enemy()
    const hits: number[] = []
    target.sink = { onDamaged: (e) => hits.push(e.amount), onKilled: () => {} }
    for (let i = 0; i <= 4; i++) {
      const now = i * cfg.coating.contactTickMs
      field.touchContact(1, target, now)
      field.stepContact(now, i)
      expect(target.hp).toBe(target.maxHp - i * cfg.coating.contactDamagePerTick)
    }
    expect(hits).toEqual(Array(4).fill(cfg.coating.contactDamagePerTick))
  })

  it('重复接触和同渲染帧补步不重复结算，低帧率不追赶补伤', () => {
    const { field } = setup(),
      target = enemy()
    field.touchContact(1, target, 0)
    field.stepContact(0, 0)
    for (let i = 0; i < 5; i++) {
      field.touchContact(1, target, 1000)
      field.stepContact(1000, 1)
    }
    expect(target.hp).toBe(target.maxHp - cfg.coating.contactDamagePerTick)
    field.touchContact(1, target, 1001)
    field.stepContact(1001, 2)
    expect(target.hp).toBe(target.maxHp - cfg.coating.contactDamagePerTick)
  })

  it('一帧同时贴住多个敌人各自掉血，伤害节拍与采样频率无关', () => {
    for (const dt of [10, 20, 25]) {
      const { field } = setup(),
        a = enemy(),
        b = enemy()
      for (let now = 0; now <= 1000; now += dt) {
        field.touchContact(1, a, now)
        field.touchContact(1, b, now)
        field.stepContact(now, now / dt)
      }
      expect(a.maxHp - a.hp).toBe(cfg.coating.contactDamagePerTick * 10)
      expect(b.hp).toBe(a.hp)
    }
  })

  it('离开立即停伤；短暂接触不足一跳不受伤，不残留毒伤', () => {
    const { field } = setup(),
      target = enemy()
    field.touchContact(1, target, 0)
    field.stepContact(0, 0)
    field.stepContact(cfg.coating.contactTickMs, 1)
    expect(target.hp).toBe(target.maxHp)
    field.stepContact(1000, 2)
    field.touchContact(1, target, 1001)
    field.stepContact(1001, 3)
    expect(target.hp).toBe(target.maxHp)
    field.touchContact(1, target, 1001 + cfg.coating.contactTickMs)
    field.stepContact(1001 + cfg.coating.contactTickMs, 4)
    expect(target.hp).toBe(target.maxHp - cfg.coating.contactDamagePerTick)
    field.stepContact(1500, 5)
    expect(target.hp).toBe(target.maxHp - cfg.coating.contactDamagePerTick)
  })

  it('清除沾液立即销毁配对，重新沾液不继承之前的伤害节拍', () => {
    const { field } = setup(),
      target = enemy()
    field.touchContact(1, target, 0)
    field.stepContact(0, 0)
    field.resetCoating()
    field.stepContact(100, 1)
    field.touchContact(1, target, 100)
    expect(target.hp).toBe(target.maxHp)
    field.active = true
    field.touchContact(1, target, 100)
    field.stepContact(100, 2)
    expect(target.hp).toBe(target.maxHp)
  })

  it('敌人死亡、回收和重生不继承旧接触记录', () => {
    const { field } = setup(),
      target = enemy()
    field.touchContact(1, target, 0)
    field.stepContact(0, 0)
    field.releaseEnemy(target)
    field.touchContact(1, target, 100)
    field.stepContact(100, 1)
    expect(target.hp).toBe(target.maxHp)
    target.despawn()
    field.stepContact(200, 2)
    target.spawn(target.stats, 'alive')
    field.touchContact(1, target, 300)
    field.stepContact(300, 3)
    expect(target.hp).toBe(target.maxHp)
  })
})

describe('喷洒怪配置契约', () => {
  it.each([
    'drainDamage',
    'cleanseStillMs',
    'cleanseMovingMs',
    'contactTickMs',
    'contactDamagePerTick',
  ])('拒绝无效 %s', (key) => {
    const r = raw()
    r.enemies.sprayer.coating[key] = 0
    expect(() => validateEnemies(r)).toThrow(key)
  })
  it('拒绝非整数池容量、不加速、未知纹理和倒置射程', () => {
    for (const change of [
      (r: ReturnType<typeof raw>) => {
        r.enemies.sprayer.spray.maxPuddles = 1.5
      },
      (r: ReturnType<typeof raw>) => {
        r.enemies.sprayer.coating.speedMultiplier = 1
      },
      (r: ReturnType<typeof raw>) => {
        r.enemies.sprayer.textureKey = 'not-delivered'
      },
      (r: ReturnType<typeof raw>) => {
        r.enemies.sprayer.spray.keepDistance = 9999
      },
    ]) {
      const r = raw()
      change(r)
      expect(() => validateEnemies(r)).toThrow()
    }
  })
  it('血量随基线武器和难度派生，帧伤收益及移动代价保持相同', () => {
    const bundle = parseConfigBundle({
      enemies: raw(),
      balance: JSON.parse(readFileSync('public/config/balance.json', 'utf8')),
      difficulty: JSON.parse(readFileSync('public/config/difficulty.json', 'utf8')),
    })
    for (const mods of Object.values(bundle.difficulty.difficulties)) {
      const derived = deriveSprayer(cfg, mods, bundle.balance)
      expect(derived.maxHp).toBe(
        Math.round(cfg.hpValue * bundle.balance.baseline.bullet.damage * mods.enemyHp),
      )
      expect(derived.speed).toBe(Math.round(cfg.speed * mods.enemySpeed))
    }
  })
})
