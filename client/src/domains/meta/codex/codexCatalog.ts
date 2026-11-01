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
import { ANIMS, BOSS_FIRST_ART, FINAL_BOSS_ART, STAGE2_BOSS_ART, findAsset } from '@/core/assetManifest'

export type CodexCategory = '普通敌人' | '首领'

export interface CodexStat {
  label: string
  value: string
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
  /** 项目还没有正式档案文案，界面先把正文位置完整留出来。 */
  lorePlaceholder: string
}

const GENERATION_LABELS = ['一阶', '二阶', '三阶'] as const
const LORE_PLACEHOLDER =
  '档案文案尚未编写。\n这里预留出没场景、生态习性、玩家应对建议与首次遭遇记录；后续补齐内容时不需要改图鉴版式。'

/**
 * 把敌人配置与当前难度转换成图鉴条目。
 *
 * 分裂纸团的每一代都有独立数值，所以各占一条；肉盾和抓取怪各占一条。
 * 两种校园动物和三种首领均展示真实身份；数值从配置派生，行为说明与攻击预警对应。
 */
export function buildCodexEntries(
  bundle: ConfigBundle,
  difficulty: Difficulty,
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
      lorePlaceholder: LORE_PLACEHOLDER,
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
    lorePlaceholder: LORE_PLACEHOLDER,
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
    lorePlaceholder: LORE_PLACEHOLDER,
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
    lorePlaceholder: LORE_PLACEHOLDER,
  })

  const muscovy = bundle.enemies.enemies.muscovy
  entries.push({
    id: 'muscovy', category: '普通敌人', name: muscovy.displayName, variant: '直冲型',
    role: `蓄力 ${formatSeconds(muscovy.charge.windupMs)} 后沿预警直线展翅冲刺；不追踪，撞障碍提前停止，对沿途玩家和其他敌人造成伤害`,
    threatLevel: muscovy.threatLevel, textureKey: muscovy.textureKey,
    visualScale: muscovy.visualScale, hasArt: hasDeliveredArt(muscovy.textureKey),
    stats: [
      { label: '生命值', value: `${Math.max(1, Math.round(muscovy.hpValue * bundle.balance.baseline.bullet.damage * modifiers.enemyHp))}` },
      { label: '冲刺伤害', value: `${muscovy.charge.damage * modifiers.enemyDamage}` },
      { label: '冲刺距离', value: `${muscovy.charge.dashDistance} px` },
      { label: '冲刺速度', value: `${muscovy.charge.dashSpeed} px/s` },
      { label: '冷却', value: formatSeconds(muscovy.charge.cooldownMs) },
    ],
    lorePlaceholder: '明湖旁的番鸭也被噩梦惊动。红面瘤、黑羽与白颈是它的标记。看清蓄力方向，向侧面躲开；冲刺时仍可伤害它，也能借它的冲锋击中其他怪物。',
  })
  const cat = bundle.enemies.enemies.nightmare_cat
  entries.push({
    id: 'nightmare_cat', category: '普通敌人', name: cat.displayName, variant: '旋风型',
    role: `蓄力 ${formatSeconds(cat.vortex.windupMs)} 后原地旋转；持续伤害玩家与其他敌人，轻微吸引并偏转双方飞行子弹`,
    threatLevel: cat.threatLevel, textureKey: cat.textureKey,
    visualScale: cat.visualScale, hasArt: hasDeliveredArt(cat.textureKey),
    stats: [
      { label: '生命值', value: `${Math.max(1, Math.round(cat.hpValue * bundle.balance.baseline.bullet.damage * modifiers.enemyHp))}` },
      { label: '范围伤害', value: `${cat.vortex.damage * modifiers.enemyDamage} / ${formatSeconds(cat.vortex.damageTickMs)}` },
      { label: '伤害半径', value: `${cat.vortex.damageRadius} px` },
      { label: '旋转持续', value: formatSeconds(cat.vortex.durationMs) },
      { label: '冷却', value: formatSeconds(cat.vortex.cooldownMs) },
    ],
    lorePlaceholder: '熟悉的校园猫被梦魇裹住，化成卷动试卷的旋风。远离风圈，留心弯曲的弹道。击败后黑暗会褪去，猫咪恢复正常，穿过虚空安然离开。',
  })

  entries.push({
    id: 'first-boss', category: '首领', name: '蘑菇首领', variant: '重压首领',
    role: '校园雨后菌菇与培养皿的梦魇 · 预警后范围下砸', threatLevel: tank.threatLevel,
    textureKey: BOSS_FIRST_ART.texture, visualScale: tank.visualScale,
    hasArt: hasDeliveredArt(BOSS_FIRST_ART.texture),
    stats: [{ label: '攻击前摇', value: formatSeconds(tank.slam.windupMs) }],
    lorePlaceholder: '从校园雨后菌菇与实验培养皿中生出的重压梦魇。先观察下砸预警，再离开危险范围。它是中途首领，击败它不会提前结束整局。',
  })

  const boss = bundle.enemies.stage2Boss
  entries.push({
    id: 'stage2-boss',
    category: '首领',
    name: boss.displayName,
    variant: '第二层首领',
    role: `远程首领 · 保持 ${boss.keepDistance}px 距离并释放环形弹幕`,
    threatLevel: 5,
    textureKey: STAGE2_BOSS_ART.idle,
    visualScale: boss.visualScale,
    hasArt: hasDeliveredArt(STAGE2_BOSS_ART.idle),
    stats: [
      { label: '移动速度', value: `${boss.speed} px/s` },
      { label: '弹幕数量', value: `${boss.projectile.count} 发` },
      { label: '单发伤害', value: `${boss.projectile.damage}` },
      { label: '攻击前摇', value: formatSeconds(boss.windupMs) },
      { label: '碰撞半径', value: `${boss.radius} px` },
    ],
    lorePlaceholder: LORE_PLACEHOLDER,
  })

  entries.push({
    id: 'heart-demon', category: '首领', name: '心魔', variant: '第八层最终首领',
    role: '考研梦魇 · 试卷、倒计时与学子影子构成的最终心魔',
    threatLevel: entries.find((entry) => entry.id === 'stage2-boss')!.threatLevel,
    textureKey: FINAL_BOSS_ART.idle, visualScale: boss.visualScale,
    hasArt: hasDeliveredArt(FINAL_BOSS_ART.idle), stats: [],
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
