/**
 * **看一层楼。** 生成器的正确性不是「一张图看起来对」——而是「一千张图都对」。
 * 单测已经把一千个种子扫过了（`gen/generate.test.ts`），这一场解决的是另一件事：
 *
 * **把那个结论从终端搬到屏幕上，并且让人能亲手换。**
 *
 * 为什么值得单独一场：
 *
 * - 单测报「第 837 个种子红了」的时候，人要在脑子里把种子和画面接起来。
 *   这里按 `N` 换种子，红了的那张图**就在眼前**。
 * - 手感、审美这一类的判断（「这一层是不是太空」「走廊是不是太挤」
 *   「教休室怎么跑东边去了」）**写不进断言**。批量扫一遍然后用眼睛看，
 *   是唯一能做这件事的方式。
 *
 * ---
 *
 * ## ★ 2026-10-22：`yf` 那一场并进来了（菜单里的第 2 项与第 3 项合成一项）
 *
 * 用户原话：「合并测试场 2 和 3（因为基本功能差不多）」。
 * 那两场（`d2_seeds` = 换种子、`yf` = 逸夫楼 3F）确实只差一个轴：
 * **`d2_seeds` 换的是种子（内容变、几何不变），`yf` 换的是层（几何变、种子不变）**。
 * 两场都建在同一套东西上（`generateForArena` → `drawFloorplan` → 同一组读数），
 * 版面也一模一样 —— 分成两个文件之后，**改一处读数要改两遍**，
 * 而那正是两份实现开始分岔的地方。
 *
 * **所以这一场现在有两个正交的开关：**
 *
 * | 键 | 换什么 | 变的 | 不变的 |
 * |---|---|---|---|
 * | `N` / `P` / `S` | 种子 | 关别 / 桌椅 / 刷怪点 | 几何（平面图是画死的） |
 * | `C` | 层（1F → 3F → 6F → 1F） | 几何（房间在哪、几间、门开在哪儿） | 种子、关别权重、桌椅规则 |
 *
 * ⚠️ **默认那一层 = 产品一局的第 1 层**，理由不是习惯：
 * **默认那一屏要与玩家真的走进去的那一层一致**，不然「屏幕上看着没问题」
 * 这句话就没有指向。★ 2026-10-22 晚之前这条推出的是 3F（那时 3F 是第 1 层）；
 * 用户「进去后先是 YF1」之后推出来的是 **1F** —— 判据一个字没改，答案跟着产品走。
 *
 * ⚠️ **文件名（= 场子 id）仍然是 `d2_seeds`**，没有跟着改。
 * 改 id 要让 `floorplan.ts` / `framing.ts` / `threeRooms.test.ts` / `test/README.md`
 * 里十来处**注释里提到它的地方**一起改，而那些地方说的都是「这件事当初为什么这么写」——
 * 改完只会让历史读起来对不上。**菜单上那一行（`displayName`）才是给人看的名**，
 * 它跟着这一场现在做的事走。
 *
 * ⚠️ **换层时「盯着哪一间」按层各记一份**（`zoomRoomByPlan`）。不记的话，
 * `C` 会把观测对象整个丢掉（3F 的 `YF302` 在 6F 上根本不存在）——
 * 而这一场为换种子已经立过同一条规矩：**换观测对象必须是人主动做的**
 * （见下面 `switchTo()` 里那段）。按层记一份之后，`C` 两下就回到原处。
 *
 * ---
 *
 * ## ⚠️ 这一场原来是**照着「平面图落地之后」的样子写的**，今天它是照着「现在的样子」写的
 *
 * 用户的要求是「地图要按照 6F 平面图生成」。写这一场的时候（2026-10-19）那件事
 * **还没落地**，所以文件头有一张表，列的是「落地之后哪几个字段还活得下去」——
 * 用的是**将来时**，因为当时写 `room.branch` 会编过、跑起来却是错的。
 *
 * **2026-10-20 落地了**（`model/types.ts` 加了 `id`、删了 `branch` / `anchoredTo` /
 * `RoomBranch` / `sizeTier`，`gen/layout.ts` 换成读 `public/config/floor-plan.json`），
 * 那张表**兑现了**：里面每一行的判断都对，这一场的读数一行都不用改。
 *
 * 那张表删掉了 —— 留着它会变成一份「过去某个时刻的计划」，
 * 而读的人会以为它还在描述**将来**。现在这里只留一句**结论**：
 *
 * > **这一场里不许出现 `branch` / `order`（当排序键用）/ `sizeTier`。**
 *
 * `order` 还在（v5 保留了它），但它是「楼梯间 + 其余按 id 升序」的**编号**，
 * 不是「离起点多远」—— 拿它当「先打哪一间」的顺序读，读出来的是错的。
 * 关别看 `kind`，几何看 `rect` / `doors` / `spawnPoints`，可达性看 `problems`。
 *
 * ---
 *
 * ## 2026-10-21（上半场）：用户报「换种子测试场并不能切换种子」
 *
 * 用 CDP 派**真按键**验过，按键那条路本来是通的（`seed 837 → 13`，关别整片重抽）。
 * 所以这一场补的不是「修好按键」，是把**两件让人以为它坏了的事**堵上：
 *
 * 1. **看不出来换了。** v5 的几何与种子无关（`floor-plan.json` 是画死的），
 *    换种子只换关别 / 桌椅 / 刷怪点 —— 地图形状、房间数、配色**一模一样**。
 *    → 种子号放大摆在图右上角（原来是埋在读数第一行里的一小串），
 *    换完用 `notice` 明说「变了什么、没变什么」。
 * 2. **只能翻那六张固定牌。** → `S` 键 / 「跳到种子…」按钮给一个任意种子。
 *
 * 顺带把「上一张」也做出来了（`P`，底座没占这个键），并且**改种子只有一条路**
 * （`switchTo()`）—— 屏幕上那个种子号今天的唯一来源就是 `currentSeed()`。
 *
 * ## 2026-10-21（下半场）：用户报「换种子看不到桌椅随机生成情况」
 *
 * 前半场那两条**都不管用**，因为这一次的原因在前半场够不着的地方：
 * **桌椅压根没画。** `drawFloorplan` 的 `obstacles` 传的是 `false`，
 * 理由写着「整层缩到 0.12，一张桌子只有几个像素，画了也没信息」——
 * 那个数是**错的**（`80px × 0.12 ≈ 10px`），而错的代价正好是这个 bug：
 * 屏幕上**一片空地**，与「这一层就没有桌椅」是同一幅画面，
 * 于是「桌椅随种子重抽」这件事在屏幕上**根本没有观测手段**。
 *
 * 先量了一遍，确认生成器那边没毛病（六个种子：桌椅布局 **6/6 不同**，
 * 一层 **114—132** 件、单间 **0—18** 件），也就是说这是**纯表现层的缺口**。
 * 补了三件，一件比一件深：
 *
 * 1. **把桌椅画出来**（`obstacles: true`）。整层缩略图上 10px 一块，
 *    看得见分布、看得见「这层楼哪儿有桌椅」，但看不清摆放。
 * 2. **把数目印出来**（`furnitureText()` 那一行）。要在两个种子之间比，
 *    得有一个**能直接比**的数 —— 光看十来个像素的方块是比不出来的。
 * 3. **放大视图**（`V` 键 / 「放大一间」按钮）。同一间房按「本体 + 一格」框住画，
 *    缩放 0.43—0.51（桌椅 34—41px），门标注也在这个视图里画出来
 *    （整层图画门牌会跟房名抢位置）。`B` 换下一间，顺序就是 `map.rooms` 的顺序 ——
 *    **不跳过空房间**：道具关 / 宝箱关 / 楼梯间本来就该是空的
 *    （`gen/obstacles.ts`），转过去看到空地是**答案**不是故障。
 *
 * ⚠️ **换种子时盯住的是哪一间不变**（`zoomRoomId` 在 `switchTo()` 里一个字节都不动）。
 * 这不是顺手：要看的正是「**同一间房的桌椅在两个种子之间怎么变**」。
 * 换完种子自动跳回「桌椅最多的那间」，等于每换一次都换了个观测对象，
 * 两幅画面对不上，看的人只会以为「桌椅根本没规律」。
 *
 * ⚠️ 视图名那一格并进了读数第一行（`D2 · 种子… · 视图…`），不是独立一行 ——
 * 底下的余量只够 13 行，见 `PLAN_HEIGHT` 那段。
 */

import Phaser from 'phaser'
import type { ArenaConfig, ArenaContext, ArenaDefinition } from '../../ArenaBase'
import { ArenaBase, WORLD_WIDTH } from '../../ArenaBase'
import type { RoomsConfig } from '@/domains/procgen/config'
import {
  FLOOR_PLAN_FILES,
  FLOOR_PLAN_NAME,
  FLOOR_PLAN_YF1_NAME,
  FLOOR_PLAN_YF2_NAME,
  FLOOR_PLAN_YF3_NAME,
} from '@/domains/procgen/gen/floorPlan'
import type { FloorPlan } from '@/domains/procgen/gen/floorPlan'
import { drawFloorplan } from '@/domains/procgen/presentation/floorplan'
import { roomWithCell } from '@/domains/procgen/presentation/framing'
import type { DungeonMap, Room } from '@/domains/procgen/model/types'
import { generateDungeon } from '@/domains/procgen/gen/generate'
import { checkReachability } from '@/domains/procgen/validate/reachability'
import {
  DEFAULT_SEED,
  D2_SEEDS,
  furnitureText,
  generateForArena,
  loadProcgenConfigs,
  summarise,
} from './_shared'

/**
 * 缩略图占的高度，下面留给读数。
 *
 * 400 是**算出来的**：底座的按键说明钉在左下角（`Hud.update()` 里
 * `y = 720 − 15*3.4 = 669`，四行），这一场的读数有 **15 行** 12px（行距 3 → 225px），
 * 所以读数从 414 起到 **639** 收 —— 和说明之间留 30px，谁也不压谁。
 *
 * ⚠️ **这个数跟着行数走过两步，两次都是「先数行、再倒推」**：
 *
 * | 什么时候 | 行数 | PLAN_HEIGHT | 读数起 | 读数收 |
 * |---|---|---|---|---|
 * | 原来 | 12（当时被误写成 11） | 430 | 444 | 624 |
 * | 2026-10-21（加了桌椅一行） | 13 | 430 | 444 | **639** |
 * | ★ 2026-10-22（`yf` 并进来，加了平面图 + 商店两行） | **15** | **400** | 414 | **639** |
 *
 * 两次都把**收在 639** 钉住（离 669 留 30px）——**动的是上面那个数，不是底下这段**。
 * 再加行之前先回来算这一行：每加一行吃掉 15px，从 639 到 669 只剩两行的余量。
 *
 * ⚠️ **从 430 降到 400 不损失任何信息 —— 这不是「缩了一点」，是「多出来的空白」。**
 * 缩略图永远是被**宽度**卡住的（`scale = min(1260/楼层宽, (高−20)/楼层高)`），
 * 而楼层高缩完远不到 400：
 *
 * | 地图 | 宽×高 | scale | 缩完的高 |
 * |---|---|---|---|
 * | **v5：平面图（唯一的一张，与种子无关）** | **10520 × 2920** | **0.122** | **355px** |
 * | ~~v4 的生成器~~（已删，今天没有任何一张图长这样） | ~~5600—7520 × 840—960~~ | ~~0.17—0.23~~ | ~~143—210px~~ |
 *
 * ⚠️ **上面两行的位置 2026-10-21 对调过。**原表把「现在的生成器」写在第一行，
 * 那说的是 **v4**：几何按种子算，六张牌的实测宽度在 5600—7520 之间。v5 起
 * `generateDungeon` 只读平面图，**整层楼换多少个种子都是这 10520×2920**
 * —— 所以「现在的生成器」今天就是平面图那一行，v4 那行留作对照（不再是「现在的」）。
 *
 * ★ 2026-10-22 补一句：**三张平面图的包围盒逐像素一样**（1F / 3F / 6F 都铺满
 * 0..263 × 0..73 格），所以上表那一行对**三层楼都成立** —— 这一场按 `C` 换层时
 * 缩略图的缩放、位置一个像素都不动，差别只在图上画的是什么（3F / 6F 差西头那
 * 一块是 SHOP 还是两间教室，1F 是两块分开、中间一个大厅 `C_HALL`）。
 * 这不是巧合，是产品那条硬要求（`floors.test.ts` 钉着）：物理世界边界在
 * `CombatSession` 构造时定死，哪两层不一样大的话，在那两层之间换层会当场抛。
 *
 * 平面图这一行是 2026-10-19 按配置表算的，**不是估计**：S 形把楼层的宽高比
 * 从 8:1 拉到 3.6:1，高度从「空一大截」变成「占掉八成三」—— 但仍然装得下。
 * 再往上加东西之前先回来算这一行，别凭感觉。
 *
 * ⚠️ 这一行**改过一次**：重测平面图之前写的是 241×50 格 / 9640×2000 / 266px，
 * 那是照第一张较模糊的照片量的，`YF612` 的位置与 `YF604` 的宽度都是错的。
 * 差的那点余量（400 − 355 = 45px）就是**别再加读数行**的意思。
 */
const PLAN_HEIGHT = 400

/**
 * 3F 那间合并出来的商店。**在那一层里是唯一的非编号空间** ——
 * 6F 的对位是 `YF601` + `YF615` 两间教室。
 *
 * ⚠️ 这一行**是有前提的**：`SHOP` 这个 id 只存在于 3F 那份平面图里。
 * 所以下面读数里那句「商店 …」要**按 `plan` 查**、查不到就说「这一屏没有商店」，
 * 不能照着「3F 一定有商店」写死 —— 那正是 `yf.ts` 当初修过的那个 bug
 * （切到 6F 之后读数还在报 3F 的商店，而屏幕上西头明明是两间教室）。
 */
const SHOP_ID = 'SHOP'
/**
 * `A` 键批量扫的种子个数。
 *
 * ⚠️ 这里原来写的是「约 30ms 一个，所以 100 个会卡住三秒左右」—— **量错了，差了七倍**。
 * 2026-10-15 实测（1000 个种子逐个计时，最慢的一个 6.6ms）：生成 + 可达性合计
 * **约 4ms 一个**，100 个 = 0.42 秒。这个数还印在屏幕上过，见下面 `A` 的提示语。
 *
 * 量错的代价不是难看：真正把页面弄死的那件事（见 `A` 的处理函数里那段）被
 * 「大概就是扫得慢吧」盖住了整整一天。
 */
const SWEEP_COUNT = 100
/** 批量扫的起点。与 `generate.test.ts` 的种子表同一起点、同一段步长。 */
const SEED_BASE = 13

// ⚠️ 模块级：`scene.restart()` 会把场子实例销毁重建，实例字段留不住。
let seedIndex = D2_SEEDS.indexOf(DEFAULT_SEED as (typeof D2_SEEDS)[number])
if (seedIndex < 0) seedIndex = 0
/** 上一次按 `A` 的结果。**跨 restart 保留** —— 不然按完键换了场景，结果就没了。 */
let sweepReport: string | null = null
/**
 * 用 `S` 或「跳到种子…」指定的种子。**`null` = 没指定**，这时按 `D2_SEEDS`
 * 那六张牌翻。
 *
 * 为什么要它能脱离那六张牌：单测报「第 12345 个种子红了」的时候，人想看的是
 * **那一个**种子；六张固定牌翻不到它，于是「换种子」这四个字就打了折。
 *
 * ⚠️ 指定过之后 `seedIndex` **就不再参与决定**了（见 `currentSeed()`）——
 * 再按 `N` 会先清掉它，回到牌堆上。别让两个来源同时活着：
 * 「屏幕上写着 837、实际生成的是 12345」是这一场最不该出现的一类读数。
 */
let customSeed: number | null = null
/** 刚换过种子的那一下要说的话。`onArenaCreate` 里变成 HUD 的 notice（用完即清）。 */
let switchNote: string | null = null
/**
 * 放大看哪一间房（`Room.id`）。**`null` = 看整层**。
 *
 * ★ 新增（2026-10-21）：用户报「换种子看不到桌椅随机生成情况」。这一场原来
 * **只画整层**（缩略图 0.12，一张 80px 的桌子 10px），桌椅压根没画出来（见下）。
 * 修的时候补了两件事，一件是「把桌椅画出来」，另一件就是这个**放大视图**：
 * 同一间房按「本体 + 一格」框住画，缩放 **0.43—0.51**，桌椅 34—41px，看得清摆放。
 *
 * ⚠️ **存 `id` 而不是下标**：几何与种子无关（平面图是画死的），
 * 所以换种子时同一间房还在老地方 —— 这正是这一场要的读法：
 * **盯住一间，按 `N`，看它的桌椅怎么重抽**。存下标的话，
 * 哪天 `map.rooms` 的顺序一变（`order` 那条约定的松动），
 * 「盯住的那间」会**静默换成隔壁**，而画面上只是桌椅不一样了。
 *
 * ★ 改了（2026-10-22）：**按层各记一份**（`zoomRoomByPlan`，见下面那个函数）。
 * 原来是一个裸变量 —— 换种子没问题（同一层楼里房号不变），
 * **换层就成了一个必定失效的值**：3F 的 `YF302` 在 6F 上根本不存在，
 * 于是 `zoomRoom()` 退回「桌椅最多的那间」，`C` 按两下回不到原处。
 * 「换层时观测对象必须是人主动换的」和换种子是同一条规矩（见 `switchTo()`）。
 */
const zoomRoomByPlan: Record<string, string | null> = {}

/** 这一场现在盯着哪一间。**`planName()` 是那把钥匙** —— 三层楼各记各的。 */
function zoomRoomId(): string | null {
  return zoomRoomByPlan[planName()] ?? null
}

/** 改「盯着哪一间」。**唯一一处**写它 —— 换种子那条路**不调这个函数**（见 `switchTo()`）。 */
function setZoomRoomId(id: string | null): void {
  zoomRoomByPlan[planName()] = id
}

/**
 * `C` 键能切的层。**这一张表的顺序就是 `C` 的顺序**，第 1 项是进来的默认层。
 *
 * ★ 改了（2026-10-22）：**原来是 `show6f` 一个布尔**（3F ⇄ 6F 两层）。
 * 逸夫楼 1F 那张图加进来之后两层不够用了 —— 而两个布尔（`show6f` + `show1f`）
 * 会立刻多出「两个都是 true」这个不存在的状态，于是每个读它的地方都要自己
 * 决定那种状态意味着什么，而它们会各自决定得不一样。**一个下标配一张表**
 * 没有那个状态：`C` 就是 `(i + 1) % 3`。
 *
 * ★ 又改了（2026-10-22 晚）：**这一张表的顺序现在与 `floors.json` 逐项相同**
 * （1F → 3F → 6F），默认值也换成了 1F。上一版是 `[3F, 6F, 1F]`，把 1F 排在最后
 * 是因为它当时不在局里 —— 恰好让「按一下 `C`」落在产品的第 2 层上。现在三层
 * 都真的在一局里了，**没理由再让场子的顺序与产品的顺序不一样**：
 * 一样的话，「按 `C` 就是产品里的下一层」这句话对**每一次**按键都成立，
 * 唯一的例外只剩绕回第 1 层那一下（一局打完就结束，不会再回到第 1 层）。
 *
 * ⚠️ **默认 1F 不是随手选的**：进来第一屏要与**玩家真的走进去的那一层**一致
 * （一局的第 1 层现在是 1F），不然「屏幕上看着没问题」这句话没有指向。
 */
// ★ 改了（2026-10-23）：**四层**了（2F 的图做出来了）。顺序与 `floors.json` 逐项对齐。
const FLOOR_PLANS: readonly string[] = [
  FLOOR_PLAN_YF1_NAME,
  FLOOR_PLAN_YF2_NAME,
  FLOOR_PLAN_YF3_NAME,
  FLOOR_PLAN_NAME,
]

/** 与 `FLOOR_PLANS` **逐项对齐**的层名（给人看的）。加一层要两张表一起加。 */
const FLOOR_TEXTS: readonly string[] = [
  '逸夫楼 1F（第 1 层）',
  '逸夫楼 2F（第 2 层）',
  '逸夫楼 3F（第 3 层）',
  '6F（第 4 层 · 最后一层）',
]

/**
 * 看的是哪一层 —— `FLOOR_PLANS` 的下标。
 *
 * ⚠️ 与别的一样是**模块级**的（`scene.restart()` 会把实例销毁重建）——
 * 而且这一条比别的更要紧：`C` 的实现就是「改它 + `restart()`」，
 * 放实例字段上的话按一下 `C` 切过去、再按一下切不回来（每次都从头开始）。
 */
let floorIndex = 0

/** 这一屏画的是哪一份平面图（也是 `generateForArena` 要的那把钥匙）。 */
function planName(): string {
  return FLOOR_PLANS[floorIndex]!
}

/**
 * 这一层叫什么（给人看的）。**图右上角那行大字与读数第一行都读它** ——
 * 两处不许各写一遍：「62 层」与「6F」对不上时，没有人能判断哪个是真的。
 */
function floorText(): string {
  return FLOOR_TEXTS[floorIndex]!
}

/**
 * 按一下 `C` 会去哪一层（照着同一张表算，不写死名字）。
 *
 * 上一版有个地方把「按 C 看 3F」**写死在字符串里**（6F 那一屏的商店行）——
 * 顺序一换，那句话就指错了层，而它长得跟所有正确的话一模一样。
 */
function nextFloorText(): string {
  return FLOOR_TEXTS[(floorIndex + 1) % FLOOR_PLANS.length]!
}

/** 这一场现在看的是哪个种子。**唯一一处**决定它 —— 按钮 / 按键 / 读数全都读它。 */
function currentSeed(): number {
  return customSeed ?? D2_SEEDS[seedIndex] ?? DEFAULT_SEED
}

/** 图右上角那行大字。**「第几张牌」与「自定义」要分得出来** —— 见 `customSeed`。 */
function seedText(): string {
  return customSeed === null
    ? `种子 ${currentSeed()}（第 ${seedIndex + 1}/${D2_SEEDS.length} 张牌）`
    : `种子 ${currentSeed()}（自定义）`
}

/**
 * 放大视图里那一间房。**`zoomRoomId` 认不出来时退回「桌椅最多的那一间」** ——
 * 不抛、也不留在 `null`：换层/换几何之后原来那间没了，这一场该做的事
 * 是「换一间继续看」，不是把整个场子弄空。
 *
 * 「桌椅最多」这条默认是给**第一眼**用的：按 `V` 进来的人要看的正是桌椅，
 * 而缩略图上桌椅最多的那间恰好是最糊的那间（也是 `furnitureText()` 印出来的那间）。
 * 并列时按 `map.rooms` 的顺序取第一个 —— 定死的，同一个种子永远挑到同一间。
 */
function zoomRoom(map: DungeonMap): Room | null {
  const known = map.rooms.find((r) => r.id === zoomRoomId())
  if (known) return known
  let best: Room | null = null
  for (const r of map.rooms) if (best === null || r.obstacles.length > best.obstacles.length) best = r
  return best
}

/** 视图名。**整层 / 放大谁** —— 读数和 notice 都读它，两处不许各写一遍。 */
function viewText(room: Room | null): string {
  return zoomRoomId() === null || room === null ? '整层' : `放大 ${room.id}`
}

/** 换种子之后那句统一的话。**把「什么变了、什么没变」写出来** —— 见下面按钮那段。 */
function switchMessage(room: Room | null): string {
  return (
    `已换到 ${seedText()} · 关别 / 桌椅 / 刷怪点已重抽 · ` +
    // ⚠️ 原来这里写的是「地图形状不会变（floor-plan.json 是画死的）」——
    //    今天有**两张**平面图了，而这句话在换种子那条路上仍然成立
    //    （换种子不改 `planName()`），所以只说「平面图」，不点名哪一个文件。
    '地图形状不会变（平面图是画死的，与种子无关）' +
    (zoomRoomId() === null ? ' · 按 V 放大看一间' : ` · 正盯着 ${room?.id ?? '?'}，桌椅会跟着重抽`)
  )
}

/**
 * 换层之后那句统一的话。`prevRoomId` = **换之前**那一层盯着的那一间（没放大就是 `null`）。
 *
 * ⚠️ 这一句必须**同时**说清三件事，少一件都会让人以为切坏了：
 *
 * 1. **换到哪一层了**（3F 与 6F 缩到 0.12 之后绝大部分像素一样，只差西头那块；
 *    1F 是两块分开的，一眼就认得出来）；
 * 2. **什么跟着变了**（几何、房间数，以及**这一层的首领房号**）；
 * 3. **什么没变**（种子、关别权重、桌椅规则）—— 这正是这一场存在的理由：
 *    同一颗种子、同一个视图，**只有几何不同**，就是用户那句
 *    「其他的几乎 YF6 相同」在屏幕上该有的样子。
 *
 * ⚠️ 还有第四件，是**这一场特有的**：**视图掉回整层要说出来**。
 * 盯哪一间是**按层各记一份**的，所以从「放大 YF302」按 `C` 过去，
 * 另一层要是还没放大过，画面会**从放大变成整层** —— 那是一个**看得见的**变化，
 * 但不说清它就会被读成「按 C 把视图弄丢了」。宁可写一句长话。
 *
 * ⚠️ **第 2 件事有个例外，`hasBoss` 就是为它来的**：逸夫楼 1F
 * **13 间全是空房**（用户：「YF1 所有房间都是空房间，不生成任何东西」），所以
 * 「首领房号跟着变」那句话在它身上是**假的** —— 照着念的话，人会去找一间
 * 根本不存在的首领房。宁可当场说出来。
 *
 * ★ 2026-10-22 晚：**那句话的后半截也要说对**。1F 现在真的排在**一局的第 1 层**，
 * 而没有首领房的那一层**没有门槛**（`BattleScene.bossDown()`：找不到首领房
 * 就当作已打倒）—— 所以这一层是「进来就能上楼」的过渡层，不是「这儿缺了个东西，
 * 等 D2 补上」。读数是这一场唯一说得出这件事的地方，写成「还没有首领房」听着像
 * 一个待修的缺口，而它其实是设计。
 */
function floorMessage(prevRoomId: string | null, hasBoss: boolean): string {
  const where = floorText()
  const changed = hasBoss
    ? '几何整个换掉了（房间数、门、首领房号都跟着变）'
    : '几何整个换掉了（房间数、门都跟着变）· ⚠️ 这一层**没有首领房 = 没有门槛**，进来就能从楼梯间上楼（设计如此，不是缺一块）'
  const head = `已换到 ${where} · ${changed} · 种子不变`
  const mine = zoomRoomId()
  if (mine !== null) return `${head} · 这一层盯着 ${mine}（盯哪一间按层各记一份）`
  if (prevRoomId !== null) {
    return `${head} · 上一层盯着 ${prevRoomId}，这一层还没放大过 —— 现在回到整层（按 V 放大）`
  }
  return `${head} · 按 V 放大看一间`
}

/**
 * 这一层的平面图里有没有**钉死的首领房**（`fixed: 'boss'`）。
 *
 * ⚠️ 读的是**缓存里那份原始 JSON**，不是硬编码「1F 没有首领」——
 * 谁哪天在 `floor-plan-yf1.json` 里给某间房写上 `fixed: 'boss'`，
 * `floorMessage` 那句话当场跟着变，不用回来改这里。
 *
 * ⚠️ 它只看 `fixed`，**而`fixed` 不是首领房的全部来源**：首领也可能由
 * 种子从 `roomKindWeights` 抽出来（今天 `rooms.json` 明令不许，所以两条路
 * 等价）。这一场读的是**平面图**，所以问的是平面图上钉没钉 —— 读数那句话
 * 说的是「这一层没有钉死的首领房」，不是「这一层保证没有首领房」。
 *
 * ⚠️ 参数是**缓存**而不是 `Phaser.Scene`：`toggleFloor()` 里手边只有
 * `this.scene`（那是 `ScenePlugin`，不是 `Scene`，类型上拿不到 `cache`）。
 * 而这一场真正需要的也只是缓存这一样东西 —— 传 `Scene` 等于要一个用不上的大对象。
 */
function planHasBoss(cache: Phaser.Cache.CacheManager): boolean {
  const raw = cache.json.get(planName()) as { rooms?: { fixed?: unknown }[] } | undefined
  return raw?.rooms?.some((r) => r.fixed === 'boss') ?? false
}

/** 切视图 / 换一间之后那句统一的话。**说清现在在看什么、怎么再看下一间**。 */
function viewMessage(room: Room | null): string {
  if (zoomRoomId() === null || room === null)
    return '视图：整层（V 放大看一间 —— 桌椅在缩略图上只有十来个像素，放大才看得清摆放）'
  return (
    `视图：放大 ${room.id}（${room.kind}） · 桌椅 ${room.obstacles.length} 件 · ` +
    'B 看下一间 · V 回整层 · N 换种子时**会盯住这一间**重抽'
  )
}

/**
 * 一个能点的「按钮」。**测试场里没有 UI 组件**（`AGENTS.md` §七的「刻意不引入」），
 * 所以就是一个上了底色、`setInteractive` 过的 `Text`。
 *
 * 为什么要按钮而不只是留按键：按键那条路要求**页面有键盘焦点**，
 * 而「没反应」与「这个键坏了」在现场长得一模一样。有得点，就不用先怀疑焦点。
 */
function button(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onClick: () => void,
): Phaser.GameObjects.Text {
  const t = scene.add
    .text(x, y, label, {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#cfe6ff',
      backgroundColor: '#1b2c44',
      padding: { x: 8, y: 4 },
    })
    .setDepth(1000)
    .setInteractive({ useHandCursor: true })
  t.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onClick)
  t.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => t.setColor('#ffffff'))
  t.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => t.setColor('#cfe6ff'))
  return t
}

/** 按钮行离画布右边留的余量。 */
const BUTTON_ROW_MARGIN = 16

/**
 * 把一行按钮按**实测宽度**摆开、**贴着画布右边**对齐。
 *
 * ⚠️ **两个坑都是量出来的**（`D:\homework\_d2probe\layout.mjs`、
 * 合并后重量的 `_d2probe\merge_shot.mjs`）：
 *
 * 1. **写死 x 会跑到画布外。** 原来五个按钮写的是 `620/770/920/1075/1225`，
 *    前四个看着挺好，第五个（后加的「下一间（B）」）右边缘落到了 **1335px**，
 *    而画布只有 1280 —— 它**半截在画布外**，看截图才发现。所以按 `Text.width` 排。
 * 2. **右对齐，不是居中。** 读数在左边是一整块，而按钮行**竖直方向躲不开**
 *    （2026-10-22 重量：读数 y 414—636，按钮 y 440—461），只能靠水平方向让开。
 *    居中摆会让头两个按钮**压在读数块上**。
 *
 * ⚠️⚠️ **判据是「逐行」，不是「整块的外框」** —— 2026-10-22 合并两个场子时
 * 在这里差点误判一次。读数是一个多行 Text，`Text.width` 是**最长那一行**
 * （实测 600px，是 `★ 商店 SHOP …` 那句，在 y 562），而**按钮带 y 440—461 里
 * 只有第 1—3 行**（`seed 837` / `房间 …` / `楼层 …`，最宽 198px，右缘 206）。
 * 拿外框 608 去比按钮行左缘 473，会报出一个**今天根本没发生**的碰撞，
 * 然后诱导人去删一条好端端的读数（或反过来，放宽判据把真碰撞放过去）。
 * **会盖住字的只有落在按钮带里的那几行**，所以 `merge_shot.mjs` 现在借一个
 * 临时 Text 逐行量宽度，断言的是「按钮带里的行都没伸到按钮行底下（206 < 473）」。
 */
function layoutButtonRow(row: Phaser.GameObjects.Text[]): void {
  const GAP = 22
  const total = row.reduce((n, t) => n + t.width, 0) + GAP * (row.length - 1)
  // 钳 12：一行真摆不下时宁可挤在左边界，也不要再从右边溢出去。
  let x = Math.max(12, WORLD_WIDTH - BUTTON_ROW_MARGIN - total)
  for (const t of row) {
    t.setX(x)
    x += t.width + GAP
  }
}

class D2SeedsArena extends ArenaBase {
  /**
   * 这一层的图。**存一份给按键处理函数用** —— `V` / `B` 要知道现在有哪几间房
   * 才能换下一间，而按键回调活在 `onArenaCreate` 的闭包里、场景重建后不复用。
   *
   * ⚠️ 它是**这一场自己的**字段，不是底座的：底座那边有 `enemies` 之类的运行时，
   * 跟这张图无关。名字避开 `map` 是因为 `Map` 这个名字在这一行代码周围太容易读混。
   */
  private floorMap: DungeonMap | null = null

  protected get definition(): ArenaDefinition {
    return arena
  }

  override preload(): void {
    super.preload()
    loadProcgenConfigs(this)
  }

  protected configure(): ArenaConfig {
    return { rngSeed: 0xd25e }
  }

  protected override onArenaCreate(ctx: ArenaContext): void {
    const seed = currentSeed()
    // ⚠️ 第三个参数是**这一屏画的是哪一层**（`C` 换它）。不传的话这一场永远画 6F，
    //    而右上角那行大字照样写着「逸夫楼 3F」——**读数和画面各说各的**，
    //    两句话看着都对。
    const { map, cfg, plan, elapsedMs } = generateForArena(ctx.scene, seed, planName())
    this.floorMap = map
    const reach = checkReachability(map, cfg)

    // 层缩略图 / 单间放大。**两个视图走同一个 `drawFloorplan`** ——
    // 配色、门、刷怪点的画法天然一致；各写一份绘制才是分叉的开始（见那个文件头）。
    // 唯一的差别是 `world`：整层不传（= `map.bounds`），放大传「这一间 + 一格」。
    //
    // ★ 改了（2026-10-21，用户报「换种子看不到桌椅随机生成情况」）：
    //   **桌椅从 `false` 改成 `true`。** 原来关着的理由是
    //   「整层缩到 0.12，一张桌子只有几个像素，画了也没信息」——
    //   **那个数是错的**：桌子 `80px` × `0.12` ≈ **10px**，不是「几个像素」。
    //   而桌椅确实是随种子重抽的（实测六个种子：布局 **6/6 不同**，
    //   一层 114—132 件、单间 0—18 件），只是**从来没画出来过**，
    //   于是「看不到桌椅随机生成情况」在屏幕上就是**一片空地** ——
    //   与「这一层就没有桌椅」是同一幅画面。现在整层能看见分布、放大能看清摆放。
    //
    // 门标注这一列：**整层关、放大开**。整层上 16 扇门的牌子会跟房名抢位置
    // （那是「特写才画」这条分工），而在放大视图里只有这一间的门在框里，
    // 正是要读它的场合 —— 于是那个视图也**有义务印出筛掉几条**
    // （`FloorplanView.labelsDropped`，见下面读数行那段）。
    // ⚠️ `_classroomLook.ts` **不画门标注**（grep `label` 零命中），它是落地后重做
    // 1:1 特写时要照抄的那份观感层；而 1:1 那一路今天**同样没有场子在跑**
    // （原调用方 `d2_classroom` 已删）—— 别照这行去 `_classroomLook.ts` 里找门牌。
    // 用显式 `false` 而不是靠默认值：默认值改了，这里会跟着变，而这一场
    // 多出十几条字看起来只会像「缩略图更挤了」，不会像「有东西变了」。
    const room = zoomRoom(map)
    const zooming = zoomRoomId() !== null && room !== null
    const view = drawFloorplan(ctx.scene, map, cfg, {
      x: 0,
      y: 0,
      width: WORLD_WIDTH,
      height: PLAN_HEIGHT,
      labels: true,
      doors: true,
      spawns: true,
      obstacles: true,
      doorLabels: zooming,
      passageLabels: zooming,
      ...(zooming ? { world: roomWithCell(cfg, room!) } : {}),
    })

    const mark = (ok: boolean): string => (ok ? 'OK' : '× 红了')
    // 走廊净宽**逐段量**（顺序同 `map.passages`），这里报的是这一层的最小—最大。
    // 不报平均值：平均值会把「某一段被堵成 40」稀释掉，而那是要当场看见的。
    const clear = reach.passageClearWidths
    const lo = clear.length === 0 ? 0 : Math.min(...clear)
    const hi = clear.length === 0 ? 0 : Math.max(...clear)
    const clearText = clear.length === 0 ? '—' : lo === hi ? `${lo}px` : `${lo}..${hi}px`
    // ★ 新增（2026-10-22，`yf` 并进来时补的那一行）：**这一屏画的是哪一份平面图**。
    //   用户那句「YF3 地图加入到游戏里」落地之后，3F 与 6F 是**两份真文件**
    //   （`floor-plan-yf3.json` / `floor-plan.json`），而缩略图上 3F 与 6F
    //   绝大部分像素是一样的 —— 只写「逸夫楼 3F」是**给人看的名字**，
    //   这个名字与那一份文件名对不上的时候（加错文件、写错默认值），
    //   屏幕上没有任何东西会红。所以文件名要单独印一行出来。
    //   ⚠️ 说的是「与产品同一份 —— 玩家走进的就是它」：这一场与 `BattleScene`
    //   走的是**同一条取数路径**（`floorPlanFromCache`），不是「长得像」。
    //   ★ 但这句话**只对产品真的排进一局的那几张成立**（`FLOOR_PLAN_FILES`）。
    //   ★ 2026-10-22 晚：**今天三张都在里面**（1F 也进了一局），所以下面那个
    //   分支走的一律是前半句。留着他是因为 `_shared.ts` 的
    //   `ARENA_EXTRA_PLAN_NAMES` 那一格还开着（场子切一张产品不用的图是**允许的**，
    //   1F 就当过一阵子），那时这一行必须改口 —— 不然它对着玩家走不进去的一层
    //   说「玩家走进的就是它」。
    const onProduct = FLOOR_PLAN_FILES.includes(planName())
    const planLine =
      `这一层的平面图：${planName()}（` +
      (onProduct ? '与产品同一份 —— 玩家走进的就是它' : '★ 产品里还没有这一层 —— 今天只在这个场子里看') +
      '）'
    // ⚠️ 查的是**这一屏画的那一份**（`plan` 是 `generateForArena` 交回来的那一张），
    //   不是某个写死的名字。第一版查的是「3F 那一份」，于是切到 6F 那一屏时
    //   这一行照样在说「商店 SHOP x0 y25 …」，而屏幕上（6F）西头明明是
    //   YF601 / YF615 两间房。**读数与画面各说各的**，这正是这一场最不该出现的
    //   那种坏法：两句话看着都对。
    const shop = plan.rooms.find((r) => r.id === SHOP_ID)
    const shopLine =
      shop === undefined
        ? `★ 这一屏没有商店：这一层的西头是编号教室 —— 按 C 看 ${nextFloorText()}`
        : `★ 商店 ${SHOP_ID} x${shop.cells.x} y${shop.cells.y} ${shop.cells.width}×${shop.cells.height} 格` +
          ` = ${Math.round(shop.rect.width)}×${Math.round(shop.rect.height)}px` +
          ' · 空房（非战斗关：不摆桌椅、不刷怪）· 3F 特有的那一间'
    const lines = [
      `D2 · ${floorText()} · 视图 ${viewText(zooming ? room : null)}`,
      ...summarise({ map, cfg, plan, elapsedMs }),
      '',
      `层 1 可达 ${mark(reach.layer1Ok)}（走过 ${reach.visitedRooms}/${reach.roomCount} 间）` +
        ` · 层 2 可达 ${mark(reach.layer2Ok)}`,
      `走廊 ${clear.length} 段 · 净宽 ${clearText} · 最窄窄口 ${reach.narrowestOpeningWidth}px` +
        `（下限 ${cfg.minPassageWidth}px）`,
      // ★ 新增（2026-10-21）：桌椅的**数目**。用户要「看桌椅随种子怎么变」，
      //   而缩略图上桌椅只有十来个像素 —— 看得见形状，说不出数目、更比不了两个种子。
      //   （一行里的三个数各说什么，见 `furnitureText()` 的注释。）
      furnitureText(map),
      planLine,
      shopLine,
      // ⚠️ **这一行原先是 `view.labelsDropped === 0 ? '标注全画下了' : …`，那是个谎。**
      //
      // `FloorplanView.labelsDropped` 只数**门标注**，而且只在门标注开着时才赋值
      // （房名与走廊名都不进这个数）。整层视图传的是 `doorLabels: false`，
      // 所以它在那里**恒为 0** —— 照「调用方有义务印出来」把 0 印成「标注全画下了」，
      // 读的人会以为「十几个门牌全挤得下」，而整层视图**一扇门牌都没画**。
      // 屏幕上的「都挤得下」与「没画」是同一句话，这正是最该避免的那种读数。
      //
      // ★ 改了（2026-10-21）：**放大视图真的画门标注了**（`doorLabels: true`），
      // so 义务在那一侧成立、这里就照义务印。所以这一行**按视图分岔**：
      // 整层说「为什么不画」，放大报「画了几条、筛掉几条」——
      // 两个视图各自印自己真实发生的事，不互相借读。
      zooming
        ? `门牌筛掉 ${view.labelsDropped} 条（框里就这一间的 ${room!.doors.length} 扇门）` +
          ' · 0 = 都画得下'
        : '门牌整层视图不画（那是 1:1 特写的活，整层图上会跟房名抢位置；按 V 放大时画）',
      reach.problems.length === 0
        ? '问题：无'
        : `问题 ${reach.problems.length} 条：${reach.problems[0]}`,
      '',
      sweepReport === null
        ? `按 A 扫 ${SWEEP_COUNT} 个种子（同步跑，约 0.4 秒）`
        : sweepReport,
    ]
    ctx.scene.add
      .text(8, PLAN_HEIGHT + 14, lines.join('\n'), {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: reach.layer1Ok && reach.layer2Ok ? '#9ad4ff' : '#ff9a9a',
        lineSpacing: 3,
      })
      .setDepth(1000)

    // ---- 「现在看的是哪一层、哪个种子」要**一眼看见**，而且**点得到** ----
    //
    // ⚠️ 这一块是 2026-10-21 补的（那一版只有种子）。起因是用户报
    // 「换种子测试场并不能切换种子」，而在真浏览器里用 CDP 派真按键验过：
    // **按键那条路是通的**（seed 837 → 13，关别整片重抽）。所以这里补的是
    // **另外两件事** —— 它们才是「看着像坏了」的来源：
    //
    // 1. **看不出来换了。** v5 的几何与种子无关（平面图是画死的），
    //    换种子只换关别 / 桌椅 / 刷怪点，地图形状、房间数、配色**一模一样**。
    //    连按几次 `N`，画面像「什么也没发生」。对策：种子号放大摆在图上，
    //    换的那一下用 `notice` 把「什么变了、什么没变」直接写出来。
    // 2. **只能翻那六张牌。** 单测报「种子 12345 红了」时看不到那一个。
    //    对策：`S` 键 / 「跳到种子…」按钮给一个任意种子。
    //
    // ★ 2026-10-22（`yf` 并进来）**同一件事轮到「层」了，而且更难**：
    //   三张平面图的包围盒逐像素一样，缩到 0.12 之后 3F 与 6F **绝大部分像素
    //   是一样的**，只有西头那一块不同（SHOP 一间 还是 YF601/YF615 两间）；
    //   1F 是两块分开的，一眼认得出来。
    //   所以层名与种子**并排摆在右上角**、字号一样大 —— 按 `C` 换层时
    //   那一行字必须跟着变，否则「切了没反应」和「按键坏了」在现场长得一样。
    //
    // 按钮而不是只留按键，是因为「按了没反应」和「这个键坏了」在现场长得一样 ——
    // 有得点，就不用先怀疑页面有没有键盘焦点。
    ctx.scene.add
      .text(WORLD_WIDTH - 12, 10, `${floorText()}\n${seedText()}`, {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffd7a0',
        backgroundColor: '#0d1526ee',
        padding: { x: 10, y: 5 },
        align: 'right',
      })
      .setOrigin(1, 0)
      .setDepth(1001)

    // 视图那几个按钮：**「看不到桌椅」这件事在屏幕上要有一条出路**。
    // 只留按键的话，人得先知道有 `V` / `B` 这两个键才会去按 ——
    // 而报这个 bug 的人的原话是「看不到」，不是「按键没反应」。
    //
    // ⚠️ **这一行从 5 个变成 6 个**（2026-10-22 加了换层那个）。
    //    它会与左边的读数块**在竖直方向重叠**（读数从 `PLAN_HEIGHT + 14` 起，
    //    按钮在 `PLAN_HEIGHT + 40`）—— 躲不开，只能靠**水平方向让开**，
    //    见 `layoutButtonRow()` 的注释。所以这一行里**再加一个按钮之前**，
    //    先量一遍它在屏幕上从 x 几开始（`_d2probe/merge_shot.mjs` 量过这一版）。
    //    ⚠️ 同一天晚些时候那个按钮的文案从「切换 3F ⇄ 6F（C）」缩成「换一层（C）」
    //    （1F 加进来之后那句话不再成立，而写全「3F/6F/1F」会变长）——
    //    **变短是安全的**，变长才要重量一遍。
    layoutButtonRow([
      button(ctx.scene, 0, PLAN_HEIGHT + 40, '◀ 上一张（P）', () => this.switchTo({ delta: -1 })),
      button(ctx.scene, 0, PLAN_HEIGHT + 40, '下一张（N）▶', () => this.switchTo({ delta: 1 })),
      button(ctx.scene, 0, PLAN_HEIGHT + 40, '跳到种子…（S）', () => this.askSeed()),
      button(ctx.scene, 0, PLAN_HEIGHT + 40, '放大一间（V）', () => this.switchView(null)),
      button(ctx.scene, 0, PLAN_HEIGHT + 40, '下一间（B）', () => this.switchView(1)),
      button(ctx.scene, 0, PLAN_HEIGHT + 40, '换一层（C）', () => this.toggleFloor()),
    ])

    // ⚠️ `ev.repeat` 必须挡掉。浏览器按住不放会按系统重复率**不停地**发 keydown，
    // 而 `A` 每次都要同步跑 100 次生成（0.4 秒）再重建场景 ——
    // 按住不放 = 一串 0.4 秒的冻结接在一起，手感上就是卡。
    // （顺带：`A` 同时也是底座的「向左走」键，松开就好，这一场没有墙，走不出事。）
    //
    // ⚠️ **2026-10-15：「按 A 卡死」查出来不是这一场的问题，也不是 0.4 秒的问题。**
    // 真实链条是 `scene.restart()` → 场景 `SHUTDOWN` → 底座 `teardown()` →
    // `EnemySystem.shutdown()` 里 `physics.world` 已经是 null → TypeError →
    // ① `restart` 的 `start` 那条 op 永远轮不到 ② 异常冲出 rAF 回调、Phaser 不再排下一帧
    // → **帧号冻住，整页死**。按 `N` / `R` 一样死，跟扫种子一个字的关系都没有。
    // 修在 `EnemySystem.shutdown()`（D3 的文件，已同步），详细分析在那个方法的注释里。
    // 留在这里的教训是**读数**那一层：屏幕上的「会卡住约 3 秒」把真凶盖住了 ——
    // 一个偏大七倍的估算，比没有估算更容易让人以为是「就是慢」。
    ctx.scene.input.keyboard?.on('keydown-N', (ev: KeyboardEvent) => {
      if (ev.repeat) return
      this.switchTo({ delta: 1 })
    })
    // ⚠️ **不bind `R`** —— 底座把 `R` 占成了 `scene.restart()`（`ArenaBase.ts:742`），
    // 同一个键再绑一个「上一张牌」会变成「重启两次、种子只退一格」。
    // `P` 底座没占。（`S` 底座当「向下走」用，这一场没有墙，和上面 `A` 同理。）
    ctx.scene.input.keyboard?.on('keydown-P', (ev: KeyboardEvent) => {
      if (ev.repeat) return
      this.switchTo({ delta: -1 })
    })
    ctx.scene.input.keyboard?.on('keydown-S', (ev: KeyboardEvent) => {
      if (ev.repeat) return
      this.askSeed()
    })
    ctx.scene.input.keyboard?.on('keydown-A', (ev: KeyboardEvent) => {
      if (ev.repeat) return
      sweepReport = runSweep(cfg, plan)
      this.scene.restart()
    })
    // `V` = 整层 ⇄ 放大（切视图），`B` = 放大里换下一间。
    ctx.scene.input.keyboard?.on('keydown-V', (ev: KeyboardEvent) => {
      if (ev.repeat) return
      this.switchView(null)
    })
    ctx.scene.input.keyboard?.on('keydown-B', (ev: KeyboardEvent) => {
      if (ev.repeat) return
      this.switchView(1)
    })
    // `C` = 换层（1F → 3F → 6F → 1F）。**底座没占这个键**（`ArenaBase` 只绑了
    // 空格 / 0 / R / I / E / Esc，移动是 WASD + 方向键）。
    ctx.scene.input.keyboard?.on('keydown-C', (ev: KeyboardEvent) => {
      if (ev.repeat) return
      this.toggleFloor()
    })

    // 换过种子 / 换过层的那一下，`notice` 报的是**这一次换了什么**；平时才报按键说明。
    // ⚠️ 这一行**长度是量过的**：notice 是**一行居中、不折行**的 20px 字，
    //    超过约 1200px 就会顶到画布边上。加一项之前先按「CJK 20px / ASCII 12px」估一遍。
    ctx.hud.setNotice(
      switchNote ??
        'N / P 翻种子　S 指定种子　C 换层　V 放大一间　B 换下一间　A 批量扫 100 个',
    )
    switchNote = null
  }

  /**
   * 换种子。**这是唯一一处改种子的地方**（`currentSeed()` 读的就是它改的那两个变量）。
   *
   * 翻牌与指定种子是**互斥**的：`delta` 一律先清掉 `customSeed`。
   * 理由是屏幕上那个数必须**只有一个来源** —— 「写着 837、生成的是 12345」
   * 是这一场最不该出现的一类读数（见 `customSeed` 那段）。
   */
  private switchTo(next: { delta: number } | { explicit: number }): void {
    if ('explicit' in next) {
      customSeed = next.explicit
    } else {
      customSeed = null
      seedIndex = (seedIndex + next.delta + D2_SEEDS.length) % D2_SEEDS.length
    }
    // ⚠️ **盯着哪一间，一个字节都不动**：换种子时「盯住的是哪一间」必须保持 ——
    //    用户要看的是**同一间房的桌椅在两个种子之间怎么变**，
    //    换完种子自动跳回桌椅最多的那间，等于每换一次都换了个观测对象，
    //    两幅画面对不上，看的人只会以为「桌椅根本没规律」。
    //    （它认不出来时会由 `zoomRoom()` 退回默认那间，见那个函数。）
    //    ★ 2026-10-22 起这句话有了第二层意思：`setZoomRoomId` 在换种子这条路上
    //    **一次都不调**，而「按层各记一份」也保证换层时另一层那个值不被写坏。
    switchNote = switchMessage(this.viewRoom())
    // 重建场景 = 用新种子重跑一遍生成，顺带把上一次的 `sweepReport` 画面清掉。
    this.scene.restart()
  }

  /**
   * 换层（1F → 3F → 6F → 1F）。**这是唯一一处改 `floorIndex` 的地方**。
   *
   * ⚠️ **不碰 `zoomRoomByPlan`** —— 每层各记各的（见 `zoomRoomId()`）：
   * 3F 的 `YF302` 在 6F 上不存在，共用一个值的话按一下 `C` 观测对象就没了，
   * 而「换观测对象」必须是**人主动做的**（和换种子同一条规矩）。
   * 按层记一份之后，`C` 按三下回到原处 —— 那正是「同一颗种子看几层楼差在哪儿」
   * 这个用法要的：**盯住的那间如果几层都有对位，三次 `C` 之后还在原处**。
   *
   * ⚠️ `sweepReport` 也**不清**：`A` 扫的是**当前这一层的平面图**，
   * 换层之后那一行报的是上一层的结论 —— 所以它自带层名吗？不。所以换层时
   * 清掉它更诚实（见下）。留着的话屏幕上会出现「扫完了：全绿」而那一层
   * 其实没扫过，且**看不出来**。
   *
   * ⚠️ `zoomRoomId()` **必须在翻 `floorIndex` 之前读** —— 它按 `planName()` 取钥匙，
   * 翻完之后读到的已经是**新那一层**的值了。这里读它是为了给 `floorMessage`
   * 一句「上一层盯着 X」，好解释「怎么按一下 C 就从放大掉回整层了」。
   *
   * ⚠️ `planHasBoss()` **也要在翻之前调不了、翻之后调** —— 它读的是
   * `planName()` 指的那一份，所以顺序与 `prevRoomId` **正好相反**。
   * 两个一前一后，写反的话 `floorMessage` 会拿错层去判断有没有首领房。
   */
  private toggleFloor(): void {
    const prevRoomId = zoomRoomId()
    floorIndex = (floorIndex + 1) % FLOOR_PLANS.length
    sweepReport = null
    switchNote = floorMessage(prevRoomId, planHasBoss(this.scene.systems.cache))
    this.scene.restart()
  }

  /**
   * 切视图 / 换一间看着的房。**`delta === null` = 整层 ⇄ 放大 切换**。
   *
   * 换一间的**顺序就是 `map.rooms` 的顺序**（楼梯间在前，然后按 id 升序）——
   * 不筛掉没有桌椅的那几间：道具关 / 宝箱关 / 楼梯间**本来就该是空的**
   * （`gen/obstacles.ts`），转过去看到一片空地是**答案**，不是故障。
   * 把它们跳过去，人就看不出「桌椅只出现在战斗关和精英关」这一条了。
   */
  private switchView(delta: number | null): void {
    const map = this.floorMap
    if (map === null) return
    if (delta === null) {
      // 整层 → 放大：落在 `zoomRoom()` 挑的那一间（桌椅最多的那间）。
      setZoomRoomId(zoomRoomId() === null ? (zoomRoom(map)?.id ?? null) : null)
    } else {
      const n = map.rooms.length
      // 认不出来时 `at` 取 -1 → 下一步落在第 0 间（楼梯间），而不是**跳回**第 1 间：
      // 从「没在放大」按 `B` 应该是「从第一间开始看」，不是「从第二间开始」。
      const at = zoomRoomId() === null ? -1 : map.rooms.findIndex((r) => r.id === zoomRoomId())
      const next = (((at + delta) % n) + n) % n
      setZoomRoomId(map.rooms[next]?.id ?? null)
    }
    switchNote = viewMessage(zoomRoomId() === null ? null : zoomRoom(map))
    this.scene.restart()
  }

  /** 这一场当前盯着哪一间。整层视图（或场景还没建）给 `null`。 */
  private viewRoom(): Room | null {
    const map = this.floorMap
    return map === null || zoomRoomId() === null ? null : zoomRoom(map)
  }

  /** 问一个任意种子。**取消 / 填了不是数的东西都不重建场景** —— 见下。 */
  private askSeed(): void {
    const raw = window.prompt('跳到哪个种子？（非负整数）', String(currentSeed()))
    if (raw === null) return
    const n = Number(raw.trim())
    // `Number('')` 是 0、`Number('  ')` 也是 0 —— 空串不能当种子 0 收下。
    // 负数与小数也挡掉：`deriveSeed` 那边是 `>>> 0`，收下会**静默变成另一个种子**。
    if (raw.trim() === '' || !Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      // ⚠️ 这里**不**重启场景：重启会把这张图连同刚才的读数一起清掉，
      // 而人看到的只是「画面闪了一下又一样」—— 拼错的代价不该是丢掉现场。
      this.ctx.hud.setNotice(`「${raw}」不是种子：要给一个非负整数（比如 837）`)
      return
    }
    this.switchTo({ explicit: n })
  }
}

/**
 * 批量扫。**读数和单测用的是同一个 `checkReachability`** ——
 * 这里不许另写一份判定：两份判定对同一张图给出不同结论，
 * 就是「测试场绿了但产品是坏的」那条没有报错的失败链。
 *
 * 只读 `problems` 这一个字段（不读 `passageClearWidths` 那些），
 * 理由见文件头那张表：**判据可以换实现，`problems` 这个名字不会换。**
 *
 * 步长 `7919`（第 1000 个质数）取自 `generate.test.ts` 的同一张种子表 ——
 * 刻意不换数：两边扫的是**同一批**种子，屏幕上绿了而终端里红了这种事才藏不住。
 *
 * ⚠️ `plan` 是**从外面传进来的**，不是在这里解析 —— 整层几何与种子无关，
 * 100 个种子用的是同一份。放进循环里就是白解析 100 遍同一份表。
 *
 * ★ 2026-10-22（`yf` 并进来）：传进来的是**当前这一层**的平面图，
 * 所以扫的是**这一屏看的那一层**。⚠️ 于是 `toggleFloor()` 里**必须清掉
 * `sweepReport`** —— 不清的话换层之后屏幕上还挂着上一层的「全绿」，
 * 而那一层这一趟根本没扫过，且**看不出来**。
 *
 * ⚠️ 报的句子里**不带层名**（「扫完了：…全绿」）—— 这是上面那条清空规则存在的理由。
 * 哪天想让结论跨层保留，就得把它连层名一起印出来，不能只留着不改。
 */
function runSweep(cfg: RoomsConfig, plan: FloorPlan): string {
  const t0 = performance.now()
  let failed = 0
  let firstBadSeed: number | null = null
  let firstBadProblem = ''

  for (let i = 0; i < SWEEP_COUNT; i++) {
    const seed = SEED_BASE + i * 7919
    const r = checkReachability(generateDungeon(seed, cfg, plan), cfg)
    if (r.problems.length > 0) {
      failed++
      if (firstBadSeed === null) {
        firstBadSeed = seed
        firstBadProblem = r.problems[0] ?? ''
      }
    }
  }

  const ms = performance.now() - t0
  if (failed === 0) {
    return `扫完了：${SEED_BASE} 起 ${SWEEP_COUNT} 个种子**全绿**，共 ${ms.toFixed(0)}ms（${(ms / SWEEP_COUNT).toFixed(1)}ms/层）`
  }
  return (
    `扫完了：${SWEEP_COUNT} 个种子里红了 ${failed} 个，共 ${ms.toFixed(0)}ms。` +
    `第一个是种子 ${firstBadSeed}：${firstBadProblem}`
  )
}

export const arena: ArenaDefinition = {
  // ★ 改了（2026-10-22）：原来是「D2 · 换种子」。**id（文件名）没跟着改**，
  //   理由见文件头 —— 菜单上这一行才是给人看的名，它跟着这一场现在做的事走。
  displayName: 'D2 · 换种子 / 换层',
  // ⚠️ 这句是**一行画到底、不折行**的（`Hud.setTitle` 只把 name 和 description
  // 用 \n 拼起来），所以**超过约 110 个字就会被画布右边缘切掉**。
  // 写得下的细节放这个文件的头部注释里，这里只留"一眼要看到的"。
  description:
    'N / P 翻种子 · S 跳到任意种子 · C 换层（1F → 3F → 6F）· V 放大看一间 · B 换下一间 · A 批量扫 100 个。换种子时盯住同一间房，好直接比它怎么重抽；换层时种子不变，只换几何。图上按钮同样能点。',
  scene: D2SeedsArena,
}