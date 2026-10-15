import { CAMPAIGN_ART, findAsset, imageUrl } from '@/core/assetManifest'
import Phaser from 'phaser'

const TITLE_IMAGE = CAMPAIGN_ART.title
const UI_FONT = '"Noto Serif SC", "Source Han Serif SC", SimSun, serif'

export class MainMenuScene extends Phaser.Scene {
  private background!: Phaser.GameObjects.Image
  private shade!: Phaser.GameObjects.Graphics
  private title!: Phaser.GameObjects.Container
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

    const titleText = this.add
      .text(0, 0, '课后勇者', {
        fontFamily: 'KaiTi, STKaiti, "Noto Serif SC", SimSun, serif',
        fontSize: '100px',
        fontStyle: 'bold',
        color: '#fff3dd',
        padding: { left: 8, right: 8, top: 12, bottom: 12 },
        shadow: { color: '#172037', blur: 14, fill: true, offsetY: 4, offsetX: 0 },
      })
      .setLetterSpacing(4)
      .setOrigin(0.5)
      .setResolution(Math.min(window.devicePixelRatio || 1, 2))
    const titleInk = titleText.context.createLinearGradient(0, 25, 0, 110)
    titleInk.addColorStop(0, '#fff9ed')
    titleInk.addColorStop(0.65, '#f9e5c7')
    titleInk.addColorStop(1, '#e5bb91')
    titleText.setColor(titleInk)

    const flourish = this.add.graphics()
    flourish.lineStyle(1, 0xf3d4ac, 0.55)
    flourish.lineBetween(-112, 67, -14, 67)
    flourish.lineBetween(14, 67, 112, 67)
    flourish.fillStyle(0xf3d4ac, 0.85)
    flourish.fillPoints(
      [
        { x: 0, y: 63 },
        { x: 4, y: 67 },
        { x: 0, y: 71 },
        { x: -4, y: 67 },
      ],
      true,
    )
    this.title = this.add.container(0, 0, [titleText, flourish])

    const frame = this.drawButton(false)
    const highlight = this.drawButton(true).setAlpha(0)
    const label = this.add
      .text(0, 0, '开 始 冒 险', {
        fontFamily: UI_FONT,
        fontSize: '26px',
        color: '#fff0d9',
        padding: { top: 6, bottom: 6 },
        shadow: { color: '#111827', blur: 8, fill: true, offsetY: 2, offsetX: 0 },
      })
      .setOrigin(0.5)
      .setResolution(Math.min(window.devicePixelRatio || 1, 2))
    const hitArea = this.add.zone(0, 0, 304, 68).setInteractive({ useHandCursor: true })
    const button = this.add.container(0, 0, [frame, highlight, label, hitArea])
    const metaButton = this.add
      .text(0, 72, '局外成长', {
        fontFamily: UI_FONT,
        fontSize: '16px',
        color: '#e2cdb5',
        padding: { left: 22, right: 22, top: 10, bottom: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
    metaButton.on('pointerover', () => metaButton.setColor('#fff3df'))
    metaButton.on('pointerout', () => metaButton.setColor('#e2cdb5'))
    metaButton.on('pointerup', () =>
      this.scene.start('MainMenu', {
        onExit: () => this.scene.start('main-menu'),
      }),
    )
    this.content = this.add.container(0, 0, [button, metaButton])

    let pressed = false
    const setHover = (hover: boolean): void => {
      this.tweens.killTweensOf([button, highlight])
      this.tweens.add({ targets: button, y: hover ? -3 : 0, duration: 180, ease: 'Sine.easeOut' })
      this.tweens.add({ targets: highlight, alpha: hover ? 1 : 0, duration: 180 })
    }
    hitArea.on('pointerover', () => setHover(true))
    hitArea.on('pointerout', () => {
      pressed = false
      setHover(false)
    })
    hitArea.on('pointerdown', () => {
      pressed = true
      this.tweens.killTweensOf(button)
      button.setY(1)
    })
    hitArea.on('pointerup', () => {
      if (pressed) this.startGame()
      pressed = false
    })

    this.input.keyboard?.on('keydown-ENTER', this.startGame, this)
    this.scale.on('resize', this.layout, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.layout, this)
      this.input.keyboard?.off('keydown-ENTER', this.startGame, this)
    })
    this.layout()
  }

  private drawButton(highlight: boolean): Phaser.GameObjects.Graphics {
    const graphics = this.add.graphics()
    const edge = 0xf3d4ac
    const outline = [
      { x: -140, y: -34 },
      { x: 152, y: -34 },
      { x: 152, y: 22 },
      { x: 140, y: 34 },
      { x: -152, y: 34 },
      { x: -152, y: -22 },
    ]

    graphics.fillStyle(highlight ? 0x655465 : 0x171e34, highlight ? 0.85 : 0.78)
    graphics.fillPoints(outline, true)
    graphics.lineStyle(1, edge, highlight ? 1 : 0.7)
    graphics.strokePoints(outline, true)
    graphics.lineStyle(1, edge, highlight ? 0.4 : 0.2)
    graphics.strokeRect(-145, -27, 290, 54)

    // Small ornaments keep the frame light against the sunset illustration.
    graphics.lineStyle(1, edge, 0.5)
    graphics.lineBetween(-195, 0, -174, 0)
    graphics.lineBetween(174, 0, 195, 0)
    for (const x of [-167, 167]) {
      graphics.fillStyle(edge, 0.9)
      graphics.fillPoints(
        [
          { x, y: -3 },
          { x: x + 3, y: 0 },
          { x, y: 3 },
          { x: x - 3, y: 0 },
        ],
        true,
      )
    }
    return graphics
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
      .fillGradientStyle(0x11152b, 0x11152b, 0x11152b, 0x11152b, 0, 0, 0.3, 0.12)
      .fillRect(0, 0, width, height)
    const scale = Math.min(1, (width - 48) / 440, (height - 32) / 360)
    const x = width < height ? width / 2 : Math.max(215 * scale, width * 0.28)
    this.title.setScale(scale).setPosition(x, height * (width < height ? 0.65 : 0.42))
    this.content.setScale(scale).setPosition(x, height * (width < height ? 0.86 : 0.68))
  }

  private startGame(): void {
    if (this.entering) return
    this.entering = true
    this.scene.start('battle')
  }
}
