/**
 * 最小按钮控件。**D4 提供给全组的 UI 公共控件的第一块**
 * （《人员分工方案》§四：「各域界面必须基于公共控件搭建」）。
 *
 * ## 它为什么长这样
 *
 * 一个按钮有三种状态要同时能表达：**焦点 / 悬停 / 禁用**，而且它们会叠加
 * （有焦点的按钮被禁用、悬停在一个没有焦点的按钮上）。如果用"每加一个状态就
 * 新增一对颜色"的写法，三个状态就是 8 套颜色，其中一半没人验证过。
 * 所以这里是**一个 `paint()` 负责全部组合**，状态之间只有优先级。
 *
 * ## 键盘焦点归场景管
 *
 * 按钮**不自己处理按键**：焦点是"整屏里当前选中哪一个"，那是一个**集合**上的状态，
 * 单个按钮看不见它。场景拿着 `MenuState.focusIndex`，对每个按钮调 `setSelected()`。
 * 这样"按上下键"和"鼠标移到某个按钮上"才不会各写一套高亮逻辑。
 *
 * 鼠标点击落在按钮上时才走 `onClick` —— 没有"点空白处激活焦点按钮"这种行为，
 * 因为需求里没有这条，而它会让误触变得很容易（关闭弹层的点击落到下层按钮上）。
 */

import Phaser from 'phaser'
import { THEME, fontPx } from './theme'

export interface ButtonOptions {
  width?: number
  height?: number
  fontSize?: number
  /** 文字靠左（左栏那种长条按钮），默认居中 */
  align?: 'left' | 'center'
  /**
   * 在鼠标按下还是松开时触发。全屏 API 在部分浏览器只接受 `pointerup` 手势，
   * 这类按钮显式传 `'up'`；普通界面按钮保持即时的 `'down'`。
   */
  activateOn?: 'down' | 'up'
}

export class Button {
  private readonly bg: Phaser.GameObjects.Rectangle
  private readonly label: Phaser.GameObjects.Text
  private selected = false
  private disabled = false
  private hovered = false

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    text: string,
    private readonly onClick: () => void,
    options: ButtonOptions = {},
  ) {
    const width = options.width ?? THEME.button.width
    const height = options.height ?? THEME.button.height
    const align = options.align ?? 'center'

    this.bg = scene.add.rectangle(x, y, width, height, THEME.color.panel)
    this.bg.setStrokeStyle(2, THEME.color.border)
    this.bg.setInteractive({ useHandCursor: true })

    this.label = scene.add
      .text(align === 'left' ? x - width / 2 + THEME.space.md : x, y, text, {
        fontFamily: THEME.font.family,
        fontSize: fontPx(options.fontSize ?? THEME.font.body),
        color: THEME.text.body,
      })
      .setOrigin(align === 'left' ? 0 : 0.5, 0.5)

    this.bg.on('pointerover', () => {
      this.hovered = true
      this.paint()
    })
    this.bg.on('pointerout', () => {
      this.hovered = false
      this.paint()
    })
    this.bg.on(options.activateOn === 'up' ? 'pointerup' : 'pointerdown', () => {
      if (this.disabled) return
      this.onClick()
    })

    this.paint()
  }

  setSelected(value: boolean): void {
    this.selected = value
    this.paint()
  }

  setDisabled(value: boolean): void {
    this.disabled = value
    // 禁用时连悬停都不要有反应 —— 鼠标变成手型本身就是"可以点"的承诺
    if (value) {
      this.hovered = false
      this.bg.disableInteractive()
    } else {
      this.bg.setInteractive({ useHandCursor: true })
    }
    this.paint()
  }

  setText(text: string): void {
    this.label.setText(text)
  }

  /** 给测试场核对"点中的是哪个按钮"用的 */
  get labelText(): string {
    return this.label.text
  }

  /**
   * 这个按钮画出来的所有显示对象。
   *
   * 宿主把弹层整块搬进 `OverlayLayer`（见那个文件头）时要连它们一起搬 ——
   * 漏掉的话，按钮会留在原来的坐标系里，表现为"面板在屏幕上、按钮却歪着"。
   */
  get parts(): Phaser.GameObjects.GameObject[] {
    return [this.bg, this.label]
  }

  destroy(): void {
    this.bg.destroy()
    this.label.destroy()
  }

  /** 状态的**唯一**绘制点。加状态就在这里加一条分支，别在事件里各画一套。 */
  private paint(): void {
    if (this.disabled) {
      this.bg.setFillStyle(THEME.color.disabled)
      this.bg.setStrokeStyle(2, THEME.color.border)
      this.label.setColor(THEME.text.disabled)
      return
    }
    if (this.selected) {
      this.bg.setFillStyle(THEME.color.accentFill)
      this.bg.setStrokeStyle(3, THEME.color.accent)
      this.label.setColor(THEME.text.accent)
      return
    }
    this.bg.setFillStyle(this.hovered ? THEME.color.panelHover : THEME.color.panel)
    this.bg.setStrokeStyle(2, this.hovered ? THEME.color.accent : THEME.color.border)
    this.label.setColor(THEME.text.body)
  }
}
