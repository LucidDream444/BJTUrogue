/**
 * 怪物图鉴的纯数据目录。零 Phaser、零 DOM，可在 node 下直接测试。
 *
 * 这里是「配置表 → 界面可读条目」的唯一转换点：
 * - 数值一律从 `ConfigBundle` 派生，图鉴里不复制第二份平衡数据；
 * - 当前难度由主菜单选择传入，所以同一份配置可以在简单 / 普通 / 困难下
 *   显示不同结果，而不需要维护三套图鉴；
 * - 美术 key 只来自资源清单，界面不写文件路径或 `__placeholder`。
 */

import {
  deriveGrabber,
  deriveSplitterGeneration,
  deriveTank,
  deriveSprayer,
  type ConfigBundle,
  type Difficulty,
} from '@/core/config'
import { ANIMS, BOSS_FIRST_ART, FINAL_BOSS_ART, NAILONG_ART, STAGE2_BOSS_ART, findAsset } from '@/core/assetManifest'
import { bossSkillNotes, type CodexBossSkillTable } from './bossCodexNotes'

export type CodexCategory = '普通敌人' | '首领'

export interface CodexStat {
  label: string
  value: string
}

/** 图鉴需要的首领配置投影，避免依赖战斗域内部实现。 */
export interface CodexEncounterConfig {
  bossHp: number
  bossHpPerStage: number
  bossDamageMultiplier: number
  bossReinforcements: { cooldownMs: number; maxAlive: number; spawnCount: number }
  /** 心魔固定血量（`arena.finale.heartDemonHp`）；旧配置没有时退回档位公式。 */
  heartDemonHp?: number
}

export interface CodexEntry {
  id: string
  category: CodexCategory
  /** 列表与标题里显示的名字。 */
  name: string
  /** 同一物种中的阶段，例如「一阶」。 */
  variant: string
  /** 一句话战斗定位。 */
  role: string
  threatLevel: number
  /** 资源清单里的逻辑 key，不是文件路径。 */
  textureKey: string
  /** 预览时沿用的相对体型。 */
  visualScale: number
  /** 真美术是否已经到位。未到位时只画清晰的占位说明。 */
  hasArt: boolean
  stats: readonly CodexStat[]
  /** 完整战斗机制；数值从当前配置与难度派生。 */
  combatNotes: readonly string[]
  /** 异界观察笔记：背景故事，与战斗机制分开。 */
  lorePlaceholder: string
}

const GENERATION_LABELS = ['一阶', '二阶', '三阶'] as const
const PAPER_LORE = '展开后发现是一张张北京交通大学信纸。作业的代表，会大量出现在学生的噩梦里也很正常。无穷无尽的分裂也很符合学生的心态。'

/**
 * 把敌人配置与当前难度转换成图鉴条目。
 *
 * 分裂纸团的每一代都有独立数值，所以各占一条；肉盾和抓取怪各占一条。
 * 两种校园动物和七位首领均展示独立身份；数值从配置派生，行为说明与攻击预警对应。
 */
export function buildCodexEntries(
  bundle: ConfigBundle,
  difficulty: Difficulty,
  encounter?: CodexEncounterConfig,
  bossSkills?: CodexBossSkillTable,
): readonly CodexEntry[] {
  const modifiers = bundle.difficulty.difficulties[difficulty]
  const entries: CodexEntry[] = []

  const splitter = bundle.enemies.enemies.splitter
  for (const generation of splitter.generations) {
    const derived = deriveSplitterGeneration(generation, modifiers, bundle.balance)
    const splitText =
      derived.childCount > 0
        ? `击破后 ×${derived.childCount} · ${formatSeconds(derived.splitDelayMs)}`
        : '末代 · 不再分裂'
    entries.push({
      id: `splitter-${derived.gen}`,
      category: '普通敌人',
      name: splitter.displayName,
      variant: GENERATION_LABELS[derived.gen] ?? `${derived.gen + 1} 阶`,
      role:
        derived.childCount > 0
          ? `群聚分裂体 · 死亡后生成 ${derived.childCount} 只子代`
          : '群聚分裂体 · 纸团链的最后一代',
      threatLevel: splitter.threatLevel,
      textureKey: derived.textureKey,
      visualScale: derived.visualScale,
      hasArt: hasDeliveredArt(derived.textureKey),
      stats: [
        { label: '生命值', value: `${derived.maxHp}` },
        { label: '移动速度', value: `${derived.speed} px/s` },
        {
          label: '接触伤害',
          value: `${derived.contactDamagePerTick} / ${formatSeconds(bundle.balance.frameDamage.tickMs)}`,
        },
        { label: '碰撞半径', value: `${derived.radius} px` },
        { label: '分裂', value: splitText },
      ],
      combatNotes: [
        `主动贴近，接触造成伤害；生命${derived.maxHp}、速度${derived.speed}px/s。`,
        derived.childCount > 0
          ? `死亡后延迟${formatSeconds(derived.splitDelayMs)}分裂成${derived.childCount}只更小的子代；最后一代不再分裂。`
          : '最后一代，死亡后不再分裂。',
      ],
      lorePlaceholder: PAPER_LORE,
    })
  }

  const tank = bundle.enemies.enemies.tank
  const tankDerived = deriveTank(tank, modifiers, bundle.balance)
  entries.push({
    id: 'tank',
    category: '普通敌人',
    name: tank.displayName,
    variant: '重甲',
    role: `重甲教材 · 子弹穿透，前摇 ${formatSeconds(tank.slam.windupMs)} 后范围砸击`,
    threatLevel: tank.threatLevel,
    textureKey: tankDerived.textureKey,
    visualScale: tankDerived.visualScale,
    hasArt: hasDeliveredArt(tankDerived.textureKey),
    stats: [
      { label: '生命值', value: `${tankDerived.maxHp}` },
      { label: '移动速度', value: `${tankDerived.speed} px/s` },
      { label: '砸击伤害', value: `${tankDerived.slamDamage}` },
      { label: '单发承伤', value: `${tankDerived.damagePerBullet}` },
      { label: '预计击杀', value: `${tankDerived.expectedTtkSeconds.toFixed(1)} 秒` },
    ],
    combatNotes: [
      `慢速重甲，进入${tank.slam.range}px后预警${formatSeconds(tank.slam.windupMs)}并范围下砸${tankDerived.slamDamage}点；下砸后短暂易伤。`,
      `子弹可穿透：命中先结算完整伤害，持续接触每${formatSeconds(tank.frameDamage.tickMs)}追加${tank.frameDamage.bullet.tickDamageRatio}倍帧伤；近战同理，受击会减速。`,
    ],
    lorePlaceholder: '由于计组太多知识了，所以这本噩梦中的书很厚，但他的子弹穿透特性又能起到意想不到的作用',
  })

  const grabber = bundle.enemies.enemies.grabber
  const grabberDerived = deriveGrabber(grabber, modifiers, bundle.balance)
  entries.push({
    id: 'grabber',
    category: '普通敌人',
    name: grabber.displayName,
    variant: '抓取型',
    role: `抓取型 · 预警 ${formatSeconds(grabber.grab.telegraphMs)}，抓住后连点挣脱`,
    threatLevel: grabber.threatLevel,
    textureKey: grabberDerived.textureKey,
    visualScale: grabberDerived.visualScale,
    hasArt: hasDeliveredArt(grabberDerived.textureKey),
    stats: [
      { label: '生命值', value: `${grabberDerived.maxHp}` },
      { label: '移动速度', value: `${grabberDerived.speed} px/s` },
      { label: '抓取距离', value: `${grabber.grab.range} px` },
      { label: '预警时间', value: `${formatSeconds(grabber.grab.telegraphMs)}` },
      { label: '连点挣脱', value: `${grabberDerived.pressesToEscape} 次` },
    ],
    combatNotes: [
      `靠近${grabber.grab.range}px时预警抓取；预警期间跑出${grabber.grab.range * grabber.grab.releaseRangeMult}px或击杀它可取消。`,
      `被抓住后世界冻结，必须持续快速点击鼠标左键挣脱，长按不代替连点；挣脱会把它甩飞并爆炸，只伤其他敌人。`,
    ],
    lorePlaceholder: '父母总是以为游戏本就是专门玩游戏用的笔记本，但他们还是给我买了游戏本，因为我终于上大学了。',
  })

  const sprayer = bundle.enemies.enemies.sprayer
  const sprayerStats = deriveSprayer(sprayer, modifiers, bundle.balance)
  entries.push({
    id: 'sprayer',
    category: '普通敌人',
    name: sprayer.displayName,
    variant: '喷洒型',
    role: `草坪喷灌器 · 沾液加速穿怪与接触帧伤；累计移动 ${formatSeconds(sprayer.coating.cleanseMovingMs)} 或静止 ${formatSeconds(sprayer.coating.cleanseStillMs)} 清除`,
    threatLevel: sprayer.threatLevel,
    textureKey: sprayer.textureKey,
    visualScale: sprayer.visualScale,
    hasArt: hasDeliveredArt(sprayer.textureKey),
    stats: [
      { label: '生命值', value: `${sprayerStats.maxHp}` },
      { label: '移动速度', value: `${sprayerStats.speed} px/s` },
      { label: '沾液加速', value: `×${sprayer.coating.speedMultiplier}` },
      { label: '接触帧伤', value: `${sprayer.coating.contactDamagePerTick} / ${formatSeconds(sprayer.coating.contactTickMs)}` },
      {
        label: '移动耗血',
        value: `${sprayer.coating.drainDamage} / ${formatSeconds(sprayer.coating.drainIntervalMs)}`,
      },
    ],
    combatNotes: [
      `中距离喷出催化液，液滩存在${formatSeconds(sprayer.spray.lifetimeMs)}；踩到后加速并穿透敌人，接触敌人造成帧伤。`,
      `沾液持续掉血；累计移动${formatSeconds(sprayer.coating.cleanseMovingMs)}或静止${formatSeconds(sprayer.coating.cleanseStillMs)}后清除，再次踩液不叠加。`,
    ],
    lorePlaceholder: '小时候看韩剧的女主会在自助洗车洒水时，躲在车里借着洗车声大哭，偷偷地释放压力；现在在大学澡堂洗澡时，我在隔间里借着淋浴声，肆意地唱歌宣泄情绪———当然，这只是一个草地里的洒水器，噩梦化身产生联想很正常吧？',
  })

  const muscovy = bundle.enemies.enemies.muscovy
  entries.push({
    id: 'muscovy', category: '普通敌人', name: muscovy.displayName, variant: '直冲型',
    role: `蓄力 ${formatSeconds(muscovy.charge.windupMs)} 后沿预警直线展翅冲刺；不追踪，撞障碍提前停止，对沿途玩家和其他敌人造成伤害`,
    threatLevel: muscovy.threatLevel, textureKey: muscovy.textureKey,
    visualScale: muscovy.visualScale, hasArt: hasDeliveredArt(muscovy.textureKey),
    stats: [
      { label: '生命值', value: `${Math.max(1, Math.round(muscovy.hpValue * bundle.balance.baseline.bullet.damage * modifiers.enemyHp))}` },
      { label: '冲刺伤害', value: `${Math.round(muscovy.charge.damage * modifiers.enemyDamage)}` },
      { label: '冲刺距离', value: `${muscovy.charge.dashDistance} px` },
      { label: '冲刺速度', value: `${muscovy.charge.dashSpeed} px/s` },
      { label: '冷却', value: formatSeconds(muscovy.charge.cooldownMs) },
    ],
    combatNotes: [
      `在${muscovy.charge.range}px内蓄力${formatSeconds(muscovy.charge.windupMs)}后沿预警直线冲刺${muscovy.charge.dashDistance}px；撞墙提前停止。`,
      `冲刺敌我不分，对沿途玩家和其他敌人造成${Math.round(muscovy.charge.damage * modifiers.enemyDamage)}点伤害；冲刺后短暂恢复。`,
    ],
    lorePlaceholder: '明湖旁边总有几只番鸭，听说它们是被底下的大鹅排挤才到上面来的。不知道做噩梦的学生有没有共情呢？',
  })
  const cat = bundle.enemies.enemies.nightmare_cat
  entries.push({
    id: 'nightmare_cat', category: '普通敌人', name: cat.displayName, variant: '旋风型',
    role: `蓄力 ${formatSeconds(cat.vortex.windupMs)} 后旋转；持续伤害玩家与其他敌人，牵引范围内所有单位并偏转双方飞行子弹`,
    threatLevel: cat.threatLevel, textureKey: cat.textureKey,
    visualScale: cat.visualScale, hasArt: hasDeliveredArt(cat.textureKey),
    stats: [
      { label: '生命值', value: `${Math.max(1, Math.round(cat.hpValue * bundle.balance.baseline.bullet.damage * modifiers.enemyHp))}` },
      { label: '范围伤害', value: `${Math.round(cat.vortex.damage * modifiers.enemyDamage)} / ${formatSeconds(cat.vortex.damageTickMs)}` },
      { label: '伤害半径', value: `${cat.vortex.damageRadius} px` },
      { label: '牵引半径', value: `${cat.vortex.pullRadius} px` },
      { label: '偏弹半径', value: `${cat.vortex.projectileRadius} px` },
      { label: '旋转持续', value: formatSeconds(cat.vortex.durationMs) },
      { label: '冷却', value: formatSeconds(cat.vortex.cooldownMs) },
    ],
    combatNotes: [
      `蓄力${formatSeconds(cat.vortex.windupMs)}后原地旋转${formatSeconds(cat.vortex.durationMs)}；范围内玩家和其他敌人持续受伤，并牵引附近单位。`,
      `旋转会牵引附近单位（牵引速度${cat.vortex.pullSpeed}px/s）并偏转双方飞行子弹（转向${cat.vortex.turnRateRadPerSec}rad/s）；击杀后净化离开。`,
    ],
    lorePlaceholder: '听我说，我知道北交没有这款肤色的猫咪，但是我们不能拿真实的猫猫作为敌人，因为那就是赛博虐猫了，所以噩梦化身的猫咪即使死亡了也只是去掉黑化从传送门“消失”了而不是死了',
  })

  entries.push({
    id: 'first-boss', category: '首领', name: '课业重压', variant: '第 1 层首领池',
    role: '教材与未交作业堆成的梦魇 · 预警后范围下砸', threatLevel: tank.threatLevel,
    textureKey: BOSS_FIRST_ART.texture, visualScale: tank.visualScale,
    hasArt: hasDeliveredArt(BOSS_FIRST_ART.texture),
    stats: [
      ...(encounter ? [{ label: '生命值', value: `${encounter.bossHp}` }] : []),
      { label: '攻击前摇', value: formatSeconds(tank.slam.windupMs) },
      { label: '技能数量', value: `${bossSkills?.bosses['2']?.skills.length ?? 2}` },
    ],
    combatNotes: [
      ...bossSkillNotes(bossSkills, 2, modifiers.enemyDamage * (encounter?.bossDamageMultiplier ?? 1)),
      '本体挡子弹；下砸后短暂易伤。',
      ...bossNotes(encounter, tank.slam.damage * modifiers.enemyDamage, 1),
    ],
    lorePlaceholder: '厚课本、装订作业和批满红勾的试卷堆成了课业重压。在梦里，永远做不完的任务终于压成了实体。',
  })

  const boss = bundle.enemies.stage2Boss
  const radial = bossSkills?.bosses['3']?.skills.find((skill) => skill.id === 'radial')
  const radialNumber = (key: string, fallback: number): number =>
    typeof radial?.[key] === 'number' ? radial[key] as number : fallback
  const radialDamage = radialNumber('damage', boss.projectile.damage)
  entries.push({
    id: 'stage2-boss',
    category: '首领',
    name: boss.displayName,
    variant: '第 1 层首领池',
    role: `远程首领 · 保持 ${boss.keepDistance}px 距离并释放环形弹幕`,
    threatLevel: 5,
    textureKey: STAGE2_BOSS_ART.idle,
    visualScale: boss.visualScale,
    hasArt: hasDeliveredArt(STAGE2_BOSS_ART.idle),
    stats: [
      ...(encounter ? [{ label: '生命值', value: `${encounter.bossHp}` }] : []),
      { label: '移动速度', value: `${Math.round(boss.speed * modifiers.enemySpeed)} px/s` },
      { label: '弹幕数量', value: `${radialNumber('count', boss.projectile.count)} 发` },
      { label: '基础单发伤害', value: `${radialDamage}` },
      { label: '攻击前摇', value: formatSeconds(radialNumber('windupMs', boss.windupMs)) },
      { label: '碰撞半径', value: `${boss.radius} px` },
    ],
    combatNotes: [
      ...bossSkillNotes(bossSkills, 3, modifiers.enemyDamage * (encounter?.bossDamageMultiplier ?? 1)),
      '保持距离，横向游走，留意弹幕间隙与三角连线。',
      ...bossNotes(encounter, radialDamage * modifiers.enemyDamage, 1),
    ],
    lorePlaceholder: '高中的时候坐在我后桌的同学们折了一架纸飞机，然后放飞了。纸飞机正正好好轻落到了我的脚边，他们都感到惊讶和高兴。我把纸飞机拆开，上面写着”飞黄腾达“。后来我把它变成了千纸鹤，放在大学的书包里',
  })

  const extraBosses = [
    { floor: 4, id: 'acid-boss', name: '酸蚀喷灌设备', textureKey: sprayer.textureKey, visualScale: sprayer.visualScale, role: '酸池与积水覆盖战场，持续伤害并扰乱走位', lore: '实验楼的老旧喷灌设备在梦里与化学实验台融成一体。它还在认真浇灌，只是养分变成了酸蚀的压力。' },
    { floor: 5, id: 'sports-boss', name: '失控体育器材', textureKey: muscovy.textureKey, visualScale: muscovy.visualScale, role: '无敌反弹冲撞与范围跳砸，敌我都会遭殃', lore: '体育测试前夜，跳箱、实心球和永远跑不完的圈数挤在同一个噩梦里。器材室一开门，它们便全都活了。' },
    { floor: 6, id: 'rollcall-boss', name: '分身点名册', textureKey: grabber.textureKey, visualScale: grabber.visualScale, role: '辨认真身的分身战，并将全场小怪统一变形', lore: '名字一行行变成了相同的面孔。点名册翻到哪里，哪里就传来熟悉却分不清来源的“到”。' },
    { floor: 7, id: 'nailong-boss', name: '奶龙', textureKey: NAILONG_ART.texture, visualScale: tank.visualScale, role: '用笑声驱使怪群，并连续发射蓝色环形弹幕', lore: '我们北交为什么不能有自己的奶龙？考研累了就放声大笑吧，像奶龙一样大笑，笑出豪意，笑出文青。' },
  ] as const
  for (const entry of extraBosses) entries.push({
    id: entry.id, category: '首领', name: entry.name, variant: entry.floor <= 5 ? '第 2 层首领池' : '第 3 层首领池',
    role: entry.role, threatLevel: 5, textureKey: entry.textureKey, visualScale: entry.visualScale,
    hasArt: hasDeliveredArt(entry.textureKey), stats: [
      ...(encounter ? [{ label: '生命值', value: `${encounter.bossHp + (entry.floor <= 5 ? 1 : 2) * encounter.bossHpPerStage}` }] : []),
      { label: '技能数量', value: `${bossSkills?.bosses[String(entry.floor)]?.skills.length ?? 2}` },
    ],
    combatNotes: [
      ...bossSkillNotes(bossSkills, entry.floor, modifiers.enemyDamage * (encounter?.bossDamageMultiplier ?? 1)),
      ...bossNotes(encounter, tank.slam.damage * modifiers.enemyDamage, entry.floor <= 5 ? 2 : 3),
    ],
    lorePlaceholder: entry.lore,
  })

  entries.push({
    id: 'heart-demon', category: '首领', name: '心魔', variant: '最终首领',
    role: '考研梦魇 · 破裂考场钟盘、齿轮与批改试卷构成的最终心魔',
    threatLevel: entries.find((entry) => entry.id === 'stage2-boss')!.threatLevel,
    textureKey: FINAL_BOSS_ART.idle, visualScale: boss.visualScale,
    hasArt: hasDeliveredArt(FINAL_BOSS_ART.idle), stats: [
      ...(encounter ? [{ label: '生命值', value: `${encounter?.heartDemonHp ?? encounter.bossHp + 3 * encounter.bossHpPerStage}` }] : []),
      { label: '技能数量', value: `${bossSkills?.bosses['8']?.skills.length ?? 3}` },
    ],
    combatNotes: [
      ...bossSkillNotes(bossSkills, 8, modifiers.enemyDamage * (encounter?.bossDamageMultiplier ?? 1)),
      '近身范围下砸，下砸后短暂易伤；首领挡子弹。',
      ...bossNotes(encounter, tank.slam.damage * modifiers.enemyDamage, 3, encounter ? (encounter.heartDemonHp ?? encounter.bossHp + 3 * encounter.bossHpPerStage) : undefined),
    ],
    lorePlaceholder: '它守在梦境最深处，把失败的恐惧变成钟表与试卷。打破心魔，让被困的北交学子回到黄昏的教室；只要自己也活下来，就能迎来梦醒。',
  })

  return entries.map((entry) => ({
    ...entry,
    variant: tightCodexText(entry.variant),
    role: tightCodexText(entry.role),
    stats: entry.stats.map((stat) => ({ ...stat, value: tightCodexText(stat.value) })),
    combatNotes: entry.combatNotes.map(tightCodexText),
    lorePlaceholder: tightCodexText(entry.lorePlaceholder),
  }))
}

/** 某个逻辑贴图 key 对应的循环待机动画；没有就返回 `undefined`。 */
export function codexAnimationKey(textureKey: string): string | undefined {
  return ANIMS.find((anim) => anim.textureKey === textureKey && anim.repeat === -1)?.animKey
}

/** 方向键 / 键盘选择时使用的环绕步进，避免越界后卡死。 */
export function moveCodexIndex(index: number, delta: number, count: number): number {
  if (count <= 0) return 0
  return (((index + delta) % count) + count) % count
}

function hasDeliveredArt(textureKey: string): boolean {
  return findAsset(textureKey)?.placeholder === false
}

function formatSeconds(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)} 秒`
}

/**
 * 图鉴正文的统一排版：**英文单词和数字左右两边不留空格**。
 *
 * 中文正文不需要词间空格，而数值/单位（`260 px/s`、`0.5 秒`）里的空格会让
 * 手机和窄屏上的换行更碎。这里直接去掉半角空格；换行由 `CodexPanel` 自己分页。
 */
export function tightCodexText(text: string): string {
  return text.replace(/[ \t]+/g, '')
}

function bossNotes(
  encounter: CodexEncounterConfig | undefined,
  baseDamage: number,
  layer: number,
  hpOverride?: number,
): string[] {
  if (!encounter) return ['首领生命随层数提高，实际数值以战斗内为准。']
  const support = encounter.bossReinforcements
  const hp = hpOverride ?? encounter.bossHp + (layer - 1) * encounter.bossHpPerStage
  return [
    `第${layer}层生命${hp}；单次攻击伤害${Math.round(baseDamage * encounter.bossDamageMultiplier)}点；每${formatSeconds(support.cooldownMs)}补充小怪，清空后开门。`,
  ]
}

/** 从 loader 缓存读取配置投影；白箱菜单未加载战斗表时仍可展示基础图鉴。 */
export function codexEncounterConfig(raw: unknown): CodexEncounterConfig | undefined {
  if (!raw || typeof raw !== 'object' || !('encounter' in raw)) return undefined
  const value = raw.encounter
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<CodexEncounterConfig>
  const support = candidate.bossReinforcements
  if (!support || ![candidate.bossHp, candidate.bossHpPerStage, candidate.bossDamageMultiplier,
    support.cooldownMs, support.maxAlive, support.spawnCount].every((number) =>
    typeof number === 'number' && Number.isFinite(number) && number >= 0)) return undefined
  const finale = (raw as { arena?: { finale?: { heartDemonHp?: unknown } } }).arena?.finale
  const heartDemonHp = finale?.heartDemonHp
  return {
    ...candidate,
    heartDemonHp:
      typeof heartDemonHp === 'number' && Number.isFinite(heartDemonHp) && heartDemonHp > 0
        ? heartDemonHp
        : undefined,
  } as CodexEncounterConfig
}
