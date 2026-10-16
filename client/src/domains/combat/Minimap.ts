import Phaser from 'phaser'
import { COLORS } from '@/domains/procgen/presentation/floorplan'
import { ROOM_KIND_LABELS } from '@/domains/procgen/model/types'
import type { Room } from '@/domains/procgen/model/types'

/**
 * 一层楼的缩略图，钉在屏幕右上角。
 *
 * ## 为什么不直接用 `drawFloorplan()`
 *
 * 那个函数**直接往场景里加对象、而且吃屏幕坐标** —— 战斗相机有缩放
 * （`fitCamera()` 算出来 ≈0.95），钉不到屏幕上，会跟着相机一起偏。
 * 而这个类画的是一张 Graphics，位置与缩放由 `layout()` 按相机反算，
 * 所以相机怎么动它都钉在原地。
 *
 * **配色和关别名册仍然只此一份**：`COLORS` / `ROOM_KIND_LABELS` 都从
 * `domains/procgen/` 读，这里不抄。抄一份的表现是「同一个关别在两块画面上
 * 写着两个词」，谁都不会注意到。
 *
 * ## 一层是一排 15 间，缩到一个小方块里就是一条长条
 *
 * 整层宽近 8000px、高不到 1000px，所以缩略图必然是 8:1 的长条 —— 这是**对**的：
 * 一层楼就是「一排教室 + 侧室」的结构，压成方块反而看不出「走到第几间了」。
 * 长条上每一格就是一間，进度一眼可见。
 */
const PANEL = {
  width: 236,
  height: 74,
  /** 屏幕右上角的留白 */
  inset: 12,
  padding: 6,
} as const

export class Minimap {
  private readonly gfx: Phaser.GameObjects.Graphics
  private readonly title: Phaser.GameObjects.Text
  private current = 1
  private readonly hostByOrder = new Map<number, number>()

  constructor(
    scene: Phaser.Scene,
    private readonly rooms: readonly Room[],
    /**
     * 每间房的门通向哪几间，和 `rooms` 同序。
     *
     * **紧凑排布只需要这一个** —— 房间的真实坐标、门的真实位置都不用了：
     * 一是紧凑布局按连通关系排，二是门画在自己朝邻居那一侧的边上。
     * 早先传过 `map` / `doors`，改成紧凑排布之后它们就没用了，已经去掉。
     */
    private readonly targets: readonly (readonly (number | null)[])[] = [],
  ) {
    for (const [i, ts] of targets.entries()) {
      const order = rooms[i]?.order
      const host = ts.find((t): t is number => t !== null)
      if (order !== undefined && host !== undefined) this.hostByOrder.set(order, host)
    }
    this.gfx = scene.add.graphics().setDepth(4600)
    this.title = scene.add
      .text(0, 0, '', {
        fontFamily: 'Microsoft YaHei, sans-serif',
        fontSize: '12px',
        color: '#e8d6ae',
      })
      .setDepth(4601)
    this.setState(1)
  }

  /**
   * **紧凑排布：不留真实坐标里那些缝。**
   *
   * 正式游戏里每间房是**独立一屏**（各自 `fitMapFrame` 缩放到满屏），过门直接切换 ——
   * 房间之间那段 `roomGap`（连廊）**在画面上根本不存在**。照真实坐标画小地图，
   * 玩家看到的是「一段并不存在的距离」，既难看又跟体感对不上。
   *
   * 所以按**连通关系**排：主干教室肩并肩贴着，侧室紧贴宿主的下沿。
   * 每间房的形状（宽高比）保留，只是把缝去掉。
   */
  private compactLayout(): Map<number, { x: number; y: number; w: number; h: number }> {
    const out = new Map<number, { x: number; y: number; w: number; h: number }>()
    const main = this.rooms.filter((r) => r.branch === 'main').sort((a, b) => a.order - b.order)
    const mainH = main.length ? Math.max(...main.map((r) => r.rect.height)) : 1
    let x = 0
    for (const r of main) {
      // 主干等高：一层的侧室是挂在主干侧墙上的，主干之间本来也由连廊连成一条
      out.set(r.order, { x, y: 0, w: r.rect.width, h: mainH })
      x += r.rect.width
    }
    // 侧室挂到它的宿主下面（宿主 = 它唯一那扇门通向的那间）
    const cursor = new Map<number, number>()
    for (const r of this.rooms.filter((r) => r.branch === 'side')) {
      const host = this.hostByOrder.get(r.order)
      if (host === undefined) continue
      const box = out.get(host)
      if (box === undefined) continue
      // ⚠️ **保留它实际在宿主的哪一侧**（上/下），只把那条缝收掉。
      //    早先一律放到下面 —— 于是「小地图显示房间在下面，当前房间却有个上面的门」：
      //    地图和实际的门位对不上，比留着缝还糟。
      const hostRoom = this.rooms[host]!
      const below = r.rect.y > hostRoom.rect.y
      const px = box.x + (r.rect.x - hostRoom.rect.x) + (cursor.get(host) ?? 0)
      const py = below ? mainH : -r.rect.height
      out.set(r.order, { x: px, y: py, w: r.rect.width, h: r.rect.height })
      cursor.set(host, (cursor.get(host) ?? 0) + r.rect.width)
    }
    return out
  }

  /** 第 `n` 间（1 起）。之前走过的算已清 —— 这一局的推进是线性的。 */
  setState(n: number): void {
    this.current = n
    this.redraw()
  }

  private redraw(): void {
    const g = this.gfx
    g.clear()
    g.fillStyle(0x15231b, 0.94).fillRect(0, 0, PANEL.width, PANEL.height)
    g.lineStyle(1, 0x9c8459, 1).strokeRect(0, 0, PANEL.width, PANEL.height)

    const inner = {
      x: PANEL.padding,
      y: PANEL.padding,
      width: PANEL.width - PANEL.padding * 2,
      height: PANEL.height - PANEL.padding * 2 - 14,
    }
    const boxes = this.compactLayout()
    const minX = Math.min(0, ...[...boxes.values()].map((b) => b.x))
    const minY = Math.min(0, ...[...boxes.values()].map((b) => b.y))
    const maxX = Math.max(1, ...[...boxes.values()].map((b) => b.x + b.w)) - minX
    const maxY = Math.max(1, ...[...boxes.values()].map((b) => b.y + b.h)) - minY
    const scale = Math.min(inner.width / maxX, inner.height / maxY)
    const ox = inner.x + (inner.width - maxX * scale) / 2 - minX * scale
    const oy = inner.y + (inner.height - maxY * scale) / 2 - minY * scale
    const at = (x: number, y: number) => ({ x: ox + x * scale, y: oy + y * scale })

    for (const room of this.rooms) {
      const b = boxes.get(room.order)
      if (b === undefined) continue
      const done = room.order + 1 < this.current
      const here = room.order + 1 === this.current
      const side = room.branch === 'side'
      const p = at(b.x, b.y)
      g.fillStyle(side ? COLORS.sideRoom : COLORS.mainRoom, done ? 0.4 : 0.85)
      g.fillRect(p.x, p.y, b.w * scale, b.h * scale)
      g.lineStyle(
        here ? 2 : 1,
        here ? 0xf2c594 : side ? COLORS.sideRoomEdge : COLORS.mainRoomEdge,
        done && !here ? 0.45 : 1,
      ).strokeRect(p.x, p.y, b.w * scale, b.h * scale)
    }

    // 门：画在自己朝邻居那一侧的边上。**位置改成由「通向哪一间」决定** ——
    // 紧凑排布之后，按地图坐标画会落在已经不存在的那段缝里。
    this.rooms.forEach((room, ri) => {
      const own = boxes.get(room.order)
      if (own === undefined) return
      const cx = own.x + own.w / 2
      const cy = own.y + own.h / 2
      for (const t of this.targets[ri] ?? []) {
        if (t === null) continue
        const other = boxes.get(this.rooms[t]!.order)
        if (other === undefined) continue
        const dx = other.x + other.w / 2 - cx
        const dy = other.y + other.h / 2 - cy
        const horiz = Math.abs(dx) >= Math.abs(dy)
        const thick = Math.max(2, 0.14 * Math.min(own.w, own.h) * scale)
        const long = Math.max(3, 0.45 * (horiz ? own.h : own.w) * scale)
        const p = at(
          horiz ? (dx > 0 ? own.x + own.w : own.x) : own.x + own.w * 0.3,
          horiz ? own.y + own.h * 0.3 : dy > 0 ? own.y + own.h : own.y,
        )
        g.fillStyle(0xf2c594, room.order + 1 <= this.current ? 0.95 : 0.5)
        g.fillRect(p.x, p.y, horiz ? thick : long, horiz ? long : thick)
      }
    })

    const room = this.rooms[this.current - 1]
    const label = room ? ROOM_KIND_LABELS[room.kind] : '—'
    this.title.setText(`第 ${this.current} / ${this.rooms.length} 间 · ${label}`)
  }

  /**
   * 钉到屏幕右上角。
   *
   * ⚠️ 世界坐标 = **相机可视区左上角** + 屏幕坐标 / 缩放。就这么简单，别绕。
   *
   * 早先这里写的是 `画布高 × 0.5 × (1 − 1/zoom) + sy/zoom`（从 `notice` 那条抄的），
   * 那个式子**只在「相机中心正好落在画布正中」时才成立**。而这里相机取的是
   * 竞技场中心（1344/2 = 672）对画布中心（1250/2 = 625），差 47px ——
   * 结果小地图的 y 算成 **−42**，整个面板画在可视区**之上**，
   * 看起来就是「根本没有小地图」，而且不报任何错。
   */
  layout(camera: Phaser.Cameras.Scene2D.Camera): void {
    const wv = camera.worldView
    const x = wv.x + (camera.width - PANEL.inset - PANEL.width) / camera.zoom
    const y = wv.y + PANEL.inset / camera.zoom
    this.gfx.setScale(1 / camera.zoom).setPosition(x, y)
    this.title
      .setScale(1 / camera.zoom)
      .setPosition(x + PANEL.padding / camera.zoom, y + (PANEL.height - 14) / camera.zoom)
  }

  destroy(): void {
    this.gfx.destroy()
    this.title.destroy()
  }
}
