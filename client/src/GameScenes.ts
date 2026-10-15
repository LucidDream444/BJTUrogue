import { CAMPAIGN_ART, findAsset, imageUrl } from '@/core/assetManifest'
import Phaser from 'phaser'

const TITLE_IMAGE = CAMPAIGN_ART.title
const UI_FONT = 'Microsoft YaHei, Segoe UI, sans-serif'

export class MainMenuScene extends Phaser.Scene {
  private background!: Phaser.GameObjects.Image
  private shade!: Phaser.GameObjects.Graphics
  private content!: Phaser.GameObjects.Container
  private entering = false

  constructor() {
    super('main-menu')
  }

  preload(): void {
    if (!this.textures.exists(TITLE_IMAGE))
      this.load.image(TITLE_IMAGE, imageUrl(findAsset(TITLE_IMAGE)!))
  }

  create(): void {
    this.entering = false
    this.background = this.add.image(0, 0, TITLE_IMAGE)
    this.background.texture.setFilter(Phaser.Textures.FilterMode.LINEAR)
    this.shade = this.add.graphics()
    const eyebrow = this.add.text(0, -205, 'AFTER SCHOOL  /  ANOTHER WORLD', {
      fontFamily: UI_FONT,
      fontSize: '13px',
      color: '#edd0b7',
    })
    const title = this.add.text(0, -166, '课后勇者', {
      fontFamily: UI_FONT,
      fontSize: '78px',
      fontStyle: 'bold',
      color: '#fff4df',
      shadow: { color: '#10152b', blur: 18, fill: true, offsetY: 4, offsetX: 0 },
    })
    const subtitle = this.add.text(5, -64, '异 次 元 校 园', {
      fontFamily: UI_FONT,
      fontSize: '24px',
      color: '#f5c39f',
    })
    const rule = this.add.rectangle(0, 0, 60, 2, 0xf5c39f).setOrigin(0)
    const description = this.add.text(0, 28, '放学铃响，冒险才刚刚开始。', {
      fontFamily: UI_FONT,
      fontSize: '18px',
      color: '#e4deec',
    })
    const button = this.add
      .rectangle(160, 117, 320, 66, 0xf2c594)
      .setStrokeStyle(1, 0xffebcd)
      .setInteractive({ useHandCursor: true })
    const label = this.add
      .text(160, 117, '开始冒险   →', {
        fontFamily: UI_FONT,
        fontSize: '24px',
        fontStyle: 'bold',
        color: '#2f2839',
      })
      .setOrigin(0.5)
    button.on('pointerover', () => button.setFillStyle(0xffdfb5))
    button.on('pointerout', () => button.setFillStyle(0xf2c594))
    button.on('pointerdown', this.startGame, this)
    // 局外成长（D4）：主菜单 / 存档 / 升级 / 解锁都在那边。
    // 次按钮样式比「开始冒险」弱一档 —— 它不是主路径，但必须在标题画面上够得着。
    const metaButton = this.add
      .text(160, 232, '局外成长（升级 / 解锁）  →', {
        fontFamily: UI_FONT,
        fontSize: '16px',
        color: '#f2c594',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
    metaButton.on('pointerover', () => metaButton.setColor('#ffe9c9'))
    metaButton.on('pointerout', () => metaButton.setColor('#f2c594'))
    metaButton.on('pointerdown', () =>
      // `onExit` 交给 D4 的主菜单：它在顶层按 Esc 时会调这个，回到标题画面。
      // 不传的话 Esc 什么都不做（那是"产品里主菜单就是顶层"的语义）。
      this.scene.start('MainMenu', { onExit: () => this.scene.start('main-menu') }),
    )
    const controls = this.add.text(
      0,
      175,
      'WASD 移动 · 鼠标射击 · 空格暂停\nE 拾取 · Q 切换武器 · Esc 返回标题',
      {
        fontFamily: UI_FONT,
        fontSize: '13px',
        color: '#d6cfdd',
        lineSpacing: 8,
      },
    )
    this.content = this.add.container(0, 0, [
      eyebrow,
      title,
      subtitle,
      rule,
      description,
      button,
      label,
      controls,
    ])
    this.input.keyboard?.on('keydown-ENTER', this.startGame, this)
    this.scale.on('resize', this.layout, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.layout, this)
      this.input.keyboard?.off('keydown-ENTER', this.startGame, this)
    })
    this.layout()
  }

  private layout(): void {
    const { width, height } = this.scale
    this.background
      .setPosition(width / 2, height / 2)
      .setScale(Math.max(width / this.background.width, height / this.background.height))
    if (width < height) {
      const halfWidth = this.background.displayWidth / 2
      this.background.setX(
        Phaser.Math.Clamp(
          width * 0.66 - this.background.displayWidth * 0.26,
          width - halfWidth,
          halfWidth,
        ),
      )
    }
    this.shade
      .clear()
      .fillGradientStyle(0x11152b, 0x11152b, 0x11152b, 0x11152b, 0.65, 0, 0.78, 0.12)
      .fillRect(0, 0, width, height)
    const scale = Math.min(1, (height - 60) / 460, (width - 48) / 470)
    this.content.setScale(scale).setPosition(Math.max(24, width * 0.09), height * 0.49)
  }

  private startGame(): void {
    if (this.entering) return
    this.entering = true
    this.scene.start('battle')
  }
}
