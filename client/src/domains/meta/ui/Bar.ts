/**
 * 条形读数（"条形比例 + 当前 / 上限"）。需求 §4.2 / §4.3 里血量、护盾、魔法
 * 都是这个形状，D1 的战斗 HUD 也要用同一套。
 *
 * ## 值可以是 `null`
 *
 * 需求草图上画了护盾与魔法，但**当前没有任何配置表定义它们**
 * （`balance.json` 里玩家只有 `maxHp`）。所以宿主给不出值时传 `null`，
 * 界面显示「—」并且条是空的 —— **不显示一个煞有介事的 `0 / 0`**：
 * 那看起来像"玩家没血了"，而不是"这项还没做"。
 */

import Phaser from 'phaser'
import { THEME, fontPx } from './theme'

/** 标签占的宽度。所有 Bar 用同一个值，左对齐才会齐。 */
const LABEL_WIDTH = 56

export interface BarOptions {
  width?: number
  height?: number
  color?: number
}

export class Bar {
  private readonly track: Phaser.GameObjects.Rectangle
  private readonly fill: Phaser.GameObjects.Rectangle
  private readonly valueText: Phaser.GameObjects.Text
  private readonly label: Phaser.GameObjects.Text
  private readonly x: number
  private readonly width: number

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    label: string,
    value: number | null,
    max: number | null,
    options: BarOptions = {},
  ) {
    this.x = x + LABEL_WIDTH
    this.width = options.width ?? 150
    const height = options.height ?? 12
    const color = options.color ?? THEME.color.accent

    this.label = scene.add
      .text(x, y, label, {
        fontFamily: THEME.font.family,
        fontSize: fontPx(THEME.font.small),
        color: THEME.text.dim,
      })
      .setOrigin(0, 0.5)

    this.track = scene.add.rectangle(
      this.x + this.width / 2,
      y,
      this.width,
      height,
      THEME.color.border,
    )
    this.fill = scene.add.rectangle(this.x, y, this.width, height, color).setOrigin(0, 0.5)
    this.valueText = scene.add
      .text(this.x + this.width + THEME.space.sm, y, '', {
        fontFamily: THEME.font.family,
        fontSize: fontPx(THEME.font.small),
        color: THEME.text.body,
      })
      .setOrigin(0, 0.5)

    this.set(value, max)
  }

  set(value: number | null, max: number | null): void {
    if (value === null || max === null || !(max > 0)) {
      this.fill.setSize(0, this.fill.height)
      this.valueText.setText('—')
      return
    }
    const ratio = Math.min(1, Math.max(0, value / max))
    this.fill.setSize(this.width * ratio, this.fill.height)
    this.valueText.setText(`${Math.round(value)} / ${Math.round(max)}`)
  }

  destroy(): void {
    this.label.destroy()
    this.track.destroy()
    this.fill.destroy()
    this.valueText.destroy()
  }

  /** 给测试场的白箱读数用 */
  get text(): string {
    return this.valueText.text
  }

  get left(): number {
    return this.x
  }
}
