import { describe, expect, it } from 'vitest'
import { GameClock } from '@/core/time'
import { DeferredHitstop } from './DeferredHitstop'

describe('伤害归并后的顿帧', () => {
  it('击杀和下砸的反馈请求不冻结本步后续生产者，步末才合并最长时长', () => {
    const clock = new GameClock()
    const feedback = new DeferredHitstop(clock)
    feedback.request(60)
    feedback.request(45)
    expect(clock.frozen).toBe(false)
    feedback.flush()
    expect(clock.freezeRemainingMs).toBe(60)
    clock.advance(100)
    feedback.flush()
    expect(clock.frozen).toBe(false)
  })
  it('结束战斗或关闭场景时丢弃待播放反馈，恢复不带入旧顿帧', () => {
    const clock = new GameClock()
    const feedback = new DeferredHitstop(clock)
    feedback.request(60)
    clock.pause()
    feedback.flush()
    clock.resume()
    feedback.flush()
    expect(clock.frozen).toBe(false)
    feedback.request(45)
    feedback.clear()
    feedback.flush()
    expect(clock.frozen).toBe(false)
  })
})
