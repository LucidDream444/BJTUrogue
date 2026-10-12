import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DIFFICULTIES,
  deriveSplitterGeneration,
  deriveTank,
  oneShotHpCap,
  parseConfigBundle,
  type ConfigBundle,
  type Difficulty,
} from './config'
import { findAsset } from './assetManifest'

/**
 * 契约测试 —— **读磁盘上真实的那三份 JSON**，不是测试里另写一份夹具。
 *
 * 这是本项目唯一能自动拦住「改坏了平衡」的东西。它盯的不是代码覆盖率，
 * 而是**设计意图**：
 *
 *   · 分裂怪每一代在任何难度下都必须**一枪一个**（这是玩家明确要的爽感来源）；
 *   · 肉盾怪的击杀时间必须真的等于配置里写的 `ttkSeconds`；
 *   · 敌人表里不许出现 `maxHp`，也不许出现任何难度字段。
 *
 * ⚠️ 按 `difficulty.json` 的 `_owner_warning`：难度曲线归 **D1**。
 * 所以这里**只断言不变式与比例关系，不对具体乘数产物做快照**——
 * D1 拍完数改了乘数，这些测试必须照过。
 */

const CONFIG_DIR = fileURLToPath(new URL('../../public/config/', import.meta.url))

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(CONFIG_DIR + name, 'utf8'))
}

let cached: ConfigBundle | null = null
function bundle(): ConfigBundle {
  cached ??= parseConfigBundle({
    balance: readJson('balance.json'),
    difficulty: readJson('difficulty.json'),
    enemies: readJson('enemies.json'),
  })
  return cached
}

/** 深度遍历一个 JSON 的所有 key。 */
function allKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, out)
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.push(k)
      allKeys(v, out)
    }
  }
  return out
}

describe('契约 — 三份真实 JSON 必须能解析', () => {
  it('balance.json / difficulty.json / enemies.json 全部通过校验', () => {
    expect(() => bundle()).not.toThrow()
    const b = bundle()
    expect(b.balance.schemaVersion).toBeGreaterThanOrEqual(1)
    expect(b.difficulty.schemaVersion).toBeGreaterThanOrEqual(1)
    expect(b.enemies.schemaVersion).toBeGreaterThanOrEqual(1)
  })

  it('红线 2：敌人表里没有 maxHp —— 血量只能由 hpMode + hpValue 派生', () => {
    const keys = allKeys(readJson('enemies.json'))
    expect(keys).not.toContain('maxHp')
  })

  it('敌人表里没有任何难度字段 —— 难度乘数的唯一来源是 difficulty.json', () => {
    const keys = allKeys(readJson('enemies.json'))
    for (const banned of ['difficulty', 'enemyHp', 'enemyDamage', 'enemySpeed', 'enemyCount']) {
      expect(keys, `enemies.json 里不该出现 "${banned}"`).not.toContain(banned)
    }
  })

  it('难度乘数单调：easy ≤ normal ≤ hard，且 normal 是 1.0（度量衡本身）', () => {
    const d = bundle().difficulty.difficulties
    const axes = ['enemyHp', 'enemyDamage', 'enemySpeed', 'enemyCount'] as const
    for (const axis of axes) {
      expect(d.easy[axis], axis).toBeLessThanOrEqual(d.normal[axis])
      expect(d.normal[axis], axis).toBeLessThanOrEqual(d.hard[axis])
    }
    for (const axis of axes) expect(d.normal[axis], axis).toBe(1)
  })

  it('难度乘数不能是 0 —— 否则敌人会变成不动/无敌的墙', () => {
    for (const diff of DIFFICULTIES) {
      const m = bundle().difficulty.difficulties[diff]
      expect(m.enemyHp, diff).toBeGreaterThan(0)
      expect(m.enemySpeed, diff).toBeGreaterThan(0)
    }
  })
})

describe('契约 — 分裂怪：每一代在任何难度下都必须一枪一个', () => {
  const { balance, difficulty, enemies } = bundle()
  const cap = oneShotHpCap(balance)
  const bulletDamage = balance.baseline.bullet.damage

  it('每一代都声明了 oneShot（不是靠运气一枪打死）', () => {
    for (const g of enemies.enemies.splitter.generations) {
      expect(g.oneShot, `第 ${g.gen} 代`).toBe(true)
    }
  })

  it('派生血量 < 一发子弹的伤害 —— 这就是「一枪一个」的定义', () => {
    for (const diff of DIFFICULTIES) {
      for (const g of enemies.enemies.splitter.generations) {
        const d = deriveSplitterGeneration(g, difficulty.difficulties[diff], balance)
        expect(d.maxHp, `第 ${g.gen} 代 @ ${diff}`).toBeLessThan(bulletDamage)
      }
    }
  })

  it('留了 25% 余量：难度乘数再怎么浮动也吃不掉一击必杀', () => {
    for (const diff of DIFFICULTIES) {
      for (const g of enemies.enemies.splitter.generations) {
        const d = deriveSplitterGeneration(g, difficulty.difficulties[diff], balance)
        expect(d.maxHp, `第 ${g.gen} 代 @ ${diff}`).toBeLessThanOrEqual(cap)
      }
    }
  })

  it('余量上限只作用于声明了 oneShot 的条目 —— 不能把整个 shots 体系封顶', () => {
    // 一个假设的「3 发击杀」条目：hpValue = 3 → 30 血，绝不该被钳到 7
    const threeShot = { ...enemies.enemies.splitter.generations[0]!, oneShot: false, hpValue: 3 }
    const d = deriveSplitterGeneration(threeShot, difficulty.difficulties.normal, balance)
    expect(d.maxHp).toBe(30)
    expect(d.maxHp).toBeGreaterThan(cap)
  })

  it('派生后「速度递增、体型递减」严格成立（这两条才是一代比一代凶的地方）', () => {
    for (const diff of DIFFICULTIES) {
      const gens = enemies.enemies.splitter.generations.map((g) =>
        deriveSplitterGeneration(g, difficulty.difficulties[diff], balance),
      )
      for (let i = 1; i < gens.length; i++) {
        expect(gens[i]!.speed, `speed @ ${diff} gen${i}`).toBeGreaterThan(gens[i - 1]!.speed)
        expect(gens[i]!.radius, `radius @ ${diff} gen${i}`).toBeLessThan(gens[i - 1]!.radius)
      }
    }
  })

  it('派生血量「不递增」——上限只能抹平代差，绝不能反超（反超才是真 bug）', () => {
    for (const diff of DIFFICULTIES) {
      const gens = enemies.enemies.splitter.generations.map((g) =>
        deriveSplitterGeneration(g, difficulty.difficulties[diff], balance),
      )
      for (let i = 1; i < gens.length; i++) {
        expect(gens[i]!.maxHp, `hp @ ${diff} gen${i}`).toBeLessThanOrEqual(gens[i - 1]!.maxHp)
      }
    }
  })

  it('⚠️ 已知后果：一击必杀余量上限会把前两代的派生血量抹平成同一个数', () => {
    // hard（enemyHp 1.3）下 gen0 推到 9、gen1 推到 7，双双被 ±7 的上限钳住 → 都是 7。
    // 这**不是** bug：既然每代都是一枪死，血量本来就不可能被玩家感知到，
    // 区分它们的是速度(62→92→120)、体型(18→12→8)与接触伤害。
    // 但如果将来有人想让「越分裂越脆」被手感出来，别指望血量 —— 得动别的地方。
    const hard = difficulty.difficulties.hard
    const gens = enemies.enemies.splitter.generations.map((g) =>
      deriveSplitterGeneration(g, hard, balance),
    )
    const flattened = gens.filter((g, i) => i > 0 && g.maxHp === gens[i - 1]!.maxHp)
    expect(flattened.length).toBeGreaterThan(0)

    // 抹平是**上限**造成的，不是基础数值就没拉开：去掉上限后严格递减。
    const uncapped = enemies.enemies.splitter.generations.map((g) =>
      deriveSplitterGeneration({ ...g, oneShot: false }, hard, balance),
    )
    for (let i = 1; i < uncapped.length; i++) {
      expect(uncapped[i]!.maxHp, `uncapped hp gen${i}`).toBeLessThan(uncapped[i - 1]!.maxHp)
    }
  })

  it('分裂链是有界的：一只初代分裂怪最多产出 11 具身体（含自己）', () => {
    // 这个数是 swarm_stress 测试场和 maxAliveSoft 的依据，不能随手改。
    const gens = enemies.enemies.splitter.generations
    let total = 1
    let layer = 1
    for (const g of gens) {
      layer *= g.childCount
      total += layer
    }
    expect(total).toBe(11)
    expect(gens[gens.length - 1]!.childCount).toBe(0) // 必须有终点
  })
})

describe('契约 — 肉盾怪：击杀时间必须真的等于 ttkSeconds', () => {
  const { balance, difficulty, enemies } = bundle()
  const tank = enemies.enemies.tank

  it('normal 难度下预期 TTK 精确等于 ttkSeconds', () => {
    const d = deriveTank(tank, difficulty.difficulties.normal, balance)
    expect(d.expectedTtkSeconds).toBeCloseTo(tank.ttkSeconds, 6)
  })

  it('其余难度下 TTK 与 enemyHp 成正比（难度真的在起作用）', () => {
    for (const diff of DIFFICULTIES) {
      const m = difficulty.difficulties[diff]
      const d = deriveTank(tank, m, balance)
      expect(d.expectedTtkSeconds / tank.ttkSeconds, diff).toBeCloseTo(m.enemyHp, 2)
    }
  })

  it('子弹被穿透：一发子弹的伤害 = 全额冲击 + 穿透期间 1 次 tick', () => {
    const d = deriveTank(tank, difficulty.difficulties.normal, balance)
    const ratio = tank.frameDamage.bullet.tickDamageRatio
    expect(d.pierceTickDamage).toBe(Math.floor(balance.baseline.bullet.damage * ratio + 0.5))
    expect(d.damagePerBullet).toBe(balance.baseline.bullet.damage + d.pierceTickDamage)
    expect(d.damagePerBullet).toBeGreaterThan(balance.baseline.bullet.damage)
  })

  it('穿透是硬性要求：pierce 为 false 时加载直接失败', () => {
    const raw = readJson('enemies.json') as Record<string, never>
    const broken = structuredClone(raw)
    const t = (broken as never as { enemies: { tank: { frameDamage: { bullet: { pierce: boolean } } } } })
      .enemies.tank
    t.frameDamage.bullet.pierce = false
    expect(() =>
      parseConfigBundle({ balance: readJson('balance.json'), difficulty: readJson('difficulty.json'), enemies: broken }),
    ).toThrow(/pierce/)
  })

  it('几何自洽：子弹在肉盾体积内的停留时间够坐实 1 次 tick（口径 154ms > 节拍 100ms）', () => {
    // 这个推算决定了 damagePerBullet 里的 expectedPierceTicks = 1。
    // 改了弹速 / 肉盾半径 / tickMs 任何一个，这里会先炸，而不是等玩家发现「穿透打不出伤害」。
    const residenceMs = ((tank.radius * 2) / balance.baseline.bullet.speed) * 1000
    expect(residenceMs).toBeGreaterThan(tank.frameDamage.tickMs)

    // 但也不该长得离谱 —— 否则一发子弹能打出好几次 tick，13 点/发的口径就不成立了
    expect(residenceMs).toBeLessThan(tank.frameDamage.tickMs * 2)
    expect(tank.frameDamage.bullet.maxTicksPerSource).toBeGreaterThanOrEqual(1)
  })

  it('肉盾比杂兵大得多、慢得多（这是它的身份，不是可调项）', () => {
    const gens = enemies.enemies.splitter.generations
    const first = gens[0]!
    expect(tank.radius).toBeGreaterThan(first.radius * 2)
    expect(tank.speed).toBeLessThan(first.speed)
    expect(tank.threatLevel).toBeGreaterThan(enemies.enemies.splitter.threatLevel)
  })
})

describe('契约 — 资源 key 与资源清单必须对得上', () => {
  it('敌人表里引用的每个贴图 key 都在清单里，且是能生成占位方块的图片', () => {
    const keys = [
      bundle().enemies.enemies.tank.textureKey,
      ...bundle().enemies.enemies.splitter.generations.map((g) => g.textureKey),
    ]
    expect(keys.length).toBeGreaterThan(0)
    for (const k of keys) {
      const entry = findAsset(k)
      expect(entry, `"${k}" 不在 assetManifest.ts 的 ASSETS 里`).toBeDefined()
      expect(entry!.kind).not.toBe('audio')
      expect(entry!.width, `"${k}" 缺 width`).toBeTruthy()
      expect(entry!.height, `"${k}" 缺 height`).toBeTruthy()
    }
  })

  it('清单里的贴图 key 不重复（重复会让后加载的静默覆盖前一个）', () => {
    const seen = new Set<string>()
    for (const k of [
      bundle().enemies.enemies.tank.textureKey,
      ...bundle().enemies.enemies.splitter.generations.map((g) => g.textureKey),
    ]) {
      expect(seen.has(k), `"${k}" 重复`).toBe(false)
      seen.add(k)
    }
  })
})

describe('契约 — balance.json 的内部自洽（派生公式的度量衡）', () => {
  const { balance } = bundle()

  it('baselineDps 与 damage / fireIntervalMs 一致（否则「几发」和「几秒」两套口径打架）', () => {
    const implied = (balance.baseline.bullet.damage / balance.baseline.bullet.fireIntervalMs) * 1000
    expect(implied).toBeCloseTo(balance.baseline.baselineDps, 6)
  })

  it('对象池装得下软上限的尸体：poolCapacity ≥ maxAliveSoft', () => {
    // 装不下的话，每次刷怪都要 allocate，池子等于白做
    expect(balance.spawn.poolCapacity).toBeGreaterThanOrEqual(balance.spawn.maxAliveSoft)
  })

  it('软上限 < 硬上限（软上限靠降频、硬上限靠拒刷，顺序不能反）', () => {
    expect(balance.spawn.maxAliveSoft).toBeLessThan(balance.spawn.maxAliveHard)
  })

  it('一帧内允许的刷怪数 ≤ 一次完整分裂链的产出（否则链会在单帧里炸开）', () => {
    const chainPerKill = 10 // 2 + 8，见上面的分裂链测试
    expect(balance.spawn.maxSpawnsPerFrame).toBeLessThanOrEqual(chainPerKill)
  })

  it('帧伤节拍与账本默认值一致 —— 配置是唯一来源，代码里的常量只是兜底', () => {
    expect(balance.frameDamage.tickMs).toBeGreaterThan(0)
    // pairTtlMs 必须 ≥ tickMs，否则条目会在下一次结算前就被判过期
    expect(balance.frameDamage.pairTtlMs).toBeGreaterThanOrEqual(balance.frameDamage.tickMs)
  })

  it('玩家血量与接触伤害的量级：站在一只杂兵里活不出 3 秒，但也不会瞬死', () => {
    const gens = bundle().enemies.enemies.splitter.generations
    const dps = (gens[0]!.contactDamagePerTick / balance.frameDamage.tickMs) * 1000
    const ttlSeconds = balance.baseline.player.maxHp / dps
    expect(ttlSeconds).toBeGreaterThan(2)
    expect(ttlSeconds).toBeLessThan(20)
  })
})

describe('契约 — ConfigError 必须指出出问题的字段路径', () => {
  it('缺字段时报错信息带上路径，别人能自己定位', () => {
    const raw = readJson('enemies.json') as Record<string, unknown>
    const broken = structuredClone(raw)
    delete (broken as never as { enemies: { tank: { speed?: number } } }).enemies.tank.speed
    try {
      parseConfigBundle({ balance: readJson('balance.json'), difficulty: readJson('difficulty.json'), enemies: broken })
      expect.unreachable('应该抛 ConfigError')
    } catch (e) {
      expect((e as Error).message).toContain('enemies.enemies.tank.speed')
    }
  })

  it('难度乘数写 0 会被拦住（enemyHp 有下界 0.1）', () => {
    const raw = readJson('difficulty.json') as Record<string, unknown>
    const broken = structuredClone(raw) as never as {
      difficulties: Record<Difficulty, { enemyHp: number }>
    }
    broken.difficulties.normal.enemyHp = 0
    expect(() =>
      parseConfigBundle({ balance: readJson('balance.json'), difficulty: broken, enemies: readJson('enemies.json') }),
    ).toThrow(/enemyHp/)
  })
})