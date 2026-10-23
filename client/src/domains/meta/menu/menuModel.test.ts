/**
 * 主菜单的规则。**跑在 node 环境** —— 这些规则如果只能靠"在浏览器里点一下看看"，
 * 那它们就不是规则，而是手感。
 *
 * 挑的都是**坏掉时不像 bug** 的东西：
 *
 * | 坏了的样子 | 对应用例 |
 * |---|---|
 * | 未解锁的角色能被选中（或者点了没反应、也没提示） | 解锁门禁 |
 * | 「已解锁 4 / 3」—— 档里带着未来版本的 id | 计数与目录求交集 |
 * | 焦点越界之后按方向键就卡死 | 焦点环绕 |
 * | 关掉弹层时把提示也带进去了 / 主菜单上按 Esc 把界面关了 | 弹层开关 |
 */

import { describe, expect, it } from 'vitest'
import { CHARACTERS } from '../catalog'
import { createDefaultProfile } from '../profile/defaults'
import type { ProfileData } from '../profile/types'
import {
  MENU_ACTIONS,
  closeScreen,
  createMenuState,
  focusedAction,
  isUnlocked,
  moveFocus,
  openScreen,
  trySelectCharacter,
  unlockedCount,
  withNotice,
} from './menuModel'

/** 一份改过的档（不动默认档，那只读不写） */
function profileWith(mutate: (p: ProfileData) => void): ProfileData {
  const p = createDefaultProfile()
  mutate(p)
  return p
}

describe('焦点', () => {
  it('默认焦点在「开始闯关」（需求 §4.1）', () => {
    expect(createMenuState().focusIndex).toBe(0)
    expect(focusedAction(createMenuState())).toBe('start')
    expect(MENU_ACTIONS[0]).toBe('start')
  })

  it('可以从结算直接以升级页作为初始屏', () => {
    const state = createMenuState('upgrade')
    expect(state.screen).toBe('upgrade')
    expect(state.focusIndex).toBe(0)
  })

  it('「怪物图鉴」紧跟在「查看操作说明」之后，退出仍是末项', () => {
    expect(MENU_ACTIONS).toEqual(['start', 'upgrade', 'help', 'codex', 'quit'])
  })

  it('往上越过第一项会绕到最后一项，而不是卡住', () => {
    const state = moveFocus(createMenuState(), -1)
    expect(state.focusIndex).toBe(MENU_ACTIONS.length - 1)
    expect(focusedAction(state)).toBe('quit')
  })

  it('往下绕回第一项', () => {
    let state = createMenuState()
    for (let i = 0; i < MENU_ACTIONS.length; i++) state = moveFocus(state, 1)
    expect(state.focusIndex).toBe(0)
  })

  it('移动焦点会清掉上一次的提示（否则「未解锁」会挂在新选项上）', () => {
    const state = withNotice(createMenuState(), '未解锁：xxx')
    expect(moveFocus(state, 1).notice).toBe('')
  })
})

describe('弹层开关（需求 §4.6）', () => {
  it('打开弹层会清掉提示', () => {
    const state = openScreen(withNotice(createMenuState(), '未解锁'), 'help')
    expect(state.screen).toBe('help')
    expect(state.notice).toBe('')
  })

  it('关掉弹层回主菜单', () => {
    const state = openScreen(createMenuState(), 'settings')
    expect(closeScreen(state)?.screen).toBe('main')
  })

  it('关掉弹层时**清掉提示** —— 否则它会盖住主菜单底部的「当前选择」', () => {
    const state = withNotice(openScreen(createMenuState(), 'upgrade'), '已解锁：大鹅')
    expect(closeScreen(state)?.notice).toBe('')
  })

  it('主菜单是顶层：按 Esc 没人接（返回 null，调用方自己决定做什么）', () => {
    expect(closeScreen(createMenuState())).toBeNull()
  })
})

describe('解锁门禁（需求 §4.1：未解锁不能被选中）', () => {
  it('默认档里只有初始角色是解锁的', () => {
    const p = createDefaultProfile()
    const { unlocked, total } = unlockedCount(p)
    expect(total).toBe(CHARACTERS.length)
    expect(unlocked).toBe(1)
    expect(isUnlocked(p, 'student')).toBe(true)
  })

  it('选未解锁的角色：不切换，并且**明确说"未解锁"**', () => {
    const p = createDefaultProfile()
    const locked = CHARACTERS.find((c) => !isUnlocked(p, c.id))!
    const result = trySelectCharacter(p, locked.id)
    expect(result.ok).toBe(false)
    expect(result.notice).toContain('未解锁')
  })

  it('选已解锁的角色：放行', () => {
    expect(trySelectCharacter(createDefaultProfile(), 'student')).toEqual({ ok: true, notice: '' })
  })

  it('目录里没有的 id：拒绝，而且提示要带上那个 id（好查是谁写错字）', () => {
    const result = trySelectCharacter(createDefaultProfile(), '不存在的角色')
    expect(result.ok).toBe(false)
    expect(result.notice).toContain('不存在的角色')
  })

  it('角色目录现在只有三个角色，社团长已移除', () => {
    expect(CHARACTERS.map((c) => c.id)).toEqual(['student', 'athlete', 'scholar'])
  })
})

describe('已解锁计数', () => {
  it('档里带着未来版本的 id 时，不会显示成「4 / 3」', () => {
    const p = profileWith((d) => {
      d.unlocks.characters.push('来自未来版本的角色', '另一个未来的角色')
    })
    const { unlocked, total } = unlockedCount(p)
    expect(unlocked).toBe(1) // 目录里只认得 student
    expect(total).toBe(3)
  })

  it('解锁了目录里的第二个角色，计数跟着走', () => {
    const p = profileWith((d) => {
      d.unlocks.characters.push('athlete')
    })
    expect(unlockedCount(p).unlocked).toBe(2)
    expect(trySelectCharacter(p, 'athlete').ok).toBe(true)
  })
})
