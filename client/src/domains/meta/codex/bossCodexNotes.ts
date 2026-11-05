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

export function bossSkillNotes(
  table: CodexBossSkillTable | undefined,
  floor: number,
  damageMultiplier: number,
): readonly string[] {
  const boss = table?.bosses[String(floor)]
  if (!boss) return []
  const seconds = (ms: number): string => `${Number((ms / 1000).toFixed(2))} 秒`
  return boss.skills.map((skill, index) => {
    const n = (key: string): number => typeof skill[key] === 'number' ? skill[key] as number : 0
    const damage = (): number => Math.round(n('damage') * damageMultiplier)
    const suffix = `（冷却 ${seconds(n('cooldownMs'))}）`
    let text: string
    switch (skill.id) {
      case 'campus_slow':
        text = `全场减速：玩家、首领与所有小怪移动速度 ×${n('speedMultiplier')}，持续 ${seconds(n('durationMs'))}。`
        break
      case 'paper_summon':
        text = `突击召集：每 ${seconds(n('spawnIntervalMs'))} 召来一只纸团，共 ${n('countMin')}～${n('countMax')} 只，无视通常的小怪数量上限；施放时场上纸团超过 ${n('maxExisting')} 只则跳过。`
        break
      case 'radial':
        text = `环形弹幕：预警 ${seconds(n('windupMs'))} 后发射 ${n('count')} 发子弹，每发 ${damage()} 点伤害，弹速 ${n('projectileSpeed')} px/s、半径 ${n('projectileRadius')} px、存在 ${seconds(n('lifetimeMs'))}，每轮错开 ${n('volleyOffsetDeg')}°。`
        break
      case 'triangle':
        text = `三角瞬移：连续瞬移 ${n('teleportCount')} 次，间隔 ${seconds(n('teleportIntervalMs'))}；留下的三点以宽 ${n('lineWidth')} px 的连线围成三角。连线预警 ${seconds(n('warningMs'))}，持续 ${seconds(n('lineDurationMs'))}；触碰的玩家与其他敌人每 ${seconds(n('damageTickMs'))} 受 ${damage()} 点伤害，施法者自身豁免，时间结束消失。`
        break
      case 'haste':
        text = `急速飞行：移动速度 ×${n('speedMultiplier')}，持续 ${seconds(n('durationMs'))}。`
        break
      case 'acid_pools':
        text = `酸液喷灌：随机生成 ${n('count')} 处半径 ${n('radius')} px 的大酸池，预警 ${seconds(n('warningMs'))}、存在 ${seconds(n('lifetimeMs'))}；池内每 ${seconds(n('damageTickMs'))} 受 ${damage()} 点持续伤害。刷新间隔短于酸池寿命，场上可叠存。`
        break
      case 'water_pools':
        text = `积水滑行：随机生成 ${n('count')} 处半径 ${n('radius')} px 水圈，预警 ${seconds(n('warningMs'))}、存在 ${seconds(n('lifetimeMs'))}；踩入后沿当时的移动方向以 ${n('slideSpeed')} px/s 强制直线滑出，最多 ${seconds(n('maxSlideMs'))}。刷新间隔短于水圈寿命，留意下一处积水。`
        break
      case 'ricochet_charge':
        text = `无敌乱撞：预警 ${seconds(n('warningMs'))} 后以 ${n('speed')} px/s 向随机方向冲撞，期间无敌。碰到障碍会随机换向，反弹 ${n('bounceCount')} 次停止，最长 ${seconds(n('maxDurationMs'))}；碰撞半径 ${n('hitRadius')} px，每 ${seconds(n('damageTickMs'))} 可造成 ${damage()} 点伤害。`
        break
      case 'leap_slam':
        text = `跳跃重砸：玩家附近出现 ${seconds(n('warningMs'))} 落点预警，起跳 ${seconds(n('flightMs'))} 后落地；半径 ${n('radius')} px 内玩家与其他敌人受到 ${damage()} 点伤害，并眩晕 ${seconds(n('stunMs'))}，施法者自身豁免。`
        break
      case 'clones':
        text = `分身点名：生成 ${n('count')} 个外观相同的分身，每个生命为首领施放时当前生命的 1/${n('hpDivisor')}，首领随机藏入其中一个。真分身所受伤害会传给首领，假分身受伤不影响首领生命。击破藏身分身立即结束技能并使首领眩晕 ${seconds(n('bossStunMs'))}；分身最多存在 ${seconds(n('durationMs'))}。`
        break
      case 'transmute':
        text = `全场变形：预警 ${seconds(n('warningMs'))} 后，所有小怪统一变成随机抽取的同一种怪物，保留各自当前生命比例。首领身份保持不变。`
        break
      case 'rally':
        text = `魔性笑声：召集全场小怪追击玩家，移动速度 ×${n('speedMultiplier')}，持续 ${seconds(n('durationMs'))}。`
        break
      case 'blue_barrage':
        text = `蓝色环弹：连续 ${n('roundsMin')}～${n('roundsMax')} 轮，每轮间隔 ${seconds(n('roundIntervalMs'))}；每轮 ${n('count')} 发，每发 ${damage()} 点伤害，弹速 ${n('projectileSpeed')} px/s、半径 ${n('projectileRadius')} px、存在 ${seconds(n('lifetimeMs'))}。`
        break
      case 'mimic_chain':
        text = `梦魇模仿：从前六位首领（${n('sourceFloorMin')}～${n('sourceFloorMax')} 层）的技能中连续随机施放 ${n('count')} 个，间隔 ${seconds(n('intervalMs'))}；施放时变成对应首领的黑色形态，机制与伤害参照对应战斗笔记。`
        break
      case 'rewind':
        text = `红色倒带：预告与静止动画持续 ${seconds(n('durationMs'))}，画面泛红并有嘀嗒节拍，期间玩家不能移动；将仍然存活的敌人位置与生命回溯到 ${seconds(n('historyMs'))} 前，不复活已经死亡的敌人。`
        break
      case 'player_shadow':
        text = `巨大倒影：变成玩家当前形态的 ${n('visualScale')} 倍黑白影子，快照当前武器并追踪射击 ${seconds(n('durationMs'))}；追击速度 ${n('followSpeed')} px/s、保持约 ${n('keepDistance')} px 距离，武器伤害 ×${n('weaponDamageMultiplier')}、攻击间隔 ×${n('attackIntervalMultiplier')}。`
        break
      default:
        text = '技能记录正在整理。'
    }
    return `技能 ${index + 1} · ${text}${suffix}`
  })
}
