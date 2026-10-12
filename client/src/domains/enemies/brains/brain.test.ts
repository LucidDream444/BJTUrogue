import { describe, expect, it } from 'vitest'
import { EnemyFixture, TICK_MS, fakeNav, makePlayerSnapshot } from '../testSupport'
import { makeSplitterBrain } from './SplitterBrain'
import { makeTankBrain, type TankBrainParams } from './TankBrain'
import type { EnemySpec } from '../model/EnemyModel'

/**
 * 两个 brain 的行为测试。
 *
 * 这些用例盯的是**「会不会卡死」和「该不该动」**，不是数值手感：
 * 状态机卡住、攻击重复发出、反卡死把怪推得更死 —— 这三类问题在肉眼里全是
 * 「这只怪有点怪」，但在代码里是硬 bug。数值手感由 `EnemySystem` 的集成测试与
 * 试玩测试场负责。
 */

const SPLITTER: Partial<EnemySpec> = {
  stats: { maxHp: 7, speed: 60, radius: 18 },
  flinchMs: 90,
}

/** 与 `public/config/enemies.json` 的 tank 段保持一致；配置改了这里也该改。 */
const TANK_PARAMS: TankBrainParams = {
  sepStrength: 30,
  sepPad: 6,
  slamRange: 96,
  slamWindupMs: 700,
  slamCooldownMs: 2400,
  slamRecoverMs: 900,
  slamDamage: 22,
  slamRadius: 110,
  slamKnockback: 240,
  slamHitstopMs: 60,
  unstuckMs: 400,
  stuckSpeedThreshold: 4,
  lateralEscapeMs: 600,
  lateralSpeedMult: 1.2,
  staggerMs: 800,
  staggerSpeedMult: 0.2,
  staggerCooldownMs: 3000,
}

const TANK: Partial<EnemySpec> = {
  stats: { maxHp: 520, speed: 52, radius: 40 },
  flinchMs: 0,
  slowPerHit: 1,
  slowMaxStacks: 12,
  slowDurationMs: 1500,
  slowMultPerStack: 0.95,
  minSpeedMult: 0.25,
  vulnerableMult: 1.25,
}

type FixtureOver = Partial<ConstructorParameters<typeof EnemyFixture>[0]>

function splitterFixture(over: FixtureOver = {}): EnemyFixture {
  return new EnemyFixture({
    kind: 'splitter',
    spec: SPLITTER,
    brain: (m) => makeSplitterBrain(m, { sepStrength: 40, sepPad: 4 }),
    ...over,
  })
}

function tankFixture(over: FixtureOver = {}): EnemyFixture {
  return new EnemyFixture({
    kind: 'tank',
    spec: TANK,
    brain: (m) => makeTankBrain(m, TANK_PARAMS),
    ...over,
  })
}

// ---------------------------------------------------------------- 分裂怪

describe('SplitterBrain', () => {
  it('朝目标移动', () => {
    const f = splitterFixture({ x: 0, y: 0, target: makePlayerSnapshot(200, 0) })
    const out = f.step()
    expect(out.vx).toBeGreaterThan(0)
    expect(out.vy).toBeCloseTo(0, 5)
  })

  it('生成宽限期内减速，且宽限走完后自动转 chase', () => {
    const f = splitterFixture({
      spec: { ...SPLITTER, graceMs: 220, graceMoveMult: 0.5 },
      target: makePlayerSnapshot(400, 0),
    })

    const early = f.step()
    expect(early.nextState).toBe('spawning')
    expect(Math.hypot(early.vx, early.vy)).toBeCloseTo(30, 4) // 60 × 0.5

    f.stepUntil((x) => x.nowMs > 220)
    const late = f.step()
    expect(late.nextState).toBe('chase')
    expect(Math.hypot(late.vx, late.vy)).toBeCloseTo(60, 4)
  })

  it('硬直期间停住', () => {
    const f = splitterFixture({ target: makePlayerSnapshot(200, 0) })
    f.step()
    f.model.flinchUntilMs = f.nowMs + 500
    f.model.setState('flinch', f.nowMs)

    const out = f.step()
    expect(out.vx).toBe(0)
    expect(out.vy).toBe(0)
    expect(out.nextState).toBe('flinch')
  })

  it('⚠️ 硬直刚走完的那一 tick 必须报 chase，不能继续报 flinch', () => {
    // 回归测试：曾经 brain 在末尾无脑写 `out.nextState = model.state`，
    // 而那一刻 system 还没把 'flinch' 写回模型 —— 于是它算出了移动意图，
    // 却把状态报成 flinch，下一 tick 又被自己报的状态拦住。
    // 表现是「被擦一下之后这只怪永远站着不动」，且不报任何错。
    const f = splitterFixture({ target: makePlayerSnapshot(200, 0) })
    f.model.flinchUntilMs = 90
    f.model.setState('flinch', 0)

    // 差一毫秒：还是硬直
    const before = f.step(89)
    expect(f.nowMs).toBe(89)
    expect(before.nextState).toBe('flinch')
    expect(before.vx).toBe(0)

    // 正好到点：必须自己爬出 flinch 并真的动起来
    const out = f.step(1)
    expect(f.nowMs).toBe(90)
    expect(out.nextState).toBe('chase')
    expect(Math.hypot(out.vx, out.vy)).toBeGreaterThan(0)
  })

  it('splitting / dead 期间原地不动（死亡过场归 EnemySystem，brain 不许插手）', () => {
    for (const state of ['splitting', 'dead'] as const) {
      const f = splitterFixture({ target: makePlayerSnapshot(200, 0) })
      f.model.setState(state, 0)
      const out = f.step()
      expect(out.vx, state).toBe(0)
      expect(out.vy, state).toBe(0)
      expect(out.nextState, state).toBe(state)
      expect(f.model.state, state).toBe(state) // 不许被 brain 改回去
    }
  })

  it('已死（alive=false）也停住', () => {
    const f = splitterFixture({ target: makePlayerSnapshot(200, 0) })
    f.model.alive = false
    const out = f.step()
    expect(out.vx).toBe(0)
    expect(out.vy).toBe(0)
  })

  it('看不到目标时走流向场，看得见时走直线（消掉 8 方向量化）', () => {
    const blocked = splitterFixture({
      target: makePlayerSnapshot(200, 0),
      nav: fakeNav({ x: 0, y: 1 }, false), // 没视线，场说「往下」
    })
    const a = blocked.step()
    expect(a.vx).toBeCloseTo(0, 5)
    expect(a.vy).toBeGreaterThan(0)

    const clear = splitterFixture({
      target: makePlayerSnapshot(200, 0),
      nav: fakeNav({ x: 0, y: 1 }, true), // 有视线 → 无视场的 8 方向
    })
    const b = clear.step()
    expect(b.vx).toBeGreaterThan(0)
    expect(b.vy).toBeCloseTo(0, 5)
  })

  it('nav 为 null（没墙的场）走直线，**不是**站着不动', () => {
    const f = splitterFixture({ target: makePlayerSnapshot(0, 200), nav: null })
    const out = f.step()
    expect(out.vy).toBeGreaterThan(0)
  })

  it('流向场说「帮不上忙」时也退回直线追', () => {
    const f = splitterFixture({
      target: makePlayerSnapshot(200, 0),
      nav: fakeNav(null, false), // 不可达 / 在网格外
    })
    const out = f.step()
    expect(out.vx).toBeGreaterThan(0)
  })

  it('没有目标时靠分离力散开，不叠成一坨', () => {
    const neighbor = makePlayerSnapshot(60, 0)
    neighbor.kind = 'enemy'
    const f = splitterFixture({
      x: 60,
      y: 0,
      target: null,
      neighbors: [neighbor],
      id: 1,
    })
    const out = f.step()
    expect(Math.hypot(out.vx, out.vy)).toBeGreaterThan(0)
  })

  it('brain 是纯函数：算一次不留任何痕迹', () => {
    const f = splitterFixture({ target: makePlayerSnapshot(200, 0) })
    f.step()
    const before = {
      state: f.model.state,
      stateEntered: f.model.stateEnteredAtMs,
      vel: { ...f.model.velIntent },
      flinch: f.model.flinchUntilMs,
    }

    f.peek() // 只算不写

    expect(f.model.state).toBe(before.state)
    expect(f.model.stateEnteredAtMs).toBe(before.stateEntered)
    expect(f.model.velIntent).toEqual(before.vel)
    expect(f.model.flinchUntilMs).toBe(before.flinch)
  })
})

// ---------------------------------------------------------------- 肉盾怪

describe('TankBrain — 下砸循环', () => {
  it('进入射程且冷却好了 → 起手前摇，站定不动', () => {
    // 目标距离 60 < slamRange 96
    const f = tankFixture({ x: 0, y: 0, target: makePlayerSnapshot(60, 0) })
    const out = f.step()
    expect(out.nextState).toBe('windup')
    expect(out.vx).toBe(0)
    expect(out.vy).toBe(0)
    expect(out.attack).toBeUndefined() // 前摇刚开始，还没砸
  })

  it('前摇期间一直站定，且**只在结束的那一 tick** 发出一次砸击', () => {
    const f = tankFixture({ x: 0, y: 0, target: makePlayerSnapshot(60, 0) })
    f.step() // 进入 windup
    expect(f.model.state).toBe('windup')

    let attacks = 0
    let lastKnock = { x: 0, y: 0 }
    for (let i = 0; i < 60; i++) {
      const out = f.step()
      if (out.attack) {
        attacks++
        lastKnock = { x: out.attack.knockback!.x, y: out.attack.knockback!.y }
        expect(out.attack.kind).toBe('slam')
        expect(out.attack.damage).toBe(TANK_PARAMS.slamDamage)
        expect(out.nextState).toBe('recover')
      }
      // 前摇期间物理速度必须真的是 0（站定是玩家唯一的「要砸了」信号）
      if (f.model.state === 'windup') {
        expect(f.model.speedNow(f.nowMs)).toBe(0)
        expect(out.vx).toBe(0)
        expect(out.vy).toBe(0)
      }
      if (attacks > 0) break
    }

    expect(attacks).toBe(1)
    // 击退原点是自己，不是目标 —— 写反了会把玩家往怪身上吸
    expect(lastKnock.x).toBeCloseTo(f.x, 5)
    expect(lastKnock.y).toBeCloseTo(f.y, 5)
  })

  it('前摇时长约等于配置值（±1 tick）', () => {
    const f = tankFixture({ x: 0, y: 0, target: makePlayerSnapshot(60, 0) })
    f.step()
    const startMs = f.nowMs

    let attackAt = -1
    for (let i = 0; i < 200; i++) {
      if (f.step().attack) {
        attackAt = f.nowMs
        break
      }
    }
    expect(attackAt).toBeGreaterThan(0)
    const windup = attackAt - startMs
    expect(windup).toBeGreaterThanOrEqual(TANK_PARAMS.slamWindupMs)
    expect(windup).toBeLessThan(TANK_PARAMS.slamWindupMs + TICK_MS * 2)
  })

  it('恢复窗内不再攻击', () => {
    const f = tankFixture({ x: 0, y: 0, target: makePlayerSnapshot(60, 0) })
    f.step()
    f.stepUntil((x) => x.lastAttack !== undefined)
    expect(f.model.state).toBe('recover')

    for (let i = 0; i < 30; i++) {
      const out = f.step()
      expect(out.attack).toBeUndefined()
    }
  })

  it('恢复窗走完回到追击', () => {
    const f = tankFixture({ x: 0, y: 0, target: makePlayerSnapshot(60, 0) })
    f.step()
    f.stepUntil((x) => x.lastAttack !== undefined)

    const ok = f.stepUntil((x) => x.model.state === 'chase', 200)
    expect(ok).toBeGreaterThan(0)
  })

  it('冷却没到就不许再起手（哪怕一直贴着）', () => {
    const f = tankFixture({ x: 0, y: 0, target: makePlayerSnapshot(60, 0) })
    f.step()
    const firstWindupAt = f.nowMs

    f.stepUntil((x) => x.lastAttack !== undefined) // 第一次砸完
    const ticks = f.stepUntil((x) => x.model.state === 'windup', 500)
    expect(ticks, '冷却走完后应该会再次起手').toBeGreaterThan(0)

    // 两次前摇之间的间隔必须 >= 配置冷却
    expect(f.nowMs - firstWindupAt).toBeGreaterThanOrEqual(TANK_PARAMS.slamCooldownMs)

    // 而且中间确实有一段纯追击期（冷却比前摇+恢复长，不是无缝衔接）
    const firstCycleEnded = firstWindupAt + TANK_PARAMS.slamWindupMs + TANK_PARAMS.slamRecoverMs
    expect(f.nowMs - firstCycleEnded).toBeGreaterThan(0)
  })

  it('冷却从进入前摇就开始算，不与前摇重复累加', () => {
    // 如果实现写成「砸完才开始冷却」，实际周期会变成 cooldown + windup + recover，
    // 与配置里的 cooldownMs 对不上，调参时会被这个差值误导。
    const f = tankFixture({ x: 0, y: 0, target: makePlayerSnapshot(60, 0) })
    const out = f.step()
    expect(out.nextState).toBe('windup')
    expect(f.model.slamReadyAtMs).toBe(f.nowMs + TANK_PARAMS.slamCooldownMs)
  })

  it('目标太远就不起手，正常追过去', () => {
    const f = tankFixture({ x: 0, y: 0, target: makePlayerSnapshot(400, 0) })
    const out = f.step()
    expect(out.nextState).toBe('chase')
    expect(out.vx).toBeGreaterThan(0)
  })

  it('没有目标时不崩、不攻击', () => {
    const f = tankFixture({ x: 0, y: 0, target: null })
    const out = f.step()
    expect(out.attack).toBeUndefined()
    expect(Number.isFinite(out.vx)).toBe(true)
    expect(Number.isFinite(out.vy)).toBe(true)
  })
})

describe('TankBrain — 踉跄', () => {
  it('⚠️ 减速叠满期间踉跄是间歇性的，不能无限连（否则等于罚站死）', () => {
    // 回归测试：判据若写成 `nowMs >= staggerUntilMs`，踉跄一结束就立刻再次满足，
    // 而这段时间减速一直叠满 —— 肉盾从此彻底站定。配置里 `minSpeedMult`
    // 那道速度地板正是为了防这件事，这个 bug 会绕过它，且不报任何错。
    const f = tankFixture({ x: 0, y: 0, target: makePlayerSnapshot(400, 0) })

    let staggered = 0
    const TICKS = 200 // 3.2s
    for (let i = 0; i < TICKS; i++) {
      // 每 tick 补满减速，模拟玩家持续输出
      f.model.slowStacks = f.model.slowMaxStacks
      f.model.slowExpireAtMs = f.nowMs + 1500
      const out = f.step()
      if (out.nextState === 'stagger') staggered++
    }

    expect(staggered, '应该会踉跄').toBeGreaterThan(0)
    // 800ms 踉跄 + 3000ms 冷却 → 3.2s 内最多两次，绝不该是全部
    expect(staggered, '踉跄不能占满全程').toBeLessThan(TICKS / 2)
  })

  it('踉跄期间速度被压到地板以下（但不为 NaN）', () => {
    const f = tankFixture({ x: 0, y: 0, target: makePlayerSnapshot(400, 0) })
    f.model.slowStacks = f.model.slowMaxStacks
    // ⚠️ 别忘了延迟过期时刻。`speedMult()` 里有一句
    // `if (nowMs >= slowExpireAtMs) slowStacks = 0`，只设层数不设过期时刻的话，
    // 下一 tick 层数就被清零了 —— 测试会静默地测到「完全没有减速」的路径。
    f.model.slowExpireAtMs = f.nowMs + 5000
    f.model.staggerUntilMs = f.nowMs + 800
    f.model.setState('stagger', f.nowMs)

    const out = f.step()
    const speed = Math.hypot(out.vx, out.vy)
    expect(speed).toBeGreaterThanOrEqual(0)
    // 52 × 0.25（地板）× 0.2（踉跄）+ 一点点分离力容忍
    expect(speed).toBeLessThan(52 * 0.25 * 0.2 + 5)
  })
})

describe('TankBrain — 反卡死', () => {
  it('被顶住足够久之后开始侧向逃逸（方向与目标连线垂直）', () => {
    const f = tankFixture({ x: 0, y: 0, target: makePlayerSnapshot(400, 0) })
    f.pinned = true

    // 先跑过 unstuckMs（400ms）
    const ticked = f.stepUntil((x) => x.nowMs >= 400 + TICK_MS * 2, 100)
    expect(ticked).toBeGreaterThan(0)

    const out = f.step()
    const speed = Math.hypot(out.vx, out.vy)
    expect(speed, '逃逸时必须在动').toBeGreaterThan(0)
    // 目标在正右方，侧向 = 正上或正下 → vx 必须是 0
    expect(Math.abs(out.vx)).toBeCloseTo(0, 4)
    expect(Math.abs(out.vy)).toBeGreaterThan(0)
  })

  it('逃逸方向跨 tick 保持不变（否则会原地抽搐）', () => {
    const f = tankFixture({ x: 0, y: 0, target: makePlayerSnapshot(400, 0) })
    f.pinned = true
    f.stepUntil((x) => x.nowMs >= 400 + TICK_MS * 2, 100)

    expect(f.model.unstuckUntilMs).toBeGreaterThan(f.nowMs) // 确认处在逃逸中

    const signs = new Set<number>()
    for (let i = 0; i < 10; i++) {
      const out = f.step()
      if (out.vy !== 0) signs.add(Math.sign(out.vy))
    }
    expect(signs.size, '逃逸途中不该左右翻面').toBe(1)
  })

  it('没卡住时不会误触发逃逸', () => {
    const f = tankFixture({ x: 0, y: 0, target: makePlayerSnapshot(400, 0) })
    for (let i = 0; i < 40; i++) {
      const out = f.step()
      // 正常追击：一路向右，vy 应始终保持 0
      expect(out.vy).toBeCloseTo(0, 5)
      expect(out.vx).toBeGreaterThan(0)
    }
  })
})