/**
 * 类型化配置加载器与数值派生。**零 Phaser 依赖**，node 下可直接单测。
 *
 * 红线 2（《人员分工方案》§9.4）：**配置数值不写死在代码里**，一律走配置表。
 * 血量、速度、伤害、冷却、概率全部在 `client/public/config/*.json`，
 * 改一次平衡不需要重新构建。
 *
 * ---
 *
 * ## 单位化血量：为什么配置表里写的不是血量
 *
 * 敌人表里没有 `maxHp` 这个字段，只有 `hpMode` + `hpValue`：
 *
 * | `hpMode` | `hpValue` 的含义 | 派生公式 |
 * |---|---|---|
 * | `'shots'` | **几发子弹打死** | `round(hpValue × 基线子弹伤害 × 难度enemyHp)` |
 * | `'ttkSeconds'` | **几秒打死** | `round(ttkSeconds × baselineDps × contactFactor × 难度enemyHp)` |
 *
 * 好处是**「一枪一个」这类设计要求变成自洽的**：D1 改武器伤害时敌人数值自动跟随，
 * 不会出现「说好一击必杀、改完武器变成两枪」这种没人发现的漂移。
 * 代价是敌人的血量不再是独立可填的数 —— 但这正是我们想要的。
 *
 * `oneShot: true` 的条目额外套一条**余量上限** `floor(基线子弹伤害 × 0.75)`：
 * 若 hpValue 恰好等于 1（血量 = 子弹伤害），暴击/四舍五入/难度乘数任一微调都可能
 * 让它变成两枪才死，爽感直接没了。留 25% 余量，任何难度下都是一枪。
 *
 * ⚠️ **余量上限只对声明了 `oneShot` 的条目生效。** 若无条件套在所有 `shots` 条目上，
 * 等于给整个 `shots` 体系封了 7 点血的天花板 —— 将来想表达「3 发击杀」的杂兵
 * （hpValue: 3 → 30）会被静默钳成 7。一个服务特例的规则不该反过来废掉整种表达方式。
 */

import { assetKeys, findAsset } from './assetManifest'

export type Difficulty = 'easy' | 'normal' | 'hard'
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard']

// ---------------------------------------------------------------- 配置表形状

export interface BalanceConfig {
  schemaVersion: number
  baseline: {
    bullet: { damage: number; fireIntervalMs: number; speed: number; radius: number }
    player: { maxHp: number; speed: number; radius: number; iframeMs: number }
    /** 每秒理论伤害 = bullet.damage / (fireIntervalMs / 1000)，配置里显式写出来便于核对 */
    baselineDps: number
  }
  spawn: {
    maxSpawnsPerFrame: number
    overflowStaggerMs: number
    maxAliveSoft: number
    maxAliveHard: number
    poolCapacity: number
    /** 队列里最老的请求最多等多久，超了丢掉并 warn */
    maxQueueAgeMs: number
    /** 队列长度上限 */
    maxQueueLength: number
  }
  frameDamage: {
    tickMs: number
    pairTtlMs: number
    maxTicksPerSourceDefault: number
    /**
     * 接触伤害的 tick 上限。**必须比默认值大得多。**
     *
     * 「接触」是一个**持续存在的源**（怪贴着你），限制它的结算次数的应该是
     * 玩家的无敌帧，不是这个上限。上限设小了，表现为
     * 「贴身站久了之后怪就不咬人了」——玩家会以为是自己卡了无敌，
     * 实际是被一个防溢出的兜底值掐掉的。
     */
    contactMaxTicks: number
  }
  juice: {
    hitstopBudgetRatio: number
    hitstopWindowMs: number
    traumaCap: number
    shakeMinIntervalMs: number
    particleCeilingSplitter: number
  }
}

export interface DifficultyConfig {
  schemaVersion: number
  difficulties: Record<Difficulty, DifficultyModifiers>
}

export interface DifficultyModifiers {
  enemyHp: number
  enemyDamage: number
  enemySpeed: number
  enemyCount: number
}

export interface AiConfig {
  nearTickHz: number
  farTickHz: number
  flinchMs: number
  /** 分离判定余量（px）：两个怪靠得比「半径和 + 这个数」更近就互相推开 */
  separationPad: number
  /**
   * 分离力上限（px/s）。**绝对速度量，不是倍数** ——
   * 用倍数的话，速度快的怪分离也快、慢的怪挤不散，手感不一致。
   */
  separationStrength: number
}

export interface SplitterGenerationDef {
  gen: number
  /** 声明「这一代必须一枪一个」，派生时套余量上限 */
  oneShot: boolean
  /** 「几发子弹击杀」 */
  hpValue: number
  speed: number
  radius: number
  visualScale: number
  textureKey: string
  contactDamagePerTick: number
  childCount: number
  splitDelayMs: number
  spawnStaggerMs: number
  spawnRadius: number
  fanAngleDeg: number
  graceMs: number
  graceMoveMult: number
  hitstopMs: number
  trauma: number
  particles: number
}

export interface SplitterJuiceConfig {
  comboWindowMs: number
  comboFlourishAt: number
  pitchStepCents: number
  flourishFlash: number
}

export interface TankFrameDamageConfig {
  tickMs: number
  bullet: {
    /** 子弹穿透、不被消耗 —— 这是这个怪的身份 */
    pierce: boolean
    impactFull: boolean
    tickDamageRatio: number
    maxTicksPerSource: number
  }
  melee: {
    tickDamageRatio: number
    maxTicksPerSource: number
  }
}

export interface TankSlamConfig {
  range: number
  windupMs: number
  radius: number
  damage: number
  knockback: number
  cooldownMs: number
  recoverMs: number
  vulnerableDamageMult: number
  hitstopMs: number
}

export interface TankHitSlowConfig {
  stackPerHit: number
  maxStacks: number
  speedMultPerStack: number
  minSpeedMult: number
  stackDurationMs: number
  decayIntervalMs: number
  staggerMs: number
  staggerCooldownMs: number
  /** 踉跄期间的速度倍数（乘在已经过 `minSpeedMult` 地板之后的实际速度上） */
  staggerSpeedMult: number
}

export interface TankAntiPinConfig {
  unstuckMs: number
  lateralEscapeMs: number
  minDistFromPlayer: number
  /** 「几乎没在动」的判定阈值（px/s）。低于它才开始累计卡住时间 */
  stuckSpeedThreshold: number
  /** 侧向逃逸时的速度倍数 */
  lateralSpeedMult: number
}

export interface TankJuiceConfig {
  hitSfxMinIntervalMs: number
  damageEventBatchMs: number
  flashHz: number
  jitterHz: number
  squashHz: number
  hpPitchCents: number
}

export interface SplitterDef {
  kind: 'splitter'
  displayName: string
  threatLevel: number
  hpMode: 'shots'
  aggroRadius: number
  loseTargetRadius: number
  ai: AiConfig
  generations: SplitterGenerationDef[]
  juice: SplitterJuiceConfig
}

export interface TankDef {
  kind: 'tank'
  displayName: string
  threatLevel: number
  hpMode: 'ttkSeconds'
  ttkSeconds: number
  contactFactor: number
  speed: number
  radius: number
  visualScale: number
  textureKey: string
  contactDamagePerTick: number
  aggroRadius: number
  loseTargetRadius: number
  ai: AiConfig
  frameDamage: TankFrameDamageConfig
  slam: TankSlamConfig
  hitSlow: TankHitSlowConfig
  antiPin: TankAntiPinConfig
  juice: TankJuiceConfig
}

export type EnemyDef = SplitterDef | TankDef

export interface RadialProjectileConfig {
  count: number
  speed: number
  radius: number
  damage: number
  lifetimeMs: number
  maxActive: number
  spawnRadius: number
  volleyOffsetDeg: number
}

export interface Stage2BossDef {
  strafeSpeedMult: number
  strafeTurnMs: number
  displayName: string
  speed: number
  radius: number
  visualScale: number
  aggroRadius: number
  keepDistance: number
  windupMs: number
  recoverMs: number
  cooldownMs: number
  projectile: RadialProjectileConfig
}

export interface EnemiesConfig {
  schemaVersion: number
  stage2Boss: Stage2BossDef
  enemies: {
    splitter: SplitterDef
    tank: TankDef
  }
}

// ---------------------------------------------------------------- 派生结果

export interface DerivedSplitterGeneration {
  gen: number
  maxHp: number
  /** 已乘难度 `enemySpeed` */
  speed: number
  radius: number
  visualScale: number
  textureKey: string
  /** 已乘难度 `enemyDamage` */
  contactDamagePerTick: number
  childCount: number
  splitDelayMs: number
  spawnStaggerMs: number
  spawnRadius: number
  fanAngleDeg: number
  graceMs: number
  graceMoveMult: number
  hitstopMs: number
  trauma: number
  particles: number
}

export interface DerivedTank {
  maxHp: number
  /** 已乘难度 `enemySpeed` */
  speed: number
  radius: number
  visualScale: number
  textureKey: string
  /** 已乘难度 `enemyDamage` */
  slamDamage: number
  /** 每发子弹打在肉盾身上的伤害：全额冲击 + 穿透期间 1 次 tick */
  damagePerBullet: number
  /** 每发子弹的穿透 tick 伤害 */
  pierceTickDamage: number
  /** 近战每个 tick 的伤害 */
  meleeTickDamage: number
  /** 预期击杀耗时（秒），契约测试拿它断言 = ttkSeconds */
  expectedTtkSeconds: number
}

// ---------------------------------------------------------------- 错误

export class ConfigError extends Error {
  constructor(
    /** 出问题的字段路径，例：`enemies.splitter.generations[1].hpValue` */
    readonly path: string,
    message: string,
  ) {
    super(`配置表错误 @ ${path}：${message}`)
    this.name = 'ConfigError'
  }
}

// ---------------------------------------------------------------- 数值工具

/** 四舍五入（.5 向上）。**全项目唯一的舍入规则**，不要在别处改用 ceil/floor。 */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5)
}

// ---------------------------------------------------------------- 派生

/**
 * 一击必杀的余量上限：`floor(基线子弹伤害 × 0.75)`。
 * 保证「血量 ≤ 这一发子弹的 75%」，任何难度乘数都吃不掉它。
 */
export function oneShotHpCap(balance: BalanceConfig): number {
  return Math.max(1, Math.floor(balance.baseline.bullet.damage * 0.75))
}

export function deriveSplitterGeneration(
  def: SplitterGenerationDef,
  diff: DifficultyModifiers,
  balance: BalanceConfig,
): DerivedSplitterGeneration {
  const bulletDamage = balance.baseline.bullet.damage
  let maxHp = roundHalfUp(def.hpValue * bulletDamage * diff.enemyHp)
  if (def.oneShot) maxHp = Math.min(maxHp, oneShotHpCap(balance))
  maxHp = Math.max(1, maxHp)

  return {
    gen: def.gen,
    maxHp,
    speed: Math.round(def.speed * diff.enemySpeed),
    radius: def.radius,
    visualScale: def.visualScale,
    textureKey: def.textureKey,
    contactDamagePerTick: roundHalfUp(def.contactDamagePerTick * diff.enemyDamage),
    childCount: def.childCount,
    splitDelayMs: def.splitDelayMs,
    spawnStaggerMs: def.spawnStaggerMs,
    spawnRadius: def.spawnRadius,
    fanAngleDeg: def.fanAngleDeg,
    graceMs: def.graceMs,
    graceMoveMult: def.graceMoveMult,
    hitstopMs: def.hitstopMs,
    trauma: def.trauma,
    particles: def.particles,
  }
}

export function deriveTank(
  def: TankDef,
  diff: DifficultyModifiers,
  balance: BalanceConfig,
): DerivedTank {
  const bulletDamage = balance.baseline.bullet.damage
  const maxHp = Math.max(
    1,
    roundHalfUp(def.ttkSeconds * balance.baseline.baselineDps * def.contactFactor * diff.enemyHp),
  )

  const pierceTickDamage = roundHalfUp(bulletDamage * def.frameDamage.bullet.tickDamageRatio)
  const impact = def.frameDamage.bullet.impactFull ? bulletDamage : 0
  // 子弹在肉盾体积内的停留时间 ≈ 直径 / 弹速；100ms 节拍下坐实 1 次，偶尔 2 次。
  const expectedPierceTicks = 1
  const damagePerBullet = impact + pierceTickDamage * expectedPierceTicks

  const dps = (damagePerBullet / balance.baseline.bullet.fireIntervalMs) * 1000

  return {
    maxHp,
    speed: Math.round(def.speed * diff.enemySpeed),
    radius: def.radius,
    visualScale: def.visualScale,
    textureKey: def.textureKey,
    slamDamage: roundHalfUp(def.slam.damage * diff.enemyDamage),
    damagePerBullet,
    pierceTickDamage,
    meleeTickDamage: roundHalfUp(bulletDamage * def.frameDamage.melee.tickDamageRatio),
    expectedTtkSeconds: maxHp / dps,
  }
}

export interface ConfigBundle {
  balance: BalanceConfig
  difficulty: DifficultyConfig
  enemies: EnemiesConfig
}

// ---------------------------------------------------------------- 校验

function need<T>(value: T | undefined | null, path: string): T {
  if (value === undefined || value === null) throw new ConfigError(path, '缺字段')
  return value
}

function needNumber(
  value: unknown,
  path: string,
  opts: { min?: number; max?: number } = {},
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ConfigError(path, `期望有限数值，实际是 ${JSON.stringify(value)}`)
  }
  if (opts.min !== undefined && value < opts.min) {
    throw new ConfigError(path, `${value} 小于下界 ${opts.min}`)
  }
  if (opts.max !== undefined && value > opts.max) {
    throw new ConfigError(path, `${value} 大于上界 ${opts.max}`)
  }
  return value
}

function needString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ConfigError(path, `期望非空字符串，实际是 ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * 校验并派生。**不碰网络** —— 契约测试直接读磁盘上的 JSON 喂给它，
 * 保证「测的就是生产跑的那份字节」。
 */
export function parseConfigBundle(raw: {
  balance: unknown
  difficulty: unknown
  enemies: unknown
}): ConfigBundle {
  const balance = validateBalance(raw.balance)
  const difficulty = validateDifficulty(raw.difficulty)
  const enemies = validateEnemies(raw.enemies)
  return { balance, difficulty, enemies }
}

export function validateBalance(raw: unknown): BalanceConfig {
  const r = need(raw as Record<string, unknown>, 'balance')
  const baseline = need(r.baseline as Record<string, unknown>, 'balance.baseline')
  const bullet = need(baseline.bullet as Record<string, unknown>, 'balance.baseline.bullet')
  const player = need(baseline.player as Record<string, unknown>, 'balance.baseline.player')
  const spawn = need(r.spawn as Record<string, unknown>, 'balance.spawn')
  const frameDamage = need(r.frameDamage as Record<string, unknown>, 'balance.frameDamage')
  const juice = need(r.juice as Record<string, unknown>, 'balance.juice')

  const damage = needNumber(bullet.damage, 'balance.baseline.bullet.damage', { min: 1 })
  const fireIntervalMs = needNumber(
    bullet.fireIntervalMs,
    'balance.baseline.bullet.fireIntervalMs',
    {
      min: 1,
    },
  )
  const baselineDps = needNumber(baseline.baselineDps, 'balance.baseline.baselineDps', { min: 1 })

  // baselineDps 必须等于由伤害与射速推出的值，否则单位化血量会两套口径打架
  const impliedDps = (damage / fireIntervalMs) * 1000
  if (Math.abs(impliedDps - baselineDps) > 0.01) {
    throw new ConfigError(
      'balance.baseline.baselineDps',
      `写的是 ${baselineDps}，但 damage/fireIntervalMs 推出来是 ${impliedDps.toFixed(2)}。` +
        `两者必须一致，否则「几秒击杀」和「几发击杀」会各算各的。`,
    )
  }

  const tickMs = needNumber(frameDamage.tickMs, 'balance.frameDamage.tickMs', { min: 1 })

  return {
    schemaVersion: needNumber(r.schemaVersion, 'balance.schemaVersion', { min: 1 }),
    baseline: {
      bullet: {
        damage,
        fireIntervalMs,
        speed: needNumber(bullet.speed, 'balance.baseline.bullet.speed', { min: 1 }),
        radius: needNumber(bullet.radius, 'balance.baseline.bullet.radius', { min: 0 }),
      },
      player: {
        maxHp: needNumber(player.maxHp, 'balance.baseline.player.maxHp', { min: 1 }),
        speed: needNumber(player.speed, 'balance.baseline.player.speed', { min: 1 }),
        radius: needNumber(player.radius, 'balance.baseline.player.radius', { min: 0 }),
        iframeMs: needNumber(player.iframeMs, 'balance.baseline.player.iframeMs', { min: 0 }),
      },
      baselineDps,
    },
    spawn: {
      maxSpawnsPerFrame: needNumber(spawn.maxSpawnsPerFrame, 'balance.spawn.maxSpawnsPerFrame', {
        min: 1,
      }),
      overflowStaggerMs: needNumber(spawn.overflowStaggerMs, 'balance.spawn.overflowStaggerMs', {
        min: 0,
      }),
      maxAliveSoft: needNumber(spawn.maxAliveSoft, 'balance.spawn.maxAliveSoft', { min: 1 }),
      maxAliveHard: needNumber(spawn.maxAliveHard, 'balance.spawn.maxAliveHard', { min: 1 }),
      poolCapacity: needNumber(spawn.poolCapacity, 'balance.spawn.poolCapacity', { min: 1 }),
      maxQueueAgeMs: needNumber(spawn.maxQueueAgeMs, 'balance.spawn.maxQueueAgeMs', { min: 1 }),
      maxQueueLength: needNumber(spawn.maxQueueLength, 'balance.spawn.maxQueueLength', { min: 1 }),
    },
    frameDamage: {
      tickMs,
      pairTtlMs: needNumber(frameDamage.pairTtlMs, 'balance.frameDamage.pairTtlMs', {
        min: tickMs,
      }),
      maxTicksPerSourceDefault: needNumber(
        frameDamage.maxTicksPerSourceDefault,
        'balance.frameDamage.maxTicksPerSourceDefault',
        { min: 1 },
      ),
      contactMaxTicks: needNumber(
        frameDamage.contactMaxTicks,
        'balance.frameDamage.contactMaxTicks',
        { min: 1 },
      ),
    },
    juice: {
      hitstopBudgetRatio: needNumber(juice.hitstopBudgetRatio, 'balance.juice.hitstopBudgetRatio', {
        min: 0,
        max: 1,
      }),
      hitstopWindowMs: needNumber(juice.hitstopWindowMs, 'balance.juice.hitstopWindowMs', {
        min: 1,
      }),
      traumaCap: needNumber(juice.traumaCap, 'balance.juice.traumaCap', { min: 0, max: 1 }),
      shakeMinIntervalMs: needNumber(juice.shakeMinIntervalMs, 'balance.juice.shakeMinIntervalMs', {
        min: 0,
      }),
      particleCeilingSplitter: needNumber(
        juice.particleCeilingSplitter,
        'balance.juice.particleCeilingSplitter',
        { min: 0 },
      ),
    },
  }
}

export function validateDifficulty(raw: unknown): DifficultyConfig {
  const r = need(raw as Record<string, unknown>, 'difficulty')
  const table = need(r.difficulties as Record<string, unknown>, 'difficulty.difficulties')

  const out = {} as Record<Difficulty, DifficultyModifiers>
  for (const d of DIFFICULTIES) {
    const m = need(table[d] as Record<string, unknown>, `difficulty.difficulties.${d}`)
    out[d] = {
      enemyHp: needNumber(m.enemyHp, `difficulty.difficulties.${d}.enemyHp`, { min: 0.1 }),
      enemyDamage: needNumber(m.enemyDamage, `difficulty.difficulties.${d}.enemyDamage`, {
        min: 0,
      }),
      enemySpeed: needNumber(m.enemySpeed, `difficulty.difficulties.${d}.enemySpeed`, { min: 0.1 }),
      enemyCount: needNumber(m.enemyCount, `difficulty.difficulties.${d}.enemyCount`, { min: 0 }),
    }
  }

  return {
    schemaVersion: needNumber(r.schemaVersion, 'difficulty.schemaVersion', { min: 1 }),
    difficulties: out,
  }
}

export function validateEnemies(raw: unknown): EnemiesConfig {
  const r = need(raw as Record<string, unknown>, 'enemies')
  const enemies = need(r.enemies as Record<string, unknown>, 'enemies.enemies')

  const splitter = validateSplitter(need(enemies.splitter, 'enemies.enemies.splitter'))
  const tank = validateTank(need(enemies.tank, 'enemies.enemies.tank'))

  return {
    schemaVersion: needNumber(r.schemaVersion, 'enemies.schemaVersion', { min: 1 }),
    stage2Boss: validateStage2Boss(r.stage2Boss),
    enemies: { splitter, tank },
  }
}

function validateStage2Boss(raw: unknown): Stage2BossDef {
  const path = 'enemies.stage2Boss'
  const r = need(raw as Record<string, unknown>, path)
  const p = need(r.projectile as Record<string, unknown>, `${path}.projectile`)
  const count = needNumber(p.count, `${path}.projectile.count`, { min: 4, max: 128 })
  const maxActive = needNumber(p.maxActive, `${path}.projectile.maxActive`, {
    min: count,
    max: 512,
  })
  if (!Number.isInteger(count) || !Number.isInteger(maxActive))
    throw new ConfigError(`${path}.projectile`, '弹粒数量和池容量必须为整数')
  const windupMs = needNumber(r.windupMs, `${path}.windupMs`, { min: 1 })
  const recoverMs = needNumber(r.recoverMs, `${path}.recoverMs`, { min: 1 })
  const aggroRadius = needNumber(r.aggroRadius, `${path}.aggroRadius`, { min: 1 })
  return {
    displayName: needString(r.displayName, `${path}.displayName`),
    strafeSpeedMult: needNumber(r.strafeSpeedMult, `${path}.strafeSpeedMult`, { min: 0.1 }),
    strafeTurnMs: needNumber(r.strafeTurnMs, `${path}.strafeTurnMs`, { min: 1 }),
    speed: needNumber(r.speed, `${path}.speed`, { min: 1 }),
    radius: needNumber(r.radius, `${path}.radius`, { min: 1 }),
    visualScale: needNumber(r.visualScale, `${path}.visualScale`, { min: 0.1 }),
    aggroRadius,
    keepDistance: needNumber(r.keepDistance, `${path}.keepDistance`, { min: 1, max: aggroRadius }),
    windupMs,
    recoverMs,
    cooldownMs: needNumber(r.cooldownMs, `${path}.cooldownMs`, { min: windupMs + recoverMs }),
    projectile: {
      count,
      maxActive,
      speed: needNumber(p.speed, `${path}.projectile.speed`, { min: 1 }),
      radius: needNumber(p.radius, `${path}.projectile.radius`, { min: 1 }),
      damage: needNumber(p.damage, `${path}.projectile.damage`, { min: 0 }),
      lifetimeMs: needNumber(p.lifetimeMs, `${path}.projectile.lifetimeMs`, { min: 1 }),
      spawnRadius: needNumber(p.spawnRadius, `${path}.projectile.spawnRadius`, { min: 0 }),
      volleyOffsetDeg: needNumber(p.volleyOffsetDeg, `${path}.projectile.volleyOffsetDeg`, {
        min: 0,
        max: 360,
      }),
    },
  }
}

function validateAi(raw: unknown, path: string): AiConfig {
  const a = need(raw as Record<string, unknown>, path)
  const nearTickHz = needNumber(a.nearTickHz, `${path}.nearTickHz`, { min: 1 })
  const farTickHz = needNumber(a.farTickHz, `${path}.farTickHz`, { min: 0.1 })
  if (farTickHz > nearTickHz) {
    throw new ConfigError(
      `${path}.farTickHz`,
      `远处的 tick 频率不能高于近处（${farTickHz} > ${nearTickHz}）`,
    )
  }
  return {
    nearTickHz,
    farTickHz,
    flinchMs: needNumber(a.flinchMs, `${path}.flinchMs`, { min: 0 }),
    separationPad: needNumber(a.separationPad, `${path}.separationPad`, { min: 0 }),
    separationStrength: needNumber(a.separationStrength, `${path}.separationStrength`, { min: 0 }),
  }
}

function validateTextureKey(key: string, path: string, expectKind: string): string {
  const entry = findAsset(key)
  if (!entry) {
    throw new ConfigError(
      path,
      `"${key}" 不在资源清单里。清单在 core/assetManifest.ts 的 ASSETS 数组，` +
        `现有 key：${assetKeys().join(', ')}`,
    )
  }
  if (expectKind === 'image' && entry.kind === 'audio') {
    throw new ConfigError(path, `"${key}" 在清单里是音频，不能当贴图用`)
  }
  if (expectKind === 'image' && !entry.width) {
    throw new ConfigError(path, `"${key}" 在清单里没写 width/height，占位方块生成不出来`)
  }
  return key
}

function validateSplitter(raw: unknown): SplitterDef {
  const path = 'enemies.enemies.splitter'
  const r = need(raw as Record<string, unknown>, path)

  const hpMode = needString(r.hpMode, `${path}.hpMode`)
  if (hpMode !== 'shots') {
    throw new ConfigError(`${path}.hpMode`, `分裂怪必须是 'shots'（几发击杀），实际是 "${hpMode}"`)
  }

  const gensRaw = need(r.generations, `${path}.generations`)
  if (!Array.isArray(gensRaw) || gensRaw.length === 0) {
    throw new ConfigError(`${path}.generations`, '必须是非空数组')
  }

  const generations = gensRaw.map((g, i) => validateGeneration(g, `${path}.generations[${i}]`))

  // 代际必须从 0 连续递增到 n-1，且「血量递减、速度递增」——
  // 这是玩家提问里明确的「体型会缩小，速度会加快，血量会变低」。
  for (let i = 0; i < generations.length; i++) {
    const g = generations[i]!
    if (g.gen !== i) {
      throw new ConfigError(
        `${path}.generations[${i}].gen`,
        `期望 ${i}，实际是 ${g.gen}（必须从 0 连续递增）`,
      )
    }
    if (i === 0) continue
    const prev = generations[i - 1]!
    if (g.hpValue >= prev.hpValue) {
      throw new ConfigError(
        `${path}.generations[${i}].hpValue`,
        `第 ${i} 代血量 ${g.hpValue} 不低于上一代 ${prev.hpValue}，违反「越分裂越脆」`,
      )
    }
    // ⚠️ 2026-10-16 放宽：原来是**必须更快**（`<=` 就拒），现在**允许同速**。
    //    设计上的理由变了 —— 分裂出来的小怪比母体还快，玩家越打越被追着跑，
    //    那不是「爽」是「罚」。**但不许更慢**：分裂出来的比母体慢会显得像卡住了。
    if (g.speed < prev.speed) {
      throw new ConfigError(
        `${path}.generations[${i}].speed`,
        `第 ${i} 代速度 ${g.speed} 低于上一代 ${prev.speed} —— 分裂出来的不该比母体还慢`,
      )
    }
    if (g.radius >= prev.radius) {
      throw new ConfigError(
        `${path}.generations[${i}].radius`,
        `第 ${i} 代体型 ${g.radius} 不小于上一代 ${prev.radius}，违反「体型会缩小」`,
      )
    }
  }

  // 最后一代不能再分裂
  const last = generations[generations.length - 1]!
  if (last.childCount !== 0) {
    throw new ConfigError(
      `${path}.generations[${generations.length - 1}].childCount`,
      `最后一代不能再分裂，必须是 0，实际是 ${last.childCount}`,
    )
  }

  const j = need(r.juice as Record<string, unknown>, `${path}.juice`)
  const comboWindowMs = needNumber(j.comboWindowMs, `${path}.juice.comboWindowMs`, { min: 1 })

  return {
    kind: 'splitter',
    displayName: needString(r.displayName, `${path}.displayName`),
    threatLevel: needNumber(r.threatLevel, `${path}.threatLevel`, { min: 1, max: 5 }),
    hpMode: 'shots',
    aggroRadius: needNumber(r.aggroRadius, `${path}.aggroRadius`, { min: 1 }),
    loseTargetRadius: needNumber(r.loseTargetRadius, `${path}.loseTargetRadius`, { min: 1 }),
    ai: validateAi(r.ai, `${path}.ai`),
    generations,
    juice: {
      comboWindowMs,
      comboFlourishAt: needNumber(j.comboFlourishAt, `${path}.juice.comboFlourishAt`, { min: 1 }),
      pitchStepCents: needNumber(j.pitchStepCents, `${path}.juice.pitchStepCents`, { min: 0 }),
      flourishFlash: needNumber(j.flourishFlash, `${path}.juice.flourishFlash`, { min: 0, max: 1 }),
    },
  }
}

function validateGeneration(raw: unknown, path: string): SplitterGenerationDef {
  const g = need(raw as Record<string, unknown>, path)
  const childCount = needNumber(g.childCount, `${path}.childCount`, { min: 0 })
  const splitDelayMs = needNumber(g.splitDelayMs, `${path}.splitDelayMs`, { min: 0 })

  if (childCount > 0 && splitDelayMs <= 0) {
    throw new ConfigError(
      `${path}.splitDelayMs`,
      `会分裂（childCount ${childCount}）就必须有正的延迟`,
    )
  }

  return {
    gen: needNumber(g.gen, `${path}.gen`, { min: 0 }),
    oneShot: g.oneShot === true,
    hpValue: needNumber(g.hpValue, `${path}.hpValue`, { min: 0.01 }),
    speed: needNumber(g.speed, `${path}.speed`, { min: 1 }),
    radius: needNumber(g.radius, `${path}.radius`, { min: 1 }),
    visualScale: needNumber(g.visualScale, `${path}.visualScale`, { min: 0.1 }),
    textureKey: validateTextureKey(
      needString(g.textureKey, `${path}.textureKey`),
      `${path}.textureKey`,
      'image',
    ),
    contactDamagePerTick: needNumber(g.contactDamagePerTick, `${path}.contactDamagePerTick`, {
      min: 0,
    }),
    childCount,
    splitDelayMs,
    spawnStaggerMs: needNumber(g.spawnStaggerMs, `${path}.spawnStaggerMs`, { min: 0 }),
    spawnRadius: needNumber(g.spawnRadius, `${path}.spawnRadius`, { min: 0 }),
    fanAngleDeg: needNumber(g.fanAngleDeg, `${path}.fanAngleDeg`, { min: 0, max: 360 }),
    graceMs: needNumber(g.graceMs, `${path}.graceMs`, { min: 0 }),
    graceMoveMult: needNumber(g.graceMoveMult, `${path}.graceMoveMult`, { min: 0, max: 1 }),
    hitstopMs: needNumber(g.hitstopMs, `${path}.hitstopMs`, { min: 0 }),
    trauma: needNumber(g.trauma, `${path}.trauma`, { min: 0, max: 1 }),
    particles: needNumber(g.particles, `${path}.particles`, { min: 0 }),
  }
}

function validateTank(raw: unknown): TankDef {
  const path = 'enemies.enemies.tank'
  const r = need(raw as Record<string, unknown>, path)

  const hpMode = needString(r.hpMode, `${path}.hpMode`)
  if (hpMode !== 'ttkSeconds') {
    throw new ConfigError(
      `${path}.hpMode`,
      `肉盾怪必须是 'ttkSeconds'（几秒击杀），实际是 "${hpMode}"`,
    )
  }

  const fd = need(r.frameDamage as Record<string, unknown>, `${path}.frameDamage`)
  const fdBullet = need(fd.bullet as Record<string, unknown>, `${path}.frameDamage.bullet`)
  const fdMelee = need(fd.melee as Record<string, unknown>, `${path}.frameDamage.melee`)

  const pierce = fdBullet.pierce === true
  if (!pierce) {
    throw new ConfigError(
      `${path}.frameDamage.bullet.pierce`,
      '肉盾怪必须是穿透的（pierce: true）—— 子弹不被消耗是这个怪的身份',
    )
  }

  const slam = need(r.slam as Record<string, unknown>, `${path}.slam`)
  const hitSlow = need(r.hitSlow as Record<string, unknown>, `${path}.hitSlow`)
  const antiPin = need(r.antiPin as Record<string, unknown>, `${path}.antiPin`)
  const juice = need(r.juice as Record<string, unknown>, `${path}.juice`)

  const maxStacks = needNumber(hitSlow.maxStacks, `${path}.hitSlow.maxStacks`, { min: 0 })
  const speedMultPerStack = needNumber(
    hitSlow.speedMultPerStack,
    `${path}.hitSlow.speedMultPerStack`,
    {
      min: 0,
      max: 1,
    },
  )
  const minSpeedMult = needNumber(hitSlow.minSpeedMult, `${path}.hitSlow.minSpeedMult`, {
    min: 0.01,
    max: 1,
  })

  // 满层减速不能低于地板，否则「罚站死」（玩家提问里担心的手感问题）
  const fullSlow = Math.pow(speedMultPerStack, maxStacks)
  if (fullSlow < minSpeedMult) {
    throw new ConfigError(
      `${path}.hitSlow.minSpeedMult`,
      `满 ${maxStacks} 层减速是 ${fullSlow.toFixed(3)}，低于地板 ${minSpeedMult}；` +
        `地板本意是防「罚站死」，现在它不起作用。`,
    )
  }

  const windupMs = needNumber(slam.windupMs, `${path}.slam.windupMs`, { min: 1 })
  const recoverMs = needNumber(slam.recoverMs, `${path}.slam.recoverMs`, { min: 0 })

  return {
    kind: 'tank',
    displayName: needString(r.displayName, `${path}.displayName`),
    threatLevel: needNumber(r.threatLevel, `${path}.threatLevel`, { min: 1, max: 5 }),
    hpMode: 'ttkSeconds',
    ttkSeconds: needNumber(r.ttkSeconds, `${path}.ttkSeconds`, { min: 0.1 }),
    contactFactor: needNumber(r.contactFactor, `${path}.contactFactor`, { min: 0.1 }),
    speed: needNumber(r.speed, `${path}.speed`, { min: 1 }),
    radius: needNumber(r.radius, `${path}.radius`, { min: 1 }),
    visualScale: needNumber(r.visualScale, `${path}.visualScale`, { min: 0.1 }),
    textureKey: validateTextureKey(
      needString(r.textureKey, `${path}.textureKey`),
      `${path}.textureKey`,
      'image',
    ),
    contactDamagePerTick: needNumber(r.contactDamagePerTick, `${path}.contactDamagePerTick`, {
      min: 0,
    }),
    aggroRadius: needNumber(r.aggroRadius, `${path}.aggroRadius`, { min: 1 }),
    loseTargetRadius: needNumber(r.loseTargetRadius, `${path}.loseTargetRadius`, { min: 1 }),
    ai: validateAi(r.ai, `${path}.ai`),
    frameDamage: {
      tickMs: needNumber(fd.tickMs, `${path}.frameDamage.tickMs`, { min: 1 }),
      bullet: {
        pierce: true,
        impactFull: fdBullet.impactFull !== false,
        tickDamageRatio: needNumber(
          fdBullet.tickDamageRatio,
          `${path}.frameDamage.bullet.tickDamageRatio`,
          { min: 0 },
        ),
        maxTicksPerSource: needNumber(
          fdBullet.maxTicksPerSource,
          `${path}.frameDamage.bullet.maxTicksPerSource`,
          { min: 1 },
        ),
      },
      melee: {
        tickDamageRatio: needNumber(
          fdMelee.tickDamageRatio,
          `${path}.frameDamage.melee.tickDamageRatio`,
          {
            min: 0,
          },
        ),
        maxTicksPerSource: needNumber(
          fdMelee.maxTicksPerSource,
          `${path}.frameDamage.melee.maxTicksPerSource`,
          { min: 1 },
        ),
      },
    },
    slam: {
      range: needNumber(slam.range, `${path}.slam.range`, { min: 1 }),
      windupMs,
      radius: needNumber(slam.radius, `${path}.slam.radius`, { min: 1 }),
      damage: needNumber(slam.damage, `${path}.slam.damage`, { min: 0 }),
      knockback: needNumber(slam.knockback, `${path}.slam.knockback`, { min: 0 }),
      cooldownMs: needNumber(slam.cooldownMs, `${path}.slam.cooldownMs`, { min: 0 }),
      recoverMs,
      vulnerableDamageMult: needNumber(
        slam.vulnerableDamageMult,
        `${path}.slam.vulnerableDamageMult`,
        { min: 1 },
      ),
      hitstopMs: needNumber(slam.hitstopMs, `${path}.slam.hitstopMs`, { min: 0 }),
    },
    hitSlow: {
      stackPerHit: needNumber(hitSlow.stackPerHit, `${path}.hitSlow.stackPerHit`, { min: 0 }),
      maxStacks,
      speedMultPerStack,
      minSpeedMult,
      stackDurationMs: needNumber(hitSlow.stackDurationMs, `${path}.hitSlow.stackDurationMs`, {
        min: 1,
      }),
      decayIntervalMs: needNumber(hitSlow.decayIntervalMs, `${path}.hitSlow.decayIntervalMs`, {
        min: 1,
      }),
      staggerMs: needNumber(hitSlow.staggerMs, `${path}.hitSlow.staggerMs`, { min: 0 }),
      staggerCooldownMs: needNumber(
        hitSlow.staggerCooldownMs,
        `${path}.hitSlow.staggerCooldownMs`,
        {
          min: 0,
        },
      ),
      staggerSpeedMult: needNumber(hitSlow.staggerSpeedMult, `${path}.hitSlow.staggerSpeedMult`, {
        min: 0,
        max: 1,
      }),
    },
    antiPin: {
      unstuckMs: needNumber(antiPin.unstuckMs, `${path}.antiPin.unstuckMs`, { min: 0 }),
      lateralEscapeMs: needNumber(antiPin.lateralEscapeMs, `${path}.antiPin.lateralEscapeMs`, {
        min: 0,
      }),
      minDistFromPlayer: needNumber(
        antiPin.minDistFromPlayer,
        `${path}.antiPin.minDistFromPlayer`,
        {
          min: 0,
        },
      ),
      stuckSpeedThreshold: needNumber(
        antiPin.stuckSpeedThreshold,
        `${path}.antiPin.stuckSpeedThreshold`,
        { min: 0 },
      ),
      lateralSpeedMult: needNumber(antiPin.lateralSpeedMult, `${path}.antiPin.lateralSpeedMult`, {
        min: 0,
      }),
    },
    juice: {
      hitSfxMinIntervalMs: needNumber(
        juice.hitSfxMinIntervalMs,
        `${path}.juice.hitSfxMinIntervalMs`,
        {
          min: 0,
        },
      ),
      damageEventBatchMs: needNumber(juice.damageEventBatchMs, `${path}.juice.damageEventBatchMs`, {
        min: 0,
      }),
      flashHz: needNumber(juice.flashHz, `${path}.juice.flashHz`, { min: 0 }),
      jitterHz: needNumber(juice.jitterHz, `${path}.juice.jitterHz`, { min: 0 }),
      squashHz: needNumber(juice.squashHz, `${path}.juice.squashHz`, { min: 0 }),
      hpPitchCents: needNumber(juice.hpPitchCents, `${path}.juice.hpPitchCents`, { min: 0 }),
    },
  }
}

// ---------------------------------------------------------------- 加载

/**
 * 三份配置表的文件名。**这是唯一来源** —— fetch 加载与 Phaser loader 都读它，
 * 免得两处各写一遍然后漂移。
 */
export const CONFIG_FILE_NAMES = ['balance.json', 'difficulty.json', 'enemies.json'] as const

export type ConfigFileName = (typeof CONFIG_FILE_NAMES)[number]

/**
 * 配置表相对页面根的相对路径。
 *
 * ⚠️ **不带前导斜杠**：`base` 是 `./`，部署时静态产物按版本号分目录
 * （见《技术选型》§7），带斜杠的绝对路径在 `/game/v1.2.3/` 这类子目录下会 404。
 *
 * ⚠️ 也**不要试图从 JS 里 import 这个路径**。`public/` 下的文件不参与打包，
 * Vite 遇到 `import`/`import.meta.glob` 指向 `public/` 会**静默**换成空模块
 * （只在终端打一行 warning），于是拿到的 JSON 是 `undefined`，场景初始化当场中断。
 * 要读它们，只有两条路：`fetch()`，或者 Phaser 的 loader（`loadConfigBundle` 走前者，
 * `ArenaBase` 走后者）。这条有架构测试守着。
 */
export function configUrl(name: ConfigFileName): string {
  return `config/${name}`
}

/**
 * 开屏一次性加载三份 JSON。
 *
 * ⚠️ `base` **必须传**（通常是 `import.meta.env.BASE_URL`）。
 * 别给它一个 `document.baseURI` 默认值 —— node 下求值即 `ReferenceError`，
 * 任何无参调用的单测会当场崩。
 *
 * 红线 1：**游戏核心循环永远不 `await` 网络。** 这个函数只在开屏调一次，
 * 暂停、切标签页、重开一局都不重新加载。
 *
 * 加载失败**直接抛**，绝不静默退回代码内默认值 —— 那会违反红线 2 的语义。
 */
export async function loadConfigBundle(base: string): Promise<ConfigBundle> {
  const fetchJson = async (name: ConfigFileName): Promise<unknown> => {
    const url = new URL(configUrl(name), base).href
    let res: Response
    try {
      res = await fetch(url)
    } catch (cause) {
      throw new ConfigError(configUrl(name), `网络请求失败（${url}）：${String(cause)}`)
    }
    if (!res.ok) {
      throw new ConfigError(configUrl(name), `HTTP ${res.status}（${url}）`)
    }
    try {
      return await res.json()
    } catch (cause) {
      throw new ConfigError(configUrl(name), `不是合法 JSON：${String(cause)}`)
    }
  }

  const [balance, difficulty, enemies] = await Promise.all([
    fetchJson('balance.json'),
    fetchJson('difficulty.json'),
    fetchJson('enemies.json'),
  ])

  return parseConfigBundle({ balance, difficulty, enemies })
}
