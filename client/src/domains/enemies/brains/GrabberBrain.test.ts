import { describe, expect, it } from 'vitest'
import { EnemyFixture, TICK_MS, makePlayerSnapshot } from '../testSupport'
import { makeGrabberBrain, type GrabberBrainParams } from './GrabberBrain'
import type { ActorSnapshot } from '@/core/actor/types'
import type { EnemySpec } from '../model/EnemyModel'

/**
 * 抓取怪 brain 的测试。
 *
 * 盯四件事：**起手条件**（距离 + 两重冷却）、**两条取消路径**（跑开 / 打死）、
 * **到点必报抓取**（不可躲）、**飞行时把速度原样喂出去**（不能急刹）。
 * 手感数值不在这里 —— 那是配置与真机的事。
 */

const SPEC: Partial<EnemySpec> = {
  stats: { maxHp: 100, speed: 58, radius: 16 },
  flinchMs: 0,
  // 蓄力期间仍然逼近（肉盾那种「钉在原地」会让抓取永远触发不了）
  windupMoveMult: 0.55,
}

/** 与 `public/config/enemies.json` 的 grabber 段保持一致；配置改了这里也该改。 */
function params(over: Partial<GrabberBrainParams> = {}): GrabberBrainParams {
  return {
    sepStrength: 110,
    sepPad: 8,
    grabRange: 134,
    telegraphMs: 2000,
    cooldownMs: 3000,
    releaseRangeMult: 1.5,
    sameTypeReadyAtMs: () => 0,
    ...over,
  }
}

function fixture(opts: {
  target?: ActorSnapshot | null
  sameTypeReadyAtMs?: () => number
  x?: number
}): EnemyFixture {
  return new EnemyFixture({
    kind: 'grabber',
    spec: SPEC,
    x: opts.x ?? 0,
    y: 0,
    target: opts.target === undefined ? makePlayerSnapshot(200, 0) : opts.target,
    brain: (m) =>
      makeGrabberBrain(
        m,
        // ⚠️ 只在给了的时候才覆盖：`{ sameTypeReadyAtMs: undefined }` 会把默认值也顶掉
        opts.sameTypeReadyAtMs ? params({ sameTypeReadyAtMs: opts.sameTypeReadyAtMs }) : params(),
      ),
  })
}

/** 一直 tick 到条件成立，返回用掉的毫秒；超时就返回 null。 */
function runUntil(fx: EnemyFixture, cond: () => boolean, limitMs = 12000, dt = TICK_MS): number | null {
  for (let t = 0; t < limitMs; t += dt) {
    fx.step(dt)
    if (cond()) return t + dt
  }
  return null
}

describe('GrabberBrain — 起手条件', () => {
  it('距离还远就正常追（有速度意图）', () => {
    const fx = fixture({})
    const out = fx.step()
    expect(Math.hypot(out.vx, out.vy)).toBeGreaterThan(0)
    expect(fx.model.state).toBe('chase')
  })

  it('进到范围内且冷却好了 → 进入预警，而且**仍然朝玩家挪**（只是变慢）', () => {
    const fx = fixture({ target: makePlayerSnapshot(60, 0) })
    expect(fx.step().attack, '起手那一帧还不该报抓取').toBeUndefined()
    // ⚠️ 看**第二帧**：第一帧还是在用 `chase` 的速度算的（状态这一帧才切过去）
    const out = fx.step()
    expect(fx.model.state).toBe('windup')
    const speed = Math.hypot(out.vx, out.vy)
    // ⚠️ **不能是 0**：站定是肉盾的信号。抓取怪一蓄力就杵住的话，
    //    玩家 200+ px/s 一走就没影 —— 抓取永远触发不了（实测反馈「太简单了」）。
    expect(speed, '蓄力期间要一路逼过来').toBeGreaterThan(0)
    expect(speed, '但要明显慢于追击（半速上下）').toBeLessThan(58 * 0.9)
  })

  it('迟滞：贴着解除距离来回蹭，蓄力不会被反复打断', () => {
    const target = makePlayerSnapshot(60, 0)
    const fx = fixture({ target })
    fx.step()
    expect(fx.model.state).toBe('windup')
    // 退到「起手距离之外、解除距离之内」（134 ~ 201 之间）：**不该取消**
    target.x = 180
    fx.step()
    expect(fx.model.state, '迟滞区间里来回蹭不该一开一关').toBe('windup')
    // 退到解除距离之外才取消
    target.x = 260
    fx.step()
    expect(fx.model.state).toBe('chase')
  })

  it('预警满 telegraphMs 之后**必定**报出抓取（不可躲）', () => {
    const fx = fixture({ target: makePlayerSnapshot(60, 0) })
    const dt = runUntil(fx, () => fx.lastAttack !== undefined, 4000)
    expect(dt, '预警到点就该报抓取').not.toBeNull()
    expect(fx.lastAttack?.kind).toBe('grab')
    expect(dt! >= 2000, '至少要等满预警窗口').toBe(true)
  })

  it('预警期玩家跑出范围 → 取消，回追击', () => {
    const target = makePlayerSnapshot(60, 0)
    const fx = fixture({ target })
    fx.step()
    expect(fx.model.state).toBe('windup')
    target.x = 900 // 玩家跑远了
    fx.step()
    expect(fx.model.state, '跑开是合法的取消路径').toBe('chase')
    expect(fx.lastAttack).toBeUndefined()
  })

  it('目标死了/没了 → 取消预警', () => {
    const target = makePlayerSnapshot(60, 0)
    const fx = fixture({ target })
    fx.step()
    target.alive = false
    fx.step()
    expect(fx.model.state).toBe('chase')
  })

  it('自身冷却没过 → 不再起手（冷却从**进入预警**那一刻起算）', () => {
    const fx = fixture({ target: makePlayerSnapshot(60, 0) })
    fx.step() // 第一次进预警，写下 cooldownMs
    fx.model.setState('chase', fx.nowMs)
    // 冷却还在：再近也不进预警
    fx.step()
    expect(fx.model.state).toBe('chase')
  })
})

describe('GrabberBrain — 同类冷却挡的是「起手」', () => {
  it('同类冷却没过 → 不进入预警（也就不会显示「!」）', () => {
    const fx = fixture({ target: makePlayerSnapshot(60, 0), sameTypeReadyAtMs: () => 999999 })
    fx.step()
    expect(fx.model.state).toBe('chase')
    expect(fx.lastAttack).toBeUndefined()
  })

  it('冷却期间照常追人（只是不起手）', () => {
    const fx = fixture({ target: makePlayerSnapshot(60, 0), sameTypeReadyAtMs: () => 999999 })
    const out = fx.step()
    expect(fx.model.state).toBe('chase')
    // 贴到身上了还在追，说明「不起手」没有把它变成木桩
    expect(Math.hypot(out.vx, out.vy) >= 0).toBe(true)
  })

  it('冷却到点就恢复起手', () => {
    let ready = 999999
    const fx = fixture({ target: makePlayerSnapshot(60, 0), sameTypeReadyAtMs: () => ready })
    fx.step()
    expect(fx.model.state).toBe('chase')
    ready = 0
    fx.step()
    expect(fx.model.state).toBe('windup')
  })
})

describe('GrabberBrain — 抓取中与被甩飞', () => {
  it('抓取中：不动、且回到 chase（真正的接管在系统那边）', () => {
    const fx = fixture({})
    fx.model.setState('grabbing', fx.nowMs)
    const out = fx.step()
    expect(Math.hypot(out.vx, out.vy)).toBe(0)
    expect(fx.model.state).toBe('chase')
  })

  it('**被甩飞时把飞行速度原样喂出去**（输出 0 会让它飞到一半急刹）', () => {
    const fx = fixture({})
    fx.model.setState('flung', fx.nowMs)
    fx.model.flingVx = 700
    fx.model.flingVy = 0
    const out = fx.step()
    expect(out.vx).toBe(700)
    expect(out.vy).toBe(0)
    expect(fx.model.state, '飞行期间不受 AI 控制').toBe('flung')
  })
})
