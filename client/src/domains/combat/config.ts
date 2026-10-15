import type { BalanceConfig } from '@/core/config'

export type WeaponId = 'pencil' | 'pulse' | 'venom' | 'flare' | 'rail' | 'smg'
export type Stat =
  | 'damage'
  | 'fireRate'
  | 'bulletSpeed'
  | 'spread'
  | 'move'
  | 'maxHp'
  | 'maxStamina'
  | 'heal'
  | 'iframeMs'
  | 'pellets'
export interface WeaponDef {
  id: WeaponId
  name: string
  description: string
  poisonDurationMs?: number
  poisonTickMs?: number
  poisonTickDamage?: number
  splashRadius?: number
  splashDamageRatio?: number
  pierceTargets?: number
  chainTargets?: number
  chainRadius?: number
  chainDamageRatio?: number
  slowMultiplier?: number
  slowDurationMs?: number
  bossDamageRatio?: number
  damageScale: number
  cooldownScale: number
  speedScale: number
  pellets: number
  spreadDeg: number
  lifeMs: number
  staminaCost: number
  color: number
  mode: 'projectile' | 'melee'
  artKey: string
  effect:
    | 'bullet'
    | 'energy'
    | 'slash'
    | 'arcane'
    | 'nature'
    | 'poison'
    | 'explosion'
    | 'pierce'
    | 'rapid'
  range: number
  arcDeg: number
  effectMs: number
}
export interface WeaponEffectsConfig {
  maxParticles: number
  maxBursts: number
  maxBeams: number
  maxStatuses: number
  trailIntervalMs: number
  particleLifeMs: number
  particleSpeed: number
  burstParticles: number
  trailParticles: number
  muzzleParticles: number
  glowAlpha: number
}
export interface CombatConfig {
  weaponEffects: WeaponEffectsConfig
  schemaVersion: number
  player: {
    acceleration: number
    deceleration: number
    hurtMs: number
    attackPoseMs: number
    spawnGraceMs: number
    visualScale: number
    gunIdleFrame: number
    maxStamina: number
    staminaRegenPerSec: number
    maxShield: number
    gunRunFirstFrame: number
    gunRunFrameCount: number
    gunRunFrameRate: number
  }
  drops: {
    chance: number
    healthChance: number
    healthAmount: number
    shieldAmount: number
    pickupRadius: number
    visualSize: number
    maxActive: number
  }
  gunMuzzles: {
    shoot: [number, number][]
    runGun: [number, number][]
    pulseShoot: [number, number][]
    pulseRun: [number, number][]
    [key: string]: [number, number][]
  }
  projectiles: { capacity: number; radius: number }
  feedback: {
    hurtFlashMs: number
    hurtFlashAlpha: number
    hurtShakeMs: number
    hurtShakeIntensity: number
    flashMs: number
    recoilPx: number
    floatMs: number
    aggregateMs: number
    maxFloaters: number
    maxParticles: number
    particleMs: number
  }
  limits: {
    fireRateScale: number
    bulletSpeedScale: number
    moveScale: number
    spreadScaleMin: number
    pellets: number
    iframeMs: number
  }
  weapons: WeaponDef[]
  terrain: {
    navigationCellSize: number
    playerSpawn: { x: number; y: number }
    water: { x: number; y: number; width: number; height: number }[]
  }
  chest: { interactRadius: number; pickupRadius: number; visualSize: number; openFxMs: number }
  encounter: {
    bossHp: number
    bossHpPerStage: number
    bossX: number
    bossY: number
    bossColor: number
    aggroRadius: number
    activityRadius: number
    homeTolerance: number
    spawnSpread: number
    camps: { x: number; y: number }[]
  }
  arena: {
    seed: number
    width: number
    height: number
    initialSplitters: number
    initialTanks: number
    stageGrowth: number
    phaseBaseMs: number
    phaseCountScale: number
    intermissionMs: number
    maxStages: number
    demoDamage: number
  }
}
export interface RewardDef {
  category?: 'survival' | 'firepower' | 'utility'
  icon?: 'heart' | 'icon_crosshair' | 'energy' | 'star_badge' | 'skill_orb_speed' | 'shield'
  headline?: string
  id: string
  name: string
  description: string
  weight: number
  /** 0 means repeatable every round; positive values stop offering at the stack limit. */
  maxStacks: number
  weapons: WeaponId[]
  requires: string[]
  excludes: string[]
  effects: { stat: Stat; amount: number }[]
}
export interface EffectiveStats {
  damage: number
  cooldownMs: number
  bulletSpeed: number
  spreadDeg: number
  pellets: number
  lifeMs: number
  moveSpeed: number
  maxHp: number
  maxStamina: number
  iframeMs: number
}
export const COMBAT_CONFIG_FILES = ['combat.json', 'rewards.json'] as const
export function combatConfigUrl(name: (typeof COMBAT_CONFIG_FILES)[number]): string {
  return `config/${name}`
}
const STATS: Stat[] = [
  'damage',
  'fireRate',
  'bulletSpeed',
  'spread',
  'move',
  'maxHp',
  'maxStamina',
  'heal',
  'iframeMs',
  'pellets',
]

export function parseCombatConfig(raw: unknown): CombatConfig {
  const c = raw as CombatConfig
  if (!c || c.schemaVersion !== 1 || !Array.isArray(c.weapons) || c.weapons.length < 2)
    throw new Error('combat: schemaVersion/武器配置无效')
  const numeric = (obj: object, path: string) => {
    if (!obj) throw new Error(`${path}: 缺少配置`)
    for (const [k, v] of Object.entries(obj))
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0)
        throw new Error(`${path}.${k}: 非法数值`)
  }
  numeric(c.player, 'player')
  numeric(c.drops, 'drops')
  const dropFields = [
    'chance',
    'healthChance',
    'healthAmount',
    'shieldAmount',
    'pickupRadius',
    'visualSize',
    'maxActive',
  ] as const
  if (
    dropFields.some((key) => !Number.isFinite(c.drops[key])) ||
    c.drops.chance > 1 ||
    c.drops.healthChance > 1 ||
    c.drops.healthAmount <= 0 ||
    c.drops.shieldAmount <= 0 ||
    c.drops.pickupRadius <= 0 ||
    c.drops.visualSize <= 0 ||
    !Number.isInteger(c.drops.maxActive) ||
    c.drops.maxActive < 1
  )
    throw new Error('drops: 掉落概率/数量/恢复量/拾取范围无效')
  if (
    !Number.isInteger(c.player.gunRunFirstFrame) ||
    c.player.gunRunFirstFrame < 0 ||
    c.player.gunRunFirstFrame >= (c.gunMuzzles?.runGun?.length ?? 0)
  )
    throw new Error('player.gunRunFirstFrame: 必须位于无开火帧的跑动图集中')
  if (
    !Number.isInteger(c.player.gunRunFrameCount) ||
    c.player.gunRunFrameCount <= 0 ||
    c.player.gunRunFirstFrame + c.player.gunRunFrameCount > (c.gunMuzzles?.runGun?.length ?? 0) ||
    !Number.isFinite(c.player.gunRunFrameRate) ||
    c.player.gunRunFrameRate <= 0
  )
    throw new Error('player: 跑动循环长度/帧率无效')
  for (const key of ['maxStamina', 'staminaRegenPerSec', 'maxShield'] as const) {
    if (!Number.isFinite(c.player[key]) || c.player[key] < 0)
      throw new Error('player.' + key + ': 缺少或非法的资源配置')
  }
  if (c.player.maxStamina <= 0) throw new Error('player.maxStamina: 必须为正数')
  for (const key of ['shoot', 'runGun', 'pulseShoot', 'pulseRun'] as const) {
    const points = c.gunMuzzles?.[key]
    if (
      !Array.isArray(points) ||
      points.length !== (key === 'shoot' || key === 'pulseShoot' ? 16 : 14) ||
      points.some(
        (p) => !Array.isArray(p) || p.length !== 2 || p.some((n) => !Number.isFinite(n) || n < 0),
      )
    )
      throw new Error('gunMuzzles: 射击需要 16 帧、纯跑动需要 14 帧有效枪口坐标')
  }
  if (
    !Number.isInteger(c.player.gunIdleFrame) ||
    c.player.gunIdleFrame < 0 ||
    c.player.gunIdleFrame >= c.gunMuzzles.shoot.length ||
    c.player.visualScale <= 0
  )
    throw new Error('player: 持枪静止帧/缩放无效')
  numeric(c.projectiles, 'projectiles')
  numeric(c.feedback, 'feedback')
  if (!c.weaponEffects) throw new Error('weaponEffects: 缺少特效配置')
  for (const key of [
    'maxParticles',
    'maxBursts',
    'maxBeams',
    'maxStatuses',
    'trailIntervalMs',
    'particleLifeMs',
    'particleSpeed',
    'burstParticles',
    'trailParticles',
    'muzzleParticles',
  ] as const) {
    if (!Number.isFinite(c.weaponEffects[key]) || c.weaponEffects[key] <= 0)
      throw new Error('weaponEffects: 数值必须为正数')
  }
  for (const key of [
    'maxParticles',
    'maxBursts',
    'maxBeams',
    'maxStatuses',
    'burstParticles',
    'trailParticles',
    'muzzleParticles',
  ] as const)
    if (!Number.isInteger(c.weaponEffects[key])) throw new Error('weaponEffects: 容量必须为整数')
  if (!(c.weaponEffects.glowAlpha > 0 && c.weaponEffects.glowAlpha <= 1))
    throw new Error('weaponEffects: 光晕透明度无效')
  numeric(c.limits, 'limits')
  numeric(c.arena, 'arena')
  if (!Number.isInteger(c.arena.maxStages) || c.arena.maxStages < 1)
    throw new Error('arena.maxStages: 关卡上限无效')
  numeric(c.chest, 'chest')
  if (
    !['interactRadius', 'pickupRadius', 'visualSize', 'openFxMs'].every((key) =>
      Number.isFinite(c.chest[key as keyof typeof c.chest]),
    )
  )
    throw new Error('chest: 缺少配置')
  if (
    !c.chest ||
    c.chest.interactRadius <= 0 ||
    c.chest.pickupRadius <= 0 ||
    c.chest.visualSize <= 0
  )
    throw new Error('chest: 无效配置')
  if (!Number.isFinite(c.arena.intermissionMs) || c.arena.intermissionMs <= 0)
    throw new Error('arena.intermissionMs: 必须为正数')
  if (
    !c.encounter ||
    !Array.isArray(c.encounter.camps) ||
    c.encounter.activityRadius <= 0 ||
    c.encounter.aggroRadius <= 0 ||
    c.encounter.homeTolerance < 0
  )
    throw new Error('encounter: 范围配置无效')
  if (
    !Number.isFinite(c.encounter.bossHp) ||
    c.encounter.bossHp <= 0 ||
    !Number.isFinite(c.encounter.bossHpPerStage) ||
    c.encounter.bossHpPerStage < 0
  )
    throw new Error('encounter: Boss生命配置无效')
  for (const camp of c.encounter.camps) numeric(camp, 'encounter.camp')
  if (
    !c.terrain ||
    !Array.isArray(c.terrain.water) ||
    !Number.isFinite(c.terrain.navigationCellSize) ||
    c.terrain.navigationCellSize <= 0
  )
    throw new Error('terrain: 缺少地图/导航配置')
  numeric(c.terrain.playerSpawn, 'terrain.playerSpawn')
  if (
    c.arena.width <= 0 ||
    c.arena.height <= 0 ||
    !Number.isFinite(c.terrain.playerSpawn.x) ||
    !Number.isFinite(c.terrain.playerSpawn.y) ||
    c.terrain.playerSpawn.x >= c.arena.width ||
    c.terrain.playerSpawn.y >= c.arena.height
  )
    throw new Error('terrain: 出生点必须位于草地地图内')
  for (const rect of c.terrain.water) {
    numeric(rect, 'terrain.water')
    if (
      ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.x + rect.width > c.arena.width ||
      rect.y + rect.height > c.arena.height
    )
      throw new Error('terrain.water: 水池超出地图或尺寸无效')
    const spawn = c.terrain.playerSpawn
    if (
      spawn.x >= rect.x &&
      spawn.x < rect.x + rect.width &&
      spawn.y >= rect.y &&
      spawn.y < rect.y + rect.height
    )
      throw new Error('terrain.playerSpawn: 不允许出生在水中')
  }
  const ids = new Set<string>()
  for (const w of c.weapons) {
    if (
      !['pencil', 'pulse', 'venom', 'flare', 'rail', 'smg'].includes(w.id) ||
      ids.has(w.id) ||
      !w.name
    )
      throw new Error('combat.weapons: ID重复/无效')
    if (
      w.id === 'pulse' &&
      (!Number.isFinite(w.bossDamageRatio) || w.bossDamageRatio! <= 0 || w.bossDamageRatio! > 1)
    )
      throw new Error('weapon: 重炮伤害比例无效')
    if (w.id !== 'pencil') {
      if (
        !Number.isInteger(w.pierceTargets) ||
        w.pierceTargets! < 1 ||
        !Number.isFinite(w.effectMs) ||
        w.effectMs <= 0
      )
        throw new Error('weapon: 穿透数量或特效时长无效')
      const fields: Partial<Record<WeaponId, (keyof WeaponDef)[]>> = {
        venom: ['poisonDurationMs', 'poisonTickMs', 'poisonTickDamage'],
        flare: ['splashRadius', 'splashDamageRatio'],
        pulse: ['chainTargets', 'chainRadius', 'chainDamageRatio'],
        smg: ['slowDurationMs', 'slowMultiplier'],
      }
      for (const key of fields[w.id] ?? [])
        if (typeof w[key] !== 'number' || !Number.isFinite(w[key]) || (w[key] as number) <= 0)
          throw new Error('weapon: 特殊攻击数值无效')
      if (w.id === 'venom' && w.poisonDurationMs! < w.poisonTickMs!)
        throw new Error('weapon: 毒伤时长不能短于间隔')
      if (w.id === 'pulse' && !Number.isInteger(w.chainTargets))
        throw new Error('weapon: 连锁数量无效')
      if (w.id === 'smg' && w.slowMultiplier! > 1) throw new Error('weapon: 减速倍率无效')
    }
    ids.add(w.id)
    if (!['projectile', 'melee'].includes(w.mode) || !w.artKey)
      throw new Error('weapon: 模式/素材无效')
    for (const key of [
      'damageScale',
      'cooldownScale',
      'speedScale',
      'pellets',
      'lifeMs',
      'staminaCost',
    ] as const)
      if (!(w[key] > 0) || !Number.isFinite(w[key])) throw new Error(`weapon.${key}: 必须为正数`)
    if (!Number.isInteger(w.pellets) || w.spreadDeg < 0 || !Number.isFinite(w.spreadDeg))
      throw new Error('weapon: 弹丸/散布无效')
  }
  if (
    c.projectiles.capacity < c.limits.pellets ||
    !Number.isInteger(c.projectiles.capacity) ||
    c.feedback.aggregateMs <= 0 ||
    c.player.acceleration <= 0 ||
    c.player.deceleration <= 0
  )
    throw new Error('combat: 池容量/时间/加速度无效')
  return c
}
export function parseRewards(raw: unknown): RewardDef[] {
  const r = raw as { schemaVersion: number; rewards: RewardDef[] }
  if (!r || r.schemaVersion !== 1 || !Array.isArray(r.rewards)) throw new Error('rewards: 格式无效')
  const ids = new Set<string>()
  for (const d of r.rewards) {
    if (
      !d.id ||
      ids.has(d.id) ||
      !d.name ||
      !d.description ||
      !(d.weight > 0) ||
      !Number.isFinite(d.weight) ||
      !Number.isInteger(d.maxStacks) ||
      d.maxStacks < 0
    )
      throw new Error('rewards: ID/权重/上限无效')
    if (![d.weapons, d.requires, d.excludes, d.effects].every(Array.isArray) || !d.effects.length)
      throw new Error('rewards: 条件/效果缺失')
    if (
      d.weapons.some((w) => !['pencil', 'pulse'].includes(w)) ||
      d.effects.some((e) => !STATS.includes(e.stat) || !Number.isFinite(e.amount))
    )
      throw new Error('rewards: 武器/属性无效')
    ids.add(d.id)
  }
  for (const d of r.rewards)
    if ([...d.requires, ...d.excludes].some((id) => !ids.has(id) || id === d.id))
      throw new Error('rewards: 不存在/自引用条件')
  return r.rewards
}
/** Repeatable health/damage/energy keep endless rounds rewarding. Rate, speed and pellets stay bounded. */
export function deriveStats(
  balance: BalanceConfig,
  config: CombatConfig,
  weapon: WeaponDef,
  defs: readonly RewardDef[],
  stacks: ReadonlyMap<string, number>,
): EffectiveStats {
  const sum = Object.fromEntries(STATS.map((k) => [k, 0])) as Record<Stat, number>
  for (const r of defs) {
    if (r.weapons.length && !r.weapons.includes(weapon.id)) continue
    for (const e of r.effects) sum[e.stat] += e.amount * (stacks.get(r.id) ?? 0)
  }
  const b = balance.baseline,
    l = config.limits
  return {
    damage:
      (weapon.bossDamageRatio
        ? config.encounter.bossHp * weapon.bossDamageRatio
        : b.bullet.damage * weapon.damageScale) *
      (1 + sum.damage),
    cooldownMs:
      (b.bullet.fireIntervalMs * weapon.cooldownScale) /
      Math.min(l.fireRateScale, 1 + sum.fireRate),
    bulletSpeed:
      b.bullet.speed * weapon.speedScale * Math.min(l.bulletSpeedScale, 1 + sum.bulletSpeed),
    spreadDeg: weapon.spreadDeg * Math.max(l.spreadScaleMin, 1 + sum.spread),
    pellets: weapon.id === 'pulse' ? 1 : Math.min(l.pellets, weapon.pellets + sum.pellets),
    lifeMs: weapon.lifeMs,
    moveSpeed: b.player.speed * Math.min(l.moveScale, 1 + sum.move),
    maxHp: Math.round(b.player.maxHp * (1 + sum.maxHp)),
    maxStamina: Math.round(config.player.maxStamina * (1 + sum.maxStamina)),
    iframeMs: Math.min(l.iframeMs, b.player.iframeMs + sum.iframeMs),
  }
}
