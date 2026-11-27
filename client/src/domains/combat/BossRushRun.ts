/**
 * BOSSRUSH：八层首领连战的**纯规则**。
 *
 * 这个文件不碰 Phaser、不碰 DOM，node 下可以直接测。战斗场景只负责
 * 「把这里算出来的顺序 / 血量 / 倍率 / 奖励摆到世界里」。
 *
 * ## 每层组合
 *
 * 每层首领数由难度决定（简单 1 / 普通 2 / 困难 3）。同一层内不重复；优先抽
 * `boss-pools.json` 常规名册里**还没出现过**的，7 位都上过场后才从旧组合里补。
 * 奶龙只在第八层出现，且第八层**必定**包含一位奶龙（普通/困难另有 1—2 位常规首领）。
 * 随机流从本局 `runSeed` + 难度派生，所以同一颗种子 + 同一难度能复现同一组合。
 *
 * ## 数值成长
 *
 * 用户的原话是「随着层数上升，boss 的弹幕频率、速度、移速、血量等都要提升，
 * 特别是血量」。所有倍率都写在 `bossrush.json`，这里只做换算：
 *
 * - 血量：`hpBase × hpGrowth^(层-1)`，最后一层再乘 `finalHpMultiplier`；
 * - 移速 / 弹幕频率 / 弹幕速度 / 技能频率 / 伤害：每层线性加百分比；
 * - 多首领时单只血量再乘 `bossHpScale`、单只伤害乘 `bossDamageScale`，
 *   让一层总血量约 1 / 1.4 / 1.65 倍，而不是 1 / 2 / 3 倍。
 *
 * ⚠️ 不要把这些数写回 `combat.json` 的 `bossHp` —— 那是普通闯关的基准，
 * BOSSRUSH 的成长只属于这个模式，两个模式各读各的表。
 *
 * ## 经验与天赋
 *
 * 每清完一层获得经验；经验满一级就升一级，每级给固定次数的天赋三选一。
 * 配置默认让八层正好升 8 级、共 16 次天赋（闯关模式一局最多 12 次），
 * 即「比闯关模式略高一点」。经验按层发（不随每层首领数翻倍），金币按
 * 这一层实际首领数发。经验值本身也会在 HUD 上显示，不是只存在结算里。
 */
import { ConfigError, type Difficulty } from '@/core/config'
import { Rng } from '@/core/rng'
import type { BossPoolsConfig, BossPoolEntry } from './bossPools'
import type { BossSkillsTable } from './BossSkillRuntime'

export const BOSS_RUSH_CONFIG_NAME = 'bossrush.json'
export const BOSS_RUSH_CONFIG_URL = `config/${BOSS_RUSH_CONFIG_NAME}`

/** `bossrush.json` 解析后的形状。字段全部是只读的，运行时不改配置。 */
export interface BossRushConfig {
  readonly schemaVersion: 1
  readonly totalFloors: number
  readonly finalBoss: string
  readonly finalRewardId: string
  /** 每个难度每层摆几位首领：简单 1 / 普通 2 / 困难 3。 */
  readonly bossesPerFloor: Readonly<Record<Difficulty, number>>
  /**
   * 多位首领时**单只血量**的缩放。简单 1、普通 0.7、困难 0.55 ——
   * 一层总血量因此约是 1.0 / 1.4 / 1.65 倍，而不是 1 / 2 / 3 倍，
   * 否则三只满血首领会把一场打成一局普通闯关的时长。
   */
  readonly bossHpScale: Readonly<Record<Difficulty, number>>
  /**
   * 多首领时**单只伤害**的缩放：简单 1、普通 0.85、困难 0.7。
   * 三只首领同时开火时，总伤害密度约为 2.1 倍而不是 3 倍。
   */
  readonly bossDamageScale: Readonly<Record<Difficulty, number>>
  readonly xpPerBossBase: number
  readonly xpPerBossGrowth: number
  readonly xpLevelBase: number
  readonly xpLevelGrowth: number
  readonly talentChoicesPerLevel: number
  readonly talentMaxOwned: number
  readonly coinsPerBossBase: number
  readonly coinsPerBossGrowth: number
  readonly hpBase: number
  readonly hpGrowth: number
  readonly finalHpMultiplier: number
  readonly bossSpeedPctPerFloor: number
  readonly barrageRatePctPerFloor: number
  readonly barrageSpeedPctPerFloor: number
  readonly skillRatePctPerFloor: number
  readonly damagePctPerFloor: number
  readonly chestCount: number
  /**
   * 每场首领战**开局就摆几只小怪**。
   *
   * 首领技能里有依赖小怪的：圆头耄耋的 `transmute` 要把小怪变形、
   * 酸 sprinkler / 肥猫的 `rally` 要号令小怪。只靠 8 秒一波的补怪，
   * 这些技能第一次放（5—12 秒）时场上可能还是空的。
   */
  readonly initialMinions: number
}

/** 一位首领在某层的战斗倍率。`1` = 普通闯关的基准。 */
export interface BossRushScaling {
  readonly hp: number
  /** 首领移速倍率（乘在 `deriveBossSpeed()` 上）。 */
  readonly speedMultiplier: number
  /** 弹幕频率倍率：`>1` 表示间隔更短、开火更密。 */
  readonly barrageRate: number
  /** 弹幕飞行速度倍率。 */
  readonly projectileSpeedMultiplier: number
  /** 首领技能频率倍率。 */
  readonly skillRate: number
  /** 首领伤害倍率（乘在普通闯关的 `bossDamageMultiplier` 上）。 */
  readonly damageMultiplier: number
}

export interface BossRushReward {
  readonly floor: number
  readonly xpGained: number
  readonly coins: number
  readonly levelUps: number
  readonly talentChoices: number
  readonly level: number
  readonly xpIntoLevel: number
  readonly xpToNext: number
}

function needObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ConfigError(path, `要一个对象，拿到 ${JSON.stringify(value)}`)
  return value as Record<string, unknown>
}

function needString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new ConfigError(path, `要一个非空字符串，拿到 ${JSON.stringify(value)}`)
  return value
}

function needNumber(value: unknown, path: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min)
    throw new ConfigError(path, `要一个 ≥ ${min} 的有限数，拿到 ${JSON.stringify(value)}`)
  return value
}

function needInteger(value: unknown, path: string, min = 1): number {
  const n = needNumber(value, path, min)
  if (!Number.isInteger(n)) throw new ConfigError(path, `要整数，拿到 ${n}`)
  return n
}

/**
 * 解析并校验 `bossrush.json`。首领名册与最终首领仍以 `boss-pools.json` 为唯一真值，
 * 这张表只声明「怎么打、怎么长、给多少」。
 */
export function parseBossRushConfig(
  raw: unknown,
  pools: BossPoolsConfig,
  bossSkills: BossSkillsTable,
): BossRushConfig {
  const root = needObject(raw, 'bossrush')
  if (root.schemaVersion !== 1)
    throw new ConfigError('bossrush.schemaVersion', '必须为 1')

  const totalFloors = needInteger(root.totalFloors, 'bossrush.totalFloors', 2)
  const expectedFloors = pools.roster.length + 1
  if (totalFloors !== expectedFloors)
    throw new ConfigError(
      'bossrush.totalFloors',
      `必须等于常规首领数 + 最终首领（${expectedFloors}），拿到 ${totalFloors}`,
    )

  const finalBoss = needString(root.finalBoss, 'bossrush.finalBoss')
  if (finalBoss !== pools.finalBoss)
    throw new ConfigError(
      'bossrush.finalBoss',
      `必须与 boss-pools.json 的最终首领一致（${pools.finalBoss}），拿到 ${finalBoss}`,
    )

  const byId = new Set(Object.values(bossSkills.bosses).map((boss) => boss.id))
  for (const id of [...pools.roster, finalBoss])
    if (!byId.has(id))
      throw new ConfigError('bossrush', `首领不存在于 boss-skills：${id}`)

  const perFloorRaw = needObject(root.bossesPerFloor, 'bossrush.bossesPerFloor')
  const bossesPerFloor = {
    easy: needInteger(perFloorRaw.easy, 'bossrush.bossesPerFloor.easy'),
    normal: needInteger(perFloorRaw.normal, 'bossrush.bossesPerFloor.normal'),
    hard: needInteger(perFloorRaw.hard, 'bossrush.bossesPerFloor.hard'),
  }
  for (const [difficulty, count] of Object.entries(bossesPerFloor))
    if (count > pools.roster.length)
      throw new ConfigError(
        'bossrush.bossesPerFloor',
        `${difficulty} 每层要 ${count} 位首领，但常规名册只有 ${pools.roster.length} 位（同一层不能重复）`,
      )

  const hpScaleRaw = needObject(root.bossHpScale, 'bossrush.bossHpScale')
  const bossHpScale = {
    easy: needNumber(hpScaleRaw.easy, 'bossrush.bossHpScale.easy', 0.01),
    normal: needNumber(hpScaleRaw.normal, 'bossrush.bossHpScale.normal', 0.01),
    hard: needNumber(hpScaleRaw.hard, 'bossrush.bossHpScale.hard', 0.01),
  }
  const damageScaleRaw = needObject(root.bossDamageScale, 'bossrush.bossDamageScale')
  const bossDamageScale = {
    easy: needNumber(damageScaleRaw.easy, 'bossrush.bossDamageScale.easy', 0.01),
    normal: needNumber(damageScaleRaw.normal, 'bossrush.bossDamageScale.normal', 0.01),
    hard: needNumber(damageScaleRaw.hard, 'bossrush.bossDamageScale.hard', 0.01),
  }

  return {
    schemaVersion: 1,
    totalFloors,
    finalBoss,
    finalRewardId: needString(root.finalRewardId, 'bossrush.finalRewardId'),
    bossesPerFloor,
    bossHpScale,
    bossDamageScale,
    xpPerBossBase: needNumber(root.xpPerBossBase, 'bossrush.xpPerBossBase', 1),
    xpPerBossGrowth: needNumber(root.xpPerBossGrowth, 'bossrush.xpPerBossGrowth'),
    xpLevelBase: needNumber(root.xpLevelBase, 'bossrush.xpLevelBase', 1),
    xpLevelGrowth: needNumber(root.xpLevelGrowth, 'bossrush.xpLevelGrowth'),
    talentChoicesPerLevel: needInteger(root.talentChoicesPerLevel, 'bossrush.talentChoicesPerLevel'),
    talentMaxOwned: needInteger(root.talentMaxOwned, 'bossrush.talentMaxOwned'),
    coinsPerBossBase: needNumber(root.coinsPerBossBase, 'bossrush.coinsPerBossBase'),
    coinsPerBossGrowth: needNumber(root.coinsPerBossGrowth, 'bossrush.coinsPerBossGrowth'),
    hpBase: needNumber(root.hpBase, 'bossrush.hpBase', 1),
    hpGrowth: needNumber(root.hpGrowth, 'bossrush.hpGrowth', 1),
    finalHpMultiplier: needNumber(root.finalHpMultiplier, 'bossrush.finalHpMultiplier', 1),
    bossSpeedPctPerFloor: needNumber(root.bossSpeedPctPerFloor, 'bossrush.bossSpeedPctPerFloor'),
    barrageRatePctPerFloor: needNumber(root.barrageRatePctPerFloor, 'bossrush.barrageRatePctPerFloor'),
    barrageSpeedPctPerFloor: needNumber(root.barrageSpeedPctPerFloor, 'bossrush.barrageSpeedPctPerFloor'),
    skillRatePctPerFloor: needNumber(root.skillRatePctPerFloor, 'bossrush.skillRatePctPerFloor'),
    damagePctPerFloor: needNumber(root.damagePctPerFloor, 'bossrush.damagePctPerFloor'),
    chestCount: needInteger(root.chestCount, 'bossrush.chestCount'),
    initialMinions: needInteger(root.initialMinions, 'bossrush.initialMinions', 0),
  }
}

/**
 * 一场 BOSSRUSH 的全部状态：顺序、当前层、经验、等级。
 *
 * 场景每清完一层（该层 1—3 位首领全部倒下）调一次 `defeatCurrentBoss()`，
 * 它返回这一层该发的东西；**推进层数也在这里发生**，所以调用方不要自己
 * `floor++`，否则下一层的倍率会错位。
 */
export class BossRushRun {
  readonly config: BossRushConfig
  /**
   * 第 1—8 层每层要打的首领组合。长度恒为 `totalFloors`，
   * 每层内不重复；第八层一定包含奶龙。
   */
  readonly groups: readonly (readonly BossPoolEntry[])[]
  readonly totalFloors: number
  /** 本难度每层几位首领（1 / 2 / 3）。 */
  readonly bossesPerFloor: number
  /** 本难度单只首领的血量缩放。 */
  readonly hpScale: number
  /** 本难度单只首领的伤害缩放。 */
  readonly damageScale: number

  private defeatedCount = 0
  private levelValue = 1
  private xpValue = 0

  constructor(
    config: BossRushConfig,
    pools: BossPoolsConfig,
    bossSkills: BossSkillsTable,
    runSeed: number,
    difficulty: Difficulty,
  ) {
    this.config = config
    this.totalFloors = config.totalFloors
    this.bossesPerFloor = config.bossesPerFloor[difficulty]
    this.hpScale = config.bossHpScale[difficulty]
    this.damageScale = config.bossDamageScale[difficulty]

    const byId = new Map<string, BossPoolEntry>()
    for (const [profile, boss] of Object.entries(bossSkills.bosses))
      byId.set(boss.id, { id: boss.id, profile: Number(profile), name: boss.name })

    // 难度也进种子：同一颗 runSeed 在三个难度下排出来的组合不应完全相同。
    const salt = difficulty === 'easy' ? 0x45 : difficulty === 'hard' ? 0x48 : 0x4e
    const rng = new Rng((runSeed ^ 0x42525553 ^ salt) >>> 0)
    const shuffle = <T>(items: T[]): T[] => {
      for (let i = items.length - 1; i > 0; i--) {
        const j = rng.between(0, i)
        ;[items[i], items[j]] = [items[j]!, items[i]!]
      }
      return items
    }

    const unseen = shuffle(
      pools.roster.map((id) => {
        const entry = byId.get(id)
        if (!entry) throw new ConfigError('bossrush', `首领不存在于 boss-skills：${id}`)
        return entry
      }),
    )
    const final = byId.get(config.finalBoss)
    if (!final) throw new ConfigError('bossrush.finalBoss', `最终首领不存在：${config.finalBoss}`)
    const seen: BossPoolEntry[] = []
    const groups: (readonly BossPoolEntry[])[] = []
    for (let floor = 1; floor <= this.totalFloors; floor++) {
      const group: BossPoolEntry[] = []
      if (floor === this.totalFloors) group.push(final)
      // 「优先出现之前没出现过的」：先把没上过场的常规首领填进来。
      while (group.length < this.bossesPerFloor && unseen.length)
        group.push(unseen.shift()!)
      // 常规首领都用过之后，才从已上过场的里补；同一层仍不重复。
      if (group.length < this.bossesPerFloor) {
        for (const entry of shuffle([...seen])) {
          if (group.length >= this.bossesPerFloor) break
          if (!group.includes(entry)) group.push(entry)
        }
      }
      if (group.length !== this.bossesPerFloor)
        throw new ConfigError(
          'bossrush.bossesPerFloor',
          `第 ${floor} 层凑不齐 ${this.bossesPerFloor} 位互不相同的首领（可用 ${group.length} 位）`,
        )
      for (const entry of group)
        if (entry.id !== config.finalBoss && !seen.includes(entry)) seen.push(entry)
      groups.push(Object.freeze(group))
    }
    this.groups = Object.freeze(groups)
  }

  /** 已击败的**层数**（0—8）。 */
  get defeated(): number {
    return this.defeatedCount
  }

  /** 下一场要打第几层（1 起；全部打完时停在最后一层）。 */
  get currentFloor(): number {
    return Math.min(this.totalFloors, this.defeatedCount + 1)
  }

  /** 当前这一层的首领组合（1—3 位）。 */
  get currentBosses(): readonly BossPoolEntry[] {
    return this.bossesAt(this.currentFloor)
  }

  get currentBoss(): BossPoolEntry {
    return this.currentBosses[0]!
  }

  /** 当前这一场是不是第八层（奶龙）。 */
  get isFinalBossFloor(): boolean {
    return this.currentFloor >= this.totalFloors
  }

  /** 八层是否已经全部打完（结算已经发生/即将发生）。 */
  get allDefeated(): boolean {
    return this.defeatedCount >= this.totalFloors
  }

  get level(): number {
    return this.levelValue
  }

  get xpIntoLevel(): number {
    return this.xpValue
  }

  get xpToNext(): number {
    return this.xpToNextForLevel(this.levelValue)
  }

  /** 第 `floor` 层的首领组合（1—3 位）；越界返回空数组。 */
  bossesAt(floor: number): readonly BossPoolEntry[] {
    return this.groups[Math.max(0, Math.min(this.totalFloors - 1, Math.floor(floor) - 1))] ?? []
  }

  /** 第 `floor` 层的第一位首领；UI 里只需要一个名字时用它。 */
  bossAt(floor: number): BossPoolEntry | null {
    return this.bossesAt(floor)[0] ?? null
  }

  xpForBoss(floor: number): number {
    return Math.round(this.config.xpPerBossBase + this.config.xpPerBossGrowth * (floor - 1))
  }

  xpToNextForLevel(level: number): number {
    return Math.round(this.config.xpLevelBase + this.config.xpLevelGrowth * (level - 1))
  }

  coinsForBoss(floor: number): number {
    return Math.round(this.config.coinsPerBossBase + this.config.coinsPerBossGrowth * (floor - 1))
  }

  /** 第 `floor` 层的首领倍率。纯读配置，不改状态。 */
  scalingFor(floor: number): BossRushScaling {
    const step = Math.max(0, floor - 1)
    const final = floor >= this.totalFloors ? this.config.finalHpMultiplier : 1
    const pct = (value: number): number => 1 + value / 100
    return {
      hp: Math.max(
        1,
        Math.round(this.config.hpBase * Math.pow(this.config.hpGrowth, step) * final * this.hpScale),
      ),
      speedMultiplier: pct(this.config.bossSpeedPctPerFloor * step),
      barrageRate: pct(this.config.barrageRatePctPerFloor * step),
      projectileSpeedMultiplier: pct(this.config.barrageSpeedPctPerFloor * step),
      skillRate: pct(this.config.skillRatePctPerFloor * step),
      damageMultiplier: pct(this.config.damagePctPerFloor * step) * this.damageScale,
    }
  }

  /**
   * 击败当前层的首领：发经验、结算升级、推进层数。
   *
   * ⚠️ **先发奖励、再推进层数**：返回值里的 `floor` 是刚打完的那一层，
   * 不是下一层。调用方拿它写通知栏 / 决定是否开商店。
   */
  defeatCurrentBoss(): BossRushReward {
    if (this.defeatedCount >= this.totalFloors)
      throw new Error('BOSSRUSH 已经全部通关，不能再结算首领')
    const floor = this.currentFloor
    const xpGained = this.xpForBoss(floor)
    // 金币按**这一层实际打了几位首领**发：普通/困难多打的怪要能换成商店补给。
    // 经验仍按层发，升级节奏与难度无关（16 次天赋上限不变）。
    const coins = this.coinsForBoss(floor) * this.currentBosses.length
    this.xpValue += xpGained
    let levelUps = 0
    // 配置允许一层经验跨多级；上限只是防止配置写错时死循环。
    while (levelUps < 1000 && this.xpValue >= this.xpToNextForLevel(this.levelValue)) {
      this.xpValue -= this.xpToNextForLevel(this.levelValue)
      this.levelValue += 1
      levelUps += 1
    }
    this.defeatedCount += 1
    return {
      floor,
      xpGained,
      coins,
      levelUps,
      talentChoices: levelUps * this.config.talentChoicesPerLevel,
      level: this.levelValue,
      xpIntoLevel: this.xpValue,
      xpToNext: this.xpToNextForLevel(this.levelValue),
    }
  }
}
