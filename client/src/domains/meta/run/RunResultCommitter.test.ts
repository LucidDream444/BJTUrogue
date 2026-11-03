import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { RunResultSnapshot } from '@/core/events'
import { parseMetaConfig } from '../metaConfig'
import { ProfileStore } from '../profile/ProfileStore'
import { MemoryProfileStorage } from '../profile/storage'
import { PROFILE_SCHEMA_VERSION } from '../profile/types'
import { RunResultCommitter } from './RunResultCommitter'

const meta = parseMetaConfig(JSON.parse(readFileSync(new URL('../../../../public/config/meta.json', import.meta.url), 'utf8')))
const snapshot = (override: Partial<RunResultSnapshot> = {}): RunResultSnapshot => ({
  runId: 'run-1', characterId: 'student', difficulty: 'normal', outcome: 'cleared',
  depth: 8, kills: 30, clearedRooms: 12, elapsedMs: 20000, finalRewardId: 'heart_demon', ...override,
})

function store(storage = new MemoryProfileStorage()): ProfileStore {
  const profile = new ProfileStore({ storage })
  profile.load()
  return profile
}

describe('按 runId 唯一提交结果', () => {
  it('重复胜利和冲突结果均返回原结果，最终奖励仅一次', () => {
    const profile = store()
    const committer = new RunResultCommitter(profile, meta)
    const result = committer.commit(snapshot())
    expect(result.coinsEarned).toBe(30 + 12 * 5 + 8 * 20 + 120)
    const revision = profile.profile.revision
    expect(committer.commit(snapshot({ kills: 999, outcome: 'dead' }))).toBe(result)
    expect(committer.get('run-1')).toBe(result)
    expect(profile.profile.stats).toMatchObject({ runs: 1, wins: 1, deaths: 0 })
    expect(profile.profile.revision).toBe(revision)
  })

  it('死亡快照不发最终奖励或增加 wins', () => {
    const profile = store()
    const result = new RunResultCommitter(profile, meta).commit(snapshot({ outcome: 'dead' }))
    expect(result.coinsEarned).toBe(30 + 12 * 5 + 8 * 20)
    expect(profile.profile.stats).toMatchObject({ runs: 1, wins: 0, deaths: 1 })
  })

  it('落盘失败后的保存重试不重新发币或增加统计', () => {
    class FailingStorage extends MemoryProfileStorage {
      fail = true
      override write(key: string, value: string): void {
        if (this.fail) throw new Error('quota')
        super.write(key, value)
      }
    }
    const storage = new FailingStorage()
    const profile = store(storage)
    const committer = new RunResultCommitter(profile, meta)
    const result = committer.commit(snapshot())
    expect(result.saved).toBe(false)
    const beforeRetry = profile.snapshot()
    storage.fail = false
    expect(profile.save()).toBe(true)
    expect(committer.commit(snapshot())).toBe(result)
    expect(profile.snapshot()).toEqual(beforeRetry)
    expect(profile.profile.schemaVersion).toBe(PROFILE_SCHEMA_VERSION)
    const reloaded = store(storage)
    expect(reloaded.profile.currency).toEqual(beforeRetry.currency)
    expect(reloaded.profile.stats).toEqual(beforeRetry.stats)
  })

  it('存档订阅同步重入提交时也只发一份收益', () => {
    const profile = store()
    const committer = new RunResultCommitter(profile, meta)
    let reentered = 0
    profile.subscribe((_value, event) => {
      if (event !== 'updated') return
      reentered++
      committer.commit(snapshot())
    })
    committer.commit(snapshot())
    expect(reentered).toBe(1)
    expect(profile.profile.stats.runs).toBe(1)
    expect(profile.profile.revision).toBe(1)
  })

  it('非法快照不修改存档，随后仍可提交有效结果', () => {
    const profile = store()
    const before = profile.snapshot()
    const committer = new RunResultCommitter(profile, meta)
    for (const invalid of [snapshot({ runId: '' }), snapshot({ kills: -1 }), snapshot({ elapsedMs: Infinity }), snapshot({ finalRewardId: 'missing' })]) {
      expect(() => committer.commit(invalid)).toThrow()
      expect(profile.snapshot()).toEqual(before)
    }
    expect(committer.get('run-1')).toBeNull()
    expect(committer.commit(snapshot()).saved).toBe(true)
  })
})
