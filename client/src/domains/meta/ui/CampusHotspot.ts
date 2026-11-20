import Phaser from 'phaser'
import { CAMPUS_MENU_ART } from '@/core/assetManifest'
import { hotspotButtonCenter, type CampusHotspotDef } from '../menu/campusMenuModel'
import type { MenuAction } from '../menu/menuModel'
import { THEME } from './theme'

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
    this.zone = scene.add
      .zone(0, 0, art.width, art.height)
      .setInteractive({ useHandCursor: true })
    this.root.add([this.glow, this.image, this.zone])

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
    this.root.setScale(scale)
  }
}
