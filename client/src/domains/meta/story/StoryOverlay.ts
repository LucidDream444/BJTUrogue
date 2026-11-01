import Phaser from 'phaser'
import type { StoryRequest } from '@/core/events'
import { textureKeyFor } from '@/core/assets'
import { Button } from '../ui/Button'
import { OverlayLayer } from '../ui/overlayLayer'
import { THEME } from '../ui/theme'
import { SaveStatusBanner } from '../ui/SaveStatusBanner'
import type { ProfileStore } from '../profile/ProfileStore'
import { StorySequence, type StoryCompletion } from './StorySequence'
import type { StoryConfig } from './storyConfig'

/** battle 内屏幕覆盖层；只读取 UI 时间，不操作战斗物理或时钟。 */
export class StoryOverlay {
  private sequence: StorySequence | null = null
  private readonly layer: OverlayLayer
  private parts: Phaser.GameObjects.GameObject[] = []
  private buttons: Button[] = []
  private backdrop: Phaser.GameObjects.Rectangle | null = null
  private image: Phaser.GameObjects.Image | null = null
  private caption: Phaser.GameObjects.Text | null = null
  private pageNumber: Phaser.GameObjects.Text | null = null
  private missing: Phaser.GameObjects.Text | null = null
  private inputDelay = 0
  private hidden = false
  private skipNextDelta = false
  private pendingCompletion: { request: StoryRequest; result: StoryCompletion } | null = null
  private finished = false
  private saveBanner: SaveStatusBanner | null = null
  private readonly unsubscribeStore: (() => void) | undefined

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly config: StoryConfig,
    private readonly onFinished: (request: StoryRequest, result: StoryCompletion) => void,
    private readonly store?: ProfileStore,
  ) {
    this.layer = new OverlayLayer(scene)
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.update, this)
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.rebuild, this)
    scene.input.keyboard?.on('keydown', this.onKey, this)
    document.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('blur', this.onBlur)
    window.addEventListener('focus', this.onFocus)
    this.unsubscribeStore = store?.subscribe(() => this.saveBanner?.refresh())
  }

  get isOpen(): boolean { return this.sequence !== null }

  show(request: StoryRequest): void {
    this.sequence = new StorySequence(this.config, request)
    this.finished = false
    this.pendingCompletion = null
    this.hidden = document.hidden || !document.hasFocus()
    this.skipNextDelta = true
    this.inputDelay = this.config.presentation.inputGuardMs
    this.rebuild()
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.update, this)
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.rebuild, this)
    this.scene.input.keyboard?.off('keydown', this.onKey, this)
    document.removeEventListener('visibilitychange', this.onVisibility)
    window.removeEventListener('blur', this.onBlur)
    window.removeEventListener('focus', this.onFocus)
    this.unsubscribeStore?.()
    this.clear()
    this.layer.destroy()
    this.sequence = null
    this.pendingCompletion = null
  }

  private readonly onVisibility = (): void => {
    this.hidden = document.hidden
    this.skipNextDelta = true
  }
  private readonly onBlur = (): void => { this.hidden = true; this.skipNextDelta = true }
  private readonly onFocus = (): void => { this.hidden = document.hidden; this.skipNextDelta = true }

  private onKey(event: KeyboardEvent): void {
    if (!this.sequence || this.finished || event.repeat || this.inputDelay > 0) return
    if (!['Enter', 'Space', 'ArrowRight', 'Escape'].includes(event.code)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.code === 'Escape') this.finish(this.sequence.skip())
    else this.next()
  }

  private update(_time: number, delta: number): void {
    if (this.pendingCompletion) {
      const { request, result } = this.pendingCompletion
      this.pendingCompletion = null
      this.sequence = null
      this.clear()
      // 在后续渲染帧交接，原始鼠标/键盘事件已退出派发，不穿透到战斗。
      this.onFinished(request, result)
      return
    }
    const sequence = this.sequence
    if (!sequence || this.hidden || this.finished) return
    if (this.skipNextDelta) { this.skipNextDelta = false; return }
    const dt = Math.min(Math.max(delta, 0), this.config.presentation.maxDeltaMs)
    this.inputDelay = Math.max(0, this.inputDelay - dt)
    const before = sequence.index
    const completion = sequence.tick(dt)
    if (completion) this.finish(completion)
    else if (before !== sequence.index) this.refreshPage()
  }

  private next(): void {
    if (!this.sequence || this.finished || this.inputDelay > 0) return
    const completion = this.sequence.next()
    if (completion) this.finish(completion)
    else this.refreshPage()
  }

  private finish(result: StoryCompletion | null): void {
    if (!result || !this.sequence || this.finished) return
    this.finished = true
    const request = this.sequence.request
    this.pendingCompletion = { request, result }
    for (const button of this.buttons) button.setDisabled(true)
  }

  private rebuild(): void {
    if (!this.sequence) return
    this.clear()
    const { width: w, height: h } = this.scene.scale
    this.backdrop = this.scene.add.rectangle(w / 2, h / 2, w, h, 0x090e16, 1).setInteractive()
    this.parts.push(this.backdrop)
    this.image = this.scene.add.image(w / 2, h / 2, textureKeyFor(this.scene, this.sequence.page.imageKey))
    this.parts.push(this.image)
    const captionHeight = Math.min(176, Math.max(122, h * 0.23))
    const panel = this.scene.add.rectangle(w / 2, h - captionHeight / 2, w, captionHeight, 0x0d1520, 0.94)
    this.parts.push(panel)
    const fontSize = Math.max(15, Math.min(23, w / 48))
    this.caption = this.scene.add.text(w / 2, h - captionHeight + 18, '', {
      fontFamily: THEME.font.family, fontSize: `${fontSize}px`, color: '#f1e8d5',
      wordWrap: { width: Math.max(100, Math.min(1040, w - 48)) }, align: 'center', lineSpacing: 5,
    }).setOrigin(0.5, 0)
    this.pageNumber = this.scene.add.text(18, 18, '', {
      fontFamily: THEME.font.family, fontSize: '16px', color: '#f8ecd3', backgroundColor: '#15202be0', padding: { x: 10, y: 6 },
    })
    this.missing = this.scene.add.text(w / 2, h / 2 - captionHeight / 2, '画面暂未加载，可继续或跳过', {
      fontFamily: THEME.font.family, fontSize: '20px', color: '#f8ecd3', backgroundColor: '#15202b', padding: { x: 18, y: 14 },
    }).setOrigin(0.5)
    this.parts.push(this.caption, this.pageNumber, this.missing)
    const buttonWidth = Math.min(164, (w - 56) / 2)
    const next = new Button(this.scene, w / 2 - buttonWidth / 2 - 8, h - 31, '下一张  →', () => this.next(), {
      width: buttonWidth, height: 38, fontSize: 16, activateOn: 'up',
    })
    const skip = new Button(this.scene, w / 2 + buttonWidth / 2 + 8, h - 31, '跳过  Esc', () => {
      if (this.inputDelay <= 0 && this.sequence) this.finish(this.sequence.skip())
    }, { width: buttonWidth, height: 38, fontSize: 16, activateOn: 'up' })
    this.buttons.push(next, skip)
    this.parts.push(...next.parts, ...skip.parts)
    if (this.store) {
      this.saveBanner = new SaveStatusBanner(this.scene, this.store, w / 2, 100, w)
      this.parts.push(this.saveBanner.root)
    }
    this.layer.attach(this.parts)
    this.refreshPage()
  }

  private refreshPage(): void {
    if (!this.sequence || !this.image) return
    const { width: w, height: h } = this.scene.scale
    const key = this.sequence.page.imageKey
    const available = this.scene.textures.exists(key)
    this.image.setTexture(textureKeyFor(this.scene, key)).setVisible(available)
    const captionHeight = Math.min(176, Math.max(122, h * 0.23))
    const pictureHeight = Math.max(1, h - captionHeight)
    const scale = Math.min(w / this.config.presentation.width, pictureHeight / this.config.presentation.height)
    this.image.setPosition(w / 2, pictureHeight / 2)
    this.image.setDisplaySize(this.config.presentation.width * scale, this.config.presentation.height * scale)
    this.caption?.setText(this.sequence.page.caption)
    this.pageNumber?.setText(`${this.sequence.request.kind === 'intro' ? '入梦' : '梦醒'}  ${this.sequence.index + 1} / ${this.sequence.pages.length}`)
    this.missing?.setVisible(!available)
  }

  private clear(): void {
    this.layer.detach()
    const bannerRoot = this.saveBanner?.root
    this.saveBanner?.destroy()
    this.saveBanner = null
    for (const button of this.buttons) button.destroy()
    for (const part of this.parts.filter((part) => part !== bannerRoot && !this.buttons.some((button) => button.parts.includes(part)))) part.destroy()
    this.buttons = []
    this.parts = []
    this.image = null
    this.caption = null
    this.pageNumber = null
    this.missing = null
    this.backdrop = null
  }
}
