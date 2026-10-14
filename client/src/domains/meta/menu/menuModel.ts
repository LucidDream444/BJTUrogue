/**
 * 主菜单的**状态与规则**（纯逻辑）。**零 Phaser、零 DOM** —— 跑在 node 下，
 * 因为「未解锁的角色不能被选中」这种规则如果和渲染缠在一起，就只能靠人眼看。
 *
 * 场景（`scenes/MainMenuScene.ts`）只做两件事：把这个状态画出来、把按键喂进来。
 *
 * ## 为什么解锁判定要在这里、而不是在场景里
 *
 * 需求 §4.1 的控件表写得很具体：**未解锁的角色不能被选中**，而且
 * 「点击未解锁卡：不切换，提示『未解锁』」。这两条是一个**规则**，
 * 不是画面：如果写在场景里，将来暂停菜单、结算界面里再出现角色卡，
 * 同样的判定就得再写一遍 —— 而两处写同一个规则，迟早只剩一处是对的。
 *
 * ## 已解锁计数为什么要和目录求交集
 *
 * 玩家的档里可能存着**本版不认识的**角色 id（来自更新的版本，见 `profile/types.ts`
 * 关于「看不懂的档不覆盖」的说明）。所以「已解锁 3 / 4」的 3 必须是
 * **目录里认识的、且已解锁的**数量 —— 拿 `unlocks.characters.length` 直接当 3 的话，
 * 一个来自未来的 id 会让它显示成 6 / 4。
 */

import { CHARACTERS, characterById, type CharacterDef } from '../catalog'
import type { ProfileData } from '../profile/types'

/** 主菜单左栏的四个按钮，顺序就是草图里的顺序 */
export const MENU_ACTIONS = ['start', 'upgrade', 'help', 'quit'] as const
export type MenuAction = (typeof MENU_ACTIONS)[number]

export const MENU_ACTION_LABELS: Readonly<Record<MenuAction, string>> = {
  start: '开始闯关',
  upgrade: '查看升级',
  help: '查看操作说明',
  quit: '退出',
}

/**
 * 当前显示哪一屏。`main` 是主菜单本体，其余三个是盖在它上面的弹层
 * （需求 §4.6 的页面关系图里，这三个都是从主菜单出去的）。
 *
 * 用**一个字段**而不是三个布尔：三个布尔能有 8 种组合，其中 5 种是"两个弹层
 * 同时开着"这种不合法状态 —— 那种状态迟早会出现，而且只在某个边角操作里出现。
 */
export type MenuScreen = 'main' | 'help' | 'settings' | 'confirm-quit'

export interface MenuState {
  screen: MenuScreen
  /** 左栏里哪个按钮有键盘焦点。**默认在「开始闯关」**（需求 §4.1） */
  focusIndex: number
  /** 一行提示（"未解锁"之类）。空串 = 不显示 */
  notice: string
}

export function createMenuState(): MenuState {
  return { screen: 'main', focusIndex: 0, notice: '' }
}

/** 焦点上下移动，**到头绕回**。越界不报错是因为按住方向键连按到底很常见。 */
export function moveFocus(state: MenuState, delta: number): MenuState {
  const count = MENU_ACTIONS.length
  const next = (((state.focusIndex + delta) % count) + count) % count
  return { ...state, focusIndex: next, notice: '' }
}

export function focusedAction(state: MenuState): MenuAction {
  return MENU_ACTIONS[state.focusIndex] ?? MENU_ACTIONS[0]
}

export function openScreen(state: MenuState, screen: MenuScreen): MenuState {
  return { ...state, screen, notice: '' }
}

/**
 * 关掉弹层回到主菜单。
 *
 * ⚠️ **只有弹层开着的时候才有效** —— 主菜单是顶层，在主菜单上按 Esc 什么都不该发生。
 * （需求 §4.6 里 Esc 的作用是"关闭弹层 / 返回上一层"，而主菜单没有上一层。）
 * 返回 `null` 表示"这一下 Esc 没人接"，调用方据此决定要不要做别的（比如
 * 测试场的宿主把 Esc 当成"回测试场菜单"）。
 */
export function closeScreen(state: MenuState): MenuState | null {
  if (state.screen === 'main') return null
  return { ...state, screen: 'main' }
}

export function withNotice(state: MenuState, notice: string): MenuState {
  return { ...state, notice }
}

// ------------------------------------------------------------------ 解锁

/** 目录里认识的、且玩家已解锁的角色 */
export function unlockedCharacters(profile: ProfileData): CharacterDef[] {
  return CHARACTERS.filter((c) => profile.unlocks.characters.includes(c.id))
}

/**
 * 「已解锁 X / N」。
 *
 * N 是**目录长度**、X 是目录与档的交集大小 —— 档里那些本版不认识的 id
 * 不计入 X，否则会出现 6 / 4 这种读数（见文件头）。
 */
export function unlockedCount(profile: ProfileData): { unlocked: number; total: number } {
  return { unlocked: unlockedCharacters(profile).length, total: CHARACTERS.length }
}

export function isUnlocked(profile: ProfileData, id: string): boolean {
  return profile.unlocks.characters.includes(id)
}

export interface SelectResult {
  /** 允许切换吗 */
  ok: boolean
  /** 给界面用的一行提示。`ok` 时是空的 */
  notice: string
}

/**
 * 玩家点了一张角色卡。**这是需求 §4.1 那条规则的唯一实现处：
 * 「点击未解锁卡：不切换，提示『未解锁』」。**
 *
 * 返回结论而不是直接改档：调用方才知道"改档"要走 `ProfileStore`
 * （而且改档可能失败 —— 存储满的时候，选择仍然要生效，只是没存上）。
 */
export function trySelectCharacter(profile: ProfileData, id: string): SelectResult {
  const def = characterById(id)
  if (!def) return { ok: false, notice: `没有这个角色：${id}` }
  if (!isUnlocked(profile, id)) return { ok: false, notice: `未解锁：${def.unlockHint}` }
  return { ok: true, notice: '' }
}
