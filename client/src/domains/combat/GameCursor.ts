import type Phaser from 'phaser'
import { findAsset, imageUrl, GAME_CURSOR_ART } from '@/core/assetManifest'

/** Native cursors keep their own screen size, independent of the game's camera zoom. */
export class GameCursor {
  private readonly style = document.createElement('style')
  private readonly canvas: HTMLCanvasElement
  private readonly previous: string
  private readonly oldDefault: string
  private readonly input: Phaser.Input.InputPlugin
  constructor(scene: Phaser.Scene) {
    this.canvas = scene.game.canvas
    this.input = scene.input
    this.previous = this.canvas.style.cursor
    this.oldDefault = scene.input.manager.defaultCursor
    const cursor = (
      art: typeof GAME_CURSOR_ART.arrow | typeof GAME_CURSOR_ART.hand,
      fallback: string,
    ) => {
      const entry = findAsset(art.key)
      if (!entry) throw new Error('光标资源不存在: ' + art.key)
      // Stylesheet URLs resolve from the current document, including subdirectory deployments.
      const url = new URL(imageUrl(entry), document.baseURI).href
      return `url("${url}") ${art.hotspotX} ${art.hotspotY}, ${fallback}`
    }
    const arrow = cursor(GAME_CURSOR_ART.arrow, 'default'),
      hand = cursor(GAME_CURSOR_ART.hand, 'pointer')
    this.style.textContent = `
html.d1-cursors{--d1-arrow:${arrow};--d1-hand:${hand};cursor:var(--d1-arrow)}
html.d1-cursors body,html.d1-cursors #game-root,html.d1-cursors canvas,html.d1-cursors .d1-reward,html.d1-cursors .d1-gallery{cursor:var(--d1-arrow)!important}
html.d1-cursors button:not(:disabled),html.d1-cursors button:not(:disabled) *,html.d1-cursors a,html.d1-cursors input[type=range]{cursor:var(--d1-hand)!important}
html.d1-cursors button:disabled{cursor:var(--d1-arrow)!important}
`
    document.head.append(this.style)
    document.documentElement.classList.add('d1-cursors')
    this.input.setDefaultCursor(arrow)
  }
  destroy(): void {
    this.style.remove()
    document.documentElement.classList.remove('d1-cursors')
    this.input.setDefaultCursor(this.oldDefault)
    this.canvas.style.cursor = this.previous
  }
}
