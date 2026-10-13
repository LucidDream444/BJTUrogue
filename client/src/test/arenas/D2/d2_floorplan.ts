/**
 * **整层楼的缩略图。** 回答的是缩略图尺度上的那几个问题 ——
 * 而它们**在单间教室里看不出来**，因为单间教室里根本没有第二个房间：
 *
 * | 要看的东西 | 坏了的样子 |
 * |---|---|
 * | 主干道是不是一条**直**线 | 弯了 = 房间的横向排布错了；玩家会以为走廊有岔路 |
 * | 走廊**通到底**了吗 | 中间某处被墙封死 = 房间图形状对了，几何却是断的 |
 * | 每间主干教室的**门开在走廊那一侧**吗 | 门开错边 = 玩家进不去，而校验器只看「门的两侧有没有空地」，看不出来 |
 * | 侧室**贴着**宿主吗 | 侧室飘到别处 = 「入口来自宿主」这条规则形同虚设 |
 * | 房间**大小**分档是否合理 | 一间特别小 = 威胁预算铺不开；一间特别大 = 空得慌 |
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
import { ArenaBase, WORLD_HEIGHT, WORLD_WIDTH } from '../../ArenaBase'
import { COLORS, drawFloorplan } from '@/domains/procgen/presentation/floorplan'
import { chooseClassroom, DEFAULT_SEED, generateForArena, loadRoomsConfig, summarise } from './_shared'

/** 缩略图占的高度。下面那一块留给图例与读数 —— 图铺满整块画布的话，字会压在地图上。 */
const PLAN_HEIGHT = 520

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
    const highlighted = chooseClassroom(map, cfg, WORLD_WIDTH, WORLD_HEIGHT - 104)

    const plan = drawFloorplan(ctx.scene, map, cfg, {
      x: 0,
      y: 0,
      width: WORLD_WIDTH,
      height: PLAN_HEIGHT,
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

    const lines = [
      `D2 · 整层缩略图（种子 ${seed}）`,
      ...summarise({ map, cfg, elapsedMs }),
      `走廊可走 ${Math.round(map.corridorRect.height)}px 高 · 墙 ${map.walls.length} 段 · ` +
        `障碍 ${map.rooms.reduce((n, r) => n + r.obstacles.length, 0)} 个`,
      highlighted === null
        ? '这一档尺寸下，d2_classroom 挑不出 1:1 能摆下的教室'
        : `黄框 = d2_classroom 那一场要走的房间（#${highlighted.order}）`,
    ]
    ctx.scene.add
      .text(8, PLAN_HEIGHT + 8, lines.join('\n'), {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#9ad4ff',
        lineSpacing: 3,
      })
      .setDepth(1000)

    // 图例。**颜色方块和文字画在一起** —— 只写「蓝 = 主干教室」的话，
    // 名字和颜色之间隔着一次翻译，而翻译是最容易没人去核的一步。
    drawLegend(ctx.scene, WORLD_WIDTH - 320, PLAN_HEIGHT + 8)

    ctx.hud.setNotice('这一场只是一张图 —— 没有战斗、没有寻路、没有物理体')
  }
}

function drawLegend(scene: ArenaContext['scene'], x: number, y: number): void {
  const rows: [number, string][] = [
    [COLORS.mainRoomEdge, '主干教室'],
    [COLORS.sideRoomEdge, '侧室'],
    [COLORS.startEdge, '起点（#0）'],
    [COLORS.bossEdge, '首领（最后一间）'],
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
  description:
    '一张图：15 间房串在一条直走廊上，主干/侧室配色，门按 Kind 上色，粉点是刷怪点，黄框是 d2_classroom 要走的房间。看走廊通不通、侧室贴不贴着宿主、门的朝向对不对。',
  scene: D2FloorplanArena,
}