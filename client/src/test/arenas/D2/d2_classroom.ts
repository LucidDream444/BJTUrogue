/**
 * **一间教室，1:1。** D2 的地图生成里最容易出「没有任何报错」的那一类问题，
 * 全都发生在这一间的尺度上 —— 所以这个场子不缩放。
 *
 * ## 一场一图：D2 的判定 vs 底座的判定
 *
 * 这个场子存在的理由只有一个：**把两套格子摊在同一张画面上。**
 *
 * | | D2（产品里用的） | 底座 `ArenaBase.makeNav`（D3 建的） |
 * |---|---|---|
 * | 格子边长 | `rooms.json` 的 `navCellSize` = 40px | `GRID_SIZE * 2` = 80px（写死） |
 * | 网格原点 | `navExtentFor()` 吸附到 40 的整数倍 | `0`（写死） |
 * | 输入 | 墙 **+ 障碍物** | 只有 `cfg.walls` |
 *
 * 三条里任何一条不同，判出来的可走性就不同。**决定性的是第三条**：
 * `ArenaBase.makeNav` 只吃 `cfg.walls`，而 `configure()` 交给底座的 `walls` 就是
 * 墙本身 —— 课桌**从头到尾没进过底座的网格**。所以在这个场子里，底座的寻路
 * 看不见课桌，怪**绕不开**桌子：物理拦得住它（2026-10-15 起也给怪接了静态体），
 * 可导航还在让它朝前走，于是它**顶着桌子原地磨**。
 * **「挡得住」和「绕得开」是两件事 —— 这两句谁都别替谁说话。**
 *
 * 前两条是**另一笔账**，别跟上面混成一句。实测 200 个种子 / 13018 件障碍物，
 * 按「这件障碍物里落进至少一个格心」（= 会被标成堵的那条规则）去数：
 * 底座那套（原点 0、80px）是 **13018 件**，产品那套（`navOrigin`、40px）也是 **13018 件**
 * —— **两种格子一件都没漏**。差别不在「看不看得见」，在**粒度**：
 * 一件桌椅平均把 1.6 个 80px 格心盖成堵，换成 40px 是 2.2 个。
 *
 * 所以「换格子尺寸」**并不能**替代「把障碍物喂进去」—— 结论没变，
 * 但**别再拿「80px 会漏掉课桌」当理由**：它不漏，它只是粗。
 * （首版这里写的是「只盖住 564 / 2388 件」，那个数复现不出来 —— 计数只往上数、
 * 落在负坐标上的桌椅一格都没数到。结论歪打正着，理由是错的。）
 *
 * 画面上：**红格是 D2 的判定**（红 = 这一格中心站不了），**青色细线是底座的 80px 格子**。
 * 桌子上有红格、青线跨过去的地方一格都不红 —— 那就是「两套格子」的样子。
 *
 * ⚠️ 这不是 bug，是**还没有人对齐过**。对齐的代价、对齐之后谁改谁，
 * 是 D3 与 D2 之间的一件待办（见 `tasks.md` 6.6）。
 * 在它解决之前，**这个场子跑起来不等于可达性被验证了** —— 它只证明
 * 「D2 自己算的那份判定自洽」，而那份判定已经被 `generate.test.ts` 在
 * 1000 个种子上扫过了，不需要靠看画面来证明。
 *
 * ## 这个场子**验什么**（2026-10-14 起能自己动手验了）
 *
 * 这一场有了真的碰撞体：`collisionInBox()` 把 `collidersOf()` 的三张表
 * 裁进取景框、换算到屏幕，喂给底座（`ArenaBase.buildCollision`）。所以能试的有三件：
 *
 * - **玩家被墙 / 课桌 / 椅子挡住** —— WASD 撞上去会停。
 * - **子弹被课桌挡、被椅子放行** —— 左键照着一排桌椅打过去：子弹停在课桌前沿、
 *   从椅子上头扫过去（椅子压根不在挡弹表里）。**这是「椅子不挡弹」第一次
 *   能被肉眼看见** —— 在那之前它只是 `colliders.ts` 里的一行 `filter`。
 * - **门洞里那块挡板封得住** —— `E` 全关 / 全开，再撞、再开枪，人和子弹都过不去。
 *   几何是 D2 交的（`collidersOf().barriers`），**「什么时候关」是 D1 的场景逻辑**
 *   （进房关门、清完开门），底座那个键只是把「能不能封住」演出来。
 * - **怪撞得住桌椅和墙**（2026-10-15 补的）—— 底座给怪也接了同一组静态体
 *   （`ArenaBase.attachEnemyColliders`）。怪是**按速度积分**走的，所以这是真挡，
 *   不是摆样子：把它们往课桌上赶，会停在桌子前沿。
 * - **门标注 / 连廊标注读得出**（2026-10-15 补的，`room-transitions`）—— 就是
 *   「分支关的门没连上下一个主干道关」那一条在 1:1 尺度上的样子：`→N` = 穿过去到哪一间
 *   （同一个洞只标一次、标在宿主那一侧），`连廊 a→b` = 那一段连廊。推导与缩略图是
 *   **同一份**（`presentation/framing.ts`），所以两个尺度上写着同一个号。
 *   实测：被右侧读数压住的正是东侧那几条，按 `Q` 收起读数就能看见。
 *
 * ## 这个场子**仍然验不了**什么（不许含糊过去）
 *
 * - **战斗期间关门 / 不回头** —— 那是 D1 的场景逻辑，D2 只负责把门的位置写对。
 * - **怪绕不绕得开课桌** —— 这一条**和上面那条「撞得住」是两件事**，别混。
 *   怪往哪儿走是**寻路网格**说了算，而底座的 `ArenaBase.makeNav` 只吃 `cfg.walls`，
 *   桌椅从头到尾没进去过（上面那张表第三条）。所以这一场里怪会**顶着课桌原地磨**
 *   —— 物理不让它过，寻路还在让它往前走，两边在打架。
 *
 *   那**不是**碰撞接错了：产品里两边是一致的（产品的网格 `walkability.buildGrid`
 *   吃障碍物），不一致的只有测试场这个底座。要对齐得先让 `makeNav` 看见障碍物，
 *   那是 D3 与 D2 之间的待办（见 `tasks.md` 6.6）。
 *   **所以别拿这一场里「怪贴着桌子磨」的画面去判断怪的 AI 对不对。**
 *
 * 在这一场里还能看见的是**几何本身**：门开在哪条边、墙上留没留缺口、
 * 桌子有没有压住门、刷怪点是不是都落在空地上、红格和青线对不对得上。
 */

import type Phaser from 'phaser'

import type { ArenaConfig, ArenaContext, ArenaDefinition, ArenaSpawnSpec } from '../../ArenaBase'
import { ArenaBase, GRID_SIZE, WORLD_HEIGHT, WORLD_WIDTH } from '../../ArenaBase'
import type { RoomsConfig } from '@/domains/procgen/config'
import { roomViewBox, wallsNearRoom } from '@/domains/procgen/presentation/framing'
import { drawRoom1to1, mapperFor, type Mapper } from '@/domains/procgen/presentation/floorplan'
import { containsPoint } from '@/domains/procgen/model/rect'
import type { DungeonMap, Point, Rect, Room, RoomKind } from '@/domains/procgen/model/types'
import { ROOM_KIND_LABELS } from '@/domains/procgen/model/types'
import { cellCenter, cellOf, gridOfMap, isBlockedCell } from '@/domains/procgen/walkability'
import {
  chooseClassroom,
  collisionInBox,
  DEFAULT_SEED,
  elapsedText,
  generateForArena,
  loadRoomsConfig,
  nearestSpawn,
  screenRect,
} from './_shared'

/** 场上最多放几只怪。**这是测试场的密度，不是产品数值** —— 产品按威胁预算刷。 */
const MAX_ENEMIES = 4

/**
 * 读数栏：画布右边那一条，**压在取景框的东侧留白上**，不是一条空出来的列。
 *
 * 这是算过的，不是凑合：取景框最宽 **1120**（最大档教室 640 + 东西两段连廊 400
 * + 两格留白 80），画布只有 1280 —— 居中之后框占 `x 80..1200`，
 * **右边再没有一条 272px 宽的干净列**了。旧版这里写着「框最宽 1000，从 1008 起是干净的」，
 * 而 1000 的框居中之后到 1140，**本来就是叠着的** —— 那句话只是没人核过。
 *
 * 之所以还能这么放：框的东侧那 240px 是**门外**（连廊、邻居的墙根），
 * 教室本体最宽 640 *（每个主干教室西边都是连廊，所以它至少从框内 240 处起）*，
 * 居中之后止于 `x ≤ 960` —— 读数栏从 1008 起，**压不到这一间房本身**。
 * 压到的是：东侧那段连廊、以及（这一间挂侧室时）侧室东头的一角。
 *
 * 为什么不往下放：底座的按键说明钉在左下角（`Hud.update()` 里
 * `y = 画布高 − LINE*3.4`，四行），读数放下去两段会叠在一起 ——
 * 而「字叠在一起」在现场看起来就是「读数没印出来」。
 * ⚠️ 上面两条都依赖「主干教室最宽 640」：档位表将来要是出了更宽的房间，
 * 教室本体就会伸进读数栏底下，而那时表现是**读数被地图压住**，不是报错。
 *
 * ⚠️ **2026-10-15：压住的正是新加的门标注，所以补了 `Q` 一键收起。** 读数栏盖的是
 * 「东侧那段连廊」—— 而门标注（`→10` / `→11`）**就落在那段连廊上**（种子 837 实测：
 * `→11` 落在屏幕 x≈1060，栏从 1008 起）。两边都是要读的字，叠在一起就都读不出来，
 * 而且现场看起来像「这一扇门没标」——正是这一轮要修的那类错觉。
 *
 * 收起而不是挪走：取景框宽 1120、消不掉（上面那段），栏宽 272 是长行的下限，
 * 所以**没有任何一种摆法是两全的**。给一个开关，两种看法各按各的。
 */
const READOUT_X = WORLD_WIDTH - 272
const READOUT_WIDTH = 272
/** 每行的高度。11px 字 + 4px 行距。 */
const READOUT_LINE = 15

/**
 * 按「全角 = 1、半角 = 0.55」估宽换行。**只是估算，不追求精确。**
 *
 * 为什么不用 Phaser 的 `wordWrap`：它默认按**空格**断词，而中文行里一个空格都没有
 * —— 整行会被当成一个超长单词整段甩出去，越过右边界。断早一点没代价，
 * 断晚了字就跑出画布。
 */
function wrap(text: string, maxUnits: number): string[] {
  if (text === '') return ['']
  const out: string[] = []
  let line = ''
  let used = 0
  for (const ch of text) {
    const u = ch.charCodeAt(0) < 0x2e80 ? 0.55 : 1
    if (used + u > maxUnits) {
      out.push(line)
      line = ''
      used = 0
    }
    line += ch
    used += u
  }
  out.push(line)
  return out
}

/*
 * 这里原来有一个 `shift(r, dx, dy)`：把地图坐标平移成屏幕坐标。
 *
 * **删掉它不是简化，是因为它本身就是那个 bug。** 平移公式在这个文件里写了两遍
 * （一遍给墙、一遍给出生点和刷怪点），而**碰撞几何那一遍漏了** ——
 * 于是墙画在这儿、人撞在别处，且没有任何报错。现在整场的换算只有 `mapper`
 * 一份（`mapperFor` 造的，和 `drawRoom1to1` 内部用的是同一条式子），
 * 「换到屏幕」这件事一律经 `screenRect()` / `mapper.toScreen()`，
 * **没有第二个地方可以再写一次平移**。
 *
 * （细节见 `_shared.ts` 的 `collisionInBox` —— 那里记了表现和是怎么发现的。）
 */

/**
 * **地图上的一个点**落在哪一格、那一格站不站得住（`mx` / `my` 是**地图坐标**）。
 *
 * ## 这一行为什么值得留着
 *
 * 出生点的「站得住」是生成器**构造**出来的（`gen/spawns.ts`：房间内部 +
 * 从门可达 + 网格上不堵），而玩家**能不能站在那儿**是物理说了算的。
 * 这一行就是让两边当面对账：生成器说空、这里也报 `free`，两边一致；
 * 哪天它报出 `obstacle` 或 `wall`，就是两处判定分岔了 ——
 * 而分岔在别处只会表现成「人有时候会卡一下」，没有谁会查得出来。
 *
 * 三种分开报，因为能做的事完全不同：
 *
 * - `free`：正常。
 * - `obstacle`：格心被**课桌**盖住了 —— 生成器的问题，去查生成器。
 * - `wall`：格心落在**墙**上 —— 同上，只是挡住它的是墙不是桌子。
 *
 * ## 为什么拿**格心**去问，而不是拿这个点本身
 *
 * `buildGrid` 是按**格心采样**盖章的（一格堵不堵只看它的中心），所以这里也
 * 取格心去问障碍物，才和那张网格同口径。拿点本身去问会比网格宽松一点点，
 * 点在格边上时两边的答案就分岔了 —— 而这里正是来对账的。
 */
function cellStateAt(map: DungeonMap, mx: number, my: number): SpawnCell {
  const grid = gridOfMap(map)
  const { cx, cy } = cellOf(grid, mx, my)
  if (!isBlockedCell(grid, cx, cy)) return 'free'
  // 「堵」是**格心**被判定的，所以拿格心去问障碍物：`buildGrid` 只从两个来源盖章
  // （墙、障碍物），没被障碍物盖住就一定是墙。
  const c = cellCenter(grid, cx, cy)
  for (const room of map.rooms) {
    for (const o of room.obstacles) if (containsPoint(o.rect, c.x, c.y)) return 'obstacle'
  }
  return 'wall'
}

/**
 * 出生点那一格的状态。**三种分开报**，因为能做的事完全不同
 * （`free` 正常 / `obstacle` 查生成器 / `wall` 同上）。
 *
 * 合成一句「出生点被挡住」，看的人只能两个方向都查一遍；而红色每次都亮的话，
 * 人就学会不看红色了 —— 那才是真的丢掉了这条读数。
 */
type SpawnCell = 'free' | 'obstacle' | 'wall'

function spawnCellText(state: SpawnCell): string {
  if (state === 'free') return '出生点那一格是空地 —— 与生成器的判定一致'
  if (state === 'obstacle') {
    return '⚠ 出生点那一格被课桌盖住 —— 生成器说这儿站得住、网格说堵，两处判定分岔了，去查生成器'
  }
  return '⚠ 出生点那一格是墙 —— 生成器说这儿站得住、网格说堵，两处判定分岔了，去查生成器'
}

/**
 * 一串关别 → 中文名，用 `/` 连起来（给读数的配置行用）。
 *
 * 认不出来的键**原样印出来**，不吞：配置里混进一个表里没有的关别时，
 * 屏幕上得看得见它是谁 —— 印成空白的话，那一行看起来只是「少了个词」，
 * 而校验器报的那条错误（`kind 必须是 ROOM_KINDS 里的值`）也就没人会去对。
 */
function kindNames(kinds: readonly string[]): string {
  return kinds.map((k) => (k in ROOM_KIND_LABELS ? ROOM_KIND_LABELS[k as RoomKind] : k)).join('/')
}

interface ClassroomLayout {
  map: DungeonMap
  cfg: RoomsConfig
  room: Room
  /** 要画的世界矩形（地图坐标）。**不对称**，见 `roomViewBox` */
  box: Rect
  /** `drawRoom1to1` 要的落点 */
  screenX: number
  screenY: number
  elapsedMs: number
  /** 地图坐标下的、裁过的那几段墙 */
  walls: Rect[]
  /** 玩家出生点**那一格**是什么（拿地图坐标去问的网格），见 `cellStateAt` */
  spawnCell: SpawnCell
  /** 玩家**实际**从哪儿进场（屏幕坐标）。是最近的那个刷怪点，见 `nearestSpawn` */
  spawn: Point
}

class D2ClassroomArena extends ArenaBase {
  /** `configure()` 里算好、`onArenaCreate()` 里画 —— **两处必须用同一份几何**。 */
  private layout: ClassroomLayout | null = null

  /**
   * 读数栏的两个对象（底板 + 字），`Q` 一起收/展。
   *
   * 存引用而不是「按深度去场景里捞」：场景根上还有底座画的一堆方块，
   * 捞错一个的失败模式是**收起了不该收的东西**（地图少一块），而不报错。
   *
   * 类型写具体而不是 `GameObject`：`visible` / `setVisible` 在 Phaser 里是
   * `Components.Visible` 这个 mixin 带来的，**基类 `GameObject` 上没有** ——
   * 写成 `GameObject[]` 就得在循环里强转，而强转会把「哪天换成没这个组件的对象」
   * 变成运行时静默（那个对象收不起来，画面看着像键无效）。
   */
  private readoutParts: (Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text)[] = []

  protected get definition(): ArenaDefinition {
    return arena
  }

  override preload(): void {
    super.preload()
    loadRoomsConfig(this)
  }

  protected configure(): ArenaConfig {
    const { map, cfg, elapsedMs } = generateForArena(this, DEFAULT_SEED)
    // 上限**不在这一行传** —— 两个场子要问同一间房，上限就得是同一份，
    // 所以它连同 `WORLD_WIDTH/WORLD_HEIGHT` 一起封在 `chooseClassroom` 里（见 `_shared.ts`）。
    const room = chooseClassroom(map, cfg)
    if (room === null) {
      // 挑不到就抛。**不兜底去画第一间房** —— 兜底会把「生成器变了」
      // 伪装成「这个场子只是凑合着跑」，而那时候看场子的人正是要判断生成器变了没有。
      throw new Error(
        `[d2_classroom] 种子 ${map.seed} 里挑不出一间放得下的主干教室 ` +
          `（要求：非起点/首领、含课桌、刷怪点 ≥ 2、1:1 摆进 ` +
          `${WORLD_WIDTH}×${WORLD_HEIGHT}）。换个种子，或者看 d2_seed_sweep ` +
          `确认生成器是不是把尺寸档位改了。`,
      )
    }

    const box = roomViewBox(map, cfg, room)

    // 框在画布上居中。**顺序很重要：先定框、再算落点** —— 反过来（按玩家出生点
    // 去推框的位置）会把框顶出画布，房间缺一角，而缺一角看起来和「生成器没生成
    // 这段墙」一模一样。
    //
    // 框最大 1120×680（最大档教室 640 + 东西两段连廊 400 + 两格留白 80；
    // 高 280 + 侧室 320 + 两格留白 80），塞得进 1280×720；
    // `chooseClassroom` 已经用同一个尺寸挡过一遍，这里不会算出负数。
    const screenX = (WORLD_WIDTH - box.width) / 2
    const screenY = (WORLD_HEIGHT - box.height) / 2

    // **这一场唯一的换算器**（`scale = 1`：这一场不缩放，它就是个纯平移）。
    // 不进 `layout`：`configure()` 里就用完了，`onArenaCreate()` 不读它
    // （绘制自己按 `box` + `screenX/screenY` 换算，见那边）。
    //
    // 用 `mapperFor` 而不是自己写 `screenX - left(box)`：`drawRoom1to1` 内部
    // 用的就是这一条式子（`floorplan.ts`：「所有绘制都走它，别处不许再写一次
    // 平移公式」），所以两者**按构造**一致，不靠「两处算出来碰巧相等」。
    // 喂给底座的墙、碰撞几何、刷怪点、出生点也全都过它 —— 整场只有它一份平移。
    const mapper = mapperFor(box, screenX, screenY, 1)

    // 玩家从**最近的刷怪点**进场，不再从画布正中心。
    //
    // 以前可以那么干，是因为这一场没有物理体 —— 出生点压在课桌上也走得开。
    // 现在挡得住人了，压在课桌上就是**一进场就卡在桌子里**，
    // 而那看起来和「碰撞坏了」一模一样。刷怪点的「站得住」是生成器**构造**出来的
    // （房间内部 + 从门可达 + 网格上不堵），这里不重算一遍，见 `nearestSpawn`。
    const spawnMap = nearestSpawn(room) // 地图坐标 —— 下面两处用途都要它
    if (spawnMap === null) {
      // **不兜底挑一个点**，理由和上面挑不到房就抛是同一条：兜底会把
      // 「这一间根本不该站人」伪装成「站得住」。`chooseClassroom` 只挑打架的房间
      // （刷怪点 ≥ 2），所以走到这里说明挑房的条件被人改了。
      throw new Error(
        `[d2_classroom] 房间 #${room.order} 一个刷怪点都没有 —— 这一场靠最近的那个刷怪点进场。` +
          `非战斗关别本来就没有刷怪点（见 combatKinds），而 chooseClassroom 只挑打架的房间，` +
          `两者对不上说明挑房条件被改过。`,
      )
    }

    this.layout = {
      map,
      cfg,
      room,
      box,
      screenX,
      screenY,
      elapsedMs,
      walls: wallsNearRoom(map, box),
      // 拿**地图坐标**去问网格：`cellStateAt` 问的是生成器那一侧的判定，
      // 和屏幕落在哪儿无关。这一格要是 `free`，就是「生成器说的」和
      // 「网格说的」两边对上了（见 `cellStateAt`）。上一版是拿屏幕点减回地图
      // 坐标再问的 —— 反着换算一遍，错在符号上也不会报错。
      spawnCell: cellStateAt(map, spawnMap.x, spawnMap.y),
      spawn: mapper.toScreen(spawnMap.x, spawnMap.y),
    }

    return {
      // 墙：`drawRoom1to1` 画一份（偏移由它内部的 mapper 决定），这里再喂底座
      // 一份（灰方块 + 寻路网格）。**同一个 mapper**，所以两份落在同一处。
      walls: this.layout.walls.map((w) => screenRect(w, mapper)),
      // 碰撞几何：`collidersOf()` 的三张表，裁进取景框、换算到屏幕。**墙也在里面**
      // —— 「看得见」「怪绕着走」「撞上去会停」是三件事，见 `WallSpec` 那张表。
      collision: collisionInBox(map, cfg, box, mapper),
      playerSpawn: this.layout.spawn,
      spawns: this.spawns(room, mapper),
      // 一进场就被怪围死的话，看的就是「逃跑」而不是「地图」了。
      spawnGraceMs: 1_000_000,
      rngSeed: 0xd2c1,
    }
  }

  private spawns(room: Room, mapper: Mapper): ArenaSpawnSpec[] {
    return room.spawnPoints.slice(0, MAX_ENEMIES).map((p) => ({
      kind: 'splitter' as const,
      gen: 0,
      count: 1,
      x: mapper.toScreen(p.x, p.y).x,
      y: mapper.toScreen(p.x, p.y).y,
    }))
  }

  protected override onArenaCreate(ctx: ArenaContext): void {
    const L = this.layout
    if (L === null) return

    // 这一场看的是地图，不是战斗。**不满血站着被打死的话，画面会停在"玩家倒下"
    // 那一刻**，怪也停了 —— 而「怪撞在课桌前停住 / 顶着它磨」这件事恰恰要在
    // 怪走动的过程中才看得见。
    ctx.player.setInvulnerable(true)

    const drawn = drawRoom1to1(ctx.scene, L.map, L.cfg, L.room, {
      box: L.box,
      screenX: L.screenX,
      screenY: L.screenY,
      // 这里交的是**地图坐标**的墙，不是屏幕坐标的：`drawRoom1to1` 自己按
      // `box` + `screenX/screenY` 换算（用的正是 `mapperFor` 那条式子，
      // 和 `configure()` 里那个 `mapper` 是同一个），所以再平移一次会变成
      // **画两遍平移**。喂给底座的那一份才是平移过的（见 `configure()` 的返回值）。
      walls: L.walls,
      harnessGridCell: GRID_SIZE * 2,
    })

    // 筛掉的条数**必须印出来**：1:1 这一场的规则是「门标注赢、连廊名让位」，
    // 于是这一屏上少掉的那条连廊名是**设计**，不是没生成出来。不印的话，
    // 看到「东边那段连廊没有名字」的人只会得到一个可能的结论：生成器没生成。
    this.drawReadout(ctx, L, drawn.labelsDropped)
    // 提示写成**能照做的三件事**：这一场是给人自己动手试的。
    // 站着不动看到的是「什么都没发生」，而那和「撞上去会停 / 子弹会被挡住」
    // 在现场长得一模一样 —— 所以每一句都得是「按哪个键、看什么」。
    //
    // 最后半句是**主动交代一个会让人误判的东西**：怪会贴着课桌磨。
    // 不说的话，看的人第一反应是「怪的 AI 坏了 / 碰撞接错了」—— 而那是底座
    // `makeNav` 只吃 `cfg.walls` 造的（见文件头那张表），不是 D2 的几何错了。
    //
    // 提示条是 20px、**一行不折**且没有宽度上限（`Hud.setNotice`），而且是
    // **横向居中**的（`setOrigin(0.5, 0)`，`x = 画布宽/2`）—— 所以长度是算过的：
    // 2026-10-15 用同一个字体串（`20px monospace`）在页面里 `measureText` 量过，
    // 加 `Q 收起读数` 这半句之后 **1100px / 1280**（原句 980px），
    // 半边 550，落在 `x 90..1190`，两边都还有 90px。
    // 再加词就得先量（超过 1280 是**两头同时被切**，而切掉的是哪几个字看不出来）。
    ctx.hud.setNotice(
      'WASD 撞桌椅、左键打一枪看课桌挡弹 / 椅子放行、E 开关门、Q 收起读数 —— 怪撞得住桌子但绕不开（底座网格只吃墙）',
    )

    // `Q` 收起右侧读数 —— 它和**东侧连廊上的门标注**压在同一块地方（见 `READOUT_X` 的注释）。
    //
    // 挂在**这一场自己**的 `onArenaCreate()` 里，没进底座：别的场子没有「读数压着门标注」
    // 这件事，而这个键对它们也没有第二个意思。
    //
    // ⚠️ `ev.repeat` 必须挡掉：按住不放会按系统重复率一直发 keydown，
    // 于是读数**抖**成一片（松手时是收是展全看次数奇偶）。
    ctx.scene.input.keyboard?.on('keydown-Q', (ev: KeyboardEvent) => {
      if (ev.repeat) return
      for (const o of this.readoutParts) o.setVisible(!o.visible)
    })
  }

  private drawReadout(ctx: ArenaContext, L: ClassroomLayout, labelsDropped: number): void {
    const rooms = L.map.rooms
    const raw = [
      `D2 · 一间教室 1:1`,
      `种子 ${L.map.seed} · 房间 ${rooms.length}（主干 ${rooms.filter((r) => r.branch === 'main').length} · 侧室 ${rooms.filter((r) => r.branch === 'side').length}）`,
      `生成 ${elapsedText(L.elapsedMs)}`,
      // 关别印**中文**（`ROOM_KIND_LABELS`，全项目唯一那份表）—— 缩略图、
      // d2_room_kinds 和这里读的是同一份名字，三处对不上就没法互相指。
      `房间 #${L.room.order} ${L.room.branch === 'side' ? '侧室' : '主干'}·${ROOM_KIND_LABELS[L.room.kind]} · ${L.room.rect.width}×${L.room.rect.height}px · 档位 ${L.room.sizeTier}`,
      `桌椅 ${L.room.obstacles.length} · 刷怪点 ${L.room.spawnPoints.length} · 威胁预算 ${L.room.budget}`,
      `门 ${L.room.doors.map((d) => `${d.kind}→${d.toOrder}`).join(' ')}`,
      // 「哪个号没印出来」也是读数的一部分：这一场的规则是**门标注赢、连廊名让位**
      // （`planRoom1to1Labels`），837 里让位的正是东边那段的 `连廊 9→11`。
      // 不报的话，看的人会以为是生成器没生成那一段。
      labelsDropped === 0
        ? '门标注与连廊名**全印上了**'
        : `标注挤不下筛掉 ${labelsDropped} 条（门标注优先，让位的是连廊名 —— 看两端那两条 →N）`,
      // 碰撞体是**裁进取景框之后**造出来的块数，不是「这一层楼有几段墙」
      // （见 `collisionInBox`）。三个数一起报：单看任何一个都读不出对错，
      // 而「挡人 − 挡弹」必须**正好**是椅子 —— 差出别的数就是分组错了。
      `碰撞体 挡人 ${ctx.colliders.solidCount} · 挡弹 ${ctx.colliders.bulletStopperCount}（差 ${ctx.colliders.solidCount - ctx.colliders.bulletStopperCount} 块 = 椅子）· 门挡板 ${ctx.colliders.doors?.count ?? 0}`,
      '',
      `红格 = D2 的 ${L.cfg.navCellSize}px 判定，红 = 这格中心站不了`,
      `青线 = 底座的 ${GRID_SIZE * 2}px 格，只画线不做判断`,
      '桌上有红格、青线跨过去一格都不红 —— 两套格子不一样，所以怪不会绕课桌（撞得住，见提示条）',
      '',
      // 「打不打架」的判据只有一条：关别在不在 `combatKinds` 里。
      // 这一行放在「桌椅 / 刷怪点 / 预算」三个数的**正下面**，因为这三个数
      // 是一起被那条判据决定的 —— 非战斗关别一律 0 / 0 / 0（校验器会把
      // 任何一个非零值打回来）。不写这一行的话，看的人会以为「道具关没有敌人」
      // 是生成器没生成，而它是**配置说的**。
      `打架的关别 = combatKinds：${kindNames(L.cfg.combatKinds)}`,
      `不在里面的不摆桌椅、不给刷怪点、预算 0 —— 侧室这一层能抽到：${kindNames(Object.keys(L.cfg.sideKindWeights))}（见 d2_room_kinds）`,
      '',
      // 出生点那一格是什么，必须**报出来**：生成器说它站得住、网格也这么说，
      // 才算两边一致（见 `cellStateAt`）。不一致时这一行是红的。
      `出生点 = 最近的刷怪点 (${Math.round(L.spawn.x)}, ${Math.round(L.spawn.y)})`,
      spawnCellText(L.spawnCell),
      '',
      '玩家已设为无敌：这一场是白箱，不是战斗场。左键开枪 · E 开关门',
    ]
    const lines = raw.flatMap((l) => wrap(l, 21))

    const h = lines.length * READOUT_LINE + 12
    // 贴底往上排：底部才是**一定**没有东西的地方（顶上有底座标题和提示条）。
    const panelY = WORLD_HEIGHT - 8 - h
    const bg = ctx.scene.add
      .rectangle(READOUT_X, panelY, READOUT_WIDTH, h, 0x000000, 0.72)
      .setOrigin(0, 0)
      .setDepth(999)

    const text = ctx.scene.add
      .text(READOUT_X + 8, panelY + 6, lines.join('\n'), {
        fontFamily: 'monospace',
        fontSize: '11px',
        // 红字只留给**课桌**那一种：墙是这一场的取景造出来的、不影响产品，
        // 而每次都亮的红字会让人学会不看红字。
        color: L.spawnCell === 'obstacle' ? '#ff9a9a' : '#9ad4ff',
        lineSpacing: 4,
      })
      .setDepth(1000)

    // 记下来给 `Q` 用（见 `readoutParts` 的注释）。
    this.readoutParts = [bg, text]
  }
}

export const arena: ArenaDefinition = {
  displayName: 'D2 · 一间教室（1:1）',
  // 长度是算过的：底座的标题**不折行**，写到 1200px 就会被画布右边切掉。
  // 上限约 80 个全角字（15px 字，从 x = 8 起）。
  description:
    '一间打架的主干教室按 1:1 摆好：墙、门、课桌、刷怪点、门外的连廊。红格是 D2 的 40px 判定，青线是底座的 80px 格 —— 两边不一样，怪撞得住课桌但绕不开。',
  scene: D2ClassroomArena,
}