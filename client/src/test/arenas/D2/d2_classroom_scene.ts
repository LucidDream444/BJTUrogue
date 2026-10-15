/**
 * **教室长这样。** 观感预览 —— 同一间房的另一张脸。
 *
 * ## 这一场回答什么问题
 *
 * 「D2 生出来的教室，摆进产品里**应该长什么样**。」给美术定调子、给 D1 接家具、
 * 给写交接文档的人一个**能指着说的目标样子**，而不是一堆白方块。
 *
 * 它和 `d2_classroom` 摆的是**同一间房**（两边都问 `chooseClassroom`），
 * 一个看观感，一个看格子：
 *
 * | 场子 | 看什么 | 画法 |
 * |---|---|---|
 * | `d2_classroom` | 门开在哪条边、桌子压不压门、红格与青线错没错开 | 白箱：色块 + 标号 + 判定 |
 * | 这一场 | 地砖、课桌椅、黑板、门框、盆栽 | 观感：产品里该有的颜色与细节 |
 *
 * ## 哪些是**画出来的**，哪些是**生成出来的**（这一条最要紧）
 *
 * | 画面上 | 来源 |
 * |---|---|
 * | 地面、墙、门的位置、课桌椅、刷怪点 | **地图数据**（`DungeonMap`），位置一格不差 |
 * | 地砖的缝 | **D2 的 40px 判定格**（`navOrigin` 对齐，就是 `navCellSize`） |
 * | 黑板、窗、四角的盆栽 | **装饰**：地图数据里没有这三样东西 |
 *
 * 装饰是**这一场自己加的**，为的是让画面像一间教室。它们**不在 `Room` 的任何字段里**
 * —— D1 的子弹不会撞到它们，D3 的寻路不知道它们存在。
 * 真要把它们变成真东西，那是**改契约**（`obstacles` 加 `kind`、配置表加数值、
 * 通知 D1 与 D3 走 C2 流程），**不是把这一场的画法搬过去**。
 * 这也是这一场留在 `test/` 里的理由：它是一张效果图，不是产品代码。
 *
 * ## 不是 1:1
 *
 * `d2_classroom` 不缩放 —— 它要回答**单个格子**的对错，一缩就没法量了。
 * 这一场反过来：要的是「一眼看清一间教室」，所以框取「**房间 + 一圈 40px 留白**」，
 * 再**缩放到塞满画面**（上限 ×2）。倍数印在图例第一行 —— 拿这张图去量像素之前先看那个数。
 *
 * 代价说清楚：**框里没有门外的连廊**（那是 `d2_classroom` 与 `d2_floorplan` 的活）。
 * 门在这里只表现为「墙上的一个洞 + 一圈橙框」，门外是黑的。取景框的这个取舍
 * 和 `d2_room_kinds` 是同一条（那边也讲了为什么），不重复。
 *
 * ## 这一场**也撞得住了**（2026-10-14 起）
 *
 * `configure()` 仍然**不往底座喂墙** —— 理由是底座的墙会盖在观感图上面：
 * `drawBackground` 给每堵墙 `add.rectangle()` 到 depth −50，而这一场的画面在 −80，
 * 喂进去就变成一片灰色方块压在教室上。
 *
 * 但**碰撞体走的是另一条路**：`collision.*` 那一组造的是看不见的 `Zone`，
 * 和「画出来的墙」没有半点关系（见 `WallSpec` 那张表）。所以这一场照样能
 * WASD 撞桌椅、左键打一枪看课桌挡弹 / 椅子放行、`E` 开关门 —— 而画面上
 * 一个灰方块都不会多。**这正是「画出来」和「挡得住」分成两件事的理由之一。**
 *
 * 仍然没有的是**敌人**：`walls` 为空 → 底座不建寻路网格（`ArenaBase.makeNav`
 * 见空墙就返回 `undefined`）→ `EnemySystem` 没有 nav，这一场也就不刷怪。
 * 要验「怪绕不绕得开课桌」去 `d2_classroom`，要验「换批种子稳不稳」去 `d2_seed_sweep`。
 *
 * ## ⚠️ 这一场的碰撞几何是**缩放过的**
 *
 * 坐标系是 `mapperFor` 出来的（不是 1:1），所以每块碰撞矩形都要单独换算到屏幕。
 * 忘了换算的表现**不是报错**，是「桌子画在这儿、人却撞在别处」——
 * 而看的人第一反应会去查生成器。
 *
 * 换算现在收在 `collisionInBox()` 的 `Mapper` 参数里，两个场子共用那一条
 * （原来各自算，于是 1:1 那一场漏了 —— 见 `_shared.ts` 的 `collisionInBox`）。
 *
 * ## 这一场的成品图
 *
 * `docs/images/d2_classroom_look.png` 就是这一场的无头截图（文档正文引它）。
 * **改了这一场的画法，那张图就过期了** —— 重截的命令在 `docs/images/README.md`。
 */

import type Phaser from 'phaser'
import type { ArenaConfig, ArenaContext, ArenaDefinition } from '../../ArenaBase'
import { ArenaBase, WORLD_WIDTH } from '../../ArenaBase'
import type { RoomsConfig } from '@/domains/procgen/config'
import { bottom, inflate, left, right, top } from '@/domains/procgen/model/rect'
import type { DungeonMap, Rect, Room } from '@/domains/procgen/model/types'
import { ROOM_KIND_LABELS } from '@/domains/procgen/model/types'
import { COLORS, mapperFor, type Mapper } from '@/domains/procgen/presentation/floorplan'
import { wallsNearRoom } from '@/domains/procgen/presentation/framing'
import { gridOfMap } from '@/domains/procgen/walkability'
import { drawClassroomLook } from './_classroomLook'
import {
  chooseClassroom,
  collisionInBox,
  D2_SEEDS,
  DEFAULT_SEED,
  elapsedText,
  generateForArena,
  HUD_HINT_RIGHT,
  HUD_TOP_LEFT_BOTTOM,
  loadRoomsConfig,
  nearestSpawn,
} from './_shared'

// ---------------------------------------------------------------- 观感

/*
 * 观感那套画法（配色 `INK` + 地砖 / 课桌椅 / 黑板 / 门框 / 盆栽）**搬去 `_classroomLook.ts` 了**。
 *
 * 搬家的理由不是「两个场子少写点」，是 `d2_three_rooms` 那一场要**同一套**观感 ——
 * 它走位时看到的教室，必须就是这一场这张图上的教室。各留一份的话，两份会慢慢分叉，
 * 而「同一间教室在两个场子里长得不一样」这件事没有报错，只有人看得出来。
 */
  // ---------------------------------------------------------------- 版面

/**
 * 画面能用的那一块。**先躲底座 HUD**（左上标题 + 读数、左下按键说明，尺寸来源见
 * `_shared.ts` 里 `HUD_TOP_LEFT_BOTTOM` 那一段），剩下的才是这一场的画。
 *
 * 画占不满的时候**居中**：两边留一样多的底，比堆在左上角像一张图。
 */
const FRAME = { x: 8, y: HUD_TOP_LEFT_BOTTOM, width: WORLD_WIDTH - 16, height: 660 - HUD_TOP_LEFT_BOTTOM } as const
/** 放大上限。**不是 1:1** —— 见文件头「不是 1:1」那一段。 */
const MAX_SCALE = 2
/** 图例：右下角那一条（左边被按键说明占着；三行 11px）。 */
const LEGEND_AT = { x: HUD_HINT_RIGHT, y: 672 } as const

/**
 * 当前看的是第几张牌。**模块级** —— `scene.restart()` 会把场子实例销毁重建，
 * 实例字段留不住（`d2_seed_sweep` 同一条，那边的注释写得更细）。
 *
 * 起点是 `DEFAULT_SEED`，所以**一进这一场看到的，就是 `d2_classroom` 摆的那一间**。
 */
let seedIndex = D2_SEEDS.indexOf(DEFAULT_SEED as (typeof D2_SEEDS)[number])
if (seedIndex < 0) seedIndex = 0

// ---------------------------------------------------------------- 绘制

/*
 * 观感那几样画法（`fillWorld` / `strokeWorld` / `drawTiles` / `drawDesk` / `drawChair` /
 * `drawPlant` / `drawDoor` / `drawDecor`）**都在 `_classroomLook.ts`**，
 * 这一场调 `drawClassroomLook()` 一次画完（见 `onArenaCreate`）。
 *
 * 这里原来还有一个 `scaleCollision(c, m, scale)`：**搬到 `_shared.ts` 了**
 * （`screenRect()` + `collisionInBox()` 收一个 `Mapper`）。理由不是「两场共用少写点」，
 * 是**这一场有、1:1 那一场没有** —— 于是 1:1 那一场的碰撞体整块停在另一个坐标系里
 * （表现和怎么发现的见 `collisionInBox` 的注释）。换算要是留在各自的场子里，
 * 同样的漏法就会再来一次：唯一有效的防法是让「换算到哪个空间」变成**调用时必须给的一个参数**。
 */


// ---------------------------------------------------------------- 场子

interface SceneLayout {
  map: DungeonMap
  cfg: RoomsConfig
  room: Room
  /** 取景框（地图坐标）= 房间 + 一圈留白。**不含门外的连廊**（见文件头） */
  box: Rect
  mapper: Mapper
  /** 缩放倍数。**不是 1:1** —— 印在图例里，别拿这张图去量像素 */
  scale: number
  elapsedMs: number
  /** 裁进框里的墙 */
  walls: Rect[]
}

class D2ClassroomSceneArena extends ArenaBase {
  /** `configure()` 里算好、`onArenaCreate()` 里画 —— 两处必须是同一份几何。 */
  private layout: SceneLayout | null = null
  /** `D` 键叠出来的那一层。默认**隐藏**：这一场默认给的是观感，判定按需叠。 */
  private overlay: Phaser.GameObjects.Container | null = null

  protected get definition(): ArenaDefinition {
    return arena
  }

  override preload(): void {
    super.preload()
    loadRoomsConfig(this)
  }

  protected configure(): ArenaConfig {
    const seed = D2_SEEDS[seedIndex] ?? DEFAULT_SEED
    const { map, cfg, elapsedMs } = generateForArena(this, seed)
    // 和 `d2_classroom` 问同一份实现 —— 两边摆的不是同一间房的话，
    // 「观感图」和「格子图」就成了一对没法互相印证的两张画。
    const room = chooseClassroom(map, cfg)
    if (room === null) {
      // 挑不到就抛，**不兜底画第一间房** —— 理由同 `d2_classroom`：
      // 兜底会把「生成器变了」伪装成「这个场子只是凑合着跑」。
      throw new Error(
        `[d2_classroom_scene] 种子 ${seed} 里挑不出一间拿得出手的主干教室（见 chooseClassroom）。` +
          `换个种子（N），或者看 d2_seed_sweep 确认生成器是不是把尺寸档位改了。`,
      )
    }

    // 框 = 房间 + 一圈 40px 留白。留白是给**墙**的：墙骑在房间边界上、厚一格，
    // 各让 20px，再留 20px 的呼吸位置，画出来才是一间「有边」的房，而不是被切开的。
    const box = inflate(room.rect, cfg.navCellSize)
    const scale = Math.min(FRAME.width / box.width, FRAME.height / box.height, MAX_SCALE)
    // 居中。**顺序：先定框、再算落点** —— 反过来会把框顶出画面，房间缺一角，
    // 而缺一角看起来和「生成器没生成这段墙」一模一样（`d2_classroom` 同一条）。
    const screenX = FRAME.x + (FRAME.width - box.width * scale) / 2
    const screenY = FRAME.y + (FRAME.height - box.height * scale) / 2

    const mapper = mapperFor(box, screenX, screenY, scale)

    this.layout = {
      map,
      cfg,
      room,
      box,
      mapper,
      scale,
      elapsedMs,
      walls: wallsNearRoom(map, box),
    }

    const cfgOut: ArenaConfig = {
      rngSeed: 0xd2ce,
      // 碰撞几何：**不经过 `walls`**，所以画面上不会多出底座那些灰方块
      // （`walls` 为空 = 底座不画墙、也不建寻路网格，见文件头）。
      // 换算器交进去 —— 这一场缩放过的，不留神就会交出一份地图坐标的几何。
      collision: collisionInBox(map, cfg, box, mapper),
    }
    // 玩家默认落在画布正中心 —— 而这一场的正中心是**缩放后**的那间房的中心，
    // 底下多半压着一张课桌。挪到最近的刷怪点，理由同 `d2_classroom`。
    const spawnMap = nearestSpawn(room)
    if (spawnMap !== null) cfgOut.playerSpawn = mapper.toScreen(spawnMap.x, spawnMap.y)

    // ⚠️ **不喂墙**（`walls` 不传）。底座的 `drawBackground` 会给每堵墙
    // `add.rectangle()` 一个灰色方块、画在 depth −50，正好**盖在这一场的观感图上**
    // （这一场在 −80）。喂进去的后果不是「多了碰撞体」，是「教室被一片灰方块糊住」。
    return cfgOut
  }

  protected override onArenaCreate(ctx: ArenaContext): void {
    const L = this.layout
    if (L === null) return

    // 这一场没有敌人，但假玩家默认不无敌 —— 万一将来有人往这儿加怪，
    // 「看地图的人被打死了」比「什么都没发生」更费解。
    ctx.player.setInvulnerable(true)

    drawClassroomLook(ctx.scene, {
      map: L.map,
      cfg: L.cfg,
      mapper: L.mapper,
      box: L.box,
      walls: L.walls,
      // `focus` = 这一间：邻居压淡、装饰只画它。这一场看的就是它，
      // 画面得一眼分得出「要看的是哪一间」。
      focus: L.room,
    })
    this.overlay = drawOverlay(ctx.scene, L)
    drawLegend(ctx.scene, L)

    ctx.scene.input.keyboard?.on('keydown-D', (ev: KeyboardEvent) => {
      // `ev.repeat` 要挡：按住不放会按系统重复率一直发 keydown，叠层就会闪。
      if (ev.repeat) return
      const o = this.overlay
      if (o === null) return
      o.setVisible(!o.visible)
      ctx.hud.setNotice(o.visible ? '判定叠加 ON（红格 = D2 的 40px 判定站不了）' : '')
    })
    ctx.scene.input.keyboard?.on('keydown-N', (ev: KeyboardEvent) => {
      if (ev.repeat) return
      seedIndex = (seedIndex + 1) % D2_SEEDS.length
      this.scene.restart()
    })

    // 长度是算过的：底座的提示条是 20px、**一行不折**且没有宽度上限
    // （`Hud.setNotice`），这一句约 46 个全角 ≈ 920px / 1280。再加词就会顶出画布。
    //
    // 前三个动作是**能照做的**：撞桌椅、打一枪、关门。观感图容易变成「看两眼就走」，
    // 而这三件事能把「画出来的桌椅」和「挡得住人的桌椅」一次对上
    // ——它们是**同一份地图数据的两个用途**（见文件头）。
    ctx.hud.setNotice('教室长这样 —— 撞得住了：WASD 走两步、左键打一枪、E 关门；黑板 / 窗 / 盆栽是画上去的')
  }
}



/**
 * `D` 键叠的那一层：**判定**。默认隐藏。
 *
 * 三样都是**读数据来的**，一样都不现算：
 *
 * | 叠出来的 | 读的是 |
 * |---|---|
 * | 红格 | `gridOfMap()` —— 和校验器、和将来 D3 的寻路**同一份** |
 * | 粉圈 + `spawn` | `room.spawnPoints` |
 * | `#序号 关别 (branch)` | `room.order` / `room.kind` / `room.branch` |
 *
 * 颜色全部走 `COLORS`（不是 `INK`）：这一层要和 `d2_classroom` 里那一层
 * **长得一模一样** —— 两边说的是同一件事，颜色不一样就等于两件事。
 */
function drawOverlay(scene: Phaser.Scene, L: SceneLayout): Phaser.GameObjects.Container {
  const { map, cfg, room, box, mapper } = L
  const g = scene.add.graphics()
  const texts: Phaser.GameObjects.Text[] = []

  // 红格。读 `gridOfMap()` —— 这里现算一份的话，这个场子显示的东西
  // 就只是它自己的说法，证明不了任何事（`drawRoom1to1` 同一条）。
  const grid = gridOfMap(map)
  const cell = grid.cellSize
  const cx0 = Math.max(0, Math.floor((left(box) - grid.originX) / cell))
  const cx1 = Math.min(grid.cols - 1, Math.floor((right(box) - grid.originX) / cell))
  const cy0 = Math.max(0, Math.floor((top(box) - grid.originY) / cell))
  const cy1 = Math.min(grid.rows - 1, Math.floor((bottom(box) - grid.originY) / cell))
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      if (grid.blocked[cy * grid.cols + cx] !== 1) continue
      const wx = grid.originX + cx * cell
      const wy = grid.originY + cy * cell
      const p = mapper.toScreen(wx, wy)
      g.fillStyle(COLORS.blockedCell, 0.3)
      g.fillRect(p.x, p.y, cell * L.scale, cell * L.scale)
      g.lineStyle(1, COLORS.blockedEdge, 0.9)
      g.strokeRect(p.x + 1, p.y + 1, cell * L.scale - 2, cell * L.scale - 2)
    }
  }

  // 刷怪点
  for (const s of room.spawnPoints) {
    const p = mapper.toScreen(s.x, s.y)
    g.lineStyle(2, COLORS.spawn, 1)
    g.strokeCircle(p.x, p.y, cfg.navCellSize * 0.4 * L.scale)
    g.fillStyle(COLORS.spawn, 1)
    g.fillCircle(p.x, p.y, 3)
    texts.push(
      scene.add
        .text(p.x, p.y - cfg.navCellSize * 0.7 * L.scale, 'spawn', {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#ff9ac8',
        })
        .setOrigin(0.5),
    )
  }

  // 房名。中文关别读 `ROOM_KIND_LABELS`（全项目唯一那份表），`branch` 印原值 ——
  // 对着 `Room` 读代码时用得上（`drawRoom1to1` 同一条）。
  const lp = mapper.toScreen(room.rect.x, top(room.rect) + cfg.navCellSize)
  texts.push(
    scene.add
      .text(lp.x, lp.y, `#${room.order} ${ROOM_KIND_LABELS[room.kind]} (${room.branch})`, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: COLORS.text,
      })
      .setOrigin(0.5),
  )

  // 容器在 depth −70：**压在观感图上面**（−80）、压在底座 HUD 下面（999+）。
  return scene.add.container(0, 0, [g, ...texts]).setDepth(-70).setVisible(false)
}

/**
 * 右下角那三行读法（左边被底座的按键说明占着，见文件头「版面」）。
 *
 * 每行不超过约 55 个全角 —— 这一块的右边是画布边（1272），左边是 `HUD_HINT_RIGHT`，
 * 算下来 650px 可用（11px 字）。**缩放在第一行**：拿这张图量像素之前先看它。
 *
 * ⚠️ 这些字是**字面量**：`Phaser.Text` 不认 Markdown，写 `**不是 1:1**` 是会**原样印出来**
 * 的（第一版就这么印在了屏幕上）。强调靠词序，不靠星号。
 */
function drawLegend(scene: Phaser.Scene, L: SceneLayout): void {
  const where = L.room.branch === 'side' ? '侧室' : '主干'
  const doors = L.room.doors.map((d) => `${d.kind}→${d.toOrder}`).join(' ')
  scene.add
    .text(
      LEGEND_AT.x,
      LEGEND_AT.y,
      [
        `种子 ${L.map.seed} · #${L.room.order} ${where}·${ROOM_KIND_LABELS[L.room.kind]} · ${L.room.rect.width}×${L.room.rect.height}px · 档位 ${L.room.sizeTier}`,
        `缩放 ×${L.scale.toFixed(2)}（不是 1:1，看观感）· 生成 ${elapsedText(L.elapsedMs)} · 桌椅 ${L.room.obstacles.length} · 刷怪点 ${L.room.spawnPoints.length} · 门 ${doors}`,
        'D = 判定叠加　N = 换种子　E = 关门挡板　WASD 撞桌椅 · 左键打一枪　黑板 / 窗 / 盆栽是装饰',
      ].join('\n'),
      { fontFamily: 'monospace', fontSize: '11px', color: COLORS.text, lineSpacing: 3 },
    )
    .setDepth(1000)
}

export const arena: ArenaDefinition = {
  displayName: 'D2 · 教室长这样（观感）',
  // 长度是算过的：底座的标题**不折行**，写到 1200px 就会被画布右边切掉。
  // 上限约 80 个全角字（15px 字，从 x = 8 起）。
  description:
    '同一间教室的观感图：地砖、课桌椅、黑板、门框、盆栽。桌椅与门是地图数据，黑板 / 窗 / 盆栽是装饰。按 D 叠判定，按 N 换种子。',
  scene: D2ClassroomSceneArena,
}