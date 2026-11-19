/** 首领技能配置在图鉴中的只读投影；不依赖战斗域。 */
export interface CodexBossSkill {
  id: string
  [key: string]: string | number | boolean
}

export interface CodexBossSkillTable {
  schemaVersion: number
  bosses: Record<string, {
    id: string
    name: string
    skillIntervalMs: number
    skills: CodexBossSkill[]
  }>
}

export function codexBossSkillConfig(raw: unknown): CodexBossSkillTable | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const table = raw as Partial<CodexBossSkillTable>
  if (table.schemaVersion !== 1 || !table.bosses || typeof table.bosses !== 'object') return undefined
  for (let floor = 2; floor <= 8; floor++) {
    const boss = table.bosses[String(floor)]
    if (!boss || typeof boss.id !== 'string' || typeof boss.name !== 'string' || !Array.isArray(boss.skills)) return undefined
    if (!Number.isFinite(boss.skillIntervalMs) || boss.skillIntervalMs <= 0) return undefined
    for (const skill of boss.skills) {
      if (!skill || typeof skill !== 'object' || typeof skill.id !== 'string' || Object.values(skill).some((value) =>
        !['number', 'string', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value)))) return undefined
    }
  }
  return table as CodexBossSkillTable
}

/**
 * 首领技能的战斗笔记。**每条只保留一句核心机制 + 关键数值**，
 * 整个首领一页内看完；英文/数字两侧不留空格（用户 2026-11-20 要求）。
 */
export function bossSkillNotes(
  table: CodexBossSkillTable | undefined,
  floor: number,
  damageMultiplier: number,
): readonly string[] {
  const boss = table?.bosses[String(floor)]
  if (!boss) return []
  const seconds = (ms: number): string => `${Number((ms / 1000).toFixed(2))}秒`
  return boss.skills.map((skill, index) => {
    const n = (key: string): number => typeof skill[key] === 'number' ? skill[key] as number : 0
    const damage = (): number => Math.round(n('damage') * damageMultiplier)
    const suffix = `（冷却${seconds(n('cooldownMs'))}）`
    let text: string
    switch (skill.id) {
      case 'campus_slow':
        text = `全场减速：玩家与所有怪物速度×${n('speedMultiplier')}，持续${seconds(n('durationMs'))}。`
        break
      case 'paper_summon':
        text = `召集${n('countMin')}～${n('countMax')}只纸团，每${seconds(n('spawnIntervalMs'))}一只，无视小怪上限。`
        break
      case 'radial':
        text = `预警${seconds(n('windupMs'))}后发射${n('count')}发环形弹幕，每发${damage()}点伤害。`
        break
      case 'triangle':
        text = `连续瞬移${n('teleportCount')}次并留下三角连线；触碰者每${seconds(n('damageTickMs'))}受${damage()}点伤害。`
        break
      case 'haste':
        text = `移动速度×${n('speedMultiplier')}，持续${seconds(n('durationMs'))}。`
        break
      case 'acid_pools':
        text = `生成${n('count')}处酸池，存在${seconds(n('lifetimeMs'))}；池内每${seconds(n('damageTickMs'))}受${damage()}点伤害。`
        break
      case 'water_pools':
        text = `生成${n('count')}处水圈；踩入后强制直线滑出${n('slideSpeed')}px/s，最多${seconds(n('maxSlideMs'))}。`
        break
      case 'ricochet_charge':
        text = `预警${seconds(n('warningMs'))}后无敌冲撞，碰墙反弹${n('bounceCount')}次，碰撞造成${damage()}点伤害。`
        break
      case 'leap_slam':
        text = `预警${seconds(n('warningMs'))}后跃击；落点半径${n('radius')}px内造成${damage()}点伤害并眩晕${seconds(n('stunMs'))}。`
        break
      case 'clones':
        text = `生成${n('count')}个分身，真身藏其中；击破真身使首领眩晕${seconds(n('bossStunMs'))}。`
        break
      case 'transmute':
        text = `预警${seconds(n('warningMs'))}后全场小怪变成同一种随机怪物。`
        break
      case 'rally':
        text = `召集全场小怪追击玩家，速度×${n('speedMultiplier')}，持续${seconds(n('durationMs'))}。`
        break
      case 'blue_barrage':
        text = `连续${n('roundsMin')}～${n('roundsMax')}轮蓝色环弹，每轮${n('count')}发，每发${damage()}点伤害。`
        break
      case 'mimic_chain':
        text = `随机借用前六位首领的技能${n('count')}次，间隔${seconds(n('intervalMs'))}。`
        break
      case 'rewind':
        text = `画面泛红、玩家不能移动${seconds(n('durationMs'))}；存活敌人回到${seconds(n('historyMs'))}前的位置与生命。`
        break
      case 'player_shadow':
        text = `变成${n('visualScale')}倍黑白影子，复制当前武器追踪射击${seconds(n('durationMs'))}。`
        break
      default:
        text = '技能记录正在整理。'
    }
    return `技能${index + 1}·${text}${suffix}`
  })
}
