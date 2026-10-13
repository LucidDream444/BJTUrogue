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
 * 三条里任何一条不同，判出来的可走性就不同。而 **40px 的课桌盖不住 80px 格的中心**
 * —— 所以在这个场子里，底座的寻路**完全看不见课桌**，怪会径直穿过桌子走过去。
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
import { roomWithCorridorBox, wallsNearRoom } from '@/domains/procgen/presentation/framing'
import { drawRoom1to1 } from '@/domains/procgen/presentation/floorplan'
import { left, top } from '@/domains/procgen/model/rect'
import type { DungeonMap, Rect, Room } from '@/domains/procgen/model/types'
import { cellOf, gridOfMap, isBlockedCell } from '@/domains/procgen/walkability'
import { chooseClassroom, DEFAULT_SEED, elapsedText, generateForArena, loadRoomsConfig } from './_shared'

/** 场上最多放几只怪。**这是测试场的密度，不是产品数值** —— 产品按威胁预算刷。 */
const MAX_ENEMIES = 4

/**
 * 读数栏：画布**右边那一条空的**，不是压在图上的一条。
 *
 * 为什么不去占画面下方：底座的按键说明就钉在左下角
 * （`Hud.update()` 里 `y = 画布高 − LINE*3.4`，四行），读数放下去两段会叠在一起 ——
 * 而「字叠在一起」在现场看起来就是「读数没印出来」。
 *
 * 为什么右边一定空着：取景框最宽 1000（最大档教室 640×320 → 框 720×600，
 * 加上居中之后的左右留白正好到 x=1000），所以从 1008 起是干净的。
 * ⚠️ 这条依赖「房间尺寸档位表最宽 640」——档位表将来要是出了比 920 还宽的房间，
 * 框会盖到这条读数栏下面，而那时表现是**读数被地图压住**，不是报错。
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
 * 所以框一旦居中，玩家就必然落在**框心**上：
 * 水平是教室正中，垂直是「教室中心再往走廊那边偏 100px」——
 * 因为框 = 教室 + 走廊，框心自然比教室心低半个走廊。
 * 那正是玩家推门进来站的位置，合理。
 *
 * ## 那为什么还要查
 *
 * **合理不等于空着。** 生成器摆课桌时不知道底座把出生点钉在这个点上了。
 * 一旦它压在一张课桌上，玩家一进场就卡在桌子里 —— 而那和「寻路坏了」
 * 在现场长得一模一样，看场子的人会去查 D2 的生成器。
 *
 * 这一场**不去挪框躲开它**（挪了框就出画布，房间缺一角，而缺一角看起来
 * 和「生成器没生成这段墙」一样糟），改成**如实报**：读数最后一行写出来。
 */
function playerCellFree(map: DungeonMap, dx: number, dy: number): boolean {
  const grid = gridOfMap(map)
  const { cx, cy } = cellOf(grid, WORLD_WIDTH / 2 - dx, WORLD_HEIGHT / 2 - dy)
  return !isBlockedCell(grid, cx, cy)
}

interface ClassroomLayout {
  map: DungeonMap
  cfg: RoomsConfig
  room: Room
  /** 要画的世界矩形（地图坐标）。**不对称**，见 `roomWithCorridorBox` */
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
  /** 玩家出生点（画布正中心）那一格是不是空的，见 `playerCellFree` */
  playerFree: boolean
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
    const room = chooseClassroom(map, cfg, WORLD_WIDTH, WORLD_HEIGHT)
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

    const box = roomWithCorridorBox(map, cfg, room)

    // 框在画布上居中。**顺序很重要：先定框、再算平移** —— 反过来（按玩家出生点
    // 去推框的位置）会把框顶出画布，房间缺一角，而缺一角看起来和「生成器没生成
    // 这段墙」一模一样。而框居中之后玩家本来就在框心（见 `playerCellFree`），
    // 并不需要额外去对。
    //
    // 框最大 720×600（最大档教室 640×320 + 两侧各一格 + 走廊），塞得进 1280×720；
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
      playerFree: playerCellFree(map, dx, dy),
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
    ctx.hud.setNotice('WASD 自己走两步 —— 墙和课桌都没有物理体，玩家和怪都会穿过去；要看的是红格和青线对不对得上')
  }

  private drawReadout(ctx: ArenaContext, L: ClassroomLayout): void {
    const rooms = L.map.rooms
    const raw = [
      `D2 · 一间教室 1:1`,
      `种子 ${L.map.seed} · 房间 ${rooms.length}（主干 ${rooms.filter((r) => r.branch === 'main').length} · 侧室 ${rooms.filter((r) => r.branch === 'side').length}）`,
      `生成 ${elapsedText(L.elapsedMs)}`,
      `房间 #${L.room.order} ${L.room.kind}/${L.room.branch} · ${L.room.rect.width}×${L.room.rect.height}px · 档位 ${L.room.sizeTier}`,
      `障碍 ${L.room.obstacles.length} · 刷怪点 ${L.room.spawnPoints.length}`,
      `门 ${L.room.doors.map((d) => `${d.kind}→${d.toOrder}`).join(' ')}`,
      '',
      `红格 = D2 的 ${L.cfg.navCellSize}px 判定，红 = 这格中心站不了`,
      `青线 = 底座的 ${GRID_SIZE * 2}px 格，只画线不做判断`,
      '桌上有红格、青线跨过去一格都不红 —— 两套格子不一样，所以怪会穿过课桌',
      '',
      // 出生点那格空不空，必须**报出来**：它压在课桌上时玩家一进场就卡住，
      // 而那和「寻路坏了」长得一模一样（见 `playerCellFree`）。
      L.playerFree
        ? '玩家出生点落在空格上'
        : '⚠ 玩家出生点压在障碍物上 —— 底座的出生点钉死在画布中心，换个种子或看 d2_seed_sweep',
      '',
      '玩家已设为无敌：这一场是白箱，不是战斗场。门外亮一档的那条是走廊',
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
        color: L.playerFree ? '#9ad4ff' : '#ff9a9a',
        lineSpacing: 4,
      })
      .setDepth(1000)
  }
}

export const arena: ArenaDefinition = {
  displayName: 'D2 · 一间教室（1:1）',
  description:
    '一间主干教室按 1:1 摆好：墙、门、课桌、椅子、刷怪点、门外的走廊。红格是 D2 的 40px 判定，青线是底座的 80px 格 —— 两边不一样，怪会穿过课桌。玩家撞不动墙（底座没有物理体），那是 D1 的事。',
  scene: D2ClassroomArena,
}