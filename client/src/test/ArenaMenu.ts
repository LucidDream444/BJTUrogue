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
 */

import Phaser from 'phaser'
import { MENU_SCENE_KEY, formatArenaIds, parseArenaQuery, type ArenaEntry } from './arenaCatalog'
import { ARENAS, findArena } from './registry'

/** 行高。菜单项之间靠它排开 */
const LINE = 34
/** 第一项从哪一行开始 */
const FIRST_ROW_Y = 180

export class ArenaMenu extends Phaser.Scene {
  constructor() {
    super(MENU_SCENE_KEY)
  }

  create(): void {
    const width = this.scale.width
    const height = this.scale.height

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

    ARENAS.forEach((entry, i) => this.addRow(entry, i))

    this.add
      .text(width / 2, height - 48, '这是调试设施，不是产品的一部分。见 src/test/README.md', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#4a4a5a',
      })
      .setOrigin(0.5, 0)
  }

  private addRow(entry: ArenaEntry, index: number): void {
    const width = this.scale.width
    const y = FIRST_ROW_Y + index * LINE

    const label = this.add
      .text(width / 2, y, `${index + 1}  ${entry.displayName}`, {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#9ad4ff',
      })
      .setOrigin(0.5, 0)

    this.add
      .text(width / 2, y + 22, entry.description, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#6a6a80',
        wordWrap: { width: width - 80 },
        align: 'center',
      })
      .setOrigin(0.5, 0)

    // 点名字进，或者按数字键。**点击范围比文字宽一点** ——
    // 一行 20px 的字很难点中，那是「功能没做」和「不好用」的差别。
    label.setInteractive({ useHandCursor: true })
    label.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.scene.start(sceneKeyOf(entry)))
    label.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => label.setColor('#ffffff'))
    label.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => label.setColor('#9ad4ff'))

    // 只有前 9 个能按数字键选中 —— 超过 9 个场子时后面的只能点。
    // **不假装支持更多**：静默地把第 10 个场子做成「按 0 进」比不支持更糟。
    if (index < 9) {
      const keyName = DIGIT_KEY_NAMES[index]!
      this.input.keyboard?.on(`keydown-${keyName}`, () => this.scene.start(sceneKeyOf(entry)))
    }
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