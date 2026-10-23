import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DIFFICULTIES,
  deriveGrabber,
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

  it('派生后「速度**不下降**、体型递减」成立', () => {
    // ⚠️ 2026-10-16：速度那条从**严格递增**放宽成**不下降**。
    //    分裂出来的小怪比母体还快，玩家是越打越被追着跑 —— 那不是「一代比一代凶」，
    //    是「一代比一代罚」。同速允许，**变慢不允许**（分裂的比母体慢会显得像卡住）。
    //    体型仍然严格递减：那才是「小怪」这个身份本身。
    for (const diff of DIFFICULTIES) {
      const gens = enemies.enemies.splitter.generations.map((g) =>
        deriveSplitterGeneration(g, difficulty.difficulties[diff], balance),
      )
      for (let i = 1; i < gens.length; i++) {
        expect(gens[i]!.speed, `speed @ ${diff} gen${i}`).toBeGreaterThanOrEqual(gens[i - 1]!.speed)
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
    const t = (
      broken as never as { enemies: { tank: { frameDamage: { bullet: { pierce: boolean } } } } }
    ).enemies.tank
    t.frameDamage.bullet.pierce = false
    expect(() =>
      parseConfigBundle({
        balance: readJson('balance.json'),
        difficulty: readJson('difficulty.json'),
        enemies: broken,
      }),
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

  it('玩家血量与接触伤害：计入受击保护后既不瞬死也不无限存活', () => {
    const gens = bundle().enemies.enemies.splitter.generations
    const intervalMs = Math.max(balance.frameDamage.tickMs, balance.baseline.player.iframeMs)
    const dps = (gens[0]!.contactDamagePerTick / intervalMs) * 1000
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
      parseConfigBundle({
        balance: readJson('balance.json'),
        difficulty: readJson('difficulty.json'),
        enemies: broken,
      })
      expect.unreachable('应该抛 ConfigError')
    } catch (e) {
      expect((e as Error).message).toContain('enemies.enemies.tank.speed')
    }
  })

  it('抓取怪的 `pressDamageRatio` ≥ 1 会被拦住（一下就能脱离 = 机制不存在）', () => {
    const raw = readJson('enemies.json') as Record<string, never>
    const broken = structuredClone(raw)
    const g = (
      broken as never as {
        enemies: { grabber: { grab: { pressDamageRatio: number } } }
      }
    ).enemies.grabber
    g.grab.pressDamageRatio = 1
    expect(() =>
      parseConfigBundle({
        balance: readJson('balance.json'),
        difficulty: readJson('difficulty.json'),
        enemies: broken,
      }),
    ).toThrow(/pressDamageRatio/)
  })

  it('难度乘数写 0 会被拦住（enemyHp 有下界 0.1）', () => {
    const raw = readJson('difficulty.json') as Record<string, unknown>
    const broken = structuredClone(raw) as never as {
      difficulties: Record<Difficulty, { enemyHp: number }>
    }
    broken.difficulties.normal.enemyHp = 0
    expect(() =>
      parseConfigBundle({
        balance: readJson('balance.json'),
        difficulty: broken,
        enemies: readJson('enemies.json'),
      }),
    ).toThrow(/enemyHp/)
  })
})

describe('契约 — 抓取怪：血量是双重职责的旋钮', () => {
  const { balance, difficulty, enemies } = bundle()
  const def = enemies.enemies.grabber

  it('预警窗口内集火**打不死**它（打死了抓取就不发生，机制见不到）', () => {
    const d = deriveGrabber(def, difficulty.difficulties.normal, balance)
    const dps = (balance.baseline.bullet.damage / balance.baseline.bullet.fireIntervalMs) * 1000
    const windowDamage = (dps * def.grab.telegraphMs) / 1000
    expect(d.maxHp, '预警那段时间的集火伤害应当打不死它').toBeGreaterThan(windowDamage)
  })

  it('但也只能多活一点点（不然「打它还是跑」就不是个真选择）', () => {
    const d = deriveGrabber(def, difficulty.difficulties.normal, balance)
    const dps = (balance.baseline.bullet.damage / balance.baseline.bullet.fireIntervalMs) * 1000
    const windowDamage = (dps * def.grab.telegraphMs) / 1000
    expect(d.maxHp).toBeLessThanOrEqual(windowDamage * 1.5)
  })

  it('连点口径：满血脱离的按下次数落在「连点得动」的区间里', () => {
    const d = deriveGrabber(def, difficulty.difficulties.normal, balance)
    expect(d.pressDamage, '每次按下扣的是**最大血量**的百分比').toBe(
      Math.floor(d.maxHp * def.grab.pressDamageRatio + 0.5),
    )
    expect(d.pressesToEscape).toBeGreaterThanOrEqual(12)
    expect(d.pressesToEscape).toBeLessThanOrEqual(30)
  })

  it('预警期打掉的血直接缩短连点次数（80% 血被抓 = 只需按两成）', () => {
    const d = deriveGrabber(def, difficulty.difficulties.normal, balance)
    const remaining = d.maxHp * 0.2
    expect(Math.ceil(remaining / d.pressDamage)).toBeLessThan(d.pressesToEscape)
    expect(Math.ceil(remaining / d.pressDamage)).toBeGreaterThan(0)
  })

  it('咬人口径：normal 难度下正好按配置的意图咬死满血玩家，更难的难度只会更少口', () => {
    const normal = difficulty.difficulties.normal
    const d = deriveGrabber(def, normal, balance)
    expect(d.bitesToKillPlayer, 'normal 必须等于配置写的口数').toBe(def.grab.bitesToKillPlayer)

    for (const diff of DIFFICULTIES) {
      const m = difficulty.difficulties[diff]
      const dd = deriveGrabber(def, m, balance)
      expect(dd.bitesToKillPlayer, diff).toBeGreaterThanOrEqual(1)
      // ⚠️ 只对**不低于 normal** 的难度断言「不会更多口」。
      //    简单难度的 `enemyDamage` 小于 1，每口更轻、自然要更多口才咬死 ——
      //    那不是 bug，是难度在起作用（写成全难度单调就会误报）。
      if (m.enemyDamage >= normal.enemyDamage) {
        expect(dd.bitesToKillPlayer, diff).toBeLessThanOrEqual(def.grab.bitesToKillPlayer)
      }
    }
  })

  it('甩出速度 = 距离 ÷ 时长，且落点看得清（速度不荒谬）', () => {
    const d = deriveGrabber(def, difficulty.difficulties.normal, balance)
    expect(d.flingSpeed).toBe(
      Math.round((def.grab.flingDistance / def.grab.flingTimeMs) * 1000),
    )
    expect(d.flingSpeed).toBeGreaterThan(200)
    expect(d.flingSpeed).toBeLessThan(2000)
  })

  it('落地爆炸「范围很大」：直径至少 15 格（v4 的 mainRoomHeight），且与「盖住一间教室」的差距没变大', () => {
    // ★ **2026-10-20，D2 的平面图落地（schemaVersion 5）把这条的尺子换掉了。**
    //
    // v4 这里读的是 `rooms.json` 的 `mainRoomHeight` —— 主干道那排教室的高度，
    // 恒为 **600px = 15 格**。爆炸直径也是 600，于是那条断言是
    // `600 >= 600`，**正好卡在等号上**：它守的其实是「D3 的爆炸 = D2 的教室高」
    // 这个刻意的耦合，谁动一半都会红。
    //
    // v5 里 `mainRoomHeight` 没有了（几何搬去了 `floor-plan.json`，
    // 而且不再有「主干教室」这个类别）。教室的**真实高度**是 17~24 格，
    // 最小的一间（`YF605` / `YF606`，20×17 与 39×17）是 **17 格 = 680px**。
    // 于是 `600 >= 680` —— **那条耦合断了：爆炸不再盖得住一整间教室。**
    //
    // ⚠️ **这是要交给 D3 决定的事，不是这里能自己修的**：`blastRadius` 是
    // `enemies.json` 的平衡旋钮（D3 的域），D2 不改别人的数。两个读数记在这里：
    //
    // | | 格 | px |
    // |---|---|---|
    // | 爆炸直径（今天） | 15 | 600 |
    // | 最小的一间**打得起来**的教室高 | 17 | 680 |
    //
    // 想恢复「盖得住整间教室」的话，`blastRadius` 要 ≥ 340（今天 300）。
    // 这条已经写进了 `openspec/changes/real-floorplan-layout/NOTICE-D1-D3-契约变更.md`。
    //
    // 那么这里断言什么？**两条真话，分开说清楚**：
    // ① 直径至少 15 格 —— 那是老尺子的长度，**它是设计目标**（"范围很大"），
    //    爆炸被改小时要拦住；
    // ② 上面那个差距（今天 80px = 2 格）**不许再变大** —— 教室又长高、
    //    或者爆炸又被改小，这条会红，红了就该去找 D3。
    const cell = (readJson('rooms.json') as { navCellSize: number }).navCellSize
    // ⚠️ 尺子只量**打得起来**的房间。`fixed: 'reward'` 的两间教休室不刷怪，
    // 而它们正是最小的一间（8 格 / 320px）—— 算进来的话尺子会变成 320，
    // 于是 `600 >= 320` 恒成立，这条就成了一条**假绿**的用例：
    // 看着在测「盖得住一间教室」，其实什么都没测。
    const plan = readJson('floor-plan.json') as {
      rooms: { id: string; width: number; height: number; fixed?: string }[]
    }
    const fightable = plan.rooms.filter((r) => r.fixed !== 'reward')
    expect(fightable.length, '一间打得起来的教室都没有 —— 上面那句过滤写错了').toBeGreaterThan(
      0,
    )
    const smallestRoomHeight = Math.min(...fightable.map((r) => r.height * cell))
    const diameter = def.grab.blastRadius * 2

    expect(
      diameter,
      `爆炸直径 ${diameter}px（${diameter / cell} 格）小于 15 格 ${15 * cell}px —— ` +
        `这是 v4 的设计目标（mainRoomHeight），爆炸被改小了`,
    ).toBeGreaterThanOrEqual(15 * cell)

    expect(
      smallestRoomHeight - diameter,
      `爆炸直径 ${diameter}px（${diameter / cell} 格）比最小的一间战斗教室的 ` +
        `高 ${smallestRoomHeight}px（${smallestRoomHeight / cell} 格）小这么多 —— ` +
        `今天实测是 80px（2 格）；差距一旦变大，就该由 D3 决定要不要把 blastRadius 提到 ${smallestRoomHeight / 2}`,
    ).toBeLessThanOrEqual(2 * cell)
  })

  it('它比杂兵慢、比肉盾快（三个模板的速度阶梯不能乱）', () => {
    const splitters = enemies.enemies.splitter.generations
    const tank = enemies.enemies.tank
    expect(def.speed).toBeLessThan(splitters[0]!.speed)
    expect(def.speed).toBeGreaterThan(tank.speed)
  })

  it('它不靠接触伤害构成威胁（威胁只有抓取）', () => {
    expect(def.contactDamagePerTick).toBe(0)
  })

  it('它的贴图 key 在资源清单里有条目（否则占位方块生成不出来）', () => {
    const art = findAsset(def.textureKey)
    expect(art, `${def.textureKey} 不在 assetManifest 里`).toBeTruthy()
    expect(art!.placeholder, '缠抱怪笔记本电脑美术已交付').toBe(false)
    expect(art!.kind, '缠抱怪动作需要 spritesheet').toBe('spritesheet')
  })
})
