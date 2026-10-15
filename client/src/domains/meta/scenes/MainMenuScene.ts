/**
 * 主菜单（需求 §4.1 + §4.6 的入口那一支）。**这是 D4 的第一个产品场景。**
 *
 * ## 谁能进到它
 *
 * 两条路，都走 `init()` 把它需要的东西传进来（`onExit` / `store`），
 * 所以这个文件里**一行测试场的代码都没有**：
 *
 * - **产品**：标题画面（`GameScenes.ts`，key `main-menu`）上的「局外成长」按钮。
 *   `main.ts` 把它注册成 key `MainMenu`，与标题画面的 `main-menu` 不冲突。
 * - **测试场**：`test/arenas/D4/d4_main_menu.ts` 挂起来跑（不必等战斗场景，
 *   也不用 `main.ts` 接谁 —— 它从第一天起就能在浏览器里单独打开）。
 *
 * ## 逻辑与画面是分开的
 *
 * 所有规则（焦点移动、未解锁不能选、弹层开关）在 `menu/menuModel.ts` 里，
 * 跑在 node 下被测；这里只负责"把状态画出来"和"把输入喂进去"。
 * 于是"未解锁的角色不能被选中"这种规则**不需要靠人眼看**。
 *
 * ## 两个重绘入口，别混用
 *
 * - `rebuild()`：**结构变了**才调（换屏、窗口尺寸变了）。它会销毁并重建所有对象。
 * - `refresh()`：**状态变了**就调（焦点、解锁、选中）。它只改已有对象的外观。
 *
 * 为什么必须分开：设置弹层里那两个滑杆是**拖拽**控件，而拖拽过程中值在连续变化。
 * 如果值一变就 `rebuild()`，滑杆会在玩家手底下被销毁重建 —— 表现是"拖到一半就没反应了"，
 * 而它看起来完全像是拖拽实现写错了。
 */

import Phaser from 'phaser'
import { CHARACTERS, DIFFICULTY_LABELS, DIFFICULTY_ORDER, characterById } from '../catalog'
import {
  MENU_ACTIONS,
  MENU_ACTION_LABELS,
  closeScreen,
  createMenuState,
  focusedAction,
  moveFocus,
  openScreen,
  trySelectCharacter,
  unlockedCount,
  withNotice,
  type MenuState,
  type MenuAction,
} from '../menu/menuModel'
import { ProfileStore } from '../profile/ProfileStore'
import { LocalStorageProfileStorage } from '../profile/storage'
import { META_CONFIG_NAME, META_CONFIG_URL, parseMetaConfig, type MetaConfig } from '../metaConfig'
import type { Difficulty } from '@/core/config'
import { buildUpgradePanel } from '../upgrade/UpgradePanel'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { buildOverlayFrame } from '../ui/overlayFrame'
import {
  applyDisplayModeSelection,
  buildHelpPanel,
  buildSettingsPanel,
  type PanelSink,
  type SettingsPanelParts,
} from '../ui/panels'
import { Slider } from '../ui/Slider'
import { THEME, fontPx } from '../ui/theme'

/** 场景 key。宿主注册时用它。 */
export const MAIN_MENU_SCENE_KEY = 'MainMenu'

/** 宿主（测试场 / 将来的 `main.ts`）能传进来的东西 */
export interface MainMenuData {
  /**
   * 「退出这一层」的回调。**宿主给的出口。**
   *
   * 产品里不传：主菜单是顶层，按 Esc 什么都不该发生（需求 §4.6 里 Esc 的作用是
   * "关闭弹层 / 返回上一层"，主菜单没有上一层）。测试场会传一个"回测试场菜单"。
   */
  onExit?: () => void
  /** 注入的档。**不传就自己建一个**（用浏览器 localStorage） */
  store?: ProfileStore
}

/** 竖排按钮的起点，给角色区留出上面的空间 */
const BUTTON_TOP = 170

export class MainMenuScene extends Phaser.Scene {
  private store!: ProfileStore
  private state: MenuState = createMenuState()
  private onExit: (() => void) | undefined

  private objects: Phaser.GameObjects.GameObject[] = []
  private buttons = new Map<MenuAction, Button>()
  private difficultyButtons = new Map<Difficulty, Button>()
  private cards: Card[] = []
  private sliders: Slider[] = []
  private overlayButtons: Button[] = []
  private settingsParts: SettingsPanelParts | null = null
  private noticeText: Phaser.GameObjects.Text | null = null
  private unlockedText: Phaser.GameObjects.Text | null = null

  /** 弹层的标题。键就是 `MenuScreen` 里除 `main` 之外的那三个。 */
  private static readonly OVERLAY_TITLES = {
    help: '操作说明',
    settings: '设置',
    upgrade: '角色升级',
    'confirm-quit': '确定退出游戏？',
  } as const
  /** 每屏的面板高度。写在一起，改一处就够 —— 分开写在两个地方必然漂。 */
  private static readonly OVERLAY_HEIGHTS = {
    help: 320,
    settings: 360,
    // 内容有四段（金币 / 三条角色成长线 / 技能 / 可解锁三项）+ 底部一行说明，
    // 470 会让最后一条解锁行溢出面板底 —— 实测过，所以留足余量。
    upgrade: 500,
    'confirm-quit': 360,
  } as const

  /** 局外成长的数值表。**加载失败时是 `null`**，升级页会照实说 */
  private meta: MetaConfig | null = null

  private readonly disposers: (() => void)[] = []

  constructor() {
    super(MAIN_MENU_SCENE_KEY)
  }

  init(data: MainMenuData = {}): void {
    this.onExit = data.onExit
    if (data.store) {
      this.store = data.store
    } else {
      this.store = new ProfileStore({ storage: new LocalStorageProfileStorage() })
    }
    this.state = createMenuState()
  }

  preload(): void {
    // 配置表必须走 Phaser 的 loader，**不能 import** —— `public/` 下的文件不参与
    // 打包，Vite 遇到指向它的 import 会静默换成空模块（见 `ArenaBase.preload`）。
    this.load.json(META_CONFIG_NAME, META_CONFIG_URL)
  }

  create(): void {
    const outcome = this.store.load()

    // 成长表读不出来**不该把主菜单整个弄死**：菜单本身还能用，
    // 只是「查看升级」进去会告诉你原因。
    try {
      this.meta = parseMetaConfig(this.cache.json.get(META_CONFIG_NAME))
    } catch (err) {
      this.meta = null
      this.state = withNotice(
        this.state,
        `成长配置读不出来：${err instanceof Error ? err.message : String(err)}`,
      )
    }

    // 档读不出来的时候**必须在画面上说**（`profile/types.ts` 的 LoadOutcome 注释）：
    // 玩家刚丢了一部分进度，而"存档没读出来"只写进控制台的话，
    // 他的体验就是"我的解锁莫名其妙没了"。
    if (outcome.status === 'recovered') {
      this.state = withNotice(this.state, `⚠️ 存档读不出来，已按新档开始：${outcome.reason}`)
    }

    this.bindInput()
    this.rebuild()
  }

  // ------------------------------------------------------------------ 输入

  private bindInput(): void {
    const kb = this.input.keyboard
    if (kb) {
      // 空格默认会滚动页面；不捕获的话按一下整页就跳。
      kb.addCapture(['SPACE', 'UP', 'DOWN', 'ENTER', 'ESC'])
      kb.on('keydown-UP', () => this.moveFocus(-1))
      kb.on('keydown-DOWN', () => this.moveFocus(1))
      kb.on('keydown-ENTER', () => this.activateFocused())
      kb.on('keydown-SPACE', () => this.activateFocused())
      kb.on('keydown-ESC', () => this.escape())
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => kb.removeAllListeners())
    }

    // RESIZE 模式下窗口尺寸就是画布尺寸，所以**每次变化都要重新排版**。
    // 不重排的症状是"窗口拉大之后按钮留在原地"，而那看起来像是布局写死了。
    const onResize = (): void => this.rebuild()
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize)
    this.disposers.push(() => this.scale.off(Phaser.Scale.Events.RESIZE, onResize))

    // 档变了就刷新外观（设置弹层的滑杆改了音量、别处改了选择）。
    // **这条只调 refresh()，不调 rebuild()** —— 理由见文件头。
    this.disposers.push(this.store.subscribe(() => this.refresh()))

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const off of this.disposers) off()
      this.disposers.length = 0
      this.clearObjects()
    })
  }

  private moveFocus(delta: number): void {
    if (this.state.screen !== 'main') return
    this.state = moveFocus(this.state, delta)
    this.refresh()
  }

  private activateFocused(): void {
    if (this.state.screen !== 'main') return
    this.run(focusedAction(this.state))
  }

  private escape(): void {
    const closed = closeScreen(this.state)
    if (closed) {
      this.state = closed
      this.rebuild()
      return
    }
    // 主菜单是顶层：没有弹层可关时，这一下 Esc 交给宿主（测试场用它回菜单）。
    this.onExit?.()
  }

  private run(action: MenuAction): void {
    switch (action) {
      case 'start':
        // 「开始闯关」= 进战斗场景，与标题画面的「开始冒险」是同一条路
        // （需求 §4.1 的主按钮；Esc 之后回到的也是那边那个主菜单）。
        //
        // ⚠️ 先确认 `battle` 真的注册过：只有产品入口会注册它（`main.ts` 的 scene
        // 列表），D4 的测试场（`test.html?arena=d4_main_menu`）里没有战斗场景 ——
        // 在那边直接 start 是静默什么都不发生，而"按下去没反应"看起来就是菜单坏了。
        if (!this.scene.manager.keys['battle']) {
          this.state = withNotice(this.state, '这个入口没有注册战斗场景（产品入口里才有）')
          this.refresh()
          break
        }
        // 难度一起带上：这张菜单上就摆着难度三选一，不传的话那个选择只是个摆设。
        this.scene.start('battle', { difficulty: this.store.profile.selected.difficulty })
        break
      case 'upgrade':
        this.state = openScreen(this.state, 'upgrade')
        this.rebuild()
        break
      case 'help':
        this.state = openScreen(this.state, 'help')
        this.rebuild()
        break
      case 'quit':
        this.state = openScreen(this.state, 'confirm-quit')
        this.rebuild()
        break
    }
  }

  // ------------------------------------------------------------------ 构建

  private rebuild(): void {
    this.clearObjects()
    const W = this.scale.width
    const H = this.scale.height

    this.buildBackdrop(W, H)
    // 主菜单**始终建**：需求 §4.5 要求「设置弹窗覆盖在主菜单之上」，
    // 所以弹层是"叠上去"的，不是"换一屏"。挡住下层点击的活儿由
    // `buildOverlay` 里那层压暗矩形干（见那里的说明）。
    this.buildMain(W, H)
    if (this.state.screen !== 'main') this.buildOverlay(W, H, this.state.screen)

    this.refresh()
  }

  private clearObjects(): void {
    for (const b of this.buttons.values()) b.destroy()
    for (const b of this.difficultyButtons.values()) b.destroy()
    for (const b of this.overlayButtons) b.destroy()
    for (const c of this.cards) c.destroy()
    for (const s of this.sliders) s.destroy()
    for (const o of this.objects) o.destroy()
    this.buttons.clear()
    this.difficultyButtons.clear()
    this.overlayButtons = []
    this.cards = []
    this.sliders = []
    this.objects = []
    this.settingsParts = null
    this.noticeText = null
    this.unlockedText = null
  }

  private track<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.objects.push(obj)
    return obj
  }

  private buildBackdrop(W: number, H: number): void {
    this.track(this.add.rectangle(W / 2, H / 2, W, H, THEME.color.backdrop).setDepth(-10))
  }

  private buildMain(W: number, H: number): void {
    const pad = THEME.space.xl

    // LOGO / 标题位（需求 §4.1：「LOGO / 标题占位（虚线框）」）
    this.track(
      this.add.text(pad, pad, '课后勇者', {
        fontFamily: THEME.font.family,
        fontSize: fontPx(THEME.font.title),
        color: THEME.text.body,
      }),
    )
    this.track(
      this.add.text(pad, pad + THEME.font.title + THEME.space.sm, '异次元校园 · 主菜单', {
        fontFamily: THEME.font.family,
        fontSize: fontPx(THEME.font.small),
        color: THEME.text.dim,
      }),
    )

    // 右上角：设置（需求 §4.1）
    this.overlayButtons.push(
      new Button(this, W - pad - 50, pad + 18, '设置', () => this.open('settings'), {
        width: 100,
        height: 36,
        fontSize: THEME.font.small,
      }),
    )

    // 左栏：四个按钮（需求 §4.1 的按钮顺序）
    MENU_ACTIONS.forEach((action, i) => {
      const y = BUTTON_TOP + i * (THEME.button.height + THEME.space.md)
      this.buttons.set(
        action,
        new Button(this, pad + THEME.button.width / 2, y, MENU_ACTION_LABELS[action], () =>
          this.run(action),
        ),
      )
    })

    // 角色区
    const areaX = pad * 2 + THEME.button.width
    const areaW = Math.max(200, W - areaX - pad)
    const gap = THEME.space.md
    const cardW = Math.max(
      104,
      Math.min(THEME.card.width, (areaW - gap * (CHARACTERS.length - 1)) / CHARACTERS.length),
    )
    const cardH = Math.min(THEME.card.height, H - BUTTON_TOP - 170)
    const firstX = areaX + cardW / 2

    this.unlockedText = this.track(
      this.add.text(areaX, BUTTON_TOP - 34, '', {
        fontFamily: THEME.font.family,
        fontSize: fontPx(THEME.font.heading),
        color: THEME.text.body,
      }),
    )

    CHARACTERS.forEach((def, i) => {
      const x = firstX + i * (cardW + gap)
      this.cards.push(
        new Card(this, x, BUTTON_TOP + cardH / 2, def, () => this.pickCharacter(def.id), {
          width: cardW,
          height: cardH,
        }),
      )
    })

    // 难度（需求 §4.1：简单 / 普通 / 困难，默认普通）
    //
    // ⚠️ 标签与按钮之间要留**真正的空隙**：标签是 origin(0,0) 的左对齐文字（高约 18），
    // 按钮是**以中心定位**的（高 36 → 上沿在 diffY-18）。
    // 写成 `标签 y = diffY - 28` 时按钮上沿会盖住标签下沿（实测盖掉 7px）。
    // 要留 8px 空隙就得 `diffY - 44`；+12 是让它整体再往下让一点。
    const diffY = BUTTON_TOP + cardH + THEME.space.xl + 38
    this.track(
      this.add.text(areaX, diffY - 44, '选择难度', {
        fontFamily: THEME.font.family,
        fontSize: fontPx(THEME.font.body),
        color: THEME.text.dim,
      }),
    )
    const diffW = 96
    DIFFICULTY_ORDER.forEach((d, i) => {
      this.difficultyButtons.set(
        d,
        new Button(
          this,
          areaX + diffW / 2 + i * (diffW + THEME.space.sm),
          diffY,
          DIFFICULTY_LABELS[d],
          () => this.pickDifficulty(d),
          { width: diffW, height: 36, fontSize: THEME.font.small },
        ),
      )
    })

    // 底部提示（需求 §4.1：「选择角色与难度后，点击『开始闯关』进入游戏」）
    this.track(
      this.add.text(pad, H - pad - 18, '选择角色与难度后，点击「开始闯关」', {
        fontFamily: THEME.font.family,
        fontSize: fontPx(THEME.font.small),
        color: THEME.text.dim,
      }),
    )

    this.noticeText = this.track(
      this.add
        .text(W / 2, H - pad - 18, '', {
          fontFamily: THEME.font.family,
          fontSize: fontPx(THEME.font.small),
          color: THEME.text.accent,
        })
        .setOrigin(0.5, 0),
    )
  }

  private buildOverlay(W: number, H: number, screen: Exclude<MenuState['screen'], 'main'>): void {
    // 外框（压暗层 / 面板 / 标题 / 关闭按钮 / 底部提示行）与**叠放顺序**统一在
    // `ui/overlayFrame.ts` 里 —— 暂停菜单用的是同一份，包括那条"别加 setDepth"的坑。
    const sink: PanelSink = {
      track: (obj) => this.track(obj),
      button: (button) => {
        this.overlayButtons.push(button)
      },
      slider: (slider) => {
        this.sliders.push(slider)
      },
    }
    const frame = buildOverlayFrame(
      this,
      sink,
      {
        screenWidth: W,
        screenHeight: H,
        title: MainMenuScene.OVERLAY_TITLES[screen],
        panelHeight: MainMenuScene.OVERLAY_HEIGHTS[screen],
      },
      () => this.escape(),
    )
    this.noticeText = frame.notice

    // 说明与设置这两块内容与暂停菜单**共用同一份实现**：
    // 需求 §4.3 的备注要求它们"是同一个界面"。
    if (screen === 'help') buildHelpPanel(this, sink, frame)
    if (screen === 'settings') {
      this.settingsParts = buildSettingsPanel(this, sink, frame, this.store, (mode) =>
        this.setDisplayMode(mode),
      )
    }
    if (screen === 'upgrade') {
      buildUpgradePanel(this, sink, frame, this.store, this.meta, (notice) => {
        // 买完要重建整屏（数字变了、按钮的可用态也变了），而重建会销毁
        // 那块面板上的提示行 —— 所以提示走菜单状态，由 `refresh()` 重新写上去。
        this.state = withNotice(this.state, notice)
        this.rebuild()
      })
    }
    if (screen === 'confirm-quit') {
      // 退出确认是个二选一：需求 §4.1「确认：关闭程序；取消：关闭弹窗回到主菜单」。
      // 「取消」就是外框带的那个「关闭」按钮；确认单独一行，免得和它挤在一起被误点。
      sink.button(
        new Button(this, frame.cx, frame.cy + 44, '确认退出', () => this.confirmQuit(), {
          width: 200,
          height: 42,
          fontSize: THEME.font.body,
        }),
      )
    }
  }

  // ------------------------------------------------------------------ 行为

  private open(screen: MenuState['screen']): void {
    this.state = openScreen(this.state, screen)
    this.rebuild()
  }

  private pickCharacter(id: string): void {
    const result = trySelectCharacter(this.store.profile, id)
    if (!result.ok) {
      this.state = withNotice(this.state, result.notice)
      this.refresh()
      return
    }
    this.store.setSelection({ characterId: id })
    this.state = withNotice(this.state, '')
    this.refresh()
  }

  private pickDifficulty(d: Difficulty): void {
    this.store.setSelection({ difficulty: d })
    this.refresh()
  }

  private setDisplayMode(mode: 'fullscreen' | 'windowed'): void {
    // 全屏请求**必须在点击处理函数里发出**（`AGENTS.md` §九 第 3 条）——
    // 这里正好就是。`try` 是必须的：无头浏览器 / 不允许全屏的环境会抛。
    try {
      if (mode === 'fullscreen') this.scale.startFullscreen()
      else this.scale.stopFullscreen()
    } catch (err) {
      this.state = withNotice(
        this.state,
        `全屏切换失败：${err instanceof Error ? err.message : err}`,
      )
    }
    this.store.setSettings({ displayMode: mode })
    this.refresh()
  }

  private confirmQuit(): void {
    // 网页游戏没法"关闭程序"。**如实说**，而不是假装退出成功
    // （`window.close()` 只对脚本打开的窗口有效，其余情况静默失败）。
    try {
      window.close()
    } catch {
      // 忽略：下面那句提示才是给玩家看的
    }
    this.state = withNotice(this.state, '浏览器里关不掉标签页 —— 请手动关闭窗口')
    this.refresh()
  }

  /** **只改外观**，不重建对象。见文件头「两个重绘入口」。 */
  private refresh(): void {
    const p = this.store.profile
    const focus = focusedAction(this.state)

    for (const [action, button] of this.buttons) {
      button.setSelected(this.state.screen === 'main' && action === focus)
    }
    for (const [d, button] of this.difficultyButtons) {
      button.setSelected(p.selected.difficulty === d)
    }
    for (const card of this.cards) {
      const unlocked = p.unlocks.characters.includes(card.id)
      card.setLocked(!unlocked)
      card.setSelected(unlocked && p.selected.characterId === card.id)
    }

    if (this.unlockedText) {
      const { unlocked, total } = unlockedCount(p)
      this.unlockedText.setText(`选择角色（已解锁 ${unlocked} / ${total}）`)
    }

    const mode = p.settings.displayMode
    if (this.settingsParts) applyDisplayModeSelection(this.settingsParts, mode)

    if (this.noticeText) {
      const name = characterById(p.selected.characterId)?.name ?? p.selected.characterId
      this.noticeText.setText(
        this.state.notice ||
          (this.state.screen === 'main'
            ? `当前：${name} · ${DIFFICULTY_LABELS[p.selected.difficulty]}`
            : ''),
      )
    }
  }
}
