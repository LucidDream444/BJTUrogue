/**
 * 「要看哪一块」—— 取景与裁剪。**纯函数，零 Phaser 依赖。**
 *
 * ---
 *
 * ## 为什么不和 `floorplan.ts` 放一起
 *
 * 因为它们回答的是两个问题：`floorplan.ts` 回答「**怎么画**」，
 * 这里回答「**画哪一块**」。把它们混在一起，后果是具体的：
 *
 * `presentation/floorplan.ts` 是整个 `procgen/` 里唯一 import Phaser 的文件 ——
 * 那是**拿 Phaser 换绘制便利**，代价是大方承认的。但「画哪一块」是纯几何，
 * 任何测试、任何别的场子都可能要问它。混在一起，那些人就得**为了问一个纯几何问题
 * 把 Phaser 拉进依赖闭包**，而 `architecture.test.ts` 会当场红
 * （Vitest 的环境钉死在 `node` 上，见 `AGENTS.md` §七）。
 *
 * 所以：**判定与几何在这里，绘制在那一边。** 分界线就是 `import Phaser`
 * 这一个词出现在哪个文件里。
 */

import type { RoomsConfig } from '../config'
import { collidersOf } from '../colliders'
import {
  bottom,
  clipRect,
  containsPoint,
  left,
  rectContains,
  rectFromCorners,
  rectsIntersect,
  right,
  top,
} from '../model/rect'
import type { DoorKind, DungeonMap, Point, Rect, Room } from '../model/types'

/**
 * 房间矩形 + 四周各留一格（`navCellSize`）。**`roomViewBox` 的起点，不是玩家的那一屏。**
 *
 * ⚠️ 名字避开 `screen` / `fit` 是**有意的**：玩家的那一屏是 `roomFitSize`
 * （教室本体 + 一圈墙），而这里多留的是**一整格**。两者不是一个框 ——
 * 拿这一个当缩放口径，一屏会比 `roomFitSize` 宽 40、松一圈（`1280/760 = 1.68`
 * 退成 `1280/800 = 1.6`），房间里就多出一圈本不该有的空地。
 *
 * 这一格是给**墙**的：墙骑在房间边界上（厚一格、内外各半），只框本体的话
 * 左右两条墙整条落在框外 —— 而门就开在那两条墙上，看到的就是一个
 * **既没有墙也没有门**的房间。它顺带也是门标注的落点：`doorLabels` 离门心
 * 出 `LABEL_OUT` = 30，正好落在这一格里。
 */
function roomWithCell(cfg: RoomsConfig, room: Room): Rect {
  const cell = cfg.navCellSize
  return rectFromCorners(
    left(room.rect) - cell,
    top(room.rect) - cell,
    right(room.rect) + cell,
    bottom(room.rect) + cell,
  )
}

/**
 * 取景框：**这一间房 + 它每一扇门外的那一块**。
 *
 * ⚠️ **这一个不是玩家的那一屏**（那是 `roomFitSize`）。它给的是「要画哪一块」：
 * 缩略图与 1:1 特写靠它把「门外确实有地方可去」画出来。
 *
 * ## 为什么不是「对称留白」
 *
 * `inflate(room.rect, 一格)` 会把画面的大半花在**这一间房背后**，
 * 而门外那条路一格都看不见 —— 可「这扇门外确实有地方可去」正是这个场子
 * 最要看的一条。所以框要**朝门外长出去**。
 *
 * ## 门外是哪儿，靠**探针**算，不靠类型猜
 *
 * 门外那块东西是个变量：主干教室的 `back`/`forward` 门外面是**一段连廊**，
 * 侧室那两扇门外面是**宿主教室**和**连廊**，而主干的 `side` 门外面是**侧室**。
 * 按 `DoorKind` 或按 `branch` 分支去猜，就要写四套规则，而每套都要和
 * `layout.ts` 的摆位保持同步 —— 那边一改，这边**不报错**，只是框错了一格。
 *
 * 所以这里只做一件事：**从门心朝门外面走半格，看落进哪个矩形里。**
 * 半格够了 —— 所有相邻空间都是**贴边**的（连廊的西边就是教室的东边，
 * 侧室朝主干那一面就在带的那条线上），而墙骑在那条线上、厚一格，
 * 走半格正好越过它落到对面那块的内部。
 *
 * | 门 | 门心 | 门外半格处 | 落进 |
 * |---|---|---|---|
 * | 主干 `back` | `(左边界, +20)` | `(左边界 − 20, +20)` | 西边那段连廊（起点没有，落空 → 不并） |
 * | 主干 `forward` | `(右边界, +20)` | `(右边界 + 20, +20)` | 东边那段连廊 |
 * | 主干的 `side` | `(…, ±带边)` | `(…, ±带边 ∓ 20)` | 挂在它上面的侧室 |
 * | 侧室的两扇 | `(…, ±带边)` | `(…, ±带边 ∓ 20)` | 宿主教室 / 连廊 |
 *
 * 落空是**正常**的（起点西边、首领东边都是整层的外沿），不并就是了。
 *
 * ## 并进来的那块，四面再各留一格
 *
 * 留的那一格是给**墙**的：框边恰好压在墙上时，墙只剩半个身子，
 * 看起来像「这儿有一条奇怪的横线」。留一格之后墙整条落在框里。
 *
 * 框最大 `1120×680`（最大档主干 640 + 两侧连廊 400 + 两格留白 80 = 1120，
 * 高 280 + 侧室 320 + 两格留白 80 = 680），进得了 1280×720。
 * 这串加法**写全**：之前这里写的是 1080，正是把 640+400+80 心算错了 40 ——
 * 而框的上限是个会被 `chooseClassroom` 拿去过滤的数，错 40 就是**悄悄少一间候选**。
 */
export function roomViewBox(map: DungeonMap, cfg: RoomsConfig, room: Room): Rect {
  const cell = cfg.navCellSize
  // 起点是「房间 + 一格」（`roomWithCell`）—— 缩略图与 1:1 特写都从这里长出去，
  // 各写一遍就是同一件事有两个真值来源；分岔的表现是「画出来的那一块比框少一格」，
  // 看不出来是差在哪。
  const own = roomWithCell(cfg, room)
  let x0 = left(own)
  let x1 = right(own)
  let y0 = top(own)
  let y1 = bottom(own)

  for (const beyond of spacesBeyondDoors(map, room, cell)) {
    x0 = Math.min(x0, left(beyond) - cell)
    x1 = Math.max(x1, right(beyond) + cell)
    y0 = Math.min(y0, top(beyond) - cell)
    y1 = Math.max(y1, bottom(beyond) + cell)
  }

  return rectFromCorners(x0, y0, x1, y1)
}

/**
 * 每一扇门外面的那**一块空间**（连廊或别的房间）。同一块被两扇门撞上时只返回一次。
 *
 * 排除房间自己：探针落在自己身上说明方向算反了，那种情况下并进来的是本房，
 * 框会缩成原样 —— 而「框比预期的窄」在现场看起来和「门外没东西」一模一样。
 */
function spacesBeyondDoors(map: DungeonMap, room: Room, depth: number): Rect[] {
  const out: Rect[] = []
  const push = (r: Rect): void => {
    // 落回本房自己 = 方向算反了。并进来的是本房，框会缩成「对称留白」那副样子，
    // 而**框比预期窄**在现场看起来和「门外没东西」一模一样，没人会去查方向。
    if (rectContains(r, room.rect)) return
    if (!out.includes(r)) out.push(r)
  }

  for (const d of room.doors) {
    // 门的法线方向：竖直墙上开的那扇沿 ±x 出入，水平墙上那扇沿 ±y。
    // 朝哪边是**门心在本房轴线的哪一侧**定的，不是按 kind 定的（见上）。
    let px = d.x
    let py = d.y
    if (d.axis === 'v') px += d.x < room.rect.x ? -depth : depth
    else py += d.y < room.rect.y ? -depth : depth

    for (const p of map.passages) if (containsPoint(p.rect, px, py)) push(p.rect)
    for (const other of map.rooms) {
      if (other === room) continue
      if (containsPoint(other.rect, px, py)) push(other.rect)
    }
  }
  return out
}

/**
 * 整块都在取景框里 —— 没被切到。
 *
 * 判定的是「能不能替它下结论」，不是「要不要画」：填充可以裁着画，
 * 但**描边、标签、门、刷怪点**一旦被取景框切掉一半，剩下那一半就是在说谎
 * （沿框边的那两条线会被读成一堵墙，门会被读成一扇半截的门）。
 *
 * 放在 `framing.ts` 而不是 `floorplan.ts`：场子也要问同一个问题
 * （「这一段连廊要不要贴名字」），而 `floorplan.ts` 一进依赖闭包就把 Phaser
 * 带进去了。
 */
export function fullyInside(r: Rect, box: Rect): boolean {
  return (
    left(r) >= left(box) &&
    right(r) <= right(box) &&
    top(r) >= top(box) &&
    bottom(r) <= bottom(box)
  )
}

/**
 * 框里的那几段墙。**裁过**（见 `clipRect`）。
 *
 * 整层的墙是连续的：走廊的边墙、侧室门厅的封口都是一整条。
 * 不裁的话一间房会连带画出半层楼 —— 而画出来的那些墙**在框外面**，
 * 看起来就是「墙上多出来一段莫名其妙的东西」，比不画更糟。
 */
export function wallsNearRoom(map: DungeonMap, box: Rect): Rect[] {
  const out: Rect[] = []
  for (const w of map.walls) {
    if (!rectsIntersect(w, box)) continue
    const c = clipRect(w, box)
    if (c !== null) out.push(c)
  }
  return out
}

/**
 * 一块取景框的**尺寸**（世界单位）。**不是坐标，也不是某一间房的框** ——
 * 见 `largestViewSize`。
 */
export interface ViewSize {
  readonly width: number
  readonly height: number
}

/**
 * 全层每一间房的取景框里，**最宽的那个宽、最高的那个高**。
 *
 * ## ⚠️ 逐维取最大，**不是**把框并起来
 *
 * 并集看着更自然（「全层要装下的那一块」），但它量的是**跨度**：
 * 一排教室横着排开，并集就是从第一间到最后一间的那个大长条 ——
 * 实测种子 837 是 `7560×880`，拿它算 zoom 得 `0.169`，
 * 也就是**整层一屏**、每间教室缩成一个小方块，而这个函数的名字还叫
 * 「一间房一屏」。逐维取最大得到 `1120×640`，那才对。
 *
 * 数学上也是一回事：zoom 要装下**每一间**，
 * `min_i min(vw/w_i, vh/h_i) = min(vw / max_i w_i, vh / max_i h_i)` ——
 * 最宽的和最高的可以来自不同的房，那没关系，取的是同一个 min。
 *
 * ## 为什么逐间算再取最大，不手算
 *
 * 手算式是「最大档位的宽 + 两段连廊 + 两格留白」，而它有三种分岔：
 * 侧室挂在哪一间、哪几间有侧门、某一段连廊是不是整层的外沿（外沿那一侧没有连廊）。
 * 三处都**不报错**，只是框小了一点 —— 上面 `roomViewBox` 的注释里已经记着一次
 * 心算错 40 的账（640+400+80 算成 1080），而那次错的直接后果是
 * `chooseClassroom` 悄悄少了一间候选。从真地图上量出来的没有这个自由。
 *
 * ⚠️ 「装下**取景框**」和「装下**教室本体**」是两件事，后者见 `roomFitSize`：
 * 拿这个函数的数去定整层场子的缩放，会把教室挤成屏高的 44%（用户报过的那一屏）。
 */
export function largestViewSize(map: DungeonMap, cfg: RoomsConfig): ViewSize {
  let width = 0
  let height = 0
  for (const room of map.rooms) {
    const b = roomViewBox(map, cfg, room)
    width = Math.max(width, right(b) - left(b))
    height = Math.max(height, bottom(b) - top(b))
  }
  // 一间房都没有的地图不该走到这里；真走到了也不许悄悄返回 0（那会让 zoom 变成 Infinity）
  if (width <= 0 || height <= 0) throw new Error('largestViewSize：地图上一间房都没有')
  return { width, height }
}

/**
 * 「**教室占满屏幕**」要装下的那一块：全层最大的那间教室**本体** + 一圈留白。
 *
 * ## 为什么不是 `largestViewSize`（那两个函数长得很像，装的不是一回事）
 *
 * | | 装的是 | 用在哪 |
 * |---|---|---|
 * | `largestViewSize` | 取景框：教室 **+ 门外并进来的侧室与连廊** | 1:1 特写场子（`d2_classroom`）—— 它要连门外那截一起看见 |
 * | `roomFitSize` | 教室**本体** + 一圈留白 | 一间房一屏的整层场子（`d2_room_flow`） |
 *
 * 用前者去定后者的缩放，**教室会被门外并进来的那些块挤小**：种子 837 的取景框
 * 最宽 1120（最大档主干 640 + 两侧连廊 400 + 两格留白 80），拿它算出来的缩放是
 * `720/640 = 1.125`，而那一间教室本体只有 640×280 —— **占屏宽 56%、屏高 44%**，
 * 上下左右一大圈是门外的东西。用户看到之后的第一句反馈就是这句：
 * 「教室应该是占满屏幕的」。换成教室本体（640×280 + 两圈 60）之后是 `1.68`，
 * 占屏宽 84%、屏高 65%（宽贴满、高按房间的长宽比留白）。
 *
 * ## 一圈留白留多少：**墙的整条 + 半格门外**
 *
 * `wallThickness` 是让墙整条落在屏幕里（框边正好压在墙上时，墙只剩半个身子，
 * 看起来像一条奇怪的横线 —— 与 `roomViewBox` 里「四面再各留一格」同一个理由）；
 * 半格 `navCellSize` 是让门和门外那一点点地面露出来，读得出「门外面有路」。
 * **两个数都从配置来**，不写死像素（红线 2）。
 *
 * ## 逐维取最大，**不是**把房间并起来
 *
 * 口径与 `largestViewSize` 逐字相同（见那里的数学）：最宽的取全层最宽、
 * 最高的取全层最高，两者可以来自不同的房。并起来量的是**跨度**，
 * 一排教室横着排开会得到一个几千宽的长条 —— 那算出来的是「整层一屏」，
 * 每间教室缩成一个小方块，和这个函数的名字正好相反。
 */
export function roomFitSize(map: DungeonMap, cfg: RoomsConfig): ViewSize {
  let width = 0
  let height = 0
  for (const room of map.rooms) {
    width = Math.max(width, room.rect.width)
    height = Math.max(height, room.rect.height)
  }
  if (width <= 0 || height <= 0) throw new Error('roomFitSize：地图上一间房都没有')
  const margin = cfg.wallThickness + cfg.navCellSize / 2
  return { width: width + margin * 2, height: height + margin * 2 }
}

/**
 * 「一间房一屏」的相机 zoom：**让这块尺寸正好装下**。
 *
 * ## 为什么取 min 而不是 max
 *
 * 取 max 是「装不下也算装下了」：宽装得下、高装不下时框的上下会被切掉，
 * 而切掉的那两条边上是**墙和门** —— 玩家看到的是「房间好像没有北墙」。
 * 取 min 的代价只是四周多一点留白。
 *
 * ## 为什么 zoom 全层算一个，不每间算一个
 *
 * 每间房各算一个，过门时相机要同时平移和缩放 —— 两种运动叠在一起，
 * 「转接」这件事在画面上反而糊了；而且相邻两间房尺寸相同时会算出两个
 * 浮点不同的 zoom，相机每过一道门抖一下。**档位是有限的，取最大的那一档**，
 * 于是每一间都装得下，且全层只有一次缩放（开场那一次）。
 *
 * ## 为什么要传视口，而不是写死一个数
 *
 * 写死的 zoom 只在作者的那块屏幕上是对的。1280×720 上刚好，
 * 换到 1920×1080 就是「四周一大圈空地」，换到窗口的半屏就是「房间被切掉一圈」。
 * 视口是浏览器给的（`scene.scale`），本来就是个变量。
 */
export function zoomFor(size: ViewSize, viewportWidth: number, viewportHeight: number): number {
  if (!(viewportWidth > 0) || !(viewportHeight > 0)) {
    throw new Error(`zoomFor：视口尺寸不合法（${viewportWidth}×${viewportHeight}）`)
  }
  if (!(size.width > 0) || !(size.height > 0)) {
    throw new Error(`zoomFor：取景尺寸不合法（${size.width}×${size.height}）`)
  }
  return Math.min(viewportWidth / size.width, viewportHeight / size.height)
}

// ---------------------------------------------------------------- 标注

/**
 * 「这扇门通向哪一间」的一条标注。
 *
 * 数据只多出两样：`text`（印什么）与 `at`（印在哪）。**落点也是推导出来的**，
 * 见 `doorLabels` 里的「为什么落点不交给调用方算」。
 */
export interface DoorLabel {
  /** 门洞开在第几间的墙上 */
  readonly ownerOrder: number
  /** 穿过去到哪一间。`null` = 墙外 */
  readonly toOrder: number | null
  readonly kind: DoorKind
  /** 门洞那块矩形。**与门挡板是同一块**（同一份去重口径，见下） */
  readonly rect: Rect
  readonly axis: 'h' | 'v'
  /**
   * 印什么。例 `→5` / `→✕`（墙外）。
   *
   * ⚠️ 今天的生成器**一扇 `toOrder = null` 的门都不出**（三个种子实测 0 条）——
   * `→✕` 这条分支是照类型给的，用 `labels.test.ts` 里一份手造地图钉住。
   * 想找一扇墙外的门来看效果，别去扫种子，扫不到。
   */
  readonly text: string
  /** 印在哪（世界坐标） */
  readonly at: Point
}

/** 「这段连廊连着哪两间」的一条标注。`between` 是数据里就有的升序两间。 */
export interface PassageLabel {
  readonly between: readonly [number, number]
  readonly rect: Rect
  readonly text: string
  readonly at: Point
}

/** 门 / 连廊标注的落点离墙多远（世界单位）。半个墙厚 + 一点余量，正好不压墙线。 */
const LABEL_OUT = 30
/** 沿墙方向再让开多远 —— 让开那个洞本身，不然字压在两扇门的亮线上。 */
const LABEL_SIDE = 20

/**
 * 「每一扇门通向哪一间」—— **缩略图与 1:1 共用这一份**。
 *
 * ## 为什么派生自 `collidersOf().barriers`
 *
 * 因为「一个洞口只出一条标注」这条去重口径**已经在那里了**，而且是同一条：
 * 侧室与宿主之间那一个洞在两边各记了一条互为正反的 `Door`（`toOrder` 有方向），
 * 照着 `room.doors` 逐条出标注就会在同一个地方叠两条 —— 一条写 `→4`、
 * 一条写 `→3`，两条都"对"，合起来是一团谁也读不出来的字。
 *
 * 在别处再写一遍去重（`axis + 位置 + 宽度`）就是造第二份会漂的事实。
 *
 * ## 为什么落点不交给调用方算
 *
 * 落点看着是「画的事」，其实是**推导的一部分**，而且有一个必须回答的问题：
 * 两扇门隔着一段连廊面对面时（A 的 forward 与 B 的 back，相距正好一个 `roomGap`），
 * 它们的标注往哪边挪才不会叠在一起。
 *
 * 答案是**两个偏移同号**：门外方向取 `out2`，沿墙方向也让 `out2` 那么多。
 * 隔着连廊的两扇门，两个洞的宿主分别在门的两侧，`out2` 必然一正一负，
 * 于是两条标注必然一个往上让、一个往下让 —— **不会撞，且不是碰巧**。
 * 交给调用方的话，每个调用方都要自己想一遍这个规则，
 * 而「想漏了」在现场看起来就是一团糊字，不是「标注少了」。
 *
 * ## 落点怎么算
 *
 * 门洞矩形的中心 → 沿**门外**法线出 `LABEL_OUT` → 沿墙方向再让 `LABEL_SIDE`。
 * 「门外」= 背离**宿主**（`ownerOrder` 那一间）中心的那一侧；这个方向和
 * 清房判据无关，纯粹是几何。`toOrder` 只决定**印什么字**，不决定落在哪 ——
 * 一扇堵死的门（`toOrder = null`）旁边照样该有个 `→✕`。
 */
export function doorLabels(map: DungeonMap, cfg: RoomsConfig): DoorLabel[] {
  const centerOf = new Map<number, Point>()
  for (const r of map.rooms) centerOf.set(r.order, { x: r.rect.x, y: r.rect.y })

  const out: DoorLabel[] = []
  for (const b of collidersOf(map, cfg).barriers) {
    const owner = centerOf.get(b.ownerOrder)
    // 挡板的 ownerOrder 一定指向地图上真有的那一间（`collidersOf` 是从 `map.rooms` 造的）。
    // 真拿不到就跳过：编一个落点出来比少一条标注更难查。
    if (owner === undefined) continue

    const r = b.rect
    // 法线：竖直墙上的门沿 ±x 出入，水平墙上的沿 ±y；朝哪边由**宿主在门心的哪一侧**定。
    const out2 = b.axis === 'v' ? (r.x < owner.x ? -1 : 1) : r.y < owner.y ? -1 : 1
    // 沿墙方向用**同一个符号**。
    //
    // 看着像偷懒，其实是这条式子唯一能自动满足下面两件事的写法 ——
    // 而这两件事写成「按目的地方位分上下」那种说法就会各错一半：
    //
    // 1. **同一堵墙线上相邻的两个洞**（宿主出口 + 侧室出口，像 `#10` 那两扇）
    //    沿墙正好朝**相反**方向让开 —— 因为两个洞的宿主分别在墙的两侧，
    //    `out2` 必然一正一负。
    // 2. **隔着连廊面对面的两扇门**（A 的 forward 与 B 的 back）同理，
    //    一个往上让、一个往下让。
    const along = out2

    out.push({
      ownerOrder: b.ownerOrder,
      toOrder: b.toOrder,
      kind: b.kind,
      rect: r,
      axis: b.axis,
      text: b.toOrder === null ? '→✕' : `→${b.toOrder}`,
      at:
        b.axis === 'v'
          ? { x: r.x + out2 * LABEL_OUT, y: r.y + along * LABEL_SIDE }
          : { x: r.x + along * LABEL_SIDE, y: r.y + out2 * LABEL_OUT },
    })
  }
  return out
}

/**
 * 「每一段连廊连着哪两间」—— 数据就是 `Passage.between`，一个字都不推。
 *
 * **两个尺度都要标**：今天只有 1:1 特写标了 `连廊 3→5`，于是整层缩略图上一段连廊
 * 只是一块比底色亮一点的深色 —— 而「那条浅色带是哪两间之间的路」正是缩略图
 * 唯一能回答、单间教室里根本看不见的问题。
 *
 * 落点取连廊**靠外沿那一头**（沿连廊长轴偏向两端中的一端），不是正中心：
 * 正中心往往压着 1:1 那一场画不下的东西不多，但在缩略图上正好是那段带子的正中，
 * 而带子两端各有一个门洞的亮线要读。
 *
 * ## ⚠️ 这道落点会和「连廊下墙上门洞的标注」撞个正着 —— 但**不许**把它挪到正中心
 *
 * 竖着的连廊（`height >= width`，绝大多数都是）落点在 `bottom - navCellSize*0.7`，
 * 也就是贴着下沿往里去 28px；而挂在连廊**正下方**的侧室，它的门洞就在连廊中线，
 * 门标注 = 洞心 + 法线 30 + 沿墙 20 = 「连廊中线，下沿往里去 30」。
 * 种子 837 实测（世界坐标，`d2_classroom`）：门标注 `→11` 在 `(5440, 110)`、
 * 连廊名在 `(5440, 112)` —— **差 2px**，按 `cullLabels`（两轴都近才算撞）必然撞。
 *
 * 2026-10-15 试过把落点改到连廊**正中心**，撞是不撞了，但**缩略图明显变差**：
 * 正中心正是连廊两端那两个门标注（`→N`，也就是「这条带子通到哪一间」，
 * 用户报的正是这一条）要去的地方，实测 `d2_floorplan` 的筛掉数从 **14 条涨到 23 条**。
 * 回到原落点。
 *
 * 这个撞**不在几何上解**，在**优先序**上解：1:1 那一场走 `planRoom1to1Labels()`，
 * 门标注先上、连廊名让位（那一段连廊通向哪两间，看两端那两条 `→N` 就知道）；
 * 缩略图走另一套序（名字先印、门标注让位，见 `floorplan.ts` 里 `occupied` 那段）。
 * 两个尺度各自的取舍都写在那两处。
 */
export function passageLabels(map: DungeonMap, cfg: RoomsConfig): PassageLabel[] {
  return map.passages.map((p) => {
    const vertical = p.rect.height >= p.rect.width
    return {
      between: p.between,
      rect: p.rect,
      text: `连廊 ${p.between[0]}→${p.between[1]}`,
      at: vertical
        ? { x: p.rect.x, y: bottom(p.rect) - cfg.navCellSize * 0.7 }
        : { x: p.rect.x, y: p.rect.y },
    }
  })
}

/**
 * 挤不下就别印 —— 按屏幕距离贪心筛。
 *
 * 为什么需要它：整层缩略图是 **12:1 的长条**（`d2_floorplan` 的盒子只有 984×132），
 * 一排 15 间房的 28 个门洞全标上，在 0.13 的缩放下一堆字会糊成一片，
 * 而**糊掉的标注和没标是一样的**，看起来还像「这一层门特别多」。
 *
 * 为什么是「筛」而不是「挑着标」：挑（比如「只标侧室的门」）要写一条
 * 「哪种门值得标」的规则，而那条规则会随着布局改动悄悄失效。筛只问一件事：
 * 屏幕上放不放得下。**顺序稳定**（先来的赢），所以同一张图两次跑结果一样。
 *
 * ⚠️ 返回值里 `dropped` 必须有人用：场子要把它印出来（`d2_floorplan` 的读数行）。
 * 静默丢弃会让「这一层只有 12 个门洞」变成一句看着像真的假话。
 *
 * ## 两个轴都要近才算撞
 *
 * 判据是「横竖**都**近」，不是「离得远」。字是矩形，一个宽而扁的房名
 * （`#4 侧室·奖励关`）和一个窄的门标注（`→5`）在同一行里挨着，
 * 圆心距离可能很小、字却一点也不叠。按**距离**筛会把这种成对的标注
 * 拆散 —— 而拆散的恰好是「这一间 → 下一间」这种最该留下来的组合。
 *
 * ## `occupied`：已经印上去的，先来的赢
 *
 * 房名和连廊名是在门标注之前印的，它们的位置已经占掉了。把它们的落点传进来，
 * 门标注就得让开 —— 而不是反过来把房名挤掉（那会让缩略图变成「有门号、没房名」）。
 * **两道间隙可以不一样**：两个门标注之间只要不叠字，门标注与房名之间要让开房名的宽度。
 *
 * 参数收的是**和待筛项同一种东西**（`{ at }`），不是裸的坐标点。
 * 不是洁癖：裸点意味着调用方要多写一层 `{ x, y }` 的解包，写错了不会报错 ——
 * 传进来一个 `{ at }` 而这里期待坐标，`x` 就是 `undefined`，
 * 所有比较都变成 `NaN < 20 === false`，于是**一个都不筛**、看着像筛过。
 * 同一种形状就没有这个缝。
 */
export function cullLabels<T extends { at: Point }>(
  items: readonly T[],
  scale: number,
  minGapPx: number,
  occupied: readonly { at: Point }[] = [],
): { kept: T[]; dropped: T[] } {
  const taken = occupied.map((p) => ({ x: p.at.x * scale, y: p.at.y * scale }))
  const kept: T[] = []
  const dropped: T[] = []
  for (const it of items) {
    const x = it.at.x * scale
    const y = it.at.y * scale
    const near = (p: { x: number; y: number }): boolean =>
      Math.abs(p.x - x) < minGapPx && Math.abs(p.y - y) < minGapPx
    const clash = taken.some(near) || kept.some((k) => near({ x: k.at.x * scale, y: k.at.y * scale }))
    if (clash) dropped.push(it)
    else kept.push(it)
  }
  return { kept, dropped }
}

/** `planRoom1to1Labels()` 的参数。用对象而不是排开的几个位置参数：将来加一项不会让调用点错位。 */
export interface Room1to1LabelOptions {
  /** 取景框（世界坐标）。整段落在框外的连廊不给名字，见 `drawRoom1to1`。 */
  readonly box: Rect
  /** 屏幕缩放。1:1 那一场是 1，特写场子按框算。 */
  readonly scale: number
  /** 两个标注之间至少要隔多少**屏幕**像素才算不撞。 */
  readonly gap: number
  /** 已经占了落点的东西（房名）。先来的赢。 */
  readonly occupied?: readonly { at: Point }[]
}

/** 1:1 那一场最后上屏的标注，以及被挤掉几条。 */
export interface Room1to1LabelPlan {
  readonly doors: DoorLabel[]
  readonly passages: PassageLabel[]
  /** 被挤掉的**总数**（门标注 + 连廊名），场子要把它印出来。 */
  readonly dropped: number
}

/**
 * 1:1 那一场的标注**谁上谁下**。绘制层只负责把结果印出来，判断在这一层 ——
 * 这样它进得了 node 测试（`floorplan.ts` import Phaser，进不去）。
 *
 * ## 序：房名 → 门标注 → 连廊名（和缩略图**相反**）
 *
 * 缩略图是「整层的目录」：房名和连廊名是它的内容，门标注是让位的一方
 * （见 `cullLabels` 的 `occupied`）。1:1 是「一扇门的放大镜」：门标注是内容，
 * 连廊名是让位的一方 —— 那一段连廊通向哪两间，看**两端那两条 `→N`** 就知道了，
 * 名字是重复信息；反过来看就丢掉了唯一想读的东西。
 *
 * ⚠️ 这不是洁癖式的对称问题：837 里 `→11`（挂在连廊正下方的侧室那扇门）
 * 与 `连廊 9→11` 只差 **2px**（`(5440,110)` vs `(5440,112)`），必然撞。
 * 用户报的「分支关的门没连上下一个主干道关」**正是** `→11` 那一条 ——
 * 让连廊名赢，就等于把答案筛掉。
 */
export function planRoom1to1Labels(
  map: DungeonMap,
  cfg: RoomsConfig,
  opts: Room1to1LabelOptions,
): Room1to1LabelPlan {
  const inBox = (r: Rect): boolean => fullyInside(r, opts.box)

  const doorPlan = cullLabels(
    doorLabels(map, cfg).filter((d) => inBox(d.rect)),
    opts.scale,
    opts.gap,
    opts.occupied ?? [],
  )
  // 连廊名在**这之后**排，所以它要同时让开房名和已上屏的门标注。
  const passagePlan = cullLabels(
    passageLabels(map, cfg).filter((p) => inBox(p.rect)),
    opts.scale,
    opts.gap,
    [...(opts.occupied ?? []), ...doorPlan.kept],
  )

  return {
    doors: doorPlan.kept,
    passages: passagePlan.kept,
    dropped: doorPlan.dropped.length + passagePlan.dropped.length,
  }
}