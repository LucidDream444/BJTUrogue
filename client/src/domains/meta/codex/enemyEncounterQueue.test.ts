import { describe, expect, it, vi } from 'vitest'
import type { EnemyKind, GameEvents } from '@/core/events'
import { createDefaultProfile } from '../profile/defaults'
import { migrateProfile, normalizeProfile } from '../profile/migrate'
import { ProfileStore } from '../profile/ProfileStore'
import { MemoryProfileStorage, type ProfileStorage } from '../profile/storage'
import { PROFILE_SCHEMA_VERSION, PROFILE_STORAGE_KEY } from '../profile/types'
import { EnemyEncounterQueue, identifyEnemyEncounter } from './enemyEncounterQueue'

function spawn(enemyKind: EnemyKind = 'tank', extra: Partial<GameEvents['entity_spawned']> = {}): GameEvents['entity_spawned'] {
  return { id: 1, kind: 'enemy', enemyKind, x: 0, y: 0, ...extra }
}

describe('首次遭遇识别与排队', () => {
  it('不把玩家或缺少身份的对象作为新怪物', () => {
    expect(identifyEnemyEncounter(spawn('tank', { kind: 'player' }))).toBeNull()
    expect(identifyEnemyEncounter(spawn('tank', { enemyKind: undefined }))).toBeNull()
  })

  it('六种普通怪物分别对应自己的图鉴，分裂怪直达实际遇到的代际', () => {
    const kinds: EnemyKind[] = ['splitter', 'tank', 'grabber', 'sprayer', 'muscovy', 'nightmare_cat']
    expect(kinds.map((kind) => identifyEnemyEncounter(spawn(kind, { gen: 2 })))).toEqual(
      kinds.map((kind) => ({ kind, entryId: kind === 'splitter' ? 'splitter-2' : kind })),
    )
    expect(identifyEnemyEncounter(spawn('splitter'))?.entryId).toBe('splitter-0')
  })

  it('首领身份优先于复用的肉盾种类，心魔优先于bossStage', () => {
    expect(identifyEnemyEncounter(spawn('tank', { bossStage: 1 }))).toEqual({ kind: 'first-boss', entryId: 'first-boss' })
    expect(identifyEnemyEncounter(spawn('tank', { bossStage: 2 }))).toEqual({ kind: 'stage2-boss', entryId: 'stage2-boss' })
    expect(identifyEnemyEncounter(spawn('tank', { bossStage: 2, finalBoss: true }))).toEqual({ kind: 'heart-demon', entryId: 'heart-demon' })
    const queue = new EnemyEncounterQueue(['tank'])
    expect(queue.discover(spawn('tank', { bossStage: 1 }))?.kind).toBe('first-boss')
  })

  it('同帧重复实例与分裂后代都只提示一次，保留首次实际遇到的那一代', () => {
    const queue = new EnemyEncounterQueue()
    expect(queue.discover(spawn('splitter', { gen: 1 }))?.entryId).toBe('splitter-1')
    expect(queue.discover(spawn('splitter', { gen: 2 }))).toBeNull()
    expect(queue.discover(spawn('splitter', { gen: 1, id: 2 }))).toBeNull()
    expect(queue.pendingCount).toBe(1)
    expect(queue.openNext()?.entryId).toBe('splitter-1')
  })

  it('多种新怪按生成顺序等待，每次关闭只露出下一条提示，不自动连开', () => {
    const queue = new EnemyEncounterQueue()
    queue.discover(spawn('tank'))
    queue.discover(spawn('sprayer'))
    queue.discover(spawn('muscovy'))
    expect(queue.next?.kind).toBe('tank')
    expect(queue.active).toBeNull()

    expect(queue.openNext()?.kind).toBe('tank')
    expect(queue.openNext()?.kind).toBe('tank')
    // 图鉴打开期间来了新怪，也只进入尾部。
    queue.discover(spawn('nightmare_cat'))
    queue.close()
    expect(queue.active).toBeNull()
    expect(queue.next?.kind).toBe('sprayer')
    expect(queue.pendingCount).toBe(3)
    expect(queue.openNext()?.kind).toBe('sprayer')
    queue.close()
    expect(queue.openNext()?.kind).toBe('muscovy')
    queue.close()
    expect(queue.openNext()?.kind).toBe('nightmare_cat')
    queue.close()
    expect(queue.openNext()).toBeNull()
  })

  it('存档已经标记的种类不会再进入新一局的提示队列', () => {
    const queue = new EnemyEncounterQueue(['splitter', 'first-boss'])
    expect(queue.discover(spawn('splitter', { gen: 2 }))).toBeNull()
    expect(queue.discover(spawn('tank', { bossStage: 1 }))).toBeNull()
    expect(queue.discover(spawn('tank'))?.entryId).toBe('tank')
  })
})

describe('首次遭遇存档兼容', () => {
  it('v4迁移只补空遭遇记录，金币、解锁、升级、设置、统计和revision原样保留', () => {
    const previous = createDefaultProfile()
    previous.currency.coins = 765
    previous.unlocks.characters.push('scholar')
    previous.upgrades['scholar:skill'] = 2
    previous.settings.bgmVolume = 0.2
    previous.stats.runs = 9
    previous.selected.characterId = 'scholar'
    previous.revision = 25
    previous.onboarding.tutorialSeen = true
    const { encounteredEnemyKinds: _oldMissing, ...oldShape } = previous
    const result = migrateProfile({ ...oldShape, schemaVersion: 4 })
    expect(result.outcome).toEqual({ status: 'migrated', from: 4, to: PROFILE_SCHEMA_VERSION })
    expect(result.profile).toEqual(previous)
  })

  it('主干v5引导档保留已看/未看状态，并补空遭遇记录', () => {
    for (const tutorialSeen of [false, true]) {
      const original = createDefaultProfile()
      original.onboarding.tutorialSeen = tutorialSeen
      original.currency.coins = 321
      original.revision = 17
      const { encounteredEnemyKinds: _missing, ...v5 } = original
      const result = migrateProfile({ ...v5, schemaVersion: 5 })
      expect(result.outcome).toEqual({ status: 'migrated', from: 5, to: 6 })
      expect(result.profile).toEqual(original)
    }
  })

  it('首次遭遇支线v5档保留所有种类和成长，缺失引导字段按老玩家处理', () => {
    const original = createDefaultProfile()
    original.encounteredEnemyKinds = ['splitter', 'heart-demon']
    original.onboarding.tutorialSeen = true
    original.currency.coins = 876
    original.stats.runs = 10
    original.upgrades['scholar:skill'] = 2
    original.revision = 31
    const { onboarding: _missing, ...v5 } = original
    const result = migrateProfile({ ...v5, schemaVersion: 5 })
    expect(result.outcome).toEqual({ status: 'migrated', from: 5, to: 6 })
    expect(result.profile).toEqual(original)
  })

  it('首次标记随现有ProfileStore落盘重载，重复生成不改revision', () => {
    const storage = new MemoryProfileStorage()
    const store = new ProfileStore({ storage })
    store.load()
    store.recordEnemyEncounter('splitter')
    expect(store.profile.revision).toBe(1)
    store.recordEnemyEncounter('splitter')
    expect(store.profile.revision).toBe(1)
    store.recordEnemyEncounter('heart-demon')
    const reopened = new ProfileStore({ storage })
    expect(reopened.load()).toEqual({ status: 'loaded' })
    expect(reopened.profile.encounteredEnemyKinds).toEqual(['splitter', 'heart-demon'])
    expect(JSON.parse(storage.read(PROFILE_STORAGE_KEY)!).schemaVersion).toBe(PROFILE_SCHEMA_VERSION)
    const queue = new EnemyEncounterQueue(reopened.profile.encounteredEnemyKinds)
    expect(queue.discover(spawn('splitter', { gen: 2 }))).toBeNull()
  })

  it('坏字段补默认并去重，未知未来物种标记保留', () => {
    expect(normalizeProfile({ encounteredEnemyKinds: 'tank' }).encounteredEnemyKinds).toEqual([])
    expect(normalizeProfile({ encounteredEnemyKinds: ['tank', 'tank', '', null, 'future-enemy'] }).encounteredEnemyKinds)
      .toEqual(['tank', 'future-enemy'])
  })

  it('本地写盘失败仍在内存记住本次遭遇，重复生成不反复写档', () => {
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const storage: ProfileStorage = {
      read: () => null,
      write: () => { throw new Error('quota') },
      remove: () => {},
    }
    const store = new ProfileStore({ storage })
    store.load()
    expect(store.recordEnemyEncounter('tank')).toBe(false)
    expect(store.profile.encounteredEnemyKinds).toEqual(['tank'])
    expect(store.recordEnemyEncounter('tank')).toBe(false)
    expect(store.profile.revision).toBe(1)
    quiet.mockRestore()
  })
})
