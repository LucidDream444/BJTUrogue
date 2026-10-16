import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { EnemyModel, specFromSplitter, specFromTank, type EnemySpec } from './EnemyModel'
import {
  resetActorIdsForTest,
  type ActorEventSink,
  type DamageEventInfo,
  type KillEventInfo,
} from '@/core/actor/ActorModel'
import type { HitRequest } from '@/core/actor/damage'
import {
  deriveSplitterGeneration,
  deriveTank,
  parseConfigBundle,
  type ConfigBundle,
} from '@/core/config'

const CONFIG_DIR = fileURLToPath(new URL('../../../../public/config/', import.meta.url))

let cachedCfg: ConfigBundle | null = null
/** 读磁盘上真实的三份 JSON。与 `core/config.contract.test.ts` 同一套做法。 */
function realConfig(): ConfigBundle {
  cachedCfg ??= parseConfigBundle({
    balance: JSON.parse(readFileSync(CONFIG_DIR + 'balance.json', 'utf8')),
    difficulty: JSON.parse(readFileSync(CONFIG_DIR + 'difficulty.json', 'utf8')),
    enemies: JSON.parse(readFileSync(CONFIG_DIR + 'enemies.json', 'utf8')),
  })
  return cachedCfg
}

/**
 * 敌人模型的测试。
 *
 * 这里盯的是**「肉盾为什么可以不被 D1 特殊处理」**和**「分裂链不会被一发流弹打断」**
 * 这两条设计承诺。它们是整个敌人域最容易在重构中被无意破坏的地方 ——
 * 破坏之后游戏照样跑，只是割草爽感没了。
 */

const SPLITTER: EnemySpec = {
  kind: 'splitter',
  gen: 0,
  stats: { maxHp: 7, speed: 62, radius: 18 },
  pierceImmune: false,
  graceMs: 220,
  graceMoveMult: 0.5,
  flinchMs: 90,
  slowPerHit: 0,
  slowMaxStacks: 0,
  slowDurationMs: 0,
  slowMultPerStack: 1,
  minSpeedMult: 1,
  vulnerableMult: 1,
}

const TANK: EnemySpec = {
  kind: 'tank',
  gen: 0,
  stats: { maxHp: 520, speed: 52, radius: 40 },
  pierceImmune: false,
  graceMs: 0,
  graceMoveMult: 1,
  flinchMs: 0,
  slowPerHit: 1,
  slowMaxStacks: 12,
  slowDurationMs: 1500,
  slowMultPerStack: 0.95,
  minSpeedMult: 0.25,
  vulnerableMult: 1.25,
}

function req(
  over: Partial<HitRequest> & { frameId: number; nowMs: number },
): HitRequest {
  return {
    sourceId: 1,
    hitKey: `k:${over.frameId}`,
    mode: 'instant',
    amount: 10,
    sourceKind: 'bullet',
    ...over,
  }
}

class RecordingSink implements ActorEventSink {
  readonly damaged: DamageEventInfo[] = []
  readonly killed: KillEventInfo[] = []
  onDamaged(info: DamageEventInfo): void {
    this.damaged.push(info)
  }
  onKilled(info: KillEventInfo): void {
    this.killed.push(info)
  }
}

beforeEach(() => resetActorIdsForTest())

// ------------------------------------------------------------ 穿透：肉盾的身份

describe('肉盾怪 —— 子弹穿透', () => {
  it('子弹打肉盾返回 consumed=false（D1 因此不需要知道有穿透怪存在）', () => {
    const t = new EnemyModel('tank')
    t.respawn(TANK, 0)
    const r = t.takeHit(req({ frameId: 1, nowMs: 0, amount: 10, sourceKind: 'bullet' }))
    expect(r.applied).toBe(10)
    expect(r.consumed).toBe(false) // ← 子弹继续飞
  })

  it('近战打肉盾同样不消耗（接触期间持续结算，不是一次性的）', () => {
    const t = new EnemyModel('tank')
    t.respawn(TANK, 0)
    const r = t.takeHit(req({ frameId: 1, nowMs: 0, amount: 10, sourceKind: 'melee' }))
    expect(r.consumed).toBe(false)
  })

  it('分裂怪挡下子弹（对照组：说明穿透确实是肉盾专有的）', () => {
    const s = new EnemyModel('splitter')
    s.respawn(SPLITTER, 0)
    expect(s.takeHit(req({ frameId: 1, nowMs: 0, amount: 7 })).consumed).toBe(true)
  })

  it('已经死了的尸体不挡子弹（让子弹穿过去，比被尸体吃掉手感好）', () => {
    const t = new EnemyModel('tank')
    t.respawn(TANK, 0)
    t.despawn()
    const r = t.takeHit(req({ frameId: 1, nowMs: 0 }))
    expect(r.consumed).toBe(false)
    expect(r.applied).toBe(0)
  })
})

describe('首领 —— 不吃穿透（同一个 tank 模板，两种身份）', () => {
  const BOSS: EnemySpec = { ...TANK, pierceImmune: true, stats: { maxHp: 520, speed: 48, radius: 34 } }

  it('首领挡下子弹与近战（consumed=true），不接受 100ms 一帧的帧伤', () => {
    const b = new EnemyModel('tank')
    b.respawn(BOSS, 0)
    // 同一只怪、换帧再打：如果这里返回 false，D1 就不会回收子弹，
    // 射线/重叠回调会一直响 —— 520 血的首领几秒被融掉。
    expect(b.takeHit(req({ frameId: 1, nowMs: 0, amount: 10, sourceKind: 'bullet' })).consumed).toBe(true)
    expect(b.takeHit(req({ frameId: 2, nowMs: 16, amount: 10, sourceKind: 'melee' })).consumed).toBe(true)
    expect(b.takeHit(req({ frameId: 3, nowMs: 32, amount: 10, sourceKind: 'aoe' })).consumed).toBe(true)
  })

  it('**池化复用不串味**：首领用过的那只，重生成普通蘑菇怪之后又会穿透', () => {
    // 这是把身份放进 `spec` 而不是「出生时推一下」的全部理由：
    // 模型是池化复用的，漏推一次就是「这只蘑菇免疫穿透」—— 不报错、也不崩，
    // 只是玩家怎么打都打不动它。
    const m = new EnemyModel('tank')
    m.respawn(BOSS, 0)
    expect(m.pierceImmune).toBe(true)

    m.respawn(TANK, 100)
    expect(m.pierceImmune).toBe(false)
    expect(
      m.takeHit(req({ frameId: 1, nowMs: 100, amount: 10, sourceKind: 'bullet' })).consumed,
      '又变回会穿透的普通蘑菇怪了',
    ).toBe(false)
  })

  it('`specFromTank()` 出来的是普通蘑菇怪（首领身份只在 `requestBoss()` 里加）', () => {
    const def = realConfig().enemies.enemies.tank
    const spec = specFromTank(
      deriveTank(def, realConfig().difficulty.difficulties.normal, realConfig().balance),
      def,
    )
    expect(spec.pierceImmune).toBe(false)
  })
})

describe('肉盾怪 —— 易伤窗口', () => {
  it('recover 期间受伤 ×1.25', () => {
    const t = new EnemyModel('tank')
    t.respawn(TANK, 0)
    t.setState('recover', 0)
    expect(t.takeHit(req({ frameId: 1, nowMs: 0, amount: 10 })).applied).toBeCloseTo(12.5, 6)
  })

  it('非 recover 状态不加成', () => {
    const t = new EnemyModel('tank')
    t.respawn(TANK, 0)
    // ⚠️ 每次都要换 frameId：`req()` 默认用 frameId 当 hitKey，
    // 同一个 frameId 连着打三次会被去重挡掉后两次，测出来是「0 伤害」的自欺欺人。
    let frame = 0
    for (const s of ['chase', 'windup', 'stagger'] as const) {
      t.setState(s, 0)
      expect(t.takeHit(req({ frameId: ++frame, nowMs: 0, amount: 10 })).applied, s).toBe(10)
    }
  })

  it('分裂怪永远没有易伤窗口', () => {
    const s = new EnemyModel('splitter')
    s.respawn(SPLITTER, 0)
    // 就算硬把它摆成 recover 也不加成（vulnerableMult 是 1）
    s.setState('recover', 0)
    expect(s.takeHit(req({ frameId: 1, nowMs: 0, amount: 7 })).applied).toBe(7)
  })
})

describe('肉盾怪 —— 越打越慢', () => {
  it('每次掉血叠一层，封顶到 maxStacks', () => {
    const t = new EnemyModel('tank')
    t.respawn(TANK, 0)
    for (let i = 1; i <= 30; i++) {
      t.takeHit(req({ frameId: i, nowMs: i * 10, amount: 1 }))
    }
    expect(t.slowStacks).toBe(TANK.slowMaxStacks)
  })

  it('每次受击都把整批层数的过期时刻推后（Arcade 风格，不逐层计时）', () => {
    const t = new EnemyModel('tank')
    t.respawn(TANK, 0)
    t.takeHit(req({ frameId: 1, nowMs: 100, amount: 1 }))
    expect(t.slowExpireAtMs).toBe(100 + TANK.slowDurationMs)

    t.takeHit(req({ frameId: 2, nowMs: 900, amount: 1 }))
    expect(t.slowExpireAtMs).toBe(900 + TANK.slowDurationMs)
    expect(t.slowStacks).toBe(2)
  })

  it('**不掉血的命中不叠减速**（被去重/无敌帧吃掉的命中不该让它变慢）', () => {
    const t = new EnemyModel('tank')
    t.respawn(TANK, 0)

    // 同一帧内同一个键重复三次，模拟一帧跑了三个物理步、碰撞回调响了三次。
    // 头两次必须挡住 —— 这里踩中过一个真 bug：换帧时提前 return，
    // 导致每帧的头一次命中不记 key，第二次照样结算（伤害翻倍）。
    const first = t.takeHit(req({ frameId: 1, nowMs: 100, amount: 10, hitKey: 'dup' }))
    const second = t.takeHit(req({ frameId: 1, nowMs: 100, amount: 10, hitKey: 'dup' }))
    const third = t.takeHit(req({ frameId: 1, nowMs: 100, amount: 10, hitKey: 'dup' }))

    expect(first.applied).toBe(10)
    expect(second.applied, '同帧第二次必须被去重').toBe(0)
    expect(third.applied).toBe(0)
    expect(t.slowStacks, '被吃掉的命中不叠减速').toBe(1)

    // 换帧后同一把武器可以再打一次（去重是按帧的，不是永久的）
    expect(t.takeHit(req({ frameId: 2, nowMs: 116, amount: 10, hitKey: 'dup' })).applied).toBe(10)
    expect(t.slowStacks).toBe(2)
  })

  it('同一帧内**不同**键各自结算（一发穿透弹依次穿过 3 只怪）', () => {
    const t = new EnemyModel('tank')
    t.respawn(TANK, 0)
    for (const k of ['bullet:1', 'bullet:2', 'bullet:3']) {
      expect(t.takeHit(req({ frameId: 7, nowMs: 0, amount: 5, hitKey: k })).applied, k).toBe(5)
    }
    expect(t.slowStacks).toBe(3)
  })

  it('速度地板：叠满也掉不到 minSpeedMult 以下', () => {
    const t = new EnemyModel('tank')
    t.respawn(TANK, 0)
    for (let i = 1; i <= 20; i++) t.takeHit(req({ frameId: i, nowMs: i, amount: 1 }))
    expect(t.slowMult()).toBeGreaterThanOrEqual(TANK.minSpeedMult)
    expect(t.speedNow(20)).toBeGreaterThanOrEqual(TANK.stats.speed * TANK.minSpeedMult - 1e-9)
  })

  it('过期满整批清零，不是逐层掉', () => {
    const t = new EnemyModel('tank')
    t.respawn(TANK, 0)
    for (let i = 1; i <= 5; i++) t.takeHit(req({ frameId: i, nowMs: i, amount: 1 }))
    expect(t.slowStacks).toBe(5)
    expect(t.speedMult(5 + TANK.slowDurationMs + 1)).toBe(1)
    expect(t.slowStacks).toBe(0)
  })

  it('衰减按 interval 节流：间隔内反复调用不掉层，到点一次掉够', () => {
    const t = new EnemyModel('tank')
    t.respawn(TANK, 0)
    const INTERVAL = 125
    for (let i = 1; i <= 12; i++) t.takeHit(req({ frameId: i, nowMs: 10, amount: 1 }))
    t.lastDecayAtMs = 10
    t.slowExpireAtMs = 10 + 100000 // 排除「整批过期」那条路径，单测衰减

    // 一个 interval 内每 16ms 调一次：一次都不该掉层
    for (let ms = 26; ms < 10 + INTERVAL; ms += 16) {
      expect(t.decaySlow(ms, INTERVAL), `@${ms}`).toBe(false)
    }
    expect(t.slowStacks).toBe(12)

    // 正好一个 interval：掉 1 层
    expect(t.decaySlow(10 + INTERVAL, INTERVAL)).toBe(true)
    expect(t.slowStacks).toBe(11)
  })

  it('掉帧时一次补掉多层，但**不追赶超过当前层数**（不会掉成负数）', () => {
    const t = new EnemyModel('tank')
    t.respawn(TANK, 0)
    const INTERVAL = 125
    for (let i = 1; i <= 3; i++) t.takeHit(req({ frameId: i, nowMs: 0, amount: 1 }))
    t.lastDecayAtMs = 0
    t.slowExpireAtMs = 100000

    // 卡了 2000ms（16 个 interval），但只有 3 层
    expect(t.decaySlow(2000, INTERVAL)).toBe(true)
    expect(t.slowStacks).toBe(0)

    // 「不追赶」的另一面：游标只走到最后一个完整 interval，不会停在 nowMs
    expect(t.lastDecayAtMs).toBe(16 * INTERVAL)
  })

  it('减速会让 speedNow 真的变慢', () => {
    const t = new EnemyModel('tank')
    t.respawn(TANK, 0)
    const full = t.speedNow(0)
    for (let i = 1; i <= 12; i++) t.takeHit(req({ frameId: i, nowMs: 0, amount: 1 }))
    expect(t.speedNow(0)).toBeLessThan(full)
  })
})

// ------------------------------------------------------------ 分裂怪

describe('分裂怪 —— 硬直与分裂链', () => {
  it('受击进入硬直（记的是「结束时刻」，不是剩余时长）', () => {
    const s = new EnemyModel('splitter')
    s.respawn(SPLITTER, 0)
    s.takeHit(req({ frameId: 1, nowMs: 500, amount: 1 }))
    expect(s.flinchUntilMs).toBe(500 + SPLITTER.flinchMs)
  })

  it('⚠️ 死亡过场中受击**不许**再进硬直（否则一发流弹会把整条分裂链删掉）', () => {
    // 这是割草爽感的核心：打死一只 = 分裂出 2 只 = 再打死 = 4 只。
    // 如果分裂延迟那 180ms 里被别的东西蹭一下就把状态改成 flinch，
    // 玩家看到的是「打爆了但什么都没出来」—— 看起来像 bug，爽感也没了。
    const s = new EnemyModel('splitter')
    s.respawn(SPLITTER, 0)
    for (const state of ['splitting', 'dead'] as const) {
      s.flinchUntilMs = 0
      s.setState(state, 0)
      s.takeHit(req({ frameId: 1, nowMs: 1000, amount: 0 }))
      expect(s.flinchUntilMs, state).toBe(0)
      expect(s.state, state).toBe(state)
    }
  })

  it('肉盾永远不硬直（它的受击反馈是减速 + 抖动，不是停顿）', () => {
    const t = new EnemyModel('tank')
    t.respawn(TANK, 0)
    t.takeHit(req({ frameId: 1, nowMs: 100, amount: 10 }))
    expect(t.flinchUntilMs).toBe(0)
  })

  it('分裂怪完全不叠减速（一枪一个，叠了也看不出来）', () => {
    const s = new EnemyModel('splitter')
    s.respawn(SPLITTER, 0)
    for (let i = 1; i <= 5; i++) s.takeHit(req({ frameId: i, nowMs: i, amount: 1 }))
    expect(s.slowStacks).toBe(0)
    // 注意要挑**过了生成宽限**的时刻：宽限期内 speedNow 本来就只有一半，
    // 拿它当基准会把「生成减速」误读成「受击减速」。
    expect(s.speedNow(SPLITTER.graceMs + 1)).toBe(SPLITTER.stats.speed)
  })
})

describe('死亡', () => {
  it('血量归零 → alive=false，且**由 EnemySystem 决定后续**（模型不自己进 splitting）', () => {
    const s = new EnemyModel('splitter')
    s.respawn(SPLITTER, 0)
    const r = s.takeHit(req({ frameId: 1, nowMs: 0, amount: 999 }))
    expect(r.killed).toBe(true)
    expect(s.hp).toBe(0)
    expect(s.alive).toBe(false)
    // 模型不碰状态机 —— 分裂链的启动在 EnemySystem 里（见 SplitterBrain 文件头）。
    // 状态保持致死那一刻的值（这份 spec 有生成宽限，所以是 'spawning'）。
    expect(s.state).toBe('spawning')
  })

  it('伤害被剩余血量截断（applied 不会超过 hp）', () => {
    const s = new EnemyModel('splitter')
    s.respawn(SPLITTER, 0)
    expect(s.takeHit(req({ frameId: 1, nowMs: 0, amount: 999 })).applied).toBe(7)
  })

  it('死亡后继续打不结算，但也不报错', () => {
    const s = new EnemyModel('splitter')
    s.respawn(SPLITTER, 0)
    s.takeHit(req({ frameId: 1, nowMs: 0, amount: 999 }))
    const r = s.takeHit(req({ frameId: 2, nowMs: 10, amount: 10 }))
    expect(r).toEqual({ applied: 0, killed: false, consumed: false })
  })

  it('事件发给注入的 sink（模型不知道事件总线存在）', () => {
    const s = new EnemyModel('splitter')
    const sink = new RecordingSink()
    s.sink = sink
    s.respawn(SPLITTER, 0)
    s.takeHit(req({ frameId: 1, nowMs: 0, amount: 3, sourceId: 42 }))

    expect(sink.damaged).toHaveLength(1)
    expect(sink.damaged[0]).toMatchObject({ amount: 3, hpAfter: 4, sourceId: 42, frameId: 1 })
    expect(sink.killed).toHaveLength(0)

    s.takeHit(req({ frameId: 2, nowMs: 10, amount: 99, sourceId: 42 }))
    expect(sink.killed).toHaveLength(1)
    expect(sink.killed[0]).toMatchObject({ sourceId: 42, frameId: 2 })
  })
})

// ------------------------------------------------------------ 回池

describe('回池复用', () => {
  it('respawn 把**所有**参数整份重写，不留上一只怪的残留', () => {
    const m = new EnemyModel('tank')
    m.respawn(TANK, 0)
    for (let i = 1; i <= 12; i++) m.takeHit(req({ frameId: i, nowMs: i, amount: 1 }))
    m.stuckSinceMs = 111
    m.unstuckUntilMs = 222
    m.staggerUntilMs = 333
    m.staggerReadyAtMs = 444
    m.lateralSign = -1
    m.slamReadyAtMs = 555
    m.hitCount = 9
    m.gen = 5

    // 换成一只分裂怪，参数完全不同
    m.respawn(SPLITTER, 10_000)

    expect(m.slowStacks).toBe(0)
    expect(m.slowExpireAtMs).toBe(0)
    expect(m.slowPerHit).toBe(SPLITTER.slowPerHit)
    expect(m.slowMaxStacks).toBe(SPLITTER.slowMaxStacks)
    expect(m.minSpeedMult).toBe(SPLITTER.minSpeedMult)
    expect(m.vulnerableMult).toBe(SPLITTER.vulnerableMult)
    expect(m.flinchMs).toBe(SPLITTER.flinchMs)
    expect(m.stuckSinceMs).toBe(0)
    expect(m.unstuckUntilMs).toBe(0)
    expect(m.staggerUntilMs).toBe(0)
    expect(m.staggerReadyAtMs).toBe(0)
    expect(m.lateralSign).toBe(1)
    expect(m.hitCount).toBe(0)
    expect(m.gen).toBe(SPLITTER.gen)
    expect(m.graceUntilMs).toBe(10_000 + SPLITTER.graceMs)
    expect(m.state).toBe('spawning')
    expect(m.hp).toBe(SPLITTER.stats.maxHp)
    expect(m.alive).toBe(true)
  })

  it('回池再出生会换一个新的 id（账本靠它做不变式 ④ 的保险）', () => {
    const m = new EnemyModel('splitter')
    m.respawn(SPLITTER, 0)
    const first = m.id
    m.despawn()
    m.respawn(SPLITTER, 100)
    expect(m.id).not.toBe(first)
    expect(m.spawnSeq).toBe(m.id)
  })

  it('despawn 后速度意图归零（否则回池瞬间会带着上一只怪的速度飘一下）', () => {
    const m = new EnemyModel('splitter')
    m.respawn(SPLITTER, 0)
    m.velIntent.x = 999
    m.despawn()
    expect(m.velIntent).toEqual({ x: 0, y: 0 })
  })
})

describe('状态与计时', () => {
  it('前摇时速度钉在 0（这是玩家唯一的「要砸了」信号）', () => {
    const t = new EnemyModel('tank')
    t.respawn(TANK, 0)
    expect(t.speedNow(0)).toBeGreaterThan(0)
    t.setState('windup', 0)
    expect(t.speedNow(0)).toBe(0)
  })

  it('setState 重复调用同一状态不刷新进入时刻', () => {
    const t = new EnemyModel('tank')
    t.respawn(TANK, 0)
    t.setState('windup', 100)
    t.setState('windup', 500)
    expect(t.stateEnteredAtMs).toBe(100)
    expect(t.stateAgeMs(600)).toBe(500)
  })

  it('生成宽限的减速乘数进去，宽限结束自动恢复', () => {
    const s = new EnemyModel('splitter')
    s.respawn(SPLITTER, 0)
    expect(s.speedNow(100)).toBe(SPLITTER.stats.speed * SPLITTER.graceMoveMult)
    expect(s.inGrace(219)).toBe(true)
    expect(s.inGrace(220)).toBe(false)
    expect(s.speedNow(220)).toBe(SPLITTER.stats.speed)
  })
})

// ------------------------------------------------- 与真实配置对接（防漂移）

describe('specFromSplitter / specFromTank —— 对着真实配置', () => {
  it('从磁盘上的 enemies.json 派生的 spec 与手写夹具一致', () => {
    // 手写夹具的好处是「改了配置不会连带改测试」，坏处是**它会悄悄落后于配置**，
    // 于是测试全绿但测的是一个已经不存在的游戏。这里用真实配置对一次账。
    const cfg = realConfig()
    const def = cfg.enemies.enemies.splitter
    const gen0 = deriveSplitterGeneration(
      def.generations[0]!,
      cfg.difficulty.difficulties.normal,
      cfg.balance,
    )
    const splitter = specFromSplitter(gen0, def)

    expect(splitter.kind).toBe('splitter')
    expect(splitter.gen).toBe(0)
    expect(splitter.flinchMs).toBe(def.ai.flinchMs)
    expect(splitter.graceMs).toBe(gen0.graceMs)
    expect(splitter.graceMoveMult).toBe(gen0.graceMoveMult)
    expect(splitter.stats.speed).toBe(gen0.speed)
    expect(splitter.stats.radius).toBe(gen0.radius)
    // 分裂怪不叠减速：这条是设计承诺，不是巧合
    expect(splitter.slowPerHit).toBe(0)
    expect(splitter.slowMaxStacks).toBe(0)
    expect(splitter.vulnerableMult).toBe(1)
    // 与夹具对齐
    expect(splitter.stats.radius).toBe(SPLITTER.stats.radius)
    expect(splitter.stats.speed).toBe(SPLITTER.stats.speed)
    expect(splitter.flinchMs).toBe(SPLITTER.flinchMs)
  })

  it('肉盾的 spec 把 hitSlow / slam 的配置全部接上', () => {
    const cfg = realConfig()
    const tankDef = cfg.enemies.enemies.tank
    const tank = specFromTank(
      deriveTank(tankDef, cfg.difficulty.difficulties.normal, cfg.balance),
      tankDef,
    )

    expect(tank.slowPerHit).toBe(tankDef.hitSlow.stackPerHit)
    expect(tank.slowMaxStacks).toBe(tankDef.hitSlow.maxStacks)
    expect(tank.slowMultPerStack).toBeCloseTo(tankDef.hitSlow.speedMultPerStack, 6)
    expect(tank.minSpeedMult).toBe(tankDef.hitSlow.minSpeedMult)
    expect(tank.slowDurationMs).toBe(tankDef.hitSlow.stackDurationMs)
    expect(tank.vulnerableMult).toBe(tankDef.slam.vulnerableDamageMult)
    // 肉盾不硬直：它的受击反馈是减速 + 抖动
    expect(tank.flinchMs).toBe(0)
    expect(tank.graceMs).toBe(0)
    // 与夹具对齐
    expect(tank.stats.radius).toBe(TANK.stats.radius)
    expect(tank.slowMaxStacks).toBe(TANK.slowMaxStacks)
    expect(tank.vulnerableMult).toBe(TANK.vulnerableMult)
    expect(tank.minSpeedMult).toBe(TANK.minSpeedMult)
  })
})