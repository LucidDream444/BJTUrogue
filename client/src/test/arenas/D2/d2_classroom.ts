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
 * 看不见课桌，怪会径直穿过桌子走过去。
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
 * ## 这个场子**验不了**什么（不许含糊过去）
 *
 * - **玩家被课桌挡住** —— 底座的墙是纯装饰 `Rectangle`，**没有 physics body**
 *   （`ArenaBase.drawBackground` 只 `add.rectangle`，`randomPoint` 的注释自己写了
 *   「装饰用的墙是没有 body 的」）。所以「撞上去会停」在这里**根本不会发生**，
 *   那要等 D1 接上玩家与碰撞体。
 * - **子弹被课桌挡、被椅子放行** —— 同上，还要等 D1 的武器。
 * - **战斗期间关门 / 不回头** —— 那是 D1 的场景逻辑，D2 只负责把门的位置写对。
 *
 * 在这一场里能看见的是**几何本身**：门开在哪条边、墙上留没留缺口、
 * 桌子有没有压住门、刷怪点是不是都落在空地上、红格和青线对不对得上。
 */

import type { ArenaConfig, ArenaContext, ArenaDefinition, ArenaSpawnSpec } from '../../ArenaBase'
import { ArenaBase, GRID_SIZE, WORLD_HEIGHT, WORLD_WIDTH } from '../../ArenaBase'
import type { RoomsConfig } from '@/domains/procgen/config'
import { roomViewBox, wallsNearRoom } from '@/domains/procgen/presentation/framing'
import { drawRoom1to1 } from '@/domains/procgen/presentation/floorplan'
import { containsPoint, left, top } from '@/domains/procgen/model/rect'
import type { DungeonMap, Rect, Room, RoomKind } from '@/domains/procgen/model/types'
import { ROOM_KIND_LABELS } from '@/domains/procgen/model/types'
import { cellCenter, cellOf, gridOfMap, isBlockedCell } from '@/domains/procgen/walkability'
import { chooseClassroom, DEFAULT_SEED, elapsedText, generateForArena, loadRoomsConfig } from './_shared'

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

function shift(r: Rect, dx: number, dy: number): Rect {
  return { x: r.x + dx, y: r.y + dy, width: r.width, height: r.height }
}

/**
 * 玩家**出生点**落在的那一格站不站得住。
 *
 * ## 为什么玩家恰好落在框的正中心
 *
 * 框在画布上居中，所以 `screenY = (画布高 − 框高) / 2`，框中心 = `screenY + 框高/2`
 * = 画布高/2 —— **和框多高无关**。底座又把玩家钉死在画布正中心
 * （`ArenaBase` 的出生点写死为 `(WORLD_WIDTH/2, WORLD_HEIGHT/2)`），
 * 所以框一旦居中，玩家就必然落在**框心**上。
 *
 * 但「框心落在教室里的哪儿」**不固定**，也不再是一句话能说清的：框 = 教室 +
 * 门外那几块（东西两段连廊，外面还各留一格；这一间挂侧室时，上边或下边再多一块）。
 * 侧室挂上还是挂下按种子随机，于是框心可能在教室里偏上、偏下，
 * 甚至**正好落在墙的内侧线上**。`Room` 里没有「框心」这个数 —— 它是这几块合起来的副产品。
 * 所以这里**不推**，直接问网格：那一格堵不堵。
 *
 * ## 那为什么还要查
 *
 * **落在哪儿都有可能是堵的。** 生成器摆课桌时不知道底座把出生点钉在这个点上了，
 * 而框心又是从这一层的地图形状算出来的。一旦它压在一张课桌上（或者干脆压在南/北墙
 * 那一格的边界上），玩家一进场就卡在里面 —— 而那和「寻路坏了」
 * 在现场长得一模一样，看场子的人会去查 D2 的生成器。
 *
 * 这一场**不去挪框躲开它**（挪了框就出画布，房间缺一角，而缺一角看起来
 * 和「生成器没生成这段墙」一样糟），改成**如实报**：读数最后一行写出来。
 */
function playerCellFree(map: DungeonMap, dx: number, dy: number): SpawnCell {
  const grid = gridOfMap(map)
  const { cx, cy } = cellOf(grid, WORLD_WIDTH / 2 - dx, WORLD_HEIGHT / 2 - dy)
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
 * 出生点那一格的状态。**三种分开报**，因为能做的事完全不同：
 *
 * - `free`：正常。
 * - `obstacle`：格心被**课桌**盖住了 —— 生成器的问题，去查生成器。
 * - `wall`：格心落在**墙**上（框心正好压在墙的内侧线上）—— 这是**这一场的取景**
 *   造出来的（框居中 → 玩家必在框心），而这一场没有物理体，不影响看地图。
 *
 * 合成一句「出生点被挡住」，看的人只能两个方向都查一遍；而红色每次都亮的话，
 * 人就学会不看红色了 —— 那才是真的丢掉了这条读数。
 */
type SpawnCell = 'free' | 'obstacle' | 'wall'

function spawnCellText(state: SpawnCell): string {
  if (state === 'free') return '玩家出生点落在空格上'
  if (state === 'obstacle') {
    return '⚠ 玩家出生点那一格被课桌盖住了 —— 是生成器的问题（底座把出生点钉死在画布中心），换个种子或看 d2_seed_sweep'
  }
  return '⚠ 玩家出生点那一格是墙（框心正好压在墙的内侧线上）—— 这一场没有物理体，不影响看地图'
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
  /** 地图坐标 → 屏幕坐标的平移量（缩放恒为 1）。**绘制与喂给底座的墙共用它。** */
  dx: number
  dy: number
  /** `drawRoom1to1` 要的落点 */
  screenX: number
  screenY: number
  elapsedMs: number
  /** 地图坐标下的、裁过的那几段墙 */
  walls: Rect[]
  /** 玩家出生点（画布正中心）那一格是什么，见 `playerCellFree` */
  spawnCell: SpawnCell
}

class D2ClassroomArena extends ArenaBase {
  /** `configure()` 里算好、`onArenaCreate()` 里画 —— **两处必须用同一份几何**。 */
  private layout: ClassroomLayout | null = null

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

    // 框在画布上居中。**顺序很重要：先定框、再算平移** —— 反过来（按玩家出生点
    // 去推框的位置）会把框顶出画布，房间缺一角，而缺一角看起来和「生成器没生成
    // 这段墙」一模一样。而框居中之后玩家本来就在框心（见 `playerCellFree`），
    // 并不需要额外去对。
    //
    // 框最大 1120×680（最大档教室 640 + 东西两段连廊 400 + 两格留白 80；
    // 高 280 + 侧室 320 + 两格留白 80），塞得进 1280×720；
    // `chooseClassroom` 已经用同一个尺寸挡过一遍，这里不会算出负数。
    const screenX = (WORLD_WIDTH - box.width) / 2
    const screenY = (WORLD_HEIGHT - box.height) / 2
    // `drawRoom1to1` 的映射是 `screen = screenX + (p - left(box))`，
    // 代入这个 screenX 之后整条式子化简成 `screen = p + dx` —— 也就是
    // **绘制用的平移量和喂给底座的那一份是同一个**，两边不可能错位。
    const dx = screenX - left(box)
    const dy = screenY - top(box)

    this.layout = {
      map,
      cfg,
      room,
      box,
      dx,
      dy,
      screenX,
      screenY,
      elapsedMs,
      walls: wallsNearRoom(map, box),
      spawnCell: playerCellFree(map, dx, dy),
    }

    return {
      walls: this.layout.walls.map((w) => shift(w, dx, dy)),
      spawns: this.spawns(room, dx, dy),
      // 一进场就被怪围死的话，看的就是「逃跑」而不是「地图」了。
      spawnGraceMs: 1_000_000,
      rngSeed: 0xd2c1,
    }
  }

  private spawns(room: Room, dx: number, dy: number): ArenaSpawnSpec[] {
    return room.spawnPoints.slice(0, MAX_ENEMIES).map((p) => ({
      kind: 'splitter' as const,
      gen: 0,
      count: 1,
      x: p.x + dx,
      y: p.y + dy,
    }))
  }

  protected override onArenaCreate(ctx: ArenaContext): void {
    const L = this.layout
    if (L === null) return

    // 这一场看的是地图，不是战斗。**不满血站着被打死的话，画面会停在"玩家倒下"
    // 那一刻**，怪也停了 —— 而「怪会穿过课桌」这件事恰恰要在怪走动的过程中才看得见。
    ctx.player.setInvulnerable(true)

    drawRoom1to1(ctx.scene, L.map, L.cfg, L.room, {
      box: L.box,
      screenX: L.screenX,
      screenY: L.screenY,
      // 墙**不平移**：这个绘制整个活在**地图坐标系**里，落点由 screenX / screenY 决定
      // （两者用的是同一个 dx/dy，见 `configure()`）。平移只发生在喂给底座的那一份。
      walls: L.walls,
      harnessGridCell: GRID_SIZE * 2,
    })

    this.drawReadout(ctx, L)
    // 提示写成**能照做的一句话**：这一场是给人自己走两步看的。
    // 半数的刷怪点在课桌这一侧、玩家在另一侧，所以「怪穿不穿桌子」只有
    // 玩家走过去才会发生 —— 站在出生点不动，看到的是「什么都没发生」，
    // 而那和「桌子挡得住」在现场长得一模一样。
    //
    // 后半句是**主动交代这个场子的取景**：这里的教室一定有桌椅，因为
    // `chooseClassroom` 只挑打架的房间。不说的话，一个在找「道具关长什么样」
    // 的人会以为「D2 把道具关也摆满了桌子」—— 而那是 `combatKinds` 说了算的，
    // 道具关与宝箱关本来就是空场地（见 d2_room_kinds）。
    //
    // 提示条是 20px、**一行不折**且没有宽度上限（`Hud.setNotice`），
    // 所以这句话的长度是算过的：与原来那句差不多宽（约 950px / 1280）。
    // 再加词就会顶出画布 —— 想加先量。
    ctx.hud.setNotice(
      'WASD 走两步看红格/青线 —— 这一场只摆打架的教室；道具关 / 宝箱关不摆桌椅，判据是 combatKinds',
    )
  }

  private drawReadout(ctx: ArenaContext, L: ClassroomLayout): void {
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
      '',
      `红格 = D2 的 ${L.cfg.navCellSize}px 判定，红 = 这格中心站不了`,
      `青线 = 底座的 ${GRID_SIZE * 2}px 格，只画线不做判断`,
      '桌上有红格、青线跨过去一格都不红 —— 两套格子不一样，所以怪会穿过课桌',
      '',
      // 「打不打架」的判据只有一条：关别在不在 `combatKinds` 里。
      // 这一行放在「桌椅 / 刷怪点 / 预算」三个数的**正下面**，因为这三个数
      // 是一起被那条判据决定的 —— 非战斗关别一律 0 / 0 / 0（校验器会把
      // 任何一个非零值打回来）。不写这一行的话，看的人会以为「道具关没有敌人」
      // 是生成器没生成，而它是**配置说的**。
      `打架的关别 = combatKinds：${kindNames(L.cfg.combatKinds)}`,
      `不在里面的不摆桌椅、不给刷怪点、预算 0 —— 侧室这一层能抽到：${kindNames(Object.keys(L.cfg.sideKindWeights))}（见 d2_room_kinds）`,
      '',
      // 出生点那一格是什么，必须**报出来**：它压在课桌上时玩家一进场就卡住，
      // 而那和「寻路坏了」长得一模一样（见 `playerCellFree`）。
      spawnCellText(L.spawnCell),
      '',
      '玩家已设为无敌：这一场是白箱，不是战斗场。门外那段是连廊',
    ]
    const lines = raw.flatMap((l) => wrap(l, 21))

    const h = lines.length * READOUT_LINE + 12
    // 贴底往上排：底部才是**一定**没有东西的地方（顶上有底座标题和提示条）。
    const panelY = WORLD_HEIGHT - 8 - h
    ctx.scene.add
      .rectangle(READOUT_X, panelY, READOUT_WIDTH, h, 0x000000, 0.72)
      .setOrigin(0, 0)
      .setDepth(999)

    ctx.scene.add
      .text(READOUT_X + 8, panelY + 6, lines.join('\n'), {
        fontFamily: 'monospace',
        fontSize: '11px',
        // 红字只留给**课桌**那一种：墙是这一场的取景造出来的、不影响产品，
        // 而每次都亮的红字会让人学会不看红字。
        color: L.spawnCell === 'obstacle' ? '#ff9a9a' : '#9ad4ff',
        lineSpacing: 4,
      })
      .setDepth(1000)
  }
}

export const arena: ArenaDefinition = {
  displayName: 'D2 · 一间教室（1:1）',
  // 长度是算过的：底座的标题**不折行**，写到 1200px 就会被画布右边切掉。
  // 上限约 80 个全角字（15px 字，从 x = 8 起）。
  description:
    '一间打架的主干教室按 1:1 摆好：墙、门、课桌、刷怪点、门外的连廊。红格是 D2 的 40px 判定，青线是底座的 80px 格 —— 两边不一样，怪会穿过课桌。',
  scene: D2ClassroomArena,
}