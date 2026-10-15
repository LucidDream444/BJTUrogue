/**
 * **整层可玩：一间教室一屏、门是互动点、按 `F` 过门。** `room-transitions` 的场子。
 *
 * 别的两个 D2 场子看的是**几何**（一间房 1:1、一层楼缩略图）。这一场看的是
 * **过程**：哪些门现在能走、过门之后还回不回得去。
 *
 * ## 它验的是这五条（每一条都能在画面上指出来）
 *
 * | 验的 | 怎么看见 |
 * |---|---|
 * | 进房即封门（4.3） | 一进屋，这一间的每一扇门同时变红 —— 包括身后的 |
 * | 清完放行（4.4） | 打光最后一只，**等 300ms**（宽限窗口）门才变绿，不是当场 |
 * | 非战斗房不封（4.5） | 走进道具关 / 宝箱关，门自始至终是绿的，随时能走 |
 * | 按 `F` 过门（4.6） | 站到门前 → 出现提示 → 按 `F` → 镜头沿连廊推过去，落在目标门内侧 |
 * | 「不回头」（4.7） | 过门之后回头看：那扇门**永久**红着，清房判定也不会再放行 |
 *
 * ## ⚠️ 门是**互动点**，不是能走过去的洞（用户报的那一条）
 *
 * 门标记只有两种：
 *
 * | 标记 | 意思 | 门洞能**走**过去吗 |
 * |---|---|---|
 * | 红 | 封着：这一间还没打完 / 这是身后那扇 | **不能** |
 * | 绿 | 可以过：站到门前按 `F` | **也不能** |
 *
 * **门洞永远走不过去** —— 底座那几块物理体造出来就是关的，一直没开过；绿色只表示
 * 「现在按 `F` 能过去」。用户看完这一场的反馈是「现在能穿过互动点明显是不对的」：
 * 之前绿色 = 物理体停用 = 真的能走出去，于是玩家会走到连廊上，而那时相机还锁在
 * 教室里，画面上是「人不见了」。
 *
 * 顺带把怪也锁在屋里了（它们吃的是同一批静态体）—— 以前它们能从绿门溜到连廊上。
 * 「为什么不干脆开关底座那块物理体」见 `sealAllDoors`。
 *
 * ## 怎么开
 *
 * ```
 * npm run dev   →   http://localhost:5173/test.html?arena=d2_room_flow
 * ```
 *
 * | 键 | 干什么 |
 * |---|---|
 * | `WASD` | 走。桌椅、墙、门洞都撞得住（**门洞也撞得住**，见上） |
 * | `左键` | 打一枪（底座那个调试枪） |
 * | `F` | 过门。**只有站在门前、且这一扇现在可过**才生效 |
 * | `C` | 模拟清图：把这一间标记为已清、门随之放行（4.8）。用它可以不打就走到首领房 |
 * | `V` | 重刷本房：撤掉「已清」标记、把怪刷回来 —— 用来**重复看**清房那一下 |
 * | `Q` | 收起右下角的自检读数（它压着东侧那几扇门的标注，见 `READOUT_X`） |
 * | `R` / `0` / `I` / `空格` | 复位 / 清场 / 无敌 / 暂停（底座给每个场子都有的那几个） |
 *
 * ## ⚠️ 「最后一只怪是分裂怪」是**每一间**都在发生的事，不是特例（4.10）
 *
 * 每间战斗房刷的是 **一代分裂怪**（`gen 1`），它死掉之后**隔 160ms** 才放出 4 只子代
 * （`enemies.json` 的 `splitDelayMs`）。也就是说：**这一间最后死的那一只，必然是分裂怪**，
 * 而它死后的那 160ms 里「存活 0、队列 0」是**真的** —— 房间看起来就是空的。
 *
 * 那一瞬间要是放行，玩家走进下一间，4 只子代随后出生在**身后的空房里**：
 * 这一局就再也清不掉了。`rooms.json` 的 `settleMs`（300ms）就是为这个窗口准备的。
 *
 * 所以这一场把这条窗口**印在读数上**，两行：
 *
 * - `清 #N：杀后 436ms 宣告` —— 实际等了多久。**小于 `settleMs` 就是坏消息**。
 * - `⚠️ 清完又冒出来 4 只` —— 宣告之后还有东西出生。**看见它就是宽限窗口没兜住**
 *   （子代迟到了），而那一刻门已经放行了。这一行是**自检**，正常情况下永远不出现。
 *
 * 想手动看一遍：随便进一间，把怪打光，盯着读数第 3、4 行 —— 队列会先跳成 4，
 * 门在这之后才变绿。想重复看就按 `V`。
 *
 * ## 坐标系：**世界 = 地图 × 缩放**，不是相机的 `zoom`
 *
 * 整层的场子必须在地图坐标里跑（门挡板的下标、`barrierIndicesByRoom` 的下标、
 * 连廊的位置全都按全层那一份算）。而画布是跟着窗口走的（`Scale.RESIZE`，
 * `launcherMain.ts`），所以：
 *
 * - 地图 → 世界只差**一个等比缩放**（`zoomFor(roomFitSize(...))`，种子 837 在
 *   1280×720 的画布上实测 `1280/760 = 1.684`），原点不动。于是「一间教室一屏」
 *   是一道**平移**：每帧把相机 `centerOn` 到当前**教室本体**的中心，缩放始终是 1。
 * - 缩放取的是**当场那块画布**（`this.scale.width/height`），不是写死的 1280×720 ——
 *   写死的话「一屏」只在作者那块屏幕上成立，窗口一大，教室又缩回屏幕中间一小块
 *   （用户报的正是这一句「教室应该是占满屏幕的」）。底座自己的 HUD 也是这么取视口的
 *   （`Hud` 里全是 `scene.scale.width/height`）。**代价**：缩放是开机那一次算的，
 *   之后改窗口大小不重算（整层世界是按它铺的）—— 改完刷新一次。
 * - 装的是**教室本体**（`roomFitSize` = 最大那间 + 两圈留白 60），**不是取景框**。
 *   取景框把门外并进来的侧室与连廊一起算，种子 837 量出 1120×640 → 缩放退成
 *   `720/640 = 1.125`，于是一间 640×280 的教室只占屏宽 56%、屏高 44%，
 *   上下左右一圈全是门外的东西。用户看的就是那一屏（反馈原文：「教室应该是占满屏幕的」）。
 *   换成教室本体之后最大那间占屏宽 84%、屏高 65% —— 16:9 的屏幕装 2.29:1 的教室，
 *   宽贴满了、高就只能留白（再放大就得把教室的左右两端裁掉）。
 * - 代价：**门外那一截连廊在屏幕外了**（上一版看得见）。所以门前提示挂在门的**里侧**，
 *   而「门外通向哪一间」由门标注（`→N`）与提示文字回答 —— 那两条都不靠看门外。
 * - **不 `cameras.main.setZoom()`**：底座的 HUD（读数、提示、按键说明）挂在
 *   `setScrollFactor(0)` 上，而 Phaser 的缩放**照样作用在它们身上** —— 用了引擎的
 *   zoom，整块 HUD 会跟着放大并朝画布中心挪，看起来像「字自己跑了」。
 *   左键瞄准也会跟着歪（`DebugGun` 算的是 `pointer.x + cam.scrollX`，那个式子在
 *   zoom ≠ 1 时不对）。把缩放放进世界坐标里，HUD、瞄准、读数一个像素都不动。
 * - `zoomFor()` 的取值要求一条没少：它仍然由「配置里最大的房间档位 + 一圈留白 + 视口」
 *   反推（design 决策 6），只是它乘在坐标上而不是坐在相机上。
 *
 * 代价写在这里：这一场的**世界有 12665×1415**（种子 837：地图 7520×840 × 1.684）。底座原来把活动范围钉死在
 * 1280×720，那对玩家是**硬夹子**（物理体每帧从 `GameObject` 同步，所以夹的是位置本身）、
 * 对寻路是**硬边界**（网格外的格一律不可走）。所以底座多了 `ArenaConfig.field`
 * —— 这个场子就是它存在的理由，见那里的注释。
 *
 * ## ⚠️ 这一场**不验**什么
 *
 * - **它不是产品场景。** 产品的战斗场景归 D1：镜头推移的时长、过门是按键还是走过去、
 *   门的开关怎么接，都由 D1 定。这一场共用的是 `domains/procgen` 里那几份**判据**
 *   （`roomFlow.ts` 纯函数 + `colliders.ts` 的挡板映射），场子只负责接线。
 * - **怪绕不绕得开桌椅** —— 和 `d2_classroom` 同一条账：底座的 `makeNav` 只吃
 *   `cfg.walls`，桌椅从头到尾没进过网格。怪会顶着桌子磨，那是两边在打架，不是 AI 坏了。
 * - **清房查询的精度** —— 宽限窗口是**用时间换正确性**。真正的解法是问 D3 要一个
 *   「本房还有几只没出来」的查询（见 change 的 Open Questions），那时窗口能退成 0。
 *   读数里的那一行自检就是在盯着这笔账。
 */

import type Phaser from 'phaser'

import type { ArenaConfig, ArenaContext, ArenaDefinition } from '../../ArenaBase'
import { ArenaBase } from '../../ArenaBase'
import { barrierIndicesByRoom, collidersOf, type DoorBarrier } from '@/domains/procgen/colliders'
import type { RoomsConfig } from '@/domains/procgen/config'
import { doorShouldBeClosed, roomCleared, roomNeedsFight } from '@/domains/procgen/roomFlow'
import { bottom, containsPoint, left, rectCenter, right, top } from '@/domains/procgen/model/rect'
import { ROOM_KIND_LABELS } from '@/domains/procgen/model/types'
import type { DungeonMap, Point, Rect, Room } from '@/domains/procgen/model/types'
import { roomFitSize, zoomFor } from '@/domains/procgen/presentation/framing'
import { drawFloorplan, mapperFor, type Mapper } from '@/domains/procgen/presentation/floorplan'
import {
  DEFAULT_SEED,
  generateForArena,
  loadRoomsConfig,
  nearestSpawn,
  screenRect,
} from './_shared'

/**
 * 每间战斗房刷几只、刷哪一代。**这是测试场的密度，不是产品数值** ——
 * 产品按 `Room.budget` 与难度刷（`gen/spawns.ts` + D3 的系统）。
 *
 * 为什么是**一代分裂怪**：它死掉之后要隔 160ms 才放出子代（`splitDelayMs`），
 * 而那 160ms 就是「房间看起来空了、其实还没有」的那段窗口。挑它当小怪，
 * 于是**每一间的最后一只**都在考 `settleMs` 够不够 —— 见文件头 4.10 那一段。
 * 挑二代（`gen 2`）的话它不分裂，这条窗口永远跑不到。
 */
const SPAWN_KIND = 'splitter' as const
const SPAWN_GEN = 1
const MAX_MOBS_PER_ROOM = 2

/**
 * 过门的镜头推移时长（ms）。**调试设施的时间常数，不是平衡数值** ——
 * 产品的过门节奏归 D1（《人员分工方案》里「手感」是 D1 的域），
 * 这里的 300ms 只求「看得出镜头是沿连廊推过去的，而不是瞬切」。
 */
const PAN_MS = 300

/**
 * 过门落地后的无敌时间（ms）。**同样是调试便利**：一落地就挨 4 只子代的打的话，
 * 看的是「逃跑」而不是「门开没开」—— 和 `d2_classroom` 里那条理由一模一样。
 */
const ARRIVAL_GRACE_MS = 700

/**
 * 站到门前多远算「站在门前」（px，地图单位，**在门轴方向上的余量**）。
 * 半堵墙 + 一个身位 + 一点富余，够把「擦着门边走过」和「站在门口」分开。
 */
const DOOR_REACH_SLACK = 24

/** 画整层时给底图留的边（世界单位）。落在画布外的部分本来也看不见。 */
const FLOOR_PAD = 12

/**
 * 门标记的两种颜色。**与底座那两种同色**（`ArenaBase` 里的 `DOOR_OPEN_STROKE` /
 * `DOOR_SHUT_FILL`）：底座那两块矩形被这里盖住，颜色不一致会看起来像两套状态。
 *
 * `export`：子类 `d2_three_rooms` 的小地图也要画「这扇门现在封没封」，
 * 而**同一件事在画面里不该有两种颜色** —— 它 import 这两个，不另写一份。
 */
export const DOOR_MARK_OPEN = 0x44dd88
export const DOOR_MARK_SHUT = 0xff4466
/**
 * 门标记的深度。底座的挡板可视化在 `-45`（`DOOR_DEPTH`），要盖住它；
 * 人物在 `0`，不能盖住人。
 */
const DOOR_MARK_DEPTH = -40
/** 标记比门洞四周各放大这么多：底座那圈 2px 的描边压在洞口边上，不放大就露出半条红边。 */
const DOOR_MARK_PAD = 4

/**
 * 「这一间之外」压暗的那一层（4 块矩形，围出当前房间那一块亮区）。
 *
 * ## 为什么要有它
 *
 * 缩放取的是**全层最大的一间**（`roomFitSize`，见 `configure`），所以最窄的那一档
 * （400 宽）在屏幕上只占 53% 宽 —— 剩下那圈是**连廊与邻室的底板**。
 * 不压暗的话，邻室那片地板与当前这间**同一个色**，看起来就是一整间大屋子：
 * 用户的第一句反馈（「教室应该是占满屏幕的」）说的正是这个观感。
 * 压暗之后屏上**只有这一间是亮的**，与 design 决策 6「只显示当前房间 + 门前一小块」
 * 是同一句话的两个说法（亮区就是 `roomFitSize` 的那个框）。
 *
 * ## 为什么是 4 块而不是一块带孔的
 *
 * Phaser 的 `Graphics` 要挖洞得上 `GeometryMask`，而遮罩一挂上去就是**逐像素**的活儿；
 * 4 块矩形是 4 个游戏对象，`setSize` 一下就完事，也不动任何别的深度层。
 *
 * ## 深度与时机
 *
 * `-44`：压得住底图（−80）、门标注与墙（−70 / −50），压不住**门标记**（−40）
 * —— 门是玩家正在看的东西，红/绿必须最亮；也压不住人物（0）与提示（20）。
 * **推移期间要藏起来**（`tryPass` / `finishPan`）：镜头是沿连廊推过去的，
 * 那一段本来就该看见走廊；不藏的话整屏会暗成一片黑。
 */
const MASK_DEPTH = -44
const MASK_COLOR = 0x05050a
/** 压暗的强度：还要隐约看得见邻室的轮廓（完全黑掉会像「地图被裁了」）。 */
const MASK_ALPHA = 0.75

/**
 * 自检读数：画布右下角那一条。宽度与 `d2_classroom` 一致（同一套字号、同一个理由）。
 *
 * ⚠️ 它压在**教室东侧那一带**：1280×720 的画布上可见范围 ≈760 地图单位
 * （画布 1280 ÷ 缩放 1.684），栏宽 272px ≈ 162 地图单位 —— 对最大档（640 宽）
 * 会盖住教室东墙往里的一条，对最窄档（400 宽）正好落在墙外那段连廊上，
 * 而门标注（`→N`）就挂在那一带。所以补了 `Q` 一键收起，理由与
 * `d2_classroom` 那边逐字相同。
 *
 * ⚠️ 落点跟着**当场那块画布**（`scene.scale.width/height`），不是 `WORLD_WIDTH/HEIGHT`
 * 那两个常数：画布是 `Scale.RESIZE` 的，窗口比 1280×720 矮时固定的那条
 * 会**落到画布外面**（看起来像「读数没画出来」，而它其实只是画在屏幕外）。
 * **行宽预算 21 个全角**：272px / 11px ≈ 24，留三格富余。
 *
 * `export`：子类 `d2_three_rooms` 的小地图要摆在这条栏的左边（不压住它），
 * 它得知道这条栏有多宽 —— 这里写一份、那边再抄一份的话，
 * 对不上时**不报错**，只表现为「小地图压住读数」。
 */
export const READOUT_WIDTH = 272
/** 每行的高度。11px 字 + 4px 行距（与 `d2_classroom` 同一个值）。 */
const READOUT_LINE = 15

/** 这一场的布局：生成一次、之后只读。 */
interface FlowLayout {
  readonly map: DungeonMap
  readonly cfg: RoomsConfig
  /** 地图 → 世界 的换算器。**全场只有这一份**（绘制、碰撞、落点、回答询都走它） */
  readonly mapper: Mapper
  readonly scale: number
  /**
   * 门洞挡板，**全层一份、顺序与交给底座的那个数组逐项对齐**。
   *
   * ⚠️ 这两个「一份」是这一场最要紧的约束：`barrierIndicesByRoom()` 算出来的下标
   * 要能直接喂给 `ctx.colliders.doors.setClosedAt(i, …)`。裁剪过、排过序、
   * 或者按房重新过滤一遍，下标就会**整体偏移**，而症状是「门放行了，但不是那一扇」——
   * 看起来像判定写错了（见 `colliders.ts` 里那个函数自己的注释）。
   */
  readonly barriers: readonly DoorBarrier[]
  readonly byRoom: ReadonlyMap<number, number[]>
}

/** 刚刚过门那次推移的状态。非 `null` = 正在推移（输入被锁住）。 */
interface PanState {
  /** 目的房间的 `order` */
  readonly to: number
  /** 落地时玩家站的地图坐标（目标门内侧） */
  readonly arrive: Point
  /** 推移期间把玩家钉在世界坐标的哪一点（出发门内侧） */
  readonly hold: Point
}

/** 最近一次「宣告清房」的记录。**读数里那一行自检就是它**（见文件头 4.10）。 */
interface ClearRecord {
  readonly order: number
  /** 从最后一杀到宣告，实际等了多久（ms） */
  readonly sinceKillMs: number
  /** 宣告那一刻的两个数（判据要求两个都是 0） */
  readonly live: number
  readonly queued: number
  /** 是 `C` 按出来的还是真打出来的 */
  readonly simulated: boolean
  /**
   * 宣告**之后**本房还出生了几只。
   *
   * 正常情况下永远是 0（子代在窗口内出生 → 判据当时就不成立）。
   * 它一旦不是 0，说明「门放行之后才冒出东西」——**宽限窗口没兜住**，
   * 而那正是这一整条设计里最弱的一环（见文件头）。
   */
  afterSpawn: number
}

/**
 * 门**从哪一侧穿过**：门心 + 穿行方向。
 *
 * `Door`（地图数据里的门洞）与 `DoorBarrier`（算出来的挡板）都能给出这两个数 ——
 * 前者扁的（`x/y/axis` 直接挂在对象上），后者套在 `rect` 里。这一场两处都要用，
 * 所以换成同一个形状再进 `innerPoint()`，省得两个入口各推一遍「沿哪条轴挪」。
 */
interface DoorMouth {
  readonly x: number
  readonly y: number
  readonly axis: 'h' | 'v'
}

/** `DoorBarrier.rect` 的**中心**就是门心（挡板正好填住洞口），所以只差一次拆包。 */
function mouthOf(b: DoorBarrier): DoorMouth {
  return { x: b.rect.x, y: b.rect.y, axis: b.axis }
}

/**
 * 「整层转接」这台机器。**子类能改的只有四个参数**，四个都给好了默认值：
 *
 * | 钩子 | 默认 | 谁用 |
 * |---|---|---|
 * | `seed` | `DEFAULT_SEED`（837） | `d2_three_rooms` 的 `N` 换种子 |
 * | `roomCount` | `undefined`（= 配置表里的 15） | `d2_three_rooms` 要三间 |
 * | `keyHints()` | 本场那四个键 | 子类自己加的键得印出来 |
 * | `extraReadoutLines()` | 空 | 子类自己那几行读数 |
 *
 * 为什么给钩子而不是让新场子复制一份：**门的状态机、镜头推移、清房判定这三样
 * 是最不该各写各的** —— 两份一旦分叉，症状是「同一扇门在两个场子里一个过得去
 * 一个过不去」，而那种问题没有报错，只能靠人碰巧看见。
 *
 * ⚠️ 这个类 export **只是为了让子类继承它**（`d2_three_rooms`）。
 * 目录只认下面那个 `arena` 常量，export 一个类不影响注册 —— 但每个场子文件
 * 仍然必须有自己的 `arena` 导出（`arenaCatalog.ts` 会当场抛）。
 */
export class D2RoomFlowArena extends ArenaBase {
  /** 子类要照着它画自己的东西（小地图 / 观感层），所以是 `protected` */
  protected layout: FlowLayout | null = null

  /** 玩家现在在第几间。**唯一的进度状态** —— 「不回头」由它比大小推出来 */
  protected currentOrder = 0
  /** 已经清掉的（或 `C` 模拟清掉的）房间 */
  protected readonly clearedRooms = new Set<number>()
  /** 已经刷过怪的房间。**刷过就不刷第二次**（`V` 会把它撤掉） */
  private readonly spawnedRooms = new Set<number>()
  /** 走过的房间（读数的「已走过 N 间」）。**只用来显示**，不参与任何判定 */
  private readonly visitedRooms = new Set<number>()

  /** 最近一次击杀的时刻（逻辑时钟）。**每次击杀都重置** —— 清房判据的宽限窗口 */
  private lastKillMs = 0
  /**
   * 这一场**唯一一份门状态**：`true` = 封着（红色，按 `F` 也过不去）。
   *
   * ⚠️ 它**不是**底座那块物理体的状态 —— 那些**永远是关的**（`sealAllDoors`）。
   * 门在这一场是**互动点**：`shut` 说「站到门前按 `F` 能不能走」，物理体说
   * 「门洞永远走不过去」。两者故意不同，见 `sealAllDoors`。
   */
  protected shut: boolean[] = []
  /** 门标记：一扇门一块，颜色跟着 `shut` 走（底座那两块矩形被它们盖住） */
  private doorMarks: Phaser.GameObjects.Rectangle[] = []
  /** 「这一间之外」压暗的 4 块（上 / 下 / 西 / 东），跟着当前房间走。见 `MASK_DEPTH` */
  private mask: Phaser.GameObjects.Rectangle[] = []
  private pan: PanState | null = null
  private clearRecord: ClearRecord | null = null

  /** 门前提示（世界坐标上的一条字，跟着门走）。挂在门的**里侧**，见 `updatePrompt` */
  private prompt: Phaser.GameObjects.Text | null = null
  /** 自检读数：底板 + 文字。`Q` 一起收起 */
  private readout: (Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text)[] = []

  protected get definition(): ArenaDefinition {
    return arena
  }

  /** 生成哪一层。子类换种子就覆盖它（`d2_three_rooms` 的 `N` 键）。 */
  protected get seed(): number {
    return DEFAULT_SEED
  }

  /**
   * 整层生成几间。`undefined` = 配置表里那个数（15）——
   * 子类给个数就是**短层**，走 `roomsConfigWithRoomCount`（改原始 JSON，校验器照跑）。
   */
  protected get roomCount(): number | undefined {
    return undefined
  }

  override preload(): void {
    super.preload()
    loadRoomsConfig(this)
  }

  // ------------------------------------------------------------ 装配

  /**
   * 整层生成 + 装配。**三件事的顺序在这一场是有意义的**：
   *
   * 1. 生成地图 → 2. 量出缩放（`zoomFor`）→ 3. 用同一个换算器把**绘制**与
   *    **碰撞**一起喂出去。第 3 步分成两份（绘制在 `onArenaCreate`）是本场唯一
   *    的分岔点，所以两处都从 `this.layout.mapper` 取 —— 各算一遍平移公式的话，
   *    两份一旦分叉，表现是**整层图和它的碰撞体错开半个身位**，
   *    而那看起来永远像「生成器算歪了」（`_shared.ts` 的 `collisionInBox` 注释里
   *    记着一次真实的账：所有碰撞体整体平移了几百像素，一行报错都没有）。
   */
  protected configure(): ArenaConfig {
    const { map, cfg } = generateForArena(this, this.seed, this.roomCount)

    // 「一间房一屏」的缩放：由**配置里最大的教室本体 + 一圈留白 + 画布尺寸**反推，
    // 全层一个值（相邻两间同档位的房不会算出两个浮点不同的 zoom 而抖一下）。
    //
    // ⚠️ 装的是**教室本体**（`roomFitSize`），不是取景框（`largestViewSize`）。
    // 后者把门外并进来的侧室与连廊一起算进去，种子 837 量出 1120×640，
    // 缩放退成 `720/640 = 1.125` —— 一间 640×280 的教室只占屏宽 56%、屏高 44%，
    // 上下左右一圈全是门外的东西。用户看完这一场的反馈原文就是「教室应该是占满屏幕的」。
    // 换成教室本体（640×280 + 两圈 60）之后是 `1280/760 = 1.684`，
    // 最大那间占屏宽 84%、屏高 65%（宽贴满、高按教室的长宽比留白）。
    //
    // ⚠️ 视口取**当场那块画布**（`this.scale`），不是写死的 `WORLD_WIDTH/HEIGHT`：
    // 画布是 `Scale.RESIZE` 的，窗口一大，写死的那份算出来的缩放就又把教室
    // 缩回屏幕中间一小块 —— 用户报的那一屏会原样复现（`zoomFor` 自己的注释里
    // 写着同一条：「写死的 zoom 只在作者的那块屏幕上是对的」）。
    const view = { width: this.scale.width, height: this.scale.height }
    const scale = zoomFor(roomFitSize(map, cfg), view.width, view.height)
    // 原点不动：世界 = 地图 × 缩放。见文件头「坐标系」那一段。
    const mapper = mapperFor(map.bounds, 0, 0, scale)

    const col = collidersOf(map, cfg)
    this.layout = {
      map,
      cfg,
      mapper,
      scale,
      barriers: col.barriers,
      byRoom: barrierIndicesByRoom(col.barriers),
    }

    const world = (r: Rect): { x: number; y: number; width: number; height: number } =>
      screenRect(r, mapper)

    return {
      // ⚠️ 整层的活动范围。底座原来钉死 1280×720，那会把玩家夹在地图左上角、
      // 把寻路网格切成一小块（见 `ArenaConfig.field`）。
      field: { width: map.bounds.width * scale, height: map.bounds.height * scale },
      // 墙：**画出来 + 进寻路网格**（底座画灰方块，`makeNav` 读同一份）。
      // 整层的墙全给它：网格必须铺满整层，否则远处的怪全站着不动。
      walls: map.walls.map(world),
      collision: {
        // 三张表**都换算、都不裁**：这一场没有取景框，玩家能走到任何一间去。
        // 裁的话裁掉的那些正好是还没走到的房间 —— 表现是「走到下一间，墙没了」。
        solids: col.solids.map((c) => world(c.rect)),
        bulletStoppers: col.bulletStoppers.map((c) => world(c.rect)),
        // ⚠️ 顺序必须与 `this.layout.barriers` **逐项一致**（不排序、不过滤）：
        // `setClosedAt(i, …)` 的 i 是两边共用的那把下标。见 `FlowLayout.barriers`。
        barriers: col.barriers.map((b) => world(b.rect)),
      },
      playerSpawn: this.world(this.entryPoint(map.rooms[0]!)),
      // 开局不刷怪：**怪是「进房时」按房刷的**（4.2），底座这条只吃初始刷怪。
      spawns: [],
      spawnGraceMs: ARRIVAL_GRACE_MS,
      rngSeed: 0xd2f10,
    }
  }

  /**
   * 把「一局的状态」打回开局。**必须在 `onArenaCreate` 的第一行**，见下面的 ⚠️。
   *
   * ## 为什么这件事非做不可
   *
   * `scene.restart()`（底座的 `R`、`d2_three_rooms` 的 `N`）**不会重建场子实例** ——
   * 它对这个实例再跑一遍 `preload → create`。而类字段的初始值
   * （`= []`、`= new Set()`、`= 0`）是**构造时**赋的，只跑一次。于是第二次
   * `create()` 是在**上一局的残骸上**装配：`mask` 从 4 块变成 8 块，
   * 而 `placeMask` 解构的是**头 4 块** —— 那 4 块已经被上一次 shutdown 销毁了。
   * `Rectangle.setSize` 转手去调 `this.geom.setSize`，而销毁后 `geom` 是 null：
   *
   * ```
   * TypeError: Cannot read properties of null (reading 'setSize')
   *     at Rectangle.setSize (phaser.js)
   *     at D2RoomFlowArena.placeMask (d2_room_flow.ts:264)
   *     at D2RoomFlowArena.enterRoom (d2_room_flow.ts:469)
   *     at D2RoomFlowArena.onArenaCreate (d2_room_flow.ts:167)
   *     at SceneManager2.loadComplete (phaser.js)
   * ```
   *
   * （2026-10-15 用无头 CDP 实测复现：`d2_room_flow` 按底座 `R`、`d2_three_rooms` 按
   * `N`，两条路都一样。）
   *
   * ## 为什么要写成「一处清干净」，而不是给 `mask` 加一句
   *
   * `placeMask` 里那句 `this.mask.length < 4` 本来是「还没铺」，可**第二局之后
   * 它恒不成立**（8 ≥ 4），于是守卫放行、把死对象交了出去。**数数的守卫分不清
   * 「这一局的 4 块」和「上一局的 4 块」** —— 同一句话对 `doorMarks`、`readout`
   * 也成立。所以清的地方只有一个：开局第一行，把这一局要用的东西全部归零。
   *
   * ## 为什么失败现场看起来不像「重启坏了」
   *
   * 异常是从 `create()` 里抛出去的，`create()` 就此中断。但 **场景状态已经是
   * `RUNNING`、`Game.step` 也照常跑**（这次实测：帧号在走、60fps），于是看到的是
   * **「按了 `R` 之后场子不动了」**：画面停在半装配的一间房里、读数栏是个空框、
   * 小地图没了、按键一个都不应 —— 而**控制台里那句 TypeError 是唯一的线索**。
   * 这一条不要只看一眼就过去：`d2_seed_sweep` 的文件头记着同一条路上的另一种死法
   * （异常从 `SceneManager.processQueue` 冲出、连下一帧都不再排），两者都是
   * 「`restart()` 会把装配期的异常放大成看起来不像装配问题的东西」。
   *
   * ⚠️ **跨 `restart()` 该活下来的东西不在这里**：比如 `d2_three_rooms` 的
   * 「第几张牌」是**模块级**变量（`_shared.ts` 的 `D2_SEEDS` / 各场子那份 `seedIndex`），
   * 实例字段留不住它，也不该留。
   */
  private resetRunState(): void {
    this.currentOrder = 0
    this.clearedRooms.clear() // 三个 Set 都是 `readonly` 的**引用**，`clear()` 合法
    this.spawnedRooms.clear()
    this.visitedRooms.clear()
    this.lastKillMs = 0
    this.shut = []
    // 下面这些装的是**上一局的对象**（已被 shutdown 销毁），必须丢引用而不是复用：
    // 复用死对象正是这条路径上唯一会抛异常的地方。
    this.doorMarks = []
    this.mask = []
    this.readout = []
    this.prompt = null
    this.pan = null
    this.clearRecord = null
    // `layout` 不在这里清：它是 `configure()` 每局重新赋的，而 `configure()`
    // 一定跑在 `create()` 之前（底座 `create()` 的第一句）。清成 null 反而会让
    // `onArenaCreate` 开头那个 `if (L === null) return` 悄悄吃掉整局。
  }

  protected override onArenaCreate(ctx: ArenaContext): void {
    this.resetRunState() // 第一行，理由见上 —— 在第一句**之前**，它不读任何一局的残骸
    const L = this.layout
    if (L === null) return

    // 1. 整层的底图：地板、连廊、墙、门线、门标注（`→N`）、连廊名（`连廊 a→b`）、刷怪点。
    //
    //    **复用缩略图那一份绘制**，所以这一场里的门号与缩略图、1:1 特写写着同一个数
    //    （三处共用 `presentation/framing.ts` 的推导）。盒子的算法是故意绕的：
    //    `drawFloorplan` 的 scale 是 `min(盒内宽/层宽, …)`，把盒子按 `bounds × scale`
    //    给足、padding 给成负数起点，它算出来的就是**恰好 1:1 于世界坐标**的那一份
    //    （盒内宽 = 层宽 × scale → scale 原样出来；`x = -PAD` 让落点从 0 开始）。
    //    于是它内部那个 mapper 与 `this.layout.mapper` 是同一个映射。
    drawFloorplan(ctx.scene, L.map, L.cfg, {
      x: -FLOOR_PAD,
      y: -FLOOR_PAD,
      width: L.map.bounds.width * L.scale + FLOOR_PAD * 2,
      height: L.map.bounds.height * L.scale + FLOOR_PAD * 2,
      padding: FLOOR_PAD,
      world: L.map.bounds,
      obstacles: true,
      spawns: true,
    })

    // 2. 门：**物理上全部封死**，这一场自己在 `shut` 里记「按 F 能不能过」，
    //    并画一套自己的门标记表达它（见 `sealAllDoors`）。
    this.sealAllDoors(ctx)
    this.buildDoorMarks(ctx)
    // 「这一间之外」压暗的那 4 块（见 `MASK_DEPTH`）。摆位在 `enterRoom` 里按当前房间算。
    this.buildMask(ctx)

    // 3. 门前提示：一条跟着门走的字（不是 HUD 上的条）。它说得出**去哪一间**，
    //    而那正是用户报的那个缺口「分支关的门没连上下一个主干道关」在玩法里的样子。
    this.prompt = ctx.scene.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#ffdd66',
        align: 'center',
      })
      .setOrigin(0.5, 1)
      .setDepth(20)
      .setVisible(false)

    this.buildReadout(ctx)
    this.bindKeys(ctx)

    // 4. 订阅击杀：**每次击杀重置宽限窗口**。这是 design 决策 3 的那半条
    //    （「连续 settleMs 没有击杀」才宣告清房）。
    ctx.bus.on('entity_killed', (e) => {
      if (this.pan !== null) return
      const room = this.roomAt(e.x, e.y)
      if (room !== null && room.order === this.currentOrder) this.lastKillMs = ctx.clock.nowMs
    })

    // 自检的另一半：**宣告之后还有东西出生**就是坏消息（见文件头 4.10）。
    ctx.bus.on('entity_spawned', (e) => {
      const rec = this.clearRecord
      if (rec === null || rec.afterSpawn > 0) return
      const room = this.roomAt(e.x, e.y)
      if (room !== null && room.order === rec.order) rec.afterSpawn++
    })

    // 5. 开局站在第一间，并且**立刻走一遍「进房」**：算门 + 刷怪。
    this.enterRoom(ctx, 0, null)

    ctx.hud.setNotice(
      'F 过门（站到门前才亮提示）· C 模拟清图 · V 重刷本房 · Q 收起读数 —— 门洞走不过去，门是互动点',
    )
  }

  // ------------------------------------------------------------ 门

  /**
   * **门洞永远封着**：底座那几块挡板的物理体造出来之后就一直是关的。
   *
   * ## 为什么不跟着 `shut` 开关物理体
   *
   * 底座的挡板是「开着就能走过去」——`setClosedAt(i, false)` 把物理体停用，
   * 门洞就成了一个真能穿过去的洞。这一场要的不是那个：**门是互动点**，
   * 4.6 的过门是「按键 + 镜头推移」，玩家从来不该靠自己走过去。
   * 真走过去会走到连廊上，而那时相机还锁在教室里 —— 画面上是「人不见了」。
   * 用户报的就是这一条：「现在能穿过互动点明显是不对的」。
   *
   * 所以分成两份状态：
   *
   * | 谁 | 说的是什么 | 谁读它 |
   * |---|---|---|
   * | 底座那块物理体（恒关） | 门洞**走不过去** | 玩家与怪的物理体 |
   * | `this.shut` | 站到门前按 `F` **能不能过去** | 提示、`F`、门标记的颜色、读数 |
   *
   * 顺带把怪也锁在屋里了：怪吃的是同一批静态体，以前它们能从开着的门溜到连廊上。
   *
   * ## 为什么门标记要自己画一套
   *
   * 底座的挡板可视化是**跟着物理体走的**（关 = 红块，开 = 绿框），而这里的物理体
   * 永远是关的 —— 直接用底座那套，画面上会一直是 28 块红的，看不出哪扇能过。
   * 所以这一场画自己的门标记（`buildDoorMarks`）盖在底座那套上面，
   * 深浅由 `this.shut` 决定，与提示、读数同源。
   */
  private sealAllDoors(ctx: ArenaContext): void {
    const doors = ctx.colliders.doors
    if (doors === null) return
    for (let i = 0; i < doors.count; i++) {
      doors.setClosedAt(i, true)
      this.shut[i] = true
    }
  }

  /**
   * 一扇门一块自己的标记（4.3 / 4.4 / 4.7 在画面上看到的就是它）。
   *
   * 位置尺寸取门洞那块挡板的矩形（挡板正好填住洞口），四周各放大 `DOOR_MARK_PAD`
   * —— 底座那圈 2px 的描边压在洞口边上，不放大就会露出半条红边，看起来像
   * 「门上有两种状态」，而那正是这一场最不该出现的误读。
   */
  private buildDoorMarks(ctx: ArenaContext): void {
    const L = this.layout
    if (L === null) return
    for (const b of L.barriers) {
      const r = screenRect(b.rect, L.mapper)
      this.doorMarks.push(
        ctx.scene.add
          .rectangle(
            r.x,
            r.y,
            r.width + DOOR_MARK_PAD * 2,
            r.height + DOOR_MARK_PAD * 2,
            DOOR_MARK_SHUT,
            0.5,
          )
          .setStrokeStyle(3, DOOR_MARK_SHUT, 1)
          .setDepth(DOOR_MARK_DEPTH),
      )
    }
  }

  /** 一块门标记的深浅。**只有这一处写颜色**：铺标记与每帧同步都走它。 */
  private paintDoorMark(i: number, shut: boolean): void {
    const mark = this.doorMarks[i]
    if (mark === undefined) return
    const color = shut ? DOOR_MARK_SHUT : DOOR_MARK_OPEN
    mark.setFillStyle(color, 0.5).setStrokeStyle(3, color, 1)
  }

  /** 铺那 4 块压暗用的矩形（尺寸每帧进房时才算，这里只造对象）。 */
  private buildMask(ctx: ArenaContext): void {
    for (let i = 0; i < 4; i++) {
      this.mask.push(
        ctx.scene.add
          .rectangle(0, 0, 1, 1, MASK_COLOR, MASK_ALPHA)
          .setOrigin(0, 0)
          .setDepth(MASK_DEPTH),
      )
    }
  }

  /**
   * 把 4 块摆到「当前教室本体 + 一圈留白」之外 —— 亮区就是 `roomFitSize` 的那个框，
   * 与缩放取的是**同一个框**（两处口径一致，亮区才会正好是「一屏里那一间」）。
   *
   * 上 / 下两块横着铺满整层的宽，西 / 东两块只铺亮区那一段高：这样四块互不重叠，
   * 也不会在亮区边缘留下一条缝（留缝的表现是「房间四周有一圈亮线」）。
   */
  private placeMask(): void {
    const L = this.layout
    if (L === null || this.mask.length < 4) return
    const room = L.map.rooms[this.currentOrder]!
    const m = L.cfg.wallThickness + L.cfg.navCellSize / 2
    const a = L.mapper.toScreen(left(room.rect) - m, top(room.rect) - m)
    const b = L.mapper.toScreen(right(room.rect) + m, bottom(room.rect) + m)
    const w = L.map.bounds.width * L.scale
    const h = L.map.bounds.height * L.scale
    const [up, down, west, east] = this.mask as [
      Phaser.GameObjects.Rectangle,
      Phaser.GameObjects.Rectangle,
      Phaser.GameObjects.Rectangle,
      Phaser.GameObjects.Rectangle,
    ]
    // 尺寸不许是 0 / 负数（贴边的房间会把某一块压成 0），一律夹到 ≥1
    up.setPosition(0, 0).setSize(Math.max(w, 1), Math.max(a.y, 1)).setVisible(true)
    down.setPosition(0, b.y).setSize(Math.max(w, 1), Math.max(h - b.y, 1)).setVisible(true)
    west.setPosition(0, a.y).setSize(Math.max(a.x, 1), Math.max(b.y - a.y, 1)).setVisible(true)
    east.setPosition(b.x, a.y).setSize(Math.max(w - b.x, 1), Math.max(b.y - a.y, 1)).setVisible(true)
  }

  // ------------------------------------------------------------ 每帧

  protected override onArenaUpdate(_dtMs: number, ctx: ArenaContext): void {
    const L = this.layout
    if (L === null) return

    if (this.pan !== null) {
      // 推移期间：**玩家钉在出发门内侧**（锁输入），门状态与清房判定都不动 ——
      // 动了就会在推移的半路上把身后的门锁上，而那时玩家还站在门口。
      this.holdPlayer(ctx, this.pan.hold)
      this.prompt?.setVisible(false)
      // 压暗层在推移期间收起来：这一段镜头本来就是沿连廊走的，得看得见走廊
      // （见 `MASK_DEPTH`）。落地由 `enterRoom` → `placeMask` 摆回来。
      for (const m of this.mask) m.setVisible(false)
      if (!ctx.scene.cameras.main.panEffect.isRunning) this.finishPan(ctx)
      this.drawReadout(ctx)
      return
    }

    this.lockCamera(ctx)
    this.syncDoors()
    this.checkCleared(ctx)
    this.updatePrompt(ctx)
    this.drawReadout(ctx)
  }

  /**
   * 镜头锁在当前房间：每帧把相机正中对准**这一间教室的中心**。
   *
   * 对准的是本体中心而不是取景框中心，因为缩放就是按本体（`roomFitSize`）算的 ——
   * 两者取同一个东西，教室才正好落在屏幕正中（取景框那一边**朝门外长出去一格**，
   * 拿它居中的话，教室会在屏幕上偏出去半格）。
   *
   * 「教室占满屏幕」的代价落在门外那一截：**宽的那几间**（卡着屏宽那批）整段连廊在屏幕外；
   * **窄的那几间**只露一条边 —— 那一条由压暗层（`MASK_*`）盖住，不让它读成「房间的一部分」。
   * 于是「门外通向哪一间」只剩两个出口：门标注（`→N`）与门前提示。
   */
  private lockCamera(ctx: ArenaContext): void {
    const L = this.layout
    if (L === null) return
    const c = rectCenter(L.map.rooms[this.currentOrder]!.rect)
    const p = L.mapper.toScreen(c.x, c.y)
    ctx.scene.cameras.main.centerOn(p.x, p.y)
  }

  /**
   * 把「每一扇门现在**能不能按 `F` 过去**」算出来：`this.shut` + 门标记的颜色。
   *
   * ## 判据一份都不重写
   *
   * 该不该封是 `roomFlow.ts` 的 `doorShouldBeClosed`（三条理由取或：尽头 / 落在身后 /
   * 正在战斗）。这里只提供它要的三个输入，然后**只在状态变化时**改颜色。
   * 底座的物理体不参与 —— 它恒关（`sealAllDoors`）。
   *
   * ## `ownerInCombat` 取「**正在这一间打架**」，不是「这一间还没清」
   *
   * 差别在**还没走到的房间**上：那一间没清，但也没人进去过、怪一只都没刷 ——
   * 判它「战斗中」会让全层所有未来的门一开始就是红的，而与 design 决策 1
   * （门默认可过：「没人在屋里的时候门不该封着」）直接冲突。
   * 玩家一进屋，这一间就成了 current，它的每一扇门这时才封上（4.3）。
   */
  private syncDoors(): void {
    const L = this.layout
    if (L === null) return

    for (let i = 0; i < L.barriers.length; i++) {
      const b = L.barriers[i]!
      const owner = L.map.rooms[b.ownerOrder]!
      const closed = doorShouldBeClosed({
        ownerOrder: b.ownerOrder,
        toOrder: b.toOrder,
        currentOrder: this.currentOrder,
        ownerInCombat:
          owner.order === this.currentOrder &&
          roomNeedsFight(owner, L.cfg) &&
          !this.clearedRooms.has(owner.order),
      })
      if (this.shut[i] === closed) continue
      this.shut[i] = closed
      this.paintDoorMark(i, closed)
    }
  }

  /**
   * 清房判定：判据本体（两个数到 0）+ 宽限窗口（连续 `settleMs` 没有击杀）。
   *
   * ⚠️ **两个输入都取不到「分裂延迟中」的子代**（它们在 `EnemySystem` 的私有
   * `pendingDeaths` 里）。那段时间 `存活 0 / 队列 0` 是真的，房间看起来就是空的
   * —— 宽限窗口就是为了顶住这一段。见文件头 4.10。
   *
   * 队列那个数**是全层的**（`SpawnQueue` 没有按房分）。这一场里只有当前房间会刷怪，
   * 所以它等价于本房的队列；真正需要按房分的是产品场景，那是 D3 那条查询请求。
   */
  private checkCleared(ctx: ArenaContext): void {
    const L = this.layout
    if (L === null) return
    const room = L.map.rooms[this.currentOrder]!
    if (!roomNeedsFight(room, L.cfg)) return // 非战斗房：一进场就算清（4.5）
    if (this.clearedRooms.has(room.order)) return

    const live = this.enemiesIn(room, ctx)
    const queued = ctx.enemies.spawns.length
    if (!roomCleared(live, queued)) return
    if (ctx.clock.nowMs - this.lastKillMs < L.cfg.settleMs) return

    this.clearedRooms.add(room.order)
    this.clearRecord = {
      order: room.order,
      sinceKillMs: Math.round(ctx.clock.nowMs - this.lastKillMs),
      live,
      queued,
      simulated: false,
      afterSpawn: 0,
    }
  }

  // ------------------------------------------------------------ 过门

  /** 门前提示 + `F`。提示本身也是**判据的可视化**：它亮着 = 这扇门现在真能走。 */
  private updatePrompt(ctx: ArenaContext): void {
    const hit = this.nearestPassableDoor(ctx)
    const p = this.prompt
    if (p === null) return
    if (hit === null) {
      p.setVisible(false)
      return
    }
    const L = this.layout!
    const target = L.map.rooms[hit.barrier.toOrder!]!
    const c = rectCenter(hit.barrier.rect)
    const here = rectCenter(L.map.rooms[this.currentOrder]!.rect)
    // 落在门的**里侧**（朝本房中心那一边）：这一场的相机按教室本体取景，
    // 宽的那几间（就是卡着屏宽那批，占 84%）门外整段连廊都在屏幕外；
    // 窄的那几间（占 53%）只露一条边，字挂上去会被屏边切掉半句。
    // **里侧一律安全**，而且不挡门（门是玩家正在看的那个东西）。
    //
    // ⚠️ 落点要**越过玩家站的那个位置**：站到门前时玩家正好在门内侧
    // （`innerPoint` 那条线，半个墙厚 + 一个身位），提示压在那儿会被玩家整个盖住
    // —— 看起来像「提示没出来」。所以再往里让一个身位多一点，
    // 字又朝房间里长（下面的 origin），于是玩家的方块永远在字的外面。
    const dx = Math.sign(here.x - c.x)
    const dy = Math.sign(here.y - c.y)
    const away = L.cfg.wallThickness / 2 + ctx.tune.playerRadius * 2 + 24
    const inside =
      hit.barrier.axis === 'h' ? { x: c.x, y: c.y + dy * away } : { x: c.x + dx * away, y: c.y }
    const w = L.mapper.toScreen(inside.x, inside.y)
    // **字朝房间里长**：origin 定在靠门那一边。`axis: 'h'` 且门在北墙上时，
    // 默认那个 (0.5, 1) 会把整条字画到墙外面去 —— 看起来像「提示没出来」。
    if (hit.barrier.axis === 'h') p.setOrigin(0.5, dy > 0 ? 0 : 1)
    else p.setOrigin(dx > 0 ? 0 : 1, 0.5)
    p.setText(`按 F 过门 → #${target.order} ${ROOM_KIND_LABELS[target.kind]}`)
      .setPosition(w.x, w.y)
      .setVisible(true)
  }

  /**
   * 站到门前最近的那一扇**现在可过**的门。没有就返回 `null`。
   *
   * 「可过」读的是 `this.shut`（这一场自己那份），**不是**底座的物理体状态 ——
   * 那些永远是关的（门洞走不过去），拿它判会让提示永远不亮。
   *
   * 「站在门前」的判据是**两道**：门轴方向上离门心足够近，且**沿墙方向落在门洞里**
   * （不是门框旁边的墙上）。只判前者的话，隔着墙站在隔壁门前也算数 ——
   * 而那种错**看起来像「按键没反应」**，不会有人想到是判据松了。
   */
  private nearestPassableDoor(
    ctx: ArenaContext,
  ): { barrier: DoorBarrier; index: number } | null {
    const L = this.layout
    if (L === null) return null

    const p = this.playerMap(ctx)
    const reach = L.cfg.wallThickness / 2 + ctx.tune.playerRadius + DOOR_REACH_SLACK
    let best: { barrier: DoorBarrier; index: number } | null = null
    let bestDist = Infinity

    L.barriers.forEach((b, i) => {
      if (b.toOrder === null) return // 墙外，本来就没地方可去
      if (b.toOrder === this.currentOrder) return // 通回自己？（不该有）
      if (this.shut[i] !== false) return // 封着的门过不去 —— 提示也不该亮
      const inAxis = b.axis === 'h' ? Math.abs(p.y - b.rect.y) : Math.abs(p.x - b.rect.x)
      const along = b.axis === 'h' ? Math.abs(p.x - b.rect.x) : Math.abs(p.y - b.rect.y)
      if (inAxis > reach) return
      if (along > b.rect.width / 2 + ctx.tune.playerRadius) return
      const d = inAxis * inAxis + along * along
      if (d < bestDist) {
        bestDist = d
        best = { barrier: b, index: i }
      }
    })
    return best
  }

  private tryPass(ctx: ArenaContext): void {
    if (this.pan !== null) return
    const hit = this.nearestPassableDoor(ctx)
    if (hit === null) {
      this.say(ctx, '这儿没有可过的门 —— 站到门前（字亮起来）再按 F')
      return
    }
    const L = this.layout!
    const from = L.map.rooms[this.currentOrder]!
    const to = L.map.rooms[hit.barrier.toOrder!]!
    this.pan = {
      to: to.order,
      arrive: this.innerPoint(this.arrivalDoor(to, hit.barrier), to, ctx.tune.playerRadius),
      hold: this.world(this.innerPoint(mouthOf(hit.barrier), from, ctx.tune.playerRadius)),
    }

    // 镜头沿「出发门 → 连廊 → 目标门 → 目标房」推过去。**一条直线推移就够**：
    // 门、连廊、目标门本来就落在两个房间中心的连线上（连廊是教室之间那一段），
    // 所以线性推移经过的正是那条路（design 决策 5 要的「把那段路真的走一遍」）。
    // 终点取的是**目标教室本体中心**：与 `lockCamera` 每帧摆的是同一个点，
    // 推移结束的那一刻镜头不会跳一下。
    const c = rectCenter(to.rect)
    const target = L.mapper.toScreen(c.x, c.y)
    ctx.scene.cameras.main.pan(target.x, target.y, PAN_MS, 'Sine.easeInOut')
    this.prompt?.setVisible(false)
  }

  private finishPan(ctx: ArenaContext): void {
    const p = this.pan
    this.pan = null
    if (p === null) return
    this.enterRoom(ctx, p.to, p.arrive)
  }

  /**
   * 进一间房：定进度、放玩家（如果是从门外进来的）、**非战斗房当场算清**、刷怪。
   *
   * `arrive` 为 `null` 表示开局（玩家已经在场上站好了）。门的**可过状态不在这里算**
   * —— 那由每帧的 `syncDoors()` 按 `currentOrder` 推出，一处口径。
   */
  private enterRoom(ctx: ArenaContext, order: number, arrive: Point | null): void {
    const L = this.layout
    if (L === null) return
    const room = L.map.rooms[order]!
    this.currentOrder = order
    this.visitedRooms.add(order)
    this.lastKillMs = ctx.clock.nowMs

    // 4.5：**非战斗房一进场就算清**（道具关 / 宝箱关：不刷怪、门从头到尾不关，随时能走）。
    // 写进 `clearedRooms` 而不是「每次判的时候特事特办」：这样「已清」在这一场里
    // 只有一个意思 —— **这一间不会再打了**，门该开该关、读数怎么写都读同一个集合。
    if (!roomNeedsFight(room, L.cfg)) this.clearedRooms.add(order)

    if (arrive !== null) {
      const w = this.world(arrive)
      ctx.player.gameObject.setPosition(w.x, w.y)
      ctx.player.grantGrace(ARRIVAL_GRACE_MS)
    }
    // 亮区跟着当前房间走（含「推移结束、落地」那一下 —— 压暗层就是在这里摆回来的）
    this.placeMask()
    this.spawnRoom(ctx)
  }

  /** 4.2：每个**战斗**房间出 1—2 只，出生点取自 `room.spawnPoints`；非战斗房不刷。 */
  private spawnRoom(ctx: ArenaContext): void {
    const L = this.layout
    if (L === null) return
    const room = L.map.rooms[this.currentOrder]!
    if (!roomNeedsFight(room, L.cfg)) return
    if (this.clearedRooms.has(room.order) || this.spawnedRooms.has(room.order)) return

    const n = Math.min(MAX_MOBS_PER_ROOM, room.spawnPoints.length)
    for (let i = 0; i < n; i++) {
      const p = room.spawnPoints[i]!
      const w = this.world(p)
      ctx.enemies.spawnNow(SPAWN_KIND, SPAWN_GEN, w.x, w.y)
    }
    this.spawnedRooms.add(room.order)
  }

  // ------------------------------------------------------------ 调试键

  private bindKeys(ctx: ArenaContext): void {
    const kb = ctx.scene.input.keyboard
    if (!kb) return

    // 底座的 `E`（所有门一起开关）在这一场**必须摘掉**：它开关的是**物理体**，
    // 而这一场那几块物理体是恒关的（`sealAllDoors`）—— 按 `E` 会把门洞真的开出来，
    // 那正是这一场要禁掉的东西；而且下一帧也不会被算回来（物理体不在判定里）。
    kb.off('keydown-E')

    // ⚠️ 每个键都挡 `ev.repeat`：按住不放会按系统重复率一直发 keydown，
    // 于是镜头推移被反复重启（看起来像相机在抖）。
    kb.on('keydown-F', (ev: KeyboardEvent) => {
      if (ev.repeat) return
      this.tryPass(ctx)
    })
    kb.on('keydown-C', (ev: KeyboardEvent) => {
      if (ev.repeat) return
      this.debugClear(ctx)
    })
    kb.on('keydown-V', (ev: KeyboardEvent) => {
      if (ev.repeat) return
      this.debugRespawn(ctx)
    })
    kb.on('keydown-Q', (ev: KeyboardEvent) => {
      if (ev.repeat) return
      for (const o of this.readout) o.setVisible(!o.visible)
    })
  }

  /**
   * `C`：模拟清图（4.8）—— 把这一间标记为已清，门随之打开。
   *
   * **不杀怪**（杀是底座 `0` 的事）：那些怪还在屋里，「已清」只是把它当成打完了。
   * 于是「清掉标记但还留着怪」这种自相矛盾的状态**看得见**（读数会直说还剩几只），
   * 而不是被按键悄悄抹平。
   */
  private debugClear(ctx: ArenaContext): void {
    const L = this.layout
    if (L === null || this.pan !== null) return
    const room = L.map.rooms[this.currentOrder]!
    if (this.clearedRooms.has(room.order)) {
      this.say(ctx, `#${room.order} 已经是清的了（V 重刷）`)
      return
    }
    const live = this.enemiesIn(room, ctx)
    this.clearedRooms.add(room.order)
    this.clearRecord = {
      order: room.order,
      sinceKillMs: Math.round(ctx.clock.nowMs - this.lastKillMs),
      live,
      queued: ctx.enemies.spawns.length,
      simulated: true,
      afterSpawn: 0,
    }
    this.say(
      ctx,
      live > 0
        ? `C：把 #${room.order} 当成已清（房里还剩 ${live} 只没打 —— 读数里也这么写）`
        : `C：把 #${room.order} 当成已清 —— 这一间的门现在可过了（按 F 走）`,
    )
  }

  /** `V`：把本房打回「还没打」——撤掉已清标记、把怪刷回来。用来重复看清房那一下。 */
  private debugRespawn(ctx: ArenaContext): void {
    const L = this.layout
    if (L === null || this.pan !== null) return
    const room = L.map.rooms[this.currentOrder]!
    // 非战斗房**没有「还没打」这个状态**（一进场就算清，见 `enterRoom`），
    // 所以 `V` 在这一类房间里什么都不该做 —— 不然它会把「不用打」的标记撤掉，
    // 而那会让门在下一帧又被算回来，看起来像「V 把门锁上了」。
    if (!roomNeedsFight(room, L.cfg)) {
      this.say(ctx, `V：#${room.order} 是非战斗房（${ROOM_KIND_LABELS[room.kind]}），没有怪可刷`)
      return
    }
    this.clearedRooms.delete(room.order)
    this.spawnedRooms.delete(room.order)
    this.clearRecord = null
    this.lastKillMs = ctx.clock.nowMs
    this.spawnRoom(ctx)
    this.say(ctx, `V：#${room.order} 重刷（门随之封上 —— 打到空才再放行）`)
  }

  // ------------------------------------------------------------ 读数

  private buildReadout(ctx: ArenaContext): void {
    // 落点跟着当场那块画布（见 `READOUT_WIDTH` 上面的 ⚠️）；`drawReadout` 每帧摆一次。
    const x = ctx.scene.scale.width - READOUT_WIDTH
    const bg = ctx.scene.add
      .rectangle(x, 0, READOUT_WIDTH, READOUT_LINE, 0x000000, 0.55)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0x445566, 0.9)
      .setScrollFactor(0)
      .setDepth(40)
    const text = ctx.scene.add
      .text(x + 8, 0, '', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#c8d4e0',
        lineSpacing: 4,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(41)
    this.readout = [bg, text]
  }

  /**
   * 自检读数（4.9）。**每一行都是一个能证伪的句子**，不是装饰：
   *
   * | 行 | 说得出什么 |
   * |---|---|
   * | 当前房 | 判定用的 `currentOrder` 和外面对不对（`→N` 标注是同一个号） |
   * | 本房剩 | 判据的两个输入（存活 / 队列）**分开印**——只看存活会漏掉没出生的 |
   * | 静默 | 宽限窗口走到哪儿了。差一点点就能开的那一瞬，这里看得见 |
   * | 门 | 本房几扇**可过**（进房封门 / 清完放行，一栏就能核） |
   * | 走过 | 4.9 要的那个数 |
   * | 清房 | 4.10 的证据：宣告距最后一杀多久、宣告之后有没有东西迟到 |
   *
   * ⚠️ 行宽预算 **21 个全角**（见 `READOUT_X`）。加词之前先数字符。
   */
  private drawReadout(ctx: ArenaContext): void {
    const L = this.layout
    if (L === null || this.readout.length === 0) return
    const [bg, text] = this.readout as [
      Phaser.GameObjects.Rectangle,
      Phaser.GameObjects.Text,
    ]

    const room = L.map.rooms[this.currentOrder]!
    const live = this.enemiesIn(room, ctx)
    const queued = ctx.enemies.spawns.length
    const fights = roomNeedsFight(room, L.cfg)
    const waiting = fights && !this.clearedRooms.has(room.order)
    const silence = Math.max(0, Math.round(ctx.clock.nowMs - this.lastKillMs))

    const mine = L.byRoom.get(room.order) ?? []
    // 印「可过」而不是「关」：门洞**永远**走不过去（`sealAllDoors`），
    // 「关」这个字在这一场里会读成物理上的封 —— 而这里量的是**按 F 能不能走**。
    const open = mine.filter((i) => this.shut[i] === false).length
    const openAll = this.shut.filter((s) => s === false).length

    // 「已清」与「不用打」**分开写**：前者是打完了，后者是本来就没有要打的
    // （`enterRoom` 把非战斗房也记进了已清集合，两者在数据上是一回事）。
    const done = !fights ? '（不用打）' : this.clearedRooms.has(room.order) ? '（已清）' : ''

    const lines = [
      `种子 ${L.map.seed} · ${L.map.rooms.length} 间 · 缩放 ${L.scale.toFixed(2)}`,
      `当前 #${room.order} ${room.branch === 'side' ? '侧室' : '主干'}·${
        ROOM_KIND_LABELS[room.kind]
      }${done}`,
      waiting
        ? `本房剩 ${live + queued} 只（存活 ${live} · 队列 ${queued}）`
        : `本房剩 ${live} 只${fights ? ' · 已清' : ' · 这一间不用打'}`,
      waiting
        ? `静默 ${silence}/${L.cfg.settleMs}ms ${silence >= L.cfg.settleMs ? '（够久，可清）' : '（还差）'}`
        : `宽限 ${L.cfg.settleMs}ms`,
      `门 本房可过 ${open}/${mine.length} · 全层 ${openAll}/${L.barriers.length}`,
      `走过 ${this.visitedRooms.size}/${L.map.rooms.length} 间`,
      this.clearLine(),
      ...this.extraReadoutLines(),
      this.keyHints(),
    ]

    text.setText(lines.join('\n'))
    const h = lines.length * READOUT_LINE + 8
    // 右下角：x 与 y 都取当场那块画布（见 `READOUT_WIDTH` 上面的 ⚠️）。
    const x = ctx.scene.scale.width - READOUT_WIDTH
    const y = ctx.scene.scale.height - 8 - h
    bg.setPosition(x, y).setSize(READOUT_WIDTH, h)
    text.setPosition(x + 8, y + 4)
  }

  /**
   * 最后一行：这一场认的键。**子类加了键就得覆盖它** —— 键不在读数里，
   * 就等于没有那个键（看场子的人不会去翻代码）。
   *
   * ⚠️ 行宽预算 **21 个全角**（见上面那张表），加词之前先数字符。
   */
  protected keyHints(): string {
    return 'F 过门 · C 清图 · V 重刷 · Q 收起'
  }

  /** 子类自己那几行读数，插在「清房记录」和按键之间。默认没有。 */
  protected extraReadoutLines(): string[] {
    return []
  }

  /** 4.10 那一行：清房记录。**没有记录时也说话**，免得「没印出来」和「没发生过」分不清。 */
  private clearLine(): string {
    const r = this.clearRecord
    if (r === null) return '清房记录：这一局还没有'
    const head = `清 #${r.order}${r.simulated ? '（C）' : ''}：杀后 ${r.sinceKillMs}ms`
    return r.afterSpawn > 0
      ? `⚠️ 清完又冒出来 ${r.afterSpawn} 只（窗口没兜住）`
      : `${head} 宣告（存活 ${r.live} 队列 ${r.queued}）`
  }

  // ------------------------------------------------------------ 小工具

  /**
   * 玩家该从哪儿进场：**这一间里离房间中心最近的那个刷怪点**。
   *
   * 刷怪点的「站得住」是生成器**构造**出来的（房间内部 + 从门可达 + 网格上不堵），
   * 这里不重算一遍（理由见 `_shared.nearestSpawn`）。
   * 非战斗房没有刷怪点，回落到房间中心 —— 那一类房间**一张桌椅都没有**
   * （`combatKinds` 同时决定三件事），所以中心是空的，不是碰运气。
   */
  private entryPoint(room: Room): Point {
    return nearestSpawn(room) ?? rectCenter(room.rect)
  }

  /**
   * 过门之后站在哪儿：**目标房里离刚穿过那扇门最近的那一扇门的里侧**。
   *
   * 为什么是「最近的那一扇」而不是「`toOrder` 等于来路的那一扇」：一个门洞在数据里
   * 记了两次、还可能记在**另一间**名下（`colliders.ts` 文件头那条 ⚠️），
   * 而侧室那条路上来路是 `#3`、目标房 `#5` 的门却写着 `toOrder = 3`
   * —— 按号找会**找不到**，而找不到时兜一个「房间中心」会把玩家送进桌子里。
   * 按几何找没有这些特例：那扇门物理上就在来路对面。
   */
  private arrivalDoor(to: Room, used: DoorBarrier): DoorMouth {
    const c = rectCenter(used.rect)
    let best: DoorMouth | null = null
    let bestDist = Infinity
    for (const d of to.doors) {
      const dist = (d.x - c.x) ** 2 + (d.y - c.y) ** 2
      if (dist < bestDist) {
        bestDist = dist
        best = d
      }
    }
    // 兜底用刚穿过的那一扇：`arrivalDoor` 找不到只可能是因为 `to.doors` 是空的
    // （不该发生），而那时退回门心仍然比「房间中心」安全 —— 见上面那一段。
    return best ?? { x: used.rect.x, y: used.rect.y, axis: used.axis }
  }

  /** 门洞**内侧**那一点：从门心朝房间中心挪半个墙厚 + 一个身位。 */
  private innerPoint(door: DoorMouth, room: Room, radius: number): Point {
    const cfg = this.layout!.cfg
    const d = cfg.wallThickness / 2 + radius + 6
    const c = rectCenter(room.rect)
    if (door.axis === 'h') {
      return { x: door.x, y: door.y + (c.y > door.y ? d : -d) }
    }
    return { x: door.x + (c.x > door.x ? d : -d), y: door.y }
  }

  /** 世界坐标上的点落在哪一间房里（数「本房剩几只」、认击杀发生在哪一间都走它）。 */
  private roomAt(wx: number, wy: number): Room | null {
    const L = this.layout
    if (L === null) return null
    const p = this.toMap(wx, wy)
    for (const room of L.map.rooms) if (containsPoint(room.rect, p.x, p.y)) return room
    return null
  }

  /** 本房还活着的怪。**按位置数**，不按「刷过几只 − 死了几只」——后者在分裂怪上必然对不上。 */
  private enemiesIn(room: Room, ctx: ArenaContext): number {
    const L = this.layout
    if (L === null) return 0
    let n = 0
    for (const e of ctx.enemies.liveEnemies) {
      const p = this.toMap(e.view.x, e.view.y)
      if (containsPoint(room.rect, p.x, p.y)) n++
    }
    return n
  }

  /** 世界坐标 → 地图坐标。`mapperFor` 没有逆变换，而这一场的映射是**等比缩放 + 原点平移**。 */
  protected toMap(wx: number, wy: number): Point {
    const L = this.layout!
    return { x: wx / L.scale + left(L.map.bounds), y: wy / L.scale + top(L.map.bounds) }
  }

  protected playerMap(ctx: ArenaContext): Point {
    return this.toMap(ctx.player.x, ctx.player.y)
  }

  private world(p: Point): Point {
    return this.layout!.mapper.toScreen(p.x, p.y)
  }

  /** 推移期间把玩家钉住（锁输入）：位置和速度**都要**压。 */
  private holdPlayer(ctx: ArenaContext, at: Point): void {
    const sprite = ctx.player.gameObject
    sprite.setPosition(at.x, at.y)
    ;(sprite.body as Phaser.Physics.Arcade.Body | null)?.setVelocity(0, 0)
  }

  private say(ctx: ArenaContext, text: string): void {
    ctx.hud.setNotice(text)
  }
}

/**
 * 目录读的就是这个（`registry.ts` 用 `import.meta.glob` 自动收，文件名就是 `?arena=` 的值）。
 * **类本身不要 export** —— 见 `_ArenaTemplate.ts`：目录只认这个常量。
 */
export const arena: ArenaDefinition = {
  displayName: 'D2 房间转接（整层）',
  description:
    '整层可玩：一间教室一屏 · 门是互动点 · 进房封门 / 清完放行 / F 过门 / 不回头。C 模拟清图、V 重刷本房',
  scene: D2RoomFlowArena,
}