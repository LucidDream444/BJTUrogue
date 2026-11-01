import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TypedBus, type GameEvents, type RunResultSnapshot, type StoryRequest } from '@/core/events'
import { parseMetaConfig } from '../metaConfig'
import { ProfileStore } from '../profile/ProfileStore'
import { MemoryProfileStorage } from '../profile/storage'
import { PROFILE_SCHEMA_VERSION } from '../profile/types'
import { RunResultCommitter } from '../run/RunResultCommitter'
import { StoryCoordinator } from './StoryCoordinator'
import { StorySequence } from './StorySequence'
import { parseStoryConfig, StoryConfigError } from './storyConfig'

const rawStory = JSON.parse(readFileSync(new URL('../../../../public/config/story.json', import.meta.url), 'utf8')) as Record<string, unknown>
const meta = parseMetaConfig(JSON.parse(readFileSync(new URL('../../../../public/config/meta.json', import.meta.url), 'utf8')))
const config = parseStoryConfig(rawStory, () => true)
const request = (characterId = 'student', kind: 'intro' | 'ending' = 'intro'): StoryRequest => ({
  runId: 'run-1', requestId: `run-1:${kind}`, characterId, difficulty: 'normal', kind,
})
const snapshot = (override: Partial<RunResultSnapshot> = {}): RunResultSnapshot => ({
  runId: 'run-1', characterId: 'student', difficulty: 'normal', outcome: 'cleared',
  depth: 8, kills: 30, clearedRooms: 12, elapsedMs: 20000, finalRewardId: 'heart_demon', ...override,
})
function store(): ProfileStore {
  const profile = new ProfileStore({ storage: new MemoryProfileStorage() })
  profile.load()
  return profile
}

describe('故事配置与纯逻辑序列', () => {
  it('14张独立画面组成各角色5幕开场与3幕结局', () => {
    expect(() => parseStoryConfig(rawStory)).not.toThrow()
    expect(Object.keys(config.pages)).toHaveLength(14)
    for (const id of ['student', 'athlete', 'scholar'] as const) {
      expect(config.branches[id].intro).toHaveLength(5)
      expect(config.branches[id].ending).toHaveLength(3)
      const intro = new StorySequence(config, request(id))
      expect(intro.pages[3]!.imageKey).toContain(id === 'athlete' ? 'goose' : id === 'scholar' ? 'berry' : 'student')
      const ending = new StorySequence(config, request(id, 'ending'))
      expect(ending.pages[1]!.imageKey).toContain(id === 'athlete' ? 'goose' : id === 'scholar' ? 'berry' : 'student')
    }
  })

  it('拒绝缺分支、空字幕、非法时长、未知key和冒充独立画面的重复key', () => {
    const copy = (): Record<string, unknown> => JSON.parse(JSON.stringify(rawStory)) as Record<string, unknown>
    const missing = copy(); delete (missing.branches as Record<string, unknown>).scholar
    expect(() => parseStoryConfig(missing, () => true)).toThrow(StoryConfigError)
    const empty = copy(); ((empty.pages as Record<string, Record<string, unknown>>).study!).caption = ''
    expect(() => parseStoryConfig(empty, () => true)).toThrow(StoryConfigError)
    const invalid = copy(); ((invalid.pages as Record<string, Record<string, unknown>>).sleep!).durationMs = -1
    expect(() => parseStoryConfig(invalid, () => true)).toThrow(StoryConfigError)
    expect(() => parseStoryConfig(rawStory, () => false)).toThrow(/不存在的图片/)
    const repeated = copy(); const pages = repeated.pages as Record<string, Record<string, unknown>>
    pages.sleep!.imageKey = pages.study!.imageKey
    expect(() => parseStoryConfig(repeated, () => true)).toThrow(/重复使用/)
  })

  it('手动下一页清零页计时，长帧不连续跳页，隐藏不累计', () => {
    const sequence = new StorySequence(config, request())
    for (let i = 0; i < 140; i++) sequence.tick(33)
    sequence.next()
    const index = sequence.index
    sequence.tick(100000)
    sequence.tick(100000, true)
    expect(sequence.index).toBe(index)
    expect(sequence.done).toBe(false)
  })

  it('自动完成与跳过共享一次完成闸', () => {
    const sequence = new StorySequence(config, request('scholar', 'ending'))
    sequence.next(); sequence.next()
    expect(sequence.next()).toBe('completed')
    expect(sequence.skip()).toBeNull()
    expect(sequence.next()).toBeNull()
    const skipped = new StorySequence(config, request())
    expect(skipped.skip()).toBe('skipped')
    expect(skipped.tick(100000)).toBeNull()
  })

  it('每个新序列都从第一幕开始且保留角色快照', () => {
    const mutable = { ...request('scholar') }
    const first = new StorySequence(config, mutable)
    mutable.characterId = 'student'
    first.skip()
    expect(first.request.characterId).toBe('scholar')
    expect(new StorySequence(config, request('scholar')).index).toBe(0)
  })
})

describe('按runId唯一提交结果', () => {
  it('重复胜利和展示只返回原结果，最终奖励仅一次', () => {
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

  it('同时死亡的dead快照不发最终奖励或增加wins', () => {
    const profile = store()
    const result = new RunResultCommitter(profile, meta).commit(snapshot({ outcome: 'dead' }))
    expect(result.coinsEarned).toBe(30 + 12 * 5 + 8 * 20)
    expect(profile.profile.stats).toMatchObject({ runs: 1, wins: 0, deaths: 1 })
  })

  it('落盘失败后重试只保存既有内存结果', () => {
    class FailingStorage extends MemoryProfileStorage {
      fail = true
      override write(key: string, value: string): void {
        if (this.fail) throw new Error('quota')
        super.write(key, value)
      }
    }
    const storage = new FailingStorage()
    const profile = new ProfileStore({ storage }); profile.load()
    const committer = new RunResultCommitter(profile, meta)
    const result = committer.commit(snapshot())
    expect(result.saved).toBe(false)
    const coins = profile.profile.currency.coins
    const revision = profile.profile.revision
    storage.fail = false
    expect(profile.save()).toBe(true)
    expect(committer.commit(snapshot())).toBe(result)
    expect(profile.profile.currency.coins).toBe(coins)
    expect(profile.profile.revision).toBe(revision)
    expect(profile.profile.schemaVersion).toBe(PROFILE_SCHEMA_VERSION)
  })
})

describe('C1故事与展示协调', () => {
  it('先提交收益，等待结局完成才展示；重复完成及旧局事件无效', () => {
    const profile = store()
    const bus = new TypedBus<GameEvents>()
    const stories: StoryRequest[] = []
    const shown: string[] = []
    const coordinator = new StoryCoordinator(bus, new RunResultCommitter(profile, meta), {
      story: (value) => stories.push(value), settlement: (value) => shown.push(value.runId),
    })
    bus.emit('story_requested', request('scholar'))
    bus.emit('story_requested', request('scholar'))
    expect(stories).toHaveLength(1)
    coordinator.finishStory('run-1', 'run-1:intro', 'skipped')
    bus.emit('run_result_ready', snapshot({ characterId: 'scholar' }))
    expect(profile.profile.stats.wins).toBe(1)
    bus.emit('settlement_requested', { runId: 'run-1' })
    expect(shown).toHaveLength(0)
    bus.emit('story_requested', request('scholar', 'ending'))
    coordinator.finishStory('run-old', 'run-1:ending', 'completed')
    expect(shown).toHaveLength(0)
    coordinator.finishStory('run-1', 'run-1:ending', 'completed')
    coordinator.finishStory('run-1', 'run-1:ending', 'skipped')
    expect(shown).toEqual(['run-1'])
    bus.emit('run_result_ready', snapshot())
    bus.emit('run_result_ready', snapshot({ runId: 'run-old' }))
    expect(profile.profile.stats.wins).toBe(1)
    coordinator.destroy()
    expect(bus.listenerCount('story_requested')).toBe(0)
  })

  it('死亡结果直接展示而不接受ending；重复展示不增加币', () => {
    const profile = store()
    const bus = new TypedBus<GameEvents>()
    let stories = 0
    let displays = 0
    const coordinator = new StoryCoordinator(bus, new RunResultCommitter(profile, meta), {
      story: () => stories++, settlement: () => displays++,
    })
    bus.emit('run_result_ready', snapshot({ outcome: 'dead' }))
    bus.emit('story_requested', request('student', 'ending'))
    bus.emit('settlement_requested', { runId: 'run-1' })
    const coins = profile.profile.currency.coins
    bus.emit('settlement_requested', { runId: 'run-1' })
    expect(stories).toBe(0)
    expect(displays).toBe(2)
    expect(profile.profile.currency.coins).toBe(coins)
    coordinator.destroy()
  })
})
