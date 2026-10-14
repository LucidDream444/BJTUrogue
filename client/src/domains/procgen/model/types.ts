/**
 * 地牢地图的数据模型。**这是 C2 契约的一部分** —— D1（战斗场景）与 D3（敌人寻路）
 * 直接读这个文件，字段的增删改要走 C2 变更流程（主责方改契约 → 通知消费方 →
 * 消费方确认后才可合并）。
 *
 * **纯数据，零 Phaser 依赖。** `vite.config.ts` 把单测环境钉死在 `node`，
 * 这个目录里的任何东西都不许 import 引擎。
 *
 * ---
 *
 * ## 位置与内容正交：`branch` 与 `kind`
 *
 * 两个字段回答两个不同的问题，**不要合并成一个**：
 *
 * | 字段 | 回答 | 取值 |
 * |---|---|---|
 * | `branch` | 在**主干上还是侧室** | `'main'` / `'side'` |
 * | `kind` | 里面**装的是什么** | 8 类内容类型 |
 *
 * 早先的设计想让 `kind` 一个字段干完，把"侧室"当成一个类型值。撞墙的地方是：
 * 内容类型是 **8 类**（枚举一次定完，见下），塞不下第 9 个位置值；而且塞进去了之后
 * **「侧室里装的是什么」就无处表达** —— 而迭代 2 要的恰恰是「侧室是精英房 / 奖励房」。
 *
 * 同理**没有** `mandatory: boolean`：那是 `branch === 'main'` 的派生重复。
 * `branch` 是原生事实（门接在哪、怪在哪刷都读它），"必须清图"是结论。
 *
 * ## 坐标：矩形用**中心点**，与测试场的 `WallSpec` 一致
 *
 * `Rect` 的 `x` / `y` 是**中心**，不是左上角。理由只有一个但足够：
 * `ArenaBase.configure()` 收的 `WallSpec` 就是这个约定，D2 生成器吐出的矩形
 * 要能直接喂进去。角落里再挂 `left` / `right` / `top` / `bottom` 四个取数器，
 * 免得每个消费方自己写一遍 `x - width / 2`（写漏一次就是半个身位的错位）。
 */

// ---------------------------------------------------------------- 房间

/**
 * 房间的**内容类型**。8 类一次定义完整，即使本期只产出其中六类。
 *
 * **加枚举值比加字段便宜得多**：枚举先定完，「房间类型扩充」才能只改配置
 * 不改代码。校验器接受全部 8 类，生成器本期只产出 `ROOM_KINDS_EMITTED` 那几个。
 *
 * ⚠️ 注意 `'side'` **不在**这张表里 —— 侧室是位置，不是内容，见 `RoomBranch`。
 *
 * ⚠️ `'chest'` 是**第 8 类，后来加的**（见 `openspec/changes/room-kinds-and-furniture`）：
 * 宝箱关要在地图上**标出来**，而 `'hidden'`（隐藏房）恰恰是不该标的那一类 ——
 * 两者共用一类就等于要么把隐藏房画在地图上、要么让宝箱关藏起来。
 */
export type RoomKind =
  | 'start'
  | 'main'
  | 'elite'
  | 'reward'
  | 'shop'
  | 'boss'
  | 'hidden'
  | 'chest'

/** 合法的 `RoomKind` 全集。校验器与测试场都读它，不要在别处再抄一份。 */
export const ROOM_KINDS: readonly RoomKind[] = [
  'start',
  'main',
  'elite',
  'reward',
  'shop',
  'boss',
  'hidden',
  'chest',
]

/** 本期生成器**实际产出**的类型。`shop` / `hidden` 留给迭代 2，校验器照样接受。 */
export const ROOM_KINDS_EMITTED: readonly RoomKind[] = [
  'start',
  'main',
  'elite',
  'reward',
  'chest',
  'boss',
]

/**
 * 关别的**中文名**。缩略图标签、场子读数、将来的 HUD 都读这一张表。
 *
 * **为什么这张表在 `model` 而不是 `presentation`：** 它是纯数据（零 Phaser 依赖，
 * node 下可单测），而且 D1 的 HUD 也要读同一份。三个显示处各写一遍中文名
 * 就是三份会漂移的事实，而漂移的表现是「同一个关别在两块画面上写着两个词」。
 *
 * `Record<RoomKind, string>` 而不是 `Partial<...>`：**加枚举值忘了加名字**
 * 是这类改动最常见的漏，而它在画面上只表现为空白或原值、不报错 ——
 * 用 `Record` 让它在 `tsc` 那一步就红。
 */
export const ROOM_KIND_LABELS: Record<RoomKind, string> = {
  start: '起点',
  main: '普通战',
  elite: '精英',
  reward: '道具关',
  shop: '商店',
  boss: '首领',
  hidden: '隐藏房',
  chest: '宝箱关',
}

/**
 * 房间在**进度结构**上的位置。
 *
 * - `'main'`：主干教室，必经。玩家 MUST 清掉它才能继续（门锁逻辑归 D1）。
 * - `'side'`：侧室，可选。入口来自它所属的主干教室，出口汇回**主干道的下一间**，
 *   所以进不进它都不改变必经路径的终点。
 */
export type RoomBranch = 'main' | 'side'

/** 门的朝向。决定了「谁接谁」以及玩家进门时的行进方向。 */
export type DoorKind =
  /** 回上一间。**在「不回头」规则下，玩家一离开它就永久关闭** */
  | 'back'
  /** 通下一间主干教室 */
  | 'forward'
  /** 通侧室（开在主干教室上）或从侧室汇回主干（开在侧室上） */
  | 'side'

// ---------------------------------------------------------------- 几何

/**
 * 轴对齐矩形。**`x` / `y` 是中心点**，与 `ArenaBase` 的 `WallSpec` 一致。
 *
 * 中心点约定不是随便选的：`ArenaBase.makeNav()` 与 `isWalkable()` 用的都是
 * 「格子中心点落在矩形里才算堵」，两处若各用各的原点约定，症状是
 * 「看着能过的门口过不去」，而且**只在有墙的场子里出现**。
 */
export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface Point {
  readonly x: number
  readonly y: number
}

// ---------------------------------------------------------------- 障碍物

/**
 * 室内障碍物的种类。**它决定的是「挡不挡子弹」，不是「挡不挡路」** ——
 * 两种在寻路网格上完全一样（都不可走），差异只在子弹碰撞上。
 *
 * D1 依据 `kind` 决定把它放进哪个碰撞分组。生成侧只需要把种类写对。
 */
export type ObstacleKind =
  /** 课桌。挡路 + **挡子弹** */
  | 'desk'
  /** 椅子。挡路 + **不挡子弹**（子弹穿过去继续飞） */
  | 'chair'

/**
 * 室内障碍物。玩家与怪物 MUST NOT 能穿过它。
 *
 * 尺寸契约（见 `docs/地牢生成设计.md`）：课桌**宽度固定 1 格**、长度取整数格、
 * **只横竖**、按格对齐；椅子恒为 1 格。**"可视 = 可走性"** —— 一张看着能挤过去的缝，
 * 寻路也必须认为能过去。按格对齐正是为了消掉「看着能过、实际整格封死」的错位。
 */
export interface Obstacle {
  readonly kind: ObstacleKind
  readonly rect: Rect
}

// ---------------------------------------------------------------- 门

/**
 * 一扇门 —— 也就是墙上的一段**缺口**。
 *
 * 门段本身**不是障碍物**：它表达的是"这里可以出去"。战斗期间关门是 D1 的场景逻辑
 * （把缺口填上一块可碰撞的矩形），D2 只负责把门的位置和朝向写对。
 */
export interface Door {
  readonly kind: DoorKind
  /** 门洞段的中心 */
  readonly x: number
  readonly y: number
  /** 门洞的宽度（沿着墙的方向量） */
  readonly width: number
  /**
   * 门开在哪一堵墙上，也就是玩家**穿过它的方向**：
   *
   * - `'h'`：开在一堵水平墙上 → 人沿 **y** 方向穿过
   * - `'v'`：开在一堵竖直墙上 → 人沿 **x** 方向穿过
   */
  readonly axis: 'h' | 'v'
  /** 穿过去到哪个 `order` 的房间。`null` = 墙外（尽头） */
  readonly toOrder: number | null
}

// ---------------------------------------------------------------- 房间

/**
 * 一间教室。
 *
 * `order` 是**进度轴的唯一顺序来源**。「不回头」这条规则的全部代价与红利都建立在它上面：
 * 进度可以用一个整数表达、每间教室的寻路网格建一次即可、小地图的「已探索」是
 * 「走过的集合」而不是由进度推断。**没有第二处能表达顺序的字段。**
 */
export interface Room {
  /** 进度轴上的位置，从 0 开始，连续无洞。`start` 恒为 0，`boss` 恒为最大 */
  readonly order: number
  readonly kind: RoomKind
  readonly branch: RoomBranch
  readonly rect: Rect
  /**
   * 房间用了几号尺寸档位。**索引到哪张表由 `branch` 决定**：
   *
   * - `'main'` → `rooms.json` 的 `mainWidthTiers`（主干教室只按**宽度**分档，
   *   高度统一是 `mainRoomHeight`，理由见 `config.ts`）
   * - `'side'` → `rooms.json` 的 `sideRoomTiers`（宽高两维）
   *
   * 两张表而不是一张：主干教室的高度不是自由的（要与连廊等高），
   * 塞进同一张表就得靠校验去拒绝一半的档位 —— 那是把"不可能"写成"不许"。
   */
  readonly sizeTier: number
  readonly doors: readonly Door[]
  readonly obstacles: readonly Obstacle[]
  /** 刷怪点。**每一个都从门可达** —— 这是由构造保证的，见 design D5 */
  readonly spawnPoints: readonly Point[]
  /**
   * 威胁预算。**与难度档位无关**；难度只乘在「预算 → 具体刷怪」那一步。
   *
   * **非战斗关别恒为 `0`** —— 一个空场地写着一份威胁预算就是数据在说谎。
   * 哪几类关别要打由配置表的 `combatKinds` 决定（`isCombatKind()`）。
   */
  readonly budget: number
  /**
   * 侧室挂在主干第几间上（`order` 值）。主干房间为 `null`。
   *
   * 有它才封得住「侧室的入口与出口接对」这条不变量：入口来自 `anchoredTo` 那一间，
   * 出口汇回主干道的**下一间**。少了这个字段，侧室的归属就只能靠坐标猜。
   */
  readonly anchoredTo: number | null
}

// ---------------------------------------------------------------- 地图

/**
 * `DungeonMap.schemaVersion` 当前值。**改字段语义时加一**（红线 3）。
 *
 * - `1`：首版。主干道是一条贯穿全层的 `corridorRect`，主干教室南北交替挂在它两侧。
 * - `2`：平面结构返工成「**一排主干教室 + 连廊**」—— `corridorRect` 换成 `passages`。
 *   见 `openspec/changes/rework-layout-to-classroom-row`。
 * - `3`：**侧室的 `kind` 说真话** —— 由一律 `'main'` 改为按关别抽（精英 / 道具 / 宝箱），
 *   非战斗关别不摆桌椅、不刷怪、预算为 0；`RoomKind` 增第 8 类 `'chest'`。
 *   见 `openspec/changes/room-kinds-and-furniture`。
 *   **这是语义变化而不是新增字段**：同一份 15 间房的地图，v2 里侧室恒为 `main`
 *   （「要清图」），v3 里是一组取值之一 —— 按 v2 的理解去读 v3 的数据会得到错的答案。
 */
export const DUNGEON_SCHEMA_VERSION = 3

/**
 * 一段连廊 —— 相邻两间主干教室之间的连接。
 *
 * **`rect` 是含墙的**（与首版的 `corridorRect` 同约定）：可走的是里面那一条，
 * 宽 `mainRoomHeight` 减去上下各一层墙厚。拿它当可走区域会多算两格 ——
 * 而多出来的正好是**墙本身**，墙在寻路里是不可走的，两者混起来会让 D3
 * 得到一张「墙内可走」的网格，且**不报任何错**。
 *
 * `between` 是它连接的两间主干教室的 `order`（升序）。**有它，D1 的封门与
 * 「不回头」逻辑就不必靠坐标去猜这一段接的是谁** —— 猜错的症状是
 * 「门锁了，但不是该锁的那扇」，而那和「锁对了」长得一模一样。
 */
export interface Passage {
  readonly rect: Rect
  readonly between: readonly [number, number]
}

/**
 * 一层楼。**生成器的产物、D1 战斗场景的输入、D2 校验器的输入，同一个形状。**
 */
export interface DungeonMap {
  /** 本地存档/数据迁移用（红线 3）。缺了校验器直接报错 */
  readonly schemaVersion: number
  readonly seed: number
  /** 整层的包围盒。缩略图与相机的取景依据 */
  readonly bounds: Rect
  /**
   * **主干教室之间的那一段段连廊**，按 x 从左到右。
   *
   * 有几间主干教室就有几段（`N − 1` 段）—— 连廊是**教室之间**的连接，
   * 不是一个与教室并列、贯穿全层的空间。首版把它做成了后者（一条
   * `corridorRect`），平面结构因此不是需求要的「一排主干教室」。
   *
   * 连廊**不是 `Room`**：不计入房间总数、没有 `order`、没有预算、不刷怪、
   * 不参与清房判定。玩家在连廊里永远处于脱离战斗的状态。
   */
  readonly passages: readonly Passage[]
  /**
   * **每一段墙**。房间的四条边减去门洞、走廊两端的封口、以及侧室门厅的封口，全在这里。
   *
   * 为什么墙是数据而不是让两边各自从 `rooms` 推导：
   *
   * - D1 要它建物理碰撞体（玩家撞墙、子弹被墙吃掉）
   * - D2/D3 的寻路要它判可走性
   *
   * 两处各推导一次，就是那句「同一个事实写两遍，迟早不一致」——
   * 而这里的表现恰好又是**没有任何报错**的那种：一边推出来的墙少一段，
   * 玩家从缝里走出去了，或者怪卡在一个看不见的角里。
   *
   * 顺带解决一件具体的事：侧室的门厅（它与宿主教室之间那条缝）必须**在朝走廊的
   * 那一侧封口**，否则玩家可以绕过宿主教室直接从走廊钻进侧室 ——
   * 「入口来自宿主」就成了摆设。那段封口不属于任何一间房的边界，
   * 不给它一个位置就没法表达。
   */
  readonly walls: readonly Rect[]
  /** 全部房间。**按 `order` 升序** —— 顺序就是进度 */
  readonly rooms: readonly Room[]
  /**
   * 寻路网格的格边长（px）。**放进地图数据，不是各场景各选一个。**
   *
   * 这是 D2 最在意的一个字段。校验器与运行时 MUST 用同一份可走性判定，
   * 而"同一份判定"最容易被破坏的方式就是两边用了不同的 `cellSize` ——
   * 那时 1000 个种子全绿、运行时某个刷怪点被封死，**两边都不抛异常**，
   * 症状是"怪不出来、房间清不掉"，而「不回头」规则下这一局直接作废。
   * 写进数据里，两侧就物理上不可能各选一个值。
   */
  readonly navCellSize: number
  /** 寻路网格的**最小角**（不是格子中心偏移，见 `ArenaBase.makeNav` 的 ⚠️） */
  readonly navOrigin: Point
  /** 这次生成花了多少毫秒。**仅供观测**，不参与任何判定 */
  readonly elapsedMs: number
}

// ---------------------------------------------------------------- 取数器

/** 主干教室，按 `order` 升序。 */
export function mainRooms(map: DungeonMap): readonly Room[] {
  return map.rooms.filter((r) => r.branch === 'main')
}

/** 侧室，按 `order` 升序。 */
export function sideRooms(map: DungeonMap): readonly Room[] {
  return map.rooms.filter((r) => r.branch === 'side')
}

/**
 * 按 `order` 取房间。
 *
 * 抛而不是返回 `undefined`：`order` 是连续无洞的（校验器保证），取不到就说明
 * **地图数据本身坏了**，静默返回 `undefined` 只会把错误推迟到某个 `?.` 吞掉的地方。
 */
export function roomByOrder(map: DungeonMap, order: number): Room {
  const room = map.rooms[order]
  if (!room || room.order !== order) {
    throw new Error(`地图里没有 order=${order} 的房间（共 ${map.rooms.length} 间）`)
  }
  return room
}