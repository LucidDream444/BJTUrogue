import Phaser from 'phaser'
import { PAPER_DEATH_ANIMS, findAsset } from '@/core/assetManifest'
import { textureKeyFor } from '@/core/assets'
import type { GameClock } from '@/core/time'

interface PaperDeath {
  sprite: Phaser.GameObjects.Sprite
  bornAtMs: number
  durationMs: number
  frames: readonly number[]
}

/** Bounded, body-free copies: a dead actor can return to its pool during its animation. */
export class PaperDeathFx {
  private readonly pool: PaperDeath[] = []

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly clock: GameClock,
    private readonly capacity: number,
  ) {}

  play(x: number, y: number, gen: number, scale: number, splitDelayMs: number): void {
    const anim = PAPER_DEATH_ANIMS[Math.min(gen, PAPER_DEATH_ANIMS.length - 1)]!
    if (findAsset(anim.textureKey)?.placeholder) return
    const texture = textureKeyFor(this.scene, anim.textureKey)
    if (!anim.frames.every((frame) => this.scene.textures.get(texture).has(String(frame)))) return

    let effect = this.pool.find((item) => !item.sprite.active)
    if (!effect) {
      if (this.pool.length >= this.capacity) return
      effect = {
        sprite: this.scene.add.sprite(x, y, texture).setDepth(1),
        bornAtMs: 0,
        durationMs: 0,
        frames: [],
      }
      this.pool.push(effect)
    }
    effect.bornAtMs = this.clock.nowMs
    // Match real child-spawn timing; the last generation has no children to wait for.
    effect.durationMs =
      splitDelayMs > 0 ? splitDelayMs : (anim.frames.length * 1000) / anim.frameRate
    effect.frames = anim.frames
    effect.sprite
      .setTexture(texture, anim.frames[0])
      .setPosition(x, y)
      .setScale(scale)
      .setActive(true)
      .setVisible(true)
  }

  update(): void {
    for (const effect of this.pool) {
      if (!effect.sprite.active) continue
      const progress = (this.clock.nowMs - effect.bornAtMs) / effect.durationMs
      if (progress >= 1) {
        effect.sprite.setActive(false).setVisible(false)
        continue
      }
      const index = Math.max(0, Math.floor(progress * effect.frames.length))
      effect.sprite.setFrame(effect.frames[index]!)
    }
  }

  destroy(): void {
    for (const effect of this.pool) effect.sprite.destroy()
    this.pool.length = 0
  }
}
