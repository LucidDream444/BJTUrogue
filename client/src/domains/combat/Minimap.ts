import Phaser from 'phaser'
import { COLORS, roomFillColor } from '@/domains/procgen/presentation/floorplan'
import { ROOM_KIND_LABELS } from '@/domains/procgen/model/types'
import type { DungeonMap, Room } from '@/domains/procgen/model/types'
import type { RoomsConfig } from '@/domains/procgen/config'
import { bottom, left, right, top } from '@/domains/procgen/model/rect'

/**
 * 一层楼的缩略图，钉在屏幕右上角。
 *
 * ## 为什么不直接用 `drawFloorplan()`
 *
 * 那个函数**直接往场景里加对象、而且吃屏幕坐标** —— 战斗相机有缩放
 * （`fitCamera()` 算出来 ≈0.95），钉不到屏幕上，会跟着相机一起偏。
 * 而这个类画的是**一个 `scrollFactor = 0` 的容器**（整块在**相机空间**里），
 * 位置与缩放由 `layout()` 反解，所以相机怎么动它都钉在原地 ——
 * 为什么必须是 `scrollFactor` 而不是"每帧按 `worldView` 反算"，见 `layout()` 上面那段。
 *
 * **配色和关别名册仍然只此一份**：`COLORS` / `ROOM_KIND_LABELS` 都从
 * `domains/procgen/` 读，这里不抄。抄一份的表现是「同一个关别在两块画面上
 * 写着两个词」，谁都不会注意到。
 *
 * ---
 *
 * ## ★ 改了（v5）：画**真实几何**，不再画「紧凑排布」
 *
 * 上一版画的不是地图，是**按连通关系重新排过的一张示意图**
 * （`presentation/compactRooms.ts` 的 `compactRoomLayout()`，已删）。
 * 那个东西成立的**前提**是「一间房 = 一屏，过门直接切换」——
 * 房间之间那段连廊在画面上根本不存在，所以小地图上也不该有缝。
 *
 * **v5 把这个前提拿掉了**：玩家在一张真实的平面图上走，走廊是他真的会去的地方
 * （用户原话：「可以随意在走廊走，随意选择房间进入挑战」）。紧凑排布之下
 * 小地图会**说假话**，而且是最坏的那种假话 —— 它看起来完全正常：
 *
 * - 走廊被画没了 → 玩家读不出「从这一间怎么走到首领那一间」，
 *   而 v5 里**路线是他们自己选的**，这正是小地图唯一要回答的问题；
 * - 房间的相对位置是重排过的 → 「往东走两间」在小地图上和实际对不上。
 *
 * 所以现在画 `map.bounds` 里的真实几何：房间、**走廊**、门洞，等比缩进面板。
 *
 * ### 代价：每间房的标号基本放不下了
 *
 * 上一版的面板是照「紧凑排布后 3680×1120 ~ 4880×1720」定的，房间缩完还有
 * 40 来像素宽，够写一行 `3 普通战`。现在是整层 10520×2920 塞进 300 来像素，
 * 缩放 **≈0.029** —— 最大的 `YF604`（1800px 宽）缩完约 52px，
 * 而最小的 `YF612`（360px 宽，教休室）缩完只有 **10px**。`601` 三个字约 18px，
 * 它放不下。
 *
 * 于是标号换成**只写编号**（`604` / `梯`），放不下就整条不显示
 * （`drawLabels()` 里的两级降级，是上一版就有的那两级，只是**去掉了一级**：
 * 原来第一级是 `3 普通战`、第二级是 `3`，现在第一级是 `604`、第二级是不显示）。
 * **关别改由颜色说** —— 它本来就是颜色在说的（`COLORS.combatRoom` /
 * `nonCombatRoom`），文字那一份是冗余的，先砍冗余的那一份。
 *
 * 「这一间是什么关」还有一个去处：底部标题那一行，它说的是**当前**所在的那一间
 * （`第 1 / 3 层 · YF604 首领 · 走过 2 / 16 间`，末一个数跟着这一层的房数走）。玩家要判断「隔壁那间值不值得进」时看的是颜色。
 *
 * ## 三色状态：当前间黄、走过的绿、没到的灰
 *
 * 需求原话就是这个。颜色落在**描边**上（`strokeRect`），**填色留给关别** ——
 * 两件事各占一条通道，就不会互相盖掉。优先级：当前 > 走过 > 没到，
 * 当前那一间还要加粗（`lineStyle` 的 2px）。
 *
 * ⚠️ **「走过」只能是「走过的集合」，不能由进度推断。** 门不再是单向的
 * （v5 里 16 扇门全是「房间 ↔ 走廊」，玩家在走廊里来回走），所以
 * 「编号比当前小」推不出「走过」。真值由 `BattleScene.visited` 喂进来
 * （见 `setState()`），**按 `Room.id` 记**，不按 `order` ——
 * `order` 只是显示序，不是进度轴（见 `model/types.ts` 的 `Room.order` 那条 ⚠️）。
 */
const PANEL = {
  /**
   * ★ 改了（2026-10-23）：**400×150**（原来 320×130）。用户：「许多房间不显示房间号了」——
   * 房间缩到 8—12 格之后，320 宽的面板缩出来一间只有 9—14px，标号整条被藏掉。
   * 面板放大 25% 之后同样的房间有 12—18px，能塞下「两位数的号」。
   * （下面那段 320×130 的推导仍然成立 —— 内框 384:118 = 3.25:1，还是**宽度**卡缩放。）
   *
   * ★ 改了（v5）：**320×130**，原来 300×150。照的是**新几何的宽高比**。
   *
   * 整层是 10520×2920 = **3.60:1**（S 形），而面板内框是
   * `(320−16) : (130−16−16)` = 304 : 98 = **3.10:1** —— 比地图**瘦**一点，
   * 所以是**宽度**卡住缩放（今天：`384 / 10520 = 0.0365`，画出来 384×106.6；
   * 上一版 320 宽时是 `304 / 10520 = 0.0289`），
   * 内框里上下各余 6.8px（`redraw()` 把它们居中掉了）。
   *
   * 上一版是 300×150（内框 284:118 = 2.41:1），照的是紧凑排布那组数
   * （3680×1120 ~ 4880×1720，约 3:1）。**宽高比换了，面板就得跟着换** ——
   * 不换的话多出来的那 20px 高度是**白占的**（地图永远够不到内框的底边），
   * 而白占的地方看起来只是「小地图四周有点空」，没人会想到去改面板。
   */
  width: 400,
  height: 150,
  /** 屏幕右上角的留白 */
  inset: 12,
  padding: 8,
} as const

/** 底部那行「第 1 / 3 层 · …」占掉的高度 */
const TITLE_H = 16

/** 房间标号的字号。放不下就整条不显示，见 `drawLabels()` */
const LABEL_FONT = 10

/**
 * 状态色（当前 / 走过 / 没到）。
 *
 * ⚠️ **和 `COLORS` 不是一套、也不该是一套**：`COLORS` 分的是**关别**
 * （战斗／非战斗／首领／起点），这一组分的是**进度状态**。两件事共用一个色板，
 * 就会出现「走过的首领房和没走过的普通房同色」这种谁也读不出来的图。
 *
 * ⚠️ 它们**必须和 `COLORS` 的每一个值都不一样**，尤其是：
 * `here`（黄）别撞 `COLORS.startEdge`（起点那个黄），
 * `done`（绿）别撞 `COLORS.door`（门那个绿）—— 门是画在同一张图上的。
 * `COLORS.combatRoom` / `nonCombatRoom` 是**深色底**，这三个是**亮色描边**，
 * 天然分得开。
 */
const STATE_COLOR = {
  here: 0xffe08a,
  done: 0x9ff0bd,
  todo: 0xc8d4e0,
} as const

/** 还没喂进来过任何「走过」的集合时的替身。省得每帧 `new Set()` */
const NO_VISITED: ReadonlySet<string> = new Set<string>()

/**
 * 画成一间房的那个标号。`YF604` → `604`，`STAIR` → `梯`，`SHOP` → `商`。
 *
 * ⚠️ **不是「取后三位数字」**：`STAIR` 没有数字，直接切尾巴会切出空串，
 * 而空串的标号画出来是**一片什么也没有** —— 看起来像「楼梯间没画」，
 * 不像「标号提取写歪了」。所以取不到数字时给一个**看得见的**字。
 *
 * ★ 改了（2026-10-22）：那个「看得见的字」原先**恒为「梯」**，因为当时全层
 * 只有楼梯间一个非编号空间。逸夫楼 3F（一局的第 1 层）多了一间商店 `SHOP` ——
 * 兜底一写下去，商店在缩略图上就顶着「梯」字，而**那两块在缩略图上长得一样**，
 * 玩家会进商店里找下楼的方框。所以改成一张**表**：认得的写认得的样子，
 * 认不出的写 `?` —— 一个看得见的「这里出问题了」，而不是一个看着合理的错标号。
 *
 * ⚠️ ★ 2026-10-23：这张表**漏过一类** —— 电梯间（`E_A` / `E_B` / `E_C`）加进来时
 * 没人想起它，于是三个电梯间在缩略图上一起顶着 `?`。`?` 的设计本意就是
 * 「这里出问题了」，所以它不是一条可以长期挂着的显示；加新的非编号空间时
 * **要么进 `SHORT_LABELS`、要么进 `SHORT_PREFIX_LABELS`**。
 *
 * ⚠️ 一个字，不是原样印 `SHOP`：最小的房间（`YF612` 教休室，360px 宽）缩完只有
 * 10px，而 `SHOP` 四个字母在 18px 字号下约 40px —— 会盖住隔壁两间房，
 * 而「标号让位」那一段判的是**字宽 vs 房间宽**，它会**正确地**把自己藏起来，
 * 于是症状变成「商店在缩略图上根本没有标号」。一个字两个房间都放得下。
 */
const SHORT_LABELS: Readonly<Record<string, string>> = { STAIR: '梯', SHOP: '商' }

/**
 * **按前缀**认的设施标号。★ 新增（2026-10-23，用户：「为什么小地图给电梯间显示问号」）。
 *
 * 电梯间是 `E_A` / `E_B` / `E_C`（同一部电梯在三层的三个位置），三个都得单独往
 * `SHORT_LABELS` 里塞一遍才不显示 `?` —— 而**下一层再来一个 `E_D` 就又漏了**。
 * 前缀表一次管住一类 id，也顺手把「设施」这条规矩写在了明面上。
 */
const SHORT_PREFIX_LABELS: readonly (readonly [string, string])[] = [['E_', '电']]

function shortId(id: string): string {
  const digits = /(\d+)\s*$/.exec(id)
  if (digits !== null) return digits[1]!
  for (const [prefix, label] of SHORT_PREFIX_LABELS) if (id.startsWith(prefix)) return label
  return SHORT_LABELS[id] ?? '?'
}

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
  /**
   * 这一层的地图。★ 改了（v5）：**整个 `DungeonMap`，不是一个 `rooms` 数组**。
   *
   * 画真实几何要三样东西：房间（`rooms`）、**走廊**（`passages`）、
   * 门洞（挂在各 `room.doors` 上），外加缩放的依据 `bounds`。
   * 上一版只传 `rooms` + 一份「谁通向谁」的邻接表，那是因为紧凑排布只需要这两样。
   */
  private map: DungeonMap
  /**
   * ★ 新增（v5）：一份 `rooms.json`。**唯一用途**是把房间填色转交给 D2 的
   * `roomFillColor()` —— 见那一行的 ⚠️。它**不是**「小地图的第二份地图配置」，
   * 这个类除了填色不读它的任何字段。
   */
  private readonly cfg: RoomsConfig
  private currentId: string | null = null
  private floor = 1
  private floors = 1
  /**
   * 「走过」的房间 `Room.id`。**只存引用、不拷一份** ——
   * 宿主每帧都可能改它，拷一次就等于这份小地图从第 N 帧起就在说假话。
   */
  private visited: ReadonlySet<string> = NO_VISITED
  /**
   * 「你在这儿」的那个点。
   *
   * ★ 新增（2026-10-21，整层连续）。**上一版不需要它**：那时一层被拆成 16 屏，
   * 屏幕上限死了只有一间房，而面板上高亮的那一格就是这一间 —— 位置这件事不用画。
   *
   * 整层连续之后**必须画**：整层 10520×2920，相机只看得见其中约 1/8，
   * 而面板上唯一说得出「这 1/8 是整层的哪一块」的就是这个点。
   * 没有它，整张缩略图退化成「一张好看的图」，玩家在里面照样迷路。
   *
   * ⚠️ **不进 `gfx`**：`gfx` 只在 `redraw()` 里重画（换层 / 状态变了），
   * 而这个点**每帧都在动**。混在一起就得每帧重画整张面板。
   */
  private readonly marker: Phaser.GameObjects.Arc
  /**
   * 上一次 `redraw()` 用的**地图 → 面板**换算。
   *
   * ⚠️ 存下来是必需的、不是省事：`marker` 每帧按它定位，而 `redraw()` 才不会
   * 每帧跑。两个值不同步的那天，表现是"点跑到了别的房间上"——
   * 面板没变、点也没报错，只是对不上。所以两者**只在 `redraw()` 里一起更新**。
   */
  private view = { ox: 0, oy: 0, scale: 1 }

  constructor(scene: Phaser.Scene, map: DungeonMap, cfg: RoomsConfig, floor = 1, floors = 1) {
    this.map = map
    this.cfg = cfg
    this.floor = floor
    this.floors = floors
    // ⚠️ **`setScrollFactor(0)` 是「钉住」的前提，不是修饰。**
    //    容器渲染时 Phaser 会把容器的 scrollFactor **乘进每一个子对象**
    //    （`ContainerWebGLRenderer`：`child.setScrollFactor(childSfx * containerSfx, …)`），
    //    所以这一句把整块面板（Graphics / 标题 / 标号 / 那个点）一起改成**相机空间**，
    //    相机怎么滚都不参与 —— **构造上就不会抖**，而不是"抖得比较小"。
    //    不设的话就得在 `layout()` 里按 `worldView` 反算世界坐标，而那会**晚一帧**：
    //    见 `layout()` 里那段（走一步抖一下的实测）。
    this.root = scene.add.container(0, 0).setScrollFactor(0).setDepth(4600)
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
    // 半径 3.5：面板只有 320×130，而整层缩到面板里是**约 0.029 倍** ——
    // 一格地板（40px）在上面只有 1.16px。再大的话这个点会盖住它所在的那间房，
    // 而"在哪一间"正是它要说的事。
    this.marker = scene.add
      .circle(0, 0, 3.5, 0xffffff, 1)
      .setStrokeStyle(1.5, 0x11161f, 1)
      .setVisible(false)
    // 容器内的绘制顺序 = **加进去的顺序**（`setDepth` 在容器里不起作用），
    // 所以先背景、再标题、最后标号 —— 标号要压在格子和门上面。点在**最后**：
    // 它是最小、最需要压在最上面的那一个。
    this.root.add([this.gfx, this.title, this.marker])
    // 标号按 `rooms` **建一次**，之后只改字和位置 —— 每帧 `new Text` 会把
    // Phaser 的文本渲染缓存撑爆（每段字要一张画布）。
    this.buildLabels(scene)
    this.redraw()
  }

  private buildLabels(scene: Phaser.Scene): void {
    for (let i = 0; i < this.map.rooms.length; i++) {
      const t = scene.add
        .text(0, 0, '', {
          fontFamily: 'Microsoft YaHei, sans-serif',
          fontSize: `${LABEL_FONT}px`,
          color: '#c8d4e0',
          align: 'center',
        })
        .setOrigin(0.5)
      this.labels.push(t)
      // ⚠️ **插在标记点之前，不是 `add()` 到末尾。** 容器里的顺序 = 加进去的顺序
      // （`setDepth` 在容器里不起作用），而 `setFloor()` 会把标号全部重建 ——
      // 用 `add()` 的话，「你在这儿」那个点会在第一次换层之后被压在标号底下，
      // 表现是"下楼之后小地图上那个点没了"，而它其实还在（只是被字盖住了）。
      this.root.addAt(t, this.root.getIndex(this.marker))
    }
  }

  /**
   * 换一层楼。★ 改了（v5）：收的是**新的整张地图**，不再是 `(rooms, targets, …)`。
   *
   * 换层时地图**整个换掉**（`BattleScene.loadFloor()`）、房间数也可能不同，
   * 所以标号全部重建 —— 复用旧的会剩下一堆对不上任何房间的 `Text`。
   */
  setFloor(map: DungeonMap, floor: number, floors: number): void {
    for (const label of this.labels) label.destroy()
    this.labels.length = 0
    this.map = map
    this.floor = floor
    this.floors = floors
    this.buildLabels(this.root.scene)
    this.currentId = null
    this.visited = NO_VISITED
    this.redraw()
  }

  /**
   * 「现在在哪一间」+「走过哪些间」。
   *
   * ★ 改了（v5）：**两个参数都是 `Room.id`，不再是「第几间」那个整数。**
   *
   * - `currentId`：玩家所在的房间 id（在走廊里时是 `null` —— v5 里走廊是常去的地方，
   *   而「我在走廊里」不该被画成「我在某一间房里」）。`null` 时**没有任何一间**是黄的。
   * - `visited`：走过的房间 id 集合。**按 `id` 不按 `order`**，理由见文件头。
   *
   * 不传 `visited` = 没有任何一间算走过（只有当前间是黄的）。
   */
  setState(currentId: string | null, visited?: ReadonlySet<string>): void {
    this.currentId = currentId
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
    // **等比**缩放：`Math.min` 两个轴一起用。逐轴各算一个 `sx` / `sy` 会把房间
    // 拉成另一个宽高比 —— 那读起来像"地图画错了"，而不是"缩略图挤了一下"。
    const b = this.map.bounds
    const scale = Math.min(inner.width / b.width, inner.height / b.height)
    const ox = inner.x + (inner.width - b.width * scale) / 2 - left(b) * scale
    const oy = inner.y + (inner.height - b.height * scale) / 2 - top(b) * scale
    /** 地图坐标 → **面板内坐标**（不是屏幕坐标；容器的变换负责搬到屏幕上）。 */
    const at = (x: number, y: number) => ({ x: ox + x * scale, y: oy + y * scale })
    // ★ 与上面那三行**同生共死**：`setPlayer()` 每帧靠这三个数定位，而它自己
    //   不会重算（那要重画整张面板）。放在这儿 = 面板画一次、换算就更新一次。
    this.view = { ox, oy, scale }

    // ---- 走廊**先**画，房间压在上面
    //
    // ⚠️ 顺序反了的话，走廊会盖掉贴着它的房间边缘那一条 —— 而「房间从走廊进」
    // 正是这张图上唯一要读的关系。房间的矩形不含墙，走廊的矩形也不含墙，
    // 两者**之间**隔着一格墙（40px → 缩放后 1.16px），所以走廊根本盖不到房间。
    // 但那是**今天**的几何（`floor-plan.json` 里墙恒为 1 格）；顺序定死成
    // 「走廊在下」就不用靠这个前提。**别为了省一层改成一起画。**
    for (const p of this.map.passages) {
      const t = at(left(p.rect), top(p.rect))
      g.fillStyle(COLORS.passage, 0.9).fillRect(t.x, t.y, p.rect.width * scale, p.rect.height * scale)
    }

    // ---- 房间：**填色说关别、描边说状态**
    for (const room of this.map.rooms) {
      const r = room.rect
      const t = at(left(r), top(r))
      const w = r.width * scale
      const h = r.height * scale
      const here = room.id === this.currentId
      const done = !here && this.visited.has(room.id)

      // 填色**走 D2 的那一份**（`roomFillColor`）：小地图和整层图绝不能
      // 把同一间房画成两个颜色 —— 两边各写一遍 `kind === 'boss' || …`
      // 就是第二份 `combatKinds`，改了配置表它不会跟着变，而且**两边都不报错**。
      g.fillStyle(roomFillColor(this.cfg, room), done ? 0.55 : 0.95)

      // 状态色压在关别的边上。没到的**不统一用灰** —— 首领房给红描边、楼梯间给黄描边，
      // 那是「一眼找到它俩」的唯一线索（`COLORS.bossEdge` / `startEdge` 的注释说的就是这个）。
      // ★ 2026-10-23：**电梯间给青描边**（`COLORS.elevatorEdge`）—— 它只有 8×8 格，
      // 缩完放不下「电」那个字（`drawLabels` 会整条藏掉），所以它只能靠颜色认。
      // `todo` 那一档只吃自己关别的边色，其余房间才是灰。
      const edge = here
        ? STATE_COLOR.here
        : done
          ? STATE_COLOR.done
          : room.kind === 'boss'
            ? COLORS.bossEdge
            : room.kind === 'start'
              ? COLORS.startEdge
              : room.kind === 'elevator'
                ? COLORS.elevatorEdge
                : STATE_COLOR.todo
      g.lineStyle(here ? 2 : 1, edge, here || !done ? 1 : 0.7)
      g.strokeRect(t.x, t.y, w, h)
    }

    // ---- 门洞：真实坐标，真实朝向
    //
    // ⚠️ 按**轴线**画：`axis === 'h'` 的门开在水平墙上，门的**长度沿 x**；
    // 画反了就是「门横在它穿不过去的那堵墙上」，而看图上只是几像素的短线，
    // **看不出错**。门的两侧各补 `wallThickness`（40px）撑满那堵墙的厚度，
    // 缩完只有 1.16px，所以下面的最小尺寸**不是**可选的润色：
    // 不兜底的话门在缩放 0.029 下会细到 0.5px，Phaser 画出来时有时无。
    for (const room of this.map.rooms) {
      for (const d of room.doors) {
        const long = Math.max(2, d.width * scale)
        const thick = Math.max(1.5, this.map.navCellSize * scale)
        const p = at(d.x, d.y)
        g.fillStyle(COLORS.door, 0.9)
        if (d.axis === 'h') g.fillRect(p.x - long / 2, p.y - thick / 2, long, thick)
        else g.fillRect(p.x - thick / 2, p.y - long / 2, thick, long)
      }
    }

    this.drawLabels(at, scale)

    const here = this.currentRoom()
    const label = here === null ? '走廊' : `${here.id} ${ROOM_KIND_LABELS[here.kind]}`
    const gone = this.countVisited()
    this.title.setText(
      `第 ${this.floor} / ${this.floors} 层 · ${label} · 走过 ${gone} / ${this.map.rooms.length} 间`,
    )
  }

  private currentRoom(): Room | null {
    if (this.currentId === null) return null
    return this.map.rooms.find((r) => r.id === this.currentId) ?? null
  }

  /** 走过的**编号教室数**（楼梯间不算 —— 出生点一开局就在那里，算进去会虚高一头） */
  private countVisited(): number {
    let n = 0
    for (const room of this.map.rooms) if (this.visited.has(room.id)) n++
    return n
  }

  /**
   * 每间房一条编号（`604` / `601` / `梯`）。
   *
   * `at` 是「地图坐标 → 面板坐标」那个换算，和房间/走廊/门**共用同一个** ——
   * 各算一份的话，字和格子会在某些房间上错开，而那种偏移看起来像"字没对齐"，
   * 不像算错了。
   *
   * 放不下就**不显示**（不是硬挤）—— 硬挤的字会糊到隔壁房间上，
   * 读起来像另一个房间的名字，比没有字更糟。判据用 `Text.width`
   * （真排版出来的宽度）而不是估的：面板尺寸那笔账才是估的，这里量得到就别估。
   *
   * ★ 改了（v5）：降级从**三级**变**两级**（去掉了「只留关别」那一级）。
   * 整层缩到 0.029 之后连编号都只有大房间放得下，关别那三个字（`普通战`）
   * 在任何一间房上都放不下 —— 留一级**永远走不到**的降级，
   * 等于让人以为它还会生效。关别由填色说，见文件头。
   */
  private drawLabels(
    at: (x: number, y: number) => { x: number; y: number },
    scale: number,
  ): void {
    this.map.rooms.forEach((room, ri) => {
      const t = this.labels[ri]
      if (t === undefined) return
      const w = room.rect.width * scale
      // ★ 改了（2026-10-23，用户：「许多房间不显示房间号了」）：**三级降级**，不再一刀切。
      //
      // 房间缩到 8—12 格之后，一间在小地图上只有 9—14px，而 `112` 三个数字要 16px ——
      // 原来那一句「放不下就整条不显示」于是把一大片房间的号**全抹了**。
      // 现在依次试：全号 → 去掉百位的两位号（`112` → `12`）→ 再小一号字。
      // 两位号在同一层里是唯一的（1F `01`—`13`、3F `01`—`13`、6F `01`—`15`），
      // 而「这是第几层」小地图标题上一直写着 —— 少一位不会认错房间。
      // 四级都放不下（比如 8×8 的电梯间）才藏起来：那几间靠**填色**认（`roomFillColor`）。
      const full = shortId(room.id)
      const compact = /^\d{3,}$/.test(full) ? full.slice(-2) : full
      // `-4` 是给描边留的两侧余量（描边画在矩形边上，不占宽度，
      // 但字贴着边看起来就像被框切了一半）。宽度是**面板单位** —— 标号和格子
      // 都被同一个 1/zoom 缩放，所以在这里比和在屏幕上比是同一件事。
      const fits = (text: string, size: number): boolean => {
        t.setFontSize(size)
        t.setText(text)
        return t.width <= w - 4
      }
      let text: string | null = null
      for (const [candidate, size] of [
        [full, LABEL_FONT],
        [full, LABEL_FONT - 1],
        [compact, LABEL_FONT],
        [compact, LABEL_FONT - 1],
        [compact, LABEL_FONT - 2],
      ] as const) {
        if (text === null && fits(candidate, size)) text = candidate
      }
      t.setVisible(true)
      if (text === null) {
        t.setVisible(false)
        return
      }
      t.setText(text)
      t.setColor(
        room.id === this.currentId
          ? '#ffe08a'
          : this.visited.has(room.id)
            ? '#9ff0bd'
            : '#c8d4e0',
      )
      // 摆在格子正中：**面板内坐标**（标号是容器的子对象，容器自己负责搬到屏幕上）
      const c = at(room.rect.x, room.rect.y)
      t.setPosition(c.x, c.y)
    })
  }

  /**
   * 把「你在这儿」那个点挪到世界坐标 `(x, y)` 对应的面板位置上。**每帧调一次**。
   *
   * 世界坐标 = 地图坐标（整层连续里两者恒等，见 `DungeonStages.ts` 文件头），
   * 所以这里**不需要再换算一层** —— 直接喂 `this.view` 那三个数。
   *
   * 出界时**藏起来**而不是画在面板外面：`Arc` 没有裁剪，画在容器外会飘到
   * 屏幕别处去（看着像又多了一个 UI 元素），而「点不在图上」的正确读法是
   * 「这一帧玩家不在这一层的地图里」—— 换层的那一帧会短暂地是这样。
   */
  setPlayer(x: number, y: number): void {
    const b = this.map.bounds
    if (x < left(b) || x > right(b) || y < top(b) || y > bottom(b)) {
      this.marker.setVisible(false)
      return
    }
    this.marker.setVisible(true).setPosition(this.view.ox + x * this.view.scale, this.view.oy + y * this.view.scale)
  }

  /**
   * 钉到屏幕右上角。**整块一起搬**（见 `root` 那段注释）。
   *
   * ---
   *
   * ## ★ 改了（2026-10-21）：不再按 `worldView` 反算世界坐标 —— 那会**晚一帧**，走一步抖一下
   *
   * 上一版摆的是世界坐标：`root.x = camera.worldView.x + 常数 / zoom`。看着等价，其实
   * **每帧都差一个「本帧的相机位移」**：
   *
   * - `worldView` **只在 `Camera.preRender()` 里被写**（`cameras/2d/Camera.js`），
   *   而那是**渲染阶段**的事 —— 连相机跟随的插值（`preRender` 里那几行 `Linear(sx, …)`）
   *   都在那里跑；
   * - 本方法却是在 `Scene.update()` 里调的（`layoutHud()` 那一行）。而
   *   `CameraManager.update` 挂在 `UPDATE` 事件上，**先于** `sceneUpdate`。
   *
   * 于是面板按**上一帧**的相机位置摆好，渲染时相机已经往前走了 Δ —— 屏幕上看，
   * 整块面板偏 Δ·zoom。Δ 就是角色这一帧走的距离：**走一步抖一下，
   * 停下之后要等相机 lerp 收敛才不抖。**
   *
   * ## 实测（`minimap_shake.mjs`，真浏览器逐帧采样；它**同一次运行里把新旧两种摆法都量一遍**）
   *
   * 判据是**面板左上角落在画布上的像素位置** —— 照抄渲染真正用的那条算式
   * （`GetCalcMatrix.js:55` 的 `−scrollX × scrollFactor`，再乘相机矩阵），
   * 所以 `scrollFactor` 是 0 还是 1，同一个尺子都量得动。
   *
   * | | 面板屏幕位置 | 静止 | 走动（每帧挪 2px） | 停下之后 |
   * |---|---|---|---|---|
   * | **旧摆法**（`worldView`，sf=1） | 静止时 948.48（差 0.48px） | 0.00px | **1.73px** | **1.73px** |
   * | **现在**（相机空间，sf=0） | 948.00 = 目标 | **0.00px** | **0.00px** | **0.00px** |
   *
   * 走动那一列的 1.73px = 探针每帧挪的 **2px 世界距离 × zoom 0.865** —— 就是「每帧少算一步」
   * 换算到屏幕上的样子。⚠️ **别把它和 2.00px 当两个数**：上一版探针量的是**世界**坐标差
   * `root.x − scrollX`（那会儿 sf=1，那个差正好代表屏幕位置），读出来是 2.00px；
   * 这里换成屏幕像素，同一个位移就成了 1.73px。**是换了尺子，不是"修完从 2.00 变 1.73"。**
   *
   * 静止那格的 948.48 是另一回事：**`worldView` 被 `Math.floor(… + 0.5)` 取整过**
   * （`Camera.js:584`），所以连"摆对了"的那一帧也只能准到 ±0.5 世界像素（≈0.43 屏幕像素）。
   * **相机空间里没有这个取整**，正好是 948.00。
   *
   * ## 现在这么算：面板在**相机空间**（`scrollFactor = 0`）
   *
   * 屏幕位置 = `对象坐标 × zoom + 画布 × origin × (1 − zoom)`
   * （那是 `TransformMatrix.applyITRS(x + originX, …)` 再 `translate(−originX, …)` 的结果：
   * 相机矩阵把对象坐标按 zoom 缩放，「缩放中心在哪」由 `origin` 决定）。
   * 反解出「想让面板左上角落在屏幕 `(宽 − inset − 面板宽, inset)`」的对象坐标：
   *
   * ```
   * root.x = 画布宽 × originX × (1 − 1/zoom) + (宽 − inset − 面板宽) / zoom
   * root.y = 画布高 × originY × (1 − 1/zoom) + inset / zoom
   * ```
   *
   * **和另外三个 HUD 写成同一个形状**（`StatusHud.update()` / `LoadoutHud.update()` /
   * `BattleScene.layoutHud()` 里的 `notice`）—— 同一个式子在仓库里长四个样子，
   * 就是下次有人「顺手统一一下」时改错其中一个的开始。
   * **式子里没有 scroll**：相机怎么滚都影响不到它，这才是"钉住"。
   *
   * ⚠️ 早先这里抄的是 `画布高 × 0.5 × (1 − 1/zoom) + sy/zoom` —— 形状一样，但 `origin` 被
   * **写死成 0.5**，于是只在「相机中心正好落在画布正中」时才成立。而这里相机取的是
   * 竞技场中心（1344/2 = 672）对画布中心（1250/2 = 625），差 47px ——
   * 结果小地图的 y 算成 **−42**，整个面板画在可视区**之上**，
   * 看起来就是「根本没有小地图」，而且不报任何错。
   * 写 `camera.originX/Y` 而不是 0.5，换画布尺寸、换 `fitCamera()` 的取景都不会再错。
   */
  layout(camera: Phaser.Cameras.Scene2D.Camera): void {
    const z = camera.zoom
    this.root
      .setScale(1 / z)
      .setPosition(
        camera.width * camera.originX * (1 - 1 / z) + (camera.width - PANEL.inset - PANEL.width) / z,
        camera.height * camera.originY * (1 - 1 / z) + PANEL.inset / z,
      )
  }

  destroy(): void {
    // `true` = 连子对象一起销毁（gfx / 标题 / 标号都在里面）
    this.root.destroy(true)
    this.labels.length = 0
  }
}