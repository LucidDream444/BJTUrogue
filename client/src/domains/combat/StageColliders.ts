import Phaser from 'phaser'
import type { StageBarrier } from './StageGeometry'
import type { TerrainMap } from './TerrainMap'

/** Stable collider groups; only their static bodies change between rooms. */
export class StageColliders {
  readonly group: Phaser.Physics.Arcade.StaticGroup
  private readonly colliders: Phaser.Physics.Arcade.Collider[]
  private readonly zones: Phaser.GameObjects.Zone[] = []
  /**
   * 门洞挡板的那些 Zone，**与 `zones` 分开放**。
   *
   * ★ 新增（2026-10-21，整层连续）：v4 里门是普通的 `solids`，
   * 封不封门由「换一张几何」表达 —— 过门 = `enterStage(下一间)`，
   * 一整组碰撞体重建一遍。整层连续之后**不能这么干了**：
   * 玩家在走廊里走，换几何等于把整层重搭一次。
   *
   * 现在的表达是**原地开关**：挡板一直是同一个 Zone，封门 = `body.enable = false`。
   *
   * - 为什么不是「把 Zone 移出组再塞回去」：那要碰 `StaticGroup` 的 children 表，
   *   而 `collideSpriteVsGroup` 每帧都在遍历它 —— 在一帧中间改动它，
   *   轻则漏判一次、重则 index 越界。
   * - 为什么 `body.enable` 一定管用：`collideSpriteVsGroup` 里的判据就是
   *   `if (!bodyB.enable) continue`（Phaser 3.90 `World.js`），
   *   这是**引擎里那一个开关**，不是"应该会生效"。
   */
  private readonly doorZones: Phaser.GameObjects.Zone[] = []
  private readonly barrierRects: StageBarrier[] = []

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

  rebuild(terrain: TerrainMap, barriers: readonly StageBarrier[] = []): void {
    this.clear()
    // ⚠️ ★ 修（2026-10-23，用户报「进入怪物房后关上的门还可以通过」）：
    // **组的容量要按「这一次要装多少」现算，不能按构造时那一层定死。**
    //
    // 容量是 `CombatSession` 构造时按**第 1 层**的几何算的（`max(solids) + max(barriers) + 64`），
    // 而 `loadFloor()` 之后每一层的墙数并不一样（1F 的实心块合并得少、3F/6F 多得多）。
    // 组满了之后 `Group.add()` 是**静默**丢的 —— 而且丢的永远是**最后加的那批**，
    // 也就是**挡板**：于是那一层的门一个体都没有，`setSealed()` 遍历一圈什么都不做，
    // 表现正是「门画着是关的，人却能直接走出去」。
    // 实测：第 1 层 73 块（56 墙 + 17 挡板），上到第 2 层要 137 块，而构造时定的
    // `maxSize` 就是 137 —— 墙刚好占满，18 块挡板**一块都没赶上**。
    const needed = terrain.solids.length + barriers.length
    if (this.group.maxSize >= 0 && this.group.maxSize < needed) this.group.maxSize = needed
    for (const r of terrain.solids) {
      const zone = this.scene.add
        .zone(r.x + r.width / 2, r.y + r.height / 2, r.width, r.height)
        .setName(r.id)
      this.group.add(zone)
      this.zones.push(zone)
    }
    // 挡板与 `solids` **同一套坐标约定（左上角）** —— `DungeonStages` 那一处
    // 已经把 `DoorBarrier` 的中心点换算过来了。所以这里与上面那个循环长得一样，
    // 这是对的，不是在偷懒。
    for (const b of barriers) {
      const zone = this.scene.add
        .zone(b.x + b.width / 2, b.y + b.height / 2, b.width, b.height)
        .setName(`barrier-${b.ownerOrder}`)
      this.group.add(zone)
      // 加进去之后**当场确认它有体** —— 上面那条容量修好之后这里恒真；
      // 再留一道是因为「静默少一块体」的失败模式太贵：门看着关着、人却能过。
      if (!zone.body) {
        throw new Error(
          `门挡板 barrier-${b.ownerOrder} 加进碰撞组之后没有物理体（组上限 ${this.group.maxSize}，` +
            `这一层要 ${needed} 块）—— 门会封不上，而且画面上看不出来`,
        )
      }
      this.doorZones.push(zone)
      this.barrierRects.push(b)
    }
    this.setSealed(new Set())
  }
  /**
   * 把「现在应该封着」的门封上，其余打开。**传的是应该关着的那些**，不是开关指令 ——
   * 这样调用方不必记住上一帧的状态，重复调用同一个集合也不会抖。
   *
   * @param sealed 应该封着的房号（`DoorBarrier.ownerOrder`）
   */
  setSealed(sealed: ReadonlySet<number>): void {
    for (let i = 0; i < this.doorZones.length; i++) {
      const zone = this.doorZones[i]!
      const body = zone.body as Phaser.Physics.Arcade.StaticBody | null
      if (!body) continue
      const want = sealed.has(this.barrierRects[i]!.ownerOrder)
      if (body.enable !== want) body.enable = want
    }
  }
  /** 现在封着的有哪些房号。读数用（测试场 / 调试），不是判定用。 */
  sealedOrders(): number[] {
    const out: number[] = []
    for (let i = 0; i < this.doorZones.length; i++) {
      const body = this.doorZones[i]!.body as Phaser.Physics.Arcade.StaticBody | null
      if (body?.enable) out.push(this.barrierRects[i]!.ownerOrder)
    }
    return out
  }

  private clear(): void {
    for (const zone of [...this.zones, ...this.doorZones]) {
      // 场景 shutdown 时 UpdateList 可能先销毁组，children 已被引擎置空。
      if (this.group.children) this.group.remove(zone)
      zone.destroy()
    }
    this.zones.length = 0
    this.doorZones.length = 0
    this.barrierRects.length = 0
  }

  destroy(): void {
    for (const collider of this.colliders) collider.destroy()
    this.clear()
    if (this.group.children) this.group.destroy()
  }
}
