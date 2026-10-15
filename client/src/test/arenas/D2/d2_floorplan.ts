/**
 * **整层楼的缩略图 + 一张侧室特写。** 回答的是缩略图尺度上的那几个问题 ——
 * 而它们**在单间教室里看不出来**，因为单间教室里根本没有第二个房间：
 *
 * | 要看的东西 | 坏了的样子 |
 * |---|---|
 * | 主干教室是不是**一排** | 排成了两排或者拐了弯 = 平面结构错了；「教室之间一段连廊」这个故事就不成立 |
 * | 连廊**接在相邻两间之间**吗 | 接错一间 = 平面上看着还行，进度轴上却是断的 |
 * | 侧室是**横跨宿主 + 连廊**的吗 | 飘到别处 / 只搭在宿主一半 = 「入口来自宿主」这条规则形同虚设 |
 * | 侧室**挂上还是挂下**是随机的吗 | 全在一边 = 那条派生随机流没接上，而它不报错 |
 * | 房间**宽度分档**是否合理 | 一间特别窄 = 威胁预算铺不开；一间特别宽 = 空得慌 |
 *
 * ## 为什么要**两张图**
 *
 * 一排 15 间房宽近 8000px、高不到 1000px —— 缩成一整屏是条 **12:1 的长条**，
 * 缩到屏幕上侧室与宿主的那点搭接只剩几个像素，而它恰恰是这个 change 里
 * **唯一一条新几何发明**。
 *
 * 所以下面再画一张：**一间侧室的取景框**（`roomViewBox` 会顺着它的两扇门
 * 把宿主与那段连廊一起并进来）。同一个 `drawRoom1to1`、同一份配色，
 * 两遍不会分叉。特写是按比例缩的（不是 1:1）—— 1:1 是 `d2_classroom` 的活。
 *
 * ## 这一场**不验**什么
 *
 * 它是**一张图**：没有战斗、没有寻路、也没有物理体。站在上面的白方块会飘过墙
 * 和桌子 —— 那不是 bug，是这一场压根没往底座里喂任何墙。
 *
 * 所以这里的 `configure()` 返回一个**空**配置：**这不是漏了，是这一场的全部内容
 * 就是那张画**。喂墙进去反而会让人以为「这里能验碰撞」，而底座里的墙本来就没有
 * 物理体（见 `ArenaBase.randomPoint` 的注释），撞不出东西来。
 *
 * 要验「挡不挡得住」去 `d2_classroom`（那里也还缺物理体），
 * 要验「换批种子稳不稳」去 `d2_seed_sweep`。
 */

import type { ArenaConfig, ArenaContext, ArenaDefinition } from '../../ArenaBase'
import { ArenaBase, WORLD_WIDTH } from '../../ArenaBase'
import type { RoomsConfig } from '@/domains/procgen/config'
import { COLORS, drawFloorplan, drawRoom1to1 } from '@/domains/procgen/presentation/floorplan'
import { fullyInside, roomViewBox, wallsNearRoom } from '@/domains/procgen/presentation/framing'
import { left, right, top } from '@/domains/procgen/model/rect'
import type { DungeonMap, Rect, Room, RoomKind } from '@/domains/procgen/model/types'
import { ROOM_KINDS_EMITTED, ROOM_KIND_LABELS } from '@/domains/procgen/model/types'
import { checkReachability } from '@/domains/procgen/validate/reachability'
import {
  chooseClassroom,
  DEFAULT_SEED,
  elapsedText,
  generateForArena,
  HUD_TOP_LEFT_BOTTOM,
  loadRoomsConfig,
} from './_shared'

/**
 * ## 版面：**底座先占了四条边，剩下的才是这一场的**
 *
 * 摆之前先看底座的 HUD 占哪儿（`test/Hud.ts`）：标题 + 7 行读数在**左上**，
 * **一直压到 `y ≈ 190`**；临时提示横在**中上**；按键说明钉在**左下**；
 * 还有一只白方块钉在**画布正中心**。三个数都量过，放在 `_shared.ts` 的
 * `HUD_TOP_LEFT_BOTTOM` 那一节（**那里是唯一一份**，别在这儿再抄一遍）。
 *
 * 躲不开的话两边的字会叠在一起 —— 而**叠在一起在现场看起来就是
 * 「读数没印出来」**，看场子的人会去查生成器。
 *
 * 于是：两张图占**左中部**（x 8—992），图例退到**右上**，读数压成 5 行放**右下**。
 *
 * ⚠️ 右边界取 992 而不是 1280：图例的色块在 x 1000 起。特写区宽度封在 984，
 * 于是**宽度再大也撞不到图例那一列**（比例由高度定，见下）。
 *
 * ⚠️ **`PLAN_BOX.y` 原来写的是 124**，理由是文件头一句「标题与读数在 y 8—120」——
 * 那句话是估的，实际到 190。症状在验收截图里看得见：缩略图**最左边两间**
 * （`#0 起点`、`#2 普通战`）的标签正好被读数的最后两行（`gun` / `juice`）压住，
 * 而这一版要看的恰恰就是**每间房的关别标签**。所以整条长条压到 210 起，
 * 下面那张特写跟着让出 86px（376 → 290 高，缩下来小两成，仍然看得清侧室横跨谁）。
 */
const PLAN_BOX = { x: 8, y: HUD_TOP_LEFT_BOTTOM, width: 984, height: 132 } as const
/**
 * 上面那张整层缩略图的盒子**比地图的比例高**，而且这是**故意**的：
 * 整层是 8:1 的长条，给再多竖直空间也用不上（`drawFloorplan` 会居中，上下留白）。
 * 给 132 是因为**下面那张特写要地方** —— 那张才是能看清侧室的一张。
 */
const DETAIL_TOP = 350
const DETAIL_BOTTOM = 640
/**
 * 图例的位置（右上角，但**让开标题那一行**）。
 *
 * 原来是 `y = 8`，而底座的说明行**不折行**、一直铺到画布右边 ——
 * 于是图例的头两行（主干教室 / 侧室）正好压在那行字上，两个都糊了。
 * 说明行的下沿约 46，提示条到 68，所以图例从 100 起，谁都压不着。
 */
const LEGEND_AT = { x: WORLD_WIDTH - 280, y: 100 } as const
/** 读数压在**右下**（左下被按键说明占了）。11px × 6 行。 */
const READOUT_AT = { x: WORLD_WIDTH - 762, y: DETAIL_BOTTOM } as const

class D2FloorplanArena extends ArenaBase {
  protected get definition(): ArenaDefinition {
    return arena
  }

  override preload(): void {
    super.preload()
    loadRoomsConfig(this)
  }

  protected configure(): ArenaConfig {
    // ⚠️ 这里**故意**不生成地图、也不返回任何墙：缩略图是画出来的，不是摆出来的。
    // 生成发生在 `onArenaCreate` 里（那时才有 `ctx.scene` 可以画）。
    return { rngSeed: 0xd2f1 }
  }

  protected override onArenaCreate(ctx: ArenaContext): void {
    const seed = DEFAULT_SEED
    const { map, cfg, elapsedMs } = generateForArena(ctx.scene, seed)

    // 和 `d2_classroom` 问**同一个函数** —— 缩略图上圈出来的就是那一场要走的房间。
    // 各挑各的话两块画面对不上，而「对不上」本身没法判断是挑错了还是生成错了。
    // 尺寸上限封在 `chooseClassroom` 里（以前两边各传各的：这里传 `WORLD_HEIGHT − 104`
    // 给读数栏让位、那边传整个 `WORLD_HEIGHT`，差距正好卡在最大档教室的取景框边界上）。
    const highlighted = chooseClassroom(map, cfg)

    const plan = drawFloorplan(ctx.scene, map, cfg, {
      ...PLAN_BOX,
      labels: true,
      doors: true,
      spawns: true,
      obstacles: false,
    })

    // d2_classroom 那一场要走的就是这一间 —— 圈出来，两个场子才接得上。
    if (highlighted !== null) {
      const r = plan.roomRect(highlighted)
      const g = ctx.scene.add.graphics().setDepth(-60)
      g.lineStyle(2, COLORS.startEdge, 1)
      g.strokeRect(r.x - 2, r.y - 2, r.width + 4, r.height + 4)
    }

    // 特写：第一间侧室。**挑第一间而不是挑最大的** —— 这个场子要给的是
    // 「侧室长什么样」的一个样本，按规则挑会引入一条看不见的排序，
    // 而排序一变（比如换了 sizeTier 的含义）画面就换一间，谁都不会注意到。
    const side = map.rooms.find((r) => r.branch === 'side') ?? null
    const detailDropped = side === null ? 0 : drawSideRoomCloseUp(ctx, map, cfg, side)

    // 连廊的两个数必须分开报，别把矩形的高度当成可走宽度。
    // `Passage.rect` **含墙**（墙是骑在它的那条线上画的，往里外各吃半层），
    // 所以 280 的矩形里只有 240 走得过去 —— 差的那 40 正好是一层墙厚。
    // 实测值走 `checkReachability`，和 `d2_seed_sweep` 是同一个函数、同一份网格：
    // 两处各量各的话，屏幕上 280 和 240 并排出现，看起来像生成器坏了。
    const reach = checkReachability(map, cfg)
    const p0 = map.passages[0]
    const clear = reach.passageClearWidths[0] ?? 0
    const width = p0 === undefined ? '—' : `${p0.rect.width}×${p0.rect.height}px（含墙）`

    // 五行，不是六行 —— 版面只留了右下那一块（左下是底座的按键说明）。
    // 「生成耗时」并进第二行里：它**在无头截图下恒为 0**（虚拟时钟冻住了），
    // 单独占一行会让人以为计时器坏了（见 `elapsedText`）。
    //
    // 第三行是**给眼睛看的对照表**：缩略图上「侧室挂上还是挂下」只有十几个像素，
    // 有没有全挂在同一边、是不是随机的，光看那条长条看不出来 —— 而那是
    // 这一版新加的随机项（`'bands'` 派生流）。把宿主与挂靠侧逐个印出来，
    // 图上一眼、这里一眼，两处对得上才算数。
    const lines = [
      `种子 ${seed} · 房间 ${map.rooms.length}（主干 ${map.rooms.filter((r) => r.branch === 'main').length} · ` +
        `侧室 ${map.rooms.filter((r) => r.branch === 'side').length}）· 每段连廊 ${width} · 实测净高 ${clear}px`,
      `最窄窄口 ${reach.narrowestOpeningWidth}px（下限 ${cfg.minPassageWidth}）· ` +
        `墙 ${map.walls.length} 段 · 障碍 ${map.rooms.reduce((n, r) => n + r.obstacles.length, 0)} 个 · ` +
        `生成 ${elapsedText(elapsedMs)}` +
        // 缩略图是 8:1 的长条，门标注挤不下就筛 —— 但**筛掉几条必须说出来**。
        // 不说的话，「图上只标了 12 扇门」和「这一层只有 12 扇门」在现场是同一种画面，
        // 而这一场恰恰是用来判「门对不对」的。（1:1 那张几乎不筛，见最后一行。）
        (plan.labelsDropped > 0 ? ` · 门标注挤不下筛掉 ${plan.labelsDropped} 条（缩略图窄，看下面特写那张）` : ' · 门标注全标上了'),
      sideSummary(map),
      // 关别一行的用处很具体：**「这一层有没有宝箱关」不用数格子**。
      // 缩略图上每间房都标着关别（`roleLabel`），但 8:1 的长条上那些字只有
      // 几个像素高 —— 一眼扫过去数不出“宝箱关 3 间”，而数不出就等于没有标记。
      // 按 `ROOM_KINDS_EMITTED` 的次序印，**没出现的关别不印**（印 0 会让人以为
      // 「这一类存在但这一层没有」，而 shop / hidden 本期压根不产出）。
      kindSummary(map),
      reach.layer1Ok && reach.layer2Ok
        ? '两层可达性全绿（层 1 含逐段连廊端到端）'
        : `⚠ ${reach.problems[0] ?? ''}`,
      (highlighted === null ? 'd2_classroom 挑不出放得下的教室' : `黄框 = d2_classroom 要走 #${highlighted.order}`) +
        ` · 特写是侧室 #${side?.order ?? '—'}（宿主 #${side?.anchoredTo ?? '—'} + 它东边那段连廊）` +
        (detailDropped > 0 ? ` · 特写里也筛掉了 ${detailDropped} 条标注` : ''),
    ]
    ctx.scene.add
      .text(READOUT_AT.x, READOUT_AT.y, lines.join('\n'), {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#9ad4ff',
      })
      .setDepth(1000)

    drawLegend(ctx.scene, LEGEND_AT.x, LEGEND_AT.y)

    ctx.hud.setNotice('这一场只是两张图 —— 没有战斗、没有寻路、没有物理体（中间那个白方块是底座钉死在画布中心的玩家，与地图无关）')
  }
}

/**
 * 「这一层里每类关别各有几间」一行。
 *
 * 按 `ROOM_KINDS_EMITTED` 的次序印，中文名读 `ROOM_KIND_LABELS` ——
 * 与缩略图标签、与 1:1 那一场是**同一份名字**（spec `procgen-config-contract`
 * 要求「关别的中文名只有一份表」）。
 */
function kindSummary(map: DungeonMap): string {
  const counts = new Map<RoomKind, number>()
  for (const r of map.rooms) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1)
  const parts = ROOM_KINDS_EMITTED.filter((k) => counts.has(k)).map(
    (k) => `${ROOM_KIND_LABELS[k]} ${counts.get(k)}`,
  )
  return parts.length === 0 ? '这一层一间房都没有' : `关别：${parts.join(' · ')}`
}

/**
 * 「哪间侧室挂在谁身上、挂上还是挂下」一行。
 *
 * 挂靠侧**不从 `band` 读**（那个字段没进 `Room`）：它由「侧室在自己宿主的上面
 * 还是下面」**直接看出来** —— 带的中线是 `y = 0`，主干教室恒在 0 上，
 * 侧室在 `±(带边 + 自己高/2)`。比的是两个房间的 `y`，不是某个中间量。
 */
function sideSummary(map: DungeonMap): string {
  const parts: string[] = []
  for (const r of map.rooms) {
    if (r.branch !== 'side') continue
    const host = map.rooms.find((h) => h.order === r.anchoredTo)
    const band = host !== undefined && r.rect.y < host.rect.y ? '上' : '下'
    parts.push(`${r.order}→${r.anchoredTo ?? '?'}${band}`)
  }
  return parts.length === 0 ? '这一层没有侧室' : `侧室 → 宿主（挂靠侧）：${parts.join(' · ')}`
}

/**
 * 侧室特写。**按比例缩，不是 1:1** —— 1:1 是 `d2_classroom` 的活。
 *
 * 框由 `roomViewBox` 算：它会顺着侧室的两扇门把**宿主**和**那段连廊**都并进来，
 * 于是这张图上能同时看见三件事 —— 侧室横跨了谁、入口门开在宿主头上哪一段、
 * 出口门是不是正对着通往下一间的那段连廊。
 */
function drawSideRoomCloseUp(
  ctx: ArenaContext,
  map: DungeonMap,
  cfg: RoomsConfig,
  side: Room,
): number {
  const box = roomViewBox(map, cfg, side)
  const regionW = PLAN_BOX.width
  const regionH = DETAIL_BOTTOM - DETAIL_TOP
  // 不放大（`min(1, …)`）：这个场子的取景是「看整体」，1:1 交给 `d2_classroom`。
  const scale = Math.min(1, regionW / box.width, regionH / box.height)
  const screenX = PLAN_BOX.x + (regionW - box.width * scale) / 2
  const screenY = DETAIL_TOP + (regionH - box.height * scale) / 2

  const view = drawRoom1to1(ctx.scene, map, cfg, side, {
    box,
    screenX,
    screenY,
    scale,
    walls: wallsNearRoom(map, box),
  })
  const mapper = view

  // 宿主与连廊**描一圈细线**。
  //
  // 「侧室横跨了谁」是这一版唯一的新几何发明，而它恰恰是**光看块与块分不出来**
  // 的一件事：绿色那块压在蓝色上面，压了多少、有没有盖住整段连廊，
  // 边界不画出来就只能凭感觉。画上这一圈之后，「侧室的西边伸进宿主、
  // 东边正好压到连廊的东端」是**量得出来**的，不用信谁的说法。
  const g = ctx.scene.add.graphics().setDepth(-75)
  const outline = (r: { x: number; y: number; width: number; height: number }, color: number): void => {
    const p = mapper.toScreen(left(r), top(r))
    g.lineStyle(1, color, 0.95)
    g.strokeRect(p.x, p.y, r.width * scale, r.height * scale)
  }

  const span = (r: Rect): string => `${Math.round(left(r))}..${Math.round(right(r))}`

  const host = map.rooms.find((r) => r.order === side.anchoredTo)
  if (host !== undefined) {
    outline(host.rect, COLORS.mainRoomEdge)
    // **坐标一起印出来**，不是只写「宿主」两个字：这一张要证明的是
    // 「侧室横跨宿主 + 连廊」，而那是一个**区间关系**（侧室的西边落在宿主里、
    // 东边正好到连廊的东端）。光看颜色块，压了多少只能凭感觉；印出两个区间，
    // 谁压谁、压了多长，读的人自己就能核。
    const p = mapper.toScreen(host.rect.x, top(host.rect) + cfg.navCellSize)
    ctx.scene.add
      .text(p.x, p.y, `#${host.order} 主干（宿主） x ${span(host.rect)}`, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#cfe4ff',
      })
      .setOrigin(0.5)
      .setDepth(-70)
  }
  for (const p of map.passages) {
    if (!fullyInside(p.rect, box)) continue
    outline(p.rect, 0xc9b483)
    // ⚠️ 印在连廊**上沿**，不是下沿：下沿那块地方已经归 `drawRoom1to1` 的
    // `连廊 3→5` 了（那条说的是「连着哪两间」，这一条说的是「横向从哪到哪」，
    // 两句都留着有用 —— 但挤在同一行就是一团糊字）。
    const c = mapper.toScreen(p.rect.x, top(p.rect) + cfg.navCellSize)
    ctx.scene.add
      .text(c.x, c.y, `连廊 x ${span(p.rect)}`, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#c9b483',
      })
      .setOrigin(0.5)
      .setDepth(-70)
  }

  // 侧室自己的区间与搭接长度。搭接 = 侧室西边到宿主西边的距离，
  // **它是这一版里唯一一个「不是房间尺寸、也不是连廊尺寸」的数**
  // （`k = 侧室档位宽 − roomGap`），最值得直接读出来。
  if (host !== undefined) {
    const overlap = Math.round(right(host.rect) - left(side.rect))
    // 标在**框顶那一条留白里**（侧室北墙外面），不是房间里：房间里面已经挤着
    // `drawRoom1to1` 的房名、`spawn` 标和刷怪点圆圈，再塞一行就成一团了。
    const s = mapper.toScreen(side.rect.x, top(side.rect) - cfg.navCellSize * 0.7)
    ctx.scene.add
      .text(s.x, s.y, `#${side.order} 侧室 x ${span(side.rect)} · 与宿主搭接 ${overlap}px`, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#4ab58a',
      })
      .setOrigin(0.5)
      .setDepth(-70)
  }

  // 标题钉在特写那一块的**正上方**（不是画布左上角）：缩略图在它上面，
  // 两处都写「左上角」的话，读的人得先猜这行字属于哪张图。
  ctx.scene.add
    .text(
      PLAN_BOX.x,
      DETAIL_TOP - 14,
      `▼ 侧室 #${side.order} 特写（${Math.round(scale * 100)}%）—— 两扇 side 门都开在朝主干的那面墙上`,
      { fontFamily: 'monospace', fontSize: '12px', color: '#9ad4ff' },
    )
    .setDepth(1000)

  // 特写这一张几乎不筛（框里就两三间房），但**筛了几个照样要报**：
  // 静默丢弃会让「这一层只有 12 个门洞」变成一句看着像真的假话。
  return view.labelsDropped
}

function drawLegend(scene: ArenaContext['scene'], x: number, y: number): void {
  const rows: [number, string][] = [
    [COLORS.mainRoomEdge, '主干教室'],
    [COLORS.sideRoomEdge, '侧室'],
    [COLORS.passage, '连廊地面'],
    [COLORS.startEdge, '起点（#0）'],
    [COLORS.bossEdge, '首领（最后一间）'],
    [COLORS.nonCombatEdge, '不打架的关别（紫描边）'],
    [COLORS.doorForward, '门 forward'],
    [COLORS.doorBack, '门 back'],
    [COLORS.doorSide, '门 side'],
    [COLORS.doorSealed, '门 toOrder = null（墙外）'],
    [COLORS.spawn, '刷怪点'],
    [COLORS.wall, '墙'],
  ]
  rows.forEach(([color, label], i) => {
    const row = y + i * 17
    scene.add.rectangle(x + 5, row + 6, 10, 10, color).setDepth(1000)
    scene.add
      .text(x + 16, row, label, { fontFamily: 'monospace', fontSize: '12px', color: '#9ad4ff' })
      .setDepth(1000)
  })
}

export const arena: ArenaDefinition = {
  displayName: 'D2 · 整层缩略图',
  // 长度是算过的：底座的标题**不折行**，写到 1200px 就会被画布右边切掉，
  // 而切掉之后看着像「说明本来就写到这儿」。上限约 80 个全角字（15px 字）。
  description:
    '两张图：上面一排 15 间房 + 连廊（粉点 = 刷怪点，黄框 = d2_classroom 要走的房间），下面一间侧室的特写（横跨宿主与连廊）。每间房标着「位置·关别」。',
  scene: D2FloorplanArena,
}