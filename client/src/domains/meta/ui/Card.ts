/**
 * 角色卡控件（需求 §4.1 的「角色卡 × 4」）。
 *
 * 三种状态和 `Button` 一样是**叠加**的：已选中 / 未解锁 / 悬停。
 * 区别在于卡片要同时显示"名字 + 定位 + 立绘位"，而且**未解锁必须有可见的说明**
 * ——需求原文是「点击未解锁卡：不切换，提示『未解锁』」，也就是说
 * **玩家在点之前就该看出来它没解锁**，而不是点完才知道。
 *
 * ## 立绘位是**虚线框**
 *
 * 这是需求草图上明确画的（「卡内虚线区为立绘占位」）。虚线在这里不只是好看：
 * 实线框看起来像"里面有东西但没加载出来"，虚线框才是"这里本来就还没有东西"。
 * 占位期全靠这个区分，不然会有人来报"角色立绘是透明的"。
 */

import Phaser from 'phaser'
import type { CharacterDef } from '../catalog'
import { dashRect } from './dashed'
import { THEME, fontPx } from './theme'

export interface CardOptions {
  width?: number
  height?: number
}

export class Card {
  readonly id: string
  private readonly bg: Phaser.GameObjects.Rectangle
  private readonly frame: Phaser.GameObjects.Graphics
  private readonly nameText: Phaser.GameObjects.Text
  private readonly blurbText: Phaser.GameObjects.Text
  private readonly badge: Phaser.GameObjects.Text
  private readonly hit: Phaser.GameObjects.Rectangle

  private readonly width: number
  private readonly height: number
  private readonly x: number
  private readonly y: number

  private selected = false
  private locked = false
  private hovered = false

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    def: CharacterDef,
    onClick: () => void,
    options: CardOptions = {},
  ) {
    this.id = def.id
    this.x = x
    this.y = y
    this.width = options.width ?? THEME.card.width
    this.height = options.height ?? THEME.card.height

    this.bg = scene.add.rectangle(x, y, this.width, this.height, THEME.color.panel)
    this.bg.setStrokeStyle(2, THEME.color.border)

    this.frame = scene.add.graphics()

    this.nameText = scene.add
      .text(x, y + this.height / 2 - 52, def.name, {
        fontFamily: THEME.font.family,
        fontSize: fontPx(THEME.font.heading),
        color: THEME.text.body,
      })
      .setOrigin(0.5)

    this.blurbText = scene.add
      .text(x, y + this.height / 2 - 26, def.blurb, {
        fontFamily: THEME.font.family,
        fontSize: fontPx(THEME.font.small),
        color: THEME.text.dim,
      })
      .setOrigin(0.5)

    this.badge = scene.add
      .text(x, y - this.height / 2 + 14, '', {
        fontFamily: THEME.font.family,
        fontSize: fontPx(THEME.font.small),
        color: THEME.text.accent,
      })
      .setOrigin(0.5)

    // 点击判定用一个和卡片等大的透明矩形：卡片本身是 Rectangle，
    // 但它身上还压着文字与虚线框，直接让 bg 收事件会被上层对象挡住。
    this.hit = scene.add
      .rectangle(x, y, this.width, this.height, THEME.color.dim, 0)
      .setInteractive({ useHandCursor: true })

    this.hit.on('pointerover', () => {
      this.hovered = true
      this.paint()
    })
    this.hit.on('pointerout', () => {
      this.hovered = false
      this.paint()
    })
    this.hit.on('pointerdown', onClick)

    this.paint()
  }

  setSelected(value: boolean): void {
    this.selected = value
    this.paint()
  }

  setLocked(value: boolean): void {
    this.locked = value
    if (value) this.hovered = false
    this.paint()
  }

  destroy(): void {
    this.bg.destroy()
    this.frame.destroy()
    this.nameText.destroy()
    this.blurbText.destroy()
    this.badge.destroy()
    this.hit.destroy()
  }

  private paint(): void {
    const stroke = this.selected
      ? THEME.color.accent
      : this.hovered
        ? THEME.color.accent
        : THEME.color.border
    this.bg.setFillStyle(
      this.locked
        ? THEME.color.disabled
        : this.selected
          ? THEME.color.accentFill
          : THEME.color.panel,
    )
    this.bg.setStrokeStyle(this.selected ? 3 : 2, stroke)

    this.nameText.setColor(this.locked ? THEME.text.disabled : THEME.text.body)
    this.blurbText.setColor(this.locked ? THEME.text.disabled : THEME.text.dim)
    this.badge.setText(this.locked ? '未解锁' : this.selected ? '已选中' : '')
    this.badge.setColor(this.locked ? THEME.text.disabled : THEME.text.accent)

    this.drawFrame()
  }

  /** 立绘占位框：虚线的，一眼看出"这里还没有东西" */
  private drawFrame(): void {
    const pad = THEME.space.md
    const fw = this.width - pad * 2
    const fh = this.height * 0.42
    const x0 = this.x - fw / 2
    const y0 = this.y - this.height / 2 + pad
    const color = this.locked ? THEME.color.border : THEME.color.border

    this.frame.clear()
    this.frame.lineStyle(1, color, this.locked ? 0.5 : 1)
    dashRect(this.frame, x0, y0, fw, fh)

    if (this.locked) {
      this.frame.fillStyle(THEME.color.dim, 0.35)
      this.frame.fillRect(x0, y0, fw, fh)
    }
  }
}
