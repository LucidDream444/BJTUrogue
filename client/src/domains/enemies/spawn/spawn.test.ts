import { describe, expect, it, vi } from 'vitest'
import { SpawnQueue, type SpawnQueueConfig, type SpawnRequest } from './SpawnQueue'
import { countSplitChain, planSplitChildren } from './splitFan'
import { EnemyPool, type PooledEnemy } from '../pool/EnemyPool'
import { makeSpec } from '../testSupport'
import type { EnemyKind } from '@/core/events'

/**
 * 刷怪队列、分裂扇形、对象池。
 *
 * 这一片是「怪多了也不卡」和「割草节奏」的交界处，所以测试盯两类东西：
 * ① **节流数学**（推后是钳还是累加、积压判定用哪个时间戳）——
 *    错了以后表现是「分裂链凭空断掉」，而且只在场上满员时才复现；
 * ② **池的账**（重复释放、回池串味、账本配对）—— 错了表现是「一出生就在挨打」。
 */

const CFG: SpawnQueueConfig = {
  maxSpawnsPerFrame: 8,
  overflowStaggerMs: 40,
  maxAliveSoft: 180,
  maxAliveHard: 260,
  maxQueueAgeMs: 8000,
  maxQueueLength: 64,
}

function req(over: Partial<SpawnRequest> = {}): SpawnRequest {
  return {
    spec: makeSpec('splitter'),
    x: 0,
    y: 0,
    atMs: 0,
    enqueuedAtMs: 0,
    reason: 'split',
    ...over,
  }
}

describe('SpawnQueue — 基本节流', () => {
  it('单帧最多刷 maxSpawnsPerFrame 只，剩下的留到下一帧', () => {
    const q = new SpawnQueue(CFG)
    for (let i = 0; i < 20; i++) q.push(req({ atMs: 0 }))

    const a = q.drain(0, 0)
    expect(a.spawned).toHaveLength(8)
    expect(a.pending).toBe(12)

    const b = q.drain(0, 8)
    expect(b.spawned).toHaveLength(8)
    expect(b.pending).toBe(4)
  })

  it('没到点的取不走', () => {
    const q = new SpawnQueue(CFG)
    q.push(req({ atMs: 500 }))
    expect(q.drain(499, 0).spawned).toHaveLength(0)
    expect(q.drain(500, 0).spawned).toHaveLength(1)
  })

  it('按 atMs 升序出队（先排的先生）', () => {
    const q = new SpawnQueue(CFG)
    q.push(req({ atMs: 300, fromId: 3 }))
    q.push(req({ atMs: 100, fromId: 1 }))
    q.push(req({ atMs: 200, fromId: 2 }))

    const out = q.drain(1000, 0).spawned
    expect(out.map((r) => r.fromId)).toEqual([1, 2, 3])
  })

  it('maxSpawnsPerFrame = 0 直接抛（不许配出一个永远刷不出怪的队列）', () => {
    expect(() => new SpawnQueue({ ...CFG, maxSpawnsPerFrame: 0 })).toThrow()
  })

  it('maxAliveHard < maxAliveSoft 直接抛', () => {
    expect(() => new SpawnQueue({ ...CFG, maxAliveSoft: 100, maxAliveHard: 50 })).toThrow()
  })
})

describe('SpawnQueue — 软上限（场上太满）', () => {
  it('超软上限时整队推后，一只都不刷', () => {
    const q = new SpawnQueue(CFG)
    q.push(req({ atMs: 0 }))
    q.push(req({ atMs: 0 }))

    const r = q.drain(0, CFG.maxAliveSoft)
    expect(r.spawned).toHaveLength(0)
    expect(r.throttled).toBe(true)
    expect(q.peek()[0]!.atMs).toBe(CFG.overflowStaggerMs) // 推后了
  })

  it('⚠️ 推后是**钳**不是累加：满员很久，场上空了之后怪要立刻能出来', () => {
    // 回归测试。写成 `atMs += overflowStaggerMs` 的话：
    // 满员 10 秒（600 帧）× 40ms = 每条请求的 atMs 被推到 24 秒之后。
    // 场上空了以后玩家要等 24 秒才看到分裂出来的怪 —— 读起来就是「分裂链断了」。
    const q = new SpawnQueue(CFG)
    q.push(req({ atMs: 0, enqueuedAtMs: 0 }))

    let nowMs = 0
    // 300 帧 = 4.8 秒。**要短于 `maxQueueAgeMs`**，否则测的是积压丢弃那条路径，
    // 而不是「钳 vs 累加」。
    for (let i = 0; i < 300; i++) {
      nowMs += 16
      q.drain(nowMs, CFG.maxAliveSoft) // 一直满员
    }

    // 场上突然空了
    const r = q.drain(nowMs, 0)
    // 已到期的必须**立刻**刷出来（推后量只有一格 stagger，不是 600 格）
    const r2 = q.drain(nowMs + CFG.overflowStaggerMs, r.spawned.length)
    expect(r.spawned.length + r2.spawned.length).toBe(1)
    expect(q.length).toBe(0)
  })

  it('⚠️ 满员期间积压兜底仍然生效（积压判定不能用被钳过的 atMs）', () => {
    // 用 atMs 判积压的话，每帧都被钳成「刚刚入队」，永远判不出等太久，
    // 于是「场上一直满员」= 队列无限增长 = 内存慢慢爬。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const q = new SpawnQueue({ ...CFG, maxQueueAgeMs: 1000 })
    q.push(req({ atMs: 0, enqueuedAtMs: 0 }))

    const r = q.drain(5000, CFG.maxAliveHard) // 满员 5 秒
    expect(r.dropped).toBe(1)
    expect(q.length).toBe(0)
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})

describe('SpawnQueue — 硬上限', () => {
  // 软硬两个上限要分开测。真实配置里 soft=180 / hard=260，
  // 中间那 80 只的区间先被**软**上限接管（整队推后），硬上限根本轮不到上场 ——
  // 拿真实配置测硬上限，测到的是软的路径。
  const NO_SOFT: SpawnQueueConfig = { ...CFG, maxAliveSoft: 4, maxAliveHard: 4 }

  it('到硬上限就停在队列里等，**不丢**', () => {
    // 丢掉分裂怪的孩子 = 玩家看到「打爆了但什么都没出来」，
    // 正好把整个割草机制抹掉。所以硬上限只让它等。
    const q = new SpawnQueue(NO_SOFT)
    for (let i = 0; i < 5; i++) q.push(req({ atMs: 0 }))

    expect(q.drain(0, NO_SOFT.maxAliveHard).spawned).toHaveLength(0)
    expect(q.length).toBe(5) // 一只都没丢

    // ⚠️ 时间要往前走一点。满员那一帧顺手把这批请求的 atMs 钳到了 0 + stagger=40，
    // 下一帧如果还在 0，它们就都算「没到点」—— 测出来是「一只都没刷」，
    // 看起来像硬上限丢怪，其实是节流推后生效了（这是对的行为）。
    const t = NO_SOFT.overflowStaggerMs

    // 场上腾出 5 个位置后正常刷出
    expect(q.drain(t, 0).spawned).toHaveLength(4) // 这一帧顶到硬上限
    expect(q.drain(t, 1).spawned).toHaveLength(1) // 再腾一个位置就出剩下那只
    expect(q.length).toBe(0)
  })

  it('已经刷出来的那几只算进硬上限（不会超刷）', () => {
    const q = new SpawnQueue(NO_SOFT)
    for (let i = 0; i < 20; i++) q.push(req({ atMs: 0 }))
    // 场上只有 1 个位置 → 这一帧最多刷 3 只（1 + 3 = 4 = 硬上限）
    expect(q.drain(0, NO_SOFT.maxAliveHard - 3).spawned).toHaveLength(3)
  })

  it('真实配置下先撞到的是软上限（软硬分工是刻意的）', () => {
    const q = new SpawnQueue(CFG)
    q.push(req({ atMs: 0, enqueuedAtMs: 0 }))
    // 190 只：过了软上限 180，还没到硬上限 260
    const r = q.drain(0, 190)
    expect(r.spawned).toHaveLength(0)
    expect(r.throttled).toBe(true)
    expect(q.length).toBe(1) // 但也没丢
  })
})

describe('SpawnQueue — 队列上限', () => {
  it('队列满了就拒收，并且出声', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const q = new SpawnQueue({ ...CFG, maxQueueLength: 2 })
    expect(q.push(req())).toBe(true)
    expect(q.push(req())).toBe(true)
    expect(q.push(req())).toBe(false)
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})

// ------------------------------------------------------------------ 分裂扇形

describe('planSplitChildren', () => {
  const BASE = {
    parentX: 100,
    parentY: 200,
    fanAngleDeg: 60,
    spawnRadius: 22,
    spawnStaggerMs: 90,
    baseAngleRad: 0,
  }

  it('2 个孩子对称摆在朝向两侧，间距等于配置半径', () => {
    const kids = planSplitChildren({ ...BASE, childCount: 2 })
    expect(kids).toHaveLength(2)
    for (const k of kids) {
      expect(Math.hypot(k.x - 100, k.y - 200)).toBeCloseTo(22, 6)
    }
    // 中心朝向 0（正右），扇形 60° → ±30°
    expect(kids[0]!.x).toBeCloseTo(100 + 22 * Math.cos(-Math.PI / 6), 6)
    expect(kids[0]!.y).toBeCloseTo(200 + 22 * Math.sin(-Math.PI / 6), 6)
    expect(kids[1]!.y).toBeCloseTo(200 - 22 * Math.sin(-Math.PI / 6), 6)
  })

  it('4 个孩子均匀铺开 110°', () => {
    const kids = planSplitChildren({ ...BASE, fanAngleDeg: 110, childCount: 4 })
    expect(kids).toHaveLength(4)
    const angles = kids.map((k) => Math.atan2(k.y - 200, k.x - 100))
    for (let i = 1; i < angles.length; i++) {
      expect(angles[i]! - angles[i - 1]!).toBeCloseTo((110 * Math.PI) / 180 / 3, 6)
    }
  })

  it('错峰延迟是 0, 90, 180, 270 —— 割草节奏靠它', () => {
    const kids = planSplitChildren({ ...BASE, childCount: 4, spawnStaggerMs: 90 })
    expect(kids.map((k) => k.delayMs)).toEqual([0, 90, 180, 270])
  })

  it('childCount = 0 返回空数组（第三代终止条件，不是错误）', () => {
    expect(planSplitChildren({ ...BASE, childCount: 0 })).toEqual([])
    expect(planSplitChildren({ ...BASE, childCount: -1 })).toEqual([])
  })

  it('⚠️ childCount = 1 不产生 NaN 坐标（除数 0 的老坑）', () => {
    // `(i / (n - 1) - 0.5) * fan` 在 n=1 时是 0/0 = NaN。
    // NaN 坐标的怪不会崩、不会报错，Arcade 只是静静地什么都不做 ——
    // 表现为「屏幕上什么都有，就是永远少一只怪」。
    const kids = planSplitChildren({ ...BASE, childCount: 1 })
    expect(kids).toHaveLength(1)
    expect(Number.isFinite(kids[0]!.x)).toBe(true)
    expect(Number.isFinite(kids[0]!.y)).toBe(true)
    expect(kids[0]!.x).toBeCloseTo(122, 6)
    expect(kids[0]!.y).toBeCloseTo(200, 6)
  })

  it('spawnRadius = 0 时全叠在父亲身上，但延迟仍然错峰', () => {
    const kids = planSplitChildren({ ...BASE, spawnRadius: 0, childCount: 2 })
    expect(kids.every((k) => k.x === 100 && k.y === 200)).toBe(true)
    expect(kids.map((k) => k.delayMs)).toEqual([0, 90])
  })

  it('朝向跟着父亲的移动方向转', () => {
    const kids = planSplitChildren({ ...BASE, childCount: 2, baseAngleRad: Math.PI / 2 })
    // 中心朝向正下方，扇形 60° → 两个孩子在 π/3 与 2π/3
    for (const k of kids) {
      expect(k.y).toBeGreaterThan(200)
      const a = Math.atan2(k.y - 200, k.x - 100)
      const off = Math.abs(a - Math.PI / 2)
      expect(off).toBeCloseTo(Math.PI / 6, 6) // 偏离中心正好半个张角
    }
  })
})

describe('countSplitChain', () => {
  it('分裂怪一条链一共 11 只（1 + 2 + 8）', () => {
    const childCountOf = (gen: number): number => [2, 4, 0][gen] ?? 0
    expect(countSplitChain(0, 2, childCountOf)).toBe(2 + 8)
    expect(1 + countSplitChain(0, 2, childCountOf)).toBe(11)
  })

  it('没有孩子时是 0', () => {
    expect(countSplitChain(2, 2, () => 0)).toBe(0)
  })
})

// ------------------------------------------------------------------ 对象池

function makePool(capacity = 4, kinds: EnemyKind[] = ['splitter']): EnemyPool<{ alive: boolean }> {
  const released: number[] = []
  const pool = new EnemyPool<{ alive: boolean }>({
    capacity,
    createView: () => ({ alive: true }),
    destroyView: (v) => {
      v.alive = false
    },
    onRelease: (model) => {
      released.push(model.id)
    },
  })
  void kinds
  void released
  return pool
}

describe('EnemyPool', () => {
  it('复用同一个槽位：回池后再取出来的是同一个对象，但参数整份重写', () => {
    const pool = makePool(2)
    const a = pool.acquire(makeSpec('splitter', { gen: 0 }), 0)!
    const idA = a.model.id
    a.model.slowStacks = 99
    pool.release(a)

    const b = pool.acquire(makeSpec('splitter', { gen: 0 }), 100)!
    expect(b).toBe(a) // 同一个槽位
    expect(b.model.slowStacks).toBe(0) // 没有串味
    expect(b.model.id).not.toBe(idA) // 但 id 是新的
    expect(pool.created).toBe(1) // 没有多造
  })

  it('按 kind:gen 分组，不跨代复用', () => {
    const pool = makePool(4)
    const g0 = pool.acquire(makeSpec('splitter', { gen: 0 }), 0)!
    const g2 = pool.acquire(makeSpec('splitter', { gen: 2 }), 0)!
    const tank = pool.acquire(makeSpec('tank'), 0)!
    pool.release(g0)
    pool.release(g2)
    pool.release(tank)

    expect(pool.idleCount('splitter', 0)).toBe(1)
    expect(pool.idleCount('splitter', 2)).toBe(1)
    expect(pool.idleCount('tank', 0)).toBe(1)
    expect(pool.idleCount('splitter', 1)).toBe(0)
  })

  it('池满且无空闲时返回 null，**不抛异常**', () => {
    const pool = makePool(2)
    pool.acquire(makeSpec('tank'), 0)
    pool.acquire(makeSpec('tank'), 0)
    expect(pool.acquire(makeSpec('tank'), 0)).toBeNull()
  })

  it('释放时一定调 onRelease（账本配对靠它）', () => {
    const seen: number[] = []
    const pool = new EnemyPool<null>({
      capacity: 2,
      createView: () => null,
      destroyView: () => {},
      onRelease: (m) => seen.push(m.id),
    })
    const e = pool.acquire(makeSpec('splitter'), 0)!
    pool.release(e)
    expect(seen).toEqual([e.model.id])
  })

  it('⚠️ 重复释放直接抛（有两套死亡/清场路径在抢同一只怪）', () => {
    // 静默忽略的话，这个 bug 会一直藏着，直到某只怪莫名其妙出现在别处。
    const pool = makePool(2)
    const e = pool.acquire(makeSpec('splitter'), 0)!
    pool.release(e)
    expect(() => pool.release(e)).toThrow(/重复释放/)
  })

  it('onRelease 在模型失活之前调（账本先松手）', () => {
    let aliveWhenReleased: boolean | null = null
    const pool = new EnemyPool<null>({
      capacity: 2,
      createView: () => null,
      destroyView: () => {},
      onRelease: (m) => {
        aliveWhenReleased = m.alive
      },
    })
    const e = pool.acquire(makeSpec('splitter'), 0)!
    pool.release(e)
    expect(aliveWhenReleased).toBe(true)
    expect(e.model.alive).toBe(false)
  })

  it('live / idle 计数正确', () => {
    const pool = makePool(4)
    expect(pool.live).toBe(0)
    const a = pool.acquire(makeSpec('splitter'), 0)!
    const b = pool.acquire(makeSpec('splitter'), 0)!
    expect(pool.live).toBe(2)
    expect(pool.idle).toBe(0)
    pool.release(a)
    expect(pool.live).toBe(1)
    expect(pool.idle).toBe(1)
    void b
  })

  it('releaseAll 清场，每个槽位都走一遍 onRelease', () => {
    const seen: number[] = []
    const pool = new EnemyPool<null>({
      capacity: 8,
      createView: () => null,
      destroyView: () => {},
      onRelease: (m) => seen.push(m.id),
    })
    for (let i = 0; i < 5; i++) pool.acquire(makeSpec('splitter'), 0)
    expect(pool.live).toBe(5)
    pool.releaseAll()
    expect(pool.live).toBe(0)
    expect(seen).toHaveLength(5) // 一只都没漏
  })

  it('releaseAll 之后还能继续用（切场景再开一局）', () => {
    const pool = makePool(4)
    pool.acquire(makeSpec('splitter'), 0)
    pool.releaseAll()
    expect(pool.acquire(makeSpec('splitter'), 0)).not.toBeNull()
  })

  it('capacity < 1 直接抛', () => {
    expect(() => new EnemyPool<null>({ capacity: 0, createView: () => null, destroyView: () => {}, onRelease: () => {} })).toThrow()
  })

  it('池里的模型带着正确的 enemyKind（穿透等身份行为在构造时就定了）', () => {
    const pool = makePool(4)
    const tank = pool.acquire(makeSpec('tank'), 0)!
    expect(tank.model.enemyKind).toBe('tank')
    const splitter = pool.acquire(makeSpec('splitter'), 0)!
    expect(splitter.model.enemyKind).toBe('splitter')
  })

  it('activeEntries 列出在用的槽位', () => {
    const pool = makePool(4)
    const a = pool.acquire(makeSpec('splitter'), 0)!
    pool.acquire(makeSpec('tank'), 0)
    expect(pool.activeEntries()).toHaveLength(2)
    pool.release(a)
    expect(pool.activeEntries()).toHaveLength(1)
  })
})

// 类型上确认 PooledEnemy 是导出的（EnemySystem 要用）
const _typeCheck: PooledEnemy<null> | null = null
void _typeCheck