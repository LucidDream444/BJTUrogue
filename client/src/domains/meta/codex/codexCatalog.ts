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
  type ConfigBundle,
  type Difficulty,
} from '@/core/config'
import { ANIMS, STAGE2_BOSS_ART, findAsset } from '@/core/assetManifest'

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
 * 第二层首领已经有配置和资源 key，也纳入图鉴；第一层 / 最终首领目前没有
 * 独立配置，等 D3 的配置落地后会自动从这里获得接入位置。
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
