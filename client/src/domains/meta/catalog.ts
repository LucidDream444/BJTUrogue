/**
 * 角色目录与难度标签。**纯数据，零 Phaser**，node 下可直接单测。
 *
 * ---
 *
 * 三个角色各有独立战斗身份：新生偏续航、大鹅偏机动、图书委员偏能量循环。
 * 具体战斗修正值在 `meta.json`；这里只放卡片文案与解锁提示，避免两份数值漂移。
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
    blurb: '稳扎稳打 · 更耐打',
    unlockHint: '（初始角色，默认解锁）',
  },
  {
    id: 'athlete',
    name: '大鹅',
    blurb: '鹅步生风 · 高机动',
    unlockHint: '在「查看升级」中解锁大鹅',
  },
  {
    id: 'scholar',
    name: '图书委员',
    blurb: '馆藏检索 · 快速回能',
    unlockHint: '在「查看升级」中解锁图书委员',
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
