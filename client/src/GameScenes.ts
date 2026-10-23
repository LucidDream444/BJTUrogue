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

    const hint = this.add
      .text(0, 0, '点击任意位置开始游戏', {
        fontFamily: UI_FONT,
        fontSize: '18px',
        color: '#f0dcc2',
        padding: { left: 22, right: 22, top: 10, bottom: 10 },
        shadow: { color: '#111827', blur: 8, fill: true, offsetY: 2, offsetX: 0 },
      })
      .setOrigin(0.5)
      .setResolution(Math.min(window.devicePixelRatio || 1, 2))
    this.content = this.add.container(0, 0, [hint])
    // 没有按钮可点了，这一屏的可点性只剩这行字来交代 —— 让它慢慢呼吸一下。
    // 不用手动停它：场景关掉时 Phaser 会连带清掉自己名下的 tween。
    this.tweens.add({
      targets: hint,
      alpha: { from: 0.55, to: 1 },
      duration: 1400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })

    // **整屏都是「开始」**：点哪儿都行，按哪个键都行。
    // `enterMainMenu()` 里的 `entering` 既挡重复触发，也挡长按的连发
    // （按住一个键时 Phaser 会重复派发 `keydown`）。
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

  /**
   * 去**主界面**（D4 的 `MainMenu`），**不是**直接开打。
   *
   * 标题画面不再持有进战斗的路径 —— 选角色、选难度、进升级页都在主界面上，
   * 「开始闯关」是主界面那一件事（`MainMenuScene` 里的 `scene.start('battle', …)`）。
   * 这里给它 `onExit`：主界面上按 Esc 退回标题画面。
   */
  private enterMainMenu(): void {
    if (this.entering) return
    this.entering = true
    this.scene.start('MainMenu', { onExit: () => this.scene.start('main-menu') })
  }
}
