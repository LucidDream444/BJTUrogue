/**
 * **关别一览：本期产出的六类关别，一类摆一间。**
 *
 * ## 这一场回答什么问题
 *
 * 「道具关长什么样？」「宝箱关里有没有敌人？」「精英房在哪儿？」——
 * 这三个问题**在别的场子里都答不了**：
 *
 * - `d2_classroom` 一次只摆一间，而且专挑**有课桌**的（它要看的是格子级的对错），
 *   于是空场地这一类**根本进不了它的取景框**；
 * - `d2_floorplan` 是整层缩略图，8:1 的长条上桌椅只有几个像素、关别名只有 10px；
 * - `d2_seed_sweep` 一次一张整层图，想找一间宝箱关得自己扫。
 *
 * 所以这里把六类**并排**摆开，每格三行字：**关别 · 来源 · 在哪儿**，
 * 再加上**桌椅 / 刷怪点 / 威胁预算**这三个数。要看的不是「好看」，
 * 而是**同一份数据在六格之间差在哪**：
 *
 * | 这一格 | 三个数该是什么样 |
 * |---|---|
 * | 起点 / 普通战 / 精英 / 首领 | 桌椅 > 0、刷怪点 > 0、预算 > 0 |
 * | 道具关 / 宝箱关 | **0 / 0 / 0** |
 *
 * 任何一格不对，就是 `combatKinds` 那条判据在某一条路径上没接上 ——
 * 而它不报错，只表现为「一间空教室」或者「一间摆了桌椅却没有敌人的房」。
 *
 * ## 为什么用**贴边的框**，不用 `roomViewBox`
 *
 * `roomViewBox` 的作用是「顺着门把门外那一块也并进来」，`d2_classroom` 靠它
 * 回答「门外面有没有路」。这一场不看那个 —— 它看的是**这一间里有什么**，
 * 而六格并排意味着每格只有 410×281：再按 `roomViewBox` 那种框（实测
 * 680—1000 宽、360—680 高）缩下来，最小的一格只能得到 0.35 倍，
 * 桌椅会缩成几个像素的点，**恰好把要看的东西缩没了**。
 *
 * 所以框取 `inflate(room.rect, 一格)`：房间 + 一圈留白，既不切到墙
 * （墙骑在房间边界上、厚一格），也不把邻间和连廊整段拖进来。
 * 实测缩下来是 **0.55—0.64 倍**，桌椅是能一眼看出来的色块。
 *
 * ⚠️ 代价说清楚：这一场的框**不回答「门外是什么」**。
 * 那件事去 `d2_classroom`（1:1）和 `d2_floorplan`（侧室特写）。
 *
 * ## 摆的是哪一间：**扫种子，第一间碰上的就是它**
 *
 * 关别落在主干还是侧室**不是一个自由度**：主干那一排只出起点 / 普通战 / 首领
 * （`layout.ts` 的 `kindOfMain`），**精英 / 道具关 / 宝箱关只挂在侧室上**。
 * 所以「精英」那一格摆的必然是侧室 —— 那是生成器的结构，不是这一场挑的。
 * 这件事写在每格的「来源」里，看的人不必去翻代码。
 *
 * 挑法：按 `D2_SEEDS` 的顺序扫，每层楼里按 `order` 的顺序找，
 * **第一间碰上的就是它**。写死成这样是为了可复现 —— 每格第二行印着
 * 「种子 + `#order`」，同一个数字换台机器也是同一间房。
 * （`D2_SEEDS` 那一层楼里恰好六类都抽得到，所以六格多半同一层；
 * 哪一类没抽到就会往后翻牌，翻完了还没有就**如实报缺**，不兜底拿别的关别顶上。）
 *
 * ## 这一场**不验**什么
 *
 * 它是一张**对着六间房拍的全家福**：`configure()` 返回空配置，没往底座喂任何墙，
 * 也没有敌人 —— 白方块会直接飘过墙和桌子。那不是 bug，这一场压根没有物理体
 * （理由与 `d2_floorplan` 同，见那边的文件头）。
 *
 * 要验「挡不挡得住」去 `d2_classroom`，要验「换批种子稳不稳」去 `d2_seed_sweep`。
 */

import type { ArenaConfig, ArenaContext, ArenaDefinition } from '../../ArenaBase'
import { ArenaBase, WORLD_HEIGHT, WORLD_WIDTH } from '../../ArenaBase'
import type { RoomsConfig } from '@/domains/procgen/config'
import { isCombatKind } from '@/domains/procgen/config'
import { COLORS, drawRoom1to1 } from '@/domains/procgen/presentation/floorplan'
import { wallsNearRoom } from '@/domains/procgen/presentation/framing'
import { inflate } from '@/domains/procgen/model/rect'
import type { DungeonMap, Room, RoomKind } from '@/domains/procgen/model/types'
import { ROOM_KINDS_EMITTED, ROOM_KIND_LABELS } from '@/domains/procgen/model/types'
import { D2_SEEDS, generateForArena, HUD_HINT_RIGHT, HUD_TOP_LEFT_BOTTOM, loadRoomsConfig } from './_shared'

/**
 * ## 版面：**先躲底座，再分格子**
 *
 * 六格是**铺出来的**，而画布上早有别人占着地方（`test/Hud.ts` 那三块，
 * 尺寸和来源见 `_shared.ts` 里 `HUD_TOP_LEFT_BOTTOM` 那一段）：左上那一坨
 * （标题 + 7 行读数）压到 `y ≈ 190`，左下的按键说明从 `y = 669` 起。
 *
 * 于是六格只能落在 **y = 210 → 660** 这一段里（`TOP` / `BOTTOM`），
 * 分三列两行。右下角（x > 620、y > 660）正好空着，印这一场的**读法**。
 *
 * ⚠️ **第一版不是这么摆的**，第一版从 y = 124 起 —— 那是照着
 * `d2_floorplan` 文件头里一句「标题与读数在 y 8—120」抄的，而那句话是错的：
 * 实测读数最后一行在 y ≈ 190。症状是**第一格（起点）的读数整个被 HUD 盖住**，
 * 而盖住在现场看起来就是「这一格没印读数」。
 *
 * 白方块（底座钉在画布正中心的假玩家）落在**第 2 格「普通战」**上 ——
 * 躲不开（它由画布中心和格子的划分共同决定），所以写进页脚里说清楚。
 */
const PAD = 12
/** 六格的上沿：让开左上角那一坨读数（见 `_shared.ts`）。 */
const TOP = HUD_TOP_LEFT_BOTTOM
/** 六格的下沿：让开左下的按键说明（它从 669 起）。 */
const BOTTOM = 660
const COLS = 3
const ROWS = 2
const GAP_X = 12
const GAP_Y = 22
const CELL_W = (WORLD_WIDTH - PAD * 2 - GAP_X * (COLS - 1)) / COLS
const CELL_H = (BOTTOM - TOP - GAP_Y * (ROWS - 1)) / ROWS
/**
 * 每格顶部留给读数的净高（**两行**）。
 *
 * 两行而不是三行是**算出来的**：三行会让每格的画图区从 177 掉到 163，
 * 而框最宽的那一类（640 宽的侧室 + 一圈留白 = 720×400）在 163 里只剩 0.41 倍，
 * 桌椅会缩成十几个像素的色块 —— 恰好把要看的东西缩没了。
 * 所以把「种子 / 序号 / 尺寸」并进了第二行，见 `drawBlock`。
 */
const CAPTION_H = 42

/** 这一场的读法。右下方那一块（左边被按键说明占了，见上面「版面」）。 */
const FOOTER_AT = { x: HUD_HINT_RIGHT, y: BOTTOM + 4 } as const

const TEXT = COLORS.text
/**
 * **不打一仗的那一类**的字色。与缩略图上 `COLORS.nonCombatEdge` 同一个色系 ——
 * 两处说的是同一件事（「这一间不打架」），颜色对上了才串得起来。
 */
const TEXT_EMPTY = '#b79ae4'
const TEXT_DIM = '#7a7a90'

/** 一格：哪一类关别，摆在**哪一层楼的哪一间**。 */
interface Block {
  kind: RoomKind
  /** `null` = `D2_SEEDS` 六张牌里这一类一间都没有（**如实报缺**，不拿别的顶上）。 */
  at: { seed: number; map: DungeonMap; room: Room } | null
}

/**
 * 六类关别各挑一间。**按 `ROOM_KINDS_EMITTED` 的次序返回**（= 格子的次序），
 * 挑法是「按种子顺序扫、第一间碰上的」（见文件头），可复现。
 *
 * 每张牌只生成一次：六类共用同一批地图对象，别在循环里反复 `generateDungeon`。
 */
function pickOnePerKind(scene: ArenaContext['scene']): { cfg: RoomsConfig; blocks: Block[] } {
  // `generateForArena` 是三个场子共用的那一层（它量耗时、也负责在配置没加载上时
  // 抛一句指得出病因的话）。这一场要的是**好几层楼**，所以调它六次 ——
  // 一层楼的生成在真浏览器里是几毫秒这个量级（读数见 d2_seed_sweep）。
  const floors = D2_SEEDS.map((seed) => ({ seed, ...generateForArena(scene, seed) }))
  const cfg = floors[0]!.cfg

  const blocks = ROOM_KINDS_EMITTED.map((kind): Block => {
    for (const { seed, map } of floors) {
      const room = map.rooms.find((r) => r.kind === kind)
      if (room !== undefined) return { kind, at: { seed, map, room } }
    }
    return { kind, at: null }
  })

  return { cfg, blocks }
}

/** 一格在画布上的左上角。行优先：`ROOM_KINDS_EMITTED` 的次序从左到右、从上到下。 */
function cellAt(i: number): { x: number; y: number } {
  return {
    x: PAD + (i % COLS) * (CELL_W + GAP_X),
    y: TOP + Math.floor(i / COLS) * (CELL_H + GAP_Y),
  }
}

class D2RoomKindsArena extends ArenaBase {
  protected get definition(): ArenaDefinition {
    return arena
  }

  override preload(): void {
    super.preload()
    loadRoomsConfig(this)
  }

  protected configure(): ArenaConfig {
    // 与 `d2_floorplan` 同理：这一场的全部内容就是那六张画。
    // 喂墙进去反而会让人以为「这里能验碰撞」，而底座里的墙本来就没有物理体。
    return { rngSeed: 0xd2b7 }
  }

  protected override onArenaCreate(ctx: ArenaContext): void {
    const { cfg, blocks } = pickOnePerKind(ctx.scene)

    // 格子底板与分隔框。**画在最下面一层**（`drawRoom1to1` 用 -80 / -70），
    // 否则六块房会把格子框盖掉，看上去像六张图糊在一起。
    const g = ctx.scene.add.graphics().setDepth(-200)
    g.fillStyle(COLORS.outside, 0.65)
    g.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT)
    for (let i = 0; i < blocks.length; i++) {
      const { x, y } = cellAt(i)
      g.fillStyle(0x101018, 1)
      g.fillRect(x, y, CELL_W, CELL_H)
      g.lineStyle(1, 0x2a2a3a, 1)
      g.strokeRect(x, y, CELL_W, CELL_H)
    }

    blocks.forEach((block, i) => {
      const { x, y } = cellAt(i)
      drawBlock(ctx, cfg, block, x, y)
    })

    drawFooter(ctx.scene)

    // 提示条（底座那一条，20px、一行不折、没有宽度上限）—— 长度是算过的：
    // 约 890px / 1280。再加词就会顶出画布，想加先量。
    ctx.hud.setNotice(
      '六类关别各摆一间 —— 每一格自己的种子写在第二行（不打架的关别桌椅 / 刷怪点 / 预算 恒为 0）',
    )
  }
}

/** 一格：三行字 + 一张缩过的单间图。 */
function drawBlock(ctx: ArenaContext, cfg: RoomsConfig, block: Block, x: number, y: number): void {
  const label = ROOM_KIND_LABELS[block.kind]

  // 一行字怎么落。字号与 `d2_floorplan` 的读数一致，两个场子看着像同一套东西。
  const text = (dx: number, dy: number, s: string, size: number, color: string): void => {
    ctx.scene.add
      .text(x + dx, y + dy, s, { fontFamily: 'monospace', fontSize: `${size}px`, color })
      .setDepth(10)
  }

  if (block.at === null) {
    // **报缺，不兜底。** 拿别的关别顶上会让「这一类这一版压根没产出」
    // 看起来像「产出得好好的」，而这正是关别表最该被看见的一种坏法。
    text(8, 6, `${label} —— 六张牌里一间都没有`, 13, TEXT_EMPTY)
    text(8, 26, `看 d2_seed_sweep 或把这类加回 sideKindWeights`, 11, TEXT_DIM)
    return
  }

  const { seed, map, room } = block.at
  const where = room.branch === 'side' ? '侧室' : '主干'
  const combat = isCombatKind(cfg, room.kind)

  // **第一行是关别和三个数**：这三个数就是这一场唯一的判据，所以它们和关别
  // 并排放在最显眼的一行，并用**和描边同一个色系**的颜色 ——
  // 不打架的那两格一眼就该和旁边四格不一样。
  text(
    8,
    6,
    `${label} · ${where} · 桌椅 ${room.obstacles.length} · 刷怪点 ${room.spawnPoints.length} · 预算 ${room.budget}`,
    13,
    combat ? TEXT : TEXT_EMPTY,
  )
  // 第二行是**出处**：这一间在哪层楼的哪一间。印出来是为了可复现 ——
  // 换个种子想找同类样本时，拿这两个数去 `d2_seed_sweep`（它按 `N` 翻种子）对。
  text(
    8,
    26,
    `种子 ${seed} · #${room.order} · ${room.rect.width}×${room.rect.height} · 档位 ${room.sizeTier}`,
    11,
    TEXT_DIM,
  )

  // 贴边的框（见文件头）。墙骑在房间边界上、厚一格，所以先衬一格再各减半格的内边距。
  const box = inflate(room.rect, cfg.navCellSize)
  const drawX = x + 6
  const drawY = y + CAPTION_H
  const drawW = CELL_W - 12
  const drawH = CELL_H - CAPTION_H - 6
  const scale = Math.min(drawW / box.width, drawH / box.height)

  drawRoom1to1(ctx.scene, map, cfg, room, {
    box,
    // 居中：六格的框比例不一样，靠左上角对的话六张图会参差不齐，
    // 而「谁比谁大」正是这一场要看的东西之一。
    screenX: drawX + (drawW - box.width * scale) / 2,
    screenY: drawY + (drawH - box.height * scale) / 2,
    scale,
    walls: wallsNearRoom(map, box),
    // ⚠️ **关掉绘制层自带的标签。** 那些字是**定死 12px 的**（不随 `scale` 缩），
    // 一格只有 410px 宽，`#9 宝箱关 (side)` 加上六七个 `spawn` 会糊成一团，
    // 而这一场要看的是**桌椅有没有**，不是字。关别与三个数已经在上面三行里了。
    labels: false,
  })
}

/**
 * 右下角的读法（左下角被底座的按键说明占了，见文件头「版面」）。
 *
 * 三行、每行不超过 55 个全角字 —— 这一块的右边是画布边（1272），
 * 左边是 `HUD_HINT_RIGHT`，算下来只有 650px 可用（11px 字 ≈ 55 个全角）。
 */
function drawFooter(scene: ArenaContext['scene']): void {
  scene.add
    .text(
      FOOTER_AT.x,
      FOOTER_AT.y,
      [
        '白方块 = 底座钉在画布中心的假玩家（它压在第 2 格上），与这六张图无关',
        '每格两行：第一行关别 · 来源 · 桌椅/刷怪点/预算，第二行种子 · 序号 · 尺寸',
        '紫字 = 这一类不打架，三个数必须都是 0（判据 combatKinds；红格 = 40px 判定站不了）',
      ].join('\n'),
      { fontFamily: 'monospace', fontSize: '11px', color: TEXT_DIM, lineSpacing: 3 },
    )
    .setDepth(1000)
}

export const arena: ArenaDefinition = {
  displayName: 'D2 · 关别一览',
  // 长度是算过的：底座的标题**不折行**（`Hud.setTitle` 没有 `wordWrap`），
  // 一句写到 1200px 就会被画布右边切掉 —— 而切掉之后看着像「说明就写到这儿」。
  // 上限约 80 个全角字（15px 字，从 x = 8 起）。
  description:
    '六类关别各摆一间。每格两行：第一行关别 · 来源 · 桌椅/刷怪点/预算，第二行种子 · 序号 · 尺寸。道具关与宝箱关必须是空场地（0/0/0），另外四类都必须不是。',
  scene: D2RoomKindsArena,
}