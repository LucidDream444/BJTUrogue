/**
 * **D1 的战斗 × D2 的地图** —— 跨域联调场。三间教室，一间一屏，走的是**两边的真代码**。
 *
 * | 这一场里的东西 | 谁写的 | 从哪来 |
 * |---|---|---|
 * | 玩家、射击、伤害、掉落、暂停 | **D1** | `CombatSession` + `StatusHud` + `LoadoutHud` |
 * | 三选一强化 | **D1** | `RewardPanel`（订阅 `reward_offered`，不认这一场） |
 * | 关别 / 转接 / 门 / 种子 | **D2** | `generateDungeon` + `collidersOf` + `roomFlow` |
 * | 教室长什么样 | **D2** | `_classroomLook.ts`（与 `d2_classroom` 同一套画法） |
 * | 教室长什么样（第二档） | **D1** | `_d1Scenes.ts` —— **整间教室**都是 D1 手绘关里那张画 |
 *
 * 一句话：**D2 交几何，D1 在里面打。** 这一场是那份交接的现场 ——
 * 别的地方要么只有 D2 的白箱（`d2_room_flow`），要么只有 D1 的手绘图（`d1_battle`）。
 *
 * ---
 *
 * ## 它验的是「交接坏了会不会看得出来」
 *
 * 跨域接错的表现**全是「没有报错」**：几何差半个身位、门的挡板少一块、
 * 出生点落在墙里、怪的寻路网格与墙不是一个口径 —— 每一样都是画面照常、控制台干净。
 * 所以这一场把三样东西摆在一起让人**对着看**：
 *
 * | 看 | 对着什么看 |
 * |---|---|
 * | `B` 碰撞箱 | D1 从 D2 的几何里**造出来的**那些块（读 `stageGeometry`，不是读我们喂进去的） |
 * | 门上的红绿刻度 | D2 的 `doorShouldBeClosed()` —— 世界里的颜色与小地图上的颜色**同源** |
 * | 读数里的「反算自检」 | 「世界 → 地图」那把尺子与 D1 的 `stageGeometry` 是不是同一把 |
 *
 * ## 一条最容易接错的线：**两套坐标系**
 *
 * D1 的 `StageCollisionConfig` 是**左上角原点、盒子坐标**（它自己那张 2048×1152 的手绘图
 * 就是这么标的）；D2 的 `Rect` 是**中心点、地图坐标**（`model/types.ts` 文件头）。
 * 这一场里两套**同时存在**，各走各的路：
 *
 * - **碰撞**：地图坐标 → 裁进本间的取景框 → 平移到盒子左上角 → 喂 `CombatSession`
 * - **观感 / 小地图 / 门标记**：全程地图坐标，换算交给 `mapperFor()`（不许再写第二遍平移公式）
 *
 * 两套之间只有一处桥：`toWorld()` / `toMap()`（下面那一对，互为逆运算），
 * 而它俩**有一个当场对账**（`create()` 里的反算自检）——
 * 写反了不会报错，只会让「人画在这儿、撞在别处」，而那看起来像生成器歪了。
 *
 * ## 门：**洞是封死的，过门是 `F`**
 *
 * D2 的门洞是墙上一段缺口（`Door`），D1 的 `TerrainMap` 拿这份几何建**寻路网格**
 * —— 洞不封上，怪就会顺着洞走进连廊、走进黑边里，而「本房间敌人全部死亡」
 * 这个判据（清房、进而 `room_cleared`、进而三选一）当场作废。
 *
 * 所以这一场把门洞**填成实体**（D2 已经算好了那块矩形：`collidersOf().barriers`），
 * 门的**开关状态**改用 `F` 键表达：站在门口按键 → `enterStage(下一间)`。
 * 状态本身照 D2 的规则算（`doorShouldBeClosed`：尽头 / 落在身后 / 还在战斗），
 * 世界里的刻度与小地图上的颜色都读它**同一个返回值**。
 *
 * ## 它**不**做的事（别在这里找）
 *
 * - 不画 D1 的手绘三层图**当几何**：房间的墙 / 门 / 桌椅一律是 D2 的矩形，
 *   D1 那三张图只以**贴图**的身份出场（`L` 第二档，见下）
 * - 不刷首领、不开宝箱（`spawnBoss` / `FirstBossLoot` 归 `d1_battle`）
 * - 不做连廊里的走位：过门是**换一间**（`enterStage`），不是走过去
 * - `stage-collisions.json` 里的 `solids` / `playerSpawn` **一个都不用**：
 *   这一场的几何全部来自 D2。读它只为那三张图的 `furniture`（桌椅贴图的框与轮廓）
 *   和 `sourceSize`（贴图坐标的空间）—— 见 `_d1Scenes.ts`
 *
 * ## 三档观感（`L` 键），第二档是多出来的那一档
 *
 * | 档 | 是什么 | 谁画的 |
 * |---|---|---|
 * | 白箱 | 什么都不画，只剩 D1 的实体与 HUD | —— |
 * | D2 观感 | 地砖、色块桌椅、墙、门、黑板 | `_classroomLook.ts`（`layers: 'full'`） |
 * | **D1 场景** | **整间教室都是 D1 手绘关里那张画**：墙、黑板、窗、地毯、阳光、桌椅 | `_d1Scenes.ts`，加 `_classroomLook.ts` 的 `layers: 'doors'` 画门 |
 *
 * 第二档里**只剩门是 D2 画的**（`layers: 'doors'`）—— 门开在哪、开着还是关着，
 * 是这一场要看的东西（D2 的转接），而且 D2 的门洞会把画上去的那片墙盖掉，
 * 正好在 D1 的墙皮上开出一个洞。少了它，「门在哪儿」就没了参照，
 * 而那正是这一场最不该有的错觉。桌椅的**位置**也仍旧读 D2 的矩形
 * （两套几何的交接点），只是**样子**换成了 D1 画的那张桌椅（见 `_d1Scenes.ts`）。
 *
 * ## 键
 *
 * | 键 | 干什么 |
 * |---|---|
 * | `WASD` / 鼠标 | 走 / 瞄 + 开火（D1 的 `Player` 自己有） |
 * | `C` | 模拟清图（`enemies.simulateClear()`，等分裂链回收） |
 * | `F` | 过门：站在**没关**的门前按它 → 进那一间 |
 * | `N` | 换种子（六张牌循环，走 `scene.restart()`） |
 * | `B` | 碰撞箱：D1 造出来的碰撞体 + 它的寻路网格 |
 * | `L` | 观感三档循环：**D2 观感 → D1 场景 → 白箱**（见上表） |
 * | `M` | 小地图开关 |
 * | `1` / `2` / `Q` | 武器槽 / 换武器（三选一的奖励会进包） |
 * | `SPACE` | 暂停 · `R` 重开本局（同一颗种子） |
 *
 * ⚠️ 三选一面板弹出时，`1`/`2`/`3` 归面板（它在 document 上抢了捕获），
 * 所以那三个键在这时候不会漏到武器槽上 —— 这是 `RewardPanel` 自己的设计，不用这里配合。
 *
 * ## ⚠️ `R` / `N` 为什么**先拆 session 再 `restart()`**
 *
 * 顺序反过来的话（把拆的那一下放进 `SHUTDOWN` 监听器里），`R` 会让**整页死掉**，
 * 而最容易撞上的路径恰恰是「倒下了按 R」这种最顺手的动作。链条全是 Phaser 的引擎事实：
 *
 * 1. `scene.restart()` → `SceneManager.processQueue` → `Systems.shutdown()` 发 `SHUTDOWN`
 * 2. **`UpdateList.shutdown` 排在我们的监听器前面**（它是插件、注册得早），
 *    而它对场景里每个注册过 `preUpdate` 的对象调 `destroy(true)` ——
 *    `StageColliders` 那个 `StaticGroup` 就在其中
 * 3. `Group.destroy()` 会把 `children` 置成 `undefined`，于是随后
 *    `StageColliders.clear()` 里的 `group.remove()` 抛
 *    `Cannot read properties of undefined (reading 'contains')`
 * 4. 这个异常从 `Systems.shutdown()` 一路冲出 `Game.step()`：rAF 不再排下一帧、
 *    场景也没有活着的了 —— **整页只剩一张静止的图**，只有刷新能救
 *
 * 所以趁场景还活着先把借来的东西还掉（`releaseSession()`），`SHUTDOWN` 里那一步
 * 就成了空操作。D1 的 `BattleScene.restartDifficulty()` / `ESC` 也是这个顺序。
 * **这一条不是本场独有的**：任何「场景自己持有一个 `CombatSession`」的地方都得这么写。
 *
 * ---
 *
 * ## 为什么是**普通 Scene**，不是 `ArenaBase`
 *
 * 底座会在 `create()` 里替场子造一套 `EnemySystem` + `DummyPlayer` + 它自己的键位。
 * 而这一场要的玩家、敌人、物理全是 **D1 的 `CombatSession`** ——
 * 继承底座就会有两套敌人、两套物理、两套 WASD，而**两边都不会报错**，
 * 只是怪打不死、人飘着走。D1 的场子（`arenas/D1/d1_battle.ts`）走的是同一条路。
 *
 * ## 为什么这个文件在 `arenas/joint/` 而不是 `arenas/D2/`
 *
 * `architecture.test.ts` 按文件夹对账「这个域的场子只许 import 自己那个域」。
 * 这一场**同时**直接 import `domains/combat` 和 `domains/procgen` ——
 * 放进任何一边的文件夹都会当场红，而那条测试是对的：它逼着「跨域」这件事
 * 显式地出现在 `ARENA_FOLDER_DOMAINS` 表里（`joint: ['combat', 'procgen']`），
 * 而不是安静地混进某个域的文件夹里谁也不知道。
 *
 * ## 跨文件夹 import `../D2/_shared`
 *
 * 生成一层楼那件事（`scene.cache.json` 的读法、短层的走法、耗时怎么量）
 * 在 `_shared.ts` 里已经有一份，而且有 ⚠️ 注释钉着（「必须走 Phaser 的 loader」）。
 * 这里再写一遍就是第二份会漂的事实 —— 所以直接用它，只是它住在 D2 的文件夹里。
 * 相对 import 不是域 import，`architecture.test.ts` 那条管不到（也不该管）。
 */

import Phaser from 'phaser'
import { preloadAssets, ensurePlaceholderTextures, registerAnimations } from '@/core/assets'
import { parseConfigBundle, type ConfigBundle, type Difficulty } from '@/core/config'
import { parseCombatConfig, parseRewards, type CombatConfig } from '@/domains/combat/config'
import { CombatSession } from '@/domains/combat/CombatSession'
import { RewardPanel } from '@/domains/combat/RewardPanel'
import { StatusHud } from '@/domains/combat/StatusHud'
import { LoadoutHud } from '@/domains/combat/LoadoutHud'
import { stagePlan } from '@/domains/combat/balance'
import {
  fitMapFrame,
  parseStageCollisions,
  stageGeometry,
  type SolidRect,
  type StageCollisionConfig,
} from '@/domains/combat/StageGeometry'
import { collidersOf, type ColliderKind, type DoorBarrier } from '@/domains/procgen/colliders'
import { doorShouldBeClosed, roomNeedsFight } from '@/domains/procgen/roomFlow'
import { bottom, clipRect, left, rectFromCorners, right, top } from '@/domains/procgen/model/rect'
import { ROOM_KIND_LABELS, type DungeonMap, type Point, type Rect, type Room } from '@/domains/procgen/model/types'
import type { RoomsConfig } from '@/domains/procgen/config'
import { mapperFor, type Mapper } from '@/domains/procgen/presentation/floorplan'
import type { ArenaDefinition } from '../../ArenaBase'
import { MENU_SCENE_KEY } from '../../arenaCatalog'
import {
  D2_SEEDS,
  DEFAULT_SEED,
  elapsedText,
  generateForArena,
  loadRoomsConfig,
  nearestSpawn,
} from '../D2/_shared'
import { drawClassroomLook, LOOK_DEPTH } from '../D2/_classroomLook'
import { drawD1StageLook } from './_d1Scenes'

/** 这一层只有三间（起点 / 普通战 / 首领）。走 `roomsConfigWithRoomCount`，配置校验器照跑。 */
const ROOM_COUNT = 3

/** 这一场的难度档。难度只进 `stagePlan()`（怪的数量），这一场不是用来看平衡的。 */
const DIFFICULTY: Difficulty = 'normal'

/**
 * 「站在门口」的判定半径（**地图** px）。
 *
 * 一格是 `navCellSize`（40），门宽一格。1.15 格 ≈ 一个身位再多一点：
 * 太大门还没看清就过去了，太小得贴着墙找。**它只管 `F` 按得响不响**，
 * 门能不能过是 `doorShouldBeClosed()` 说了算 —— 两个问题别混起来。
 */
const DOOR_REACH = 46

// ---------------------------------------------------------------- 版面

/**
 * 小地图面板的尺寸。**落点每帧按当场画布算**（与 `d2_room_flow` 的读数条同一条口径），
 * 所以这里只有「多大」「离边多远」。
 *
 * 摆**右上角**、读数摆**右下角**：两间房的东墙上都有一扇门，而门在房间的竖直中线上
 * —— 上下两块面板正好把那条中线让出来。压住门的话，人找不到 `F` 该站哪。
 */
const PANEL = {
  pad: 12,
  /** 面板离画布边的距离 */
  inset: 8,
  mapW: 320,
  mapH: 86,
  /** 标题那一行占掉的高度：图从那以下开始 */
  titleH: 26,
  stripH: 48,
  readoutW: 320,
  /** 读数面板最少要这么高才画得下（画不下就整块收起，读数里说一句） */
  readoutMinH: 96,
} as const

/**
 * 提示条要挤进去的那条缝：`LoadoutHud` 的右缘 → 读数面板的左缘。
 *
 * `391` 是 D1 那两格装备栏的右缘（`18 + 192 + 181`，写死在他那边、不随窗口变，
 * 见 `LoadoutHud` 的构造函数）；读数面板的左缘每帧算得（`width - inset - readoutW`）。
 * 提示条居中摆在这条缝里，**缝不够宽就整个不显示**（见 `drawReadout()`）。
 */
const LOADOUT_RIGHT = 391

/**
 * 缝窄过这个宽度就不画提示条了（两行提示实测 ~430px，留点余量）。
 *
 * 为什么宁可不显示：提示条压住的是读数面板和装备栏，那两块上写着**当场的状态**；
 * 少两行按键说明只是不方便，盖住状态是看不懂。
 */
const HINTS_MIN_GAP = 470

/**
 * 小地图与世界里门刻度的颜色。**一套**。
 *
 * 「开着 / 关着 / 打过」这三个状态在这一场里有三处要画（门上的刻度、小地图上的刻度、
 * 小地图上房间的底色），三处读**同一个 `shut()`**、用**同一对颜色** ——
 * 同一扇门在同一帧里一处红一处绿，是这一场最不该出现的误读。
 *
 * （与 `d2_room_flow` 的 `DOOR_MARK_OPEN` / `DOOR_MARK_SHUT` 是**同一个语义**、
 * 不是同一份常量：那两个数是它自己读数条用的。改了一处，另一处不会跟着变 ——
 * 这是两台表盘，不是两个真值来源。真要统一，就该搬进 `_shared.ts` 由两边一起读。）
 */
const MARK = {
  open: 0x44dd88,
  shut: 0xff4466,
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
  roomClearedEdge: 0x6ee29a,
  player: 0xffffff,
  /** `B` 那一层：碰撞体 / 寻路网格 / 出生点 */
  solid: 0x51ff9a,
  blocked: 0xff5a5a,
  spawn: 0xffd166,
} as const

/**
 * 门的三态颜色。**世界里那条刻度与小地图上那条刻度读的是同一张表**，
 * 所以同一扇门在同一帧里不可能一处红一处绿。
 *
 * `ahead`（灰）不是第二条判据，见 `doorState()`：它是「玩家还没走到那一间，
 * 这个问题此刻没有答案」的显示态。
 */
const DOOR_COLOR = {
  open: MARK.open,
  shut: MARK.shut,
  ahead: 0x556070,
} as const

/** 小地图上那几种字色。`Text` 要的是 CSS 色串，不是 `0xRRGGBB`。 */
const MAP_TEXT = {
  title: '#9ad4ff',
  label: '#c8d4e0',
  labelCurrent: '#ffe08a',
  labelCleared: '#9ff0bd',
  notice: '#ffe08a',
  body: '#c8d4e0',
} as const

/**
 * 画布上一块**左上角对齐**的矩形（x / y 是左上角）。
 *
 * ⚠️ 刻意**不复用** `model/types.ts` 的 `Rect`：那个的 `x` / `y` 是**中心点**
 * （全项目的几何都按中心点走）。拿它当左上角的盒子用，错半个身位是必然的，
 * 而**看起来像画歪了**，不像用错了类型。
 */
interface PanelBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

// ---------------------------------------------------------------- 跨局的（模块级）

/**
 * 当前看的是第几张牌。**模块级** —— `scene.restart()` **复用场子实例**、不重建
 * （2026-10-15 实测，见 `d2_room_flow` 里那段），所以实例字段留不住，
 * 而「按 `N` 换的种子」必须留下来：不留的话按一次 `N` 又回到第一张牌，
 * 看起来像「`N` 没反应」。起点是 `DEFAULT_SEED`，于是两个 D2 场子的画面对得上。
 */
let seedIndex = D2_SEEDS.indexOf(DEFAULT_SEED as (typeof D2_SEEDS)[number])
if (seedIndex < 0) seedIndex = 0

/**
 * 观感层 / 碰撞箱 / 小地图这几块**显示开关**也是模块级：它们是「我想看什么」，
 * 不是「这一局发生了什么」。放实例里的话，按一次 `N`（换种子，走 `restart`）
 * 就会把观感打开、把碰撞箱关掉，而那是同一句话的两个理由，看起来像 bug。
 *
 * 观感有**三档**（`L` 键循环），默认从 D2 自己那套开始：它是这一层的「本行」，
 * 而 D1 场景那一档是拿来跟它对着看的（见文件头）。
 */
type LookMode = 'd2' | 'd1' | 'white'
/**
 * 三档观感的**一张表**：`id` 是判据、`short` 进读数面板那一行、`hint` 是按 `L` 时通知条那句。
 * 三处分着写的话，改一档的名字会出现「读数说 D1 场景、通知条说 D1 观感」——
 * 而那看起来像切档没生效。
 */
const LOOK_MODES: readonly { readonly id: LookMode; readonly short: string; readonly hint: string }[] = [
  { id: 'd2', short: 'D2 观感', hint: '观感：D2 自己的那套（地砖 + 色块桌椅 + 墙门）' },
  {
    id: 'd1',
    short: 'D1 场景',
    hint: '观感：D1 手绘关（整间教室都是那张画，只有门是 D2 画的）',
  },
  { id: 'white', short: '白箱', hint: '观感：关 —— 只剩 D1 的实体（按 B 看碰撞箱）' },
]

function lookModeEntry(id: LookMode): (typeof LOOK_MODES)[number] {
  return LOOK_MODES.find((m) => m.id === id) ?? LOOK_MODES[0]!
}

let lookMode: LookMode = 'd2'
let showBoxes = false
let showMinimap = true

// ---------------------------------------------------------------- 把一层楼拆成三关

/** 一间教室要的那几样，全部在 `planFloors()` 里一次算出来。 */
interface RoomPlan {
  readonly order: number
  readonly room: Room
  /** 取景框（**地图**坐标）：房间 + 一圈留白。与 `framing.ts` 的 `roomFitSize` 同一条口径 */
  readonly box: Rect
  /** 裁进 `box` 的墙（地图坐标）。**同一份**喂给观感层与碰撞，见 `_classroomLook` 的 ⚠️ */
  readonly walls: readonly Rect[]
  /** D1 认的碰撞（**盒子坐标**、左上角原点） */
  readonly solids: readonly SolidRect[]
  /**
   * 这一间的碰撞体按 D2 的 `ColliderKind` 数了一遍。**只是个读数**，
   * 但读的是 D2 分的那一类：椅子**在**挡人列表里（怪和人都撞它）、
   * **不在**挡弹列表里（子弹扫过去）。数出来不对就说明上游的裁切吃掉了东西。
   */
  readonly mix: { readonly wall: number; readonly desk: number; readonly chair: number; readonly barrier: number }
  /** 开在这一间墙上的门，值是整层 `barriers` 里的下标 */
  readonly doors: readonly number[]
  /** 玩家从哪儿进场（盒子坐标 / 地图坐标，两个都要：一个喂 D1，一个用来对账） */
  readonly spawn: Point
  readonly spawnMap: Point
  /** 这一间要不要打（`roomFlow.roomNeedsFight()`：关别要打 **且** 有刷怪点） */
  readonly needsFight: boolean
}

interface FloorPlan {
  readonly rooms: readonly RoomPlan[]
  readonly stageConfig: StageCollisionConfig
  /** 整层的门（去重后，顺序稳定）。世界里与小地图上都按下标读它 */
  readonly barriers: readonly DoorBarrier[]
  /** 公共盒子的尺寸 = `sourceSize`。**三关共用**，否则每间一个缩放，过门时画面会跳 */
  readonly box: { readonly width: number; readonly height: number }
}

/**
 * 一间房的取景框：**房间 + 一整条墙 + 半格门外**。
 *
 * 口径**逐字抄** `framing.ts` 的 `roomFitSize`（那里算的是同一件事）：
 * `wallThickness` 让墙整条落在框里，半格 `navCellSize` 让门和门外那一点点露出来。
 * **不从 `roomViewBox` 拿** —— 那个会把门外的连廊、侧室整块并进来
 * （它的用途是缩略图与 1:1 特写，见那边的表），并进来之后教室在屏上只剩一半。
 */
function boxOf(room: Room, cfg: RoomsConfig): Rect {
  const margin = cfg.wallThickness + cfg.navCellSize / 2
  return rectFromCorners(
    left(room.rect) - margin,
    top(room.rect) - margin,
    right(room.rect) + margin,
    bottom(room.rect) + margin,
  )
}

/** 面板用的取整：0.01px 的零头是浮点噪声，留着只会让读数上下跳。 */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * 地图一块 → 盒子一块（左上角原点）。`null` = 这一块整个在盒子外。
 *
 * `dx` / `dy` 是**这一间的平移量**：把它的取景框挪到公共盒子正中
 * （`(公共 - 本间) / 2`），于是三间窄的宽的房间都居中、缩放也只有一个。
 * 算错了**不报错**：房间会偏一边，而偏一边看起来像「生成器把房间摆歪了」。
 */
function toBoxRect(r: Rect, dx: number, dy: number, id: string): SolidRect | null {
  const x = round2(left(r) + dx)
  const y = round2(top(r) + dy)
  const x1 = round2(right(r) + dx)
  const y1 = round2(bottom(r) + dy)
  if (x1 <= x || y1 <= y) return null
  return { id, x, y, width: round2(x1 - x), height: round2(y1 - y) }
}

/**
 * 地图**一个点** → 盒子坐标。
 *
 * ⚠️ 点不能借 `toBoxRect()` 走 —— 那个吃的是**中心点约定**的 `Rect`，
 * `left(r)` 会先减掉半个宽；拿一个 `width: 1` 的假矩形去装一个点，
 * 结果正好偏 **0.5px**，两个轴一起偏就是 `0.707px`。
 * 0.5px 在画面上看不出来 —— 但 `create()` 里那条反算自检就是干这个的：
 * 它当时报的正是 `0.707px`，而这个数是「两个轴各差 0.5」的指纹。
 */
function toBoxPoint(p: Point, dx: number, dy: number): Point {
  return { x: round2(p.x + dx), y: round2(p.y + dy) }
}

/**
 * 把一层楼拆成 D1 认的三关。**纯函数**（零 Phaser、零场景），所以它能被单测拖进 node。
 *
 * ## 每一关的碰撞从哪来（四样，一件都不能少）
 *
 * | 来源 | 为什么 |
 * |---|---|
 * | `collidersOf().solids` 里落进本框的 | 墙 + 课桌 + 椅子，**一份**（见那边文件头「一座楼只有这一份」） |
 * | `collidersOf().barriers` 里落进本框的 | **填住门洞** —— 不填，怪会顺着洞走出去（见文件头） |
 * | `stageGeometry()` 补的边框墙 | D1 自己加的（`sourceSize` 比世界窄时报影部分），不用这里管 |
 *
 * ## 为什么是**裁**（`clipRect`）不是筛（`rectsIntersect`）
 *
 * `_shared.collisionInBox()` 用的是筛，理由是「裁断会在框边凭空多出一条通道」。
 * 那里的框是 `roomViewBox`（**一间的取景框**，框边压在墙的半腰上），而这里的框
 * 是 `boxOf()` —— 框边在墙**外面**一整条 + 半格。多出来的那一截墙本来就是
 * 门外的连廊墙，裁掉它不会开出任何通道（门洞已经被挡板填死了）。
 * 反过来，筛会把整段连廊墙留在框里、伸出盒子外面去 —— 而 `parseStageCollisions`
 * 会为「矩形越界」当场报错，于是这一场根本起不来。
 *
 * ## ⚠️ 一条接不上的线：D2 的椅子挡人不挡弹，**D1 那边没有这一维**
 *
 * D2 的碰撞几何分三类（`ColliderKind`：墙 / 课桌 / 椅子），分岔只有一处：
 * 椅子**挡人不挡弹**（`openspec/specs/procgen-config-contract` 里那条）。
 * 而 D1 的 `StageCollisionConfig` 只有**一张** `solids` 表：`StageColliders` 拿它
 * 同时接玩家和怪，`TerrainMap.solidHitTime()` 也拿它扫子弹。
 *
 * 于是**椅子在这一场里挡子弹**。这不是这一场写错了，是两边契约的差：
 * D2 这边数据齐（`collidersOf().bulletStoppers` 就是那张不含椅子的表），
 * D1 那边没有接收它的字段。读数里专门留了一行报出来（有几把椅子就说几把），
 * 免得这个差被当成「椅子挡子弹本来就是这样」。
 */
function planFloors(map: DungeonMap, cfg: RoomsConfig, d1: CombatConfig): FloorPlan {
  const boxes = map.rooms.map((room) => boxOf(room, cfg))
  const box = {
    width: Math.max(...boxes.map((b) => b.width)),
    height: Math.max(...boxes.map((b) => b.height)),
  }
  const col = collidersOf(map, cfg)

  const rooms: RoomPlan[] = map.rooms.map((room, i) => {
    const own = boxes[i]!
    const dx = (box.width - own.width) / 2 - left(own)
    const dy = (box.height - own.height) / 2 - top(own)

    // ⚠️ 碰撞体一律从 **`collidersOf().solids`** 里裁，**不要**从 `map.walls` /
    // `room.obstacles` 各推一遍 —— 那两个数组正是 `solids` 的来源（见那边的文件头
    // 「一座楼只有这一份」）。在这里重推一遍就是第二份会漂的事实：
    // D2 哪天把某一类家具挪出挡人列表，这一场会照旧挡着，
    // 而那个样子看起来像「碰撞体没跟着更新」。
    const inside: { kind: ColliderKind; rect: Rect }[] = []
    for (const c of col.solids) {
      const r = clipRect(c.rect, own)
      if (r !== null) inside.push({ kind: c.kind, rect: r })
    }
    // 观感层要的是「墙」那一半，而且**必须是喂给碰撞的同一份矩形** ——
    // `_classroomLook` 的文件头点名要求「两处同一份」，理由是分开算的话
    // 画出来的墙和挡人的墙会各说各的，而那看起来像「碰撞没生效」。
    const walls = inside.filter((c) => c.kind === 'wall').map((c) => c.rect)
    const doors: number[] = []
    const barriers: Rect[] = []
    col.barriers.forEach((b, index) => {
      const c = clipRect(b.rect, own)
      if (c === null) return
      doors.push(index)
      barriers.push(c)
    })

    const stage = room.order + 1
    const solids = [...inside.map((c) => c.rect), ...barriers]
      .map((r, n) => toBoxRect(r, dx, dy, `s${stage}-${n}`))
      .filter((r): r is SolidRect => r !== null)
    const mix = {
      wall: inside.filter((c) => c.kind === 'wall').length,
      desk: inside.filter((c) => c.kind === 'desk').length,
      chair: inside.filter((c) => c.kind === 'chair').length,
      barrier: barriers.length,
    }

    const spawnMap = nearestSpawn(room) ?? { x: room.rect.x, y: room.rect.y }
    const spawn = toBoxPoint(spawnMap, dx, dy)
    if (spawn.x < 0 || spawn.y < 0 || spawn.x > box.width || spawn.y > box.height)
      throw new Error(`d1d2_rooms：第 ${stage} 关的出生点落到了取景框外`)
    return {
      order: room.order,
      room,
      box: own,
      walls,
      solids,
      mix,
      doors,
      spawn: { x: spawn.x, y: spawn.y },
      spawnMap: { x: spawnMap.x, y: spawnMap.y },
      needsFight: roomNeedsFight(room, cfg),
    }
  })

  const stageConfig: StageCollisionConfig = {
    // 网格口径用 **D1 配置里的那个**（`combat.json` 的 `terrain.navigationCellSize`）：
    // 这一份 `StageCollisionConfig` 是 D1 的东西，进的是它的 `TerrainMap`，
    // 换成 D2 的 `navCellSize` 就等于「D1 的网格跟着地图的可变参数走」——
    // 而 D2 的墙是按 40 对齐的，D1 的网格是 32，两者差半格的地方会多出/少掉一排格子，
    // 且**不报错**（怪绕路或卡住）。这一场要看的是「D1 用**它自己的**网格能不能吃下 D2 的几何」。
    navigationCellSize: d1.terrain.navigationCellSize,
    schemaVersion: 1,
    sourceSize: { width: box.width, height: box.height },
    stages: rooms.map((plan) => ({
      stage: plan.order + 1,
      playerSpawn: plan.spawn,
      solids: [...plan.solids],
      // 家具是 D1 手绘图里那套「一坨能缩放的部件」；D2 的几何本来就是事实，
      // 没有需要缩放的东西 —— 空数组是 D1 校验器明确接受的形状。
      furniture: [],
    })),
  }

  // D1 自己的校验器。**不是形式**：关编号、标识唯一、矩形不越界、
  // 出生点不在墙里 —— 四条都是这一场最容易接错的地方，而错了都不报错。
  parseStageCollisions(stageConfig, ROOM_COUNT)

  return { rooms, stageConfig, barriers: col.barriers, box }
}

// ---------------------------------------------------------------- 场景

class D1D2RoomsScene extends Phaser.Scene {
  // ---- 一局的：`init()` 里显式归零（`restart()` 复用实例，不清就是上一局的鬼）
  private session: CombatSession | null = null
  private rewardPanel: RewardPanel | null = null
  private statusHud: StatusHud | null = null
  private loadout: LoadoutHud | null = null
  /** D2 那一套观感：地砖 + 色块桌椅 + 墙 + 门 + 装饰（`layers: 'full'`） */
  private look: Phaser.GameObjects.Graphics | null = null
  /** 只画**门**的那一层（`layers: 'doors'`）—— D1 场景那一档靠它 */
  private lookDoors: Phaser.GameObjects.Graphics | null = null
  /** D1 手绘关的**整间教室** + 桌椅贴图（一个 `Container`，见 `_d1Scenes.ts`） */
  private d1Look: Phaser.GameObjects.Container | null = null
  private boxes: Phaser.GameObjects.Graphics | null = null
  private doorMarks: Phaser.GameObjects.Graphics | null = null
  private minimapPanel: Phaser.GameObjects.Rectangle | null = null
  private minimapInk: Phaser.GameObjects.Graphics | null = null
  private minimapTitle: Phaser.GameObjects.Text | null = null
  /** 每间房一条标号。**开局造一次**（三间就是三条），之后每帧只改字与位置 */
  private minimapLabels: Phaser.GameObjects.Text[] = []
  private readoutBg: Phaser.GameObjects.Rectangle | null = null
  private readout: Phaser.GameObjects.Text | null = null
  private notice: Phaser.GameObjects.Text | null = null
  private doorHint: Phaser.GameObjects.Text | null = null
  private hintsText: Phaser.GameObjects.Text | null = null
  private fatal: Phaser.GameObjects.Text | null = null

  private bundle: ConfigBundle | null = null
  private cfg: CombatConfig | null = null
  private map: DungeonMap | null = null
  private roomsCfg: RoomsConfig | null = null
  /** D1 那三张手绘关的坐标表（只用来画第二档观感，见 `_d1Scenes.ts`） */
  private d1Art: StageCollisionConfig | null = null
  private plan: FloorPlan | null = null
  /** 地图 → 屏幕（**本间**的）。过门时重建 —— 每一间的取景框不一样宽 */
  private mapper: Mapper | null = null
  private frame = { scale: 1, x: 0, y: 0 }
  private currentOrder = 0
  /** 已经打完的（含「不用打」的）。读数是它，开门判据也是它 */
  private cleared = new Set<number>()
  private clearEmitted = false
  private clearAt = -1
  /** 生成这一层楼的真实耗时（读数用）。**量出来的**，不是常量 —— 见 `_shared` 的文件头 */
  private genMs = 0
  /** 这一间有几只怪没能落在「按它自己的半径也站得住」的格子上（读数里看得见） */
  private spawnFallbacks = 0

  constructor() {
    // 键由 `ArenaMenu` 那边的 `game.scene.add('arena:d1d2_rooms', …)` 显式给
    // （见 `sceneKeyOf` 的 ⚠️：传类进去会得到 null，然后是一场「场景不存在」的空转）。
    super('')
  }

  /**
   * 一局开始前**显式归零**。
   *
   * `scene.restart()` **复用这个实例**（只重建场景的系统与显示列表），
   * 所以实例字段会带着上一局的值进来。不清的三种表现：
   *
   * - `minimapLabels` 里留着上一局的死 `Text`（已 destroy），再 `push` 就长出两倍
   * - `cleared` 里带着上一局的房间号 → 一进场门就全开着
   * - `session` 指向一个已经 destroy 的会话 → 第一帧 `update()` 就炸在别人家里
   */
  init(): void {
    this.session = null
    this.rewardPanel = null
    this.statusHud = null
    this.loadout = null
    this.look = null
    this.lookDoors = null
    this.d1Look = null
    this.boxes = null
    this.doorMarks = null
    this.minimapPanel = null
    this.minimapInk = null
    this.minimapTitle = null
    this.minimapLabels = []
    this.readoutBg = null
    this.readout = null
    this.notice = null
    this.doorHint = null
    this.hintsText = null
    this.fatal = null
    this.bundle = null
    this.cfg = null
    this.map = null
    this.roomsCfg = null
    this.d1Art = null
    this.plan = null
    this.mapper = null
    this.currentOrder = 0
    this.cleared = new Set()
    this.clearEmitted = false
    this.clearAt = -1
    this.genMs = 0
    this.spawnFallbacks = 0
  }

  preload(): void {
    preloadAssets(this)
    // D1 的五张表 + D2 的房间表。**那三张手绘关图不用在这里加载** ——
    // 它们在 `assetManifest` 的清单里（`placeholder: false`），`preloadAssets` 已经取了。
    for (const n of ['balance.json', 'difficulty.json', 'enemies.json', 'combat.json', 'rewards.json'])
      this.load.json(n, `config/${n}`)
    // D1 的关图坐标表。⚠️ 只读它的 `furniture`（桌椅贴图的框与轮廓）与 `sourceSize`
    // （贴图坐标那个 2048×1152 的空间）—— `solids` / `playerSpawn` **一个都不用**，
    // 这一场的几何全部来自 D2。见文件头那一条。
    this.load.json('stage-collisions.json', 'config/stage-collisions.json')
    // 走 Phaser 的 loader，不是 fetch —— 见 `_shared.loadRoomsConfig` 的 ⚠️。
    loadRoomsConfig(this)
  }

  create(): void {
    try {
      this.build()
    } catch (e) {
      this.showFatal(e)
    }
  }

  private build(): void {
    ensurePlaceholderTextures(this)
    registerAnimations(this)

    this.bundle = parseConfigBundle({
      balance: this.cache.json.get('balance.json'),
      difficulty: this.cache.json.get('difficulty.json'),
      enemies: this.cache.json.get('enemies.json'),
    })

    // 一层楼：三间。走 `roomsConfigWithRoomCount`（改原始 JSON、**再过一遍校验器**）。
    const seed = D2_SEEDS[seedIndex] ?? DEFAULT_SEED
    const gen = generateForArena(this, seed, ROOM_COUNT)
    this.map = gen.map
    this.roomsCfg = gen.cfg
    this.genMs = gen.elapsedMs

    // 世界 = **视口**，不是 `combat.json` 里那个 1344×832。
    //
    // 理由只有一个：`zoom` 恒为 1。D1 的 HUD 是照 zoom 1 摆的
    // （`StatusHud` 在构造函数里定死 (18,16)，自己**不做**缩放补偿），
    // 相机一缩，血条就跟着缩、还偏 —— 而读的人会以为是条画错了。
    // 世界大小由视口给，本来就是 `zoomFor()` 那条注释说的「浏览器给的，是个变量」。
    const world = { width: this.scale.width, height: this.scale.height }
    const parsed = parseCombatConfig(this.cache.json.get('combat.json'))
    this.cfg = {
      ...parsed,
      arena: {
        ...parsed.arena,
        width: world.width,
        height: world.height,
        seed,
        // 三间 = 三关。D1 的 `stagePlan()` 和 `parseStageCollisions()` 都读它
        maxStages: ROOM_COUNT,
      },
    }
    const rewardDefs = parseRewards(this.cache.json.get('rewards.json'))
    this.plan = planFloors(this.map, this.roomsCfg, this.cfg)
    // D1 的关图坐标表，**过一遍 D1 自己的校验器**。它顺手钉住这一层要的那三样：
    // 关数、`sourceSize`（贴图坐标那个空间）、家具的框与多边形都在源图里 ——
    // 这三样错了的表现分别是「少一张图 / 地面铺到墙外面 / 桌椅不见了」。
    this.d1Art = parseStageCollisions(this.cache.json.get('stage-collisions.json'), ROOM_COUNT)

    // `fitMapFrame` 是 D1 用来把 `sourceSize` 摆进世界的那条式子，这里**借它**算
    // 同一个缩放（观感层、门标记、小地图上的玩家点都读这一份）——
    // 自己写一遍 `min(w/sw, h/sh)` 就是同一个数有两个真值来源，
    // 而分岔的表现是「画面和碰撞错开半个身位」，看起来像生成器歪了。
    const cfg = this.cfg
    this.frame = fitMapFrame(
      world.width,
      world.height,
      this.plan.box.width,
      this.plan.box.height,
    )

    // 相机：**不跟随、不带边界、缩放恒 1**。世界就是视口那么大，所以整间房一眼看到底。
    // （`BattleScene` 那边有个 `fitCamera()` 算 `min(1, 视口/世界)` —— 它的世界比视口大，
    // 算出来小于 1；这一场世界 == 视口，那个 min 恒等于 1，不值得再抄一遍。）
    this.cameras.main
      .stopFollow()
      .removeBounds()
      .setZoom(1)
      .centerOn(world.width / 2, world.height / 2)
      .setBackgroundColor(0x050916)
    this.session = new CombatSession(this, this.bundle, cfg, rewardDefs, DIFFICULTY, this.plan.stageConfig)
    this.rewardPanel = new RewardPanel(this.session)
    // 三选一落定之后把通知条换成「门开了」那一句。
    //
    // 订阅事件而不是在 `1/2/3` 的按键处理里写一句：`RewardRun` 还有一条
    // **没有可选项**的收尾路径（`reason: 'empty'`，`CombatSession` 里那一行），
    // 只挂按键会漏掉它 —— 表现是「面板没了，通知条还写着『选择一项强化』」。
    // 不摘监听器：`bus` 是 `CombatSession` 自己的（`new TypedBus`），随它一起销毁。
    const session = this.session
    session.bus.on('reward_finished', (e) => {
      if (e.runId !== session.runId) return
      const last = this.currentOrder + 1 >= (this.plan?.rooms.length ?? 0)
      this.say(last ? '选好了 → 这一层到底了：N 换种子 / R 重开' : '选好了 → 门已经开了，走到橙色门框按 F 过门')
    })
    this.statusHud = new StatusHud(this)
    this.loadout = new LoadoutHud(this, this.session)

    this.makeHud()
    this.enterRoom(0, true)
    this.bindKeys()
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown())
  }

  override update(_time: number, delta: number): void {
    const s = this.session
    if (s === null) return
    s.update(delta)
    this.loadout?.update()
    const p = s.player
    this.statusHud?.update(
      p.model.hp,
      p.model.maxHp,
      p.stamina,
      p.maxStamina,
      p.model.shield,
      p.model.maxShield,
    )

    // `C` 请求的那一下：**每帧再按一次**，等分裂链把子代生完、都收干净。
    // （D1 的 `BattleScene.requestClear()` 同一条：怪还没清完就再来一发。）
    if (this.clearAt >= 0 && !this.clearEmitted && !s.clock.paused) s.enemies.simulateClear()

    if (this.shouldEmitClear(s)) {
      this.clearEmitted = true
      const order = this.currentOrder
      this.cleared.add(order)
      // `roomId` 的写法与 `BattleScene` 同一个口径（`d1-room-<关号>`）——
      // `RewardRun.offer()` 只认一次同一个 id，两个口径混用会让三选一少弹一次，
      // 而那看起来像「强化面板坏了」。
      s.bus.emit('room_cleared', { runId: s.runId, roomId: `d1-room-${order + 1}` })
      this.say(
        order + 1 >= (this.plan?.rooms.length ?? 0)
          ? `第 ${order + 1} 间完成（最后一间）· 选一项强化，然后 N 换种子 / R 重开`
          : `第 ${order + 1} 间完成 · 选择一项强化（1/2/3）`,
      )
    }

    this.drawDoorMarks()
    this.drawMinimap()
    this.drawReadout()
    // 死了就说一句。**不做成 D1 那块居中的大牌**（那是产品的表现），
    // 但一声不吭是更糟的选择：`CombatSession` 一旦 `pause('death')`，
    // 这一场剩下的所有按键都会安静失效（`passDoor` / `requestClear` 都先看 `paused`），
    // 于是「按 F 没反应、按 C 没反应」看起来像这一场的按键全坏了。
    if (!s.player.model.alive) this.say('你倒下了 · 按 R 重开本局（同一颗种子）/ N 换种子')
  }

  // ---------------------------------------------------------------- 一间房

  /**
   * 进第 `order` 间。**转接的全部动作**。
   *
   * `session.enterStage()` 是 D1 的转接入口，它一个人做完五件事：
   * 换几何（`terrain.setStage`）、重建碰撞、找可站住的出生点、清输入、把玩家挪过去。
   * 这一场**不重写其中任何一件** —— 重写一遍就等于有两个「进新房间该干什么」的真值来源。
   *
   * 这一场在它**外面**补三件：观感层（D2 的画）、调试层、刷怪（D1 的 `stagePlan` 数量）。
   */
  private enterRoom(order: number, first = false): void {
    const s = this.session
    const plan = this.plan
    if (s === null || plan === null) return
    const stage = plan.rooms[order]
    if (stage === undefined) return

    this.currentOrder = order
    this.clearEmitted = false
    this.clearAt = -1
    this.spawnFallbacks = 0

    // D1 的转接。**先几何、后刷怪** —— 怪得落在新一间的坐标系里。
    s.enterStage(order + 1)

    this.rebuildMapper(stage)
    this.buildLook(stage)
    this.drawBoxes(stage)
    this.spawnRoom(stage)

    // 不用打的房间（道具关 / 宝箱关）：**一进场就算已清**。
    // 照 `roomFlow.roomNeedsFight()` 的原话：不这么做，它们会把玩家关在里面
    // —— 没有刷怪点，照「清完才开门」的字面执行，门永远不会开。
    if (!stage.needsFight) this.cleared.add(order)

    const nastiest = stage.needsFight ? '清完这间的怪，门就开了' : '本间不用打，门直接开着'
    this.say(
      `${first ? '开局' : '转接'} → 第 ${order + 1} 间 · ${ROOM_KIND_LABELS[stage.room.kind]}（${stage.room.rect.width}×${stage.room.rect.height}）· ${nastiest}`,
    )
    this.checkMapper(stage)
  }

  /**
   * 本间的「地图 → 世界」那把尺子。
   *
   * `screenX` / `screenY` 是**这一间的取景框左上角在世界里的位置**：
   * 盒子居中（`fitMapFrame` 那两段留白的一半），再把「本间比公共盒子小」的那半边让出来
   * —— 与 `planFloors()` 里 `dx` / `dy` 是同一个偏移，只是活在另一个空间里。
   */
  private rebuildMapper(stage: RoomPlan): void {
    const box = this.plan!.box
    const m = stage.box
    const screenX = this.frame.x + ((box.width - m.width) / 2) * this.frame.scale
    const screenY = this.frame.y + ((box.height - m.height) / 2) * this.frame.scale
    this.mapper = mapperFor(m, screenX, screenY, this.frame.scale)
  }

  /** 地图坐标 → 世界坐标（D1 的物理与显示都活在这个空间里）。 */
  private toWorld(x: number, y: number): Point {
    const m = this.mapper
    if (m === null) throw new Error('d1d2_rooms：尺子还没造好')
    return m.toScreen(x, y)
  }

  /** 世界坐标 → 地图坐标。**`toWorld()` 的逆**，只有这一处写它。 */
  private toMap(x: number, y: number): Point {
    const m = this.mapper
    if (m === null) throw new Error('d1d2_rooms：尺子还没造好')
    const origin = m.toScreen(0, 0)
    return { x: (x - origin.x) / m.scale, y: (y - origin.y) / m.scale }
  }

  /**
   * **反算自检**：拿 D1 自己算出来的出生点，倒推回地图坐标，和 D2 给的刷怪点比。
   *
   * 这一条钉的是「尺子是不是同一把」：`toMap()` 的单位、符号、平移量任意一处写错，
   * 世界里的玩家和小地图上的白点就会**分家** —— 而分家不会报错，
   * 只会让人怀疑生成器。差超过 1px 就印成 `✗`，读数里一眼能看见。
   *
   * 为什么是问 `stageGeometry()`（D1 的函数）而不是自己再乘一遍：那正是
   * 「量**引擎真正造出来的**几何，不要量我以为我喂进去的」——自己再算一遍的话，
   * 两边同时错、自检照样全绿。
   */
  private checkMapper(stage: RoomPlan): void {
    const s = this.session
    const cfg = this.cfg
    if (s === null || cfg === null) return
    const built = stageGeometry(this.plan!.stageConfig, stage.order + 1, cfg.arena.width, cfg.arena.height)
    const back = this.toMap(built.playerSpawn.x, built.playerSpawn.y)
    const err = Math.hypot(back.x - stage.spawnMap.x, back.y - stage.spawnMap.y)
    this.mapperError = err
  }
  private mapperError = -1

  /**
   * 观感那几层。**每次过门重画一间**（三间就是三份脸）。
   *
   * 一共造三个显示对象，撑起三档观感（见文件头那张表）：
   *
   * | 对象 | 谁画的 | 哪一档露脸 |
   * |---|---|---|
   * | `d1Look` | `_d1Scenes.ts`（D1 的**整间教室** + 桌椅贴图） | D1 场景 |
   * | `lookDoors` | `_classroomLook` 的 `layers: 'doors'`（只有门） | D1 场景 |
   * | `look` | `_classroomLook` 的 `layers: 'full'`（全部） | D2 观感 |
   *
   * 三个都用 `LOOK_DEPTH` 起算的小负数 —— 它们画在**世界坐标**上（`mapper` 换算过了），
   * 所以深度要压在所有实体下面，不能按 y 排。
   *
   * 传进去的 `walls` 就是 `planFloors()` 交给碰撞的那一份 ——
   * `_classroomLook` 的文件头点名要求「两处必须是同一份」：分开算的话，
   * 画出来的墙和挡人的墙会各说各的，而那看起来像「碰撞没生效」。
   */
  private buildLook(stage: RoomPlan): void {
    this.look?.destroy()
    this.lookDoors?.destroy()
    this.d1Look?.destroy()
    const map = this.map
    const cfg = this.roomsCfg
    const mapper = this.mapper
    const art = this.d1Art
    if (map === null || cfg === null || mapper === null || art === null) return

    // 第二档的**底**：D1 手绘关的**整间教室** + 桌椅贴图（`_d1Scenes.ts`）。
    // 关号 = 房间顺序 + 1，与 `enterStage(order + 1)` 同一个口径 —— 第 2 间就该铺
    // 第 2 关那张实验室图。两处口径不一致的话，教室里会铺着别的关的地板。
    this.d1Look = drawD1StageLook(this, {
      art,
      stage: stage.order + 1,
      room: stage.room,
      cfg,
      mapper,
      depth: LOOK_DEPTH,
    })

    // 第二档的**门**：只剩门是 **D2 这份画法**画的（`layers: 'doors'`）。
    // 深度 +2 是个显式的数，不靠创建顺序：同一深度上谁压谁由加入显示列表的先后决定，
    // 而那正是「改一行不相干的代码，墙就钻到地板底下了」这种 bug 的来路。
    this.lookDoors = drawClassroomLook(this, {
      map,
      cfg,
      mapper,
      box: stage.box,
      walls: stage.walls,
      depth: LOOK_DEPTH + 2,
      layers: 'doors',
    })

    // 本行那一档：地砖 + 色块桌椅 + 墙 + 门 + 装饰。
    this.look = drawClassroomLook(this, {
      map,
      cfg,
      mapper,
      box: stage.box,
      walls: stage.walls,
      // **没有 focus**：盒子只框着这一间，三间都是「要走进去打架的教室」。
      depth: LOOK_DEPTH,
    })
    this.applyLookMode()
  }

  /**
   * 按 `lookMode` 决定这两三个显示对象谁露脸。
   *
   * **只有这一处写这个判断** —— `L` 键和每次过门（重画之后）都走它。各写一遍的话，
   * 过门重画之后观感会悄悄退回默认那一档，而那看起来像「切档只在当前这一间有效」。
   */
  private applyLookMode(): void {
    this.look?.setVisible(lookMode === 'd2')
    this.lookDoors?.setVisible(lookMode === 'd1')
    this.d1Look?.setVisible(lookMode === 'd1')
  }

  /**
   * `B` 那一层：**D1 真正造出来的**东西。
   *
   * 读的是 `stageGeometry()` 的输出（D1 拿去建物理体的那一份）与
   * `session.terrain`（D1 的寻路网格）。**不是**读我喂进去的那些块 ——
   * 喂进去的和造出来的分岔时（缩放、留白、边框墙），只有画后者才看得出来。
   */
  private drawBoxes(stage: RoomPlan): void {
    const s = this.session
    const cfg = this.cfg
    const g = this.boxes
    if (s === null || cfg === null || g === null) return
    const built = stageGeometry(this.plan!.stageConfig, stage.order + 1, cfg.arena.width, cfg.arena.height)
    g.clear()

    // 1. 寻路网格里**堵着**的格子 —— 怪走的就是这一张。
    //    ⚠️ 半径传的是**场上最胖的怪**（与 `CombatSession` 建这张网时同一个数）。
    //    传 0 画出来的是「玩家站不站得住」，而怪走的是另一张网：贴着墙角那一圈
    //    玩家过得去、怪过不去。两个口径混在一起，就看不出来怪为什么绕路。
    const cell = s.terrain.cellSize
    const radius = this.fattestEnemy()
    g.fillStyle(MARK.blocked, 0.16)
    for (let y = cell / 2; y < cfg.arena.height; y += cell) {
      for (let x = cell / 2; x < cfg.arena.width; x += cell) {
        if (!s.terrain.isWalkable(x, y, radius)) g.fillRect(x - cell / 2, y - cell / 2, cell, cell)
      }
    }

    // 2. 造出来的碰撞体（墙 / 课桌 / 椅子 / 门挡板 —— 全在 `solids` 里，D1 不分类）。
    g.lineStyle(2, MARK.solid, 0.9)
    for (const r of built.solids) g.strokeRect(r.x, r.y, r.width, r.height)

    // 3. 按最胖的怪的半径再描一圈：这一圈以内它过不去（`isWalkable` 判的就是半径）。
    //    与上面那层红的**是一回事的两种画法**：红的格子和这一圈外沿应当严丝合缝。
    if (radius > 0) {
      g.lineStyle(1, MARK.blocked, 0.5)
      for (const r of built.solids)
        g.strokeRect(r.x - radius, r.y - radius, r.width + radius * 2, r.height + radius * 2)
    }

    // 4. 出生点（玩家那个与生成器给的刷怪点）。
    const spawn = this.toWorld(stage.spawnMap.x, stage.spawnMap.y)
    g.lineStyle(2, MARK.spawn, 1)
    g.strokeCircle(spawn.x, spawn.y, 9)
    for (const p of stage.room.spawnPoints) {
      const w = this.toWorld(p.x, p.y)
      g.strokeCircle(w.x, w.y, 4)
    }
    g.setVisible(showBoxes)
  }

  /** 场上最胖的敌人半径（寻路网格按它留余量，见 `CombatSession` 构造函数里同一句）。 */
  private fattestEnemy(): number {
    const b = this.bundle
    if (b === null) return 0
    return Math.max(
      b.enemies.enemies.tank.radius,
      ...b.enemies.enemies.splitter.generations.map((g) => g.radius),
    )
  }

  /**
   * 按 D1 的 `stagePlan()` 刷这一间的怪。
   *
   * **数量**不问这一场，问 D1（`balance.ts` 那个函数是公开的，文件头写着
   * 「D2 may use this public plan」）—— 自己定一套数量就是第二份会漂的平衡表。
   *
   * **地点**用 D2 的刷怪点（`gen/spawns.ts` 由构造保证「站得住 + 从门可达」）
   * —— D2 那块数据在这一场里就是**第一次真的被用上**。
   *
   * **间距**照 D1 的 `BattleScene.spawnStage()`：分裂怪 250、肉盾 360（世界 px）。
   *
   * ⚠️ 为什么非要有间距这一条：D2 的刷怪点是**房间自己**的（离房间中心近），
   * 而玩家进场就站在离房间中心最近的那个刷怪点上 —— 两者叠着。2026-10-15 实测：
   * 照搬刷怪点、什么都不做，**人站在出生点不动 6 秒就死了**（3 分裂 + 1 肉盾贴脸）。
   * 那是「这一场没法玩」，不是「哪里接错了」—— 而接错和没法玩在这类场子里
   * 长得一模一样，所以间距直接抄 D1 验证过的那两个数，不自己调。
   *
   * 最后**再过一遍 `safeSpawn()`**：D2 保证的是「按**玩家**半径站得住」，
   * D1 的 `safeSpawn` 判的是**怪的**半径 —— 两件事，胖怪收不下的角落是存在的。
   */
  private spawnRoom(stage: RoomPlan): void {
    const s = this.session
    const cfg = this.cfg
    if (s === null || cfg === null) return
    s.enemies.simulateClear() // 保险：上一间万一还有没回收的
    if (!stage.needsFight) return

    const plan = stagePlan(this.bundle!, cfg, DIFFICULTY, stage.order + 1)
    const spots = stage.room.spawnPoints.filter(
      (p) => p.x !== stage.spawnMap.x || p.y !== stage.spawnMap.y,
    )
    const queued = Math.ceil(plan.splitters * plan.secondPhaseFraction)
    const origin = this.toWorld(stage.spawnMap.x, stage.spawnMap.y)

    const drop = (
      kind: 'splitter' | 'tank',
      i: number,
      count: number,
      delayMs: number,
      minGap: number,
    ): void => {
      const base = spots.length ? spots[i % spots.length]! : stage.spawnMap
      const wBase = this.toWorld(base.x, base.y)
      const dx = wBase.x - origin.x
      const dy = wBase.y - origin.y
      const away = Math.hypot(dx, dy)
      // 同一个刷怪点分到好几只时：每多一只转 ~34°、再远 60px —— 叠在一格里
      // 会同时挨到所有怪的接触伤害，而「四只怪在一格里」看起来像刷怪点只有一个。
      const turn = spots.length ? Math.floor(i / spots.length) : 0
      const theta = (away > 1 ? Math.atan2(dy, dx) : (i / Math.max(1, count)) * Math.PI * 2)
        + turn * 0.6
      const gap = minGap + turn * 60
      // D2 那个刷怪点**本来就够远**时就照它放（它的地点是构造保证过的）；
      // 太近才沿「从玩家出发指向刷怪点」的方向推出去。
      const target =
        away > gap ? wBase : { x: origin.x + Math.cos(theta) * gap, y: origin.y + Math.sin(theta) * gap }
      const radius =
        kind === 'tank'
          ? this.bundle!.enemies.enemies.tank.radius
          : (this.bundle!.enemies.enemies.splitter.generations[0]!.radius ?? 0)
      let at: Point
      try {
        at = s.terrain.safeSpawn(target.x, target.y, radius)
      } catch {
        // 真收不下就退回 D2 那个刷怪点本身，并且**记一笔**（读数里报出来）：
        // 安静地少一只怪，看起来像「生成器少刷了」。
        at = wBase
        this.spawnFallbacks += 1
      }
      s.enemies.spawn(kind, 0, at.x, at.y, delayMs)
    }
    for (let i = 0; i < plan.splitters; i++)
      drop('splitter', i, plan.splitters, i >= queued ? plan.phaseDelayMs : 0, 250)
    for (let i = 0; i < plan.tanks; i++) drop('tank', i, plan.tanks, 0, 360)

    this.planCounts = { splitters: plan.splitters, tanks: plan.tanks }
  }
  private planCounts = { splitters: 0, tanks: 0 }

  /**
   * 这一间的 D1 数值（`stagePlan()` 算的）。**在这一场里第一次出现「D1 的平衡」
   * 与「D2 的房间」对上号** —— 所以摆进读数。
   */
  private planLine(): string {
    const stage = this.plan?.rooms[this.currentOrder]
    if (stage === undefined || !stage.needsFight) return '本间不用打（非战斗关别）· 一进场就算已清'
    const fallback = this.spawnFallbacks > 0 ? ` · 兜底 ${this.spawnFallbacks} 只` : ''
    return `本间 怪 ${this.planCounts.splitters} 分裂 + ${this.planCounts.tanks} 肉盾 · 还剩 ${
      this.session?.enemies.remaining ?? 0
    } · ${this.cleared.has(this.currentOrder) ? '已清 ✓' : '没清'}${fallback}`
  }

  /**
   * 这一间打完没有。**与 `d1_room_flow` / `BattleScene` 同一条判据**：
   * 存活 + 还没出生的都到 0，且开局那半秒不算（`nowMs > 500`）。
   *
   * 两个坑都在这里堵着：
   *
   * - 队列里排着怪时房间**看起来**是空的 → 只判存活会让门提前开
   * - 最后一只如果是分裂怪，子代既不在存活里也还没进队列 → 那一段得靠
   *   `C` 每帧再按一次把链收干净（`clearAt` 那一行），或玩家真的把子代打死
   */
  private shouldEmitClear(s: CombatSession): boolean {
    const stage = this.plan?.rooms[this.currentOrder]
    if (stage === undefined || !stage.needsFight) return false
    return (
      !this.clearEmitted &&
      s.player.model.alive &&
      s.enemies.remaining === 0 &&
      s.clock.nowMs > 500
    )
  }

  // ---------------------------------------------------------------- 门

  /**
   * 这一扇门现在关着没有。**判据整个交给 D2**（`roomFlow.doorShouldBeClosed`），
   * 这一场一个字都不加：尽头 / 落在身后（不回头）/ 还在战斗，三条理由取或。
   *
   * `ownerInCombat` 传的是**门所属那一间**的事实（`ownerInCombat()` 那一段）——
   * 不是「当前这一间」。对世界里的刻度两者是同一个值（落进取景框的门都开在本间墙上：
   * 三间主干教室之间是连廊、不是共墙，一段连廊两端各有一扇门，各自归各自那一间），
   * 但小地图要把**整层**的门都画出来，那时候两者就不是一回事了。
   */
  private doorShut(index: number): boolean {
    const b = this.plan?.barriers[index]
    if (b === undefined) return true
    return doorShouldBeClosed({
      ownerOrder: b.ownerOrder,
      toOrder: b.toOrder,
      currentOrder: this.currentOrder,
      ownerInCombat: this.ownerInCombat(b.ownerOrder),
    })
  }

  /**
   * 门上的三种状态。**红绿两种来自 `doorShut()` 那一条判据**；
   * 第三种（`ahead`）是**显示**上的第三态，不是第二条判据：
   *
   * 玩家还没走到那一间时，「这扇门开着还是关着」这句话在那个位置**没有答案**
   * —— 判据里的 `ownerInCombat` 说的是「玩家正在里面打」，而玩家不在。
   * 照实算会得到「开着」（绿的），可那是一扇两间之外的门：画成绿的会让人以为
   * 「现在就能从那儿过去」。所以**还没到的那几间，门不打刻度、写「还没到」**。
   */
  private doorState(index: number): 'open' | 'shut' | 'ahead' {
    const b = this.plan?.barriers[index]
    if (b === undefined) return 'shut'
    if (b.ownerOrder > this.currentOrder) return 'ahead'
    return this.doorShut(index) ? 'shut' : 'open'
  }

  /**
   * 「第 `order` 间现在在战斗吗」——**按事实算**，不按「是不是当前这一间」猜。
   *
   * 玩家只可能在这一间里打，所以只有本间可能是 true；别间一律 false。
   * 写成一个函数而不是内联，是因为小地图要问**每一扇门**（含别间的），
   * 而那个问题只有照门所属的那一间回答才对。
   */
  private ownerInCombat(order: number): boolean {
    if (order !== this.currentOrder) return false
    const stage = this.plan?.rooms[order]
    return stage !== undefined && stage.needsFight && !this.cleared.has(order)
  }

  /** 本间取景框里的门（世界里画刻度、`F` 找最近的那一扇，都读它）。 */
  private localDoors(): readonly number[] {
    return this.plan?.rooms[this.currentOrder]?.doors ?? []
  }

  /**
   * 门上的刻度：**世界坐标**里那一小块红/绿。
   *
   * 画在**门洞的中心**（= 墙的厚度中线），和小地图上那条读的是同一个点 ——
   * 两处位置一致，才不会出现「图上在左、世界里在右」这种要重新找对应关系的读法。
   *
   * 它就压在 `_classroomLook` 那道橙门框上，是有意的、也在图里验过：
   * 门框是**细线**（示意「这里有个洞」），刻度是 **6px 粗的一条实色**，
   * 粗的那条压得住细的；反过来摆（往墙外推一格）会离开门框，那时
   * 「这条红是在说这扇门」就得靠猜。
   */
  private drawDoorMarks(): void {
    const g = this.doorMarks
    const plan = this.plan
    if (g === null || plan === null) return
    g.clear()
    for (const i of this.localDoors()) {
      const b = plan.barriers[i]!
      const state = this.doorState(i)
      const w = this.toWorld(b.rect.x, b.rect.y)
      g.fillStyle(DOOR_COLOR[state], 0.95)
      const long = Math.max(10, b.rect.width * this.frame.scale), thick = 6
      if (b.axis === 'v') g.fillRect(w.x - thick / 2, w.y - long / 2, thick, long)
      else g.fillRect(w.x - long / 2, w.y - thick / 2, long, thick)
    }
    this.updateDoorHint()
  }

  /** 玩家脚边最近的那扇**没关**的门 + 一句「按 F」。没有就藏起来。 */
  private updateDoorHint(): void {
    const t = this.doorHint
    const s = this.session
    const plan = this.plan
    if (t === null || s === null || plan === null) return
    let best: { i: number; d: number } | null = null
    for (const i of this.localDoors()) {
      if (this.doorState(i) !== 'open') continue
      const b = plan.barriers[i]!
      const d = Math.hypot(b.rect.x - this.playerMap().x, b.rect.y - this.playerMap().y)
      if (best === null || d < best.d) best = { i, d }
    }
    if (best === null || best.d > DOOR_REACH) {
      t.setVisible(false)
      return
    }
    const b = plan.barriers[best.i]!
    const w = this.toWorld(b.rect.x, b.rect.y)
    t.setVisible(true)
      .setPosition(w.x, w.y - 26)
      .setText(`按 F → 第 ${(b.toOrder ?? 0) + 1} 间`)
  }

  /** `F`：过门。**只在没关的门前响**；关着的话说一句为什么。 */
  private passDoor(): void {
    const s = this.session
    const plan = this.plan
    if (s === null || plan === null || s.clock.paused) return
    if (!s.player.model.alive) {
      this.say('倒下了过不去门 —— 按 R 重开本局')
      return
    }
    const at = this.playerMap()
    let near: { i: number; d: number } | null = null
    for (const i of this.localDoors()) {
      const b = plan.barriers[i]!
      const d = Math.hypot(b.rect.x - at.x, b.rect.y - at.y)
      if (near === null || d < near.d) near = { i, d }
    }
    if (near === null || near.d > DOOR_REACH) {
      this.say('附近没有门 —— 走到门边（墙上的橙色门框）再按 F')
      return
    }
    const b = plan.barriers[near.i]!
    if (this.doorShut(near.i)) {
      const stage = plan.rooms[this.currentOrder]!
      this.say(
        b.toOrder === null
          ? '这扇门外面是墙外（尽头），过不去'
          : stage.needsFight && !this.cleared.has(this.currentOrder)
            ? '门关着：先把这一间的怪清完（或用 C 模拟清图）'
            : '这扇门已经被落在身后（不回头规则），关死了',
      )
      return
    }
    this.cleared.add(this.currentOrder)
    this.enterRoom(b.toOrder!)
  }

  // ---------------------------------------------------------------- 小地图

  private minimapBox(): PanelBox | null {
    if (!showMinimap) return null
    const width = Math.min(PANEL.mapW, this.scale.width - PANEL.inset * 2)
    if (width < 220) return null
    return {
      x: this.scale.width - PANEL.inset - width,
      y: PANEL.inset,
      width,
      height: PANEL.mapH,
    }
  }

  /**
   * 画小地图。**每帧重画**（玩家在动、门在开关、房间在变清）。
   *
   * 画的东西，从下往上：
   *
   * | 画 | 读的是 |
   * |---|---|
   * | 连廊那几段 | `map.passages`（位置本来就在，画出来是让「三间之间是路不是墙」看得见） |
   * | 三间房 | `currentOrder` / `cleared` |
   * | 每间一条标号 | `ROOM_KIND_LABELS[room.kind]` |
   * | 门上的红绿刻度 | `doorShut(i)` —— **与世界里那一条刻度同一个返回值、同一对颜色** |
   * | 玩家那个白点 | `playerMap()`（世界 → 地图那把尺子） |
   *
   * ⚠️ 这是**示意图**：逐轴两个比例（`sx` / `sy`），所以**别拿它量房间大小**。
   * 一排三间房跨度几千像素、高几百，等比缩放会得到一条线。
   */
  private drawMinimap(): void {
    const panel = this.minimapPanel
    const ink = this.minimapInk
    const title = this.minimapTitle
    const map = this.map
    const plan = this.plan
    if (panel === null || ink === null || title === null || map === null || plan === null) return

    const box = this.minimapBox()
    const show = box !== null
    panel.setVisible(show)
    ink.setVisible(show)
    title.setVisible(show)
    for (const t of this.minimapLabels) t.setVisible(show)
    if (box === null) return

    panel.setPosition(box.x, box.y).setSize(box.width, box.height)
    title.setPosition(box.x + PANEL.pad, box.y + 5).setText(this.minimapTitleText())

    const strip: PanelBox = {
      x: box.x + PANEL.pad,
      y: box.y + PANEL.titleH,
      width: box.width - PANEL.pad * 2,
      height: PANEL.stripH,
    }
    const bounds = map.bounds
    const sx = strip.width / bounds.width
    const sy = strip.height / bounds.height
    const px = (wx: number): number => strip.x + (wx - left(bounds)) * sx
    const py = (wy: number): number => strip.y + (wy - top(bounds)) * sy
    const shapeOf = (r: Rect): { x: number; y: number; w: number; h: number } => ({
      x: px(left(r)),
      y: py(top(r)),
      w: Math.max(1, r.width * sx),
      h: Math.max(1, r.height * sy),
    })

    ink.clear()
    ink.lineStyle(1, MARK.panelEdge, 1)
    ink.strokeRect(box.x + 0.5, box.y + 0.5, box.width - 1, box.height - 1)
    ink.fillStyle(MARK.strip, 1)
    ink.fillRect(strip.x, strip.y, strip.width, strip.height)
    ink.lineStyle(1, MARK.stripEdge, 1)
    ink.strokeRect(strip.x, strip.y, strip.width, strip.height)

    // 连廊：**画成一条细的**，不与房间同高 —— 同高就成了一间窄房，
    // 而「这一条是路、不是房」正是要一眼分出来的事。
    const corridorH = Math.max(2, strip.height * 0.18)
    for (const p of map.passages) {
      const x0 = px(left(p.rect))
      const x1 = px(right(p.rect))
      const cy = py(p.rect.y)
      ink.fillStyle(MARK.passage, 1)
      ink.fillRect(x0, cy - corridorH / 2, Math.max(1, x1 - x0), corridorH)
    }

    // 三间房，三种状态：当前 / 已清 / 还没打。
    for (const room of map.rooms) {
      const r = shapeOf(room.rect)
      const isCurrent = room.order === this.currentOrder
      const cleared = this.cleared.has(room.order)
      ink.fillStyle(
        isCurrent ? MARK.roomCurrent : cleared ? MARK.roomCleared : MARK.room,
        0.9,
      )
      ink.lineStyle(
        isCurrent ? 2 : 1,
        isCurrent ? MARK.roomCurrentEdge : cleared ? MARK.roomClearedEdge : MARK.roomEdge,
        1,
      )
      ink.fillRect(r.x, r.y, r.w, r.h)
      ink.strokeRect(r.x, r.y, r.w, r.h)
    }

    // 门：横竖跟着墙走（竖墙上一条竖的）。
    plan.barriers.forEach((b, i) => {
      const cx = px(b.rect.x)
      const cy = py(b.rect.y)
      const long = Math.max(4, Math.min(14, strip.height * 0.34))
      ink.fillStyle(DOOR_COLOR[this.doorState(i)], 1)
      if (b.axis === 'v') ink.fillRect(cx - 1.5, cy - long / 2, 3, long)
      else ink.fillRect(cx - long / 2, cy - 1.5, long, 3)
    })

    // 每间一条标号。宽到放得下才写关别；放不下就只写号。
    for (const room of map.rooms) {
      const t = this.minimapLabels[room.order]
      if (t === undefined) continue
      const r = shapeOf(room.rect)
      const cleared = this.cleared.has(room.order)
      t.setText(
        r.w >= 44
          ? `#${room.order + 1} ${ROOM_KIND_LABELS[room.kind]}${cleared ? ' ✓' : ''}`
          : `#${room.order + 1}${cleared ? '✓' : ''}`,
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

    const p = this.playerMap()
    const dotX = px(p.x)
    const dotY = py(p.y)
    ink.fillStyle(MARK.player, 1)
    ink.fillCircle(dotX, dotY, 2.5)
    ink.lineStyle(1, 0x000000, 0.8)
    ink.strokeCircle(dotX, dotY, 2.5)
  }

  /** 玩家现在站在**地图**的哪儿（过 `toMap()`，与 `toWorld()` 同一把尺子）。 */
  private playerMap(): Point {
    const s = this.session
    if (s === null) return { x: 0, y: 0 }
    return this.toMap(s.player.x, s.player.y)
  }

  /**
   * 标题只有一行、**只写「看的是哪一层」**。
   *
   * 图例（亮=当前 / ✓=已清 / 门的三色）**不在这里**：这一条按 12px 量，
   * 中文一个字就是 12px，原先把图例全塞进来会顶到 400px 开外 ——
   * 而面板内宽只有 296，画出来是**右边被裁掉半句**，看起来像面板宽度算错了。
   * 图例改到右下角读数里（那边换行自由，也不怕长）。
   */
  private minimapTitleText(): string {
    return `小地图 · 牌 ${seedIndex + 1}/${D2_SEEDS.length} · 种子 ${D2_SEEDS[seedIndex] ?? DEFAULT_SEED}`
  }

  // ---------------------------------------------------------------- 读数与 HUD

  private makeHud(): void {
    const depth = 900
    this.minimapPanel = this.add
      .rectangle(0, 0, PANEL.mapW, PANEL.mapH, MARK.panel, 0.82)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(depth)
    this.minimapInk = this.add.graphics().setScrollFactor(0).setDepth(depth + 1)
    this.minimapTitle = this.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: MAP_TEXT.title,
      })
      .setScrollFactor(0)
      .setDepth(depth + 2)
    this.minimapLabels = this.map!.rooms.map((room) =>
      this.add
        .text(0, 0, '', {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: MAP_TEXT.label,
          align: 'center',
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(depth + 2)
        .setData('order', room.order),
    )

    this.readoutBg = this.add
      .rectangle(0, 0, PANEL.readoutW, PANEL.readoutMinH, MARK.panel, 0.78)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(depth)
    this.readout = this.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: MAP_TEXT.body,
        lineSpacing: 3,
        // ⚠️ **必须换行**：面板是固定宽的一条，读数里却有几行（椅子那条、图例那条）
        // 比它长一倍。不换行的表现是**文字冲出面板、压到画布边上**，
        // 而面板还好好地待在原地 —— 看起来像面板宽度算错了。
        // 有了它，面板高度由 `readout.height` 反推（见 `drawReadout()`），所以长出来的
        // 那几行是**把面板顶高**，不是溢出去。
        wordWrap: { width: PANEL.readoutW - PANEL.pad * 2 },
      })
      .setScrollFactor(0)
      .setDepth(depth + 2)

    this.notice = this.add
      .text(0, 0, '', {
        fontFamily: 'Microsoft YaHei, sans-serif',
        fontSize: '18px',
        color: MAP_TEXT.notice,
        align: 'center',
        stroke: '#0a0e11',
        strokeThickness: 4,
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(depth + 3)

    // 两行、不是一行：一行排下来实测 834px 宽（量过），居中就是 x 223..1057 ——
    // 左边压 `LoadoutHud`（右缘 391）、右边压读数面板（左缘 952），两头都撞。
    // 拆两行后每行 ≤ 470，正好落在两者中间那条空档里（见 `drawReadout()` 的摆位）。
    this.hintsText = this.add
      .text(
        0,
        0,
        [
          'WASD 走 · 左键打 · C 模拟清图 · F 过门 · N 换种子 · R 重开',
          'B 碰撞箱 · L 观感(3 档) · M 小地图 · 1/2/Q 武器 · SPACE 暂停 · ESC 回菜单',
        ].join('\n'),
        {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#8fa6b8',
          align: 'center',
          lineSpacing: 4,
        },
      )
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(depth + 2)

    // ⚠️ 这一个**不** `setScrollFactor(0)`：它跟着门走，摆的是世界里那扇门的位置
    // （`updateDoorHint()` 里 `toWorld()` 的坐标）。本场相机缩放恒为 1、卷动恒为 0，
    // 两种写法画出来一模一样 —— 定成世界坐标是因为**它本来就是世界的**：
    // 哪天相机不压成 1 了，「按 F」会留在原地而门挪走。
    this.doorHint = this.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#9ff0bd',
        stroke: '#0a0e11',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(depth + 3)
      .setVisible(false)

    this.doorMarks = this.add.graphics().setDepth(LOOK_DEPTH + 6)
    this.boxes = this.add.graphics().setDepth(LOOK_DEPTH + 8)
  }

  /** 一帧的读数。行数少、每行都答一个「坏了看不出来」的问题。 */
  private drawReadout(): void {
    const t = this.readout
    const bg = this.readoutBg
    const s = this.session
    const map = this.map
    const plan = this.plan
    const cfg = this.cfg
    if (t === null || bg === null || s === null || map === null || plan === null || cfg === null)
      return

    const stage = plan.rooms[this.currentOrder]!
    const doors = this.localDoors()
    const open = doors.filter((i) => !this.doorShut(i)).length
    const gen = D2_SEEDS[seedIndex] ?? DEFAULT_SEED
    const selfCheck =
      this.mapperError < 0
        ? '未测'
        : this.mapperError <= 1
          ? `✓ ${this.mapperError.toFixed(2)}px`
          : `✗ ${this.mapperError.toFixed(2)}px（尺子与 D1 对不上）`

    t.setText(
      [
        `种子 ${gen}（牌 ${seedIndex + 1}/${D2_SEEDS.length}）· D2 生成 ${elapsedText(this.genMs)}`,
        `第 ${this.currentOrder + 1}/3 间 · ${ROOM_KIND_LABELS[stage.room.kind]}（主干）· 房间 ${stage.room.rect.width}×${stage.room.rect.height}`,
        `取景框 ${plan.box.width}×${plan.box.height} → 世界 ${cfg.arena.width}×${cfg.arena.height}（缩放 ${this.frame.scale.toFixed(3)}）`,
        `碰撞 ${stage.solids.length} 块（墙 ${stage.mix.wall} + 桌 ${stage.mix.desk} + 椅 ${stage.mix.chair} + 门挡板 ${stage.mix.barrier}）· 网格 ${s.terrain.cellSize}px`,
        this.planLine(),
        `门 ${doors.length} 扇 · 开 ${open} / 关 ${doors.length - open} · 反算自检 ${selfCheck}`,
        '图例：小地图亮=当前 ✓=已清 · 门 绿=可过 红=关着（含不回头） 灰=还没走到那一间',
        // 这一行只在**真有椅子**的时候出现，见 `planFloors()` 上面那段 ⚠️。
        stage.mix.chair > 0
          ? `⚠️ 椅子 ${stage.mix.chair} 把：D2 判「挡人不挡弹」，D1 的 solids 只有一张表 → 这里子弹也被挡住`
          : '',
        `D1：${s.runId} · 武器 ${s.weapon.name} · 包 ${s.inventory.length} 件 · 难度 ${DIFFICULTY}`,
        // 视图那一档放在**最后一行**、而且是固定短名：「现在看的是哪一档」是这一场
        // 最容易看错的读数（三档里有两档都是「像教室的画面」）。
        `视图：${lookModeEntry(lookMode).short}（L 换档 · 桌椅的位置与门永远是 D2 的矩形）`,
      ]
        .filter((line) => line !== '')
        .join('\n'),
    )
    const h = t.height + PANEL.pad * 2
    const x = this.scale.width - PANEL.inset - PANEL.readoutW
    const y = this.scale.height - PANEL.inset - Math.max(h, PANEL.readoutMinH)
    bg.setPosition(x, y).setSize(PANEL.readoutW, Math.max(h, PANEL.readoutMinH)).setVisible(true)
    t.setPosition(x + PANEL.pad, y + PANEL.pad)

    // 提示条摆**左下右下两块 HUD 中间的空档**，不是「屏幕正中」：
    // 左下的 `LoadoutHud` 右缘恒定在 391（`18 + 192 + 181`，与窗口宽无关），
    // 右下的读数面板左缘就是上面那个 `x` —— 夹缝中点才是唯一不撞的一条。
    // 缝不够宽（窄窗口）就整个不显示：压住读数比少两行提示更糟。
    const hintCenter = (LOADOUT_RIGHT + x) / 2
    this.hintsText
      ?.setPosition(hintCenter, this.scale.height - PANEL.inset)
      .setVisible(x - LOADOUT_RIGHT >= HINTS_MIN_GAP)
    // 通知条摆**左上角血条的下方**，不是屏幕顶上正中：`StatusHud` 恒定占
    // x 18..431 / y 16..130（18+48+320+8+数字，16+84+30），摆在 y=12 会直接
    // 压在血条和它那串数字上。136 起是它下面第一条不会被盖的位置。
    this.notice?.setPosition(this.scale.width / 2, 136)
  }

  private say(text: string): void {
    this.notice?.setText(text)
  }

  // ---------------------------------------------------------------- 键

  /**
   * 键表。存下来是为了 `SHUTDOWN` 时**只摘自己这几个**。
   *
   * 其实引擎自己会清（`KeyboardPlugin.shutdown()` 里 `removeAllListeners` ——
   * `ArenaBase` 的注释点名过这件事）。这里仍然显式摘，是因为
   * 「监听器清干净了」不该依赖引擎内部行为：Phaser 哪天改成不清，
   * 这一场的表现会是「在别的场子里按 F 还能过门」，而那看起来像按键串台。
   */
  private readonly keyHandlers: [string, () => void][] = []

  private bindKeys(): void {
    const k = this.input.keyboard
    if (k === null) return
    // 空格默认滚页面、ESC 有些浏览器会退出全屏 —— 不捕获的话按一下整页就往下跳。
    k.addCapture(['SPACE', 'ESC', 'C', 'F', 'N', 'R', 'B', 'L', 'M', 'Q', 'ONE', 'TWO'])
    const on = (event: string, fn: () => void): void => {
      k.on(event, fn)
      this.keyHandlers.push([event, fn])
    }
    on('keydown-C', () => this.requestClear())
    on('keydown-F', () => this.passDoor())
    on('keydown-N', () => {
      seedIndex = (seedIndex + 1) % D2_SEEDS.length
      this.restart()
    })
    on('keydown-R', () => this.restart())
    on('keydown-B', () => {
      showBoxes = !showBoxes
      this.boxes?.setVisible(showBoxes)
      this.say(showBoxes ? '碰撞箱：开（绿=D1 造的碰撞体 · 红=寻路网格堵着的格）' : '碰撞箱：关')
    })
    on('keydown-L', () => {
      const at = LOOK_MODES.findIndex((m) => m.id === lookMode)
      lookMode = LOOK_MODES[(at + 1) % LOOK_MODES.length]!.id
      this.applyLookMode()
      this.say(lookModeEntry(lookMode).hint)
    })
    on('keydown-M', () => {
      showMinimap = !showMinimap
      this.say(showMinimap ? '小地图：开' : '小地图：关')
    })
    on('keydown-SPACE', () => this.session?.togglePause())
    on('keydown-ONE', () => this.session?.equipSlot(0))
    on('keydown-TWO', () => this.session?.equipSlot(1))
    on('keydown-Q', () => this.session?.cycleWeapon())
    // ESC 回菜单（与 `ArenaBase` 同一个键、同一个目的地）。这一场是自己 `create()`
    // 的、不继承底座，所以底座绑的那条 `keydown-ESC` 在这里**并不存在** ——
    // 少了它就只能去改地址栏才出得去。
    on('keydown-ESC', () => {
      this.releaseSession()
      this.scene.start(MENU_SCENE_KEY)
    })
  }

  /**
   * 重开本场（`R` / `N`）。**顺序是「先还东西，再 `restart()`」** —— 见文件头那条 ⚠️：
   * 反过来的话，`StageColliders` 的组已经被 Phaser 的 `UpdateList.shutdown` 销毁，
   * 拆的那一下会当场抛，异常冲出 `Game.step()`，整页死。
   */
  private restart(): void {
    this.releaseSession()
    this.scene.restart()
  }

  /**
   * 把 `CombatSession` 还掉并**置空**。三处共用：`R` / `N` 重开、`ESC` 回菜单、
   * `SHUTDOWN` 里的 `teardown()`。
   *
   * 置空是必要的：`restart()` 之后 `update()` 还会被调（`restart` 只发 op，
   * 真正的 stop/start 排在下一个 `processQueue`），不置空就会去更新一个已经拆掉的会话；
   * 顺带也让 `teardown()` 里那一次变成空操作。`CombatSession.destroy()` 自己也有
   * `disposed` 守卫，两道都在 —— 这一条**不许**只留一道。
   */
  private releaseSession(): void {
    this.session?.destroy()
    this.session = null
  }

  /** `C`：模拟清图。已经清过 / 已经请求过就不重复响（与 `BattleScene.requestClear()` 同一套）。 */
  private requestClear(): void {
    const s = this.session
    if (s === null || this.clearEmitted || this.clearAt >= 0) return
    // 暂停中不响，但**要说一句为什么** —— 安静地什么都不发生，看起来像这个键坏了。
    if (s.clock.paused) {
      this.say(s.player.model.alive ? '暂停中 —— 空格继续，再按 C' : '倒下了 —— 按 R 重开本局')
      return
    }
    s.enemies.simulateClear()
    this.clearAt = s.clock.nowMs
    this.say('已请求清图：等分裂链把子代生完、收干净')
  }

  /**
   * 场景关掉时**把借来的东西还掉**。
   *
   * 漏掉的两种后果都不报错：`RewardPanel` 是挂在 `document.body` 上的
   * **DOM 覆盖层**（不是 Phaser 对象，场景的显示列表清不掉它）——
   * 不 `destroy()` 就会一直盖在下一个场子上面；`CombatSession` 在 `window` /
   * `document` 上挂了监听（`blur` / `visibilitychange`），不 `destroy()` 就漏下去。
   */
  private teardown(): void {
    const k = this.input.keyboard
    for (const [event, fn] of this.keyHandlers) k?.off(event, fn)
    this.keyHandlers.length = 0
    this.rewardPanel?.destroy()
    // ⚠️ 走到这里时 session **本该已经是 null**：三条关场景的路（`R` / `N` / `ESC`）
    //    都在场景还活着的时候先还了东西（见文件头那条 ⚠️）。还活着只有一个可能 ——
    //    有人从**外面**停了这个场景，而那时 Phaser 的 `UpdateList.shutdown` 已经先一步
    //    拆过场，会话里的 `StaticGroup` 已经销毁：再拆就抛，而那个异常会从
    //    `Game.step()` 冲出去、**整页死**。所以这里只**记一笔**，不拆。
    //    （代价是漏掉 `CombatSession` 挂在 window / document 上的两个监听。比整页死好。）
    if (this.session !== null)
      console.error(
        'd1d2_rooms：场景关了但 session 还在 —— 多半是有人从外面 stop 了这个场景。' +
          'Phaser 已经先拆过一遍场，此刻再拆 session 会抛并导致整页死，故跳过（见文件头那条 ⚠️）。',
      )
    this.look?.destroy()
    this.boxes?.destroy()
    this.doorMarks?.destroy()
  }

  private showFatal(e: unknown): void {
    const m = e instanceof Error ? e.message : String(e)
    console.error(e)
    this.fatal = this.add.text(40, 120, `d1d2_rooms 初始化失败\n${m}`, {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ff8b8b',
      wordWrap: { width: Math.max(320, this.scale.width - 80) },
    })
    this.fatal.setScrollFactor(0).setDepth(9999)
  }
}

/**
 * 目录读的就是这个（`registry.ts` 用 `import.meta.glob` 自动收，**文件名**就是 `?arena=` 的值）。
 * **类本身不要 export** —— 见 `_ArenaTemplate.ts`：目录只认这个常量。
 */
export const arena: ArenaDefinition = {
  displayName: 'D1×D2：三间教室（战斗 + 转接 + 小地图）',
  description:
    'D1 的真战斗（CombatSession + 三选一）跑在 D2 生成的三间教室里：门是互动点、清完才放行、F 过门换间。C 模拟清图、N 换种子、B 看碰撞箱（D1 造出来的那些块）、L 观感、M 小地图',
  scene: class extends D1D2RoomsScene {
    constructor() {
      super()
    }
  },
}