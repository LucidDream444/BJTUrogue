import Phaser from 'phaser'
import { COLORS } from '@/domains/procgen/presentation/floorplan'
import { ROOM_KIND_LABELS } from '@/domains/procgen/model/types'
import type { Room } from '@/domains/procgen/model/types'
import { compactExtent, compactRoomLayout } from '@/domains/procgen/presentation/compactRooms'

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
 * ## 每间房上写着「号 + 关别」
 *
 * 光有格子看不出「还有几间」「这间是什么」，所以每间写一行 `3 普通战`。
 * 三色分状态（需求原话："当前间黄、走过的绿、没到的灰"）：
 * 黄 = 正在这一间、绿 = 走过、灰 = 还没到。
 *
 * ⚠️ **「走过」只能是「走过的集合」，不能由进度推断。** 门是按 `toOrder` 走的
 * （能回头、能拐进侧室），所以「间号比当前小」推不出「走过」——
 * 早先这里写的是 `room.order + 1 < this.current`，在一条直线走到底时看着是对的，
 * 一回头、或者主干上拐进侧室再出来，就会把没进过的房间画成绿的。
 * 真值由 `BattleScene.visited` 喂进来（见 `setState()`）。
 *
 * ## 面板尺寸（300×150）是**照最宽的种子倒推**的，不是随手挑的
 *
 * 一排房间紧凑排布之后，在 10 个种子上外框是 **3680×1120 ~ 4880×1720**
 * （侧室横着顺次排，见 `compactRooms.ts` 的文件头 —— 这是它为什么会这么宽的原因）。
 * 按内框等比缩下来，**最窄的一间只剩 40 来像素**，而 `1 普通战` 那一串字约 39px
 * （10px 字号在真浏览器里量出来 38.8）。`compactRooms.test.ts` 钉着这两条，
 * 破了会在 `npm test` 里红 —— 那里的失败信息会指向这里。
 */
const PANEL = {
  width: 300,
  height: 150,
  /** 屏幕右上角的留白 */
  inset: 12,
  padding: 8,
} as const

/** 底部那行「第 3 / 7 间 · 精英」占掉的高度 */
const TITLE_H = 16

/** 房间标号的字号。**和 `compactRooms.test.ts` 里那把尺子是同一个数**，改这里要改那边 */
const LABEL_FONT = 10

/**
 * 标号的三色。**和格子的状态色不是一套** —— 格子用的是 `COLORS`（D2 的地图配色，
 * 分主干/侧室），标号说的是进度状态，两件事不该共用一个色板。
 */
const LABEL_COLOR = {
  here: '#ffe08a',
  done: '#9ff0bd',
  todo: '#c8d4e0',
} as const

/** 还没喂进来过任何「走过」的集合时的替身。省得每帧 `new Set()` */
const NO_VISITED: ReadonlySet<number> = new Set<number>()

export class Minimap {
  /**
   * 面板上的东西**全部挂在这一个容器里**（`gfx` / 标题 / 每间的标号）。
   *
   * ⚠️ 不是为了整齐，是为了**只留一处坐标换算**。这里踩过一次：
   * 原先 `gfx` 单独 `setScale(1/zoom)`，标题和标号也各自 `setScale(1/zoom)`
   * 再 `setPosition(x + 面板内坐标)`。看着对称，其实两码事 ——
   * Graphics 的 `1/zoom` 缩放作用在**它画出来的每一笔**上（局部坐标 = 面板内坐标）；
   * 而 Text 的 `setPosition` 吃的是**世界坐标**，那个 `1/zoom` 只缩字号、不缩位置。
   * 于是标号的位置被漏乘了一次 `zoom`：越靠右偏得越多（实测第 7 间偏 36px，
   * 四间房的标号压到了隔壁格子上），而**它看起来只是"字没对齐"**。
   *
   * 挂进容器之后三个子对象共用一套变换，面板内坐标就是面板内坐标 ——
   * `layout()` 只剩一行，也不再有"谁该乘 zoom、谁不该"的问题。
   */
  private readonly root: Phaser.GameObjects.Container
  private readonly gfx: Phaser.GameObjects.Graphics
  private readonly title: Phaser.GameObjects.Text
  /** 每间房一条标号，**下标与 `rooms` 同序**（不是 `order`） */
  private readonly labels: Phaser.GameObjects.Text[] = []
  private current = 1
  /**
   * 「走过」的房间 `order`（0 起）。**只存引用、不拷一份** ——
   * 宿主每帧都可能改它，拷一次就等于这份小地图从第 N 帧起就在说假话。
   */
  private visited: ReadonlySet<number> = NO_VISITED

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
    this.root = scene.add.container(0, 0).setDepth(4600)
    this.gfx = scene.add.graphics()
    this.title = scene.add.text(0, 0, '', {
      fontFamily: 'Microsoft YaHei, sans-serif',
      fontSize: '12px',
      // 暖羊皮纸色，配手绘地图（D1/D2 在 `5cf9e28` 里改的，原来是小地图的冷蓝 `#dcecff`）
      color: '#e8d6ae',
    })
    // 标题钉在**面板左下**：地图区留到 `PANEL.height - TITLE_H`，下面这一条正好是标题。
    // ⚠️ 位置只在构造里设一次 —— 它是容器子对象，`layout()` 只搬容器，标题跟着走。
    //    （改成每帧在 `layout()` 里算也行，但那样就得记着"谁该加 padding、谁不该"。）
    this.title.setPosition(PANEL.padding, PANEL.height - 14)
    // 容器内的绘制顺序 = **加进去的顺序**（`setDepth` 在容器里不起作用），
    // 所以先背景、再标题、最后标号 —— 标号要压在格子和门上面。
    this.root.add([this.gfx, this.title])
    // 标号按 `rooms` **建一次**，之后只改字和位置 —— 每帧 `new Text` 会把
    // Phaser 的文本渲染缓存撑爆（每段字要一张画布）。
    for (let i = 0; i < rooms.length; i++) {
      const t = scene.add
        .text(0, 0, '', {
          fontFamily: 'Microsoft YaHei, sans-serif',
          fontSize: `${LABEL_FONT}px`,
          color: LABEL_COLOR.todo,
          align: 'center',
        })
        .setOrigin(0.5)
      this.labels.push(t)
      this.root.add(t)
    }
    this.setState(1)
  }

  /**
   * 第 `n` 间（**1 起**，和 `BattleScene.stage` 同一个口径）。
   *
   * `visited` 是「走过的房间 `order`」集合（**0 起**，就是 `BattleScene.visited` 本身）。
   * 不传 = 没有任何一间算走过（只有当前间是黄的）。
   */
  setState(n: number, visited?: ReadonlySet<number>): void {
    this.current = n
    this.visited = visited ?? NO_VISITED
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
      height: PANEL.height - PANEL.padding * 2 - TITLE_H,
    }
    const boxes = compactRoomLayout(this.rooms, this.targets)
    const ext = compactExtent(boxes)
    // **等比**缩放：`Math.min` 两个轴一起用。逐轴各算一个 `sx` / `sy` 会把房间
    // 拉成另一个宽高比 —— 那读起来像"地图画错了"，而不是"缩略图挤了一下"。
    const scale = Math.min(inner.width / ext.width, inner.height / ext.height)
    const ox = inner.x + (inner.width - ext.width * scale) / 2 - ext.minX * scale
    const oy = inner.y + (inner.height - ext.height * scale) / 2 - ext.minY * scale
    const at = (x: number, y: number) => ({ x: ox + x * scale, y: oy + y * scale })

    for (const room of this.rooms) {
      const b = boxes.get(room.order)
      if (b === undefined) continue
      const here = room.order === this.current - 1
      const done = !here && this.visited.has(room.order)
      const side = room.branch === 'side'
      const p = at(b.x, b.y)
      const w = b.w * scale
      const h = b.h * scale
      g.fillStyle(side ? COLORS.sideRoom : COLORS.mainRoom, done ? 0.4 : 0.85)
      g.fillRect(p.x, p.y, w, h)
      g.lineStyle(
        here ? 2 : 1,
        here ? 0xf2c594 : side ? COLORS.sideRoomEdge : COLORS.mainRoomEdge,
        done && !here ? 0.45 : 1,
      ).strokeRect(p.x, p.y, w, h)
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

    this.drawLabels(boxes, at, scale)

    const room = this.rooms.find((r) => r.order === this.current - 1)
    const label = room ? ROOM_KIND_LABELS[room.kind] : '—'
    this.title.setText(`第 ${this.current} / ${this.rooms.length} 间 · ${label}`)
  }

  /**
   * 每间房一条「号 + 关别」。
   *
   * `at` 是「紧凑地图坐标 → 面板坐标」那个换算，和格子/门**共用同一个** ——
   * 各算一份的话，字和格子会在某些种子上错开，而那种偏移看起来像"字没对齐"，
   * 不像算错了。
   *
   * 放不下就**降级**，两级：先去掉关别只留号，连号都放不下就整条不显示。
   * 降级而不是硬挤：硬挤的字会糊到隔壁房间上，读起来像另一个房间的名字。
   * 判据用 `Text.width`（真排版出来的宽度）而不是估的 —— 面板尺寸那笔账
   * 才是估的，这里量得到就别估。
   */
  private drawLabels(
    boxes: ReadonlyMap<number, { x: number; y: number; w: number; h: number }>,
    at: (x: number, y: number) => { x: number; y: number },
    scale: number,
  ): void {
    this.rooms.forEach((room, ri) => {
      const t = this.labels[ri]!
      const b = boxes.get(room.order)
      if (b === undefined) {
        t.setVisible(false)
        return
      }
      const here = room.order === this.current - 1
      const done = !here && this.visited.has(room.order)
      const w = b.w * scale
      // 三级：`3 普通战` → `3` → 不显示。宽度是**面板单位** —— 标号和格子
      // 都被同一个 1/zoom 缩放，所以在这里比和在屏幕比是同一件事。
      const full = `${room.order + 1} ${ROOM_KIND_LABELS[room.kind]}`
      t.setVisible(true)
      t.setText(full)
      if (t.width > w - 4) {
        t.setText(String(room.order + 1))
        if (t.width > w - 4) t.setVisible(false)
      }
      t.setColor(here ? LABEL_COLOR.here : done ? LABEL_COLOR.done : LABEL_COLOR.todo)
      // 摆在格子正中：**面板内坐标**（标号是容器的子对象，容器自己负责搬到屏幕上）
      const c = at(b.x + b.w / 2, b.y + b.h / 2)
      t.setPosition(c.x, c.y)
    })
  }

  /**
   * 钉到屏幕右上角。**整块一起搬**（见 `root` 那段注释）。
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
    this.root
      .setScale(1 / camera.zoom)
      .setPosition(
        wv.x + (camera.width - PANEL.inset - PANEL.width) / camera.zoom,
        wv.y + PANEL.inset / camera.zoom,
      )
  }

  destroy(): void {
    // `true` = 连子对象一起销毁（gfx / 标题 / 标号都在里面）
    this.root.destroy(true)
    this.labels.length = 0
  }
}