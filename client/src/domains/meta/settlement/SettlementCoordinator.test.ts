import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TypedBus, type GameEvents, type RunResultCommitted, type RunResultSnapshot } from '@/core/events'
import { parseMetaConfig } from '../metaConfig'
import { ProfileStore } from '../profile/ProfileStore'
import { MemoryProfileStorage } from '../profile/storage'
import { RunResultCommitter } from '../run/RunResultCommitter'
import { SettlementCoordinator } from './SettlementCoordinator'

const meta = parseMetaConfig(JSON.parse(readFileSync(new URL('../../../../public/config/meta.json', import.meta.url), 'utf8')))
const snapshot = (override: Partial<RunResultSnapshot> = {}): RunResultSnapshot => ({
  runId: 'run-1', characterId: 'student', difficulty: 'normal', outcome: 'cleared',
  depth: 8, kills: 30, clearedRooms: 12, elapsedMs: 20000, finalRewardId: 'heart_demon', ...override,
})

function setup(onShow: () => void = () => {}) {
  const profile = new ProfileStore({ storage: new MemoryProfileStorage() })
  profile.load()
  const bus = new TypedBus<GameEvents>()
  const committed: RunResultCommitted[] = []
  const shown: RunResultCommitted[] = []
  bus.on('run_result_committed', (result) => committed.push(result))
  const coordinator = new SettlementCoordinator(bus, new RunResultCommitter(profile, meta), {
    settlement: (result) => { shown.push(result); onShow() },
  })
  return { bus, coordinator, profile, committed, shown }
}

describe('C1 结果提交与结算展示协调', () => {
  it('胜利结果立即提交，收到请求后只展示一次', () => {
    const { bus, coordinator, profile, committed, shown } = setup()
    bus.emit('run_result_ready', snapshot())
    expect(committed).toHaveLength(1)
    expect(profile.profile.stats.wins).toBe(1)
    expect(shown).toHaveLength(0)
    bus.emit('settlement_requested', { runId: 'run-1' })
    const before = profile.snapshot()
    bus.emit('settlement_requested', { runId: 'run-1' })
    bus.emit('run_result_ready', snapshot({ kills: 999, outcome: 'dead' }))
    expect(shown).toEqual(committed)
    expect(committed).toHaveLength(1)
    expect(profile.snapshot()).toEqual(before)
    coordinator.destroy()
  })

  it('先请求后提交会等待对应结果，错误 runId 不锁住本局', () => {
    const { bus, coordinator, committed, shown } = setup()
    bus.emit('settlement_requested', { runId: 'run-old' })
    bus.emit('settlement_requested', { runId: 'run-1' })
    expect(shown).toHaveLength(0)
    bus.emit('run_result_ready', snapshot())
    expect(shown).toEqual(committed)
    expect(shown).toHaveLength(1)
    coordinator.destroy()
  })

  it('错误局请求与结果不展示、不发币；死亡结果正常展示', () => {
    const { bus, coordinator, profile, committed, shown } = setup()
    bus.emit('run_result_ready', snapshot({ outcome: 'dead' }))
    const before = profile.snapshot()
    bus.emit('settlement_requested', { runId: 'run-old' })
    bus.emit('run_result_ready', snapshot({ runId: 'run-old' }))
    expect(shown).toHaveLength(0)
    expect(committed).toHaveLength(1)
    expect(profile.snapshot()).toEqual(before)
    bus.emit('settlement_requested', { runId: 'run-1' })
    expect(shown[0]?.snapshot.outcome).toBe('dead')
    expect(profile.profile.stats).toMatchObject({ runs: 1, wins: 0, deaths: 1 })
    coordinator.destroy()
  })

  it('提交通知、存档更新及展示的同步重入不能重复提交或展示', () => {
    const state = setup(() => state.bus.emit('settlement_requested', { runId: 'run-1' }))
    state.profile.subscribe((_profile, event) => {
      if (event !== 'updated') return
      state.bus.emit('run_result_ready', snapshot())
      state.bus.emit('settlement_requested', { runId: 'run-1' })
    })
    state.bus.on('run_result_committed', () => {
      state.bus.emit('settlement_requested', { runId: 'run-1' })
      state.bus.emit('run_result_ready', snapshot())
    })
    state.bus.emit('run_result_ready', snapshot())
    expect(state.committed).toHaveLength(1)
    expect(state.shown).toHaveLength(1)
    expect(state.profile.profile.stats.runs).toBe(1)
    state.coordinator.destroy()
  })

  it('销毁后清理订阅，不再提交或响应结算请求', () => {
    const { bus, coordinator, profile, committed, shown } = setup()
    const before = profile.snapshot()
    coordinator.destroy()
    coordinator.destroy()
    expect(bus.listenerCount('run_result_ready')).toBe(0)
    expect(bus.listenerCount('settlement_requested')).toBe(0)
    bus.emit('run_result_ready', snapshot())
    bus.emit('settlement_requested', { runId: 'run-1' })
    expect(committed).toHaveLength(0)
    expect(shown).toHaveLength(0)
    expect(profile.snapshot()).toEqual(before)
  })
})
