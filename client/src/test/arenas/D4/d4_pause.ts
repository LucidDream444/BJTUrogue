/**
 * D4 —— 暂停菜单的宿主场。**这个场子验的是"暂停真的停住了"。**
 *
 * 它是 `PauseOverlay` 的第一个宿主，示范了《人员分工方案》§四 那种接法：
 * D4 出界面，**暂停语义由宿主给**（这里就是"时钟 + 物理世界一起停"）。
 * D1 的战斗场景接进来时照抄这个 `host` 对象即可。
 *
 * ## 该看什么
 *
 * | 看什么 | 怎么确认 |
 * |---|---|
 * | 暂停真的停了 | 打开菜单后，HUD 第 1 行 `frame` 不再涨、第 2 行 `steps` 不再涨，并出现 `PAUSED` / `⚠️ PHYSICS PAUSED` |
 * | 敌人真的停了 | 屏幕上那几只怪一动不动（不是"AI 还在跑但没落实到速度上"——那种情况 HUD 会标 `一只都没动`，而这里的 `moving` 仍然是原值） |
 * | 弹层里的东西能点 | 四个按钮、音量滑杆、说明 / 设置 / 返回主菜单三个子弹层 |
 * | 音量能与主菜单同步 | 这里拖的是档里的 `bgmVolume`，去 `?arena=d4_main_menu` 的设置里能看到同一个值 |
 *
 * ## ⚠️ 这一场不验什么（说清楚，免得当成 bug）
 *
 * **假玩家的移动不受暂停影响。** `DummyPlayer` 是测试设施，它按渲染帧 delta 走，
 * 压根不看 `GameClock`。产品里 D1 的玩家必须自己判断 `clock.paused` 来停输入 ——
 * 这条已经在 `docs/UI规范.md` 里写明，是给 D1 的接口提醒，不是这里漏了。
 *
 * ## 为什么能直接接管 Esc 和空格
 *
 * 底座拿 Esc 当"回测试场菜单"、拿空格当它自己的暂停开关。这个场子要验的
 * Esc 语义是"**继续游戏**"（需求 §4.3），两者同时生效就会"按一下跳两层"。
 * 所以这里先把底座的监听摘掉（`off(事件名)` 会清掉那个事件上的全部监听），
 * 再绑 `PauseOverlay` 的入口。**同一个按键只能有一个入口** —— 见 `PauseOverlay` 文件头。
 */

import Phaser from 'phaser'
import type { ArenaConfig, ArenaContext, ArenaDefinition } from '../../ArenaBase'
import { ArenaBase, WORLD_HEIGHT, WORLD_WIDTH } from '../../ArenaBase'
import { MENU_SCENE_KEY } from '../../arenaCatalog'
import { PauseOverlay } from '@/domains/meta/pause/PauseOverlay'
import { placeholderRunSnapshot } from '@/domains/meta/pause/runSnapshot'
import { ProfileStore } from '@/domains/meta/profile/ProfileStore'
import { LocalStorageProfileStorage } from '@/domains/meta/profile/storage'

class D4PauseArena extends ArenaBase {
  private overlay!: PauseOverlay
  private store!: ProfileStore

  protected get definition(): ArenaDefinition {
    return arena
  }

  protected configure(): ArenaConfig {
    // **场上必须有会动的东西**，否则"暂停后不动了"这句话没法验证 ——
    // 一个空场子加上暂停，看起来和"敌人系统没接上"一模一样。
    return {
      spawns: [
        { kind: 'splitter', gen: 0, count: 2, x: WORLD_WIDTH / 2 - 320, y: WORLD_HEIGHT / 2 - 120 },
        { kind: 'splitter', gen: 1, count: 3, x: WORLD_WIDTH / 2 + 320, y: WORLD_HEIGHT / 2 - 120 },
        { kind: 'tank', gen: 0, count: 1, x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 + 200 },
      ],
      spawnGraceMs: 3000,
    }
  }

  protected override onArenaCreate(ctx: ArenaContext): void {
    this.store = new ProfileStore({ storage: new LocalStorageProfileStorage() })
    this.store.load()

    this.overlay = new PauseOverlay({
      scene: ctx.scene,
      store: this.store,
      host: {
        // ⚠️ **两件事必须一起做**：冻结逻辑时钟 + 暂停物理世界。
        // 只冻时钟的话，物理积分、子弹位移、sprite 位置照常推进 ——
        // 画面动、逻辑不动，那种不一致比"没暂停"更难查。
        // （`world.pause()` 而不是 `world.timeScale = 0`：后者会让
        // `while (_elapsed >= msPerFrame)` 永不退出，直接把浏览器卡死，见 core/time.ts。）
        pause: () => {
          ctx.clock.pause()
          this.physics.world.pause()
        },
        resume: () => {
          ctx.clock.resume()
          this.physics.world.resume()
        },
        quitToMenu: () => this.scene.start(MENU_SCENE_KEY),
        // 假快照 + 真实血量：血量取假玩家的真值，所以"血量会变"看得见；
        // 护盾 / 能量 / 武器 / 技能当前没有任何来源，用占位值，界面会照实显示。
        snapshot: () =>
          placeholderRunSnapshot({
            characterId: this.store.profile.selected.characterId,
            hp: Math.round(ctx.player.hp),
            maxHp: ctx.player.maxHp,
          }),
      },
    })

    const kb = ctx.scene.input.keyboard
    if (kb) {
      // 先把底座在这个键上的监听摘掉，再绑我们自己的 —— 见文件头。
      kb.off('keydown-ESC')
      kb.off('keydown-SPACE')
      kb.addCapture(['ESC', 'SPACE', 'UP', 'DOWN', 'ENTER'])
      kb.on('keydown-ESC', () => this.overlay.handleToggleKey())
      kb.on('keydown-SPACE', () => this.overlay.handleToggleKey())
      kb.on('keydown-UP', () => this.overlay.handleMoveFocus(-1))
      kb.on('keydown-DOWN', () => this.overlay.handleMoveFocus(1))
      kb.on('keydown-ENTER', () => this.overlay.handleActivate())
    }

    this.hud.setNotice('Esc / 空格 = 暂停菜单（菜单里 Esc = 继续游戏）')

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.overlay.destroy())

    // 白箱调试钩子（只在测试场里）。验证脚本靠它读场景状态、派发真鼠标事件。
    ;(window as unknown as { __whitebox?: unknown }).__whitebox = { game: this.game }
  }
}

export const arena: ArenaDefinition = {
  displayName: 'D4 暂停菜单',
  description:
    '暂停必须真的停住：先打几枪、看 HUD 的 frame/steps 在涨，再按 Esc —— 它们应该都不动了。菜单里试四个按钮、音量滑杆、以及返回主菜单的二次确认。',
  scene: D4PauseArena,
}
