import Phaser from 'phaser'
import type { CharacterDef } from '../catalog'
import { THEME, fontPx } from './theme'

export interface CardOptions {
  width?: number
  height?: number
}

/** A campus ID card, with real student art and clear locked-character crests. */
export class Card {
  readonly id: string
  private readonly bg: Phaser.GameObjects.Rectangle
  private readonly frame: Phaser.GameObjects.Graphics
  private readonly nameText: Phaser.GameObjects.Text
  private readonly blurbText: Phaser.GameObjects.Text
  private readonly badge: Phaser.GameObjects.Text
  private readonly hit: Phaser.GameObjects.Rectangle
  private readonly portrait: Phaser.GameObjects.Image | null
  private readonly width: number
  private readonly height: number
  private selected = false
  private locked = false
  private hovered = false

  constructor(
    scene: Phaser.Scene,
    private readonly x: number,
    private readonly y: number,
    def: CharacterDef,
    onClick: () => void,
    options: CardOptions = {},
  ) {
    this.id = def.id
    this.width = options.width ?? THEME.card.width
    this.height = options.height ?? THEME.card.height
    this.bg = scene.add.rectangle(x, y, this.width, this.height, THEME.color.panel)
    this.frame = scene.add.graphics()
    const art: Record<string, string> = {
      student: 'player_student_idle_s',
      athlete: 'ui_campus_shield',
      scholar: 'ui_campus_book',
      leader: 'ui_campus_star_badge',
    }
    const key = art[def.id]
    this.portrait = key && scene.textures.exists(key) ? scene.add.image(x, y - 14, key, 0) : null
    if (this.portrait) {
      const size = def.id === 'student' ? 118 : 65
      this.portrait.setScale(size / Math.max(this.portrait.width, this.portrait.height))
      this.portrait.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
    }
    this.nameText = scene.add
      .text(x, y + this.height / 2 - 57, def.name, {
        fontFamily: THEME.font.family,
        fontSize: fontPx(17),
        color: THEME.text.body,
      })
      .setOrigin(0.5)
    this.blurbText = scene.add
      .text(x, y + this.height / 2 - 30, def.id === 'student' ? '均衡 · 初始角色' : '等待解锁', {
        fontFamily: THEME.font.family,
        fontSize: fontPx(11),
        color: THEME.text.dim,
      })
      .setOrigin(0.5)
    this.badge = scene.add
      .text(x, y - this.height / 2 + 22, '', {
        fontFamily: THEME.font.family,
        fontSize: fontPx(11),
        color: THEME.text.accent,
      })
      .setOrigin(0.5)
    this.hit = scene.add
      .rectangle(x, y, this.width, this.height, 0, 0)
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
    this.portrait?.destroy()
    this.nameText.destroy()
    this.blurbText.destroy()
    this.badge.destroy()
    this.hit.destroy()
  }

  private paint(): void {
    const accent = this.selected || this.hovered
    this.bg.setFillStyle(
      this.locked
        ? THEME.color.disabled
        : this.selected
          ? THEME.color.accentFill
          : THEME.color.panel,
    )
    this.bg.setStrokeStyle(
      accent ? 2 : 1,
      accent ? THEME.color.accent : THEME.color.border,
      this.locked ? 0.4 : 1,
    )
    this.nameText.setColor(this.locked ? '#99a28e' : THEME.text.body)
    this.badge.setText(this.locked ? '◇  尚未解锁' : this.selected ? '✓  今日出战' : '可选择')
    this.badge.setColor(this.locked ? THEME.text.dim : THEME.text.accent)
    this.portrait?.setAlpha(this.locked ? 0.34 : 1)
    const g = this.frame.clear(),
      x = this.x - this.width / 2,
      y = this.y - this.height / 2
    g.lineStyle(1, THEME.color.accent, this.locked ? 0.12 : 0.3).strokeRect(
      x + 6,
      y + 6,
      this.width - 12,
      this.height - 12,
    )
    g.fillStyle(0x97a478, this.locked ? 0.035 : 0.09).fillCircle(
      this.x,
      this.y - 14,
      Math.min(51, this.width * 0.34),
    )
    g.lineStyle(1, 0xbca06a, this.locked ? 0.14 : 0.35).strokeCircle(
      this.x,
      this.y - 14,
      Math.min(51, this.width * 0.34),
    )
    g.lineBetween(x + 18, y + this.height - 78, x + this.width - 18, y + this.height - 78)
    if (this.selected)
      g.fillStyle(THEME.color.accent).fillRect(x + 18, y + this.height - 3, this.width - 36, 3)
  }
}
