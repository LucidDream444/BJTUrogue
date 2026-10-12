import { describe, expect, it, vi } from 'vitest'
import {
  DamageLedger,
  type DamageSourceKind,
  type HitRequest,
  type HitResult,
  type TickTarget,
} from './damage'

/**
 * 账本的四条不变式。
 *
 * 这些测试的意义不是「覆盖率」—— 它们是把「切标签页回来爆发几百次结算」
 * 「池复用串味」「打到尸体上」这三类经典玄学 bug 变成**有定义的行为**。
 * 没有它们，这些问题只会在真机上偶发，而且无法复现。
 */

class FakeTarget implements TickTarget {
  static seq = 0
  readonly id: number
  spawnSeq: number
  alive = true
  hp = 100000
  hits: HitRequest[] = []

  constructor() {
    this.id = ++FakeTarget.seq
    this.spawnSeq = this.id
  }

  /** 模拟回池再 spawn：换一个 spawnSeq，但对象还是同一个。 */
  respawn(): void {
    this.spawnSeq = ++FakeTarget.seq
    this.alive = true
  }

  takeHit(req: HitRequest): HitResult {
    if (!this.alive) return { applied: 0, killed: false, consumed: false }
    this.hits.push(req)
    const applied = Math.min(req.amount, this.hp)
    this.hp -= applied
    return { applied, killed: this.hp <= 0, consumed: true }
  }
}

const CFG = { tickMs: 100, pairTtlMs: 250, maxTicksPerSourceDefault: 8 }
const STEP_MS = 1000 / 60 // 物理步长，约 16.67ms

/**
 * 模拟若干个物理步。每个步里：先 touch（碰撞回调），再 step（WORLD_STEP）。
 * **这个顺序是 Phaser 的实际顺序**，已对 3.90.0 源码核实（见 damage.ts 文件头）。
 */
function runSteps(
  ledger: DamageLedger,
  target: TickTarget,
  sourceId: number,
  opts: {
    steps: number
    startMs: number
    startFrame: number
    touching?: boolean
    kind?: DamageSourceKind
    amount?: number
    maxTicks?: number
  },
): { nowMs: number; frameId: number } {
  let nowMs = opts.startMs
  let frameId = opts.startFrame
  for (let i = 0; i < opts.steps; i++) {
    nowMs += STEP_MS
    frameId++
    if (opts.touching !== false) {
      ledger.touch(
        sourceId,
        target,
        {
          sourceKind: opts.kind ?? 'melee',
          amountPerTick: opts.amount ?? 3,
          maxTicks: opts.maxTicks,
        },
        nowMs,
      )
    }
    ledger.step(nowMs, frameId)
  }
  return { nowMs, frameId }
}

describe('DamageLedger — 不变式 ①：每 (源,目标) 每 tick 最多结算一次', () => {
  it('首次接触不立刻结算，等一个 tickMs 才第一次结算', () => {
    const ledger = new DamageLedger(CFG)
    const target = new FakeTarget()

    ledger.touch(1, target, { sourceKind: 'melee', amountPerTick: 3 }, 0)
    ledger.step(50, 1) // 还没到 100ms
    expect(target.hits).toHaveLength(0)

    ledger.touch(1, target, { sourceKind: 'melee', amountPerTick: 3 }, 100)
    ledger.step(100, 2)
    expect(target.hits).toHaveLength(1)
    expect(target.hits[0]!.amount).toBe(3)
  })

  it('持续接触时每隔 tickMs 结算一次，不多不少', () => {
    const ledger = new DamageLedger(CFG)
    const target = new FakeTarget()

    // 跑 1 秒的物理步（约 60 步），tickMs = 100 → 第一次在 ~116ms，之后每 100ms 一次，
    // 但撞上 maxTicksPerSourceDefault = 8 的上限，所以恰好 8 次。
    runSteps(ledger, target, 1, { steps: 61, startMs: 0, startFrame: 0 })

    expect(target.hits).toHaveLength(8)
  })

  it('同一个 (源,目标) 不会在一个 tick 内结算两次', () => {
    const ledger = new DamageLedger(CFG)
    const target = new FakeTarget()

    // 同一个时刻 touch 很多次（模拟持续重叠的多个物理子步），但只推进一次
    let nowMs = 0
    let frameId = 0
    for (let i = 0; i < 20; i++) {
      nowMs += STEP_MS
      frameId++
      ledger.touch(7, target, { sourceKind: 'melee', amountPerTick: 3 }, nowMs)
      ledger.touch(7, target, { sourceKind: 'melee', amountPerTick: 3 }, nowMs) // 重复 touch
      ledger.step(nowMs, frameId)
    }

    // 20 步 ≈ 333ms → 最多 4 次（100/200/300/400 边界）
    expect(target.hits.length).toBeLessThanOrEqual(4)
    // 而且每个 hitKey 都不同（不会因为重复而互相覆盖）
    const keys = target.hits.map((h) => h.hitKey)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('DamageLedger — 不变式 ②：每个配对单帧最多推进一次 tick', () => {
  it('一帧内跑多个物理步：结算恰好一次，且不能因为闸门挑错步而变成零次', () => {
    const ledger = new DamageLedger(CFG)
    const target = new FakeTarget()

    // 模拟严重掉帧：一帧内跑了 18 个物理步（300ms），全部共用同一个 frameId。
    // 期间跨过了**两次** tick 时刻（116ms / 216ms，落在第 7、第 14 个物理步上）。
    //
    // 这个 case 同时钉住两个方向：
    //   · 上界 —— 300ms / 100ms 名义上够 3 次，但不许结算 3 次（甚至 2 次）；
    //   · 下界 —— 也**不许**结算 0 次。把闸门设在「整个 step()」上（同 frameId 直接
    //     return）就会得到 0 次：只有第 1 步被看，而它离到期还差 100ms。
    const frameId = 1
    let nowMs = 0
    for (let i = 0; i < 18; i++) {
      nowMs += STEP_MS
      ledger.touch(1, target, { sourceKind: 'melee', amountPerTick: 3 }, nowMs)
      ledger.step(nowMs, frameId) // 同一个 frameId
    }

    expect(nowMs).toBeGreaterThan(216) // 已跨过两个 tick 时刻（18 × 16.667 有浮点误差）
    expect(target.hits).toHaveLength(1)
    expect(target.hits[0]!.frameId).toBe(frameId) // 结算发生在这一步，不是别处
  })

  it('同一帧内多个**不同配对**各自结算 —— 群怪伤害不能被塌成 1/N', () => {
    const ledger = new DamageLedger(CFG)
    // 一发穿透弹同时穿过 3 只肉盾：3 个配对，同一个源、同一个 frameId。
    const tanks = [new FakeTarget(), new FakeTarget(), new FakeTarget()]
    // 10 只怪同时贴脸玩家：10 个配对，10 个不同的源。
    const player = new FakeTarget()
    const swarm = Array.from({ length: 10 }, (_, i) => i + 100)

    const frameId = 1
    const nowMs = 200

    for (const t of tanks) {
      ledger.touch(1, t, { sourceKind: 'bullet', amountPerTick: 3 }, 0) // 先到期
      ledger.touch(1, t, { sourceKind: 'bullet', amountPerTick: 3 }, nowMs)
    }
    for (const s of swarm) {
      ledger.touch(s, player, { sourceKind: 'contact', amountPerTick: 2 }, 0)
      ledger.touch(s, player, { sourceKind: 'contact', amountPerTick: 2 }, nowMs)
    }

    const result = ledger.step(nowMs, frameId)

    expect(result.settled).toBe(13) // 3 + 10，一个都不许吞
    for (const t of tanks) expect(t.hits).toHaveLength(1)
    expect(player.hits).toHaveLength(10)

    // 而且它们**都**发生在同一个 frameId 里（这是允许的，被禁的只是同配对重复结算）
    expect(tanks[0]!.hits[0]!.frameId).toBe(frameId)
    expect(player.hits.every((h) => h.frameId === frameId)).toBe(true)
  })

  it('掉帧结束后下一帧正常恢复结算，不会因为上一帧结算过就永久卡死', () => {
    const ledger = new DamageLedger(CFG)
    const target = new FakeTarget()

    // 上一帧已抢到一次结算
    ledger.touch(1, target, { sourceKind: 'melee', amountPerTick: 3 }, 0)
    ledger.touch(1, target, { sourceKind: 'melee', amountPerTick: 3 }, 120)
    ledger.step(120, 1)
    expect(target.hits).toHaveLength(1)

    // 新的一帧：即使刚好在一步里跑了两个物理步，也该恢复结算
    ledger.touch(1, target, { sourceKind: 'melee', amountPerTick: 3 }, 220)
    ledger.step(220, 2)
    ledger.touch(1, target, { sourceKind: 'melee', amountPerTick: 3 }, 230)
    ledger.step(230, 2) // 同一帧的第二/第三…个物理步
    ledger.touch(1, target, { sourceKind: 'melee', amountPerTick: 3 }, 240)
    ledger.step(240, 2)

    // 到期时刻是 120 + 100 = 220，恰好在这一帧的第一步上
    expect(target.hits).toHaveLength(2)
  })

  it('nextTickAtMs 是赋值而非累加：卡顿后不会追赶补结算', () => {
    const ledger = new DamageLedger(CFG)
    const target = new FakeTarget()

    ledger.touch(1, target, { sourceKind: 'melee', amountPerTick: 3 }, 0)
    // 一次性跳到 1000ms（模拟切标签页回来 / 长卡顿）
    ledger.touch(1, target, { sourceKind: 'melee', amountPerTick: 3 }, 1000)
    ledger.step(1000, 1)

    expect(target.hits).toHaveLength(1)
    // 下一次应该在 1100，而不是把 100..900 的 9 次全补上
    ledger.touch(1, target, { sourceKind: 'melee', amountPerTick: 3 }, 1050)
    ledger.step(1050, 2)
    expect(target.hits).toHaveLength(1)
    ledger.touch(1, target, { sourceKind: 'melee', amountPerTick: 3 }, 1100)
    ledger.step(1100, 3)
    expect(target.hits).toHaveLength(2)
  })
})

describe('DamageLedger — 脱接触即停伤', () => {
  it('源离开后不再结算，即使条目还没过期', () => {
    const ledger = new DamageLedger(CFG)
    const target = new FakeTarget()

    // 接触 200ms（约 12 步）后停止 touch
    const at = runSteps(ledger, target, 1, { steps: 12, startMs: 0, startFrame: 0 })
    const before = target.hits.length
    expect(before).toBeGreaterThan(0)

    // 继续推进时间，但不再 touch（子弹已飞出肉盾）
    let nowMs = at.nowMs
    let frameId = at.frameId
    for (let i = 0; i < 30; i++) {
      nowMs += STEP_MS
      frameId++
      ledger.step(nowMs, frameId)
    }

    expect(target.hits).toHaveLength(before)
  })

  it('脱接触超过 pairTtlMs 后条目被清理', () => {
    const ledger = new DamageLedger(CFG)
    const target = new FakeTarget()

    ledger.touch(1, target, { sourceKind: 'bullet', amountPerTick: 3 }, 0)
    expect(ledger.entryCount).toBe(1)

    ledger.step(400, 1) // 400 - 0 > 250
    expect(ledger.entryCount).toBe(0)
  })
})

describe('DamageLedger — maxTicksPerSource 上限', () => {
  it('达到上限后不再结算，但条目留着（否则持续接触会绕过上限）', () => {
    const ledger = new DamageLedger(CFG)
    const target = new FakeTarget()

    ledger.touch(1, target, { sourceKind: 'melee', amountPerTick: 3, maxTicks: 3 }, 0)
    // 一直贴着砍 1 秒 —— 若达到上限就删条目，下一次 touch 会立刻新建一个，
    // 上限形同虚设（实测会打出 9 次而不是 3 次）
    runSteps(ledger, target, 1, { steps: 60, startMs: 0, startFrame: 0, amount: 3 })

    expect(target.hits).toHaveLength(3)
    expect(ledger.entryCount).toBe(1) // 条目还在，只是不再结算
  })

  it('脱接触满 ttlMs 后可以重新接触并重新计数（「需中断重接」）', () => {
    const ledger = new DamageLedger(CFG)
    const target = new FakeTarget()

    ledger.touch(1, target, { sourceKind: 'melee', amountPerTick: 3, maxTicks: 2 }, 0)
    runSteps(ledger, target, 1, { steps: 30, startMs: 0, startFrame: 0, amount: 3 })
    expect(target.hits).toHaveLength(2)

    // 中断：不再 touch，让条目过期
    let nowMs = 1000
    let frameId = 100
    for (let i = 0; i < 30; i++) {
      nowMs += STEP_MS
      frameId++
      ledger.step(nowMs, frameId)
    }
    expect(ledger.entryCount).toBe(0)

    // 重新接上 → 又能打满 2 次
    runSteps(ledger, target, 1, {
      steps: 30,
      startMs: nowMs,
      startFrame: frameId,
      amount: 3,
      maxTicks: 2,
    })
    expect(target.hits).toHaveLength(4)
  })
})

describe('DamageLedger — 不变式 ③：源被回收时清干净', () => {
  it('releaseSource 后不再结算', () => {
    const ledger = new DamageLedger(CFG)
    const a = new FakeTarget()
    const b = new FakeTarget()

    ledger.touch(42, a, { sourceKind: 'melee', amountPerTick: 3 }, 0)
    ledger.touch(42, b, { sourceKind: 'melee', amountPerTick: 3 }, 0)
    expect(ledger.entryCount).toBe(2)

    ledger.releaseSource(42)
    expect(ledger.entryCount).toBe(0)

    runSteps(ledger, a, 42, { steps: 20, startMs: 0, startFrame: 0, touching: false })
    expect(a.hits).toHaveLength(0)
    expect(b.hits).toHaveLength(0)
  })

  it('只清掉这一个源的条目，不影响别的源', () => {
    const ledger = new DamageLedger(CFG)
    const target = new FakeTarget()

    ledger.touch(1, target, { sourceKind: 'melee', amountPerTick: 3 }, 0)
    ledger.touch(2, target, { sourceKind: 'melee', amountPerTick: 5 }, 0)
    ledger.releaseSource(1)

    expect(ledger.entryCount).toBe(1)
    const snap = ledger.snapshot(0)
    expect(snap[0]!.sourceId).toBe(2)
  })
})

describe('DamageLedger — 不变式 ④：目标死亡/回池', () => {
  it('releaseTarget 后不再结算（防止打到已经回收的实体上）', () => {
    const ledger = new DamageLedger(CFG)
    const target = new FakeTarget()

    ledger.touch(1, target, { sourceKind: 'melee', amountPerTick: 3 }, 0)
    ledger.releaseTarget(target)
    expect(ledger.entryCount).toBe(0)

    runSteps(ledger, target, 1, { steps: 20, startMs: 0, startFrame: 0, touching: false })
    expect(target.hits).toHaveLength(0)
  })

  it('目标回池后被同一个槽位复用，旧源的 tick 绝不会算到新实体上', () => {
    const ledger = new DamageLedger(CFG)
    const pooled = new FakeTarget()

    // 子弹打在槽位 A 上，登记了一堆 tick，但没人调 releaseTarget（模拟漏掉不变式④）
    ledger.touch(99, pooled, { sourceKind: 'melee', amountPerTick: 50 }, 0)

    // 怪物死了回池，又复活成新的怪物
    pooled.respawn()
    // 故意**不**调 releaseTarget，验证 spawnSeq 这道保险能自己兜住

    runSteps(ledger, pooled, 99, { steps: 30, startMs: 0, startFrame: 0, touching: false })

    expect(pooled.hits).toHaveLength(0)
    expect(ledger.entryCount).toBe(0)
  })

  it('目标 alive=false 后立刻停止结算并清理', () => {
    const ledger = new DamageLedger(CFG)
    const target = new FakeTarget()
    ledger.touch(1, target, { sourceKind: 'melee', amountPerTick: 3 }, 0)

    target.alive = false
    ledger.step(50, 1)

    expect(ledger.entryCount).toBe(0)
    expect(target.hits).toHaveLength(0)
  })
})

describe('DamageLedger — 结算走 takeHit，不直接改 hp', () => {
  it('每个 tick 都通过目标的 takeHit 结算，且 hitKey 唯一', () => {
    const ledger = new DamageLedger(CFG)
    const target = new FakeTarget()

    runSteps(ledger, target, 12, { steps: 40, startMs: 0, startFrame: 0, amount: 7 })

    expect(target.hits.length).toBeGreaterThan(0)
    for (const h of target.hits) {
      expect(h.sourceId).toBe(12)
      expect(h.mode).toBe('instant') // 账本结算给目标的永远是 instant
      expect(h.sourceKind).toBe('melee')
      expect(h.hitKey.startsWith('tick:12:')).toBe(true)
      expect(h.frameId).toBeGreaterThan(0) // frameId 来自 GameClock，绝不能是常量
    }
  })
})

describe('DamageLedger — 防御性兜底', () => {
  it('条目数超上限时丢弃最老的并告警，而不是无限增长', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ledger = new DamageLedger({ ...CFG, maxEntries: 4 })

    for (let i = 1; i <= 10; i++) {
      const t = new FakeTarget()
      ledger.touch(i, t, { sourceKind: 'melee', amountPerTick: 1 }, i)
    }

    expect(ledger.entryCount).toBeLessThanOrEqual(4)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('tickMs <= 0 直接抛，不允许静默退化', () => {
    expect(() => new DamageLedger({ tickMs: 0 })).toThrow()
  })
})