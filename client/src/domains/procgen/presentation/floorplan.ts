/**
 * 地图的**白箱**绘制：整层缩略图 + 单间教室 1:1。
 *
 * ---
 *
 * ## ⚠️ 这是 `procgen/` 里**唯一** import Phaser 的文件
 *
 * 别的文件（生成器、校验器、配置加载）都是纯函数，node 下直接跑单测。
 * 一旦哪份**测试**的依赖闭包里出现了 Phaser，`architecture.test.ts` 会当场红 ——
 * 这不是洁癖，是 `vite.config.ts` 把 Vitest 的环境钉死在 `node` 上
 * （见 `AGENTS.md` §七）：需要 jsdom 才能测的逻辑 = 逻辑和表现层没分开。
 *
 * 所以这一层的规矩很硬：**只有它碰 Phaser，而且它不写任何判定。**
 * 它只做一件事 —— 把已经算好的数据画出来。反过来（在绘制里补一个
 * 「这个房间应该在这儿」的推断）会让「画出来的」和「生成出来的」
 * 变成两个事实，而它们**不一致的时候恰恰是最需要看见的时候**。
 *
 * ## 为什么绘制值得单独一层
 *
 * 没有它，三个场子各写一份 `add.rectangle(...)`，三份对「门画在哪儿」
 * 「堵格是什么颜色」的理解就会分叉。而分叉之后，最坏的情形是
 * **两个场子对同一张图给出不同的画面，而两张都"看起来对"** ——
 * 那时没有人能判断哪个是真的，测试场就白建了。
 */

import Phaser from 'phaser'
import type { RoomsConfig } from '../config'
import { isCombatKind } from '../config'
import { bottom, clipRect, left, rectsIntersect, right, top } from '../model/rect'
import type { Door, DungeonMap, Point, Rect, Room } from '../model/types'
import { ROOM_KIND_LABELS } from '../model/types'
import { gridOfMap } from '../walkability'
import { cullLabels, doorLabels, fullyInside, passageLabels, planRoom1to1Labels } from './framing'

// ---------------------------------------------------------------- 配色

/**
 * 配色表。**导出给场子用** —— 图例和画面必须读同一份，
 * 否则图例是对的、画面是错的（或者反过来），而两者都"看起来像那么回事"。
 *
 * ---
 *
 * ## ★ 改了（v5）：整张表按「位置」（主干/侧室）重排成按「关别」
 *
 * 旧表里房间地面分 `mainRoom`（主干蓝）/ `sideRoom`（侧室绿）、描边分
 * `mainRoomEdge`/`sideRoomEdge`/`nonCombatEdge`，门分 `doorForward`/`doorBack`/
 * `doorSide`/`doorSealed` —— **四组颜色全都在说「主干道模型」里的那件事**：
 * 谁是主干、谁是侧室、这扇门是往前走还是回头。
 * v5 里没有主干道（用户 2026-10-19：在走廊里随意走、随意挑房间进），
 * 那四组一起作废。**删干净而不是留着不用**：留着的常量迟早会被新代码
 * 「看起来能用」地捡回去（`mainRoom` 这个名字当年看着也很自然）。
 *
 * 现在只剩**两个通道**，各说一件事：
 *
 * | 通道 | 说什么 | 用在哪 |
 * |---|---|---|
 * | **地面填色** | 这一间**打不打架**（`isCombatKind`） | 整块面，缩略图上一眼看得见 |
 * | **描边** | 这一层**从哪出发、在哪收尾**（起点黄 / 首领红） | 只有两间，其余一律 `roomEdge` |
 *
 * 「非战斗」只走填色一条通道，**描边不再重复说一遍** ——
 * 两个通道说同一件事，一旦分岔（改了一处忘了另一处）就是两张都"看着对"的图，
 * 而那正是这个文件存在的理由要防的东西（见文件头）。
 */
export const COLORS = {
  /** 房间外的底色（整层的"空气"） */
  outside: 0x0b0b10,
  /**
   * **走廊**地面。**比 `outside` 明显亮一档** —— 差得太小的话，
   * 1:1 的场子里「门外面是走廊还是空气」看不出来，而那正是要看的。
   *
   * ⚠️ 它必须是**偏暖的**，不能是中性的灰。第一版用了 `0x262632`
   * （只比底色亮一点的中性灰），结果在缩略图上走廊和背景**分不开**。
   * 也不能偏蓝或偏绿：那会和两类房间的地面撞。所以取一个深卡其 ——
   * 两边都不像，一眼能分出来就是它不是房间。
   */
  passage: 0x453b28,
  /** **战斗关**的房间地面（普通 / 精英 / 首领都算）。烂柯蓝，和旧的主干蓝同一个值 */
  combatRoom: 0x1e3a5f,
  /** **非战斗关**的房间地面（道具关 / 宝箱关 / 楼梯间） */
  nonCombatRoom: 0x1e4f3a,
  /** 起点（楼梯间）的强调描边。**它是出生点**，一层里最先要知道的位置 */
  startEdge: 0xb5a54a,
  /** 首领关（`YF604`）的强调描边。打完它才能下楼 */
  bossEdge: 0xb54a4a,
  /**
   * 其余所有房间的描边。取一个**浅板岩蓝**。
   *
   * 要同时满足两件事：比 `wallEdge`（`0x6a6a80`，1:1 场子里描墙用的）
   * **亮得看得出来** —— 两者会在同一张 1:1 画面上挨着；
   * 以及不要和 `startEdge` 的黄、`bossEdge` 的红混。
   */
  roomEdge: 0x9aa8c4,
  /** 墙 */
  wall: 0x3a3a4a,
  wallEdge: 0x6a6a80,
  /**
   * 门。**只有一种颜色** —— ★ v5 删掉了「前门 / 后门 / 侧门 / 堵死」四色。
   *
   * 那四色分的是**主干道模型里门的方向**，而 v5 的门是无向的（`Door.a` / `b`
   * 按字典序排好，没有"来"与"去"）。今天 16 扇门全是「房间 ↔ 走廊」，
   * 任何「按类型分色」都会得到一个**恒为同一个颜色**的分岔 ——
   * 那比不分类更糟：它看起来像分过了。
   *
   * ⚠️ 「这扇门通向哪儿」现在只由**门标注**说（`→YF604` / `→C_W`），
   * 而标注是**可关的**（`FloorplanOptions.doorLabels`）。关掉标注的场子里，
   * 门就只是一根亮线，读不出任何方向 —— 那是关它的人自己选的，不是漏画。
   */
  door: 0x4ad4a0,
  /** 障碍物 */
  desk: 0x8a6a3a,
  chair: 0x6a5a4a,
  /** 刷怪点 */
  spawn: 0xd44a8a,
  /** **D2 的 40px 可走性判定**：红格 = 这一格中心站不了。底色用 */
  blockedCell: 0xff4040,
  /**
   * 同一件事的**描边**，画在障碍物**上面**。
   *
   * 为什么要两遍：底色那一遍会被**恰好压在上面的那张桌子盖掉** ——
   * 而「这一格为什么堵」的答案就是那张桌子。只画底色的话，
   * 有桌子的格子看不见红、没桌子的格子才有红，**恰好把要看的东西漏光**。
   */
  blockedEdge: 0xff5050,
  /** 40px 网格线。**要比地面亮** —— 比地面暗的线在缩放和压缩之后会消失。 */
  grid40: 0x5f7f9f,
  /** 底座的 80px 粗网格（只画线，不判断）。青色，与 40px 网格明确区分 */
  harnessGrid: 0x00d8ff,
  /**
   * 走廊名的字色。**暖卡其，和 `passage` 是同一个色系但亮得多** ——
   * 它印在那块深卡其的地面上，同色系的暗色字在缩略图上会被背景吃掉。
   */
  passageText: '#c9b483',
  text: '#cfe4ff',
} as const

// ---------------------------------------------------------------- 换算

/** 世界坐标 → 屏幕坐标。**所有绘制都走它**，别处不许再写一次平移公式。 */
export interface Mapper {
  readonly scale: number
  toScreen(wx: number, wy: number): { x: number; y: number }
}

/**
 * 造一个换算器。**导出**：别的绘制（`d2_classroom` / `d2_room_flow` / `joint/d1d2_rooms`
 * 这类只有自己才画的东西 —— 那三个场子都已于 2026-10-19 按用户要求删除）
 * 也该走这一条式子 —— 各写一份的话，两份一旦分叉，表现是**整张图整体偏半格**，
 * 而这种偏移看起来永远像「生成器把墙算歪了」。
 */
export function mapperFor(world: Rect, screenX: number, screenY: number, scale: number): Mapper {
  const originX = left(world)
  const originY = top(world)
  return {
    scale,
    toScreen: (wx, wy) => ({
      x: screenX + (wx - originX) * scale,
      y: screenY + (wy - originY) * scale,
    }),
  }
}

function fillWorldRect(
  g: Phaser.GameObjects.Graphics,
  m: Mapper,
  r: Rect,
  color: number,
  alpha = 1,
): void {
  const p = m.toScreen(left(r), top(r))
  g.fillStyle(color, alpha)
  g.fillRect(p.x, p.y, r.width * m.scale, r.height * m.scale)
}

/** 起止两条世界坐标线（横向或纵向）。 */
function lineWorld(
  g: Phaser.GameObjects.Graphics,
  m: Mapper,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  const a = m.toScreen(x0, y0)
  const b = m.toScreen(x1, y1)
  g.lineBetween(a.x, a.y, b.x, b.y)
}

/**
 * &#32;
 *
 * ## ★ 改了（v5）：`doorColor()` 整个删掉了
 *
 * 它原来是「按 `DoorKind` 取色、`toOrder === null` 走 `doorSealed`」，
 * 而那两个字段都不存在了（见 `COLORS.door` 的注释）。
 * 现在门线一律 `COLORS.door`，**门标注的字色也读同一个常量** ——
 * 原来那两处读同一个函数是为了防「亮线是绿的、旁边那行字是黄的」，
 * 现在只有一份常量，那个漂移在语法上就不可能发生。
 */

/** 数字色 → CSS 字符串。Phaser 的 `text` 收字色只能收这个形式，转换只此一处。 */
function cssColor(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`
}

/**
 * 门画成一段**亮线**。线宽在屏幕上是定值，不随缩放变。
 *
 * 参数直接收 `Door` 本身（不再是「长得像 Door 的一个匿名结构」）——
 * ★ v5 之前这里写的是一个手写的结构类型，所以 `Door` 一变（删 `kind`/`toOrder`）
 * 编译器只报**调用点**两处，而这里看着一切正常。收真类型就不会有这一层。
 */
function drawDoor(g: Phaser.GameObjects.Graphics, m: Mapper, door: Door): void {
  g.lineStyle(3, COLORS.door, 1)
  const half = door.width / 2
  if (door.axis === 'h') lineWorld(g, m, door.x - half, door.y, door.x + half, door.y)
  else lineWorld(g, m, door.x, door.y - half, door.x, door.y + half)
}

// ---------------------------------------------------------------- 整层

export interface FloorplanOptions {
  /** 目标盒子（屏幕坐标，左上角 + 尺寸） */
  x: number
  y: number
  width: number
  height: number
  /** 盒子内边距。默认 10 */
  padding?: number
  /** 画 `#序号` 标签（含门标注与连廊名，见下两个开关）。默认 true */
  labels?: boolean
  /**
   * 门旁标出**它通向哪儿**（`→YF604` / `→C_W`）。默认 true。
   *
   * ★ 改了（v5）：**这一条从「锦上添花」变成了唯一的来源。**
   * 旧图上门线本身还有一种颜色分型（前门绿 / 后门蓝 / 侧门黄）能说点东西，
   * 所以标注关掉还剩下半句话；v5 的门只有一种颜色（见 `COLORS.door`），
   * **关掉标注 = 门变成一根没有任何方向的亮线**。
   *
   * 挤不下就由 `cullLabels` 筛掉（**筛掉几个要印在读数里**，见 `FloorplanView.labelsDropped`）。
   * ⚠️ 而且 v5 的字宽了三倍（`→5` → `→YF604`），筛掉的比例会明显上升 ——
   * 具体多少**没有实测值**（今天没有场子在画整层门标注）。
   */
  doorLabels?: boolean
  /** 走廊上标出**这一段通向哪几间房**（`连廊 C_W · YF601 YF602…`）。默认 true */
  passageLabels?: boolean
  /** 画门。默认 true */
  doors?: boolean
  /** 画刷怪点。默认 true */
  spawns?: boolean
  /** 画障碍物。整层缩略图里它们只有几个像素，默认 false */
  obstacles?: boolean
  /**
   * 要画的世界范围。默认 `map.bounds`（整层）。
   *
   * 有它才能**用同一个函数画局部放大**：把同一个 `drawFloorplan` 对准其中两三间房，
   * 于是**两遍的配色、门、画法天然一致**；各写一份绘制才是分叉的开始。
   *
   * ★ 改了（v5）：原来举的理由是「整层是一排 15 间房、宽近 8000px、高不到 1000px，
   * 缩到屏幕上是一条 8:1 的长条，侧室与宿主那点搭接只剩几个像素」。
   * 那是**主干道那张图**的形状，作废了 —— 平面图是一张 **10520×2920px 的 S 形**
   * （**3.6:1**，263×73 格，与种子无关），缩到 1280 宽的屏幕上高度是 **355px**，
   * 比原来那条长条舒展得多。局部放大这个用途本身还成立（要看门洞与桌椅的细节
   * 时得对准那几间房画），只是不再是为了"长条上挤得看不清"。
   * ⚠️ **今天 `D2/` 下没有场子在用这个参数**（只有 `d2_seeds` 一个 FIELD 场子，
   * 它画整层）。`drawRoom1to1` 走的是另一个入口，不是这里。
   */
  world?: Rect
}

export interface FloorplanView {
  mapper: Mapper
  /** 房间 → 屏幕矩形 */
  roomRect(room: Room): { x: number; y: number; width: number; height: number }
  /**
   * 挤不下被筛掉的门标注条数。**画门标注的调用方有义务印出来。**
   *
   * 它是个容易看着像「这一层门少」的数：缩略图把整层压到一千来像素宽，
   * 门标注全挤上去会糊成一片，所以筛是必须的 ——
   * （★ v5：**每张整层恒为 16 条**门标注，16 扇门与几何一起写死在
   * `floor-plan.json` 里，**与种子无关**。旧的「28 条」是主干道那张图的读数。）
   * ⚠️ 但 **16 扇门的标注在 v5 的缩略图上筛掉几条，没有实测值** ——
   * 字从 `→5` 变成了 `→YF604`（宽三倍），而今天没有场子在画整层门标注。
   * 但**筛掉多少必须说出来**，否则「图上门标注只有 8 条」和
   * 「这一层只有 8 扇门」在现场是同一种画面。
   *
   * ⚠️ **它只数门标注，且门标注关着时恒为 0。** 值是在
   * `if (opts.doorLabels ?? true)` 里面才赋的（房名与走廊名都不进这个数）。
   *
   * 于是有一个**看起来完全正常的读法**会读错：调用方传了 `doorLabels: false`，
   * 又照义务把 `labelsDropped` 印出来，屏幕上就是「筛掉 0 条 / 标注全画下了」——
   * 而它那一场**一扇门牌都没画**。0 在这里不是「都挤得下」，是「没画」，
   * 两者在画面上是同一句话。**关掉门标注的调用方要印的是「没画」，不是 0。**
   */
  labelsDropped: number
}

/**
 * 缩略图上那两行标签：**id + 关别**（分两行印，见 `drawFloorplan` 的 `at` 调用）。
 *
 * ★ 改了（v5）：原来是 `位置·关别`（例 `侧室·宝箱关`），位置词来自 `room.branch`。
 * 位置那两个词（主干/侧室）随主干道模型一起作废了，而**房间的身份换了载体**：
 * v4 里房间是「第 N 间主干 + 它挂着的侧室」（`order` 就是它的名字），
 * v5 里房间是**平面图上那个编号** —— `YF604`、`C_W`、`STAIR`。
 *
 * 为什么用 id 而不是 `order`：`order` 在 v5 里只是「楼梯间 + 其余按 id 升序」
 * 的下标，**不表示进度、不表示远近**（难度用的是到楼梯间的跳数，
 * 见 `gen/layout.ts` 文件头）。玩的人和读代码的人嘴里的那一层都是
 * 「604 是首领关」，而 `#4` 谁也认不出来。
 *
 * ⚠️ **中文名从 `ROOM_KIND_LABELS` 读，不许在这里写第二份关别名册**：
 * 三处各写一遍就是三份会漂移的事实，而漂移的表现是「同一个关别在两块画面上
 * 写着两个词」，谁都不会注意到（spec `procgen-config-contract` 有这一条）。
 */
function roleLabel(room: Room): string {
  return ROOM_KIND_LABELS[room.kind]
}

/**
 * 一间房描边的颜色与线宽。**只回答一个问题：这一间是不是这一层的起点或终点。**
 *
 * ★ 改了（v5）：原来是「起点 / 首领 > 非战斗 > 位置」的三层优先级，
 * 而现在**只有前两层**，非战斗那一层整条删掉 —— 它已经由**地面填色**
 * 说了（`roomFillColor`），描边再说一遍就是两个通道说同一件事，
 * 一旦分岔就是两张都"看着对"的图。
 *
 * 起点与首领优先这一条**没变**，而且理由更硬了：v5 里这两个位置是
 * **功能性的**（出生点在里面 / 打完它才能下楼），不再只是"进度轴的两端"。
 * 默认配置里两个都是战斗房，所以黄/红描边与蓝底不冲突；
 * 真把 `start` 移出 `combatKinds` 时，起点房会保持黄色 —— 那是对的。
 *
 * `cfg` 参数跟着删掉：非战斗那一层走了之后这里没有一处读配置，
 * 留着它编译器会报 TS6133（未使用的参数）—— 而那正是这类"删了一半"
 * 最该被抓住的地方。
 */
function roomOutline(room: Room): { color: number; width: number } {
  if (room.kind === 'start') return { color: COLORS.startEdge, width: 3 }
  if (room.kind === 'boss') return { color: COLORS.bossEdge, width: 3 }
  return { color: COLORS.roomEdge, width: 2 }
}

/**
 * 一间房地面填什么色：**打不打架**。
 *
 * ★ 新增（v5）：旧代码在三个地方各写了一遍 `branch === 'main' ? 蓝 : 绿`
 * （整层填色、1:1 填色、描边），所以 `branch` 一没就是三处编译错误。
 * 抽成一个函数之后，「填色说什么」只有一份真值 —— 而它现在说的是**关别**，
 * 不再是位置。
 *
 * 判据走 `isCombatKind(cfg, kind)`，不写 `kind === 'main' || 'elite' || 'boss'`：
 * 后者就是**第二份 `combatKinds`**，改了配置表它不会跟着变，
 * 而表现是「配置说这关打架、图上画成不打架」。
 *
 * ★ 改名并导出（`roomFill` → `roomFillColor`，2026-10-20）：D1 的小地图
 * （`domains/combat/Minimap.ts`）本来自己写了一遍「战斗关蓝、非战斗关绿」——
 * 而那句 `kind === 'boss' || 'normal' || 'elite'` 正是上面那条 ⚠️ 说的
 * **第二份 `combatKinds`**，只是换了个地方。小地图和整层图会把同一间房
 * 画成两个颜色，而且**谁也不报错** —— 两处各自都"看起来是对的"。
 *
 * 所以导出，让消费方读这一份。代价是它的签名要一个 `RoomsConfig`
 * （`isCombatKind` 的输入），所以 `Minimap` 也得收一份 —— 那是应该的：
 * 「哪几类关别打架」本来就是配置说的，不是小地图能自己决定的。
 */
export function roomFillColor(cfg: RoomsConfig, room: Room): number {
  return isCombatKind(cfg, room.kind) ? COLORS.combatRoom : COLORS.nonCombatRoom
}

/**
 * 缩略图上两个**门标注**之间最少留多少屏幕像素。14 取的是「同一个洞口两侧的标注
 * 不会互相压住」这条口径 —— 门槛一松，字就互相压住，而**糊成一片和没标是一样的**。
 *
 * ⚠️ **这个值曾经是量出来的，而它依据的那次测量测的是已经不存在的几何 —— 值还是 14。**
 *
 * 原先的实测（种子 837，984×132 的缩略图 = 缩放 0.13，**28 个门洞**，
 * 在 20 下筛剩 1 条、在 14 下筛剩 14 条）测的是**主干道时代的几何**：
 * 一条长条（那个盒子 984×132 ≈ **7.5:1**，本文件 49 / 232 行按 8:1 叫它；
 * 主干道种子 837 实测 **8.6:1**，六种子整体 **5.2:1—8.6:1**，所以「8:1」也只是个约数。
 * **107 / 232 / 311 行写的「12:1」在仓库里找不到对应的测量，别引用它**）、28 个门洞。
 * 那张图连同主干道模型一起**已于 2026-10-20 从生成器里摘掉**（任务 4.1—
 * `gen/generate.ts` 现在收的是已解析的 `FloorPlan`，`planLayout(seed, cfg, plan)`），
 * 所以**这两组数字谁也复现不了**，它们只剩「14 是从哪儿来的」这一个用途。
 *
 * ★ 落地后的几何是**写死的、与种子无关的**（探针实测 60 个种子全同）：
 * `bounds` **10520×2920**（263×73 格）、**3.6:1** 的 S 形、**16** 扇门、
 * `largestViewSize` 4840×1840、`roomFitSize` 1920×1160。
 * 洞从 28 变 16、铺得更开，所以 14 **大概率仍然够用** ——
 * 但「够用」是推的，不是量的。
 *
 * ⚠️ **今天没有任何场子在跑这条路径**：整层场子 `d2_seeds` 明确传 `doorLabels: false`。
 * 而**理由不是「挤不下」** —— 那是主干道长条的旧理由，`d2_seeds` 自己
 * （117—121 行）已经撤回了：按落地后的几何复算，gap=14 只筛掉 2—11 条，大头都放得下；
 * 16 扇门在 S 形上挤不挤，**没人量过**。它关着是出于「特写才画」这条分工。
 * 所以 `cullLabels` 的门牌筛选**当前没有活的验证者**，一个数字都验不了。
 *
 * ⚠️ 「28 条里留 14 条」这个**具体数目**本来就是阈值卡的，配置动一动就变。
 * 能保证的是口径本身：**留下来的两条之间不会叠字**。
 * 数目变了由读数行报出来（`FloorplanView.labelsDropped`）—— 不静默。
 * 想重新量一遍，得先有一个**画门标注的**整层场子（现在没有）。
 *
 * ⚠️ **1:1 那一档（`DOOR_LABEL_GAP_1TO1`，几乎不筛）今天同样没有场子在跑** ——
 * 它唯一的使用者就是本文件的 `drawRoom1to1`，而那个函数现在零调用方
 * （原调用方 `d2_classroom` 已于 2026-10-19 按用户要求删除）。
 * `_classroomLook.ts` **不含任何门标注代码**（grep `label` 零命中），
 * 它是落地后重做 1:1 特写时要照抄的那份观感层，**不是门标注的执行者**。
 */
const DOOR_LABEL_GAP = 14

/**
 * 把一个世界矩形按比例缩进一个屏幕盒子。
 *
 * **按比例，不是按 1:1** —— 塞进 1280×720 必然要缩。
 * ★ 落地后整层宽 **10520px**（`floor-plan.json` 的 263 格，与种子无关，探针实测）；
 * 按 1280px 宽的屏幕盒子算，缩放 **≈ 0.12**。
 * （主干道时代是 8800—13960px、缩放 ≈ 0.09—0.15 —— 那组数随模型一起作废了。）
 * 缩略图回答的是「房间怎么串、门开在哪个方向、走廊通不通」，
 * 不是「课桌摆在离墙第几像素」—— 后者是 1:1 特写那一路的活（`_classroomLook.ts`，
 * 挂在 `_` 开头所以不进菜单；原先前排那个整间特写场子 `d2_classroom`
 * 已于 2026-10-19 按用户要求删除）。
 *
 * ## 取景框切到的东西，就不许再替它下结论
 *
 * `world` 比 `map.bounds` 小的时候，边框上会切出**半间房**。半间房画成
 * 半间房是对的（那是真的），但**描边和标签不行**：沿取景框画出来的那两条边
 * 会被读成「这里有一堵墙」，而原图上那儿什么都没有。
 * 所以规矩是：**填充按 `clipRect` 裁着画，描边/标签/门/刷怪点只画整块在框里的**。
 */
export function drawFloorplan(
  scene: Phaser.Scene,
  map: DungeonMap,
  cfg: RoomsConfig,
  opts: FloorplanOptions,
): FloorplanView {
  const world = opts.world ?? map.bounds
  const pad = opts.padding ?? 10
  const innerW = Math.max(1, opts.width - pad * 2)
  const innerH = Math.max(1, opts.height - pad * 2)
  const bw = Math.max(1, world.width)
  const bh = Math.max(1, world.height)
  const scale = Math.min(innerW / bw, innerH / bh)

  // 居中：内容比盒子小的时候两边留一样多，而不是全堆在左上角。
  const screenX = opts.x + pad + (innerW - bw * scale) / 2
  const screenY = opts.y + pad + (innerH - bh * scale) / 2
  const mapper = mapperFor(world, screenX, screenY, scale)

  const g = scene.add.graphics()
  g.setDepth(-80)

  // 1. 连廊。**先画它**，房间盖在上面 —— 房间与连廊交界的那一小段
  //    应该显示成房间，那才是玩家实际站在哪儿。
  //
  //    一段段画，不是画一条贯穿全层的带：连廊是**教室之间**的连接，
  //    一排里两间教室之间那一段深色就是它。
  for (const p of map.passages) {
    const c = clipRect(p.rect, world)
    if (c !== null) fillWorldRect(g, mapper, c, COLORS.passage)
  }

  // 2. 房间地面（+ 可选障碍物）。半间房裁着画，理由见上面「取景框」那一段。
  for (const room of map.rooms) {
    const c = clipRect(room.rect, world)
    if (c === null) continue
    fillWorldRect(g, mapper, c, roomFillColor(cfg, room))
    if (opts.obstacles ?? false) {
      for (const o of room.obstacles) {
        const oc = clipRect(o.rect, world)
        if (oc !== null) {
          fillWorldRect(g, mapper, oc, o.kind === 'desk' ? COLORS.desk : COLORS.chair, 0.8)
        }
      }
    }
  }

  // 3. 墙。缩略图里墙常常只有两三个像素宽 —— 仍然画，因为**它就是
  //    「哪几段是封死的」的唯一可视证据**（侧室的封口、连廊两端）。
  //    墙是整层连续的（上下两条墙线从头贯到尾），所以必须裁。
  for (const w of map.walls) {
    const c = clipRect(w, world)
    if (c !== null) fillWorldRect(g, mapper, c, COLORS.wall, 0.9)
  }

  // 4. 房间描边。压在墙上面：边界比墙更值得看清。
  //    只描**整块在取景框里**的房间，否则沿框边画出来的那两条线会被读成墙。
  for (const room of map.rooms) {
    if (!fullyInside(room.rect, world)) continue
    const p = mapper.toScreen(left(room.rect), top(room.rect))
    const w = room.rect.width * scale
    const h = room.rect.height * scale
    const line = roomOutline(room)
    g.lineStyle(line.width, line.color, 1)
    g.strokeRect(p.x, p.y, w, h)
  }

  if (opts.doors ?? true) {
    for (const room of map.rooms) {
      if (!fullyInside(room.rect, world)) continue
      for (const d of room.doors) drawDoor(g, mapper, d)
    }
  }

  if (opts.spawns ?? true) {
    for (const room of map.rooms) {
      if (!fullyInside(room.rect, world)) continue
      for (const s of room.spawnPoints) {
        const p = mapper.toScreen(s.x, s.y)
        g.fillStyle(COLORS.spawn, 1)
        g.fillRect(p.x - 2, p.y - 2, 4, 4)
      }
    }
  }

  let labelsDropped = 0
  if (opts.labels ?? true) {
    // 字号跟着格子走：缩放很小时 12px 的字会糊成一团，把缩略图变成一片字。
    const size = Math.max(10, Math.min(16, Math.round(cfg.navCellSize * 2 * scale)))
    const at = (p: Point, text: string, color: string, fontSize = size): void => {
      const s = mapper.toScreen(p.x, p.y)
      scene.add
        .text(s.x, s.y, text, {
          fontFamily: 'monospace',
          fontSize: `${fontSize}px`,
          color,
          align: 'center',
        })
        .setOrigin(0.5)
        .setDepth(-70)
    }

    // 顺序即优先级：**房名先印、先占地**，后面的标注让开它。
    // 反过来的话，缩略图会变成「有门号、没房名」——而房名是这张图上唯一
    // 说得出「这是第几间、要不要打」的东西。
    const taken: { at: Point }[] = []
    for (const room of map.rooms) {
      if (!fullyInside(room.rect, world)) continue
      const p = { x: room.rect.x, y: room.rect.y }
      taken.push({ at: p })
      // 标的是**id + 关别**（见 `roleLabel`）：颜色之外还得有字 ——
      // 一块 24px 宽的色块，光靠蓝/绿分不出「精英关」和「宝箱关」；
      // 而 id 是这一层上唯一能把缩略图和 `floor-plan.json` 对上的名字
      // （★ v5：原先是 `#${room.order}`，那个序号不表示进度也不表示远近）。
      at(p, `${room.id}\n${roleLabel(room)}`, COLORS.text)
    }

    if (opts.passageLabels ?? true) {
      for (const p of passageLabels(map, cfg)) {
        // 只标**整段在框里**的：取景框切到的地方常常挂着半段连廊，
        // 给半段贴个「连廊 C_X · YF612」会被读成「这儿整条路都在画里」。
        if (!fullyInside(p.rect, world)) continue
        taken.push({ at: p.at })
        at(p.at, p.text, COLORS.passageText)
      }
    }

    if (opts.doorLabels ?? true) {
      // 只标**门洞整块在框里**的 —— 与连廊同理，也让 1:1 特写不会替框外的门贴名字。
      const all = doorLabels(map, cfg).filter((d) => fullyInside(d.rect, world))
      const { kept, dropped } = cullLabels(all, scale, DOOR_LABEL_GAP, taken)
      labelsDropped = dropped.length
      for (const d of kept) at(d.at, d.text, cssColor(COLORS.door), Math.max(10, size - 2))
    }
  }

  return {
    mapper,
    roomRect: (room) => {
      const p = mapper.toScreen(left(room.rect), top(room.rect))
      return { x: p.x, y: p.y, width: room.rect.width * scale, height: room.rect.height * scale }
    },
    labelsDropped,
  }
}

// ---------------------------------------------------------------- 单间 1:1

export interface Room1to1Options {
  /**
   * 要画的世界矩形（**地图坐标**）。由调用方决定框多大、框在哪 ——
   * 见 `roomViewBox`：对称留白对这个场子是错的，框要朝门外长出去。
   */
  box: Rect
  /** 框的左上角要落到屏幕的哪儿 */
  screenX: number
  screenY: number
  scale?: number
  /** 被裁过的墙。传 `wallsNearRoom()` 的结果 */
  walls: readonly Rect[]
  /** 画 D2 的 `navCellSize` 网格（细线）。默认 true */
  grid?: boolean
  /** **叠加 D2 的 40px 可走性判定**：红格 = 这一格中心站不了。默认 true */
  blocked?: boolean
  /** 叠底座的粗网格（只画线，不做判断）。默认 0 = 不画 */
  harnessGridCell?: number
  /** 画门 / 刷怪点 / 标签。默认全开 */
  doors?: boolean
  spawns?: boolean
  labels?: boolean
  /**
   * 门旁标出**它通向哪儿**（`→YF604` / `→C_X`）。默认 true，随 `labels` 一起关。
   *
   * 1:1 这一场几乎不筛（`DOOR_LABEL_GAP_1TO1`）：这里的字是 12px、
   * 画的是**单间**，一扇门周围有的是地方。缩略图上被筛掉的那些，
   * 到这儿全都看得见 —— 这正是「两个尺度各看一眼」的意义。
   */
  doorLabels?: boolean
}

/** 1:1 这一场两个门标注之间的间隙（屏幕像素）。比缩略图宽：字号 12px，框里也放得下。 */
const DOOR_LABEL_GAP_1TO1 = 34

/** `drawRoom1to1` 的返回值。**多带一个筛除计数** —— 调用方有义务印出来。 */
export interface Room1to1Result extends Mapper {
  /** 挤不下被筛掉的门标注条数（1:1 上通常是 0；不为 0 说明框里挤了太多门） */
  readonly labelsDropped: number
}

/**
 * 一间教室 1:1 —— 这一层要回答的是**单个格子的对错**，所以不缩放。
 *
 * ⚠️ **它只画，不判。** 红色的堵格读的是 `gridOfMap()`（与校验器、与
 * 将来 D3 的寻路同一份），不是这里现算的。如果这里现算一份，
 * 那「测试场显示课桌挡路」就只是这个文件自己的说法，证明不了任何事。
 */
export function drawRoom1to1(
  scene: Phaser.Scene,
  map: DungeonMap,
  cfg: RoomsConfig,
  room: Room,
  opts: Room1to1Options,
): Room1to1Result {
  const scale = opts.scale ?? 1
  const box = opts.box
  const mapper = mapperFor(box, opts.screenX, opts.screenY, scale)

  const g = scene.add.graphics()
  g.setDepth(-80)

  // 1. 底色 + 连廊
  const p0 = mapper.toScreen(left(box), top(box))
  g.fillStyle(COLORS.outside, 1)
  g.fillRect(p0.x, p0.y, box.width * scale, box.height * scale)
  // 一段段判，不是判「走廊那条带」：取景框里可能落在两间教室之间（一段连廊），
  // 也可能整段错开（一间教室挨着下一间，中间什么都不夹）。
  for (const p of map.passages) {
    if (!rectsIntersect(p.rect, box)) continue
    const c = clipRect(p.rect, box)
    if (c !== null) fillWorldRect(g, mapper, c, COLORS.passage)
  }

  // 2. 房间地面。**框里出现的每一间都要填**，不只是选中的那一间 ——
  //    取景框现在朝门外长出去（见 `roomViewBox`），框里必然带着邻居的一条边。
  //    只填选中的那间，邻居就会是**一块黑**，而黑看起来和「生成器没生成这块地面」
  //    一模一样 —— 那正是这个场子最不该犯的错。
  //    邻居填淡一点：画面得能一眼分出「这是要看的那间」和「这是门外的邻居」。
  for (const other of map.rooms) {
    const c = clipRect(other.rect, box)
    if (c === null) continue
    const color = roomFillColor(cfg, other)
    fillWorldRect(g, mapper, c, color, other === room ? 1 : 0.45)
  }

  // 3. **D2 的可走性判定**，压在障碍物**下面**：椅子的格子会红，
  //    但椅子本身还看得见 —— 不然红块会把「是谁把这一格堵了」盖掉。
  //
  //    这一遍是**底色**；描边在障碍物之后（第 6 步）。两遍都要，见 `COLORS.blockedEdge`。
  let blockedCells: [number, number][] | null = null
  if (opts.blocked ?? true) {
    // ⚠️ 读的是 `gridOfMap()` —— **和校验器、和将来 D3 的寻路同一份**。
    //    这里现算一份的话，「测试场显示课桌挡路」就只是这个文件自己的说法。
    const grid = gridOfMap(map)
    const cell = grid.cellSize
    const cx0 = Math.max(0, Math.floor((left(box) - grid.originX) / cell))
    const cx1 = Math.min(grid.cols - 1, Math.floor((right(box) - grid.originX) / cell))
    const cy0 = Math.max(0, Math.floor((top(box) - grid.originY) / cell))
    const cy1 = Math.min(grid.rows - 1, Math.floor((bottom(box) - grid.originY) / cell))
    blockedCells = []
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (grid.blocked[cy * grid.cols + cx] !== 1) continue
        const wx = grid.originX + cx * cell
        const wy = grid.originY + cy * cell
        blockedCells.push([wx, wy])
        const p = mapper.toScreen(wx, wy)
        g.fillStyle(COLORS.blockedCell, 0.28)
        g.fillRect(p.x, p.y, cell * scale, cell * scale)
      }
    }
  }

  // 4. 40px 网格线
  if (opts.grid ?? true) {
    g.lineStyle(1, COLORS.grid40, 0.5)
    const cell = cfg.navCellSize
    for (let x = left(box); x <= right(box) + 0.5; x += cell) {
      lineWorld(g, mapper, x, top(box), x, bottom(box))
    }
    for (let y = top(box); y <= bottom(box) + 0.5; y += cell) {
      lineWorld(g, mapper, left(box), y, right(box), y)
    }
  }

  // 5. 障碍物
  for (const o of room.obstacles) {
    fillWorldRect(g, mapper, o.rect, o.kind === 'desk' ? COLORS.desk : COLORS.chair, 0.85)
  }

  // 6. **堵格的描边**，压在障碍物上面。见 `COLORS.blockedEdge` 的注释：
  //    底色那一遍会被桌子盖掉，而桌子正是这一格堵住的原因。
  if (blockedCells !== null) {
    g.lineStyle(1, COLORS.blockedEdge, 0.9)
    for (const [wx, wy] of blockedCells) {
      const p = mapper.toScreen(wx, wy)
      g.strokeRect(p.x + 1, p.y + 1, cfg.navCellSize * scale - 2, cfg.navCellSize * scale - 2)
    }
  }

  // 7. 底座的粗网格。**只画线**：这一层说「两边的格子不一样大」，
  //    至于「底座会怎么判」是底座的事，抄一份过来只会让两边一起烂。
  //    **画在障碍物之后**：它要说的是「格子长这样」，不是「这格里有东西」，
  //    所以它得跨过桌子继续走。
  const hg = opts.harnessGridCell ?? 0
  if (hg > 0) {
    g.lineStyle(1, COLORS.harnessGrid, 0.55)
    for (let x = 0; x <= opts.screenX + box.width * scale; x += hg * scale) {
      if (x < opts.screenX) continue
      g.lineBetween(x, p0.y, x, p0.y + box.height * scale)
    }
    for (let y = 0; y <= opts.screenY + box.height * scale; y += hg * scale) {
      if (y < opts.screenY) continue
      g.lineBetween(p0.x, y, p0.x + box.width * scale, y)
    }
  }

  // 8. 墙。压在障碍物上面：墙永远比桌子更"硬"。
  for (const w of opts.walls) fillWorldRect(g, mapper, w, COLORS.wall)
  for (const w of opts.walls) {
    const p = mapper.toScreen(left(w), top(w))
    g.lineStyle(1, COLORS.wallEdge, 0.7)
    g.strokeRect(p.x, p.y, w.width * scale, w.height * scale)
  }

  // 9. 门
  if (opts.doors ?? true) for (const d of room.doors) drawDoor(g, mapper, d)

  // 10. 刷怪点
  if (opts.spawns ?? true) {
    for (const s of room.spawnPoints) {
      const p = mapper.toScreen(s.x, s.y)
      g.lineStyle(2, COLORS.spawn, 1)
      g.strokeCircle(p.x, p.y, cfg.navCellSize * 0.4 * scale)
      g.fillStyle(COLORS.spawn, 1)
      g.fillCircle(p.x, p.y, 3)
    }
  }

  // 11. 标签
  let labelsDropped = 0
  if (opts.labels ?? true) {
    const taken: { at: Point }[] = []
    const at = (at: Point, text: string, color: string = COLORS.text, fontSize = '12px'): void => {
      const p = mapper.toScreen(at.x, at.y)
      taken.push({ at })
      scene.add
        .text(p.x, p.y, text, { fontFamily: 'monospace', fontSize, color })
        .setOrigin(0.5)
        .setDepth(-70)
    }
    // 1:1 这一场印的是 **id + 中文关别 + `#序号`**。
    //
    // 关别要和场子读数、和缩略图说得一样（读 `ROOM_KIND_LABELS` 那一份）。
    // `id` 是**这一层的名字**（`YF604`），`#序号` 是**代码里的名字**（`Room.order`）——
    // 1:1 是「对着 `Room` 读代码」的那一面，两个都要有。
    //
    // ★ 改了（v5）：原先印的是 `#9 宝箱关 (side)`，括号里那个 `branch` 是代码里的
    // 字段名。`branch` 删了之后括号换成 `#${room.order}` —— 同一个位置还是放
    // 「代码里的东西」，只是换成了那个还在的字段。**顺序反了**：id 在前，
    // 因为它是读的人拿来对照平面图的那个名字。
    at(
      { x: room.rect.x, y: top(room.rect) + cfg.navCellSize },
      `${room.id} ${ROOM_KIND_LABELS[room.kind]} (#${room.order})`,
    )

    // 连廊那一段 + 门标注：**谁上谁下由 `planRoom1to1Labels()` 判**（在 `./framing`，
    // 那一层不碰 Phaser，所以判断本身进得了 node 测试；这一层只负责印）。
    //
    // 为什么这个序要紧：837 里 `→11`（挂在连廊正下方的侧室那扇门）和 `连廊 9→11`
    // 只差 2px，必然撞掉一条。★ 改了（v5）：那是**主干道时代**的读数 —— 那组坐标
    // 与那两个 `N` 都随模型一起作废（v5 的门标注印的是 `→C_X` 这样的空间 id）。
    // 实测（三个种子 × 每层 16 个 1:1 框、gap=34）：筛选**一次都不触发**（筛掉 0 条），
    // 全层最近的一对是 YF612 的 `→C_X` 与 `连廊 C_X · YF612`（差 dx=60 / dy=50）——
    // **并排这一对今天不会相撞，这条序是给将来留的**。序本身没变：1:1 这一场要的是
    // **门标注**（用户报的缺口就是它），连廊名让位。详见那个函数。
    //
    // 连廊**只标整段在框里的**：取景框朝门外长出去一格，框边上常常挂着半段邻居的
    // 连廊；照 `clipRect` 判的话标签会落在框外那片黑上，看起来像「这里标注了一段
    // 不存在的东西」。半段连廊照样画（那是真的），只是不给它贴名字。
    // （那道筛在 `planRoom1to1Labels` 里，用的是同一个 `box`。）
    if (opts.doorLabels ?? true) {
      const plan = planRoom1to1Labels(map, cfg, {
        box,
        scale,
        gap: DOOR_LABEL_GAP_1TO1,
        occupied: taken,
      })
      labelsDropped = plan.dropped
      // 连廊名先印、门标注压在上面 —— 两者已经互不重叠了（上面那道筛保证了这点），
      // 这个先后只决定万一将来筛漏了谁盖住谁。名字底色浅，压在下面更不容易糊。
      for (const p of plan.passages) at(p.at, p.text, COLORS.passageText)
      for (const d of plan.doors) at(d.at, d.text, cssColor(COLORS.door), '11px')
    }

    // `spawn` 字走自己的落点（沿屏幕往上挪固定一段，不走 mapper），
    // 所以不进 `taken`：它在房间里，门标注在墙上或墙外，两者本来不在一条带上。
    for (const s of room.spawnPoints) {
      const p = mapper.toScreen(s.x, s.y)
      scene.add
        .text(p.x, p.y - cfg.navCellSize * 0.7, 'spawn', {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#ff9ac8',
        })
        .setOrigin(0.5)
        .setDepth(-70)
    }
  }

  return { ...mapper, labelsDropped }
}