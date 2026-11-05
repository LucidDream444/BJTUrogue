import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { FixedRng } from '@/core/rng'
import type { BossSkillsTable, BossSkillUnit } from './BossSkillRuntime'
import { HeartDemonRuntime, type HeartDemonPort, type ShadowWeapon } from './HeartDemonRuntime'

const raw = JSON.parse(
  readFileSync(new URL('../../../public/config/boss-skills.json', import.meta.url), 'utf8'),
) as BossSkillsTable

function unit(id: number, extra: Partial<BossSkillUnit> = {}): BossSkillUnit {
  return {
    id,
    x: 0,
    y: 0,
    hp: 100,
    maxHp: 100,
    kind: 'tank',
    gen: 0,
    radius: 20,
    vx: 0,
    vy: 0,
    ...extra,
  }
}

function harness() {
  const config = structuredClone(raw)
  for (const spec of config.bosses['8']!.skills) spec.initialDelayMs = 1_000_000
  const units = new Map([
    [1, unit(1, { bossStage: 8, maxHp: 3000, hp: 3000 })],
    [2, unit(2)],
  ])
  const player = { id: 999, x: 500, y: 0, radius: 10, alive: true, player: true, vx: 0, vy: 0 }
  const initialWeapon: ShadowWeapon = {
    textureKey: 'player-body-snapshot',
    artKey: 'weapon-snapshot',
    damage: 20,
    cooldownMs: 200,
    speed: 600,
    radius: 4,
    lifetimeMs: 1700,
    pellets: 3,
    spreadDeg: 12,
    color: 0x123456,
  }
  let currentWeapon = initialWeapon
  const stuns = new Map<number, number>(),
    controls = new Map<number, number>()
  let playerStunUntil = 0
  const port: HeartDemonPort = {
    rng: new FixedRng(0),
    damageMultiplier: 1,
    normalEnemyKinds: ['splitter', 'tank'],
    units: () => [...units.values()].map((value) => ({ ...value })),
    player: () => ({ ...player }),
    bounds: () => ({ left: 0, top: 0, right: 1000, bottom: 1000 }),
    safeSpawn: (x, y) => ({ x, y }),
    projectileBlocked: () => false,
    setUnitPosition: vi.fn((id, x, y) => {
      const value = units.get(id)
      if (!value) return false
      value.x = x
      value.y = y
      return true
    }),
    setUnitHp: vi.fn((id, hp) => {
      const value = units.get(id)
      if (!value) return false
      value.hp = hp
      return true
    }),
    setUnitSpeedBoost: vi.fn(),
    setBossInvulnerable: vi.fn(),
    setBossControlled: vi.fn((id, until) => {
      controls.set(id, until)
    }),
    setUnitStunned: vi.fn((id, until) => {
      stuns.set(id, until)
    }),
    setBossAppearance: vi.fn(),
    fireBossVolley: vi.fn(() => 1),
    summonSkillEnemy: () => null,
    spawnBossClone: () => null,
    despawnSkillUnit: vi.fn(),
    transformMinions: () => 0,
    playerSlow: vi.fn(),
    damage: vi.fn(),
    weaponSnapshot: () => currentWeapon,
    playerStun: vi.fn((until) => {
      playerStunUntil = until
    }),
    screenRewind: vi.fn(),
    tickSound: vi.fn(),
    shadowWeapon: vi.fn(),
    castBorrowed: vi.fn((_bossId, _floor, _skillId, nowMs) => nowMs + 2000),
    cancelBorrowed: vi.fn(),
  }
  const runtime = new HeartDemonRuntime(config, port)
  runtime.update(0, 0, 1)
  return {
    runtime,
    port,
    units,
    player,
    stuns,
    controls,
    initialWeapon,
    changeWeapon: (weapon: ShadowWeapon) => {
      currentWeapon = weapon
    },
    playerStunUntil: () => playerStunUntil,
  }
}

function recordThreeSeconds(h: ReturnType<typeof harness>): void {
  for (let time = 1000; time <= 3000; time += 1000) {
    Object.assign(h.units.get(2)!, { x: time / 10, y: time / 20, hp: 100 - time / 50 })
    h.runtime.update(time, 16, 1)
  }
}

describe('心魔独立技能状态', () => {
  it('三秒倒带连续插值位置与生命，最后回到施放前三秒', () => {
    const h = harness()
    recordThreeSeconds(h)
    h.runtime.castSkill('rewind', 3000, 1)
    h.runtime.update(4500, 16, 1)
    expect(h.units.get(2)).toMatchObject({ x: 150, y: 75, hp: 70 })
    h.runtime.update(6000, 16, 1)
    expect(h.units.get(2)).toMatchObject({ x: 0, y: 0, hp: 100 })
    expect(h.runtime.isRewinding).toBe(false)
  })

  it('已死单位即使仍在快照列表中，也不恢复位置或生命', () => {
    const h = harness()
    recordThreeSeconds(h)
    h.units.get(2)!.hp = 0
    h.runtime.castSkill('rewind', 3000, 1)
    h.runtime.update(6000, 16, 1)
    expect(h.units.get(2)).toMatchObject({ x: 300, y: 150, hp: 0 })
    expect(vi.mocked(h.port.setUnitHp).mock.calls.filter(([id]) => id === 2)).toHaveLength(0)
  })

  it('出生不足三秒的敌人全程不局部回溯，但同样冻结', () => {
    const h = harness()
    h.runtime.update(1000, 16, 1)
    h.units.set(3, unit(3, { x: 100, hp: 90 }))
    h.runtime.update(2000, 16, 1)
    Object.assign(h.units.get(3)!, { x: 250, hp: 60 })
    h.runtime.update(3000, 16, 1)
    h.runtime.castSkill('rewind', 3000, 1)
    h.runtime.update(4000, 16, 1)
    expect(h.units.get(3)).toMatchObject({ x: 250, hp: 60 })
    h.runtime.update(6000, 16, 1)
    expect(h.units.get(3)).toMatchObject({ x: 250, hp: 60 })
    expect(vi.mocked(h.port.setUnitStunned).mock.calls).toContainEqual([3, 6000])
  })

  it('采样边界允许一帧误差，不排除已有完整历史的单位', () => {
    const h = harness()
    recordThreeSeconds(h)
    h.runtime.castSkill('rewind', 3050, 1)
    h.runtime.update(6050, 16, 1)
    expect(h.units.get(2)!.x).toBeCloseTo(5)
    expect(h.units.get(2)!.hp).toBeCloseTo(99)
  })

  it('倒带冻结玩家和敌人、触发红幕与三次嘀嗒，结束后解除', () => {
    const h = harness()
    recordThreeSeconds(h)
    h.runtime.castSkill('rewind', 3000, 1)
    expect(h.playerStunUntil()).toBe(6000)
    expect(h.controls.get(1)).toBe(6000)
    expect(h.port.setBossAppearance).toHaveBeenLastCalledWith(1, { stationary: true })
    expect(h.port.screenRewind).toHaveBeenLastCalledWith(true, 0.24)
    h.runtime.update(4000, 16, 1)
    h.runtime.update(5000, 16, 1)
    h.runtime.update(6000, 16, 1)
    expect(h.port.tickSound).toHaveBeenCalledTimes(3)
    expect(h.playerStunUntil()).toBe(0)
    expect(h.controls.get(1)).toBe(0)
    expect([...h.stuns.values()].every((until) => until === 0)).toBe(true)
    expect(h.port.screenRewind).toHaveBeenLastCalledWith(false, 0)
    expect(h.port.setBossAppearance).toHaveBeenLastCalledWith(1, {})
  })

  it('连续借用两个技能，第二次等待前次busyUntil及额外间隔', () => {
    const h = harness()
    h.runtime.castSkill('mimic_chain', 0, 1)
    expect(h.port.castBorrowed).toHaveBeenNthCalledWith(1, 1, 2, 'campus_slow', 0)
    h.runtime.update(3799, 16, 1)
    expect(h.port.castBorrowed).toHaveBeenCalledTimes(1)
    h.runtime.update(3800, 16, 1)
    expect(h.port.castBorrowed).toHaveBeenNthCalledWith(2, 1, 2, 'campus_slow', 3800)
    expect(h.port.setBossAppearance).toHaveBeenLastCalledWith(1, { skinBossStage: 2, black: true })
    h.runtime.update(5800, 16, 1)
    expect(h.port.setBossAppearance).toHaveBeenLastCalledWith(1, {})
  })

  it('巨大影子快照当前武器，玩家随后切武器不会改变既有攻击', () => {
    const h = harness()
    h.runtime.castSkill('player_shadow', 0, 1)
    const captured = { ...h.initialWeapon }
    h.initialWeapon.damage = 1000
    h.changeWeapon({ ...captured, damage: 900, speed: 50, pellets: 1 })
    h.runtime.update(10, 16, 1)
    expect(h.runtime.shadowState?.weapon).toEqual(captured)
    expect(h.port.shadowWeapon).toHaveBeenLastCalledWith(captured, 1)
    expect(h.port.fireBossVolley).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({
        count: 3,
        speed: 600,
        radius: 4,
        damage: 14,
        lifetimeMs: 1700,
        spreadRad: (12 * Math.PI) / 180,
      }),
    )
    h.runtime.update(200, 16, 1)
    expect(h.port.fireBossVolley).toHaveBeenCalledTimes(1)
    h.runtime.update(270, 16, 1)
    expect(h.port.fireBossVolley).toHaveBeenCalledTimes(2)
  })

  it('跟踪影子朝玩家位置移动，并按新的玩家方向射击', () => {
    const h = harness()
    h.player.x = 0
    h.player.y = 500
    h.runtime.castSkill('player_shadow', 0, 1)
    h.runtime.update(10, 16, 1)
    expect(h.units.get(1)!.y).toBeGreaterThan(0)
    expect(h.port.fireBossVolley).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({ angleRad: Math.PI / 2 }),
    )
    h.player.x = -500
    h.player.y = h.units.get(1)!.y
    h.runtime.update(270, 16, 1)
    expect(h.port.fireBossVolley).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({ angleRad: Math.PI }),
    )
  })

  it('提前清理倒带和借用技能时解除所有锁、画面与排队任务', () => {
    const h = harness()
    recordThreeSeconds(h)
    h.runtime.castSkill('rewind', 3000, 1)
    h.runtime.clear()
    expect(h.runtime.isRewinding).toBe(false)
    expect(h.playerStunUntil()).toBe(0)
    expect(h.controls.get(1)).toBe(0)
    expect([...h.stuns.values()].every((until) => until === 0)).toBe(true)
    expect(h.port.screenRewind).toHaveBeenLastCalledWith(false, 0)
    expect(h.port.cancelBorrowed).toHaveBeenCalled()
    h.runtime.castSkill('mimic_chain', 6000, 1)
    h.runtime.clear()
    const count = vi.mocked(h.port.castBorrowed).mock.calls.length
    h.runtime.update(20000, 16, 1)
    expect(h.port.castBorrowed).toHaveBeenCalledTimes(count)
  })

  it('提前清理巨大影子后不再射击并卸下武器', () => {
    const h = harness()
    h.runtime.castSkill('player_shadow', 0, 1)
    h.runtime.update(10, 16, 1)
    h.runtime.clear()
    expect(h.runtime.shadowState).toBeNull()
    expect(h.port.shadowWeapon).toHaveBeenLastCalledWith(null, 1)
    h.runtime.update(500, 16, 1)
    expect(h.port.fireBossVolley).toHaveBeenCalledTimes(1)
  })
})
