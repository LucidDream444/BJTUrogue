import Phaser from 'phaser'
import type { TerrainMap } from './TerrainMap'

/** Stable collider groups; only their static bodies change between rooms. */
export class StageColliders {
  readonly group: Phaser.Physics.Arcade.StaticGroup
  private readonly colliders: Phaser.Physics.Arcade.Collider[]
  private readonly zones: Phaser.GameObjects.Zone[] = []

  constructor(
    private readonly scene: Phaser.Scene,
    player: Phaser.GameObjects.Zone,
    enemies: Phaser.Physics.Arcade.Group,
    capacity: number,
  ) {
    this.group = scene.physics.add.staticGroup({ maxSize: capacity })
    this.colliders = [
      scene.physics.add.collider(player, this.group),
      scene.physics.add.collider(enemies, this.group),
    ]
  }

  rebuild(terrain: TerrainMap): void {
    this.clear()
    for (const r of terrain.solids) {
      const zone = this.scene.add
        .zone(r.x + r.width / 2, r.y + r.height / 2, r.width, r.height)
        .setName(r.id)
      this.group.add(zone)
      this.zones.push(zone)
    }
  }

  private clear(): void {
    for (const zone of this.zones) {
      this.group.remove(zone)
      zone.destroy()
    }
    this.zones.length = 0
  }

  destroy(): void {
    for (const collider of this.colliders) collider.destroy()
    this.clear()
    this.group.destroy()
  }
}
