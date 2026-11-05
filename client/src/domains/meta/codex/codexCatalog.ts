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
        `主动靠近并通过接触造成伤害：每 ${formatSeconds(bundle.balance.frameDamage.tickMs)} ${derived.contactDamagePerTick} 点。生命 ${derived.maxHp}，速度 ${derived.speed} px/s。`,
        derived.childCount > 0
          ? `死亡后延迟 ${formatSeconds(derived.splitDelayMs)} 分裂成 ${derived.childCount} 只下一代纸团；子代体型与接触伤害改变，需继续清理。`
          : '这是最后一代，死亡后不再分裂。',
        `出生后 ${formatSeconds(generation.graceMs)} 内不会接触伤害玩家，移动速度为正常的 ${generation.graceMoveMult} 倍。首领房的分裂子代同样受援军数量上限约束。`,
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
      `慢速逼近，进入 ${tank.slam.range} px 后预警 ${formatSeconds(tank.slam.windupMs)}，对半径 ${tank.slam.radius} px 内玩家下砸，伤害 ${tankDerived.slamDamage}；攻击冷却 ${formatSeconds(tank.slam.cooldownMs)}。`,
      `下砸后恢复 ${formatSeconds(tank.slam.recoverMs)}，期间受到伤害 ×${tank.slam.vulnerableDamageMult}。趁恢复窗集中输出。`,
      `玩家子弹会穿透本体而不消失：命中先结算完整伤害，持续重叠每 ${formatSeconds(tank.frameDamage.tickMs)} 追加基础伤害 ×${tank.frameDamage.bullet.tickDamageRatio}，单来源最多 ${tank.frameDamage.bullet.maxTicksPerSource} 次。可以利用穿透攻击它身后的怪物。`,
      `持续近战接触每 ${formatSeconds(tank.frameDamage.tickMs)} 结算基础伤害 ×${tank.frameDamage.melee.tickDamageRatio}，单来源最多 ${tank.frameDamage.melee.maxTicksPerSource} 次。受击会叠加减速，最多 ${tank.hitSlow.maxStacks} 层，最低移动倍率 ${tank.hitSlow.minSpeedMult}。`,
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
      `笔记本会投技。靠近 ${grabber.grab.range} px 时出现「!」预警，持续 ${formatSeconds(grabber.grab.telegraphMs)}。预警期间跑出 ${grabber.grab.range * grabber.grab.releaseRangeMult} px 或击杀它可取消；普通擦伤不会打断。`,
      `预警结束后会在 ${formatSeconds(grabber.grab.pounceMs)} 内扑来并锁定抓取，此时无法靠走位闪避。抓住后世界冻结，必须持续快速点击鼠标左键（攻击键）挣脱，长按不代替连点。`,
      `每次点击扣除抓取者最大生命的 ${grabber.grab.pressDamageRatio * 100}%（当前 ${grabberDerived.pressDamage} 点），满血最多 ${grabberDerived.pressesToEscape} 次；不受武器伤害、攻速与冷却影响。`,
      `被抓后每 ${formatSeconds(grabber.grab.biteIntervalMs)} 咬一口，当前难度每口 ${grabberDerived.biteDamage} 点；请在倒计时内挣脱。`,
      `挣脱时将它保留 1 血甩出 ${grabber.grab.flingDistance} px，飞行 ${formatSeconds(grabber.grab.flingTimeMs)} 后落地死亡；半径 ${grabber.grab.blastRadius} px 爆炸造成 ${grabberDerived.blastDamage} 点伤害，只伤其他敌人，不伤玩家。`,
      `抓取冷却 ${formatSeconds(grabber.grab.cooldownMs)}，同类起手间隔 ${formatSeconds(grabber.grab.sameTypeCooldownMs)}。`,
    ],
    lorePlaceholder: '原本记录课程与待办的笔记本，翻开后却只剩下一页页未完成的任务。梦里，它总想把你留在下一页。',
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
      `保持约 ${sprayer.spray.keepDistance} px 距离，进入 ${sprayer.spray.range} px 射程后预警 ${formatSeconds(sprayer.spray.windupMs)}，沿目标方向喷出 ${sprayer.spray.puddlesPerSpray} 滩催化液；冷却 ${formatSeconds(sprayer.spray.cooldownMs)}。`,
      `液滩半径 ${sprayer.spray.puddleRadius} px，存在 ${formatSeconds(sprayer.spray.lifetimeMs)}，踩过即消失。沾液后速度 ×${sprayer.coating.speedMultiplier}，可自由穿过敌人；接触敌人立即造成 ${sprayer.coating.contactDamagePerTick} 点伤害，之后每 ${formatSeconds(sprayer.coating.contactTickMs)} 再结算一次。`,
      `沾液时累计实际移动，每 ${formatSeconds(sprayer.coating.drainIntervalMs)} 耗血 ${sprayer.coating.drainDamage} 点。累计移动 ${formatSeconds(sprayer.coating.cleanseMovingMs)} 或累计静止 ${formatSeconds(sprayer.coating.cleanseStillMs)}，任一完成即可清除；走动与停下不会清空另一种进度。`,
      '再次踩液不会叠加效果，也不会刷新两种清除进度。利用加速和穿怪反击，留意自身生命消耗。',
    ],
    lorePlaceholder: '小时候看韩剧的女主会在洗车时躲在车里大哭偷偷地释放压力，现在在大学澡堂洗澡时在隔间里肆意地唱歌宣泄情绪——当然，这只是一个草地里的洒水器，噩梦化身产生联想很正常吧？',
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
      `在 ${muscovy.charge.range} px 内蓄力 ${formatSeconds(muscovy.charge.windupMs)}，沿预警直线以 ${muscovy.charge.dashSpeed} px/s 冲刺，最大距离 ${muscovy.charge.dashDistance} px；冲刺开始后不再追踪玩家。`,
      `冲刺敌我不分：撞到玩家或其他敌人均造成 ${Math.round(muscovy.charge.damage * modifiers.enemyDamage)} 点伤害，每个目标每次冲刺只命中一次。可以引导它冲向怪群。`,
      `撞到墙壁或障碍会提前停止。冲刺期间仍可受到伤害；向侧面躲避预警线路。冲刺后恢复 ${formatSeconds(muscovy.charge.recoverMs)}，冷却 ${formatSeconds(muscovy.charge.cooldownMs)}。`,
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
      `进入 ${cat.vortex.range} px 后蓄力 ${formatSeconds(cat.vortex.windupMs)}，原地旋转 ${formatSeconds(cat.vortex.durationMs)}；恢复 ${formatSeconds(cat.vortex.recoverMs)}，冷却 ${formatSeconds(cat.vortex.cooldownMs)}。`,
      `旋风伤害敌我不分：半径 ${cat.vortex.damageRadius} px 内，玩家和其他敌人每 ${formatSeconds(cat.vortex.damageTickMs)} 受到 ${Math.round(cat.vortex.damage * modifiers.enemyDamage)} 点伤害。`,
      `吸力影响玩家与其他敌人：牵引半径 ${cat.vortex.pullRadius} px，基础牵引速度 ${cat.vortex.pullSpeed} px/s，上限 ${cat.vortex.maxPullSpeed} px/s。尽早向风圈外移动。`,
      `双方飞行子弹在 ${cat.vortex.projectileRadius} px 内会偏转弹道，基础转向 ${cat.vortex.turnRateRadPerSec} rad/s，上限 ${cat.vortex.maxTurnRateRadPerSec} rad/s；子弹阵营与伤害归属保持原样。近战与瞬时攻击不受影响。`,
      `生命归零后净化 ${formatSeconds(cat.vortex.purificationMs)}，去除黑化、恢复正常，再从传送门离开。`,
    ],
    lorePlaceholder: '听我说，我知道北交没有这款肤色的猫咪，但是我们不能拿真实的猫猫作为敌人，那可是赛博虐猫，所以噩梦化身的猫咪即使死亡了也只是去掉黑化从传送门“消失”了',
  })

  entries.push({
    id: 'first-boss', category: '首领', name: '课业重压', variant: '第二层首领',
    role: '教材与未交作业堆成的梦魇 · 预警后范围下砸', threatLevel: tank.threatLevel,
    textureKey: BOSS_FIRST_ART.texture, visualScale: tank.visualScale,
    hasArt: hasDeliveredArt(BOSS_FIRST_ART.texture),
    stats: [
      ...(encounter ? [{ label: '生命值', value: `${encounter.bossHp + encounter.bossHpPerStage}` }] : []),
      { label: '攻击前摇', value: formatSeconds(tank.slam.windupMs) },
      { label: '技能数量', value: `${bossSkills?.bosses['2']?.skills.length ?? 2}` },
    ],
    combatNotes: [
      ...bossSkillNotes(bossSkills, 2, modifiers.enemyDamage * (encounter?.bossDamageMultiplier ?? 1)),
      `沿用计组课本的范围下砸：前摇 ${formatSeconds(tank.slam.windupMs)}，范围半径 ${tank.slam.radius} px；恢复 ${formatSeconds(tank.slam.recoverMs)} 时承伤 ×${tank.slam.vulnerableDamageMult}。首领本体会挡下子弹，不具备普通教材的穿透特性。`,
      ...bossNotes(encounter, tank.slam.damage * modifiers.enemyDamage, 2),
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
    variant: '第三层首领',
    role: `远程首领 · 保持 ${boss.keepDistance}px 距离并释放环形弹幕`,
    threatLevel: 5,
    textureKey: STAGE2_BOSS_ART.idle,
    visualScale: boss.visualScale,
    hasArt: hasDeliveredArt(STAGE2_BOSS_ART.idle),
    stats: [
      ...(encounter ? [{ label: '生命值', value: `${encounter.bossHp + 2 * encounter.bossHpPerStage}` }] : []),
      { label: '移动速度', value: `${Math.round(boss.speed * modifiers.enemySpeed)} px/s` },
      { label: '弹幕数量', value: `${radialNumber('count', boss.projectile.count)} 发` },
      { label: '基础单发伤害', value: `${radialDamage}` },
      { label: '攻击前摇', value: formatSeconds(radialNumber('windupMs', boss.windupMs)) },
      { label: '碰撞半径', value: `${boss.radius} px` },
    ],
    combatNotes: [
      ...bossSkillNotes(bossSkills, 3, modifiers.enemyDamage * (encounter?.bossDamageMultiplier ?? 1)),
      `保持约 ${boss.keepDistance} px 距离，横向游走，留意弹幕间隙与地面三角连线。`,
      ...(!radial ? [
        `预警 ${formatSeconds(boss.windupMs)} 后发射 ${boss.projectile.count} 发环形弹幕，每次错开 ${boss.projectile.volleyOffsetDeg}°。子弹速度 ${boss.projectile.speed} px/s、半径 ${boss.projectile.radius} px、存在 ${formatSeconds(boss.projectile.lifetimeMs)}；恢复 ${formatSeconds(boss.recoverMs)}，冷却 ${formatSeconds(boss.cooldownMs)}。`,
      ] : []),
      ...bossNotes(encounter, radialDamage * modifiers.enemyDamage, 3),
    ],
    lorePlaceholder: '高中的时候我的后桌们折了一架纸飞机然后放飞了。纸飞正正好好轻落到了我的脚边，他们都感到惊讶和高兴。我把纸飞机拆开，上面写着”飞黄腾达的人“。后来我把它变成了千纸鹤，放在大学的书包里',
  })

  const extraBosses = [
    { floor: 4, id: 'acid-boss', name: '酸蚀喷灌设备', textureKey: sprayer.textureKey, visualScale: sprayer.visualScale, role: '酸池与积水覆盖战场，持续伤害并扰乱走位', lore: '实验楼的老旧喷灌设备在梦里与化学实验台融成一体。它还在认真浇灌，只是养分变成了酸蚀的压力。' },
    { floor: 5, id: 'sports-boss', name: '失控体育器材', textureKey: muscovy.textureKey, visualScale: muscovy.visualScale, role: '无敌反弹冲撞与范围跳砸，敌我都会遭殃', lore: '体育测试前夜，跳箱、实心球和永远跑不完的圈数挤在同一个噩梦里。器材室一开门，它们便全都活了。' },
    { floor: 6, id: 'rollcall-boss', name: '分身点名册', textureKey: grabber.textureKey, visualScale: grabber.visualScale, role: '辨认真身的分身战，并将全场小怪统一变形', lore: '名字一行行变成了相同的面孔。点名册翻到哪里，哪里就传来熟悉却分不清来源的“到”。' },
    { floor: 7, id: 'nailong-boss', name: '奶龙', textureKey: NAILONG_ART.texture, visualScale: tank.visualScale, role: '用笑声驱使怪群，并连续发射蓝色环形弹幕', lore: '短视频的笑声在熬夜的脑海里循环不止。梦里的它依旧笑得很响，却把每一个笑点都变成了躲不开的蓝色圆圈。' },
  ] as const
  for (const entry of extraBosses) entries.push({
    id: entry.id, category: '首领', name: entry.name, variant: `第${['零', '一', '二', '三', '四', '五', '六', '七', '八'][entry.floor]}层首领`,
    role: entry.role, threatLevel: 5, textureKey: entry.textureKey, visualScale: entry.visualScale,
    hasArt: hasDeliveredArt(entry.textureKey), stats: [
      ...(encounter ? [{ label: '生命值', value: `${encounter.bossHp + (entry.floor - 1) * encounter.bossHpPerStage}` }] : []),
      { label: '技能数量', value: `${bossSkills?.bosses[String(entry.floor)]?.skills.length ?? 2}` },
    ],
    combatNotes: [
      ...bossSkillNotes(bossSkills, entry.floor, modifiers.enemyDamage * (encounter?.bossDamageMultiplier ?? 1)),
      ...bossNotes(encounter, tank.slam.damage * modifiers.enemyDamage, entry.floor),
    ],
    lorePlaceholder: entry.lore,
  })

  entries.push({
    id: 'heart-demon', category: '首领', name: '心魔', variant: '第八层最终首领',
    role: '考研梦魇 · 破裂考场钟盘、齿轮与批改试卷构成的最终心魔',
    threatLevel: entries.find((entry) => entry.id === 'stage2-boss')!.threatLevel,
    textureKey: FINAL_BOSS_ART.idle, visualScale: boss.visualScale,
    hasArt: hasDeliveredArt(FINAL_BOSS_ART.idle), stats: [
      ...(encounter ? [{ label: '生命值', value: `${encounter.bossHp + 7 * encounter.bossHpPerStage}` }] : []),
      { label: '技能数量', value: `${bossSkills?.bosses['8']?.skills.length ?? 3}` },
    ],
    combatNotes: [
      ...bossSkillNotes(bossSkills, 8, modifiers.enemyDamage * (encounter?.bossDamageMultiplier ?? 1)),
      `第八层最终首领，使用近身范围下砸。进入 ${tank.slam.range} px 后前摇 ${formatSeconds(tank.slam.windupMs)}，攻击半径 ${tank.slam.radius} px；冷却 ${formatSeconds(tank.slam.cooldownMs)}。`,
      `下砸后恢复 ${formatSeconds(tank.slam.recoverMs)}，期间受到伤害 ×${tank.slam.vulnerableDamageMult}。首领会挡下子弹；绕开预警圈，再趁恢复期输出。`,
      ...bossNotes(encounter, tank.slam.damage * modifiers.enemyDamage, 8),
      '击败心魔并存活即可完成本局。',
    ],
    lorePlaceholder: '它守在梦境第八层，把失败的恐惧变成钟表与试卷。打破心魔，让被困的北交学子回到黄昏的教室；只要自己也活下来，就能迎来梦醒。',
  })

  return entries
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

function bossNotes(encounter: CodexEncounterConfig | undefined, baseDamage: number, floor: number): string[] {
  if (!encounter) return ['首领生命随所在楼层增加；强化后的生命、攻击伤害与援军参数在进入战斗后读取。']
  const support = encounter.bossReinforcements
  return [
    `当前难度单次攻击伤害 ${Math.round(baseDamage * encounter.bossDamageMultiplier)}（首领强化 ×${encounter.bossDamageMultiplier}）。${floor === 1 ? '所在楼层为 N 时，' : `第 ${floor} 层`}生命 ${floor === 1 ? `${encounter.bossHp} + (N−1) × ${encounter.bossHpPerStage}` : encounter.bossHp + (floor - 1) * encounter.bossHpPerStage}，顶部血条持续显示至死亡。`,
    `首领存活时，每 ${formatSeconds(support.cooldownMs)} 补充最多 ${support.spawnCount} 只随机小怪，场内小怪上限 ${support.maxAlive}（含等待生成与分裂子代，课业重压的突击召集技能单独豁免）；满额不额外刷新。击败首领后停止补怪，清除剩余小怪才能解锁房间。`,
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
  return candidate as CodexEncounterConfig
}
