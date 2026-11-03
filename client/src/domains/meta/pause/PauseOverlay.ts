/**
 * 暂停菜单（需求 §4.3）。**它是一个可复用组件，不是一个场景。**
 *
 * ## 为什么不做成场景
 *
 * 暂停菜单必须叠在**正在跑的那一局**上面（弹窗后面还看得见战斗画面），而不是把
 * 战斗场景停掉换一屏。做成场景的话，宿主的场景要么被 stop（那就没法显示后面的
 * 画面），要么两个场景抢输入。
 *
 * 所以它是一组对象 + 几个方法，由宿主（D1 的战斗场景 / D4 的测试场）持有：
 * `new PauseOverlay({ scene, store, host })`，然后在宿主的按键处理里调
 * `handleToggleKey()` / `handleMoveFocus(delta)` / `handleActivate()`。
 *
 * ## ⚠️ 键盘只能有**一个**入口，否则"开"和"关"会互相打架
 *
 * 如果宿主自己绑一个 Esc 开菜单、组件内部再绑一个 Esc 关菜单，那按一下会
 * **同时关掉又打开**（两个 handler 都会收到那个事件）。所以这里只暴露
 * `handleToggleKey()`：宿主**只绑一处**，由组件决定这一下是"打开"还是"回上一层"。
 *
 * （Phaser 官方的 `input.keyboard.enabled = false` 解决的是另一个问题：
 * 两个**场景**抢键盘。这里两个 handler 都在同一个场景里，所以它帮不上忙。）
 *
 * ## 暂停语义归宿主，界面归 D4
 *
 * 需求 §4.3 要求"暂停后敌人、子弹、伤害与战斗计时一并停止"。这件事 D4 做不了也不该做：
 * 它要同时冻结**逻辑时钟**和**物理世界**（`core/time.ts` 的 `GameClock` +
 * `physics.world.pause()`），两者缺一不可 —— 只冻结时钟的话，物理积分、子弹位移、
 * sprite 位置照常走。
 *
 * 所以暂停动作由宿主的 `PauseHost.pause()` 提供，D4 只负责"在该暂停的时候调它"。
 */

import Phaser from 'phaser'
import type { ProfileStore } from '../profile/ProfileStore'
import type { DisplayMode } from '../profile/types'
import { OverlayLayer } from '../ui/overlayLayer'
import type { OverlaySink } from '../ui/overlayFrame'
import { ArchiveUI } from '../ui/ArchiveUI'
import {
  buildNotebookPause,
  buildNotebookHelp,
  buildNotebookSettings,
  buildNotebookQuit,
  type NotebookSettingsParts,
} from '../ui/NotebookPanels'
import { SaveStatusBanner } from '../ui/SaveStatusBanner'
import { THEME, ARCHIVE_THEME as A } from '../ui/theme'
import type { RunSnapshot } from './runSnapshot'

/** 宿主（D1 的战斗场景）必须提供这四件事。 */
export interface PauseHost {
  /** 暂停这一局：**逻辑时钟 + 物理世界都要**（见文件头） */
  pause(): void
  /** 继续 */
  resume(): void
  /** 「返回主菜单」确认之后，宿主自己收尾这一局（结束本局、切场景） */
  quitToMenu(): void
  /** 取一份本局状态。暂停期间值不会变，所以只在打开时取一次 */
  snapshot(): RunSnapshot
}

export interface PauseOverlayOptions {
  scene: Phaser.Scene
  store: ProfileStore
  host: PauseHost
}

/** 主菜单体、以及叠在它上面的三个子弹层（需求 §4.6） */
type PauseScreen = 'paused' | 'help' | 'settings' | 'confirm-quit'

const SCREEN_TITLES: Readonly<Record<PauseScreen, string>> = {
  paused: '暂停',
  help: '操作说明',
  settings: '设置',
  'confirm-quit': '确定返回主菜单？',
}

/** 左栏四个按钮的名字与顺序（需求 §4.3 的控件表） */
const MENU_LABELS = ['继续游戏', '查看操作说明', '设置', '返回主菜单'] as const

export class PauseOverlay {
  private readonly scene: Phaser.Scene
  private readonly store: ProfileStore
  private readonly host: PauseHost

  private screen: PauseScreen = 'paused'
  private opened = false
  private focusIndex = 0
  private snapshot: RunSnapshot | null = null

  private objects: Phaser.GameObjects.GameObject[] = []
  private pauseChoices: Phaser.GameObjects.Rectangle[] = []
  /** 这一屏的所有显示对象（**含控件内部那些**），顺序 = 创建顺序，见 `ui/overlayLayer.ts` */
  private parts: Phaser.GameObjects.GameObject[] = []
  private layer: OverlayLayer | null = null
  private settingsParts: NotebookSettingsParts | null = null
  private saveBanner: SaveStatusBanner | null = null
  private noticeText: Phaser.GameObjects.Text | null = null
  private readonly onResize: () => void
  private readonly onFullscreenChanged: () => void
  private readonly onFullscreenFailed: () => void
  private readonly unsubscribeStore: () => void

  constructor(options: PauseOverlayOptions) {
    this.scene = options.scene
    this.store = options.store
    this.host = options.host

    // 窗口尺寸变了要重排（`Scale.RESIZE` 下画布就是窗口大小）。
    // 订阅挂在构造里、退订挂在 `destroy()` 里，配对只有一处。
    this.onResize = () => {
      if (this.opened) this.rebuild()
    }
    this.scene.scale.on(Phaser.Scale.Events.RESIZE, this.onResize)
    this.onFullscreenChanged = () => this.store.syncDisplayMode(this.scene.scale.isFullscreen)
    this.onFullscreenFailed = () => {
      this.noticeText?.setText('全屏切换失败，浏览器未进入全屏')
    }
    this.scene.scale.on(Phaser.Scale.Events.ENTER_FULLSCREEN, this.onFullscreenChanged)
    this.scene.scale.on(Phaser.Scale.Events.LEAVE_FULLSCREEN, this.onFullscreenChanged)
    this.scene.scale.on(Phaser.Scale.Events.FULLSCREEN_FAILED, this.onFullscreenFailed)
    this.scene.scale.on(Phaser.Scale.Events.FULLSCREEN_UNSUPPORTED, this.onFullscreenFailed)
    this.unsubscribeStore = this.store.subscribe(() => {
      this.saveBanner?.refresh()
      this.settingsParts?.refresh()
    })
  }

  get isOpen(): boolean {
    return this.opened
  }

  // ------------------------------------------------------------------ 对外

  /**
   * 暂停键 / Esc 的**唯一**入口。关着就打开；开着就当作"回上一层"
   * （在暂停菜单本体上 = 继续游戏）。宿主只绑这一处，见文件头。
   */
  handleToggleKey(): void {
    if (!this.opened) {
      this.show()
      return
    }
    this.escape()
  }

  /** ↑↓ 在多选一里挪焦点。只在打开、且停在暂停菜单本体上时有效。 */
  handleMoveFocus(delta: number): void {
    if (!this.opened || this.screen !== 'paused') return
    const count = MENU_LABELS.length
    this.focusIndex = (((this.focusIndex + delta) % count) + count) % count
    this.refreshFocus()
  }

  /** 回车 / 空格。同上。 */
  handleActivate(): void {
    if (!this.opened || this.screen !== 'paused') return
    this.runMenuAction(this.focusIndex)
  }

  show(): void {
    if (this.opened) return
    this.opened = true
    this.screen = 'paused'
    this.focusIndex = 0
    this.store.syncDisplayMode(this.scene.scale.isFullscreen)
    // 快照只在打开时取一次：暂停期间这些值不会变，每帧问一次纯属浪费。
    this.snapshot = this.host.snapshot()
    // ⚠️ 顺序：**先暂停再画**。反过来的话，画的过程中世界还在跑，
    // 面板上的数会和画出来的东西差一帧。
    this.host.pause()
    // 弹层整块要有自己的坐标系：宿主那台相机怎么缩放平移都不该影响它（见 OverlayLayer）
    this.layer ??= new OverlayLayer(this.scene)
    this.rebuild()
  }

  /** 继续游戏 */
  hide(): void {
    if (!this.opened) return
    this.opened = false
    this.snapshot = null
    this.clear()
    this.host.resume()
  }

  /**
   * 场景要结束了（重启 / 切场景）时调。**这里不 resume** ——
   * 时钟和物理世界跟着场景一起没了，resume 一个已经死掉的世界只会抛异常。
   */
  destroy(): void {
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.onResize)
    this.scene.scale.off(Phaser.Scale.Events.ENTER_FULLSCREEN, this.onFullscreenChanged)
    this.scene.scale.off(Phaser.Scale.Events.LEAVE_FULLSCREEN, this.onFullscreenChanged)
    this.scene.scale.off(Phaser.Scale.Events.FULLSCREEN_FAILED, this.onFullscreenFailed)
    this.scene.scale.off(Phaser.Scale.Events.FULLSCREEN_UNSUPPORTED, this.onFullscreenFailed)
    this.unsubscribeStore()
    this.clear()
    this.opened = false
    this.layer?.destroy()
    this.layer = null
  }

  // ------------------------------------------------------------------ 行为

  /** Esc 语义（需求 §4.3：Esc 等效于继续游戏；子弹层则是"回上一层"） */
  private escape(): void {
    if (this.screen !== 'paused') {
      this.screen = 'paused'
      this.rebuild()
      return
    }
    this.hide()
  }

  private runMenuAction(index: number): void {
    if (index === 0) {
      this.hide()
      return
    }
    this.screen = index === 1 ? 'help' : index === 2 ? 'settings' : 'confirm-quit'
    this.rebuild()
  }

  private confirmQuitToMenu(): void {
    // 本局要结束了，**不能 resume** —— 恢复了再切场景，等于白恢复一次。
    this.opened = false
    this.snapshot = null
    this.clear()
    this.host.quitToMenu()
  }

  private setDisplayMode(mode: DisplayMode): void {
    // 全屏请求必须写在点击处理函数里（`AGENTS.md` §九 第 3 条）。这里正好是。
    try {
      if (mode === 'fullscreen') this.scene.scale.startFullscreen()
      else this.scene.scale.stopFullscreen()
    } catch (err) {
      this.noticeText?.setText(`全屏切换失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ------------------------------------------------------------------ 画面

  private makeSink(): OverlaySink {
    return {
      track: (obj) => {
        this.objects.push(obj)
        this.parts.push(obj)
      },
      button: (button) => {
        this.objects.push(...button.parts)
        this.parts.push(...button.parts)
      },
    }
  }

  private rebuild(): void {
    this.clear()
    const sink = this.makeSink()
    const ui = new ArchiveUI(
      this.scene,
      sink,
      SCREEN_TITLES[this.screen],
      () => (this.screen === 'paused' ? this.hide() : this.escape()),
      this.screen === 'help',
      this.screen === 'paused' ? '继续游戏  ×' : '返回暂停  ×',
    )
    this.noticeText = ui.label(800, 882, '', THEME.font.heading).setOrigin(0.5, 1)
    if (this.screen === 'paused') {
      this.pauseChoices = buildNotebookPause(ui, this.store.profile, this.snapshot, (index) =>
        this.runMenuAction(index),
      )
      this.pauseChoices.forEach((button) => button.on('pointerout', () => this.refreshFocus()))
      this.refreshFocus()
    }
    if (this.screen === 'help') buildNotebookHelp(ui)
    if (this.screen === 'settings')
      this.settingsParts = buildNotebookSettings(ui, this.store, (mode) =>
        this.setDisplayMode(mode),
      )
    if (this.screen === 'confirm-quit')
      buildNotebookQuit(
        ui,
        this.store.profile,
        () => this.confirmQuitToMenu(),
        () => this.hide(),
        true,
      )

    this.saveBanner = new SaveStatusBanner(
      this.scene,
      this.store,
      this.scene.scale.width / 2,
      44,
      this.scene.scale.width,
    )
    this.parts.push(this.saveBanner.root)
    this.layer?.attach(this.parts)
  }

  private refreshFocus(): void {
    this.pauseChoices.forEach((button, index) => {
      button.setStrokeStyle(
        index === this.focusIndex ? 2 : 1,
        index === this.focusIndex ? A.cyan : A.brass,
      )
    })
  }

  private clear(): void {
    this.saveBanner?.destroy()
    this.saveBanner = null
    for (const o of this.objects) o.destroy()
    this.pauseChoices = []
    this.objects = []
    this.parts = []
    this.layer?.detach()
    this.settingsParts = null
    this.noticeText = null
  }
}
