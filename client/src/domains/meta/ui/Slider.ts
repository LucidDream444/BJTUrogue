/**
 * 滑杆控件（需求 §4.3 的「游戏音量」、§4.5 的「BGM 音量 / 音效音量」）。
 *
 * ## 为什么拖拽用「指针的 x」而不是「滑块的位移」
 *
 * 用位移（`dragX`）的写法在容器里会串味：同一个滑块放进不同的父容器，
 * `dragX` 的参照系就变了，而症状是"拖起来偏一点"—— 这种偏差没人会当成 bug 报，
 * 大家只会觉得手感不好。用指针的**世界坐标**减去轨道左端，参照系永远是轨道本身。
 *
 * ## 值域只有 0..1
 *
 * 音量在两个界面里同时出现（暂停菜单与设置菜单），而且**必须是同一个值**
 * （需求 §4.5）。所以这里只存比例，百分比格式化留给界面 —— 两处各写一遍
 * `Math.round(v * 100)` 不算重复，但两处各写一遍**取整规则**就算。
 */

import Phaser from 'phaser'
import { THEME, fontPx } from './theme'

export interface SliderOptions {
  width?: number
  /** 值变化时回调。**拖动过程中会连续触发** —— 需求要求"拖动即时生效" */
  onChange?: (value: number) => void
  /** 显示成百分比（音量）。关掉的话右边显示原始值 */
  percent?: boolean
}

export class Slider {
  private readonly x: number
  private readonly width: number
  private readonly labelText: Phaser.GameObjects.Text
  private readonly valueText: Phaser.GameObjects.Text
  private readonly track: Phaser.GameObjects.Rectangle
  private readonly fill: Phaser.GameObjects.Rectangle
  private readonly knob: Phaser.GameObjects.Rectangle
  private readonly hit: Phaser.GameObjects.Rectangle
  private readonly onChange: ((value: number) => void) | undefined
  private readonly percent: boolean
  private value: number

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    label: string,
    value: number,
    options: SliderOptions = {},
  ) {
    this.x = x
    this.width = options.width ?? 240
    this.value = clamp01(value)
    this.onChange = options.onChange
    this.percent = options.percent ?? true

    this.labelText = scene.add
      .text(x, y - 18, label, {
        fontFamily: THEME.font.family,
        fontSize: fontPx(THEME.font.body),
        color: THEME.text.body,
      })
      .setOrigin(0, 0.5)

    this.valueText = scene.add
      .text(x + this.width, y - 18, '', {
        fontFamily: THEME.font.family,
        fontSize: fontPx(THEME.font.small),
        color: THEME.text.accent,
      })
      .setOrigin(1, 0.5)

    this.track = scene.add.rectangle(x + this.width / 2, y, this.width, 6, THEME.color.border)
    this.fill = scene.add
      .rectangle(x, y, this.width * this.value, 6, THEME.color.accent)
      .setOrigin(0, 0.5)
    this.knob = scene.add.rectangle(x + this.width * this.value, y, 12, 22, THEME.color.knob)
    this.knob.setStrokeStyle(2, THEME.color.accent)

    // 判定区比视觉上的轨道高得多（22px 的细条没人点得准），
    // 且完全透明 —— `alpha: 0` 不影响命中判定，Phaser 的命中只看向量。
    this.hit = scene.add
      .rectangle(x + this.width / 2, y, this.width, 26, THEME.color.dim, 0)
      .setInteractive({ useHandCursor: true })
    scene.input.setDraggable(this.hit)
    this.hit.on('dragstart', (p: Phaser.Input.Pointer) => this.fromPointer(p))
    this.hit.on('drag', (p: Phaser.Input.Pointer) => this.fromPointer(p))

    this.paint()
  }

  get current(): number {
    return this.value
  }

  /** 从档里读回来的值。**不触发 onChange** —— 否则"读档"会被当成"玩家改动"。 */
  setValue(value: number): void {
    this.value = clamp01(value)
    this.paint()
  }

  /** 这个滑杆画出来的所有显示对象（含那条透明的命中条）。见 `OverlayLayer` */
  get parts(): Phaser.GameObjects.GameObject[] {
    return [this.labelText, this.valueText, this.track, this.fill, this.knob, this.hit]
  }

  destroy(): void {
    this.labelText.destroy()
    this.valueText.destroy()
    this.track.destroy()
    this.fill.destroy()
    this.knob.destroy()
    this.hit.destroy()
  }

  private fromPointer(pointer: Phaser.Input.Pointer): void {
    // `worldX` 而不是 `x`：这一层没有相机缩放，两者现在相等，
    // 但哪天菜单加了"整屏缩放"，用 `x` 的写法会安静地错位。
    const next = clamp01((pointer.worldX - this.x) / this.width)
    if (next === this.value) return
    this.value = next
    this.paint()
    this.onChange?.(next)
  }

  private paint(): void {
    this.fill.setSize(this.width * this.value, 6)
    this.knob.setX(this.x + this.width * this.value)
    this.valueText.setText(
      this.percent ? `${Math.round(this.value * 100)}%` : this.value.toFixed(2),
    )
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
}
