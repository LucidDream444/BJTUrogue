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
import type { DungeonMap, Point, Rect, Room } from '../model/types'

/**
 * 房间矩形 + 四周各留一格（`navCellSize`）。**`roomViewBox` 的起点，不是玩家的那一屏。**
 *
 * ⚠️ 名字避开 `screen` / `fit` 是**有意的**：玩家的那一屏是 `roomFitSize`
 * （教室本体 + 一圈墙），而这里多留的是**一整格**。两者不是一个框 ——
 * ★ 拿这一个当缩放口径会**紧 40**，不是松 40（方向原先写反了，2026-10-20 按现公式重算）：
 * 这里每边留一整格（40），`roomFitSize` 每边留 `wallThickness + navCellSize/2` = 60 ——
 * 同一间最大教室 `YF604`（1800）这里框成 **1880**、那边框成 **1920**，窄 40（每边 20），
 * 框窄了 zoom 反而更大（`1280/1880 ≈ 0.681` **大于** `1280/1920 ≈ 0.667`），
 * 切掉的正是**墙外那半格**（门外那一小条地面 —— 门标注离门心 30 = 墙外 10px，
 * 也落在这条里），而不是「多出一圈本不该有的空地」。
 *
 * 这一格是给**墙**的：墙**就是房间边界外的那一格**（★ v5：v4 里墙骑在边界上、
 * 内外各半，见 `model/types.ts` 文件头「对齐」那一节）。只框本体的话
 * 四条墙整条落在框外 —— 而门就开在墙上，看到的就是一个
 * **既没有墙也没有门**的房间。它顺带也是门标注的落点：`doorLabels` 离门心
 * 出 `LABEL_OUT` = 30（`wallThickness/2 + 余量`），正好落在这一格里。
 *
 * ★ 导出（2026-10-21）：**「一间房放大」用的就是它**（`d2_seeds` 按 `V` 切的那个视图）。
 * 那一个视图要的是「看清这间房的桌椅」，而 `roomViewBox` **不是**它的框 ——
 * 实测：走廊是一整条长矩形，`roomViewBox` 并进「门外那块」之后，16 间里有 10 间
 * 的框都被撑到 **4840 宽**（= 整段走廊），缩到 1280 的盒子里只有 **0.26**（桌椅 21px）；
 * 而同一间房按「本体 + 一格」框，缩出来是 **0.43—0.51**（桌椅 34—41px）。
 * 两个框的用途也不同：`roomViewBox` 回答「门外确实有地方可去」，
 * 这里回答「这一间里面摆了什么」。
 */
export function roomWithCell(cfg: RoomsConfig, room: Room): Rect {
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
 * ⚠️ 这里原本给的是「按 `DoorKind` 猜」为什么不行，还配了一张四行的表
 * （主干 `back`/`forward`、主干的 `side`、侧室的两扇）。★ **那张表和 `DoorKind`
 * 一起作废了**（v5：门不再分前后侧，`floor-plan.json` 的 16 扇全是「房间 ↔ 走廊」），
 * 但**探针这个做法一个字都不用改** —— 它本来就没读门的类型，只读几何。
 *
 * 做法：**从门心朝门外面走半格，看落进哪个矩形里。** 半格够了 ——
 * 所有相邻空间都是**贴边**的，而墙**就是两个空间之间那一格**（厚一格），
 * 走半格正好越过它落到对面那块的内部。
 *
 * 落空是**正常**的（落进整层的墙里，也就是门外没有任何空间），不并就是了。
 *
 * ## 并进来的那块，四面再各留一格
 *
 * 留的那一格是给**墙**的：框边恰好压在墙上时，墙只剩半个身子，
 * 看起来像「这儿有一条奇怪的横线」。留一格之后墙整条落在框里。
 *
 * ## ⚠️ 框有多大：**别用这里手推的数**，跑 `largestViewSize`
 *
 * 这一行原先是「框最大 `1760×1280`（最大档主干 1280 + 两侧连廊 400 + 两格留白 80…）」。
 * 那是**主干道时代的手算式**，而它有三种分岔：侧室挂在哪一间、哪几间有侧门、
 * 某一段连廊是不是整层的外沿 —— 三处都**不报错**，只是框小了一点。
 * v5 的平面图更不配合手算（门开在哪、隔壁是走廊还是教室全在配置表里）。
 *
 * 所以**现在的做法是逐间算再取最大**（`largestViewSize`），数写在那里。
 * 那个函数还记着一次心算错 40 的账（640+400+80 算成 1080），
 * 而那次错的直接后果是**悄悄少了一间候选**。
 *
 * ⚠️ **框已经进不了 1280×720 了**（★ v5 实测 `4840×1840`，见 `largestViewSize` ——
 * 这里原先写的 `1760×1120` 是主干道时代的读数），
 * 所以下面「它不是玩家的那一屏」那句比原先更要紧，不是过时了。
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
 * 实测种子 837 是 `13040×1560`，拿它算 zoom 得 `0.098`，
 * 也就是**整层一屏**、每间教室缩成一个小方块，而这个函数的名字还叫
 * 「一间房一屏」。逐维取最大得到 `1760×1120`，那才对。
 *
 * ⚠️ **上面这组数是 2026-10-19 现测的，说的是主干道那张图。** 它之前写的是
 * `7560×880` / zoom `0.169` / 逐维 `1120×640` —— 那是 **`6ac37d3` 之前**的读数
 * （该提交把 `mainWidthTiers` 从 `400/520/640` 抬到 `800/1040/1280`、
 * `mainRoomHeight` 从 280 抬到 600）。**旧的那些数已作废**，别拿它们推现在的整层大小。
 *
 * 数学上也是一回事：zoom 要装下**每一间**，
 * `min_i min(vw/w_i, vh/h_i) = min(vw / max_i w_i, vh / max_i h_i)` ——
 * 最宽的和最高的可以来自不同的房，那没关系，取的是同一个 min。
 *
 * ## ★ v5 实测：`4840×1840` —— 而它**不该再拿去定任何一屏的缩放**
 *
 * 2026-10-20 用平面图（`floor-plan.json` 的 263×73 格、`10520×2920px`）现测，
 * 60 个种子**全部**给出同一个值（几何与种子无关，见 `gen/layout.ts` 文件头）：
 *
 * | 量 | 值 | 谁贡献的 |
 * |---|---|---|
 * | `largestViewSize` | **4840×1840** | 宽：朝 `C_W` 开门的 7 间（楼梯间 + `YF601/602/603/613/614/615`）每一间的框都是 4840 —— `C_W` 长 4760px、两侧各加一格；高：`YF611` 的框 `1680×1840`（`YF604` 的框 `2080×1760`，比它矮） |
 * | `roomFitSize` | **1920×1160** | 宽：`YF604` 的 1800；高：`YF611` 的 1040 |
 *
 * 4840 这个数**不是笔误，也不是算错**：`roomViewBox` 会把房门外那一块整个并进来，
 * 而平面图上一条走廊是**几千像素长**的（`C_W` 实测 `4760×240px`，横贯整层西侧）。
 * 主干道时代一条连廊只有 200—400px，所以那时「一间房 + 门外那点」还能落在一屏里；
 * **真实平面图上不可能** —— 一扇门外面挂着 4760px 的走廊。
 *
 * 这**不是这个函数坏了**，是「一间房一屏」这个取景口径在连续平面上不再成立。
 *
 * ⚠️ **「以后怎么走」已定（用户 2026-10-21）：A —— 整层连续 + 相机跟随玩家。**
 * 已落地：相机在 `BattleScene.fitCamera()`，zoom 由 `combat.json` 的
 * `camera.viewWidth / viewHeight` 算一个**常数**（`min(画布宽/视野宽, 画布高/视野高)`），
 * 整局不变、跟着人走。design 的 Open Questions 第 4 条已同步标成已定。
 * ⚠️ **本行原先（2026-10-20 之前）写着「2026-10-19 用户选定的做法是 A」——
 * 那句话当时没有出处**（design 写未定、改动日志写「要用户点头」，`git show HEAD` 里也找不到），
 * 是那次变更自己写进去的，自查时删掉了。**删得对**：结论虽然在 10-21 被用户确认了，
 * 但 10-20 那天它确实是凭空来的 —— **判据是「有没有出处」，不是「后来对不对」。**
 * 下面三条**在 A 与 B 下都成立**：
 *
 * - 别拿 `largestViewSize` 去算产品里的相机 zoom，那个用法随 v5 一起作废。
 * - 它今天只服务于**白箱调试**：`_classroomLook.ts` 那类「把一间房的四周看全」的场子。
 *   那些场子自己也该知道：框里会带进一整条走廊。
 * - 想重新量，跑 `framing.ts` 的 `largestViewSize`，别手算
 *   （`roomViewBox` 的注释里记着一次心算错 40 的账，而那次错的后果是**悄悄少一间候选**）。
 *
 * ⚠️ 「装下**取景框**」和「装下**教室本体**」是两件事，后者见 `roomFitSize`。
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
 * | `largestViewSize` | 取景框：教室 **+ 门外并进来的整块走廊** | 1:1 特写场子（`d2_classroom`，已于 2026-10-19 按用户要求删除）—— 它要连门外那截一起看见 |
 * | `roomFitSize` | 教室**本体** + 一圈留白 | 一间房一屏的整层场子（`d2_room_flow`，已于 2026-10-19 按用户要求删除） |
 *
 * 用前者去定后者的缩放，**教室会被门外并进来的那些块挤小**。
 *
 * ⚠️ **★ v5 实测：这个差距从「挤小一点」变成了「根本不是一个量级」。**
 * 取景框逐维最大 `4840×1840`（宽的那一维由 `YF601` 朝 `C_W` 开的那扇门贡献，
 * 见 `largestViewSize` 的表），本体+留白 `1920×1160`：
 *
 * ```
 * 拿取景框装 1280×720： min(1280/4840, 720/1840) = 0.264
 *   → YF601 本体 1000×720 落到屏上 264×190px
 * 拿本体装 1280×720：  min(1280/1920, 720/1160) = 0.621
 *   → YF604 本体 1800×960 落到屏上 1118×596px（占屏宽 87%、屏高 83%）
 * ```
 *
 * 也就是说：`roomFitSize` 这一路**仍然成立**（一间教室确实能占满屏幕），
 * 而 `largestViewSize` 那一路在真实平面图上**已经不能用了** —— 拿它定缩放，
 * 教室会缩到屏宽的 20%，剩下八成是门外那条 4760px 长的 `C_W`。
 *
 * ## ★ 改了（v5）：「逐维取最大」这句话在连续平面上不再是默认答案
 *
 * 原来的口径是「最宽取全层最宽、最高的取全层最高，两者可以来自不同的房」，
 * 因为主干道那张图上每间教室的**取景框都只比本体大一圈连廊**，逐维最大和并集
 * 差别不大且都合理。v5 里取景框会把整条走廊卷进来（最长的一条 4760px），
 * 于是逐维最大在**宽**那一维上被单一一扇朝长走廊开的门主导 ——
 * 上表里 4840 与 1920 的差距就是这么来的。
 *
 * 这不是 bug，是「一间房一屏」这个取景口径在连续平面上的必然结果。
 *
 * ⚠️ 而「一间房一屏」这个口径本身**已经被废掉了**（用户 2026-10-21 选 A：整层连续）。
 * 所以这两个函数今天都不决定产品画面上任何一屏的缩放 —— 依据是它们**没有调用点**
 * （`roomFitSize` / `largestViewSize` 在 `framing.ts` 与 `framing.test.ts`
 * 之外一个引用都没有，实测 grep）；产品那边用的是 `combat.json` 的 `camera` +
 * `fitCamera()` 那一条（见文件头）。
 * ⚠️ **但「成因是 A / B 还没定」这个说法已经作废了**（本段原先就是那么写的）：
 * 它们没被用，是因为**取景口径换了一代**，不是因为方向悬着。
 * 本段还曾写作「2026-10-19 用户选的是 A」——那句当天没有出处，已删。
 * 真要改口径（比如改成「取第 75 百分位」），先把用途想清楚。
 *
 * ## 一圈留白留多少：**墙的整条 + 半格门外**
 *
 * `wallThickness` 是让墙整条落在屏幕里（框边正好压在墙上时，墙只剩半个身子，
 * 看起来像一条奇怪的横线 —— 与 `roomViewBox` 里「四面再各留一格」同一个理由）；
 * 半格 `navCellSize` 是让门和门外那一点点地面露出来，读得出「门外面有路」。
 * **两个数都从配置来**，不写死像素（红线 2）。
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
 * 浮点不同的 zoom，相机每过一道门抖一下。**尺寸取全层最大的那一间**，
 * 于是每一间都装得下，且全层只有一次缩放（开场那一次）。
 *
 * ⚠️ **v5 里产品根本没在用这条路** —— 实测这两个函数**除了本文件与
 * `framing.test.ts` 没有任何引用**。
 * ✅ **「以后怎么走」已定（用户 2026-10-21）：A。** 所以「过门时相机怎么动」那半个理由
 * **现在可以判了，不用再搁着**：A 下 zoom 是**一个常数、整局不变**
 * （`combat.json` 的 `camera` + `BattleScene.fitCamera()`），**「全层只算一次缩放」
 * 这条设计意图在 A 下是成立的**（只是落点换到了配置表上，不在这里）。
 * B 那一半（「每层算一次」）随 B 一起作废。
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
  /** 门洞开在第几间的墙上（`Room.order`） */
  readonly ownerOrder: number
  /** 穿过去到哪个空间 —— `Room.id` 或走廊段 id（今天恒为后者，如 `'C_W'`） */
  readonly toId: string
  /** 门洞那块矩形。**与门挡板是同一块**（同一份去重口径，见下） */
  readonly rect: Rect
  readonly axis: 'h' | 'v'
  /**
   * 印什么。例 `→YF604` / `→C_W`。
   *
   * ★ 改了（v5）：原来是 `→5`（另一头的 `Room.order`），墙外那一头印 `→✕`。
   * 现在印 **id**：进度的那个序号在 v5 里已经不再决定任何东西
   * （玩家在走廊里随意走、随意挑房间进），而「这门通向 YF604」正是玩的人
   * 和读代码的人**都会用的那个名字**。
   *
   * ⚠️ **`→✕` 这条分支没有了**，因为「通向墙外」在 v5 里不存在：
   * `Door` 的两头 `a` / `b` 都必须是**平面上真有的空间**（`gen/floorPlan.ts`
   * 的 `checkDoors` 在解析时就拦），所以没有「拿不到目的地」这一种情况。
   * 旧注释里那句「生成器一扇墙外的门都不出，`→✕` 只靠手造地图钉住」随之作废。
   *
   * ⚠️ 代价是**字变长了**（`→5` 两个字符 → `→YF604` 六个），`cullLabels` 会多筛掉几条。
   * 那是读数的事（`labelsDropped` 会报出来），不是这里的事 —— 别为此把 id 砍成数字。
   */
  readonly text: string
  /** 印在哪（世界坐标） */
  readonly at: Point
}

/**
 * 「这段连廊通向哪几间房」的一条标注。
 *
 * ★ 改了（v5）：原来是 `between: [number, number]`（`Passage.between`，
 * 即那段连廊连着的两间房的 `order`）。v5 的 `Passage` 只剩 `{ id, rect }`，
 * 而 `between` **本来就推广不开**：平面图上的走廊是一张**网**，
 * `connectsTo` 里既有「走廊接走廊」（`C_J` 接 `C_W`、`C_S` 接 `C_M`），
 * 也有「走廊接房间」，所以「它连着哪两间」从来不是一般的情形。
 *
 * 改成从 `map.rooms[].doors` **反查**：这一段连廊上开了哪几扇门，
 * 就是它能去的所有房间。走廊↔走廊那几段相接**不进这个表** ——
 * 那两段地面的边在画面上本来就贴着，不需要用字说一遍。
 */
export interface PassageLabel {
  /** 这一段连廊自己的 id（如 `'C_W'`）。**它现在也是这段的叫法** —— floor plan 给它起了名 */
  readonly id: string
  /** 开在这一段上的门通向的**房间** id，按 `Room.order` 升序（起点在最前）。可能是空的 */
  readonly rooms: readonly string[]
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
 * 「房间 ↔ 房间」的那一个洞在两间房的 `doors` 里**各记一条**（`Door` 是无向的，
 * 两条互为同一扇），照着 `room.doors` 逐条出标注就会在同一个地方叠两条 ——
 * 两条都"对"，合起来是一团谁也读不出来的字。
 *
 * 在别处再写一遍去重（`axis + 位置 + 宽度`）就是造第二份会漂的事实。
 *
 * ⚠️ 今天 `floor-plan.json` 的 16 扇门**全是「房间 ↔ 走廊」**，所以这条去重
 * **暂时是空转的**（走廊没有 `doors` 数组，每个洞口只被记了一次）。
 * 留着它不是为了洁癖：删掉的代价是**下一个人加一扇房间互通的门时才会暴露**，
 * 而那时的症状是「同一个洞旁边糊了两行字」。
 *
 * ## 为什么落点不交给调用方算
 *
 * 落点看着是「画的事」，其实是**推导的一部分**，而且有一个必须回答的问题：
 * **两扇门隔着一段连廊面对面**时（A 东墙那扇与 B 西墙那扇，中间就隔着那一整段
 * 连廊的宽），它们的标注往哪边挪才不会叠在一起。
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
 * 清房判据无关，纯粹是几何。`toId` 只决定**印什么字**，不决定落在哪。
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
    // 1. **隔着连廊面对面的两扇门**（A 东墙那扇与 B 西墙那扇）：两个洞的宿主分别在
    //    那一整段连廊的两侧，`out2` 必然一正一负，于是一个往上让、一个往下让。
    //    ★ v5 里这一条**变成了常见情形而不是特例** —— 一排教室朝同一条走廊开的那
    //    十几扇门互相都是「面对面」的邻居。
    // 2. **同一段墙线上相邻的两个洞**：v5 里它们同属一个宿主（同一间房的两扇门）
    //    或者属于隔着走廊面对面的两间房，`out2` 同号或反号都有可能 ——
    //    真正把它们分开的是**沿墙的位置本来就差着一整间房的宽度**，不是这里的符号。
    //    旧注释把这一条说得比实际更玄（那时是靠侧室与宿主分居墙两侧来保证反号）。
    const along = out2

    out.push({
      ownerOrder: b.ownerOrder,
      toId: b.toId,
      rect: r,
      axis: b.axis,
      text: `→${b.toId}`,
      at:
        b.axis === 'v'
          ? { x: r.x + out2 * LABEL_OUT, y: r.y + along * LABEL_SIDE }
          : { x: r.x + along * LABEL_SIDE, y: r.y + out2 * LABEL_OUT },
    })
  }
  return out
}

/**
 * 「这一段连廊通向哪几间房」—— **从 `Room.doors` 反查，一个字都不推**。
 *
 * **两个尺度都要标**：原先只有 1:1 特写标了 `连廊 3→5`，于是整层缩略图上一段连廊
 * 只是一块比底色亮一点的深色 —— 而「那条浅色带能到哪几间」正是缩略图
 * 唯一能回答、单间教室里根本看不见的问题。
 *
 * ## ★ 改了（v5）：`Passage.between` 没了，改成**反查门**
 *
 * 旧数据里 `between` 是「这段连廊连着哪两间」的升序两间（`roomGap` 时代的产物：
 * 连廊**就是**两间主干教室之间那一段，永远只连两间）。
 * v5 的走廊是平面图上的一张**网**：`C_J` 接 `C_W`、`C_S` 接 `C_M`（走廊接走廊），
 * `C_W` 上还开了通往楼梯间的门 —— 所以「它连着哪两间」**从来不是一般的情形**，
 * 旧的 `[number, number]` 形状装不下它，装得下的时候也是在说半句真话。
 *
 * 现在的判据是**这个空间上开了哪些门**：`map.rooms` 里每一间房、
 * 它每一扇门的两头 `a` / `b` 哪一头是这一段连廊的 id。走廊↔走廊那几处相接
 * **不进这个表** —— 那两段地面的边在画面上本来就贴着，不需要用字再说一遍。
 *
 * ⚠️ 判据是「**有没有门**」，不是「几何上挨不挨着」：两段地板贴在一起但不通
 * （中间隔着墙）是**合法**的（`checkSpacesSeparated` 就是查这个），
 * 照几何算会把它标成通的。
 *
 * 顺序取 `map.rooms` 的原序（= `Room.order` 升序，起点在最前），所以稳定、可复现。
 *
 * 落点取连廊**靠下沿那一头**（竖着的连廊），不是正中心：
 * 正中心在缩略图上正好是那段带子的正中，而带子两端各有一个门洞的亮线要读。
 *
 * ## ⚠️ 这道落点会和「连廊下墙上门洞的标注」撞个正着 —— 但**不许**把它挪到正中心
 *
 * 竖着的连廊（`height >= width`）落点在 `bottom - navCellSize*0.7`，
 * 也就是贴着下沿往里去 28px；而贴在连廊**正下方**的那间房，它的门洞就在连廊中线，
 * 门标注 = 洞心 + 法线 30 + 沿墙 20 = 「连廊中线，下沿往里去 30」。
 * 种子 837 实测（主干道时代的几何，那个场子已删）：门标注 `→11` 在 `(5440, 110)`、
 * 连廊名在 `(5440, 112)` —— **差 2px**，按 `cullLabels`（两轴都近才算撞）必然撞。
 *
 * 2026-10-15 试过把落点改到连廊**正中心**，撞是不撞了，但**缩略图明显变差**：
 * 正中心正是连廊两端那两个门标注（`→N`，也就是「这条带子通到哪一间」，
 * 用户报的正是这一条）要去的地方，实测筛掉数从 **14 条涨到 23 条**。回到原落点。
 * ⚠️ 那两个数是**旧几何**上的读数，v5 没重测（门标注从 `→5` 变成 `→YF604`，
 * 字宽了三倍，两组数都不能直接搬）—— 结论（别挪到正中心）仍然成立，量级别引用。
 *
 * 这个撞**不在几何上解**，在**优先序**上解：1:1 那一场走 `planRoom1to1Labels()`，
 * 门标注先上、连廊名让位；缩略图走另一套序（名字先印、门标注让位，
 * 见 `floorplan.ts` 里 `occupied` 那段）。两个尺度各自的取舍都写在那两处。
 */
export function passageLabels(map: DungeonMap, cfg: RoomsConfig): PassageLabel[] {
  // **只记「另一头是连廊」的那些门。** 不写成「每段连廊各扫一遍全图」：
  // 那是 O(段 × 房 × 门)。`passageIds` 那道筛也不能省 —— 少了它，
  // 「房间 ↔ 房间」的门会把**房间 id 也塞进这张表**，而表名叫 `roomsOn` 时
  // 那看起来完全正常（同一个洞在两间房那里各记一条，键是对方那一间）。
  const passageIds = new Set(map.passages.map((p) => p.id))
  const roomsOn = new Map<string, string[]>()
  for (const room of map.rooms) {
    for (const d of room.doors) {
      for (const end of [d.a, d.b]) {
        if (end === room.id || !passageIds.has(end)) continue
        const list = roomsOn.get(end)
        // `includes` 不能省：同一间房在同一段连廊上开两扇门是合法的
        // （平面图里边角上的教室就可能这样），照收会把那间印两遍。
        if (list === undefined) roomsOn.set(end, [room.id])
        else if (!list.includes(room.id)) list.push(room.id)
      }
    }
  }

  return map.passages.map((p) => {
    const vertical = p.rect.height >= p.rect.width
    const rooms = roomsOn.get(p.id) ?? []
    // `连廊 C_W · STAIR`。**id 在前**：平面图给每段走廊起了名，而读代码的人
    // 对着 `floor-plan.json` 找的正是这个 id；房间那串是它的内容。
    // 一间都没有时只印 id —— 空着不印的话，一段连廊有没有名字会看不出规律。
    const text = rooms.length === 0 ? `连廊 ${p.id}` : `连廊 ${p.id} · ${rooms.join(' ')}`
    return {
      id: p.id,
      rooms,
      rect: p.rect,
      text,
      at: vertical
        ? { x: p.rect.x, y: bottom(p.rect) - cfg.navCellSize * 0.7 }
        : { x: p.rect.x, y: p.rect.y },
    }
  })
}

/**
 * 挤不下就别印 —— 按屏幕距离贪心筛。
 *
 * 为什么需要它：整层缩略图把一万来像素宽的一层压到一千来像素（缩放 0.1 上下），
 * 十六条门标注全标上会挤成一片，
 * 而**挤掉的标注和没标是一样的**，看起来还像「这一层门特别多」。
 *
 * ⚠️ **时态（这一段原先栽过两次，都栽在同一件事上：把「落地后」说成「现在是」）**
 *
 * - **v5 之前**：`floor-plan.json` 已经就位但**没有任何运行代码消费它**，
 *   画的是主干道那张图 —— 实测六种子 8800—13960px 宽（5.2:1—8.6:1，随种子）、
 *   每张 **28 条**门标注。
 * - **v5 之后（今天）**：`gen/generate.ts` 收的是**已解析的平面图**，
 *   几何是定死的一份 —— `floor-plan.json` 的 **263×73 格、10520×2920px（3.6:1）**，
 *   `map.bounds` 与种子无关，**16 扇门**（实测见 `layout.ts` / `floor-plan.json`）。
 *
 * 所以别拿主干道那组数（28 条、8.6:1）去推今天的缩略图有多挤：门数少了一半多、
 * 高度从 8:1 拉到 3.6:1 之后铺得开得多。⚠️ **但 v5 也没重测过** ——
 * 门标注的字从 `→5` 变成 `→YF604`（宽了三倍），而**今天没有任何场子在画整层门标注**
 * （见下），所以「筛掉几条」这个数在 v5 下**没有实测值**。
 * 「挤不下所以需要筛」这个结论仍然成立，**具体数目别引用**。
 *
 * 为什么是「筛」而不是「挑着标」：挑（比如「只标某个关别的门」）要写一条
 * 「哪种门值得标」的规则，而那条规则会随着布局改动悄悄失效。筛只问一件事：
 * 屏幕上放不放得下。**顺序稳定**（先来的赢），所以同一张图两次跑结果一样。
 *
 * ⚠️ 返回值里 `dropped` 必须有人用：**画门标注的**场子要把它印出来。
 * 静默丢弃会让「这一层只有 8 个门洞」变成一句看着像真的假话。
 *
 * ⚠️ **但当前没有任何场子在履行这条义务。** 唯一会画整层的 `d2_seeds` 明确传
 * `doorLabels: false`（那是 1:1 特写的活），所以它印出来的那个数是结构性恒 0 的
 * —— 照义务把 0 印成「标注全画下了」，比不印更糟：读的人会以为门牌全挤得下。
 * 别把上面这句话读成「已经有场子在印了」。
 *
 * ## 两个轴都要近才算撞
 *
 * 判据是「横竖**都**近」，不是「离得远」。字是矩形，一个宽而扁的房名
 * （`YF612 宝箱关`）和一个窄的门标注（`→C_J`）在同一行里挨着，
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
 * ⚠️ 这不是洁癖式的对称问题：837 里（主干道时代）`→11`（挂在连廊正下方的
 * 侧室那扇门）与 `连廊 9→11` 只差 **2px**（`(5440,110)` vs `(5440,112)`），必然撞。
 * 用户报的「分支关的门没连上下一个主干道关」**正是** `→11` 那一条 ——
 * 让连廊名赢，就等于把答案筛掉。
 *
 * ★ 改了（v5）：**那组坐标与那两个 `N` 都作废了**（门标注改成 `→C_M` 这样的
 * 空间 id、连廊名改成 `连廊 C_M · YF604 YF611`、几何换成平面图），
 * 但**序本身没变**，而且理由更强了：v5 里连廊名比门标注**长得多**
 * （`连廊 C_W · YF601 YF602 YF603 YF613 YF614 YF615` 有 40 个字符），
 * 让它先上会把一整排门牌挤没。具体撞在哪、撞掉几条，**v5 没测过** ——
 * 今天也没有场子在跑这条路径（`drawRoom1to1` 零调用方）。
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