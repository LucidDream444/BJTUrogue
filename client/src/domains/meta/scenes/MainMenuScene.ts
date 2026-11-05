/**
 * 主菜单（需求 §4.1 + §4.6 的入口那一支）。**这是 D4 的第一个产品场景。**
 *
 * ## 谁能进到它
 *
 * 两条路，都走 `init()` 把它需要的东西传进来（`onExit` / `store`），
 * 所以这个文件里**一行测试场的代码都没有**：
 *
 * - **产品**：标题画面（`GameScenes.ts`，key `main-menu`）点击任意位置后进入。
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
 * 地图热区与地标名的唯一真值在 `menu/campusMenuModel.ts`；本文件只把那张表
 * 画成建筑正中的方块按钮，并把点击、悬停、键盘焦点接到同一组 `MenuAction` 上。
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
import { ASSETS, ARCHIVE_ART, CAMPUS_MENU_ART, findAsset, imageUrl } from '@/core/assetManifest'
import { textureKeyFor } from '@/core/assets'
import {
  CONFIG_FILE_NAMES,
  configUrl,
  parseConfigBundle,
  type ConfigBundle,
  type Difficulty,
} from '@/core/config'
import { CodexPanel } from '../codex/CodexPanel'
import { codexBossSkillConfig } from '../codex/bossCodexNotes'
import { buildCodexEntries, codexEncounterConfig, type CodexEntry } from '../codex/codexCatalog'
import { CHARACTERS, DIFFICULTY_LABELS, characterById } from '../catalog'
import { CAMPUS_HOTSPOTS, CAMPUS_MAP_SIZE, hotspotForAction } from '../menu/campusMenuModel'
import {
  MENU_ACTION_LABELS,
  closeScreen,
  createMenuState,
  focusOn,
  focusedAction,
  initialMenuScreen,
  moveFocus,
  openScreen,
  trySelectCharacter,
  withNotice,
  type MenuState,
  type MenuAction,
} from '../menu/menuModel'
import { ProfileStore } from '../profile/ProfileStore'
import { LocalStorageProfileStorage } from '../profile/storage'
import { isUnlocked } from '../progress/progress'
import { META_CONFIG_NAME, META_CONFIG_URL, parseMetaConfig, type MetaConfig } from '../metaConfig'
import { buildUpgradePanel } from '../upgrade/UpgradePanel'
import { ArchiveUI } from '../ui/ArchiveUI'
import { CampusHotspot } from '../ui/CampusHotspot'
import { CampusTooltip } from '../ui/CampusTooltip'
import type { OverlaySink } from '../ui/overlayFrame'
import {
  buildNotebookAchievements,
  buildNotebookFirstRun,
  buildNotebookHelp,
  buildNotebookRunSetup,
  buildNotebookSettings,
  buildNotebookQuit,
  type NotebookSettingsParts,
} from '../ui/NotebookPanels'
import { SaveStatusBanner } from '../ui/SaveStatusBanner'
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
  /** 从结算等入口直接打开升级页；关闭后仍回到主菜单本体。 */
  initialScreen?: 'upgrade'
}

export class MainMenuScene extends Phaser.Scene {
  private store!: ProfileStore
  private state: MenuState = createMenuState()
  private onExit: (() => void) | undefined
  private requestedInitialScreen: 'main' | 'upgrade' = 'main'

  private objects: Phaser.GameObjects.GameObject[] = []
  private hotspots = new Map<MenuAction, CampusHotspot>()
  private mapTooltip: CampusTooltip | null = null
  private hoveredAction: MenuAction | null = null
  private roleSummaryText: Phaser.GameObjects.Text | null = null
  private difficultySummaryText: Phaser.GameObjects.Text | null = null
  private settingsParts: NotebookSettingsParts | null = null
  private saveBanner: SaveStatusBanner | null = null
  private noticeText: Phaser.GameObjects.Text | null = null
  private codexPanel: CodexPanel | null = null
  private codexDetail = false
  private codexSelectionId: string | undefined
  /**
   * 升级页当前操作的角色。**故意和 `profile.selected.characterId` 分开**：
   * 后者是下一局出战角色，在升级页翻看 / 升级别的角色不能把它改掉。
   */
  private upgradeCharacterId: string | null = null
  /** 开屏后指针输入禁用的截止时刻（`game.loop.time`）。见 `run()` 的 start 分支。 */
  private inputGuardUntil = 0

  /** 弹层的标题。键就是 `MenuScreen` 里除 `main` 之外的全部屏。 */
  private static readonly OVERLAY_TITLES = {
    'first-run': '初次冒险',
    'run-setup': '出发准备',
    help: '冒险手册',
    settings: '校园设置',
    upgrade: '角色升级',
    codex: '怪物图鉴',
    achievements: '校史馆 · 成就',
    'confirm-quit': '暂别校园',
  } as const
  /** 局外成长的数值表。**加载失败时是 `null`**，升级页会照实说 */
  private meta: MetaConfig | null = null
  /** 敌人 / 难度 / 基线配置。图鉴数值全部从这里派生。 */
  private codexConfig: ConfigBundle | null = null

  private readonly disposers: (() => void)[] = []
  private startingRun = false

  constructor() {
    super(MAIN_MENU_SCENE_KEY)
  }

  init(data: MainMenuData = {}): void {
    this.startingRun = false
    this.onExit = data.onExit
    if (data.store) {
      this.store = data.store
    } else {
      this.store = new ProfileStore({ storage: new LocalStorageProfileStorage() })
    }
    this.requestedInitialScreen = data.initialScreen ?? 'main'
    this.state = createMenuState()
    // 每次进入场景都从当前出战角色重新开始；页面内切换保存在下面这个字段里。
    this.upgradeCharacterId = null
  }

  preload(): void {
    // 配置表必须走 Phaser 的 loader，**不能 import** —— `public/` 下的文件不参与
    // 打包，Vite 遇到指向它的 import 会静默换成空模块（见 `ArenaBase.preload`）。
    this.load.json(META_CONFIG_NAME, META_CONFIG_URL)
    if (!this.cache.json.exists('combat.json')) this.load.json('combat.json', 'config/combat.json')
    if (!this.cache.json.exists('boss-skills.json')) this.load.json('boss-skills.json', 'config/boss-skills.json')
    for (const name of CONFIG_FILE_NAMES) {
      if (!this.cache.json.exists(name)) this.load.json(name, configUrl(name))
    }
    for (const key of Object.values(ARCHIVE_ART)) {
      const asset = findAsset(key)
      if (asset && !this.textures.exists(key)) this.load.image(key, imageUrl(asset))
    }
    const mapAsset = findAsset(CAMPUS_MENU_ART.map)
    if (!mapAsset) throw new Error(`资源清单缺少校园主菜单底图：${CAMPUS_MENU_ART.map}`)
    if (!this.textures.exists(CAMPUS_MENU_ART.map)) {
      this.load.image(CAMPUS_MENU_ART.map, imageUrl(mapAsset))
    }

    // 出发准备页的三张角色卡。新生是待机图集（取第 0 帧），另外两张是单图；
    // 这里按清单里的 `kind` 分流，场景代码不碰任何真实纹理 key。
    for (const key of Object.values(CAMPUS_MENU_ART.characterCards)) {
      if (this.textures.exists(key)) continue
      const asset = findAsset(key)
      if (!asset) throw new Error(`资源清单缺少角色卡立绘：${key}`)
      if (asset.kind === 'spritesheet') {
        this.load.spritesheet(key, imageUrl(asset), {
          frameWidth: asset.frameWidth!,
          frameHeight: asset.frameHeight!,
        })
      } else {
        this.load.image(key, imageUrl(asset))
      }
    }

    // 图鉴要展示的种类和代数由配置决定；预加载阶段先按资源清单里的敌人 /
    // 首领前缀收图，避免在场景代码里硬编码任何 texture key。
    for (const asset of ASSETS) {
      if (asset.kind === 'audio' || asset.placeholder) continue
      if (!asset.key.startsWith('enemy_') && !asset.key.startsWith('boss_')) continue
      if (this.textures.exists(asset.key)) continue
      if (asset.kind === 'spritesheet') {
        this.load.spritesheet(asset.key, imageUrl(asset), {
          frameWidth: asset.frameWidth!,
          frameHeight: asset.frameHeight!,
        })
      } else {
        this.load.image(asset.key, imageUrl(asset))
      }
    }
  }

  create(): void {
    const outcome = this.store.load()
    this.state = createMenuState(initialMenuScreen(this.store.profile, this.requestedInitialScreen))

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

    try {
      const [balance, difficulty, enemies] = CONFIG_FILE_NAMES
      this.codexConfig = parseConfigBundle({
        balance: this.cache.json.get(balance),
        difficulty: this.cache.json.get(difficulty),
        enemies: this.cache.json.get(enemies),
      })
    } catch (err) {
      this.codexConfig = null
      this.state = withNotice(
        this.state,
        `怪物图鉴配置读不出来：${err instanceof Error ? err.message : String(err)}`,
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
      kb.addCapture(['SPACE', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'ENTER', 'ESC'])
      kb.on('keydown-UP', () => this.moveSelection(-1))
      kb.on('keydown-DOWN', () => this.moveSelection(1))
      kb.on('keydown-LEFT', () => this.moveSelection(-1))
      kb.on('keydown-RIGHT', () => this.moveSelection(1))
      kb.on('keydown-ENTER', () => this.activateFocused())
      kb.on('keydown-SPACE', () => this.activateFocused())
      kb.on('keydown-ESC', () => this.escape())
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => kb.removeAllListeners())
    }

    const moveTooltip = (pointer: Phaser.Input.Pointer): void => {
      this.mapTooltip?.move(pointer)
    }
    this.input.on(Phaser.Input.Events.POINTER_MOVE, moveTooltip)
    this.disposers.push(() => this.input.off(Phaser.Input.Events.POINTER_MOVE, moveTooltip))

    // RESIZE 模式下窗口尺寸就是画布尺寸，所以**每次变化都要重新排版**。
    // 不重排的症状是"窗口拉大之后按钮留在原地"，而那看起来像是布局写死了。
    const onResize = (): void => this.rebuild()
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize)
    this.disposers.push(() => this.scale.off(Phaser.Scale.Events.RESIZE, onResize))

    // 显示模式以浏览器实际状态为准。进入 / 退出全屏、以及玩家按 Esc 退出，
    // Phaser 都会发事件；在这些事件之后写档，才能避免“按钮显示全屏、
    // 实际却已经回到窗口”的假状态。
    const syncDisplayMode = (): void => {
      this.store.syncDisplayMode(this.scale.isFullscreen)
      this.refresh()
    }
    const fullscreenFailed = (): void => {
      this.state = withNotice(this.state, '全屏切换失败，浏览器未进入全屏')
      this.refresh()
    }
    this.scale.on(Phaser.Scale.Events.ENTER_FULLSCREEN, syncDisplayMode)
    this.scale.on(Phaser.Scale.Events.LEAVE_FULLSCREEN, syncDisplayMode)
    this.scale.on(Phaser.Scale.Events.FULLSCREEN_FAILED, fullscreenFailed)
    this.scale.on(Phaser.Scale.Events.FULLSCREEN_UNSUPPORTED, fullscreenFailed)
    this.disposers.push(() => {
      this.scale.off(Phaser.Scale.Events.ENTER_FULLSCREEN, syncDisplayMode)
      this.scale.off(Phaser.Scale.Events.LEAVE_FULLSCREEN, syncDisplayMode)
      this.scale.off(Phaser.Scale.Events.FULLSCREEN_FAILED, fullscreenFailed)
      this.scale.off(Phaser.Scale.Events.FULLSCREEN_UNSUPPORTED, fullscreenFailed)
    })
    syncDisplayMode()

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

  private moveSelection(delta: number): void {
    if (this.state.screen === 'codex') {
      this.codexPanel?.moveSelection(delta)
      return
    }
    this.moveFocus(delta)
  }

  private activateFocused(): void {
    if (this.state.screen === 'codex') {
      this.codexPanel?.activate()
      return
    }
    if (this.state.screen !== 'main') return
    this.run(focusedAction(this.state))
  }

  private hoverAction(action: MenuAction, pointer: Phaser.Input.Pointer): void {
    if (this.state.screen !== 'main') return
    this.hoveredAction = action
    this.state = focusOn(this.state, action)
    this.refresh()
    this.mapTooltip?.show(hotspotForAction(action), MENU_ACTION_LABELS[action], pointer)
  }

  private leaveAction(action: MenuAction): void {
    if (this.hoveredAction !== action) return
    this.hoveredAction = null
    this.mapTooltip?.hide()
    this.refresh()
  }

  private escape(): void {
    if (this.state.screen === 'first-run') {
      this.finishFirstRunTutorial(false)
      return
    }
    if (this.state.screen === 'codex' && this.codexPanel?.back()) return
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
        // 逸夫楼不是直接开打：先开「出发准备」页选角色与难度，确认后才进战斗。
        // ⚠️ 打开新屏的那次 pointerdown 会穿透到刚创建出来的控件上（实测：点逸夫楼
        // 会顺手「点」到下面那张角色卡，冒出一条莫名其妙的未解锁提示；换个窗口尺寸
        // 就可能直接点到「开始闯关」）。开屏后短暂忽略指针输入，键盘不受影响。
        this.inputGuardUntil = this.game.loop.time + 250
        this.state = openScreen(this.state, 'run-setup')
        this.rebuild()
        break
      case 'upgrade':
        // 默认先看当前出战角色；进入升级页后再由顶部选择器切换升级对象。
        this.upgradeCharacterId = this.store.profile.selected.characterId
        this.state = openScreen(this.state, 'upgrade')
        this.rebuild()
        break
      case 'help':
        this.state = openScreen(this.state, 'help')
        this.rebuild()
        break
      case 'achievements':
        this.state = openScreen(this.state, 'achievements')
        this.rebuild()
        break
      case 'settings':
        this.state = openScreen(this.state, 'settings')
        this.rebuild()
        break
      case 'codex':
        if (!this.codexConfig || this.codexEntries().length === 0) {
          this.state = withNotice(this.state, '怪物图鉴配置尚未加载完成')
          this.refresh()
          break
        }
        this.state = openScreen(this.state, 'codex')
        this.rebuild()
        break
      case 'quit':
        this.state = openScreen(this.state, 'confirm-quit')
        this.rebuild()
        break
    }
  }

  /** 首次引导的两个出口；两个出口都先落档，避免刷新后再次拦人。 */
  private finishFirstRunTutorial(startImmediately: boolean): void {
    this.store.markTutorialSeen()
    if (startImmediately) {
      this.inputGuardUntil = this.game.loop.time + 250
      this.state = openScreen(createMenuState(), 'run-setup')
      this.rebuild()
      return
    }
    this.inputGuardUntil = this.game.loop.time + 250
    this.state = createMenuState()
    this.rebuild()
  }

  /** 出发准备页的「开始闯关」。真正进战斗前才检查场景是否注册。 */
  private startRun(): void {
    if (this.pointerGuarded() || this.startingRun) return
    // ⚠️ 先确认 `battle` 真的注册过：只有产品入口会注册它（`main.ts` 的 scene
    // 列表），D4 的测试场（`test.html?arena=d4_main_menu`）里没有战斗场景 ——
    // 在那边直接 start 是静默什么都不发生，而"按下去没反应"看起来就是菜单坏了。
    if (!this.scene.manager.keys['battle']) {
      this.state = withNotice(this.state, '这个入口没有注册战斗场景（产品入口里才有）')
      this.refresh()
      return
    }
    // 难度一起带上：出发准备页摆着难度三选一，不传的话那个选择只是个摆设。
    this.startingRun = true
    this.scene.start('battle', {
      difficulty: this.store.profile.selected.difficulty,
      characterId: this.store.profile.selected.characterId,
    })
  }

  /** 刚开屏的 250ms 内忽略指针点击，挡掉穿透过来的 pointerdown。 */
  private pointerGuarded(): boolean {
    return this.game.loop.time < this.inputGuardUntil
  }

  // ------------------------------------------------------------------ 构建

  private rebuild(): void {
    this.clearObjects()
    const W = this.scale.width
    const H = this.scale.height

    this.buildBackdrop(W, H)
    this.buildCampusMain(W, H)
    // 主菜单始终保留在地图下面；设置、成就等弹层盖在其上。
    if (this.state.screen !== 'main') this.buildOverlay(W, H, this.state.screen)
    this.saveBanner = new SaveStatusBanner(this, this.store, W / 2, 44, W)

    this.refresh()
  }

  private clearObjects(): void {
    this.saveBanner?.destroy()
    this.saveBanner = null
    for (const hotspot of this.hotspots.values()) hotspot.destroy()
    this.hotspots.clear()
    this.mapTooltip?.destroy()
    this.mapTooltip = null
    this.hoveredAction = null
    this.roleSummaryText = null
    this.difficultySummaryText = null
    for (const o of this.objects) o.destroy()
    this.objects = []
    this.settingsParts = null
    this.noticeText = null
    this.codexPanel = null
  }

  private track<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.objects.push(obj)
    return obj
  }

  private buildBackdrop(W: number, H: number): void {
    this.track(this.add.rectangle(W / 2, H / 2, W, H, THEME.color.backdrop).setDepth(-10))
    const shade = this.track(this.add.graphics().setDepth(-8))
    shade
      .fillGradientStyle(0x07131f, 0x0d1c20, 0x13251d, 0x02070c, 1, 0.85, 0.95, 1)
      .fillRect(0, 0, W, H)
  }

  private buildCampusMain(W: number, H: number): void {
    const mapScale = Math.min((W - 16) / CAMPUS_MAP_SIZE.width, (H - 16) / CAMPUS_MAP_SIZE.height)
    const mapWidth = CAMPUS_MAP_SIZE.width * mapScale
    const mapHeight = CAMPUS_MAP_SIZE.height * mapScale
    const offsetX = (W - mapWidth) / 2
    const offsetY = (H - mapHeight) / 2

    const mapLayer = this.track(this.add.container(offsetX, offsetY).setScale(mapScale))
    const mapTexture = textureKeyFor(this, CAMPUS_MENU_ART.map)
    const map = this.add
      .image(0, 0, mapTexture)
      .setOrigin(0)
      .setDisplaySize(CAMPUS_MAP_SIZE.width, CAMPUS_MAP_SIZE.height)
    map.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
    mapLayer.add(map)

    const frame = this.add.graphics()
    frame.lineStyle(4, THEME.color.mapGlowSoft, 0.95)
    frame.strokeRoundedRect(0, 0, CAMPUS_MAP_SIZE.width, CAMPUS_MAP_SIZE.height, 6)
    mapLayer.add(frame)

    for (const def of CAMPUS_HOTSPOTS) {
      const hotspot = new CampusHotspot(this, def, {
        onHover: (action, pointer) => this.hoverAction(action, pointer),
        onLeave: (action) => this.leaveAction(action),
        onClick: (action) => this.run(action),
      })
      mapLayer.add([...hotspot.parts])
      this.hotspots.set(def.action, hotspot)
    }

    this.buildMapChrome(W, H)
    this.mapTooltip = new CampusTooltip(this)
    this.noticeText = this.track(
      this.add
        .text(W / 2, H - 18, '', {
          fontFamily: THEME.font.family,
          fontSize: fontPx(THEME.font.small),
          color: THEME.text.accent,
          padding: { left: 12, right: 12, top: 5, bottom: 5 },
          backgroundColor: '#07131ed9',
        })
        .setOrigin(0.5, 1)
        .setResolution(Math.min(window.devicePixelRatio || 1, 2)),
    )
  }

  private buildMapChrome(W: number, H: number): void {
    const narrow = W < 760
    const titleWidth = narrow ? W - 32 : 316
    const titleHeight = 94
    const title = this.track(this.add.graphics())
    title.fillStyle(THEME.color.mapInk, 0.86)
    title.fillRoundedRect(16, 16, titleWidth, titleHeight, 10)
    title.lineStyle(1, THEME.color.mapGlow, 0.72)
    title.strokeRoundedRect(16, 16, titleWidth, titleHeight, 10)
    title.fillStyle(THEME.color.mapGlow, 0.9)
    title.fillRect(16, 16, 5, titleHeight)

    this.track(
      this.add
        .text(36, 27, '课后勇者', {
          fontFamily: 'KaiTi, STKaiti, SimSun, serif',
          fontSize: fontPx(narrow ? 25 : 31),
          color: THEME.text.body,
        })
        .setLetterSpacing(2),
    )
    this.track(
      this.add.text(37, 66, 'BJTU CAMPUS  ·  放学后的异次元', {
        fontFamily: THEME.font.family,
        fontSize: fontPx(10),
        color: THEME.text.accent,
      }),
    )
    this.track(
      this.add.text(37, 84, '悬停查看功能，点击建筑进入', {
        fontFamily: THEME.font.family,
        fontSize: fontPx(THEME.font.small),
        color: THEME.text.dim,
      }),
    )

    const controlsWidth = 160
    const controlsX = narrow ? 16 : W - controlsWidth - 16
    const controlsY = narrow ? 120 : 16
    const controls = this.track(this.add.graphics())
    controls.fillStyle(THEME.color.mapInk, 0.86)
    controls.fillRoundedRect(controlsX, controlsY, controlsWidth, 94, 10)
    controls.lineStyle(1, THEME.color.mapGlow, 0.62)
    controls.strokeRoundedRect(controlsX, controlsY, controlsWidth, 94, 10)

    // 这里只显示当前选择，**不再做第二个选择入口**：角色与难度统一在
    // 逸夫楼的「出发准备」页里选，避免同一件事有两个入口、两套高亮。
    this.track(
      this.add.text(controlsX + 14, controlsY + 11, '今日出战', {
        fontFamily: THEME.font.family,
        fontSize: fontPx(10),
        color: THEME.text.dim,
      }),
    )
    this.roleSummaryText = this.track(
      this.add.text(controlsX + 14, controlsY + 29, '', {
        fontFamily: THEME.font.family,
        fontSize: fontPx(THEME.font.body),
        color: THEME.text.body,
      }),
    )
    this.difficultySummaryText = this.track(
      this.add.text(controlsX + 14, controlsY + 52, '', {
        fontFamily: THEME.font.family,
        fontSize: fontPx(THEME.font.small),
        color: THEME.text.accent,
      }),
    )
    this.track(
      this.add.text(controlsX + 14, controlsY + 74, '点击逸夫楼出发', {
        fontFamily: THEME.font.family,
        fontSize: fontPx(10),
        color: THEME.text.dim,
      }),
    )

    const shortcut = narrow ? '方向键选择 · Enter 确认' : '方向键选择  ·  Enter 确认  ·  Esc 返回'
    this.track(
      this.add
        .text(W - 18, H - 18, shortcut, {
          fontFamily: THEME.font.family,
          fontSize: fontPx(10),
          color: '#d8c28c',
          backgroundColor: '#07131ed9',
          padding: { left: 8, right: 8, top: 4, bottom: 4 },
        })
        .setOrigin(1, 1),
    )
  }

  private buildOverlay(_W: number, _H: number, screen: Exclude<MenuState['screen'], 'main'>): void {
    const sink: OverlaySink = {
      track: (obj) => this.track(obj),
      button: (button) => {
        for (const part of button.parts) this.track(part)
      },
    }
    const light =
      screen === 'codex' || screen === 'help' || screen === 'achievements' || screen === 'first-run'
    const ui = new ArchiveUI(
      this,
      sink,
      MainMenuScene.OVERLAY_TITLES[screen],
      () => {
        if (screen === 'first-run') {
          this.finishFirstRunTutorial(false)
          return
        }
        this.codexDetail = false
        this.state = closeScreen(this.state) ?? this.state
        this.rebuild()
      },
      light,
      screen === 'first-run' ? '跳过引导  ×' : undefined,
    )
    this.noticeText = ui.label(800, 882, '', THEME.font.heading).setOrigin(0.5, 1)
    switch (screen) {
      case 'first-run':
        buildNotebookFirstRun(ui, () => this.finishFirstRunTutorial(true))
        break
      case 'upgrade':
        buildUpgradePanel(
          ui,
          this.store,
          this.meta,
          this.currentUpgradeCharacterId(),
          (id) => {
            this.upgradeCharacterId = id
          },
          (notice) => {
            this.state = withNotice(this.state, notice)
            this.rebuild()
          },
        )
        break
      case 'codex':
        this.codexPanel = new CodexPanel(ui, {
          entries: this.codexEntries(),
          selectedId: this.codexSelectionId,
          detail: this.codexDetail,
          difficultyLabel: DIFFICULTY_LABELS[this.store.profile.selected.difficulty],
          onSelect: (entry) => {
            this.codexSelectionId = entry.id
          },
          onDetail: (detail) => {
            this.codexDetail = detail
          },
        })
        break
      case 'achievements':
        buildNotebookAchievements(ui, this.store.profile)
        break
      case 'help':
        buildNotebookHelp(ui)
        break
      case 'settings':
        this.settingsParts = buildNotebookSettings(ui, this.store, (mode) =>
          this.setDisplayMode(mode),
        )
        break
      case 'run-setup':
        buildNotebookRunSetup(
          ui,
          this.store.profile,
          this.meta,
          (id) => {
            this.pickCharacter(id)
            this.rebuild()
          },
          (difficulty) => {
            this.pickDifficulty(difficulty)
            this.rebuild()
          },
          () => this.startRun(),
          () => this.run('upgrade'),
        )
        break
      case 'confirm-quit':
        buildNotebookQuit(
          ui,
          this.store.profile,
          () => this.confirmQuit(),
          () => this.escape(),
        )
        break
    }
  }

  // ------------------------------------------------------------------ 行为

  private codexEntries(): readonly CodexEntry[] {
    if (!this.codexConfig) return []
    return buildCodexEntries(
      this.codexConfig, this.store.profile.selected.difficulty,
      codexEncounterConfig(this.cache.json.get('combat.json')),
      codexBossSkillConfig(this.cache.json.get('boss-skills.json')),
    )
  }

  /**
   * 升级页要操作的角色。
   *
   * 优先用页面里刚才切到的那个（未解锁角色也能预览和购买）；配置缺失时退回当前出战角色，
   * 再不行就找第一个已解锁且配置齐全的角色。**这里不写 `selected.characterId`。**
   */
  private currentUpgradeCharacterId(): string {
    const profile = this.store.profile
    const usable = (id: string): boolean =>
      Boolean(this.meta?.characters[id]) && isUnlocked(profile, id)

    if (this.upgradeCharacterId && this.meta?.characters[this.upgradeCharacterId]) {
      return this.upgradeCharacterId
    }

    const preferred = profile.selected.characterId
    if (usable(preferred)) {
      this.upgradeCharacterId = preferred
      return preferred
    }

    const fallback = CHARACTERS.find((candidate) => usable(candidate.id))
    if (fallback) {
      this.upgradeCharacterId = fallback.id
      return fallback.id
    }

    // 连初始角色都没配置 / 没解锁时保留原 id，让升级页照实报「没有成长配置」。
    this.upgradeCharacterId = preferred
    return preferred
  }

  private pickCharacter(id: string): void {
    if (this.pointerGuarded()) return
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
    if (this.pointerGuarded()) return
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

    for (const [action, hotspot] of this.hotspots) {
      hotspot.setState(
        this.state.screen === 'main' && action === focus,
        this.hoveredAction === action,
      )
    }

    const name = characterById(p.selected.characterId)?.name ?? p.selected.characterId
    this.roleSummaryText?.setText(`角色 · ${name}`)
    this.difficultySummaryText?.setText(`难度 · ${DIFFICULTY_LABELS[p.selected.difficulty]}`)

    this.settingsParts?.refresh()
    this.saveBanner?.refresh()

    if (this.noticeText) {
      this.noticeText.setText(this.state.notice)
    }
  }
}
