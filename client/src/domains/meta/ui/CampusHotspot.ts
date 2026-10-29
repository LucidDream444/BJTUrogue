import Phaser from 'phaser'
import {
  CAMPUS_BUTTON_SIZE,
  hotspotButtonCenter,
  type CampusHotspotDef,
} from '../menu/campusMenuModel'
import type { MenuAction } from '../menu/menuModel'
import { THEME, fontPx } from './theme'

interface CampusHotspotCallbacks {
  onHover: (action: MenuAction, pointer: Phaser.Input.Pointer) => void
  onLeave: (action: MenuAction) => void
  onClick: (action: MenuAction) => void
}

/**
 * 建筑正中心的一个方块按钮。
 *
 * 方块是唯一的可见标记和唯一的点击区；建筑本身不再画外轮廓，地图保持干净。
 */
export class CampusHotspot {
  private readonly button: Phaser.GameObjects.Graphics
  private readonly label: Phaser.GameObjects.Text
  private readonly zone: Phaser.GameObjects.Zone
  private focused = false
  private hovered = false

  constructor(
    scene: Phaser.Scene,
    private readonly def: CampusHotspotDef,
    callbacks: CampusHotspotCallbacks,
  ) {
    const center = hotspotButtonCenter(def)
    this.button = scene.add.graphics()
    this.label = scene.add
      .text(center.x, center.y, def.buttonLabel, {
        fontFamily: THEME.font.family,
        fontSize: fontPx(15),
        fontStyle: 'bold',
        color: THEME.text.body,
      })
      .setOrigin(0.5)
      .setResolution(Math.min(window.devicePixelRatio || 1, 2))
    this.zone = scene.add
      .zone(center.x, center.y, CAMPUS_BUTTON_SIZE + 6, CAMPUS_BUTTON_SIZE + 6)
      .setInteractive({ useHandCursor: true })

    this.zone.on('pointerover', (pointer: Phaser.Input.Pointer) =>
      callbacks.onHover(def.action, pointer),
    )
    this.zone.on('pointerout', () => callbacks.onLeave(def.action))
    this.zone.on('pointerup', () => callbacks.onClick(def.action))
    this.paint()
  }

  setState(focused: boolean, hovered: boolean): void {
    if (this.focused === focused && this.hovered === hovered) return
    this.focused = focused
    this.hovered = hovered
    this.paint()
  }

  get parts(): readonly Phaser.GameObjects.GameObject[] {
    return [this.button, this.label, this.zone]
  }

  destroy(): void {
    this.button.destroy()
    this.label.destroy()
    this.zone.destroy()
  }

  private paint(): void {
    const center = hotspotButtonCenter(this.def)
    const half = CAMPUS_BUTTON_SIZE / 2
    const x = center.x - half
    const y = center.y - half
    const emphasis = this.focused || this.hovered
    const g = this.button

    g.clear()
    if (emphasis) {
      g.lineStyle(10, THEME.color.mapGlowSoft, 0.16)
      g.strokeRect(x - 3, y - 3, CAMPUS_BUTTON_SIZE + 6, CAMPUS_BUTTON_SIZE + 6)
    }
    g.fillStyle(THEME.color.mapInk, emphasis ? 0.98 : 0.92)
    g.fillRect(x, y, CAMPUS_BUTTON_SIZE, CAMPUS_BUTTON_SIZE)
    g.lineStyle(emphasis ? 3 : 2, THEME.color.mapGlow, emphasis ? 1 : 0.84)
    g.strokeRect(x, y, CAMPUS_BUTTON_SIZE, CAMPUS_BUTTON_SIZE)
    this.label.setColor(emphasis ? '#fff2b0' : THEME.text.body)
  }
}
