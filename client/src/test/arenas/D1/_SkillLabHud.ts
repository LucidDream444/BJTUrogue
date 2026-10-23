import Phaser from 'phaser'
import type { BattleScene } from '@/domains/combat/BattleScene'

/** 只在 d1_battle 测试场显示的技能等级调试台。 */
export class SkillLabHud {
  private readonly root: Phaser.GameObjects.Container
  private readonly panel: Phaser.GameObjects.Rectangle
  private readonly title: Phaser.GameObjects.Text
  private readonly body: Phaser.GameObjects.Text

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly battle: BattleScene,
  ) {
    this.root = scene.add.container(0, 0).setScrollFactor(0).setDepth(2000)
    this.panel = scene.add
      .rectangle(0, 0, 340, 158, 0x101914, 0.94)
      .setOrigin(0)
      .setStrokeStyle(1, 0xd5b274)
    this.title = scene.add.text(12, 9, '技能调试台', {
      fontFamily: 'Microsoft YaHei',
      fontSize: '15px',
      color: '#efd198',
    })
    this.body = scene.add.text(12, 31, '', {
      fontFamily: 'Microsoft YaHei',
      fontSize: '12px',
      color: '#f4e7cc',
      lineSpacing: 4,
    })
    this.root.add([this.panel, this.title, this.body])
  }

  update(): void {
    const state = this.battle.skillLabState()
    if (!state) {
      this.root.setVisible(false)
      return
    }
    this.root.setVisible(true)
    const camera = this.scene.cameras.main
    this.root
      .setScale(1 / camera.zoom)
      .setPosition(
        camera.width * camera.originX * (1 - 1 / camera.zoom) +
          (camera.width - 352) / camera.zoom,
        16 / camera.zoom,
      )
    this.title.setText(
      `技能调试台 · ${state.characterName} · ${state.skillName} Lv.${state.level}`,
    )
    this.body.setText(
      [
        '[ / ] 切换角色    - / = 调整技能等级    R 重开',
        ...state.lines,
      ].join('\n'),
    )
  }

  destroy(): void {
    this.root.destroy(true)
  }
}
