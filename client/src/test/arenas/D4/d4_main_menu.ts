/**
 * D4 —— 主菜单的宿主场。**这个场子自己不画菜单**：它把 D4 的产品场景
 * （`domains/meta/scenes/MainMenuScene.ts`）挂起来，然后让开。
 *
 * ## 为什么要这样，而不是把菜单直接写成一个测试场
 *
 * 需求 §4.1 的主菜单是**产品功能**，不是调试设施。写成测试场的话，
 * 它就不能被 `main.ts` 用了 —— 而测试场是明确禁止被产品依赖的（`AGENTS.md` §五）。
 *
 * 所以分工是：产品场景住在 `domains/meta/`，这个场子只负责**给它一个运行环境**
 * （把底座的白箱画面藏起来、把键盘让出来、把 `onExit` 传进去）。
 * 于是主菜单从第一天起就能单独打开验证，不必等 `main.ts` 接场景、
 * 也不必等 D1 的战斗场景。
 *
 * ## 让位这一步具体做了什么
 *
 * | 做的事 | 不做的话会怎样 |
 * |---|---|
 * | `this.scene.setVisible(false)` | 底座的白箱网格与 HUD 和菜单叠在一起，看不清 |
 * | `input.keyboard.enabled = false` | **两边抢键盘**：按 Esc 会同时关弹层和跳回测试场菜单 |
 *
 * 第二条是 Phaser 官方文档给的隔离方式（`KeyboardPlugin` 的类注释：
 * 「with multiple parallel Scenes, each trying to get keyboard input …
 * you can do this with `this.input.keyboard.enabled = false`」）。
 * 不隔离的话，症状是"按一下 Esc 跳了两层"——看起来像键盘处理写重了。
 */

import type { ArenaConfig, ArenaContext, ArenaDefinition } from '../../ArenaBase'
import { ArenaBase } from '../../ArenaBase'
import { MENU_SCENE_KEY } from '../../arenaCatalog'
import { MAIN_MENU_SCENE_KEY, MainMenuScene } from '@/domains/meta/scenes/MainMenuScene'

class D4MainMenuArena extends ArenaBase {
  /** 让位只做一次。`onArenaUpdate` 每帧都会进来 */
  private handedOff = false

  protected get definition(): ArenaDefinition {
    return arena
  }

  protected configure(): ArenaConfig {
    // 空场子：主菜单是全屏 UI，场上不需要任何敌人或墙。
    return {}
  }

  protected override onArenaCreate(_ctx: ArenaContext): void {
    // 从测试场菜单**第二次**进这个场子时，Phaser 复用同一个场景实例，
    // 所以上次留下的"已让位 / 已隐藏"必须在这里复位 —— 不复位的话第二次进来是黑屏。
    this.handedOff = false
    this.scene.setVisible(true)
    this.hud.setNotice('这是产品场景（MainMenuScene）在跑，不是测试场画的')
  }

  protected override onArenaUpdate(_dtMs: number, _ctx: ArenaContext): void {
    if (this.handedOff) return
    this.handedOff = true
    this.handOff()
  }

  private handOff(): void {
    // 等第一帧再让位：`onArenaCreate` 还跑在底座 `create()` 的中间，
    // 那时把场景藏起来，底座后面几步会往一个不可见的场景上继续加对象。
    if (this.input.keyboard) this.input.keyboard.enabled = false
    this.scene.setVisible(false)

    this.scene.add(MAIN_MENU_SCENE_KEY, MainMenuScene, true, {
      // 「回上一层」：主菜单是产品里的顶层，所以这个出口由**宿主**提供。
      // 产品里 `main.ts` 不会传它（见 MainMenuScene 的 `MainMenuData.onExit`）。
      onExit: () => {
        this.scene.setVisible(true)
        this.scene.start(MENU_SCENE_KEY)
      },
    })

    // 白箱调试钩子。**只在测试场里存在**，产品代码一行都不碰。
    // 它让"按钮点得中吗""弹层开没开"这类**静态检查看不见**的问题可以在
    // 浏览器里被读出来，而不是只能靠人眼看着截图猜。
    ;(window as unknown as { __whitebox?: unknown }).__whitebox = { game: this.game }
  }
}

export const arena: ArenaDefinition = {
  displayName: 'D4 主菜单',
  description:
    '产品场景 MainMenuScene 在跑（不是白箱画的）。看：角色卡解锁门禁、难度三选一、设置弹层里的音量滑杆与档同步，以及「怪物图鉴」的配置数值、动画预览和档案文案占位。Esc 关弹层，主菜单上再按 Esc 回测试场菜单。',
  scene: D4MainMenuArena,
}
