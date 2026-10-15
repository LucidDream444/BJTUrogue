import Phaser from 'phaser'
import { STATUS_HUD_ART, STATUS_BAR_FILL_BOUNDS } from '@/core/assetManifest'
import { textureKeyFor } from '@/core/assets'

type BarArt = (typeof STATUS_HUD_ART)[keyof typeof STATUS_HUD_ART]
type StatusBar = {
  fill: Phaser.GameObjects.Image
  value: Phaser.GameObjects.Text
  lastRatio: number
}

/** Fixed screen-space frame and empty track, with an independently cropped colored fill. */
export class StatusHud {
  private readonly root: Phaser.GameObjects.Container
  private readonly bars: { health: StatusBar; stamina: StatusBar; shield: StatusBar }

  constructor(private readonly scene: Phaser.Scene) {
    this.root = scene.add.container(18, 16).setScrollFactor(0).setDepth(1001)
    this.bars = {
      health: this.makeBar(STATUS_HUD_ART.health, 0),
      stamina: this.makeBar(STATUS_HUD_ART.stamina, 42),
      shield: this.makeBar(STATUS_HUD_ART.shield, 84),
    }
  }

  update(
    health: number,
    healthMax: number,
    stamina: number,
    staminaMax: number,
    shield: number,
    shieldMax: number,
  ): void {
    const camera = this.scene.cameras.main
    const uiScale = Math.min(1, Math.max(0.3, (camera.width - 36) / 450))
    // ScrollFactor removes scrolling but not zoom: invert the camera transform for the HUD.
    this.root
      .setScale(uiScale / camera.zoom)
      .setPosition(
        camera.width * camera.originX * (1 - 1 / camera.zoom) + 18 / camera.zoom,
        camera.height * camera.originY * (1 - 1 / camera.zoom) + 16 / camera.zoom,
      )
    this.updateBar(this.bars.health, health, healthMax)
    this.updateBar(this.bars.stamina, stamina, staminaMax)
    this.updateBar(this.bars.shield, shield, shieldMax)
  }

  private makeBar(art: BarArt, y: number): StatusBar {
    const x = 48,
      width = 320,
      height = 30
    const icon = this.scene.add.image(20, y + height / 2, textureKeyFor(this.scene, art.icon))
    // Retain each supplied icon's aspect ratio.
    icon.setScale(38 / Math.max(icon.width, icon.height))
    const track = this.scene.add
      .image(x, y, textureKeyFor(this.scene, art.empty))
      .setOrigin(0)
      .setDisplaySize(width, height)
    const fill = this.scene.add
      .image(x, y, textureKeyFor(this.scene, art.fill))
      .setOrigin(0)
      .setDisplaySize(width, height)
    const value = this.scene.add
      .text(x + width + 8, y + height / 2, '', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#f3f7ff',
        stroke: '#091323',
        strokeThickness: 3,
      })
      .setOrigin(0, 0.5)
    this.root.add([icon, track, fill, value])
    return { fill, value, lastRatio: -1 }
  }

  private updateBar(bar: StatusBar, current: number, maximum: number): void {
    const max = Number.isFinite(maximum) ? Math.max(0, maximum) : 0
    const value = Number.isFinite(current) ? Phaser.Math.Clamp(current, 0, max) : 0
    const ratio = max > 0 ? value / max : 0
    if (ratio !== bar.lastRatio) {
      const { left, rightInset } = STATUS_BAR_FILL_BOUNDS
      const sourceWidth = bar.fill.frame.realWidth
      const cutoff = left + (sourceWidth - left - rightInset) * ratio
      // Crop source pixels at a fixed scale: never shrink the whole frame or draw the mask.
      bar.fill.setVisible(ratio > 0).setCrop(0, 0, cutoff, bar.fill.frame.realHeight)
      bar.lastRatio = ratio
    }
    const text = `${Math.ceil(value)} / ${Math.ceil(max)}`
    if (bar.value.text !== text) bar.value.setText(text)
  }
}
