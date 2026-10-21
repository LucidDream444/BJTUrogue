import Phaser from 'phaser'
import type { CombatSession } from './CombatSession'

/** 屏幕底部的单技能状态条。所有角色共用同一种排版。 */
export class SkillHud {
  private readonly root: Phaser.GameObjects.Container
  private readonly panel: Phaser.GameObjects.Rectangle
  private readonly title: Phaser.GameObjects.Text
  private readonly state: Phaser.GameObjects.Text
  private readonly detail: Phaser.GameObjects.Text

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly session: CombatSession,
  ) {
    this.root = scene.add.container(0, 0).setScrollFactor(0).setDepth(1012)
    this.panel = scene.add
      .rectangle(0, 0, 330, 64, 0x15231b, 0.92)
      .setOrigin(0)
      .setStrokeStyle(1, 0x756144)
    this.title = scene.add.text(12, 9, '', {
      fontFamily: 'Microsoft YaHei',
      fontSize: '14px',
      color: '#eddfbf',
    })
    this.state = scene.add.text(12, 31, '', {
      fontFamily: 'Microsoft YaHei',
      fontSize: '12px',
      color: '#efd198',
    })
    this.detail = scene.add
      .text(318, 10, '', {
        fontFamily: 'Microsoft YaHei',
        fontSize: '11px',
        color: '#a8b69d',
        align: 'right',
      })
      .setOrigin(1, 0)
    this.root.add([this.panel, this.title, this.state, this.detail])
  }

  update(): void {
    const status = this.session.skillStatus()
    if (!status) {
      this.root.setVisible(false)
      return
    }
    this.root.setVisible(true)
    const camera = this.scene.cameras.main
    const scale = Math.min(1, (camera.width - 36) / 690)
    this.root
      .setScale(scale / camera.zoom)
      .setPosition(
        camera.width * camera.originX * (1 - 1 / camera.zoom) +
          (camera.width - 330 * scale) / (2 * camera.zoom),
        camera.height * camera.originY * (1 - 1 / camera.zoom) +
          (camera.height - 16 - 64 * scale) / camera.zoom,
      )
    this.title.setText(`${status.name}  Lv.${status.level}`)
    this.state.setText(status.state)
    this.detail.setText(status.detail)
    this.state.setColor(status.ready ? '#efd198' : '#a8b69d')
    this.panel.setStrokeStyle(1, status.ready ? 0xd5b274 : 0x756144)
  }

  destroy(): void {
    for (const child of [...this.root.list]) child.destroy()
    this.root.destroy()
  }
}
