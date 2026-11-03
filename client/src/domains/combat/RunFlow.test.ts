import { describe, expect, it } from 'vitest'
import { RunFlow } from './RunFlow'

const context = { runId: 'run-1', characterId: 'scholar', difficulty: 'normal' as const }

function playing() {
  const flow = new RunFlow(context)
  expect(flow.phase).toBe('playing')
  return flow
}

describe('本局战斗与直接结算流程', () => {
  it('建立本局后直接进入战斗，不等待剧情请求', () => {
    const flow = new RunFlow(context)
    expect(flow.phase).toBe('playing')
    expect(flow.result).toBeNull()
    expect(flow.adjudicate(true)).toBeNull()
  })
  it('同一步双方死亡永远优先死亡，不按回调顺序确定胜负', () => {
    for (const order of ['boss-first', 'player-first']) {
      const flow = playing()
      if (order === 'boss-first') flow.recordFinalBossDeath()
      const alive = false
      if (order === 'player-first') flow.recordFinalBossDeath()
      expect(flow.adjudicate(alive)).toBe('dead')
    }
  })
  it('冻结角色和结果，胜利后直接结算，重复提交不会覆盖收益', () => {
    const mutableContext = { ...context }
    const flow = new RunFlow(mutableContext)
    mutableContext.characterId = 'student'
    flow.recordFinalBossDeath()
    expect(flow.adjudicate(true)).toBe('cleared')
    const snapshot = { ...context, outcome: 'cleared' as const, depth: 8, kills: 15, clearedRooms: 12, elapsedMs: 8000 }
    expect(flow.commit(snapshot)).toBe(true)
    expect(flow.phase).toBe('settlement')
    expect(flow.context.characterId).toBe('scholar')
    expect(flow.commit({ ...snapshot, kills: 30 })).toBe(false)
    expect(flow.result?.kills).toBe(15)
    expect(flow.adjudicate(false)).toBe(null)
    expect(flow.phase).toBe('settlement')
  })
  it('普通死亡和退出也直接结算', () => {
    for (const outcome of ['dead', 'quit'] as const) {
      const flow = playing()
      flow.commit({ ...context, outcome, depth: 2, kills: 3, clearedRooms: 1, elapsedMs: 4000 })
      expect(flow.phase).toBe('settlement')
    }
  })
})
