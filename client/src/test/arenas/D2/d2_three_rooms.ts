/**
 * **一层只有三间** —— 把「一层的转接」压到最小，再给它一张小地图。
 *
 * ## 这一场回答什么问题
 *
 * | 问题 | 在哪看 |
 * |---|---|
 * | 一层只有三间时，转接（进房封门 / 清完放行 / `F` 过门 / 不回头）还成不成立 | 走一遍就知道 —— **规则本身一行没改** |
 * | 「我在哪、哪些打完了、哪扇门现在能走」能不能**一眼**看出来 | 下方那张小地图（不用读文字） |
 * | 教室的观感（`d2_classroom_scene` 那张效果图）在**走位**时跟不跟得上 | `L` 键在观感 / 白箱之间切 |
 * | 换一批种子，家具与刷怪点还是不是随机的那一套 | `N` 换种子：桌椅的摆法变了，读数里那两个数也跟着变 |
 *
 * ## 它和 `d2_room_flow` 的关系：**同一台机器，四个参数不同**
 *
 * 门的状态机、镜头推移、清房判定、宽限窗口这四样**一行都没有重写** ——
 * 全部继承自 `D2RoomFlowArena`，这一场只覆盖它留的四个钩子：
 *
 * | 钩子 | 这一场改成 |
 * |---|---|
 * | `seed` | 模块级的 `seedIndex` 取 `D2_SEEDS` 里的一张牌（`N` 键翻） |
 * | `roomCount` | `3` —— 走 `roomsConfigWithRoomCount`（改原始 JSON、**校验器照跑**） |
 * | `keyHints()` | 父类那行放不下这一场自己的键，拆成两行（见 `extraReadoutLines`） |
 * | `extraReadoutLines()` | 观感开关 · 本房家具与刷怪点 · 这一场自己的键 |
 *
 * 为什么不复制一份自己改：**门的状态机一旦有两份，迟早分叉** ——
 * 而分叉的症状是「同一扇门在两个场子里一个过得去一个过不去」，
 * 没有报错，只能靠人碰巧看见。理由在 `D2RoomFlowArena` 的类注释里写全了。
 *
 * ## ⚠️「三间、三间都能打」不是生成器保证的，是**另外一份测试**钉住的
 *
 * 关别是**位置**推出来的（第一间 `start`、最后一间 `boss`、中间 `main`），
 * 三类都在 `combatKinds` 里，所以三间都是战斗房。但**刷怪点是生成器挑的**：
 * 小图上挑不出格子就给一个空数组，而空数组的后果不是报错，是**那一间进门就放行**
 * （现场看起来像「门的判定坏了」，而查门的判定永远查不出来）。
 *
 * 所以「三间都刷得出怪」由 `gen/threeRooms.test.ts` **按 500 个种子逐间扫**钉着
 * （1500 间，一间空的都没有）。这一场不做第二次检查 —— 它只负责把这件事演出来。
 *
 * ## 深度：观感层为什么是 −48
 *
 * | 层 | 深度 | 谁画的 |
 * |---|---|---|
 * | 底图（地板 / 判定 / 门标注） | −200 / −100 / −80 / −70 | 底座 + `drawFloorplan` |
 * | 底座那些**灰墙** | −50 | 底座 `drawBackground` |
 * | **观感层** | **−48** | 这一场（`drawClassroomLook`） |
 * | 压暗（「这一间之外」） | −44 | 父类 |
 * | 门标记 | −40 | 父类 |
 *
 * 压在灰墙（−50）**上面**：教室画出来才是教室，而不是被一片灰方块糊住。
 * 压在门标记（−40）**下面**：门是玩家正在看的东西，红绿必须最亮。
 *
 * 代价写清楚：`drawFloorplan` 那两条小标注（门上的 `→N`、连廊名）在 −70，
 * **被观感层盖住**。「门外是哪一间」改由小地图回答 —— 三间房并排摆着、关别写在上面，
 * 比两条小字直接。按 `L` 收掉观感层，那两条标注立刻回来。
 *
 * ## 小地图：**示意图**，不是缩略图
 *
 * 它是按 `map.bounds` **逐轴拉伸**进去的（x 一个比例、y 另一个），这样三间房在屏上
 * 排得开、读得清 —— 真实比例下（一层 ≈ 6:1 的长条）房间会挤成几像素宽的一条。
 *
 * 因此**不能用 `mapperFor()`**（它只有一个 `scale`）：那个是「地图 → 世界」的映射，
 * 全场只有一份（`this.layout.mapper`）；这张图是**另一件事**，两个比例写在这里、
 * 也只活在这里。⚠️ 两者混起来的表现是「人撞在桌子左边、画在桌子右边」，且不报错。
 *
 * 画什么见 `drawMinimap`。**判断全读现成的**：当前房读 `currentOrder`、已清读
 * `clearedRooms`、门的红绿读 `shut[]` —— 一样都不自己算，所以小地图上写的
 * 就是门那边正在用的那个数。
 *
 * ## 怎么开
 *
 * ```
 * npm run dev   →   http://localhost:5173/test.html?arena=d2_three_rooms
 * ```
 *
 * | 键 | 干什么 |
 * |---|---|
 * | `WASD` | 走。桌椅、墙、门洞都撞得住（**门洞也撞得住** —— 门是互动点） |
 * | `左键` | 打一枪（底座那个调试枪） |
 * | `N` | 换下一张牌：整层按新种子**重新生成** |
 * | `L` | 观感 / 白箱 切换（见上面那张深度表） |
 * | `F` | 过门。只有站在门前、且这一扇现在可过才生效 |
 * | `C` | 模拟清图：不打，也把这一间当成清完了 |
 * | `V` | 重刷本房（用来重复看清房那一下） |
 * | `Q` | 收起右下角的自检读数（它压着教室东侧那一带） |
 * | `R` / `0` / `I` / `空格` | 复位 / 清场 / 无敌 / 暂停（底座给每个场子都有的那几个） |
 *
 * ## ⚠️ 这一场**不验**什么
 *
 * - **它不是产品场景**：过门的节奏、门是互动点还是走过去，产品里归 D1。
 * - **怪绕不绕得开桌椅**：底座的寻路网格只吃墙（`ArenaConfig.walls`），桌椅没进过网格
 *   —— 和 `d2_classroom` / `d2_room_flow` 是同一笔账。
 * - **家具好不好看**：黑板 / 窗 / 盆栽是**画上去的装饰**，不在任何数据结构里
 *   （见 `_classroomLook.ts` 文件头那张表）；要变成真东西是**改契约**，不是把画法搬过去。
 * - **小地图的比例**：它是示意图，别拿它量距离。
 * - **窄画布**：小地图要摆进「左下按键说明」与「右下读数」之间，画布窄到放不下时
 *   它整块收起来（读数里那一行会直说）。底座那三段的位置是在 1280×720 上量出来的
 *   （见 `_shared.ts` 的 `HUD_TOP_LEFT_BOTTOM`），比它窄的情形没人量过。
 */

import type Phaser from 'phaser'

import type { ArenaContext, ArenaDefinition } from '../../ArenaBase'
import { left, right, top } from '@/domains/procgen/model/rect'
import type { Rect } from '@/domains/procgen/model/types'
import { ROOM_KIND_LABELS } from '@/domains/procgen/model/types'
import { drawClassroomLook } from './_classroomLook'
import { D2_SEEDS, DEFAULT_SEED, HUD_HINT_RIGHT } from './_shared'
import { D2RoomFlowArena, DOOR_MARK_OPEN, DOOR_MARK_SHUT, READOUT_WIDTH } from './d2_room_flow'

/** 这一层几间。**这一场就是为这个数来的**：3 间、全在主干、0 间侧室。 */
const ROOM_COUNT = 3

/**
 * 观感层画在哪一层。**不是 `_classroomLook` 的默认值（−80）** ——
 * 底座那批灰墙在 −50，观感必须压在它们上面。见文件头那张深度表。
 */
const LOOK_DEPTH = -48

/**
 * 小地图那一块的深度。**900**：压得住世界（人物 0 / 门标记 −40 / 父类读数 40），
 * 压不住底座 HUD（1000 / 1001）—— HUD 是所有人共用的读数，场子不许盖它。
 */
const MINIMAP_DEPTH = 900

/**
 * 小地图面板的尺寸。**落点每帧按当场画布算**（与父类读数同一条口径，见
 * `d2_room_flow` 的 `READOUT_WIDTH`），所以这里只有「多大」「离边多远」。
 *
 * | 数 | 怎么来的 |
 * |---|---|
 * | `height` | 标题一行（11px + 上下缝）+ 图一条（48）+ 下内边距 |
 * | `bottom` / `pad` | 与读数栏同一个下边距、同一圈内边距 |
 * | `minWidth` | 再窄就画不出「三间排开」了，整块收起（读数里说一句） |
 * | `maxWidth` | 一层是 ≈6:1 的长条，再宽也只是空着 —— 大画布上居中放，不拉满 |
 */
const MINIMAP = {
  height: 84,
  bottom: 8,
  pad: 8,
  /** 标题那一行占掉的高度：图从那以下开始 */
  titleH: 26,
  /** 图那一条的高度 */
  stripH: 48,
  minWidth: 260,
  maxWidth: 520,
} as const

/**
 * 小地图的底色与房间三态。
 *
 * 「已清」用的是**门那个绿**（`DOOR_MARK_OPEN`）：同一件事（这一间打完了）
 * 在画面里不该有两种颜色 —— 门放行和小地图上的勾是同一个数推出来的。
 */
const MAP_COLORS = {
  panel: 0x050a0e,
  panelEdge: 0x3d4d5e,
  strip: 0x0b1116,
  stripEdge: 0x243240,
  /** 连廊段。同 `_classroomLook` 的 `INK.passageA`（连廊在哪张图上都是那条土黄） */
  passage: 0x463a28,
  room: 0x1c2530,
  roomEdge: 0x5a7183,
  roomCurrent: 0x2f6f8a,
  roomCurrentEdge: 0x8fe3ff,
  roomCleared: 0x1f4a30,
  player: 0xffffff,
} as const

/** 小地图上那几种字色。`Text` 要的是 CSS 色串，不是 `0xRRGGBB`。 */
const MAP_TEXT = {
  title: '#9ad4ff',
  label: '#c8d4e0',
  labelCurrent: '#ffe08a',
  labelCleared: '#9ff0bd',
} as const

/**
 * 画布上一块**左上角对齐**的矩形（x / y 是左上角）。
 *
 * ⚠️ 刻意**不复用** `model/types.ts` 的 `Rect`：那个的 `x` / `y` 是**中心点**
 * （全项目的几何都按中心点走，见那个文件的文件头）。拿它当左上角的盒子用，
 * 「错半个身位」是必然的，而且**看起来像画歪了**，不像用错了类型。
 */
interface PanelBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * 当前看的是第几张牌。**模块级** —— `scene.restart()` 把场子实例销毁重建，
 * 实例字段留不住（`d2_seed_sweep` / `d2_classroom_scene` 同一条）。
 *
 * 起点是 `DEFAULT_SEED`，所以一进这一场看到的就是 `d2_room_flow` 也在用的那一颗种子
 * ——两个场子的画面对得上，读数才可互相印证。
 */
let seedIndex = D2_SEEDS.indexOf(DEFAULT_SEED as (typeof D2_SEEDS)[number])
if (seedIndex < 0) seedIndex = 0

/**
 * 三间教室那一层。**继承 `D2RoomFlowArena`，只盖四个钩子 + 加两样自己的东西**
 * （观感层、小地图）。门 / 清房 / 过门那套逻辑一行没重写，见文件头。
 */
class D2ThreeRoomsArena extends D2RoomFlowArena {
  /** 观感那一整层（`L` 键切它）。见文件头那张深度表 */
  private look: Phaser.GameObjects.Graphics | null = null
  private minimapPanel: Phaser.GameObjects.Rectangle | null = null
  private minimapTitle: Phaser.GameObjects.Text | null = null
  private minimapInk: Phaser.GameObjects.Graphics | null = null
  /** 每间房一条标号。**开局造一次**（三间就是三条），之后每帧只改字与位置 */
  private minimapLabels: Phaser.GameObjects.Text[] = []

  // 这一句每个场子都一样：引用模块底部的常量，而不是把元信息再写一遍 ——
  // 写两份的话，改了菜单里的说明而忘了改这里，HUD 标题就和菜单不一致了。
  protected override get definition(): ArenaDefinition {
    return arena
  }

  /** 这一层按哪颗种子生成。`N` 键翻牌 → 重启 → 这里读到的就是新的那一颗。 */
  protected override get seed(): number {
    return D2_SEEDS[seedIndex] ?? DEFAULT_SEED
  }

  /** 整层生成三间。走 `roomsConfigWithRoomCount`（改原始 JSON、校验器照跑）。 */
  protected override get roomCount(): number {
    return ROOM_COUNT
  }

  protected override onArenaCreate(ctx: ArenaContext): void {
    // 父类把底图、门、压暗层、提示、读数、按键、事件订阅都装好，
    // 并且**已经走了一遍「进房」**（算门 + 刷本房的怪）。这一场只往上面加东西。
    super.onArenaCreate(ctx)
    const L = this.layout
    if (L === null) return

    // 0. 自己的那份「一局的东西」也要清（父类清的是父类那几样，见 `resetRunState`）。
    //    `N` 换种子走的是 `scene.restart()`，而**实例是被复用的** —— 不清的话
    //    下面 `push` 进去的是三条上一局的死 Text，而 `minimapLabels[room.order]`
    //    取的永远是**头三条**（正好是死的那三条），表现是小地图的标号再也不动。
    this.minimapLabels = []

    // 1. 观感层：整层一次画完（树一棵、桌面一张都只画一遍，不是每帧）。
    //    `focus` 不给 —— 三间都要走进去打架，没有哪一间是「背景」。
    this.look = drawClassroomLook(ctx.scene, {
      map: L.map,
      cfg: L.cfg,
      mapper: L.mapper,
      // 整层就是取景范围：与 `configure()` 喂给碰撞、喂给底座的几何**同一个 bounds**。
      box: L.map.bounds,
      walls: L.map.walls,
      depth: LOOK_DEPTH,
    })

    // 2. 小地图。四样东西：底板、标题、画的那一层、每间一条标号。
    //    全部 `setScrollFactor(0)` —— 它是读数，不跟着相机走。
    const scene = ctx.scene
    this.minimapPanel = scene.add
      .rectangle(0, 0, 1, 1, MAP_COLORS.panel, 0.82)
      .setOrigin(0, 0)
      .setStrokeStyle(1, MAP_COLORS.panelEdge, 0.9)
      .setScrollFactor(0)
      .setDepth(MINIMAP_DEPTH)
    this.minimapInk = scene.add.graphics().setScrollFactor(0).setDepth(MINIMAP_DEPTH + 1)
    this.minimapTitle = scene.add
      .text(0, 0, '', { fontFamily: 'monospace', fontSize: '11px', color: MAP_TEXT.title })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(MINIMAP_DEPTH + 2)
    for (const room of L.map.rooms) {
      this.minimapLabels.push(
        scene.add
          .text(0, 0, '', { fontFamily: 'monospace', fontSize: '10px', color: MAP_TEXT.label })
          .setOrigin(0.5, 0.5)
          .setScrollFactor(0)
          .setDepth(MINIMAP_DEPTH + 2),
      )
      // 每条标号挂上它那一间的 `order` —— 每帧认房间用这个，不靠下标顺序
      // （`map.rooms` 保证按 `order` 升序，但「按数组下标认房」这种写法一旦哪天
      // 生成器改了顺序，就会**画错房而不报错**）。
      this.minimapLabels[room.order]?.setData('order', room.order)
    }

    // 3. 这一场自己的两个键。⚠️ 每个键都挡 `ev.repeat` —— 按住不放会按系统重复率
    //    一直发 keydown，`N` 会把六张牌一轮翻完、`L` 会闪成一团（同父类那四个键）。
    const kb = scene.input.keyboard
    kb?.on('keydown-N', (ev: KeyboardEvent) => {
      if (ev.repeat) return
      seedIndex = (seedIndex + 1) % D2_SEEDS.length
      this.scene.restart()
    })
    kb?.on('keydown-L', (ev: KeyboardEvent) => {
      if (ev.repeat) return
      this.toggleLook(ctx)
    })

    // 长度是算过的：底座的提示条是一行不折的 20px 字（`Hud.setNotice`），
    // 这一句约 46 个全角 ≈ 920px / 1280。再加词就会顶出画布。
    ctx.hud.setNotice(
      '三间教室：N 换种子 · L 观感/白箱 · C 模拟清图 · F 过门 —— 门是互动点，门洞走不过去',
    )
  }

  protected override onArenaUpdate(dtMs: number, ctx: ArenaContext): void {
    super.onArenaUpdate(dtMs, ctx)
    // 小地图每帧重画。**必须放在父类之后**：它读的 `currentOrder` / `clearedRooms` /
    // `shut[]` 都是父类这一帧刚算完的，先画就会慢一帧（门刚变绿、地图上还是红的）。
    this.drawMinimap(ctx)
  }

  /**
   * 最后一行：这一场认的键。
   *
   * ⚠️ **`N` / `L` / `V` 不在这一行**，它们在 `extraReadoutLines()` 的第 3 行 ——
   * 六个键塞进一行是 23 个全角，超出读数栏的预算（见 `READOUT_WIDTH` 那条 ⚠️）。
   * 拆成「玩法键（这一行，父类原来那四个）」+「这一场自己的键（上一行）」两行，
   * 每个键都印得下，也不用缩写成看不懂的样子。
   */
  protected override keyHints(): string {
    return 'F 过门 · C 清图 · Q 收起'
  }

  /**
   * 三行：这一场的两个开关 / 本房的家底 / 这一场自己的键。
   *
   * 第 2 行是**给「障碍物也是种子随机出来的」这句话配的读数**：同一颗种子里
   * 桌椅几张、刷怪点几个，换个种子跟着变（按 `N` 前后对比一眼看得出来）。
   * 它和画面上画出来的桌椅是**同一个来源**（`room.obstacles` / `room.spawnPoints`）。
   */
  protected override extraReadoutLines(): string[] {
    const L = this.layout
    if (L === null) return []
    const room = L.map.rooms[this.currentOrder]!
    const desks = room.obstacles.filter((o) => o.kind === 'desk').length
    const chairs = room.obstacles.length - desks
    // 「没画」只在画布太窄时出现（见 `minimapBox`）—— 不说的话，那看起来像「小地图坏了」。
    const mapState = this.minimapPanel?.visible === true ? '开' : '关（画布太窄）'
    // 站在**没有向前的门**的那一间时多印一行。
    //
    // 判据是「本房有没有一扇通向号更大的房间的门」——**不是**「是不是最后一间」：
    // 后者要在这一场里假定房间怎么排，而那正是生成器的事。
    //
    // 为什么非说一句不可：走到 `#2` 之后读数会变成 `门 本房可过 0/1 · 全层 0/4`
    // （「不回头」把身后的门全封上，见 `doorShouldBeClosed`）——**看起来像门坏了**。
    // 而在这一场里，查门永远查不出东西：那是**走到头了**。这一行就是把
    // 「本房可过 0」和「门的状态机坏了」分开的那句话。
    //
    // `L.barriers` 里 `toOrder === null` 的那些是墙外，不算出口（同父类 `nearestPassableDoor`）。
    const exits = L.barriers
      .filter((b) => b.ownerOrder === room.order && b.toOrder !== null)
      .map((b) => `#${b.toOrder}`)
    const forward = L.barriers.some(
      (b) => b.ownerOrder === room.order && b.toOrder !== null && b.toOrder > room.order,
    )
    return [
      `观感 ${this.look?.visible === true ? '开' : '关（白箱）'} · 小地图 ${mapState}`,
      `本房 桌椅 ${desks}+${chairs} · 刷怪点 ${room.spawnPoints.length}`,
      'N 换种子 · L 白箱 · V 重刷',
      ...(forward ? [] : [`走到头了：本房的门只通 ${exits.join(' / ') || '墙外'}`]),
    ]
  }

  /** `L`：把观感那一层收起来，底下的白箱（底图 + 灰墙 + 门标记）就露出来了。 */
  private toggleLook(ctx: ArenaContext): void {
    const look = this.look
    if (look === null) return
    look.setVisible(!look.visible)
    ctx.hud.setNotice(
      look.visible
        ? '观感 开：地砖 / 课桌椅 / 黑板 / 门框 / 盆栽 —— 黑板窗盆栽是画上去的装饰，不在数据里'
        : '观感 关：白箱 —— 底图（门上的 →N 与连廊名回来了）+ 底座灰墙 + 门标记',
    )
  }

  // ------------------------------------------------------------ 小地图

  /**
   * 小地图摆在哪：**左下「按键说明」与右下「读数栏」之间那一条**，贴着画布下沿。
   *
   * 左右两个边界都是**别人的东西**，所以两边都得让开：
   *
   * | 让谁 | 让多少 | 依据 |
   * |---|---|---|
   * | 左下按键说明 | 左边界 `HUD_HINT_RIGHT + 8` | 那一段是**量出来的**（见 `_shared.ts`） |
   * | 右下读数 | 右边界 `画布宽 − READOUT_WIDTH − 16` | 读数每帧按当场画布摆（父类） |
   *
   * 为什么不是左上角 / 右上角：教室（一间一屏）在 1280×720 上落在 `y 124..595`，
   * 上下两条边带正好是墙与门标记在的地方 —— 小地图摆上去会压住**北墙那扇门**。
   * 下边沿那条带子是**空的**：它在教室之外（连墙体都够不着），摆在那儿不遮任何东西。
   *
   * `null` = 放不下。**整块收起，不留半块** —— 半块看起来像画坏了。
   */
  private minimapBox(ctx: ArenaContext): PanelBox | null {
    const x = HUD_HINT_RIGHT + 8
    const gap = ctx.scene.scale.width - READOUT_WIDTH - 16 - x
    if (gap < MINIMAP.minWidth) return null
    // 大画布上不拉满：一层是 ≈6:1 的长条，再宽也只是空着。居中所让开的这块里。
    const width = Math.min(gap, MINIMAP.maxWidth)
    return {
      x: x + (gap - width) / 2,
      y: ctx.scene.scale.height - MINIMAP.bottom - MINIMAP.height,
      width,
      height: MINIMAP.height,
    }
  }

  /**
   * 画小地图。**每帧重画**（玩家在动、门在开关、房间在变清）。
   *
   * 画的东西，从下往上：
   *
   * | 画 | 读的是 |
   * |---|---|
   * | 连廊那几段 | `map.passages`（读 `between` 只是为了让段落在两间之间，位置本来就在） |
   * | 三间房（底色 + 描边） | `currentOrder` / `clearedRooms` —— 父类每帧算好的那两个 |
   * | 每间一条标号（`#N 关别 ✓`） | `room.order` / `room.kind` / `ROOM_KIND_LABELS` |
   * | 门上的红绿刻度 | `layout.barriers` + 这一场自己的 `shut[]` |
   * | 玩家那个白点 | `playerMap(ctx)`（父类给的「世界 → 地图」那把尺子） |
   *
   * 颜色和世界里的门标记**同源**（`DOOR_MARK_SHUT` / `DOOR_MARK_OPEN`）：
   * 同一扇门在同一帧里，小地图上红着而门上是绿的，就是这一场最不该出现的误读。
   */
  private drawMinimap(ctx: ArenaContext): void {
    const L = this.layout
    const panel = this.minimapPanel
    const title = this.minimapTitle
    const ink = this.minimapInk
    if (L === null || panel === null || title === null || ink === null) return

    const box = this.minimapBox(ctx)
    const show = box !== null
    panel.setVisible(show)
    title.setVisible(show)
    ink.setVisible(show)
    for (const t of this.minimapLabels) t.setVisible(show)
    if (box === null) return

    panel.setPosition(box.x, box.y).setSize(box.width, box.height)
    title.setPosition(box.x + MINIMAP.pad, box.y + 5).setText(this.minimapTitleText(box.width))

    // 图那一条。标题占掉上面，下面留一圈内边距。
    const strip: PanelBox = {
      x: box.x + MINIMAP.pad,
      y: box.y + MINIMAP.titleH,
      width: box.width - MINIMAP.pad * 2,
      height: MINIMAP.stripH,
    }

    // ⚠️ 逐轴两个比例 —— 这是**示意图**的代价与红利，见文件头。
    // 别把它和 `L.mapper`（地图 → 世界）混起来：那个全场一份，这个只活在这张图里。
    const bounds = L.map.bounds
    const sx = strip.width / bounds.width
    const sy = strip.height / bounds.height
    const px = (wx: number): number => strip.x + (wx - left(bounds)) * sx
    const py = (wy: number): number => strip.y + (wy - top(bounds)) * sy
    /** 地图坐标的一块 → 条上的一块。长宽都夹到 ≥1（贴边的房会把某边压成 0） */
    const shapeOf = (r: Rect): { x: number; y: number; w: number; h: number } => ({
      x: px(left(r)),
      y: py(top(r)),
      w: Math.max(1, r.width * sx),
      h: Math.max(1, r.height * sy),
    })

    ink.clear()
    ink.fillStyle(MAP_COLORS.strip, 1)
    ink.fillRect(strip.x, strip.y, strip.width, strip.height)
    ink.lineStyle(1, MAP_COLORS.stripEdge, 1)
    ink.strokeRect(strip.x, strip.y, strip.width, strip.height)

    // 连廊段：**画成一条细的**，不是与房间同高 —— 同高就成了一间窄房，
    // 而「这一条是路、不是房」正是玩家要一眼分出来的事。
    const corridorH = Math.max(2, strip.height * 0.18)
    for (const p of L.map.passages) {
      const x0 = px(left(p.rect))
      const x1 = px(right(p.rect))
      const cy = py(p.rect.y) // `Rect.y` 是**中心**
      ink.fillStyle(MAP_COLORS.passage, 1)
      ink.fillRect(x0, cy - corridorH / 2, Math.max(1, x1 - x0), corridorH)
    }

    // 三间房。**颜色只有三种状态**：当前（亮蓝 + 粗边）/ 已清（绿）/ 还没打（灰）。
    for (const room of L.map.rooms) {
      const r = shapeOf(room.rect)
      const isCurrent = room.order === this.currentOrder
      const cleared = this.clearedRooms.has(room.order)
      const fill = isCurrent ? MAP_COLORS.roomCurrent : cleared ? MAP_COLORS.roomCleared : MAP_COLORS.room
      const edge = isCurrent
        ? MAP_COLORS.roomCurrentEdge
        : cleared
          ? DOOR_MARK_OPEN
          : MAP_COLORS.roomEdge
      ink.fillStyle(fill, 0.9)
      ink.fillRect(r.x, r.y, r.w, r.h)
      ink.lineStyle(isCurrent ? 2 : 1, edge, 1)
      ink.strokeRect(r.x, r.y, r.w, r.h)
    }

    // 门：**一个洞口一道刻度**，横竖跟着墙走（竖墙上一条竖的）。
    // `toOrder === null` 的那些跳过 —— 那是尽头（墙外），没有「通向哪一间」可言，
    // 父类的可过判定也把它们整个跳过（`nearestPassableDoor`）。两处口径要一致。
    L.barriers.forEach((b, i) => {
      if (b.toOrder === null) return
      const shut = this.shut[i] !== false
      const cx = px(b.rect.x)
      const cy = py(b.rect.y)
      const long = Math.max(4, Math.min(14, strip.height * 0.34))
      ink.fillStyle(shut ? DOOR_MARK_SHUT : DOOR_MARK_OPEN, 1)
      if (b.axis === 'v') ink.fillRect(cx - 1.5, cy - long / 2, 3, long)
      else ink.fillRect(cx - long / 2, cy - 1.5, long, 3)
    })

    // 每间一条标号。宽到放得下才写关别；放不下就只写号（写字比房宽还难看）。
    for (const room of L.map.rooms) {
      const t = this.minimapLabels[room.order]
      if (t === undefined) continue
      const r = shapeOf(room.rect)
      const cleared = this.clearedRooms.has(room.order)
      const wide = r.w >= 44
      t.setText(
        wide
          ? `#${room.order} ${ROOM_KIND_LABELS[room.kind]}${cleared ? ' ✓' : ''}`
          : `#${room.order}${cleared ? '✓' : ''}`,
      )
        .setPosition(r.x + r.w / 2, r.y + r.h / 2)
        .setColor(
          room.order === this.currentOrder
            ? MAP_TEXT.labelCurrent
            : cleared
              ? MAP_TEXT.labelCleared
              : MAP_TEXT.label,
        )
    }

    // 玩家那个白点。**不用夹**：玩家进不了连廊（门洞走不过去），
    // 于是 `playerMap()` 永远落在某一间房里 —— 落进条外只可能是父类那把尺子坏了。
    const p = this.playerMap(ctx)
    const dotX = px(p.x)
    const dotY = py(p.y)
    ink.fillStyle(MAP_COLORS.player, 1)
    ink.fillCircle(dotX, dotY, 2.5)
    ink.lineStyle(1, 0x000000, 0.8)
    ink.strokeCircle(dotX, dotY, 2.5)
  }

  /**
   * 小地图的标题：**这一层是哪颗种子、第几张牌**。
   *
   * 为什么不写「小地图」三个字就完了：`N` 换种子之后，`#0` 房宽了还是窄了
   * （400 / 520 / 640 三个档位）得对着种子的号才读得成一句有用的话。
   * 「牌 4/6」是**这一场自己那份牌**（`D2_SEEDS`）里的位置，和菜单外的人怎么按 `N` 有关。
   *
   * 宽的那一版多带一行图例（颜色与符号的意思）。**窄画布上只留短的那版** ——
   * 长版约 26 个全角，面板窄于 320px 时会画出面板外面去。
   */
  private minimapTitleText(width: number): string {
    const short = `小地图 · 牌 ${seedIndex + 1}/${D2_SEEDS.length} · 种子 ${D2_SEEDS[seedIndex] ?? DEFAULT_SEED}`
    return width >= 320 ? `${short} · 亮=当前 ✓=已清 门红=封` : short
  }
}

/**
 * 目录读的就是这个（`registry.ts` 用 `import.meta.glob` 自动收，文件名就是 `?arena=` 的值）。
 * **类本身不要 export** —— 见 `_ArenaTemplate.ts`：目录只认这个常量。
 * （`d2_room_flow` 那个类 export 是为了**被这里继承**，不是给目录看的。）
 */
export const arena: ArenaDefinition = {
  displayName: 'D2 三间教室（转接 + 小地图）',
  description:
    '一层只有三间：门是互动点 · 进房封门 / 清完放行 / F 过门。共一张小地图（当前 / 已清 / 门封）。N 换种子、L 观感↔白箱、C 模拟清图',
  scene: D2ThreeRoomsArena,
}