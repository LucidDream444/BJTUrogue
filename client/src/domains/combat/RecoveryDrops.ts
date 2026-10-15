import type Phaser from 'phaser'
import { STATUS_HUD_ART } from '@/core/assetManifest'
import { textureKeyFor } from '@/core/assets'
import type { GameClock } from '@/core/time'
import type { RngLike } from '@/core/rng'
import type { CombatConfig } from './config'
import type { Player } from './Player'

import { rollRecoveryDrop, type RecoveryKind } from './dropPolicy'
interface Drop {
  kind: RecoveryKind
  amount: number
  image: Phaser.GameObjects.Image
}

/** Recovery lives on the ground until the player approaches and can use it. */
export class RecoveryDrops {
  private readonly items: Drop[] = []
  private readonly defeated = new Set<number>()

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly clock: GameClock,
    private readonly cfg: CombatConfig['drops'],
    private readonly player: Player,
    private readonly rng: RngLike,
  ) {}

  enemyDefeated(id: number, x: number, y: number): void {
    if (this.defeated.has(id) || !this.player.model.alive) return
    this.defeated.add(id)
    if (this.items.length >= this.cfg.maxActive) return
    const drop = rollRecoveryDrop(this.cfg, this.rng)
    if (!drop) return
    const { kind, amount } = drop
    const art = STATUS_HUD_ART[kind]
    const image = this.scene.add.image(x, y, textureKeyFor(this.scene, art.icon))
    image
      .setScale(this.cfg.visualSize / Math.max(image.width, image.height))
      .setDepth(y + this.cfg.visualSize)
    this.items.push({
      kind,
      amount,
      image,
    })
  }

  update(): void {
    if (this.clock.paused || this.clock.frozen || !this.player.model.alive) return
    const radiusSquared = this.cfg.pickupRadius ** 2
    for (let index = this.items.length - 1; index >= 0; index--) {
      const item = this.items[index]!
      const dx = this.player.x - item.image.x,
        dy = this.player.y - item.image.y
      if (dx * dx + dy * dy > radiusSquared) continue
      const restored =
        item.kind === 'stamina'
          ? this.player.restoreStamina(item.amount)
          : this.player.model.restoreFromPickup(item.kind, item.amount)
      // A full resource must not waste its pickup, or restore the other resource instead.
      if (restored <= 0) continue
      item.image.destroy()
      this.items.splice(index, 1)
    }
  }

  clear(): void {
    for (const item of this.items) item.image.destroy()
    this.items.length = 0
  }

  destroy(): void {
    this.clear()
    this.defeated.clear()
  }
}
