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
import { characterById } from '../catalog'
import type { ProfileStore } from '../profile/ProfileStore'
import type { DisplayMode } from '../profile/types'
import { totalLevelsFor } from '../progress/progress'
import { Bar } from '../ui/Bar'
import { Button } from '../ui/Button'
import { dashRect } from '../ui/dashed'
import { buildOverlayFrame } from '../ui/overlayFrame'
import { OverlayLayer } from '../ui/overlayLayer'
import {
  applyDisplayModeSelection,
  buildHelpPanel,
  buildSettingsPanel,
  type PanelSink,
  type SettingsPanelParts,
} from '../ui/panels'
import { Slider } from '../ui/Slider'
import { THEME, fontPx } from '../ui/theme'
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

const PANEL_WIDTH = 760
const PANEL_HEIGHT = 440

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
  private buttons: Button[] = []
  private sliders: Slider[] = []
  private bars: Bar[] = []
  /** 这一屏的所有显示对象（**含控件内部那些**），顺序 = 创建顺序，见 `ui/overlayLayer.ts` */
  private parts: Phaser.GameObjects.GameObject[] = []
  private layer: OverlayLayer | null = null
  private settingsParts: SettingsPanelParts | null = null
  private noticeText: Phaser.GameObjects.Text | null = null
  private readonly onResize: () => void

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
    this.store.setSettings({ displayMode: mode })
    if (this.settingsParts) {
      applyDisplayModeSelection(this.settingsParts, this.store.profile.settings.displayMode)
    }
  }

  // ------------------------------------------------------------------ 画面

  private makeSink(): PanelSink {
    return {
      track: (obj) => {
        this.objects.push(obj)
        this.parts.push(obj)
      },
      button: (button) => {
        this.buttons.push(button)
        // 控件的内部对象也要一起搬（见 `Button.parts` 的说明）
        this.parts.push(...button.parts)
      },
      slider: (slider) => {
        this.sliders.push(slider)
        this.parts.push(...slider.parts)
      },
    }
  }

  private rebuild(): void {
    this.clear()
    const sink = this.makeSink()
    const frame = buildOverlayFrame(
      this.scene,
      sink,
      {
        screenWidth: this.scene.scale.width,
        screenHeight: this.scene.scale.height,
        title: SCREEN_TITLES[this.screen],
        panelWidth: PANEL_WIDTH,
        panelHeight: PANEL_HEIGHT,
        // 暂停菜单本体没有「关闭」按钮：它的"关闭"就是左边的「继续游戏」。
        // 子弹层有 —— 需求 §4.3 要求"关闭后返回暂停菜单"。
        showClose: this.screen !== 'paused',
      },
      () => this.escape(),
    )
    this.noticeText = frame.notice

    if (this.screen === 'paused') this.buildPauseBody(frame.cx, frame.cy, frame.contentTop, sink)
    if (this.screen === 'help') buildHelpPanel(this.scene, sink, frame)
    if (this.screen === 'settings') {
      this.settingsParts = buildSettingsPanel(this.scene, sink, frame, this.store, (mode) =>
        this.setDisplayMode(mode),
      )
    }
    if (this.screen === 'confirm-quit') this.buildQuitConfirm(frame.cx, frame.cy, sink)

    this.layer?.attach(this.parts)
  }

  private buildPauseBody(cx: number, cy: number, contentTop: number, sink: PanelSink): void {
    // ---- 左栏：四个按钮 ----
    const buttonX = cx - PANEL_WIDTH / 2 + THEME.space.lg + 130
    MENU_LABELS.forEach((label, i) => {
      sink.button(
        new Button(this.scene, buttonX, contentTop + i * 54, label, () => this.runMenuAction(i), {
          width: 260,
          height: 42,
          fontSize: THEME.font.body,
        }),
      )
    })

    // ---- 左下：游戏音量 ----
    // ⚠️ 这个滑杆绑的是档里的 `bgmVolume`，**不是第三份音量**。
    // 需求 §4.5 的备注写得很明确：「BGM 音量 …… 与暂停菜单的『游戏音量』同步」。
    // 两个界面读的是同一份档，所以"改一处两边同步"不需要任何同步代码 ——
    // 它只有一个真值来源。
    sink.slider(
      new Slider(
        this.scene,
        cx - PANEL_WIDTH / 2 + THEME.space.lg,
        cy + 90,
        '游戏音量',
        this.store.profile.settings.bgmVolume,
        { width: 240, onChange: (v) => this.store.setSettings({ bgmVolume: v }) },
      ),
    )

    // ---- 右栏：当前角色数据 ----
    const snapshot = this.snapshot
    const rightX = cx + THEME.space.md
    const boxWidth = 130
    const boxHeight = 120
    const boxCx = rightX + boxWidth / 2
    const boxCy = contentTop + boxHeight / 2

    // 立绘占位（需求 §4.3：「立绘占位（虚线框）」）。虚线而不是实线：
    // 实线框看起来像"图没加载出来"，虚线框才是"本来就还没有"。见 docs/UI规范.md §五。
    const frameG = this.scene.add.graphics()
    frameG.lineStyle(1, THEME.color.border, 1)
    dashRect(frameG, boxCx - boxWidth / 2, boxCy - boxHeight / 2, boxWidth, boxHeight)
    sink.track(frameG)

    const name = snapshot
      ? (characterById(snapshot.characterId)?.name ?? snapshot.characterId)
      : '—'
    sink.track(
      this.scene.add
        .text(boxCx, boxCy + boxHeight / 2 + 16, name, {
          fontFamily: THEME.font.family,
          fontSize: fontPx(THEME.font.body),
          color: THEME.text.body,
        })
        .setOrigin(0.5),
    )

    const dataX = rightX + boxWidth + THEME.space.md
    sink.track(
      this.scene.add.text(dataX, contentTop + 2, '当前角色数据', {
        fontFamily: THEME.font.family,
        fontSize: fontPx(THEME.font.small),
        color: THEME.text.dim,
      }),
    )

    const bars: [string, number | null, number | null][] = [
      ['生命', snapshot?.hp ?? null, snapshot?.maxHp ?? null],
      ['护盾', snapshot?.shield ?? null, snapshot?.maxShield ?? null],
      ['能量', snapshot?.magic ?? null, snapshot?.maxMagic ?? null],
    ]
    bars.forEach(([label, value, max], i) => {
      const bar = new Bar(this.scene, dataX, contentTop + 44 + i * 30, label, value, max, {
        width: 80,
      })
      this.bars.push(bar)
      this.parts.push(...bar.parts)
    })

    const rows = [
      `装备技能   ${snapshot?.skillName ?? '—'}`,
      `武器       ${snapshot?.weaponName ?? '—'}`,
      `升级次数   ${this.upgradesOf(snapshot?.characterId)}`,
    ]
    sink.track(
      this.scene.add.text(dataX, contentTop + 146, rows.join('\n'), {
        fontFamily: THEME.font.family,
        fontSize: fontPx(THEME.font.small),
        color: THEME.text.dim,
        lineSpacing: 6,
      }),
    )

    this.refreshFocus()
  }

  private buildQuitConfirm(cx: number, cy: number, sink: PanelSink): void {
    sink.track(
      this.scene.add
        .text(cx, cy - 40, '本局进度不会保存。', {
          fontFamily: THEME.font.family,
          fontSize: fontPx(THEME.font.body),
          color: THEME.text.body,
        })
        .setOrigin(0.5),
    )
    sink.track(
      this.scene.add
        .text(cx, cy - 10, '（永久解锁与升级次数不受影响）', {
          fontFamily: THEME.font.family,
          fontSize: fontPx(THEME.font.small),
          color: THEME.text.dim,
        })
        .setOrigin(0.5),
    )
    // 取消在上、确认在下：与主菜单的退出确认一致，默认焦点是"取消"，
    // 免得手快直接退出这一局。
    sink.button(
      new Button(this.scene, cx, cy + 44, '取消', () => this.escape(), {
        width: 160,
        height: 38,
        fontSize: THEME.font.body,
      }),
    )
    sink.button(
      new Button(this.scene, cx, cy + 96, '确认返回主菜单', () => this.confirmQuitToMenu(), {
        width: 220,
        height: 40,
        fontSize: THEME.font.body,
      }),
    )
  }

  /** 焦点只在暂停菜单本体上有意义；子弹层里所有主菜单按钮都不高亮。 */
  private refreshFocus(): void {
    this.buttons.forEach((button, i) => {
      button.setSelected(this.screen === 'paused' && i === this.focusIndex)
    })
  }

  private upgradesOf(characterId: string | undefined): number {
    if (!characterId) return 0
    // 升级次数 = 这个角色名下所有成长线（含它的技能）的级数之和。
    // **不要写 `upgrades[characterId]`** —— 键是 `"owner:track"` 的复合键。
    return totalLevelsFor(this.store.profile, characterId)
  }

  private clear(): void {
    for (const b of this.buttons) b.destroy()
    for (const s of this.sliders) s.destroy()
    for (const bar of this.bars) bar.destroy()
    for (const o of this.objects) o.destroy()
    this.buttons = []
    this.sliders = []
    this.bars = []
    this.objects = []
    this.parts = []
    this.layer?.detach()
    this.settingsParts = null
    this.noticeText = null
  }
}
