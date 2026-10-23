import { CAMPAIGN_ART, findAsset, imageUrl } from '@/core/assetManifest'
import Phaser from 'phaser'

const TITLE_IMAGE = CAMPAIGN_ART.title
// 按交付原图定位交互，随原画一起缩放，避免按钮与画面错位。
const ART_WIDTH = 1672
const ART_HEIGHT = 941

export class MainMenuScene extends Phaser.Scene {
  private background!: Phaser.GameObjects.Image
  private controls!: Phaser.GameObjects.Container
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
    this.cameras.main.setBackgroundColor('#0b0b10')
    this.background = this.add.image(0, 0, TITLE_IMAGE)
    this.background.texture.setFilter(Phaser.Textures.FilterMode.LINEAR)

    // 原画已包含标题、菜单和开始按钮，不再叠加旧标题与提示文字。
    const startGlow = this.add
      .circle(232, 430, 34, 0xffd58a, 0)
      .setStrokeStyle(2, 0xffdf9f, 0.8)
      .setAlpha(0.25)
    const startButton = this.add.zone(325, 430, 290, 96).setInteractive({ useHandCursor: true })
    const cassetteButton = this.add.zone(324, 722, 100, 54).setInteractive({ useHandCursor: true })
    this.controls = this.add.container(0, 0, [startGlow, startButton, cassetteButton])

    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.tweens.add({
        targets: startGlow,
        alpha: { from: 0.15, to: 0.65 },
        duration: 1400,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      })
    }

    // 保留整屏点击 / 键盘进入；画中的开始和磁带播放键另提供手形光标。
    // entering 防止重复触发，进入后仍由原有主菜单完成角色与难度选择。
    this.input.on('pointerup', this.enterMainMenu, this)
    this.input.keyboard?.on('keydown', this.enterMainMenu, this)
    this.scale.on('resize', this.layout, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.layout, this)
      this.input.off('pointerup', this.enterMainMenu, this)
      this.input.keyboard?.off('keydown', this.enterMainMenu, this)
    })
    this.layout()
  }

  private layout(): void {
    const { width, height } = this.scale
    // 完整显示参考设计：非 16:9 窗口留深色边，不裁掉标题、角色或磁带机。
    const scale = Math.min(width / ART_WIDTH, height / ART_HEIGHT)
    const left = (width - ART_WIDTH * scale) / 2
    const top = (height - ART_HEIGHT * scale) / 2
    this.background
      .setPosition(width / 2, height / 2)
      .setDisplaySize(ART_WIDTH * scale, ART_HEIGHT * scale)
    this.controls.setPosition(left, top).setScale(scale)
  }

  private enterMainMenu(): void {
    if (this.entering) return
    this.entering = true
    this.scene.start('MainMenu', { onExit: () => this.scene.start('main-menu') })
  }
}
