import type Phaser from 'phaser'
import type { GameClock } from '@/core/time'
import { textureKeyFor } from '@/core/assets'

interface FrameRange { start: number; count: number; frameRate: number }
interface ExitCopy { sprite: Phaser.GameObjects.Sprite; bornMs: number; durationMs: number; start: number; count: number }

/** Body-free death copies share a bounded pool but never a gameplay model. */
export class FrameExitFx {
  private readonly copies: ExitCopy[] = []
  constructor(private readonly scene: Phaser.Scene, private readonly clock: GameClock, private readonly capacity: number) {}
  play(x: number, y: number, scale: number, textureKey: string, range: FrameRange, offset = 0): void {
    const texture = textureKeyFor(this.scene, textureKey)
    if (!this.scene.textures.get(texture).has(String(offset + range.start))) return
    let copy = this.copies.find((item) => !item.sprite.active)
    if (!copy) {
      if (this.copies.length >= this.capacity) return
      copy = { sprite: this.scene.add.sprite(x, y, texture), bornMs: 0, durationMs: 0, start: 0, count: 0 }
      this.copies.push(copy)
    }
    copy.bornMs = this.clock.nowMs
    copy.durationMs = range.count * 1000 / range.frameRate
    copy.start = offset + range.start
    copy.count = range.count
    copy.sprite.setTexture(texture, copy.start).setPosition(x, y).setScale(scale).setActive(true).setVisible(true).setDepth(y)
  }
  update(): void {
    for (const copy of this.copies) {
      if (!copy.sprite.active) continue
      const progress = (this.clock.nowMs - copy.bornMs) / copy.durationMs
      if (progress >= 1) copy.sprite.setActive(false).setVisible(false)
      else copy.sprite.setFrame(copy.start + Math.max(0, Math.floor(progress * copy.count)))
    }
  }
  destroy(): void { for (const copy of this.copies) copy.sprite.destroy(); this.copies.length = 0 }
}
