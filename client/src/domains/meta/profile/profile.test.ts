/**
 * 存档的核心不变量。**跑在 node 环境**（`vite.config.ts` 钉死的），
 * 所以这里一次 Phaser 都不碰 —— 那正是"存档逻辑必须在没有浏览器的情况下能测"
 * 这条架构约定的落地形态。
 *
 * 这些用例挑的都是**坏掉时看不出来**的东西：
 *
 * | 坏了的样子 | 对应用例 |
 * |---|---|
 * | 玩家的档每次启动都被重置，但他自己以为"就是没存上" | 落盘往返 |
 * | 回退版本后旧版把新版存档原地覆盖 | 版本比本版新 → 不覆盖 |
 * | 存储配额满导致整个游戏崩掉 | 写失败仍可继续玩 |
 * | 一次改动写到一半落盘，档变成一个"看起来正常"的坏档 | mutator 抛异常 |
 * | 版本号忘了跟着写进去，迁移链从此无从谈起 | 落盘内容带 schemaVersion |
 */

import { describe, expect, it, vi } from 'vitest'
import { createDefaultProfile, STARTER_CHARACTER_ID } from './defaults'
import {
  migrateProfile,
  normalizeProfile,
  runMigrations,
  type MigrationRegistry,
  type MigrationStep,
} from './migrate'
import { ProfileStore } from './ProfileStore'
import { MemoryProfileStorage, type ProfileStorage } from './storage'
import { PROFILE_BACKUP_KEY, PROFILE_SCHEMA_VERSION, PROFILE_STORAGE_KEY } from './types'

/** 一个"某一边一定炸"的后端，用来验存储不可用时的行为。 */
class ThrowingStorage implements ProfileStorage {
  constructor(private readonly mode: 'read' | 'write') {}

  read(_key: string): string | null {
    if (this.mode === 'read') throw new Error('读炸了')
    return null
  }

  write(_key: string, _value: string): void {
    if (this.mode === 'write') throw new Error('配额满了')
  }

  remove(_key: string): void {}
}

function storeWith(storage: ProfileStorage): ProfileStore {
  return new ProfileStore({ storage })
}

/** 把一份档直接塞进存储，模拟"上一次玩完之后留下的东西" */
function stored(profile: unknown): MemoryProfileStorage {
  return new MemoryProfileStorage({ [PROFILE_STORAGE_KEY]: JSON.stringify(profile) })
}

describe('默认档', () => {
  it('带当前 schemaVersion（红线 3）', () => {
    expect(createDefaultProfile().schemaVersion).toBe(PROFILE_SCHEMA_VERSION)
  })

  it('默认值就是需求 §4.5 / §4.1 上写的那些', () => {
    const p = createDefaultProfile()
    expect(p.settings.bgmVolume).toBe(0.6)
    expect(p.settings.sfxVolume).toBe(0.8)
    // 「窗口」不是草图上的「全屏」：浏览器不允许无手势进全屏，
    // 默认值写全屏 = 设置界面第一帧就在说假话。理由见 `defaults.ts` 文件头。
    expect(p.settings.displayMode).toBe('windowed')
    expect(p.selected.difficulty).toBe('normal')
    expect(p.selected.characterId).toBe(STARTER_CHARACTER_ID)
    expect(p.unlocks.characters).toContain(STARTER_CHARACTER_ID)
    // 计数值一起归零，否则"新档"和"老档"的区别只剩一个字段
    expect(p.currency.coins).toBe(0)
    expect(p.stats).toEqual({ runs: 0, wins: 0, deaths: 0, bestDepth: 0 })
  })
})

describe('load() 永不抛异常', () => {
  it('存储是空的时候给 fresh，且档是默认档', () => {
    const store = storeWith(new MemoryProfileStorage())
    expect(store.load()).toEqual({ status: 'fresh' })
    expect(store.profile).toEqual(createDefaultProfile())
  })

  it('存储里是坏 JSON → recovered，原文被备份，档回落成默认', () => {
    const storage = new MemoryProfileStorage({ [PROFILE_STORAGE_KEY]: '{这不是 JSON' })
    const store = storeWith(storage)

    const outcome = store.load()
    expect(outcome.status).toBe('recovered')
    expect(store.profile).toEqual(createDefaultProfile())
    expect(storage.read(PROFILE_BACKUP_KEY)).toBe('{这不是 JSON')
  })

  it('存档是"合法 JSON 但不是本项目的档" → recovered 而不是静默接受', () => {
    const store = storeWith(stored({ hello: 'world' }))
    const outcome = store.load()
    expect(outcome.status).toBe('recovered')
    // 反向证据：确实是因为缺 schemaVersion，不是因为别的原因
    if (outcome.status === 'recovered') {
      expect(outcome.reason).toContain('schemaVersion')
    }
  })

  it('存储读不出来（隐私模式）→ recovered，游戏不崩', () => {
    const store = storeWith(new ThrowingStorage('read'))
    const outcome = store.load()
    expect(outcome.status).toBe('recovered')
    expect(store.profile).toEqual(createDefaultProfile())
    if (outcome.status === 'recovered') expect(outcome.reason).toContain('读炸了')
  })

  it('版本比本版新 → 不覆盖它：原文进备份、另起一份新档', () => {
    const future = {
      schemaVersion: PROFILE_SCHEMA_VERSION + 1,
      currency: { coins: 999 },
      unlocks: { characters: ['未来角色'], skills: [] },
    }
    const storage = stored(future)
    const store = storeWith(storage)

    const outcome = store.load()
    expect(outcome.status).toBe('recovered')
    // 关键的一条：玩家在新版里的解锁**没有被抹掉**，只是被挪到了备份里
    expect(store.profile.currency.coins).toBe(0)
    expect(storage.read(PROFILE_BACKUP_KEY)).toBe(JSON.stringify(future))
    // 而且**没有覆盖原 key** —— 那份新档还在，回滚回去还能用
    expect(JSON.parse(storage.read(PROFILE_STORAGE_KEY) ?? '{}').schemaVersion).toBe(
      PROFILE_SCHEMA_VERSION + 1,
    )
  })
})

describe('落盘', () => {
  it('update 之后换一个 store 读同一份存储，改动还在', () => {
    const storage = new MemoryProfileStorage()
    const first = storeWith(storage)
    first.load()
    expect(first.update((d) => void (d.currency.coins = 120))).toBe(true)

    const second = storeWith(storage)
    expect(second.load()).toEqual({ status: 'loaded' })
    expect(second.profile.currency.coins).toBe(120)
  })

  it('写进存储的载荷里带 schemaVersion（红线 3 的反向证据）', () => {
    const storage = new MemoryProfileStorage()
    const store = storeWith(storage)
    store.load()
    store.update((d) => void (d.stats.runs = 1))

    const raw = storage.read(PROFILE_STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!).schemaVersion).toBe(PROFILE_SCHEMA_VERSION)
  })

  it('写不进去（配额满）→ 返回 false，但内存档已经改了，这一局照常玩', () => {
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const store = storeWith(new ThrowingStorage('write'))
    store.load()

    expect(store.update((d) => void (d.currency.coins = 50))).toBe(false)
    expect(store.profile.currency.coins).toBe(50)
    expect(store.lastError).toContain('配额满了')
    quiet.mockRestore()
  })

  it('mutator 自己抛异常 → 内存档一点不动（不留"改到一半"的档）', () => {
    const storage = new MemoryProfileStorage()
    const store = storeWith(storage)
    store.load()
    store.update((d) => void (d.currency.coins = 10))
    const before = JSON.stringify(store.profile)

    const ok = store.update((d) => {
      d.currency.coins = 999
      throw new Error('改到一半炸了')
    })

    expect(ok).toBe(false)
    expect(JSON.stringify(store.profile)).toBe(before)
    expect(store.lastError).toContain('改到一半炸了')
    // 存储里也不能出现那个 999
    expect(JSON.parse(storage.read(PROFILE_STORAGE_KEY)!).currency.coins).toBe(10)
  })

  it('reset 之后档回到默认，存储里也是默认（不是被删空了）', () => {
    const storage = new MemoryProfileStorage()
    const store = storeWith(storage)
    store.load()
    store.update((d) => void (d.currency.coins = 300))

    expect(store.reset()).toBe(true)
    expect(store.profile).toEqual(createDefaultProfile())
    expect(JSON.parse(storage.read(PROFILE_STORAGE_KEY)!)).toEqual(createDefaultProfile())
  })
})

describe('迁移链', () => {
  const table: MigrationRegistry = {
    1: (d) => ({ ...d, coinKind: 'balance' }),
    2: (d) => ({ ...d, settings: { ...(d.settings as object), masterVolume: 1 } }),
  }

  it('三步链按顺序走完，中间结果是累积的', () => {
    const result = runMigrations({ schemaVersion: 1 }, 1, 3, table)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.to).toBe(3)
      expect(result.data.coinKind).toBe('balance')
      expect(result.data.settings).toEqual({ masterVolume: 1 })
    }
  })

  it('同一个版本直接返回，一步都不跑', () => {
    const result = runMigrations({ schemaVersion: 1, keep: true }, 1, 1, table)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.keep).toBe(true)
  })

  it('中间缺一步 → 明确失败，不猜、不跳步', () => {
    const holed: MigrationRegistry = { 2: table[2]! }
    const result = runMigrations({}, 1, 3, holed)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('1 → 2')
  })

  it('迁移表打转 → 被步数上限拦住，而不是把浏览器卡死', () => {
    // 每一步都存在（任何 key 都返回一步），所以唯一能停下来的理由是步数上限。
    // 用普通对象造不出这种表：表里总会缺一个 key，于是先撞上"链断了"那条分支。
    const loop = new Proxy({} as Record<number, MigrationStep>, {
      get: () => (d: Record<string, unknown>) => d,
    }) as MigrationRegistry
    const result = runMigrations({}, 1, 100000, loop)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('超限')
  })

  it('真实 v1 → v3 迁移旧成长退款并清空旧技能', () => {
    const real = migrateProfile({
      schemaVersion: 1,
      upgrades: {
        'student:armor': 4,
        'student:magic': 3,
        'student:maxHp': 2,
      },
      unlocks: { characters: ['student', 'leader'], skills: ['rapid_fire'] },
      selected: { characterId: 'leader', difficulty: 'normal' },
    })
    expect(real.outcome).toEqual({ status: 'migrated', from: 1, to: 3 })
    expect(real.profile.upgrades['student:armor']).toBeUndefined()
    expect(real.profile.upgrades['student:magic']).toBeUndefined()
    expect(real.profile.upgrades).toEqual({})
    expect(real.profile.currency.coins).toBeGreaterThan(0)
    expect(real.profile.unlocks.characters).toEqual(['student'])
    expect(real.profile.unlocks.skills).toEqual([])
    expect(real.profile.selected.characterId).toBe('student')
  })
})

describe('形状收敛', () => {
  it('越界 / 类型不对的值被夹回合法范围，而不是让坏档落盘', () => {
    const p = normalizeProfile({
      schemaVersion: 1,
      settings: { bgmVolume: 5, sfxVolume: -3, displayMode: '看电视' },
      currency: { coins: -50 },
      stats: { runs: -1, wins: 2.7, deaths: 'x', bestDepth: Number.NaN },
      selected: { characterId: '', difficulty: 'normal ' },
    })
    expect(p.settings.bgmVolume).toBe(1)
    expect(p.settings.sfxVolume).toBe(0)
    expect(p.settings.displayMode).toBe('windowed')
    expect(p.currency.coins).toBe(0)
    expect(p.stats).toEqual({ runs: 0, wins: 3, deaths: 0, bestDepth: 0 })
    expect(p.selected.characterId).toBe(STARTER_CHARACTER_ID)
    expect(p.selected.difficulty).toBe('normal')
  })

  it('缺字段一律补默认，不报错', () => {
    const p = normalizeProfile({ schemaVersion: 1 })
    expect(p).toEqual(createDefaultProfile())
  })

  it('本版不认识的解锁 id **保留** —— 丢掉它等于永久删除玩家的解锁', () => {
    const p = normalizeProfile({
      schemaVersion: 1,
      unlocks: { characters: ['student', '来自未来版本的角色'], skills: [] },
    })
    expect(p.unlocks.characters).toContain('来自未来版本的角色')
  })

  it('收敛一定把版本盖成当前版本号（改动不可能悄悄降级）', () => {
    expect(normalizeProfile({ schemaVersion: 1 }).schemaVersion).toBe(PROFILE_SCHEMA_VERSION)
  })
})

describe('订阅', () => {
  it('改动后通知订阅者，退订之后不再通知', () => {
    const store = storeWith(new MemoryProfileStorage())
    store.load()

    const seen: string[] = []
    const off = store.subscribe((_p, event) => seen.push(event))
    store.update((d) => void (d.currency.coins = 1))
    expect(seen).toEqual(['updated'])

    off()
    store.update((d) => void (d.currency.coins = 2))
    expect(seen).toEqual(['updated'])
  })

  it('一个订阅者抛异常不会影响另一个，也不会把 update 带崩', () => {
    // 这条路径本来就会往控制台打一行（那是给排查的人看的），
    // 但用例输出要保持干净 —— 满屏的预期内报错会让真正的失败看不见。
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})

    const store = storeWith(new MemoryProfileStorage())
    store.load()

    const seen: number[] = []
    store.subscribe(() => {
      throw new Error('订阅者炸了')
    })
    store.subscribe((p) => seen.push(p.currency.coins))

    expect(store.update((d) => void (d.currency.coins = 7))).toBe(true)
    expect(seen).toEqual([7])
    expect(quiet).toHaveBeenCalled()
    quiet.mockRestore()
  })
})
