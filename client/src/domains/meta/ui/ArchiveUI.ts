import Phaser from 'phaser'
import { ARCHIVE_ART, findAsset } from '@/core/assetManifest'
import { textureKeyFor } from '@/core/assets'
import type { OverlaySink } from './overlayFrame'
import { ARCHIVE_THEME as A, THEME } from './theme'

/** Illustrated notebook skin; all controls and content remain live Phaser objects. */
export class ArchiveUI {
  readonly root: Phaser.GameObjects.Container
  readonly width = 1600
  readonly height = 900
  readonly textColor: string
  readonly muted: string
  constructor(
    readonly scene: Phaser.Scene,
    sink: OverlaySink,
    title: string,
    onClose: () => void,
    readonly light = false,
    closeLabel = '返回校园  ×',
  ) {
    const W = scene.scale.width,
      H = scene.scale.height
    this.textColor = light ? A.pageText : A.paper
    this.muted = light ? A.pageMuted : A.muted
    sink.track(scene.add.rectangle(W / 2, H / 2, W, H, A.ink).setInteractive())
    const scale = Math.min(W / this.width, H / this.height)
    this.root = scene.add
      .container((W - this.width * scale) / 2, (H - this.height * scale) / 2)
      .setScale(scale)
    sink.track(this.root)
    this.image(light ? ARCHIVE_ART.light : ARCHIVE_ART.dark, 800, 450, 1600, 900)
    this.label(112, light ? 64 : 108, title, A.size.title, this.textColor, undefined, true)
    this.label(115, light ? 120 : 157, '课 后 勇 者   /   校 园 异 界', A.size.micro, this.muted)
    this.button(1255, 110, 184, 44, closeLabel, onClose)
  }
  add<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.root.add(obj)
    return obj
  }
  image(key: string, x: number, y: number, w: number, h = w): Phaser.GameObjects.Image {
    return this.add(this.scene.add.image(x, y, textureKeyFor(this.scene, key)).setDisplaySize(w, h))
  }
  label(
    x: number,
    y: number,
    value: string,
    size: number = A.size.body,
    color: string = this.textColor,
    wrap?: number,
    serif = false,
  ): Phaser.GameObjects.Text {
    return this.add(
      this.scene.add.text(x, y, value, {
        fontFamily: serif ? A.font : THEME.font.family,
        fontSize: size,
        color,
        fontStyle: serif ? 'bold' : 'normal',
        lineSpacing: 6,
        wordWrap: wrap ? { width: wrap, useAdvancedWrap: true } : undefined,
      }),
    )
  }
  rule(x: number, y: number, w: number): void {
    this.add(this.scene.add.graphics())
      .lineStyle(1, A.brass, 0.45)
      .lineBetween(x, y, x + w, y)
  }
  panel(x: number, y: number, w: number, h: number, opacity = 0.8): void {
    const g = this.add(this.scene.add.graphics())
    g.fillStyle(this.light ? A.page : A.glass, opacity).fillRoundedRect(x, y, w, h, 7)
    g.lineStyle(2, A.brass, 0.7).strokeRoundedRect(x, y, w, h, 7)
    g.lineStyle(1, A.light, 0.25).strokeRoundedRect(x + 4, y + 4, w - 8, h - 8, 5)
  }
  plaque(x: number, y: number, w: number, text: string, selected = false): void {
    const g = this.add(this.scene.add.graphics()),
      h = 42
    g.fillStyle(selected ? A.glass : A.ink, 0.8).fillRoundedRect(x - w / 2, y - h / 2, w, h, 4)
    g.lineStyle(1, selected ? A.cyan : A.brass, 0.8).strokeRoundedRect(
      x - w / 2,
      y - h / 2,
      w,
      h,
      4,
    )
    this.label(x, y, text, A.size.body, A.paper, undefined, true).setOrigin(0.5)
  }
  button(
    x: number,
    y: number,
    w: number,
    h: number,
    title: string,
    action: () => void,
    primary = false,
    disabled = false,
  ): Phaser.GameObjects.Rectangle {
    if (primary) this.image(ARCHIVE_ART.button, x, y, w, h).setAlpha(disabled ? 0.35 : 1)
    const hit = this.add(
      this.scene.add.rectangle(
        x,
        y,
        w,
        h,
        primary ? A.ink : this.light ? A.page : A.glass,
        primary ? 0.001 : 0.8,
      ),
    )
    if (!primary) hit.setStrokeStyle(1, A.brass, 0.7)
    const label = this.label(
      x,
      y,
      title,
      primary ? A.size.heading : A.size.small,
      disabled ? this.muted : primary ? A.paper : this.textColor,
      undefined,
      primary,
    ).setOrigin(0.5)
    if (label.width > w - 28) label.setScale((w - 28) / label.width)
    if (!disabled) {
      hit.setInteractive({ useHandCursor: true })
      hit.on('pointerover', () => {
        hit.setStrokeStyle(2, A.cyan)
        label.setAlpha(0.8)
      })
      hit.on('pointerout', () => {
        hit.setStrokeStyle(primary ? 0 : 1, A.brass, 0.7)
        label.setAlpha(1)
      })
      hit.on('pointerup', action)
    }
    return hit
  }
  portrait(key: string, x: number, y: number, size: number): Phaser.GameObjects.Sprite {
    const sprite = this.add(this.scene.add.sprite(x, y, textureKeyFor(this.scene, key), 0))
    const asset = findAsset(key)
    sprite.setScale(
      size / Math.max(asset?.frameWidth ?? sprite.width, asset?.frameHeight ?? sprite.height),
    )
    sprite.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
    return sprite
  }
  orbit(x: number, y: number, r: number, color: number = A.cyan): void {
    const g = this.add(this.scene.add.graphics())
    for (let i = 0; i < 5; i++)
      g.lineStyle(3 + i * 3, color, 0.025).strokeEllipse(x, y, r * 2 + i * 6, r * 0.65 + i * 2)
    g.lineStyle(2, color, 0.65).strokeEllipse(x, y, r * 2, r * 0.65)
    g.lineStyle(1, color, 0.3).strokeEllipse(x, y, r * 1.65, r * 0.5)
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4
      g.fillStyle(color, 0.8).fillCircle(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.325, 2)
    }
  }
}
