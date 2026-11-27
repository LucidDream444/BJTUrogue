import { TALENT_KINDS, type TalentDef, type TalentKind, type TalentRules } from './TalentRun'
import type { BalanceConfig } from '@/core/config'
import { validateAimArt, type AimArtConfig } from './AimPose'
import type { BossReinforcementsConfig } from './BossReinforcements'

export const WEAPON_IDS = [
  'pencil',
  'pulse',
  'venom',
  'flare',
  'rail',
  'smg',
  // 近战 10
  'pencil_knife',
  'ruler_sword',
  'pointer_rapier',
  'compass',
  'eraser_maul',
  'broom',
  'scissors',
  'glowstick',
  'mop',
  'bug_swatter',
  // 远程 20
  'eraser_shotgun',
  'set_square_sniper',
  'auto_pencil_smg',
  'chem_sprayer',
  'cryo_sprayer',
  'laser_pointer',
  'basketball_boomerang',
  'paper_plane',
  'tennis_ball',
  'model_rocket',
  'grenade_launcher',
  'arc_emitter',
  'split_dart',
  'lifesteal_syringe',
  'nail_gun',
  'bubble_gun',
  'double_barrel',
  'magnetic_frisbee',
  'sonic_horn',
  'firework_launcher',
] as const
/** 六把旧武器：保留原专属字段与执行分支，不参与新 trait 校验。 */
export const LEGACY_WEAPON_IDS = ['pencil', 'pulse', 'venom', 'flare', 'rail', 'smg'] as const
/** 学生/大鹅/小红果的公共替身外观只有这六套。 */
export const PUBLIC_WEAPON_IDS = LEGACY_WEAPON_IDS
export type PublicWeaponId = (typeof PUBLIC_WEAPON_IDS)[number]
/** 把任意武器 id 收敛到六套公共外观之一；新武器靠 `visualId` 指定替身。 */
export function publicWeaponVisual(id: string | undefined): PublicWeaponId {
  return id !== undefined && (PUBLIC_WEAPON_IDS as readonly string[]).includes(id)
    ? (id as PublicWeaponId)
    : 'pencil'
}
export type WeaponId = (typeof WEAPON_IDS)[number]
export type WeaponMode = 'projectile' | 'melee' | 'beam'
export type WeaponEffect =
  | 'bullet'
  | 'energy'
  | 'slash'
  | 'arcane'
  | 'nature'
  | 'poison'
  | 'explosion'
  | 'pierce'
  | 'rapid'
export interface WeaponStatusDef {
  kind: 'poison' | 'slow'
  durationMs: number
  tickMs?: number
  tickDamage?: number
  slowMultiplier?: number
}
export type WeaponTrait =
  | { kind: 'pierce'; targets: number }
  | { kind: 'splash'; radius: number; damageRatio: number }
  | { kind: 'chain'; targets: number; radius: number; damageRatio: number }
  | { kind: 'bounce'; maxBounces: number; speedRetain?: number }
  | { kind: 'homing'; turnRateRadPerSec: number; range?: number }
  | { kind: 'boomerang'; outMs: number; returnSpeedScale?: number }
  | {
      kind: 'split'
      count: number
      damageRatio: number
      spreadDeg?: number
      maxDepth?: number
      on?: 'hit' | 'wall' | 'both'
      chance?: number
      radial?: boolean
    }
  | {
      kind: 'fuse'
      fuseMs: number
      splashRadius: number
      splashDamageRatio: number
      explodeOnImpact?: boolean
    }
  | { kind: 'lifesteal'; ratio: number; maxPerHit?: number }
  | { kind: 'knockback'; strength: number }
  | { kind: 'burst'; count: number; intervalMs: number }
  | { kind: 'destroyShot' }
  | { kind: 'multiHit'; count: number; intervalMs: number; damageRatio?: number }
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
  talentModified?: boolean
  talentSecondary?: boolean
  talentSplit?: boolean
  talentNoProcs?: boolean
  id: WeaponId
  name: string
  description: string
  /** 决定玩家侧执行路径；近战/光束不生成弹丸。 */
  mode: WeaponMode
  /**
   * 学生持握时借用的既有武器外观（六把公共枪之一）。
   * 新武器没有自绘整帧图时用它选 `player_<id>_aim_*` 与 `gunMuzzles`。
   */
  visualId?: WeaponId
  /** 数据驱动的弹道/近战特性；旧六把继续用下面的专属字段。 */
  traits?: WeaponTrait[]
  /** 命中附加的持续效果。 */
  status?: WeaponStatusDef
  /** 近战挥砍判定持续时长（ms）。 */
  swingMs?: number
  /** 逐武器弹丸碰撞半径；缺省用 `projectiles.radius`。 */
  projectileRadius?: number
  /** 弹丸贴图 key；缺省按 `PROJECTILE_ART` 或默认子弹。 */
  projectileArt?: string
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
  damageScale: number
  cooldownScale: number
  speedScale: number
  pellets: number
  spreadDeg: number
  lifeMs: number
  staminaCost: number
  color: number
  artKey: string
  effect: WeaponEffect
  /** 近战挥砍距离 / 光束长度；弹丸武器保留旧字段（当前未消费）。 */
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
export const TALENT_FX_GLYPHS = [
  'dot',
  'twin',
  'arrow',
  'ring',
  'star',
  'bolt',
  'crescent',
  'burst',
  'hex',
  'droplet',
  'snow',
  'clock',
  'heart',
  'battery',
  'book',
  'void',
  'link',
  'chevron',
  'bell',
  'loop',
  'fan',
  'flame',
  'shard',
] as const
export type TalentFxGlyph = (typeof TALENT_FX_GLYPHS)[number]

export interface TalentFxEntry {
  glyph: TalentFxGlyph
  /** 0xRRGGBB; kept away from enemy red. */
  color: number
}

export interface TalentFxConfig {
  orbitRadius: number
  orbitSize: number
  idleAlpha: number
  activeAlpha: number
  spinRadPerSec: number
  burstMs: number
  ringColor: number
  entries: Record<TalentKind, TalentFxEntry>
}

export interface CombatConfig {
  talents?: TalentRules
  talentFx?: TalentFxConfig
  aimArt: AimArtConfig
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
    /** Passive shield recovery per second; 0 disables it. */
    shieldRegenPerSec: number
    /** Quiet time after the last damage before passive shield recovery resumes. */
    shieldRegenDelayMs: number
    gunRunFirstFrame: number
    gunRunFrameCount: number
    gunRunFrameRate: number
    /**
     * 鼠标横向偏离身体超过这个像素数，朝向就跟着转过去。
     *
     * 朝向决定手臂能转到哪半边（见 `gunPose.ts` 的夹取），所以它不能只跟移动方向走 ——
     * 否则「跑向右、鼠标指向左」时手臂会横穿身体。留死区是为了鼠标正好在正上/正下时
     * 不会来回翻面。
     */
    facingDeadzonePx: number
  }
  drops: {
    chance: number
    staminaChance: number
    staminaAmount: number
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
  /**
   * 手臂旋转的枢轴（肩部），帧坐标，与 `gunMuzzles` 同一套键。
   *
   * 手臂+枪的图层绕这个点转。它由分层脚本的切分位置决定
   * （`src/test/arenas/D1/tools/split_arm_layers.py` 的 `cut` 与行带中线），
   * **改切分就要同步改这里**，否则手臂会绕着错误的点转。
   */
  gunPivots: {
    shoot: [number, number]
    runGun: [number, number]
    pulseShoot: [number, number]
    pulseRun: [number, number]
    [key: string]: [number, number]
  }
  /**
   * 音频。⚠️ `bgmVolume` / `shotVolume` 是**基准音量，不是产品里实际播的那个音量**。
   *
   * 实际音量 = 玩家在设置里拖的那个值（档里 `settings.bgmVolume` / `sfxVolume`），
   * **直接就是** `sound.setVolume()` 的入参，100% = 1.0（2026-10-16 改的，
   * 原来这里是乘数，于是滑杆拉满也只有 0.32 那么响）。
   *
   * 这两个数只在**没有档的宿主**里兜底 —— 个别测试场直接 `new CombatSession`，
   * 没人调 `setAudioVolumes()`，那就用配置里的基准。
   */
  audio: {
    bgmVolume: number
    shotVolume: number
    shotVoices: number
    /** 两次受击短呼之间的最小间隔；语音缺失时不影响触发。 */
    voiceHurtCooldownMs: number
    /**
     * 普通 BGM 的播放速率。1 = 原速；小于 1 = 更慢、更沉。
     * 演奏家大鹅的 60 BPM 演奏曲**不套用**（那是玩法节拍，不是氛围）。
     */
    bgmRate: number
  }
  /**
   * 普通 BGM 的轻失真 + 慢速低通摆动。
   *
   * 在 `volumeNode` 后面插一条「软削波 → 低通」链，再让一个很慢的 LFO 推动
   * 低通截止频率。听感是**发闷、轻微破音、像在呼吸**，不改变节拍和音高；
   * 演奏曲不套用（60 BPM 是玩法）。HTML5 回退时只保留 `bgmRate` 降速。
   */
  bgmWarp: {
    enabled: boolean
    /** 低通基准截止频率（Hz）。 */
    lowpassHz: number
    /** 截止频率摆动的频率（Hz）；0.05 左右约 20 秒一个周期。 */
    sweepHz: number
    /** 截止频率摆动幅度（Hz），必须小于 lowpassHz。 */
    sweepDepthHz: number
    /** Q 值；>1 会有一点共振峰。 */
    resonance: number
    /** 软削波驱动量；1 = 接近直通，越大越破。 */
    drive: number
  }
  /**
   * 暗区光照。玩家周围有光，墙/家具挡光；光外压暗并隐藏角色实体。
   * 数值全部按世界像素 / 屏幕透明度配置，不写死在表现层。
   */
  lighting: {
    enabled: boolean
    playerRadius: number
    bulletRadius: number
    darknessAlpha: number
    /** 玩家光圈的射线数；越大边缘越圆滑，开销线性增加。 */
    rays: number
    bulletRays: number
    maxBulletLights: number
    /** 光圈外缘的柔化带占半径的比例；0 = 硬边。 */
    softness: number
    /**
     * 桌椅外沿的额外光照余量（px）：光扇会覆盖整块家具贴图，然后才被挡住。
     * 墙不享受这个余量，仍然停在近面。
     */
    furnitureMarginPx: number
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
    bossDamageMultiplier: number
    bossVisualScaleMultiplier: number
    bossHitRadiusMultiplier: number
    /** Contact damage per 100ms tick for any boss/clone/elite. */
    bossContactDamagePerTick: number
    /** Elite-room boss display scale relative to its regular boss scale. */
    eliteBossVisualScale: number
    /** Elite-room boss max HP multiplier. */
    eliteBossHpScale: number
    /** Elite-room boss collision/hit radius in world pixels. */
    eliteBossRadius: number
    /** Normal minions spawned alongside the elite-room boss. */
    eliteEscortCount: number
    bossReinforcements: BossReinforcementsConfig
    bossX: number
    bossY: number
    bossColor: number
    aggroRadius: number
    activityRadius: number
    homeTolerance: number
    spawnSpread: number
    camps: { x: number; y: number }[]
  }
  /**
   * 战斗相机的取景。
   *
   * ★ 新增（2026-10-21，整层连续）。**上一版不需要这几个数**：那时竞技场
   * （`arena.width` × `arena.height`）就是屏幕，`fitCamera()` 把整张图塞进去、
   * 相机不动，一个数都不用配。
   *
   * 整层连续之后整层有 **10520×2920**（`floor-plan.json` 实测），塞不进屏幕，
   * 相机必须跟着玩家走 —— 于是"看得见多大一片"从一个**推到的事实**变成了
   * **一个要定的数**。红线 2 说配置数值不许写在代码里，所以它在这儿。
   *
   * ⚠️ 这两个数**不是屏幕分辨率**，是「相机的窗口在世界里有多大」。
   * `zoom = min(画布宽 / viewWidth, 画布高 / viewHeight)` —— 画布越大 zoom 越大，
   * 于是**看得见的世界范围与分辨率无关**。想「在大屏上看得更远」，
   * 改这两个数；想让大屏上东西更大，那是**另一个决定**，别顺手改 `zoom` 的算法。
   */
  camera: {
    /** 相机窗口的世界宽度（px）。1344 = 旧竞技场的宽度，见上面那段 */
    viewWidth: number
    /** 相机窗口的世界高度（px）。832 = 旧竞技场的高度 */
    viewHeight: number
    /**
     * 跟随的平滑系数（0—1）。`1` = 硬跟（相机钉在玩家身上，画面会随每一步抖），
     * 越小越"拖"。**别调到 1**：玩家每帧的位移都变成画面的位移，
     * 而射击时的后坐、受击抖动也一起传过去 —— 看着像掉帧。
     */
    followLerp: number
  }
  arena: {
    seed: number
    /**
     * 竞技场的宽高（世界像素）—— **出生点、物理世界边界、寻路网格、相机的取景框
     * 全都读它**。
     *
     * ⚠️ **整层连续之后这两个数是「生成结果」，不是「配置」**：`BattleScene` 在每层
     * 生成完之后用 `DungeonStages.arenaOf()` 把整层的包围盒写回来（`applyArena()`），
     * 覆盖 `combat.json` 里写的值。配置里写的这一对只是**生成之前**的占位读数。
     *
     * 为什么非写回不可：`DungeonStages` 交出的几何是**地图坐标、1:1**
     * （`sourceSize` = 整层尺寸），而 `stageGeometry()` 的取景框是
     * `fitMapFrame(arena.width, arena.height, sourceSize…)` —— 两个数不相等时
     * 整层会被缩到七分之一并居中，且**什么都不报**（见 `DungeonStages` 文件头）。
     */
    width: number
    height: number
    initialSplitters: number
    initialSprayers: number
    initialTanks: number
    /**
     * **每间房期望刷几只抓取怪**（可以是小数 = 概率）。
     *
     * 与另外两个轴不同，它**允许为 0，而且今天真的会是 0** —— 最靠近楼梯间的那几间
     * （强度倍数 1）算出来就是 0：先让玩家在近处认识「!」和抓取，再让它来抓人。
     * 整条曲线见 `roomPlan()`。
     */
    initialGrabbers: number
    initialMuscovies: number
    initialNightmareCats: number
    muscovyMinFloor: number
    nightmareCatMinFloor: number
    /**
     * 第 3 层之后的心魔最终战配置。
     *
     * `heartDemonHp` 是心魔的固定血量；第 1—3 层池内首领仍走
     * `bossHp + (layer − 1) × bossHpPerStage`。
     */
    finale: { floor: number; finalRewardId: string; heartDemonHp: number }
    /**
     * ⚠️ **这个字段今天没有消费方**（2026-10-21 整层连续之后）。
     *
     * 它原来是**层与层之间的**强度斜率（`1 + (层号 - 1) × 0.3`），而整层连续之后
     * 「这一间多难」由 D2 的威胁预算（到楼梯间的跳数）说，层号不再参与刷怪数量。
     * 留着是因为它在 `combat.json` 里、删一个配置字段要走配置契约那一套；
     * **但别照着它改难度** —— 改它不会有任何效果，而它看着像是会有的
     * （那正是最难查的一种「配置改了没用」）。要调难度改 `rooms.json` 的
     * `budgetBase` / `budgetGrowth`。
     */
    stageGrowth: number
    phaseBaseMs: number
    phaseCountScale: number
    intermissionMs: number
    /**
     * **一局几层** —— 第 1..N 层各有一个首领，按层的序号选（1 蘑菇首领 / 2 霜翼使徒 / 3 终焉蛛王）。
     * 名字沿用旧版「一关一个首领」时期的叫法，语义在这一版是「层」。
     */
    maxStages: number
    /** 一层几间房（第 `roomsPerFloor` 间是首领房，D2 的生成器把 `kind: 'boss'` 只放那儿）。 */
    roomsPerFloor: number
    /** 其中几间是侧室（支线）。主干数 = `roomsPerFloor − sideRoomsPerFloor`，至少要有首末两间。 */
    sideRoomsPerFloor: number
    demoDamage: number
  }
}
export interface RewardDef {
  talent?: TalentDef
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

/** D4 永久成长在进入一局时折算出的战斗初始值。之后本局不再回读局外档。 */
export interface PermanentRunStats {
  maxHp: number
  maxStamina: number
  maxShield: number
  /** 百分比，5 表示 +5%；与局内 fireRate 相加后统一受 limits.fireRateScale 限制。 */
  attackSpeedPct: number
  moveSpeedPct: number
  energyRegenPct: number
}

export type CharacterSkillKind = 'haste' | 'dash' | 'summon' | 'performance'

/** D4 把当前角色技能等级折算成这一份纯配置，D1 不认识 profile/meta 结构。 */
export interface CharacterSkillConfig {
  id: string
  name: string
  kind: CharacterSkillKind
  level: number
  cooldownMs: number
  durationMs: number
  attackSpeedPct: number
  distance: number
  dashMs: number
  dashDamage: number
  iframeMs: number
  attackSpeedPerEnemyPct: number
  maxMechanicEnemies: number
  pageDamage: number
  fireIntervalMs: number
  range: number
  maxCharges: number
  beatPeriodMs: number
  beatHitWindowMs: number
  songCooldownMs: number
  maxStacks: number
  stackDurationMs: number
  redDamage: number
  redDamagePerStackPct: number
  redRadius: number
  damageBonusPctPerStack: number
  moveSpeedPctPerStack: number
  shieldPerStack: number
  blueShieldRestore: number
  manaCost: number
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

function validateWeaponStatus(s: WeaponStatusDef): void {
  if (!['poison', 'slow'].includes(s.kind) || !(s.durationMs > 0) || !Number.isFinite(s.durationMs))
    throw new Error('weapon.status: 时长无效')
  if (s.kind === 'poison') {
    if (
      !(s.tickMs! > 0) ||
      !(s.tickDamage! > 0) ||
      !Number.isFinite(s.tickMs) ||
      !Number.isFinite(s.tickDamage)
    )
      throw new Error('weapon.status: 毒伤参数无效')
    if (s.durationMs < s.tickMs!) throw new Error('weapon.status: 毒伤时长不能短于间隔')
  } else if (
    !(s.slowMultiplier! > 0 && s.slowMultiplier! <= 1) ||
    !Number.isFinite(s.slowMultiplier)
  ) {
    throw new Error('weapon.status: 减速倍率无效')
  }
}

function validateWeaponTraits(traits: WeaponTrait[]): void {
  if (!Array.isArray(traits)) throw new Error('weapon.traits: 必须是数组')
  const pos = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0
  for (const t of traits) {
    if (!t || typeof t !== 'object') throw new Error('weapon.traits: 条目无效')
    switch (t.kind) {
      case 'pierce':
        if (!Number.isInteger(t.targets) || t.targets < 1)
          throw new Error('weapon.trait.pierce: 无效')
        break
      case 'splash':
        if (!pos(t.radius) || !pos(t.damageRatio)) throw new Error('weapon.trait.splash: 无效')
        break
      case 'chain':
        if (!Number.isInteger(t.targets) || t.targets < 1 || !pos(t.radius) || !pos(t.damageRatio))
          throw new Error('weapon.trait.chain: 无效')
        break
      case 'bounce':
        if (!Number.isInteger(t.maxBounces) || t.maxBounces < 1)
          throw new Error('weapon.trait.bounce: 无效')
        if (t.speedRetain !== undefined && !(t.speedRetain > 0 && t.speedRetain <= 1))
          throw new Error('weapon.trait.bounce: 衰减无效')
        break
      case 'homing':
        if (!pos(t.turnRateRadPerSec)) throw new Error('weapon.trait.homing: 无效')
        if (t.range !== undefined && !pos(t.range)) throw new Error('weapon.trait.homing: 范围无效')
        break
      case 'boomerang':
        if (!pos(t.outMs)) throw new Error('weapon.trait.boomerang: 无效')
        if (t.returnSpeedScale !== undefined && !pos(t.returnSpeedScale))
          throw new Error('weapon.trait.boomerang: 速度无效')
        break
      case 'split':
        if (!Number.isInteger(t.count) || t.count < 1 || !(t.damageRatio > 0 && t.damageRatio <= 1))
          throw new Error('weapon.trait.split: 无效')
        if (t.spreadDeg !== undefined && (!Number.isFinite(t.spreadDeg) || t.spreadDeg < 0))
          throw new Error('weapon.trait.split: 散布无效')
        if (t.maxDepth !== undefined && (!Number.isInteger(t.maxDepth) || t.maxDepth < 0))
          throw new Error('weapon.trait.split: 深度无效')
        if (t.chance !== undefined && (!Number.isFinite(t.chance) || t.chance < 0 || t.chance > 1)) throw new Error('weapon.trait.split: 概率无效')
        if (t.on !== undefined && !['hit', 'wall', 'both'].includes(t.on))
          throw new Error('weapon.trait.split: 触发无效')
        break
      case 'fuse':
        if (!pos(t.fuseMs) || !pos(t.splashRadius) || !(t.splashDamageRatio > 0))
          throw new Error('weapon.trait.fuse: 无效')
        break
      case 'lifesteal':
        if (!(t.ratio > 0 && t.ratio <= 1)) throw new Error('weapon.trait.lifesteal: 无效')
        if (t.maxPerHit !== undefined && !pos(t.maxPerHit))
          throw new Error('weapon.trait.lifesteal: 上限无效')
        break
      case 'knockback':
        if (!pos(t.strength)) throw new Error('weapon.trait.knockback: 无效')
        break
      case 'burst':
        if (!Number.isInteger(t.count) || t.count < 1 || !pos(t.intervalMs))
          throw new Error('weapon.trait.burst: 无效')
        break
      case 'destroyShot':
        break
      case 'multiHit':
        if (!Number.isInteger(t.count) || t.count < 1 || !Number.isFinite(t.intervalMs) || t.intervalMs < 0)
          throw new Error('weapon.trait.multiHit: 无效')
        if (t.damageRatio !== undefined && !(t.damageRatio > 0))
          throw new Error('weapon.trait.multiHit: 伤害无效')
        break
      default:
        throw new Error('weapon.traits: 未知类型')
    }
  }
}

export function validateTalentFx(raw: unknown): TalentFxConfig {
  if (!raw || typeof raw !== 'object') throw new Error('talentFx: 缺少配置')
  const r = raw as Record<string, unknown>
  const number = (key: string, min = 0): number => {
    const value = r[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min)
      throw new Error(`talentFx.${key}: 非法数值`)
    return value
  }
  const orbitRadius = number('orbitRadius', 1)
  const orbitSize = number('orbitSize', 1)
  const idleAlpha = number('idleAlpha', 0)
  const activeAlpha = number('activeAlpha', 0)
  const spinRadPerSec = number('spinRadPerSec', 0)
  const burstMs = number('burstMs', 1)
  const ringColor = number('ringColor', 0)
  if (idleAlpha > 1 || activeAlpha > 1 || idleAlpha > activeAlpha)
    throw new Error('talentFx: 透明度必须在 [0,1] 且 idleAlpha ≤ activeAlpha')
  if (!Number.isInteger(ringColor) || ringColor > 0xffffff)
    throw new Error('talentFx.ringColor: 必须是 0xRRGGBB')
  if (!r.entries || typeof r.entries !== 'object') throw new Error('talentFx.entries: 缺少配置')
  const entries = r.entries as Record<string, unknown>
  const expected = new Set<string>(TALENT_KINDS)
  const actual = Object.keys(entries)
  if (actual.length !== expected.size || actual.some((kind) => !expected.has(kind)))
    throw new Error('talentFx.entries: 必须且只能覆盖全部 TALENT_KINDS')
  const parsed = {} as Record<TalentKind, TalentFxEntry>
  for (const kind of TALENT_KINDS) {
    const entry = entries[kind]
    if (!entry || typeof entry !== 'object') throw new Error(`talentFx.entries.${kind}: 缺少配置`)
    const e = entry as Record<string, unknown>
    if (typeof e.glyph !== 'string' || !TALENT_FX_GLYPHS.includes(e.glyph as TalentFxGlyph))
      throw new Error(`talentFx.entries.${kind}.glyph: 未知字形`)
    if (
      typeof e.color !== 'number' ||
      !Number.isInteger(e.color) ||
      e.color < 0 ||
      e.color > 0xffffff
    )
      throw new Error(`talentFx.entries.${kind}.color: 必须是 0xRRGGBB`)
    parsed[kind] = { glyph: e.glyph as TalentFxGlyph, color: e.color }
  }
  return { orbitRadius, orbitSize, idleAlpha, activeAlpha, spinRadPerSec, burstMs, ringColor, entries: parsed }
}

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
  numeric(c.camera, 'camera')
  if (
    !(c.camera.viewWidth > 0) ||
    !(c.camera.viewHeight > 0) ||
    !(c.camera.followLerp > 0) ||
    c.camera.followLerp > 1
  )
    // `>` 而不是 `>=`：`zoom` 是**除以**这两个数，给 0 会算出 `Infinity`
    // 而 Phaser 会照单全收 —— 画面直接变成空白（不是报错），
    // 于是「配置写错了」表现成「游戏打不开」。
    throw new Error('camera: 取景窗口必须为正，跟随系数必须在 (0, 1] 内')
  numeric(c.audio, 'audio')
  if (
    ![c.audio.bgmVolume, c.audio.shotVolume].every((v) => Number.isFinite(v) && v >= 0 && v <= 1) ||
    !Number.isFinite(c.audio.bgmRate) ||
    c.audio.bgmRate <= 0.25 ||
    c.audio.bgmRate > 2 ||
    !Number.isInteger(c.audio.shotVoices) ||
    c.audio.shotVoices < 1 ||
    c.audio.shotVoices > 32 ||
    !Number.isFinite(c.audio.voiceHurtCooldownMs) ||
    c.audio.voiceHurtCooldownMs < 0
  )
    throw new Error(
      'audio: 音量必须在 0—1 之间，BGM 速率必须在 (0.25, 2] 内，枪声池容量必须为 1—32 的整数，受击语音冷却必须为非负数',
    )
  const warp = c.bgmWarp
  if (
    !warp ||
    typeof warp.enabled !== 'boolean' ||
    !Number.isFinite(warp.lowpassHz) ||
    warp.lowpassHz < 200 ||
    warp.lowpassHz > 12000 ||
    !Number.isFinite(warp.sweepHz) ||
    warp.sweepHz <= 0 ||
    warp.sweepHz > 2 ||
    !Number.isFinite(warp.sweepDepthHz) ||
    warp.sweepDepthHz < 0 ||
    warp.sweepDepthHz >= warp.lowpassHz ||
    !Number.isFinite(warp.resonance) ||
    warp.resonance <= 0 ||
    warp.resonance > 12 ||
    !Number.isFinite(warp.drive) ||
    warp.drive < 1 ||
    warp.drive > 8
  )
    throw new Error(
      'bgmWarp: lowpassHz 必须在 200—12000 之间，sweepDepthHz 必须小于 lowpassHz，drive 必须在 1—8 之间',
    )
  const light = c.lighting
  if (
    !light ||
    typeof light.enabled !== 'boolean' ||
    !Number.isFinite(light.playerRadius) ||
    light.playerRadius <= 0 ||
    !Number.isFinite(light.bulletRadius) ||
    light.bulletRadius <= 0 ||
    !Number.isFinite(light.darknessAlpha) ||
    light.darknessAlpha < 0 ||
    light.darknessAlpha > 1 ||
    !Number.isInteger(light.rays) ||
    light.rays < 8 ||
    light.rays > 1024 ||
    !Number.isInteger(light.bulletRays) ||
    light.bulletRays < 4 ||
    light.bulletRays > 256 ||
    !Number.isInteger(light.maxBulletLights) ||
    light.maxBulletLights < 0 ||
    light.maxBulletLights > 128 ||
    !Number.isFinite(light.softness) ||
    light.softness < 0 ||
    light.softness >= 1 ||
    !Number.isFinite(light.furnitureMarginPx) ||
    light.furnitureMarginPx < 0 ||
    light.furnitureMarginPx > 200
  )
    throw new Error(
      'lighting: 半径必须为正，darknessAlpha / softness 必须在 [0, 1) 内，rays / bulletRays / maxBulletLights 必须为合法整数，furnitureMarginPx 必须在 0—200 之间',
    )
  numeric(c.player, 'player')
  numeric(c.drops, 'drops')
  const dropFields = [
    'chance',
    'staminaChance',
    'staminaAmount',
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
    c.drops.healthChance + c.drops.staminaChance > 1 ||
    c.drops.staminaAmount <= 0 ||
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
  for (const key of [
    'maxStamina',
    'staminaRegenPerSec',
    'maxShield',
    'shieldRegenPerSec',
    'shieldRegenDelayMs',
    'facingDeadzonePx',
  ] as const) {
    if (!Number.isFinite(c.player[key]) || c.player[key] < 0)
      throw new Error('player.' + key + ': 缺少或非法的资源配置')
  }
  if (c.player.maxStamina <= 0) throw new Error('player.maxStamina: 必须为正数')
  if (!Number.isInteger(c.player.shieldRegenDelayMs))
    throw new Error('player.shieldRegenDelayMs: 必须为整数毫秒')
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
  // 只校验四种基准键，与上面 gunMuzzles 同一套判据；各武器的键由玩家侧回退到它们。
  for (const key of ['shoot', 'runGun', 'pulseShoot', 'pulseRun'] as const) {
    const pivot = c.gunPivots?.[key]
    if (
      !Array.isArray(pivot) ||
      pivot.length !== 2 ||
      pivot.some((n) => !Number.isFinite(n) || n < 0)
    )
      throw new Error('gunPivots.' + key + ': 缺少或非法的肩部枢轴（手臂分层旋转要用）')
  }
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
  const { finale: _finale, ...arenaNumbers } = c.arena
  numeric(arenaNumbers, 'arena')
  if (!Number.isInteger(c.arena.maxStages) || c.arena.maxStages < 1)
    throw new Error('arena.maxStages: 关卡上限无效')
  if (!Number.isFinite(c.arena.initialSprayers) || c.arena.initialSprayers < 0)
    throw new Error('arena.initialSprayers: 必须为非负有限数')
  if (!Number.isFinite(c.arena.initialGrabbers) || c.arena.initialGrabbers < 0)
    throw new Error('arena.initialGrabbers: 不能为负（0 是合法值：第一层不出抓取怪）')
  for (const key of ['initialMuscovies', 'initialNightmareCats'] as const) {
    if (!Number.isFinite(c.arena[key]) || c.arena[key] < 0)
      throw new Error(`arena.${key}: 新敌人预算必须为非负数`)
  }
  for (const key of ['muscovyMinFloor', 'nightmareCatMinFloor'] as const) {
    if (!Number.isInteger(c.arena[key]) || c.arena[key] < 2 || c.arena[key] > c.arena.maxStages)
      throw new Error(`arena.${key}: 新敌人最早出现层必须在2至末层之间`)
  }
  if (!c.arena.finale || c.arena.finale.floor !== c.arena.maxStages ||
    !c.arena.finale.finalRewardId?.trim())
    throw new Error('arena.finale: 必须明确末层序号与最终收益ID')
  if (!Number.isInteger(c.arena.finale.heartDemonHp) || c.arena.finale.heartDemonHp <= 0)
    throw new Error('arena.finale.heartDemonHp: 心魔血量必须是正整数')
  // 一局几层 = `maxStages`（第 1..N 层的首领按层的序号挑），一层几间 = 下面这两个数。
  // 层与间都进配置：红线 2 说数值不许写死在代码里，而这两个数直接决定一局有多长。
  if (!Number.isInteger(c.arena.roomsPerFloor) || c.arena.roomsPerFloor < 4)
    throw new Error('arena.roomsPerFloor: 一层至少 4 间（首间起点 + 末间首领 + 要打的 + 侧室）')
  if (
    !Number.isInteger(c.arena.sideRoomsPerFloor) ||
    c.arena.sideRoomsPerFloor < 1 ||
    c.arena.sideRoomsPerFloor > c.arena.roomsPerFloor - 2
  )
    throw new Error(
      'arena.sideRoomsPerFloor: 侧室数必须 ≥ 1（一层要有岔路，直线不是地牢）' +
        '且 ≤ roomsPerFloor−2（主干至少留首末两间）',
    )
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
  if (
    !Number.isFinite(c.encounter.bossDamageMultiplier) ||
    c.encounter.bossDamageMultiplier <= 0
  )
    throw new Error('encounter: Boss伤害倍率必须为正数')
  for (const key of ['bossContactDamagePerTick', 'eliteBossVisualScale', 'eliteBossHpScale', 'eliteBossRadius'] as const)
    if (!Number.isFinite(c.encounter[key]) || c.encounter[key] <= 0)
      throw new Error(`encounter.${key}: 必须为正数`)
  if (!Number.isInteger(c.encounter.eliteEscortCount) || c.encounter.eliteEscortCount < 0)
    throw new Error('encounter.eliteEscortCount: 必须为非负整数')
  for (const scale of [c.encounter.bossVisualScaleMultiplier, c.encounter.bossHitRadiusMultiplier])
    if (!Number.isFinite(scale) || scale <= 0)
      throw new Error('encounter: Boss display and hit radius multipliers must be positive')
  const reinforcements = c.encounter.bossReinforcements
  if (
    !reinforcements ||
    !Number.isFinite(reinforcements.cooldownMs) || reinforcements.cooldownMs <= 0 ||
    !Number.isInteger(reinforcements.maxAlive) || reinforcements.maxAlive <= 0 ||
    !Number.isInteger(reinforcements.spawnCount) || reinforcements.spawnCount <= 0
  )
    throw new Error('encounter: Boss补怪冷却、数量与上限配置无效')
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
  const canonical = new Set<string>(WEAPON_IDS)
  const legacy = new Set<string>(LEGACY_WEAPON_IDS)
  for (const w of c.weapons) {
    if (!canonical.has(w.id) || ids.has(w.id) || !w.name || !w.description)
      throw new Error('combat.weapons: ID重复/无效')
    ids.add(w.id)
    if (!w.artKey || !['projectile', 'melee', 'beam'].includes(w.mode))
      throw new Error('weapon: 模式/素材无效')
    if (
      !['bullet', 'energy', 'slash', 'arcane', 'nature', 'poison', 'explosion', 'pierce', 'rapid'].includes(
        w.effect,
      )
    )
      throw new Error('weapon.effect: 无效')
    if (w.visualId !== undefined && !canonical.has(w.visualId))
      throw new Error('weapon.visualId: 无效')
    if (
      !(w.damageScale > 0) ||
      !Number.isFinite(w.damageScale) ||
      !(w.cooldownScale > 0) ||
      !Number.isFinite(w.cooldownScale)
    )
      throw new Error('weapon: 伤害/冷却倍率无效')
    if (
      !Number.isFinite(w.staminaCost) ||
      w.staminaCost < 0 ||
      (w.mode !== 'melee' && w.staminaCost <= 0)
    )
      throw new Error('weapon.staminaCost: 无效')
    if (!Number.isFinite(w.effectMs) || w.effectMs <= 0)
      throw new Error('weapon.effectMs: 无效')
    if (w.mode === 'melee') {
      if (
        !(w.range > 0) ||
        !Number.isFinite(w.range) ||
        !(w.arcDeg > 0) ||
        !Number.isFinite(w.arcDeg) ||
        !(w.swingMs! > 0) ||
        !Number.isFinite(w.swingMs)
      )
        throw new Error('weapon: 近战范围/弧/挥砍时长无效')
    } else {
      if (
        !(w.speedScale > 0) ||
        !Number.isFinite(w.speedScale) ||
        !(w.lifeMs > 0) ||
        !Number.isFinite(w.lifeMs)
      )
        throw new Error('weapon.speed/life: 无效')
      if (!Number.isInteger(w.pellets) || w.pellets < 1 || !Number.isFinite(w.spreadDeg) || w.spreadDeg < 0)
        throw new Error('weapon: 弹丸/散布无效')
      if (w.mode === 'beam' && (!(w.range > 0) || !Number.isFinite(w.range)))
        throw new Error('weapon.range: 光束长度无效')
    }
    if (
      w.projectileRadius !== undefined &&
      (!(w.projectileRadius > 0) || !Number.isFinite(w.projectileRadius))
    )
      throw new Error('weapon.projectileRadius: 无效')
    if (w.projectileArt !== undefined && typeof w.projectileArt !== 'string')
      throw new Error('weapon.projectileArt: 无效')
    if (w.traits !== undefined) validateWeaponTraits(w.traits)
    if (w.status !== undefined) validateWeaponStatus(w.status)
    if (legacy.has(w.id)) {
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
    }
  }
  if (
    c.projectiles.capacity < c.limits.pellets ||
    !Number.isInteger(c.projectiles.capacity) ||
    c.feedback.aggregateMs <= 0 ||
    c.player.acceleration <= 0 ||
    c.player.deceleration <= 0
  )
    throw new Error('combat: 池容量/时间/加速度无效')
  if (c.talents) {
    const t=c.talents
    if (!Array.isArray(t.floorChoices) || t.floorChoices.length!==c.arena.maxStages || t.floorChoices.some((n)=>!Number.isInteger(n)||n<0) || !Number.isInteger(t.maxOwned) || t.maxOwned!==1+t.floorChoices.reduce((sum,n)=>sum+n,0) || !Number.isInteger(t.offerCount) || t.offerCount < 2 || t.offerCount > 5 || Object.entries(t).some(([key,value])=>key!=='floorChoices'&&(typeof value!=='number'||!Number.isFinite(value)||value<=0)) || t.maxCritChance>1 || t.maxCostReduction>=1 || t.maxCooldownReduction>=1 || t.baseCritChance>t.maxCritChance) throw new Error('combat: 天赋规则无效')
  }
  if (c.talentFx) c.talentFx = validateTalentFx(c.talentFx)
  validateAimArt(c.aimArt)
  return c
}
export function parseRewards(raw: unknown): RewardDef[] {
  const r = raw as { schemaVersion: number; rewards: RewardDef[] }
  if (!r || ![1, 2].includes(r.schemaVersion) || !Array.isArray(r.rewards)) throw new Error('rewards: 格式无效')
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
    if (![d.weapons, d.requires, d.excludes, d.effects].every(Array.isArray) || (!d.effects.length && !d.talent))
      throw new Error('rewards: 条件/效果缺失')
    if (
      d.weapons.some((w) => !(WEAPON_IDS as readonly string[]).includes(w)) ||
      d.effects.some((e) => !STATS.includes(e.stat) || !Number.isFinite(e.amount))
    )
      throw new Error('rewards: 武器/属性无效')
    if (d.talent && (!TALENT_KINDS.includes(d.talent.kind) || !['any','projectile','ballistic','melee','shield','skill'].includes(d.talent.capability) || d.maxStacks !== 1 || !d.talent.params || Object.values(d.talent.params).some((v) => !Number.isFinite(v) || v < 0) || !Array.isArray(d.talent.synergy) || d.talent.synergy.some((kind) => !TALENT_KINDS.includes(kind)))) throw new Error('rewards: 天赋定义无效')
    if (r.schemaVersion === 2 && !d.talent) throw new Error('rewards: v2 必须是独立天赋')
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
  permanent?: PermanentRunStats,
  temporaryAttackSpeedPct = 0,
  temporaryMoveSpeedPct = 0,
  temporaryDamagePct = 0,
): EffectiveStats {
  const sum = Object.fromEntries(STATS.map((k) => [k, 0])) as Record<Stat, number>
  for (const r of defs) {
    if (r.weapons.length && !r.weapons.includes(weapon.id)) continue
    for (const e of r.effects) sum[e.stat] += e.amount * (stacks.get(r.id) ?? 0)
  }
  const b = balance.baseline,
    l = config.limits
  const permanentMaxHp = permanent?.maxHp ?? b.player.maxHp
  const permanentMaxStamina = permanent?.maxStamina ?? config.player.maxStamina
  const permanentAttackSpeed = Math.max(0, permanent?.attackSpeedPct ?? 0) / 100
  const temporaryAttackSpeed = Math.max(0, temporaryAttackSpeedPct) / 100
  const permanentMoveSpeed = Math.max(0, permanent?.moveSpeedPct ?? 0) / 100
  const temporaryMoveSpeed = Math.max(0, temporaryMoveSpeedPct) / 100
  const temporaryDamage = Math.max(0, temporaryDamagePct) / 100
  return {
    damage:
      b.bullet.damage * weapon.damageScale * (1 + sum.damage) * (1 + temporaryDamage),
    cooldownMs:
      (b.bullet.fireIntervalMs * weapon.cooldownScale) /
      Math.min(
        l.fireRateScale,
        1 + sum.fireRate + permanentAttackSpeed + temporaryAttackSpeed,
      ),
    bulletSpeed:
      b.bullet.speed * weapon.speedScale * Math.min(l.bulletSpeedScale, 1 + sum.bulletSpeed),
    spreadDeg: weapon.spreadDeg * Math.max(l.spreadScaleMin, 1 + sum.spread),
    pellets:
      weapon.id === 'pulse' || weapon.mode === 'melee'
        ? 1
        : Math.min(l.pellets, weapon.pellets + sum.pellets),
    lifeMs: weapon.lifeMs,
    moveSpeed:
      b.player.speed *
      Math.min(l.moveScale, 1 + sum.move + permanentMoveSpeed + temporaryMoveSpeed),
    maxHp: Math.round(permanentMaxHp * (1 + sum.maxHp)),
    maxStamina: Math.round(permanentMaxStamina * (1 + sum.maxStamina)),
    iframeMs: Math.min(l.iframeMs, b.player.iframeMs + sum.iframeMs),
  }
}
