import { describe, expect, it } from 'vitest'
import { RunFlow } from './RunFlow'

const context = { runId: 'run-1', characterId: 'scholar', difficulty: 'normal' as const }

function playing() {
  const flow = new RunFlow(context)
  expect(flow.finishStory(context.runId, 'run-1:intro')).toBe(true)
  return flow
}

describe('本局故事与胜负流程', () => {
  it('开场与结局完成必须匹配本局请求且只推进一次', () => {
    const flow = new RunFlow(context)
    expect(flow.finishStory('old', 'run-1:intro')).toBe(false)
    expect(flow.phase).toBe('intro')
    expect(flow.finishStory('run-1', 'run-1:intro')).toBe(true)
    expect(flow.finishStory('run-1', 'run-1:intro')).toBe(false)
    expect(flow.phase).toBe('playing')
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
  it('冻结角色和结果，结局结束后展示结算，重复提交不会覆盖收益', () => {
    const mutableContext = { ...context }
    const flow = new RunFlow(mutableContext)
    mutableContext.characterId = 'student'
    flow.finishStory('run-1', 'run-1:intro')
    flow.recordFinalBossDeath()
    expect(flow.adjudicate(true)).toBe('cleared')
    const snapshot = { ...context, outcome: 'cleared' as const, depth: 8, kills: 15, clearedRooms: 12, elapsedMs: 8000 }
    expect(flow.commit(snapshot)).toBe(true)
    expect(flow.phase).toBe('ending')
    expect(flow.context.characterId).toBe('scholar')
    expect(flow.commit({ ...snapshot, kills: 30 })).toBe(false)
    expect(flow.result?.kills).toBe(15)
    expect(flow.adjudicate(false)).toBe(null)
    expect(flow.finishStory('run-1', 'run-1:ending')).toBe(true)
    expect(flow.phase).toBe('settlement')
  })
  it('普通死亡和退出不请求胜利故事', () => {
    for (const outcome of ['dead', 'quit'] as const) {
      const flow = playing()
      flow.commit({ ...context, outcome, depth: 2, kills: 3, clearedRooms: 1, elapsedMs: 4000 })
      expect(flow.phase).toBe('settlement')
      expect(flow.activeStory).toBe(null)
    }
  })
})
