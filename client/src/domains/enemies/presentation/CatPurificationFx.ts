import type Phaser from 'phaser'
import type { GameClock } from '@/core/time'
import { NIGHTMARE_CAT_ART } from '@/core/assetManifest'
import { textureKeyFor } from '@/core/assets'

interface CatExit { sprite: Phaser.GameObjects.Sprite; portal: Phaser.GameObjects.Sprite; bornMs: number; durationMs: number }

/** Bounded non-physical copies; the gameplay cat is already dead and can return to its pool. */
export class CatPurificationFx {
  private readonly pool: CatExit[] = []
  constructor(private readonly scene: Phaser.Scene, private readonly clock: GameClock, private readonly capacity: number) {}

  play(x: number, y: number, scale: number, durationMs: number): void {
    const texture = textureKeyFor(this.scene, NIGHTMARE_CAT_ART.texture)
    if (!this.scene.textures.get(texture).has(String(NIGHTMARE_CAT_ART.states.purify.start))) return
    let exit = this.pool.find((item) => !item.sprite.active)
    if (!exit) {
      if (this.pool.length >= this.capacity) return
      exit = {
        sprite: this.scene.add.sprite(x, y, texture),
        portal: this.scene.add.sprite(x, y, textureKeyFor(this.scene, NIGHTMARE_CAT_ART.void)),
        bornMs: 0, durationMs: 0,
      }
      this.pool.push(exit)
    }
    exit.bornMs = this.clock.nowMs
    exit.durationMs = durationMs
    exit.sprite.setTexture(texture, NIGHTMARE_CAT_ART.states.purify.start).setPosition(x, y).setScale(scale).setActive(true).setVisible(true).setDepth(y)
    exit.portal.setPosition(x, y).setScale(scale).setActive(true).setVisible(true).setDepth(y - 1)
  }

  update(): void {
    const purify = NIGHTMARE_CAT_ART.states.purify, vanish = NIGHTMARE_CAT_ART.states.vanish
    const frameCount = purify.count + vanish.count
    for (const exit of this.pool) {
      if (!exit.sprite.active) continue
      const progress = (this.clock.nowMs - exit.bornMs) / exit.durationMs
      if (progress >= 1) {
        exit.sprite.setActive(false).setVisible(false)
        exit.portal.setActive(false).setVisible(false)
        continue
      }
      const frame = Math.max(0, Math.floor(progress * frameCount))
      exit.sprite.setFrame(frame < purify.count ? purify.start + frame : vanish.start + frame - purify.count)
      exit.portal.setFrame(Math.min(NIGHTMARE_CAT_ART.fxFrameCount - 1, Math.floor(progress * NIGHTMARE_CAT_ART.fxFrameCount)))
    }
  }

  destroy(): void {
    for (const exit of this.pool) { exit.sprite.destroy(); exit.portal.destroy() }
    this.pool.length = 0
  }
}
