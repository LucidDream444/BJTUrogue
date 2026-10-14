/**
 * 角色目录与难度标签。**纯数据，零 Phaser**，node 下可直接单测。
 *
 * ---
 *
 * ## ⚠️ 角色目录是**占位**，不是设计
 *
 * 《人员分工方案》§三 把「多角色定位与差异化设计」列为 D4 的设计输出，
 * 而它**还没做**。所以这里只有 4 个占位 id 和占位文案 —— 目的是让主菜单的
 * **结构**（4 张卡、已解锁 X / N、未解锁不能选）现在就能立起来并被验证。
 *
 * 定稿之后，改这个文件即可，界面代码一行都不用动 —— 这正是把它单独放一个
 * 文件、而不是把角色名写进场景里的原因。
 *
 * 🔴 **待办（D4）**：角色定位与差异化设计 → 那时这里的 id / 名称 / 解锁条件都要换掉。
 * 需求 §4.1 草图上的「已解锁 3 / 4」是**示例值**，不是规格；真实的初始解锁数量
 * 要等角色目录与资源经济定下来。当前只有初始角色是解锁的
 * （见 `profile/defaults.ts` 的 `STARTER_CHARACTER_ID`）。
 *
 * ## 难度标签为什么要在这里再写一遍
 *
 * 难度的**枚举**归 `core/config.ts`（`DIFFICULTIES`，那边是唯一真值），
 * 这里只补中文显示名。**不复制枚举本身** —— 复制一份枚举，加难度时就会漂。
 */

import { DIFFICULTIES, type Difficulty } from '@/core/config'

export interface CharacterDef {
  id: string
  /** 卡片上的名字 */
  name: string
  /** 一句话定位。占位文案，等角色设计定稿 */
  blurb: string
  /** 未解锁时告诉玩家怎么解锁。占位文案 —— 真实的解锁条件归资源经济设计 */
  unlockHint: string
}

export const CHARACTERS: readonly CharacterDef[] = [
  {
    id: 'student',
    name: '新生',
    blurb: '均衡 · 初始角色',
    unlockHint: '（初始角色，默认解锁）',
  },
  {
    id: 'athlete',
    name: '体育生',
    blurb: '占位 · 定位待设计',
    unlockHint: '占位：解锁条件待设计',
  },
  {
    id: 'scholar',
    name: '图书委员',
    blurb: '占位 · 定位待设计',
    unlockHint: '占位：解锁条件待设计',
  },
  {
    id: 'leader',
    name: '社团长',
    blurb: '占位 · 定位待设计',
    unlockHint: '占位：解锁条件待设计',
  },
]

/** 难度 → 中文。需求 §4.1：「简单 / 普通 / 困难」。 */
export const DIFFICULTY_LABELS: Readonly<Record<Difficulty, string>> = {
  easy: '简单',
  normal: '普通',
  hard: '困难',
}

/** 主菜单里难度的展示顺序（普通在中间，与草图一致） */
export const DIFFICULTY_ORDER: readonly Difficulty[] = DIFFICULTIES

export function characterById(id: string): CharacterDef | undefined {
  return CHARACTERS.find((c) => c.id === id)
}

/**
 * MVP 唯一的技能 id。技能目录归 D4，但**只有这一个**是按演示需要定下来的：
 * 加攻速。真正的技能设计（一个角色可选多个技能、技能效果由谁结算）等下一版。
 * 数值在 `public/config/meta.json`。
 */
export const STARTER_SKILL_ID = 'rapid_fire'
