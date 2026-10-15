/**
 * 「本局当前状态」的快照 —— 暂停菜单右侧那栏要显示的东西（需求 §4.3）。
 *
 * ## 为什么是快照，而不是让暂停菜单去问各个系统
 *
 * 暂停面板要显示的是**这一局**的血量 / 护盾 / 能量 / 武器 / 技能，
 * 而这些归 D1（战斗域）。如果菜单自己去读玩家的血、去翻武器表，那它就和战斗域的
 * 内部结构绑死了 —— 而《人员分工方案》§四 要求域之间只走事件总线或明确的接口。
 *
 * 所以这里是**一个数据形状 + 一个由宿主提供的取数函数**（`PauseHost.snapshot()`）：
 * D4 定形状和画法，D1 负责填。
 *
 * ## 为什么一半字段是可选的
 *
 * 需求草图上画了「护盾值 30 / 40、能量值 40 / 80」，但**当前没有任何配置表定义它们**
 * （`balance.json` 里玩家只有 `maxHp`），武器表与技能系统也都还没定稿。
 *
 * 所以这些字段是 `?`：宿主拿不出来就不传，界面显示「—」。
 * **不编一个 0** —— `0 / 0` 看起来像"玩家血空了"，而「—」才是"这项还没做"。
 */

export interface RunSnapshot {
  /** 角色 id。目录里找不到时界面直接显示这个 id（比显示空白强） */
  characterId: string
  hp: number
  maxHp: number

  /* ---- 下面这些当前没有来源，宿主给得出才传 ---- */
  shield?: number
  maxShield?: number
  magic?: number
  maxMagic?: number
  /** 装备的技能名。技能系统还没定稿，且"技能效果归谁"仍未拍板 */
  skillName?: string
  /** 当前武器名。武器表归 D1，还没起草 */
  weaponName?: string
}

/**
 * 假快照。**给测试场用**，不是产品数据 —— 它的作用是让暂停面板上每一项都有东西
 * 可显示，从而"某一项没接上"不会被误当成"已接上"。
 *
 * 数值本身就用需求草图上的那几个（120 / 30 / 40），方便对照。
 */
export function placeholderRunSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    characterId: 'student',
    hp: 120,
    maxHp: 120,
    shield: 30,
    maxShield: 40,
    magic: 40,
    maxMagic: 80,
    skillName: '（占位）尚未装备',
    weaponName: '（占位）示例武器',
    ...overrides,
  }
}
