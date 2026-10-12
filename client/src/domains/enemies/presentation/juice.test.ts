import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { JuicePolicy, juiceParamsFromConfig } from './JuicePolicy'
import { parseConfigBundle, type ConfigBundle } from '@/core/config'

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

/** 用真实配置造一个策略。参数和 `JuiceDirector` 完全一致。 */
function realPolicy(): JuicePolicy {
  const cfg = realConfig()
  return new JuicePolicy(
    juiceParamsFromConfig(cfg.balance, cfg.enemies.enemies.splitter.juice, cfg.enemies.enemies.tank.juice),
  )
}

/** 一次分裂怪击杀。默认用第一代的配置值（45ms / 0.2）。 */
function splitterKill(gen = 0) {
  const g = realConfig().enemies.enemies.splitter.generations[gen]!
  return {
    input: {
      enemyKind: 'splitter' as const,
      gen,
      killed: true,
      baseHitstopMs: g.hitstopMs,
      baseTrauma: g.trauma,
    },
  }
}

function tankKill() {
  const cfg = realConfig()
  return {
    enemyKind: 'tank' as const,
    gen: 0,
    killed: true,
    baseHitstopMs: cfg.enemies.enemies.tank.slam.hitstopMs,
    baseTrauma: cfg.balance.juice.traumaCap,
  }
}

/**
 * `JuicePolicy` 的测试。
 *
 * 这里测的全是**坏掉之后不报错、只是变难玩**的规则：
 * 连杀音调升不上去、震屏一直在抖、群战时画面变幻灯片。
 * 这类 bug 没有异常、没有日志、没有崩溃堆栈，唯一的防线就是这些断言。
 */

describe('JuicePolicy · 连击', () => {
  let policy: JuicePolicy
  beforeEach(() => {
    policy = realPolicy()
  })

  it('第一次击杀是 1 级，音调为 0 —— 第一声不该已经变调', () => {
    const fb = policy.onHit(splitterKill().input, 1000)
    expect(fb.combo).toBe(1)
    expect(policy.pitchCentsFor(fb.combo)).toBe(0)
  })

  it('窗口内连续击杀逐级递增，音调按 pitchStepCents 走', () => {
    const { input } = splitterKill()
    // 配置：comboWindowMs 1200、pitchStepCents 120
    policy.onHit(input, 0)
    const fb2 = policy.onHit(input, 300)
    const fb3 = policy.onHit(input, 600)
    expect([fb2.combo, fb3.combo]).toEqual([2, 3])
    expect(policy.pitchCentsFor(2)).toBe(120)
    expect(policy.pitchCentsFor(3)).toBe(240)
  })

  it('超过窗口就归零重来 —— 否则打完一波、走十分钟、再打时音调已经高到听不见', () => {
    const { input } = splitterKill()
    policy.onHit(input, 0)
    policy.onHit(input, 100)
    expect(policy.comboCount).toBe(2)
    const fb = policy.onHit(input, 100 + 1200 + 1)
    expect(fb.combo).toBe(1)
  })

  /**
   * ⚠️ **回归测试**：这一条锁的是「把连击算在『顿帧/震屏都是 0 就提前返回』之后」这个 bug。
   *
   * 第三代的配置是 `hitstopMs: 0, trauma: 0.05`。而第三代恰恰是数量最多的那一代
   * （2 → 8 只），所以「最后一代不计入连杀」的后果不是少一点音调，
   * 而是**连杀永远卡在 4 级**、凑不到 5 级的花式表现 —— 也就是说，
   * 用户要的那个「割草爽感」的顶点信号**永远不会触发**，而且没有任何报错。
   */
  it('顿帧与创伤都接近 0 的第三代击杀，仍然计入连击', () => {
    const { input } = splitterKill(2)
    expect(input.baseHitstopMs).toBe(0)
    expect(input.baseTrauma).toBeGreaterThan(0)

    const { input: g0 } = splitterKill(0)
    expect(policy.onHit(g0, 0).combo).toBe(1)
    expect(policy.onHit(g0, 100).combo).toBe(2)
    expect(policy.onHit(g0, 200).combo).toBe(3)
    expect(policy.onHit(g0, 300).combo).toBe(4)
    // 第四只是第三代：0 顿帧、0.05 创伤
    const fb = policy.onHit(input, 400)
    expect(fb.combo).toBe(5)
    expect(fb.flourish).toBe(true)
  })

  it('即使顿帧与创伤都是 0，也要计入连击（去掉提前返回之后的兜底）', () => {
    const zero = {
      enemyKind: 'splitter' as const,
      gen: 0,
      killed: true,
      baseHitstopMs: 0,
      baseTrauma: 0,
    }
    expect(policy.onHit(zero, 0).combo).toBe(1)
    expect(policy.onHit(zero, 100).combo).toBe(2)
  })

  it('肉盾的死亡是个句号：它不接在分裂怪的连击尾巴上', () => {
    const { input } = splitterKill()
    policy.onHit(input, 0)
    policy.onHit(input, 100)
    expect(policy.comboCount).toBe(2)

    const fb = policy.onHit(tankKill(), 200)
    expect(fb.combo).toBe(0)
    expect(fb.flourish).toBe(false)
    // 肉盾之后重新开始，不是接着数到 3
    expect(policy.onHit(input, 300).combo).toBe(1)
  })

  it('肉盾的受击（未击杀）不影响连击', () => {
    const { input } = splitterKill()
    policy.onHit(input, 0)
    policy.onHit(input, 100)
    policy.onHit({ ...tankKill(), killed: false }, 150)
    expect(policy.onHit(input, 200).combo).toBe(3)
  })

  /**
   * 花式只在**恰好达到**阈值那一次触发。
   *
   * 写成 `combo >= flourishAt` 的话，一场 30 连杀会闪 25 次：
   * 花式立刻变成噪音，而且堆了 25 次全屏白闪的光敏风险。
   */
  it('花式只在恰好达到阈值时触发一次，第 6、7 杀不再触发', () => {
    const { input } = splitterKill()
    const flags: boolean[] = []
    for (let i = 0; i < 8; i++) flags.push(policy.onHit(input, i * 50).flourish)
    expect(flags).toEqual([false, false, false, false, true, false, false, false])
  })

  it('连击窗口超时归零后，下一波重新能拿到花式', () => {
    const { input } = splitterKill()
    for (let i = 0; i < 5; i++) policy.onHit(input, i * 50)
    expect(policy.comboCount).toBe(5)
    // 走开 2 秒，再打一波
    const flags: boolean[] = []
    for (let i = 0; i < 5; i++) flags.push(policy.onHit(input, 5000 + i * 50).flourish)
    expect(flags).toEqual([false, false, false, false, true])
  })
})

describe('JuicePolicy · 顿帧预算', () => {
  let policy: JuicePolicy
  beforeEach(() => {
    policy = realPolicy()
  })

  // 配置：hitstopWindowMs 500、hitstopBudgetRatio 0.25 → 窗口内最多 125ms
  it('额度够就给，并把时长原样返回', () => {
    expect(policy.onHit(splitterKill(0).input, 0).hitstopMs).toBe(45)
  })

  it('连杀把额度吃光后，后面的击杀**整次跳过**顿帧', () => {
    const { input } = splitterKill(0) // 45ms
    const grants = [0, 40, 80, 120].map((t) => policy.onHit(input, t).hitstopMs)
    // 额 125：第一次 45（剩 80）、第二次 45（剩 35）；第三次要 45 > 35，
    // **不截断成 35，而是整次不给** —— 截断出来的 35ms 既感觉不到、
    // 又照样把额度吃掉了，等于把剩下的战斗全都降档了。
    expect(grants).toEqual([45, 45, 0, 0])
    expect(policy.budgetRemaining(120)).toBe(35)
  })

  it('不会截断成「更短的顿帧」—— 挡就整次挡', () => {
    const { input } = splitterKill(0)
    policy.onHit(input, 0) // 45
    policy.onHit(input, 10) // 45，共 90，剩 35
    // 第三次要 45，剩 35：不截断成 35，而是 0
    expect(policy.onHit(input, 20).hitstopMs).toBe(0)
  })

  it('窗口滑走后额度回来', () => {
    const { input } = splitterKill(0)
    policy.onHit(input, 0) // 45
    policy.onHit(input, 10) // 45，共 90，剩 35
    policy.onHit(input, 20) // 要 45 > 35，被挡
    // t=501 时窗口切到 (-1, 501]，t=0 那条过期、t=10 那条还在：已用 45，剩 80
    expect(policy.budgetRemaining(501)).toBe(80)
    expect(policy.onHit(input, 501).hitstopMs).toBe(45)
    expect(policy.budgetRemaining(501)).toBe(35)
  })

  it('零时长不给、不记账', () => {
    expect(policy.requestHitstop(0, 0)).toBe(0)
    expect(policy.requestHitstop(-10, 0)).toBe(0)
    expect(policy.budgetRemaining(0)).toBe(125)
  })

  /**
   * 肉盾下砸走**同一个**预算。
   *
   * 分开记的话，一场混战里就会「连杀不给顿帧、下砸照样给」——
   * 降档逻辑等于没写，而下砸是 60ms、比任何一次连杀都长。
   */
  it('下砸（requestHitstop）和击杀共用同一份额度', () => {
    const { input } = splitterKill(0) // 45
    expect(policy.onHit(input, 0).hitstopMs).toBe(45)
    expect(policy.requestHitstop(60, 10)).toBe(60) // 剩 80
    expect(policy.budgetRemaining(10)).toBe(20)
    // 再要 45 就只剩 20，挡
    expect(policy.onHit(input, 20).hitstopMs).toBe(0)
  })

  it('reset() 清空额度 —— 否则上一局末尾的顿帧会吃掉新开局的前几秒', () => {
    policy.onHit(splitterKill(0).input, 0)
    policy.reset()
    expect(policy.budgetRemaining(0)).toBe(125)
  })
})

describe('JuicePolicy · 震屏创伤', () => {
  let policy: JuicePolicy
  beforeEach(() => {
    policy = realPolicy()
  })

  it('加创伤、并在 traumaCap 处截断（默认 0.6）', () => {
    policy.addTrauma(0.2)
    expect(policy.trauma).toBeCloseTo(0.2)
    policy.addTrauma(0.5)
    expect(policy.trauma).toBe(0.6)
    policy.addTrauma(0.5)
    expect(policy.trauma).toBe(0.6)
  })

  it('负数与 0 不改变创伤', () => {
    policy.addTrauma(0.3)
    policy.addTrauma(0)
    policy.addTrauma(-1)
    expect(policy.trauma).toBeCloseTo(0.3)
  })

  /**
   * 半衰期衰减，而不是「每帧减固定量」。
   *
   * 固定量是**帧率相关**的：同一个配置在 144Hz 机器上衰减快 2.4 倍。
   * 而症状只是「抖动持续多久」不同，没人会把它和帧率联系起来 ——
   * 所以这条断言盯的是「220ms 半衰期」这个语义，不是某个具体数值。
   */
  it('按半衰期衰减：每 220ms 减半', () => {
    policy.addTrauma(0.6)
    policy.decayTrauma(220)
    expect(policy.trauma).toBeCloseTo(0.3)
    policy.decayTrauma(220)
    expect(policy.trauma).toBeCloseTo(0.15)
  })

  it('衰减与帧率无关：60 帧 1/60 秒 ≈ 一次 1 秒', () => {
    const a = realPolicy()
    const b = realPolicy()
    a.addTrauma(0.6)
    b.addTrauma(0.6)
    for (let i = 0; i < 60; i++) a.decayTrauma(1000 / 60)
    for (let i = 0; i < 144; i++) b.decayTrauma(1000 / 144)
    // 两边的累计时间分别是 1000ms 和 1000ms，结果必须几乎一致
    expect(a.trauma).toBeCloseTo(b.trauma, 2)
  })

  it('衰到 0.01 以下直接归零，不留浮点尾数', () => {
    policy.addTrauma(0.02)
    policy.decayTrauma(1000) // 0.02 * 2^-4.5 ≈ 0.0009
    expect(policy.trauma).toBe(0)
  })

  it('dt 为 0 或负数时不动（第一帧、重复调用）', () => {
    policy.addTrauma(0.5)
    policy.decayTrauma(0)
    policy.decayTrauma(-16)
    expect(policy.trauma).toBeCloseTo(0.5)
  })

  it('reset() 清空创伤 —— 否则上一局的余震会晃到新开局', () => {
    policy.addTrauma(0.6)
    policy.reset()
    expect(policy.trauma).toBe(0)
  })

  /**
   * `shakeMinIntervalMs` 闸门（配置 90ms）。
   *
   * 这是「十几个怪同时死」时的降噪：创伤是按**击杀次数**累加的，
   * 一次群体死亡如果每次都加 0.2，一秒内就顶满上限并一直顶着 ——
   * 画面会持续剧烈抖动，而不是「打了一下、晃一下」。
   */
  it('两次加创伤之间有 shakeMinIntervalMs 闸门', () => {
    const { input } = splitterKill(0) // baseTrauma 0.2
    expect(policy.onHit(input, 0).trauma).toBeCloseTo(0.2)
    expect(policy.onHit(input, 50).trauma).toBe(0) // 50 < 90，挡
    expect(policy.onHit(input, 89).trauma).toBe(0)
    expect(policy.onHit(input, 90).trauma).toBeCloseTo(0.2) // 正好 90，放行
  })

  it('闸门只影响震屏，不影响连击与顿帧', () => {
    const { input } = splitterKill(0)
    policy.onHit(input, 0)
    const fb = policy.onHit(input, 50)
    expect(fb.trauma).toBe(0)
    expect(fb.combo).toBe(2)
    expect(fb.hitstopMs).toBe(45)
  })

  it('单次创伤超过上限时截断到 traumaCap', () => {
    const fb = policy.onHit(
      { enemyKind: 'tank', gen: 0, killed: true, baseHitstopMs: 0, baseTrauma: 99 },
      0,
    )
    expect(fb.trauma).toBe(0.6)
  })

  it('创伤都是 0 的命中不该推进震屏间隔闸门', () => {
    const zeroHit = {
      enemyKind: 'splitter' as const,
      gen: 0,
      killed: false,
      baseHitstopMs: 0,
      baseTrauma: 0,
    }
    policy.onHit(zeroHit, 0)
    // 闸门若被这次 0 创伤的命中推走，下面这次 0.2 就会被误挡
    expect(policy.onHit(splitterKill(0).input, 1).trauma).toBeCloseTo(0.2)
  })
})

describe('JuicePolicy · 肉盾帧伤限频', () => {
  let policy: JuicePolicy
  beforeEach(() => {
    policy = realPolicy()
  })

  // 配置：hitSfxMinIntervalMs 250、damageEventBatchMs 200
  it('受击音效按 hitSfxMinIntervalMs 限频（250ms）', () => {
    expect(policy.tryTankHitSfx(0)).toBe(true)
    expect(policy.tryTankHitSfx(100)).toBe(false)
    expect(policy.tryTankHitSfx(249)).toBe(false)
    expect(policy.tryTankHitSfx(250)).toBe(true)
  })

  it('一次穿透弹的 3 次帧伤只会放一次音（100ms tick × 3 = 300ms 内）', () => {
    // 子弹在肉盾体内约 150ms，tickMs = 100 → 满打满算 2~3 次结算
    const played = [0, 100, 200].map((t) => policy.tryTankHitSfx(t))
    expect(played).toEqual([true, false, false])
  })

  it('贴脸近战 10 次/秒的结算，一秒只放 4 次音', () => {
    let count = 0
    for (let t = 0; t < 1000; t += 100) if (policy.tryTankHitSfx(t)) count++
    expect(count).toBe(4) // t = 0, 250, 500, 750
  })

  it('攒批：第一次调用只开窗口，不满一个窗口不 flush', () => {
    expect(policy.shouldFlushTankDamage(0)).toBe(false)
    expect(policy.shouldFlushTankDamage(100)).toBe(false)
    expect(policy.shouldFlushTankDamage(199)).toBe(false)
    expect(policy.shouldFlushTankDamage(200)).toBe(true)
  })

  it('flush 之后窗口从当前时刻重新开始', () => {
    policy.shouldFlushTankDamage(0)
    expect(policy.shouldFlushTankDamage(200)).toBe(true)
    policy.flushTankDamage(200)
    expect(policy.shouldFlushTankDamage(350)).toBe(false)
    expect(policy.shouldFlushTankDamage(400)).toBe(true)
  })

  it('reset() 后闸门与窗口都放开', () => {
    policy.tryTankHitSfx(0)
    policy.reset()
    expect(policy.tryTankHitSfx(1)).toBe(true)
    expect(policy.shouldFlushTankDamage(2)).toBe(false) // 重新开窗口
  })
})

describe('JuicePolicy · 真实配置接线', () => {
  it('juiceParamsFromConfig 把三个来源拼对：balance.juice + 各自敌人表的 juice', () => {
    const cfg = realConfig()
    const p = juiceParamsFromConfig(cfg.balance, cfg.enemies.enemies.splitter.juice, cfg.enemies.enemies.tank.juice)
    expect(p.hitstopWindowMs).toBe(cfg.balance.juice.hitstopWindowMs)
    expect(p.hitstopBudgetRatio).toBe(cfg.balance.juice.hitstopBudgetRatio)
    expect(p.traumaCap).toBe(cfg.balance.juice.traumaCap)
    expect(p.shakeMinIntervalMs).toBe(cfg.balance.juice.shakeMinIntervalMs)
    expect(p.comboWindowMs).toBe(cfg.enemies.enemies.splitter.juice.comboWindowMs)
    expect(p.comboFlourishAt).toBe(cfg.enemies.enemies.splitter.juice.comboFlourishAt)
    expect(p.pitchStepCents).toBe(cfg.enemies.enemies.splitter.juice.pitchStepCents)
    expect(p.tankHitSfxMinIntervalMs).toBe(cfg.enemies.enemies.tank.juice.hitSfxMinIntervalMs)
    expect(p.tankDamageEventBatchMs).toBe(cfg.enemies.enemies.tank.juice.damageEventBatchMs)
  })

  it('顿帧预算是「窗口 × ratio」，不是拍脑袋的常数', () => {
    const cfg = realConfig()
    const p = realPolicy()
    const expected = cfg.balance.juice.hitstopWindowMs * cfg.balance.juice.hitstopBudgetRatio
    expect(p.budgetRemaining(0)).toBeCloseTo(expected)
  })

  /**
   * 一整套用户要的连杀链路，用**真实配置**走一遍：
   * 一只 gen0 裂成 2 只 gen1，每只再裂成 4 只 gen2 —— 击杀数 1 + 2 + 8 = 11。
   *
   * 断言的是这条链路末端那件事：**11 连杀能不能走到花式**。
   * 这正是「打群怪的割草爽感」的顶点信号。
   */
  it('完整分裂链（1 + 2 + 8 = 11 杀）能走到花式，且不把顿帧预算吃穿', () => {
    const cfg = realConfig()
    const gens = cfg.enemies.enemies.splitter.generations
    const policy = realPolicy()
    const budgetCap = cfg.balance.juice.hitstopWindowMs * cfg.balance.juice.hitstopBudgetRatio

    // 真实时间线：一代死 → 180ms 分裂延迟 → 两只二代几乎同时死 → 160ms → 八只三代
    const kills = [
      { gen: 0, atMs: 0 },
      { gen: 1, atMs: 200 },
      { gen: 1, atMs: 210 },
      { gen: 2, atMs: 400 },
      { gen: 2, atMs: 400 },
      { gen: 2, atMs: 400 },
      { gen: 2, atMs: 400 },
      { gen: 2, atMs: 400 },
      { gen: 2, atMs: 400 },
      { gen: 2, atMs: 400 },
      { gen: 2, atMs: 400 },
    ]

    let flourishCount = 0
    let grantedTotal = 0
    for (const k of kills) {
      const g = gens[k.gen]!
      const fb = policy.onHit(
        {
          enemyKind: 'splitter',
          gen: k.gen,
          killed: true,
          baseHitstopMs: g.hitstopMs,
          baseTrauma: g.trauma,
        },
        k.atMs,
      )
      grantedTotal += fb.hitstopMs
      if (fb.flourish) flourishCount++
    }

    expect(policy.comboCount).toBe(11)
    expect(flourishCount).toBe(1)
    // 顿帧总时长不能超过「时间跨度 × ratio」的若干倍 —— 这条链路横跨 400ms，
    // 理论额度是 (400 + 500) × 0.25 = 225ms。断言「没失控」而不是精确值，
    // 因为精确值取决于击杀时刻，改配置时不该连带改断言。
    expect(grantedTotal).toBeLessThanOrEqual(300)
    expect(grantedTotal).toBeGreaterThan(0)
    expect(budgetCap).toBe(125)
  })
})