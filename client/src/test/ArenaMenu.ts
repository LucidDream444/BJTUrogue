/**
 * 测试场菜单。**唯一一个会读目录的场景。**
 *
 * 键盘从 `1` 开始选，或者直接点。菜单本身不长在任何一个场子里，
 * 所以场子坏了也进得去菜单（这是刻意的：坏掉的场子要能从这里被切掉）。
 *
 * ---
 *
 * ## 白箱：菜单里没有任何「美术」
 *
 * 全部是 `Text`。菜单也是一个调试设施 —— 它不需要好看，
 * 它需要**在你把场子搞坏的时候还能用**。
 *
 * ## 为什么有滚动
 *
 * 场子会一直加；26 个场子时一屏放不下。**不能把后面的场子放到屏幕外**
 * 就当作不存在 —— 那会让新增场子的人以为自己的场子没被注册。
 * 这里用容器 + 几何遮罩固定标题和底部提示，只滚动中间的行；
 * 鼠标滚轮、↑↓、PgUp/PgDn、Home/End 都能滚。
 */

import Phaser from 'phaser'
import { MENU_SCENE_KEY, formatArenaIds, parseArenaQuery, type ArenaEntry } from './arenaCatalog'
import { ARENAS, findArena } from './registry'

/**
 * 行高。菜单项之间靠它排开。
 *
 * 一行占的是「20px 的标题 + 往下 22px 的 12px 说明」≈ 37px，所以 34 会让
 * **说明压在下一项的标题上**（真的发生过 —— 4 个场子时每一行都在互相挤）。
 * 取 42 留一点余量。
 */
const LINE = 42
/** 第一项从哪一行开始 */
const FIRST_ROW_Y = 180
/** 滚动视口的顶部：标题和说明留在视口外，不跟着滚 */
const LIST_TOP = 150
/** 视口底部到窗口底部的留白：底部提示固定在窗口底 */
const LIST_BOTTOM_MARGIN = 92

export class ArenaMenu extends Phaser.Scene {
  private list: Phaser.GameObjects.Container | null = null
  private maskShape: Phaser.GameObjects.Graphics | null = null
  private scrollTrack: Phaser.GameObjects.Graphics | null = null
  private scrollThumb: Phaser.GameObjects.Graphics | null = null
  private scrollY = 0
  private maxScroll = 0
  private viewportHeight = 0
  private viewportBottom = 0
  private screenWidth = 0
  /** 只用来处理遮罩外的行仍然可点的问题：遮罩是视觉裁剪，不会自动关输入。 */
  private readonly rows: { label: Phaser.GameObjects.Text; description: Phaser.GameObjects.Text }[] = []

  constructor() {
    super(MENU_SCENE_KEY)
  }

  create(): void {
    const width = this.scale.width
    const height = this.scale.height
    this.screenWidth = width
    this.viewportBottom = height - LIST_BOTTOM_MARGIN

    this.add
      .text(width / 2, 60, '测试场', {
        fontFamily: 'monospace',
        fontSize: '32px',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0)

    this.add
      .text(
        width / 2,
        108,
        '白箱调试设施 —— 不是游戏。数字键或鼠标选择，场子里按 Esc 回来。',
        { fontFamily: 'monospace', fontSize: '14px', color: '#7a7a90' },
      )
      .setOrigin(0.5, 0)

    const requested = parseArenaQuery(window.location.search)
    if (requested !== null) {
      // URL 里点名了一个场子就直接进，不弹菜单 —— 但**先注册再启动**，
      // 否则 `scene.start` 会抛「场景不存在」。
      const picked = findArena(requested)
      if (picked) {
        this.scene.start(sceneKeyOf(picked))
        return
      }
      // 认不出来的 id 要**响亮**：安静地退回菜单的话，打开的人会以为
      // 「?arena=xxx 这个功能坏了」，而不是「我拼错了」。
      this.add
        .text(
          width / 2,
          height - 120,
          `认不出 ?arena=${requested}\n可用的：${formatArenaIds(ARENAS)}`,
          { fontFamily: 'monospace', fontSize: '14px', color: '#ff6b6b', align: 'center' },
        )
        .setOrigin(0.5, 0)
    }

    if (ARENAS.length === 0) {
      // 目录是空的只可能是 `import.meta.glob` 的路径错了。这是**代码问题**，
      // 不是「还没有场子」—— 所以要说清楚，否则下一个人会以为是正常的。
      this.add
        .text(width / 2, height / 2, '目录是空的：检查 registry.ts 里 import.meta.glob 的路径', {
          fontFamily: 'monospace',
          fontSize: '16px',
          color: '#ff6b6b',
        })
        .setOrigin(0.5)
      return
    }

    // 标题/说明固定；场子列表放进一个可滚动容器，用几何遮罩裁在视口里。
    this.viewportHeight = Math.max(1, this.viewportBottom - LIST_TOP)
    this.list = this.add.container(0, 0)
    this.maskShape = this.make.graphics({ x: 0, y: 0 }, false)
    this.maskShape.fillStyle(0xffffff, 1).fillRect(0, LIST_TOP, width, this.viewportHeight)
    this.list.setMask(this.maskShape.createGeometryMask())

    ARENAS.forEach((entry, i) => this.addRow(entry, i, this.list!))

    // 内容最后一行（连同说明）到列表顶部的距离；多留 8px 给文字下沿。
    const contentBottom = FIRST_ROW_Y + ARENAS.length * LINE + 8
    this.maxScroll = Math.max(0, contentBottom - this.viewportBottom)
    this.createScrollbar(width)
    this.bindScroll()
    this.setScroll(0)

    this.add
      .text(
        width / 2,
        height - 48,
        `共 ${ARENAS.length} 个场子 · 滚轮 / ↑↓ / PgUp PgDn 滚动 · 这是调试设施，不是产品的一部分`,
        { fontFamily: 'monospace', fontSize: '12px', color: '#4a4a5a' },
      )
      .setOrigin(0.5, 0)
  }

  private addRow(entry: ArenaEntry, index: number, parent: Phaser.GameObjects.Container): void {
    const width = this.scale.width
    const y = FIRST_ROW_Y + index * LINE

    const label = this.add
      .text(width / 2, y, `${index + 1}  ${entry.displayName}`, {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#9ad4ff',
      })
      .setOrigin(0.5, 0)

    const description = this.add
      .text(width / 2, y + 22, entry.description, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#6a6a80',
        wordWrap: { width: width - 80 },
        align: 'center',
      })
      .setOrigin(0.5, 0)

    parent.add([label, description])
    this.rows.push({ label, description })

    // 点名字进，或者按数字键。**点击范围比文字宽一点** ——
    // 一行 20px 的字很难点中，那是「功能没做」和「不好用」的差别。
    label.setInteractive({ useHandCursor: true })
    label.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.scene.start(sceneKeyOf(entry)))
    label.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => label.setColor('#ffffff'))
    label.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => label.setColor('#9ad4ff'))

    // 只有前 9 个能按数字键选中 —— 超过 9 个场子时后面的只能点/滚。
    // **不假装支持更多**：静默地把第 10 个场子做成「按 0 进」比不支持更糟。
    if (index < 9) {
      const keyName = DIGIT_KEY_NAMES[index]!
      this.input.keyboard?.on(`keydown-${keyName}`, () => this.scene.start(sceneKeyOf(entry)))
    }
  }

  private createScrollbar(width: number): void {
    const x = width - 24
    this.scrollTrack = this.add.graphics().setDepth(20)
    this.scrollTrack
      .fillStyle(0x22283a, 0.9)
      .fillRoundedRect(x, LIST_TOP, 6, this.viewportHeight, 3)
    this.scrollThumb = this.add.graphics().setDepth(21)
  }

  private bindScroll(): void {
    this.input.on(
      'wheel',
      (
        _pointer: Phaser.Input.Pointer,
        _over: unknown,
        _deltaX: number,
        deltaY: number,
      ) => {
        this.setScroll(this.scrollY + deltaY * 0.5)
      },
    )

    this.input.keyboard?.addCapture([
      Phaser.Input.Keyboard.KeyCodes.UP,
      Phaser.Input.Keyboard.KeyCodes.DOWN,
      Phaser.Input.Keyboard.KeyCodes.PAGE_UP,
      Phaser.Input.Keyboard.KeyCodes.PAGE_DOWN,
      Phaser.Input.Keyboard.KeyCodes.HOME,
      Phaser.Input.Keyboard.KeyCodes.END,
    ])
    const page = Math.max(LINE, this.viewportHeight * 0.8)
    this.input.keyboard?.on('keydown-DOWN', () => this.setScroll(this.scrollY + LINE))
    this.input.keyboard?.on('keydown-UP', () => this.setScroll(this.scrollY - LINE))
    this.input.keyboard?.on('keydown-PAGE_DOWN', () => this.setScroll(this.scrollY + page))
    this.input.keyboard?.on('keydown-PAGE_UP', () => this.setScroll(this.scrollY - page))
    this.input.keyboard?.on('keydown-HOME', () => this.setScroll(0))
    this.input.keyboard?.on('keydown-END', () => this.setScroll(this.maxScroll))
  }

  private setScroll(value: number): void {
    this.scrollY = Phaser.Math.Clamp(value, 0, this.maxScroll)
    if (this.list !== null) this.list.y = -this.scrollY
    this.updateRowVisibility()
    this.drawScrollbar()
  }

  /** 让遮罩外的行彻底不可交互；否则点标题/底部提示可能命中看不见的行。 */
  private updateRowVisibility(): void {
    for (const row of this.rows) {
      const top = row.label.y + (this.list?.y ?? 0)
      const bottom = top + LINE
      const visible = bottom >= LIST_TOP && top <= this.viewportBottom
      row.label.setVisible(visible)
      row.description.setVisible(visible)
      if (visible) row.label.setInteractive({ useHandCursor: true })
      else row.label.disableInteractive()
    }
  }

  private drawScrollbar(): void {
    const thumb = this.scrollThumb
    if (thumb === null) return
    const width = this.screenWidth
    const x = width - 24
    thumb.clear()
    if (this.maxScroll <= 0) return

    const contentHeight = this.viewportHeight + this.maxScroll
    const thumbHeight = Math.max(24, (this.viewportHeight * this.viewportHeight) / contentHeight)
    const travel = this.viewportHeight - thumbHeight
    const thumbY = LIST_TOP + (this.scrollY / this.maxScroll) * travel
    thumb.fillStyle(0x8a91a8, 1).fillRoundedRect(x, thumbY, 6, thumbHeight, 3)
  }
}

/** Phaser 的按键名（不是字符）。`'0'` 在 Phaser 里叫 `ZERO`，不是 `'0'`。 */
const DIGIT_KEY_NAMES = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE']

/**
 * 把场子注册进游戏。
 *
 * **在一个函数里做**，而不是让 `launcherMain.ts` 自己拼 —— 因为
 * 「菜单 + 每个场子」都要注册，漏一个的报错是运行时的「场景不存在」，
 * 而那个报错不会告诉你漏了哪个。
 */
export function registerArenaScenes(game: Phaser.Game): void {
  game.scene.add(MENU_SCENE_KEY, ArenaMenu, true)
  for (const entry of ARENAS) {
    // `autoStart: false` —— 场子只在被选中时才创建。
    // 传 true 的话所有场子会同时在后台跑（每个都建一个 EnemySystem 和物理世界）。
    game.scene.add(sceneKeyOf(entry), entry.scene, false)
  }
}

/**
 * 场子场景的 key。
 *
 * ⚠️ **必须用一个显式的字符串 key，不能靠「传类进去」。**
 * `[源码]` `SceneManager.getScene(key)`：`key` 是字符串时查 `keys` 表；
 * 否则在 `scenes` 数组里找**同一个对象**。所以 `scene.start(SomeClass)`
 * 只在那个类**恰好就是已实例化的那个场景对象**时才会命中 —— 传类进去得到的是
 * `null`，然后是一场「场景不存在」的警告，而画面停在原地什么都不发生。
 * 这类失败很难查，因为不抛异常。
 */
export function sceneKeyOf(entry: ArenaEntry): string {
  return `arena:${entry.id}`
}
