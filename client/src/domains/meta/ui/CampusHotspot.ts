import Phaser from 'phaser'
import { CAMPUS_MENU_ART } from '@/core/assetManifest'
import { hotspotButtonCenter, type CampusHotspotDef } from '../menu/campusMenuModel'
import type { MenuAction } from '../menu/menuModel'
import { THEME, fontPx } from './theme'

interface CampusHotspotCallbacks {
  onHover: (action: MenuAction, pointer: Phaser.Input.Pointer) => void
  onLeave: (action: MenuAction) => void
  onClick: (action: MenuAction) => void
}

/**
 * 地图上的一块独立按钮贴图。贴图按原始地图坐标放置，金边与呼吸光由 Graphics
 * 叠在下面；hover / focus 时整体放大，点击与 tooltip 行为仍由 MainMenuScene 管。
 */
export class CampusHotspot {
  private readonly root: Phaser.GameObjects.Container
  private readonly glow: Phaser.GameObjects.Graphics
  private readonly image: Phaser.GameObjects.Image
  /** 建筑上的两字入口名；鼠标悬停时隐藏，避免和跟随鼠标的功能卡重复。 */
  private readonly label: Phaser.GameObjects.Text
  private readonly zone: Phaser.GameObjects.Zone
  private readonly breathe: Phaser.Tweens.Tween
  private focused = false
  private hovered = false

  constructor(
    scene: Phaser.Scene,
    private readonly def: CampusHotspotDef,
    callbacks: CampusHotspotCallbacks,
  ) {
    const center = hotspotButtonCenter(def)
    const art = def.buttonArt
    this.root = scene.add.container(center.x, center.y)
    this.glow = scene.add.graphics()
    this.image = scene.add
      .image(0, 0, CAMPUS_MENU_ART.buttons[def.action])
      .setDisplaySize(art.width, art.height)
    this.image.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
    this.label = scene.add
      .text(0, 0, def.buttonLabel, {
        fontFamily: THEME.font.family,
        // 小字号渲染后再放大 1.5 倍，配合 NEAREST 保持硬边；透明底，不加底板。
        fontSize: fontPx(THEME.font.small + 2),
        fontStyle: 'bold',
        // 淡黄色字 + 一层细黑边，保证压在彩色建筑上也清楚。
        color: '#ffe8a3',
        stroke: '#000000',
        strokeThickness: 2,
        align: 'center',
      })
      .setOrigin(0.5)
      .setResolution(1)
      .setScale(1.5)
    // Canvas 文字本身仍会抗锯齿；先把 alpha 二值化，再用 NEAREST 放大，
    // 才能得到真正的像素硬边，而不是把半透明边缘一起放大成糊边。
    this.label.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
    this.hardenLabelPixels()
    this.zone = scene.add
      .zone(0, 0, art.width, art.height)
      .setInteractive({ useHandCursor: true })
    this.root.add([this.glow, this.image, this.label, this.zone])

    this.zone.on('pointerover', (pointer: Phaser.Input.Pointer) =>
      callbacks.onHover(def.action, pointer),
    )
    this.zone.on('pointerout', () => callbacks.onLeave(def.action))
    this.zone.on('pointerup', () => callbacks.onClick(def.action))

    this.breathe = scene.tweens.add({
      targets: this.glow,
      alpha: { from: 0.42, to: 1 },
      duration: 1350,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
    this.paint()
  }

  setState(focused: boolean, hovered: boolean): void {
    if (this.focused === focused && this.hovered === hovered) return
    this.focused = focused
    this.hovered = hovered
    this.paint()
  }

  get parts(): readonly Phaser.GameObjects.GameObject[] {
    return [this.root]
  }


  /**
   * 把 Phaser Text 的 canvas 做 alpha 二值化：只保留“不透明/透明”两档。
   *
   * Canvas 的 fillText 一定会抗锯齿；只设 NEAREST 只是把抗锯齿边缘放大，
   * 看起来仍然是糊的。二值化之后每个像素只有实/空两种状态，再按 1.5 倍最近邻
   * 放大，才是真正的像素字。
   */
  private hardenLabelPixels(): void {
    const canvas = this.label.canvas
    const ctx = this.label.context
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = image.data
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) {
        data[i + 3] = 0
      } else {
        data[i + 3] = 255
      }
    }
    ctx.putImageData(image, 0, 0)
    ;(this.label.texture as Phaser.Textures.CanvasTexture).refresh()
  }

  destroy(): void {
    this.breathe.stop()
    this.breathe.destroy()
    this.root.destroy()
  }

  private paint(): void {
    const art = this.def.buttonArt
    const emphasis = this.focused || this.hovered
    // Scale follows the pointer only. Keyboard focus keeps the brighter border
    // but must not leave the last hovered button stuck at the enlarged size.
    const scale = this.hovered ? 1.5 : 1
    const w = art.width
    const h = art.height
    const g = this.glow
    g.clear()
    // Layered strokes read as a thick gold glow without a post-processing blur.
    g.lineStyle(24, 0x6c4414, emphasis ? 0.42 : 0.26)
      .strokeRoundedRect(-w / 2 - 10, -h / 2 - 10, w + 20, h + 20, 14)
    g.lineStyle(14, 0xb87924, emphasis ? 0.95 : 0.62)
      .strokeRoundedRect(-w / 2 - 5, -h / 2 - 5, w + 10, h + 10, 12)
    g.lineStyle(5, THEME.color.mapGlow, 1)
      .strokeRoundedRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4, 9)
    g.lineStyle(2, 0xfff2b0, emphasis ? 1 : 0.62)
      .strokeRoundedRect(-w / 2, -h / 2, w, h, 7)
    this.label.setVisible(!this.hovered)
    this.root.setScale(scale)
  }
}
