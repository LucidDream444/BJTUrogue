import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { ContactResolver } from './ContactResolver'
import { DamageLedger } from '@/core/actor/damage'
import { EnemyModel, specFromTank, type EnemySpec } from '../model/EnemyModel'
import { makeSpec } from '../testSupport'
import { deriveTank, parseConfigBundle, type BalanceConfig, type ConfigBundle } from '@/core/config'

const CONFIG_DIR = fileURLToPath(new URL('../../../../public/config/', import.meta.url))

let cachedCfg: ConfigBundle | null = null
function realConfig(): ConfigBundle {
  cachedCfg ??= parseConfigBundle({
    balance: JSON.parse(readFileSync(CONFIG_DIR + 'balance.json', 'utf8')),
    difficulty: JSON.parse(readFileSync(CONFIG_DIR + 'difficulty.json', 'utf8')),
    enemies: JSON.parse(readFileSync(CONFIG_DIR + 'enemies.json', 'utf8')),
  })
  return cachedCfg
}

/**
 * `ContactResolver` 的测试。
 *
 * 这个文件盯的是**一个只在高负载机器上复现的 bug**：
 * 肉盾是穿透的，所以一发子弹会在它身体里停留 ~150ms（半径 40、弹速 520），
 * 那段期间**每个渲染帧**都会触发一次 overlap 回调。如果「冲击那一发」没有
 * 跨帧去重，一发的伤害就从 10 变成 10 × 停留帧数 ≈ 90 ——
 * 而帧数取决于帧率，于是「机器越好、伤害越低」，在开发机上永远复现不出来。
 *
 * ⚠️ 注意「同帧 N 次接触」和「跨帧 N 次接触」是**两个不同的闸门**，各测各的：
 * - 同帧：`ActorModel.isDuplicateHit`（键是 `${frameId}:${hitKey}`）挡住；
 * - 跨帧：本文件的 `impactDone` 挡住。
 * 只测前者会让人以为后者是多余的，删掉之后套件全绿 —— 直到有人在低配笔记本上玩。
 */

/** 假钟。`GameClock` 天然满足 `ContactClock`，但测试里要能随便摆时刻。 */
class FakeClock {
  nowMs = 0
  frameId = 0
  /** 推进一帧（逻辑时间 + 帧号） */
  advance(ms: number): void {
    this.nowMs += ms
    this.frameId++
  }
  /** 不换帧，只推进逻辑时间 —— 模拟掉帧时一帧内的多个物理步 */
  advanceWithinFrame(ms: number): void {
    this.nowMs += ms
  }
}

const TANK_SPEC: EnemySpec = {
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

interface Harness {
  clock: FakeClock
  ledger: DamageLedger
  resolver: ContactResolver
  balance: BalanceConfig
  /** 造一只已经在场上的怪 */
  spawn(spec?: EnemySpec): EnemyModel
  /** 走一个完整的物理步：先接触，再结算。**顺序和 Phaser 一致**（见 damage.ts 文件头） */
  stepTouch(model: EnemyModel, sourceId: number, impact: number, tick: number, maxTicks: number): void
}

function harness(tickMs = 100): Harness {
  const cfg = realConfig()
  const clock = new FakeClock()
  const ledger = new DamageLedger({
    tickMs,
    pairTtlMs: cfg.balance.frameDamage.pairTtlMs,
    maxTicksPerSourceDefault: cfg.balance.frameDamage.maxTicksPerSourceDefault,
  })
  const resolver = new ContactResolver(ledger, clock)

  return {
    clock,
    ledger,
    resolver,
    balance: cfg.balance,
    spawn(spec = TANK_SPEC) {
      const m = new EnemyModel(spec.kind)
      m.respawn(spec, clock.nowMs)
      return m
    },
    stepTouch(model, sourceId, impact, tick, maxTicks) {
      resolver.contact(sourceId, model, 'bullet', impact, tick, maxTicks)
      ledger.step(clock.nowMs, clock.frameId)
    },
  }
}

describe('ContactResolver —— 肉盾的穿透弹', () => {
  let h: Harness

  beforeEach(() => {
    h = harness()
  })

  it('第一次接触：结算全额冲击，并回答 consumed=false（子弹要穿透，不回收）', () => {
    const tank = h.spawn()
    const r = h.resolver.contact(1, tank, 'bullet', 10, 3, 3)

    expect(r.applied).toBe(10)
    expect(r.consumed, '肉盾什么都不挡；这里返回 true 子弹就会停在它身上').toBe(false)
    expect(tank.hp).toBe(510)
  })

  it('普通敌人回答 consumed=true（子弹被挡下，D1 会回收它）', () => {
    const splitter = h.spawn(makeSpec('splitter', { stats: { maxHp: 7, speed: 62, radius: 18 } }))
    const r = h.resolver.contact(1, splitter, 'bullet', 10, 0, 3)

    expect(r.applied).toBe(7) // 被剩余血量截断
    expect(r.killed).toBe(true)
    expect(r.consumed).toBe(true)
  })

  it('**跨帧**重复接触：冲击只算一次（这是这个文件存在的全部理由）', () => {
    const tank = h.spawn()
    let total = 0
    // 子弹在肉盾体内停留 ~150ms ≈ 9 个渲染帧。每帧都触发一次 overlap 回调。
    for (let frame = 0; frame < 9; frame++) {
      total += h.resolver.contact(1, tank, 'bullet', 10, 0, 3).applied
      h.clock.advance(16)
    }

    expect(total, '9 帧里只有第 1 帧该结算冲击').toBe(10)
    expect(tank.hp).toBe(510)
  })

  it('跨帧重复接触时 consumed 仍然如实回答 false（不然帧伤只剩一下）', () => {
    const tank = h.spawn()
    h.resolver.contact(1, tank, 'bullet', 10, 0, 3)

    for (let frame = 0; frame < 5; frame++) {
      h.clock.advance(16)
      const r = h.resolver.contact(1, tank, 'bullet', 10, 0, 3)
      expect(r.applied, '反复结算冲击').toBe(0)
      expect(r.consumed, 'D1 会在这一步回收子弹，肉盾的帧伤就没了').toBe(false)
    }
  })

  it('同一帧内的多次接触也不重复结算（掉帧时的补步循环）', () => {
    const tank = h.spawn()
    let total = 0
    // 掉帧：一帧内跑 5 个物理步，共用同一个 frameId
    for (let i = 0; i < 5; i++) {
      total += h.resolver.contact(1, tank, 'bullet', 10, 0, 3).applied
      h.clock.advanceWithinFrame(16)
    }
    expect(total).toBe(10)
  })

  it('同一发子弹穿过两只肉盾：两只各吃一次冲击', () => {
    const a = h.spawn()
    const b = h.spawn()
    expect(h.resolver.contact(1, a, 'bullet', 10, 0, 3).applied).toBe(10)
    expect(h.resolver.contact(1, b, 'bullet', 10, 0, 3).applied).toBe(10)
    expect(a.hp).toBe(510)
    expect(b.hp).toBe(510)
  })

  it('两发子弹打同一只肉盾：各吃各的冲击', () => {
    const tank = h.spawn()
    expect(h.resolver.contact(1, tank, 'bullet', 10, 0, 3).applied).toBe(10)
    expect(h.resolver.contact(2, tank, 'bullet', 10, 0, 3).applied).toBe(10)
    expect(tank.hp).toBe(500)
  })
})

describe('ContactResolver —— 帧伤节拍', () => {
  it('穿透期间按 tickMs 结算，节拍由账本管，不由接触次数管', () => {
    const h = harness(100)
    const tank = h.spawn()

    // t=0：接触 + 结算。冲击 10，tick 还没到点（nextTickAtMs = 100）
    h.stepTouch(tank, 1, 10, 3, 3)
    expect(tank.hp).toBe(510)

    // 同帧内又碰了 4 次（掉帧的补步），逻辑时间推到 100ms。
    // 只有**一个**物理步该结算一次 tick —— 这就是「每个配对单帧最多一次」。
    h.clock.advanceWithinFrame(100)
    h.stepTouch(tank, 1, 10, 3, 3)
    expect(tank.hp, '一帧里 5 次接触只该结算 1 次 tick').toBe(507)

    // 同帧内再碰，还是不该结算（lastSettledFrameId 闸门）
    for (let i = 0; i < 4; i++) {
      h.clock.advanceWithinFrame(10)
      h.stepTouch(tank, 1, 10, 3, 3)
    }
    expect(tank.hp).toBe(507)

    // 换一帧，到 200ms：再结算一次
    h.clock.advance(100)
    h.stepTouch(tank, 1, 10, 3, 3)
    expect(tank.hp).toBe(504)
  })

  it('maxTicks 到顶后不再结算，直到脱接触重接（近战一直贴着砍也一样）', () => {
    const h = harness(100)
    const tank = h.spawn()
    // maxTicks = 2：冲击 + 最多 2 次 tick = 10 + 3 + 3
    for (let frame = 0; frame < 10; frame++) {
      h.stepTouch(tank, 1, 10, 3, 2)
      h.clock.advance(100)
    }
    expect(tank.hp).toBe(520 - 10 - 6)
  })

  it('tickDamage = 0 时不建账本条目（纯冲击的源，比如一发普通子弹）', () => {
    const h = harness(100)
    const tank = h.spawn()
    h.stepTouch(tank, 1, 10, 0, 3)
    expect(h.ledger.entryCount).toBe(0)
  })

  it('脱接触满 pairTtlMs 后条目自动过期，不需要调用方判「离开了」', () => {
    const h = harness(100)
    const tank = h.spawn()
    h.stepTouch(tank, 1, 10, 3, 3)
    expect(h.ledger.entryCount).toBe(1)

    h.clock.advance(h.balance.frameDamage.pairTtlMs + 100)
    h.ledger.step(h.clock.nowMs, h.clock.frameId)
    expect(h.ledger.entryCount).toBe(0)
  })
})

describe('ContactResolver —— 回收与尸体', () => {
  it('release() 之后同一个 sourceId 会重新算冲击（所以 id 绝不许复用）', () => {
    const h = harness()
    const tank = h.spawn()
    h.resolver.contact(1, tank, 'bullet', 10, 3, 3)
    expect(h.resolver.trackedSources).toBe(1)

    h.resolver.release(1)
    expect(h.resolver.trackedSources).toBe(0)
    expect(h.ledger.entryCount, '账本里那条配对也要被清掉').toBe(0)

    // ⚠️ 必须**换一帧**再碰，否则测不出东西来，反而会让人以为「id 复用没事」。
    //
    // 同一帧内的话，即使 `impactDone` 已经被 `release()` 清空，
    // `ActorModel.isDuplicateHit`（键是 `${frameId}:${hitKey}`，而 hitKey 是 `bullet:${sourceId}`）
    // 也会把它挡下来 —— 也就是**帧内**闸门替我们兜住了。
    // 「id 复用」真正咬人的场景恰恰是跨帧的：子弹池把 1 号发给下一发子弹，
    // 它飞过上一发打过的那只怪，撞击伤害凭空消失。
    h.clock.advance(16)
    expect(
      h.resolver.contact(1, tank, 'bullet', 10, 3, 3).applied,
      '换帧之后没有闸门了 —— 这正是 shotId 必须单调递增、永不复用的原因',
    ).toBe(10)
  })

  it('打在一具已死 / 正在分裂的尸体上：不结算，但让子弹回池', () => {
    const h = harness()
    const tank = h.spawn()
    tank.takeHit({
      sourceId: 99,
      hitKey: 'k',
      mode: 'instant',
      amount: 99999,
      frameId: 0,
      nowMs: 0,
      sourceKind: 'bullet',
    })
    expect(tank.alive).toBe(false)

    const r = h.resolver.contact(1, tank, 'bullet', 10, 3, 3)
    expect(r).toEqual({ applied: 0, killed: false, consumed: true })
    expect(h.ledger.entryCount, '尸体不该在账本里留条目').toBe(0)
  })

  it('clear() 清掉全部跟踪（场景 shutdown）', () => {
    const h = harness()
    const tank = h.spawn()
    h.resolver.contact(1, tank, 'bullet', 10, 3, 3)
    h.resolver.contact(2, tank, 'melee', 5, 3, 8)
    expect(h.resolver.trackedSources).toBe(2)

    h.resolver.clear()
    expect(h.resolver.trackedSources).toBe(0)
  })
})

describe('ContactResolver —— 近战', () => {
  it('近战挥砍不被肉盾吃掉（否则帧伤退化成「一次挥砍只掉一下」）', () => {
    const h = harness()
    const tank = h.spawn()
    const r = h.resolver.contact(7, tank, 'melee', 10, 3, 8)
    expect(r.consumed).toBe(false)
  })

  it('近战与子弹各自独立跟踪，互不影响', () => {
    const h = harness()
    const tank = h.spawn()
    expect(h.resolver.contact(1, tank, 'bullet', 10, 3, 3).applied).toBe(10)
    expect(h.resolver.contact(1, tank, 'melee', 10, 3, 8).applied, '不同的源类型、同一个 id：这是调用方的错，但别静默').toBe(
      0,
    )
  })
})

describe('ContactResolver —— 与真实配置对齐', () => {
  it('肉的穿透 tick 伤害 = roundHalfUp(基线子弹伤害 × tickDamageRatio)', () => {
    const cfg = realConfig()
    const derived = deriveTank(
      cfg.enemies.enemies.tank,
      cfg.difficulty.difficulties.normal,
      cfg.balance,
    )
    expect(derived.pierceTickDamage).toBe(3)
    expect(derived.damagePerBullet).toBe(13) // 冲击 10 + 穿透 1 次 × 3
  })

  it('用真实配置跑一遍一发子弹的完整生命：13 点伤害，不是 90 点', () => {
    const cfg = realConfig()
    const h = harness(cfg.balance.frameDamage.tickMs)
    const def = cfg.enemies.enemies.tank
    const derived = deriveTank(def, cfg.difficulty.difficulties.normal, cfg.balance)
    const tank = h.spawn(specFromTank(derived, def))

    const maxTicks = def.frameDamage.bullet.maxTicksPerSource
    let total = 0
    // 半径 40、弹速 520 → 停留 ~154ms。按 60fps 逐帧接触，直到子弹飞出去。
    // 顺序严格照 Phaser：colliders（contact）→ WORLD_STEP（ledger.step）→ 下一帧。
    for (let frame = 0; frame < 10; frame++) {
      total += h.resolver
        .contact(1, tank, 'bullet', cfg.balance.baseline.bullet.damage, derived.pierceTickDamage, maxTicks)
        .applied
      h.ledger.step(h.clock.nowMs, h.clock.frameId)
      h.clock.advance(16)
    }
    expect(total, '冲击只算一次 —— 没有这道闸门的话这里是 10 × 10 帧 = 100').toBe(10)
    expect(tank.hp).toBe(derived.maxHp - 10 - 3)
  })

  /**
   * ⚠️ 这一条盯的是**特殊弹的射线路径**（`EnemySystem.bulletRayContact`）——
   * 它和手枪的物理重叠路径**共用下面这套结算**，所以断言和上一条同形。
   *
   * 为什么值得单独钉一遍：特殊弹走的是扫掠射线（高速弹不能靠物理重叠，会穿过去），
   * 而射线**每帧都会重新命中同一只怪**（可穿透的目标不进 `hitIds`，见 `Weapons.ts`）。
   * 一旦有人把这条路径改回「一次性固定伤害」的 `weaponHit()`，
   * 冲击就会按帧重复 —— 一发 54 点的爆裂炮在 ~190ms 的停留里打出 648 点，
   * 520 血的肉盾**一发就没**，玩家既看不到子弹穿过去、也看不到帧伤跳字。
   */
  it('射线路径：一发 54 点的大威力弹也只是「1 次冲击 + 帧伤」，不是 54 × 每帧', () => {
    const cfg = realConfig()
    const h = harness(cfg.balance.frameDamage.tickMs)
    const def = cfg.enemies.enemies.tank
    const derived = deriveTank(def, cfg.difficulty.difficulties.normal, cfg.balance)
    const tank = h.spawn(specFromTank(derived, def))

    const impact = 54 // 爆裂炮：damageScale 5.4 × 基线 10
    const tick = Math.floor(impact * def.frameDamage.bullet.tickDamageRatio + 0.5)
    const maxTicks = def.frameDamage.bullet.maxTicksPerSource
    let total = 0
    // 爆裂炮慢（speedScale 0.8 → 416px/s），在肉盾体内停留 ~190ms ≈ 12 个渲染帧
    for (let frame = 0; frame < 12; frame++) {
      total += h.resolver
        .contact(1, tank, 'bullet', impact, tick, maxTicks)
        .applied
      h.ledger.step(h.clock.nowMs, h.clock.frameId)
      h.clock.advance(12)
    }
    // `contact()` 只管冲击；帧伤是账本在 `ledger.step()` 里结算的，所以分开断言
    // （和上一条同一套口径：`total` 是「跨帧重复接触一共兑现了多少冲击」）。
    expect(total, '没有跨帧去重的话这里是 54 × 12 帧 = 648 —— 一发就把 520 血的肉盾秒了').toBe(
      impact,
    )
    expect(tank.hp, '血线上体现的才是「冲击 + 穿透期间 1 次 tick」').toBe(
      derived.maxHp - impact - tick,
    )
    expect(tank.hp, '一发打不死，肉盾这个身份才立得住').toBeGreaterThan(0)
  })
})