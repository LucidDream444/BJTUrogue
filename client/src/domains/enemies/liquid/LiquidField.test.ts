import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { deriveSprayer, parseConfigBundle, validateEnemies } from '@/core/config'
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

describe('催化液：拾取、累计静止、移动代价与撞击', () => {
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
    expect(damage).toBe(2 * cfg.coating.drainDamage)
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
      expect(damage).toBe(cfg.coating.drainDamage * 4)
    }
  })

  it('后台长帧与重复物理步不会补扣血或瞬间清除', () => {
    const { field, player } = setup()
    expect(field.step(60000, 1, player)).toBe(0)
    expect(field.stillMs).toBeCloseTo(1000 / 30)
    field.step(120000, 1, player)
    expect(field.stillMs).toBeCloseTo(1000 / 30)
    expect(field.active).toBe(true)
  })

  it('撞同一目标有冷却，多个目标各自结算；静止时仍保留沾液攻击', () => {
    const { field, tick } = setup()
    tick(true)
    expect(field.ram(3, 20)).toBe(cfg.coating.ramDamage)
    expect(field.ram(3, 20)).toBe(0)
    expect(field.ram(4, 20)).toBe(cfg.coating.ramDamage)
    expect(field.ram(3, 20 + cfg.coating.ramCooldownMs)).toBe(cfg.coating.ramDamage)
    field.releaseEnemy(3)
    expect(field.ram(3, 40)).toBe(cfg.coating.ramDamage)
    tick(false)
    expect(field.ram(5, 40)).toBe(cfg.coating.ramDamage)
    field.resetCoating()
    expect(field.ram(6, 60)).toBe(0)
  })

  it('液滩有容量和生命周期限制；墙内落点被拒绝；击杀来源不会清掉地面液体', () => {
    const field = new LiquidField(cfg)
    field.spray(1, 0, 0, 0, () => false)
    expect(field.puddles.some((p) => p.active)).toBe(false)
    for (let i = 0; i < cfg.spray.maxPuddles; i++) field.spray(i, 1000, 1000, 0, () => true)
    expect(field.puddles.filter((p) => p.active)).toHaveLength(cfg.spray.maxPuddles)
    field.releaseEnemy(1)
    expect(field.puddles.filter((p) => p.active)).toHaveLength(cfg.spray.maxPuddles)
    field.step(cfg.spray.lifetimeMs, 1, null)
    expect(field.puddles.some((p) => p.active)).toBe(false)
  })

  it('死亡、换角色或换层都清理状态和冲撞配对', () => {
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

describe('喷洒怪配置契约', () => {
  it.each(['drainDamage', 'cleanseStillMs', 'ramCooldownMs'])('拒绝无效 %s', (key) => {
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
  it('血量随基线武器和难度派生，冲撞收益及移动代价保持相同', () => {
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
