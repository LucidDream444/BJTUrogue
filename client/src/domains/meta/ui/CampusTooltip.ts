import Phaser from 'phaser'
import type { CampusHotspotDef } from '../menu/campusMenuModel'
import { THEME, fontPx } from './theme'

const CARD_WIDTH = 310
const CARD_HEIGHT = 82

/** 跟随鼠标的双行说明卡：第一行是按钮功能，第二行是校园地标。 */
export class CampusTooltip {
  private readonly container: Phaser.GameObjects.Container
  private readonly action: Phaser.GameObjects.Text
  private readonly building: Phaser.GameObjects.Text

  constructor(private readonly scene: Phaser.Scene) {
    const bg = scene.add.graphics()
    bg.fillStyle(THEME.color.mapInk, 0.96)
    bg.fillRoundedRect(0, 0, CARD_WIDTH, CARD_HEIGHT, 10)
    bg.lineStyle(2, THEME.color.mapGlow, 0.95)
    bg.strokeRoundedRect(0, 0, CARD_WIDTH, CARD_HEIGHT, 10)
    bg.fillStyle(THEME.color.mapGlow, 1)
    bg.fillRoundedRect(0, 0, 5, CARD_HEIGHT, { tl: 10, bl: 10, tr: 0, br: 0 })

    this.action = scene.add.text(24, 13, '', {
      fontFamily: THEME.font.family,
      fontSize: fontPx(16),
      fontStyle: 'bold',
      color: THEME.text.accent,
    })
    this.building = scene.add.text(24, 43, '', {
      fontFamily: THEME.font.family,
      fontSize: fontPx(13),
      color: THEME.text.body,
    })

    this.container = scene.add
      .container(0, 0, [bg, this.action, this.building])
      .setVisible(false)
  }

  show(def: CampusHotspotDef, actionLabel: string, pointer: Phaser.Input.Pointer): void {
    this.action.setText(actionLabel)
    this.building.setText(def.buildingName)
    this.container.setVisible(true)
    this.move(pointer)
  }

  move(pointer: Phaser.Input.Pointer): void {
    if (!this.container.visible) return
    const pad = 14
    let x = pointer.x + 18
    let y = pointer.y + 18
    if (x + CARD_WIDTH > this.scene.scale.width - pad) x = pointer.x - CARD_WIDTH - 18
    if (y + CARD_HEIGHT > this.scene.scale.height - pad) y = pointer.y - CARD_HEIGHT - 18
    x = Phaser.Math.Clamp(x, pad, this.scene.scale.width - CARD_WIDTH - pad)
    y = Phaser.Math.Clamp(y, pad, this.scene.scale.height - CARD_HEIGHT - pad)
    this.container.setPosition(x, y)
  }

  hide(): void {
    this.container.setVisible(false)
  }

  get parts(): readonly Phaser.GameObjects.GameObject[] {
    return [this.container]
  }

  destroy(): void {
    this.container.destroy()
  }
}
