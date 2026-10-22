/**
 * `buildDungeonStages()` 的自动化验收 —— **D1 拿到的「一间房 = 一关」那张表**。
 * 跑在 node 环境：不加载 Phaser、不碰 DOM。
 *
 * 这一份测试挡的是三类**不报错**的错：
 *
 * 1. **层种子撞车** —— 同一局各层长出同一张图、不同局又撞在一起。报得出
 *    `runSeed` 却复现不出那一局，只有在查 bug 的时候才疼
 * 2. **「一局三层、一层一个首领」的名额错位** —— 一层两个首领（首领贬值成路障），
 *    或者一个都没有（这一层没有出口，玩家永远下不了楼）。两种都不抛异常
 * 3. **一层楼不完整** —— `rooms` 与 `stages` 条数对不上（少一间就少它那张几何表），
 *    真实管线里会以「关编号对不上」的样子炸在别处，离原因很远
 *
 * ## ★ 2026-10-21：`it.fails` 两条**已经转正**，另外五条按新模型重写
 *
 * 上一版这里挂着两条 `it.fails`（「每间房都有门」「每间都能从起点走到」），
 * 理由写在当时那份文件头里：v5 把 16 扇门全改成「房间 ↔ 走廊」，
 * 而那时的 `buildDungeonStages()` 只认「门通向另一间房」——
 * 走廊不是 `Room`，于是每扇门都只探得到一侧、**全被封死**，
 * `DoorTargets` 恒空 ⇒ 玩家出不了第一间房（且不抛任何错）。
 *
 * 用户拍板走「**整层连续**」之后这个前提不存在了（门不再需要指路，
 * `toId` 只记它通向哪段走廊），两条都**从红转绿**：
 *
 * | 那一条 | 现在 |
 * |---|---|
 * | 每一间房都有门（没有孤岛） | `r.doors.length > 0` —— **通过了** |
 * | 每一间都能从起点走到 | 换判据：在**烘好的可走性网格**上跑 D2 的 `assertReachable()` |
 *
 * ⚠️ **第二条是「换判据」不是「放宽」**：老版走的是一张**抽象房间图**
 * （边来自 `DoorTargets`），而整层连续下那张图**根本不存在**了 ——
 * 两间房都开向同一段走廊时它们之间是连通的，但图上没有这条边；
 * 反过来，图上「A → B」也不代表真的走得过去（中间可能隔着一段走不通的走廊）。
 * 现在问的是**运行时真的会发生的那件事**：从楼梯间走一遍，
 * 每一间房都要进得去、每一段走廊的每一格都要走得到
 * （那正是 `walkability.ts` 往 D3 的 `FlowField` 里注的判定）。
 *
 * ⚠️ **`it.fails` 转正时要做的是「把 `it.fails` 改回 `it` 并按新几何模型重写判据」** ——
 * 老文件头把这句话写着，这里照办了。**不要删**：它的对手是「静静删掉」，
 * 删掉之后 `vitest` 全绿、看的人以为门通了。
 *
 * 另外五条（两扇门不通向同一间、连通对称、门开在哪面墙、门数与去向数相等、
 * 至少有一间开三个门）**已经删掉了**，不改成新判据 —— 它们读的全是
 * `DoorTargets` / `DoorBarrier.toOrder` / `Room.branch` 这三个**随主干道模型一起作废**的字段，
 * 今天照抄只会空转（循环体一次都不跑、`0 === 0`），留着等于假装测过了。
 * 它们要表达的意思已经被「每间都有门 + 网格上真的走得到」两条盖住。
 *
 * 配置读真文件、种子写死：与 `colliders.test.ts` / `roomFlow.test.ts` 同一个手法、
 * 同一个理由（失败要能复跑）。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { bottom, containsPoint, left, right, top } from '@/domains/procgen/model/rect'
import { parseRoomsConfig, type RoomsConfig } from '@/domains/procgen/config'
import { parseFloorPlan, type FloorPlan } from '@/domains/procgen/gen/floorPlan'
import { assertReachable } from '@/domains/procgen/validate/reachability'
import { validateBalance } from '@/core/config'
import { parseCombatConfig } from './config'
import { stageGeometry } from './StageGeometry'
import { TerrainMap } from './TerrainMap'
import {
  arenaOf,
  buildDungeonStages,
  chestSpotAtCenter,
  chestSpotIn,
  FLOOR_STAGE,
  floorSeeds,
  roomIdsOf,
  type DungeonRoom,
  type DungeonStages,
} from './DungeonStages'

const CONFIG_DIR = fileURLToPath(new URL('../../../public/config/', import.meta.url))
const readJson = (name: string): unknown => JSON.parse(readFileSync(CONFIG_DIR + name, 'utf8'))

/**
 * 已校验的 `rooms.json`。
 *
 * ★ 改了（v5）：v4 这里走 `roomsConfigWithRoomCount(...)`，拿 `combat.json` 的
 * `arena.roomsPerFloor` / `sideRoomsPerFloor` 现造一份「7 间房」的配置 ——
 * 那时几何是**算**出来的，房间数是个自由参数。v5 几何是**画**出来的
 * （`floor-plan.json`），一层恒为 16 间，那个函数与它改的三个字段一起删了。
 */
const cfg: RoomsConfig = parseRoomsConfig(readJson('rooms.json'))

/**
 * 整层楼的几何 —— 与**种子无关**（`floor-plan.json` 里写死的 6F 平面图）。
 *
 * ⚠️ v5 新增：它是 `buildDungeonStages()` 的**第三个参数**（几何与内容分了家）。
 * 解析一次、下面所有种子共用一份。
 *
 * ⚠️ 2026-10-22：这个文件通篇钉的是 **6F 那一层**（首领恒为 `YF604`、恒 16 间房）。
 * 产品里另外两层不一样：第 1 层是逸夫楼 1F（`floor-plan-yf1.json`，14 间房、
 * **一间首领房都没有**），第 2 层是逸夫楼 3F（`floor-plan-yf3.json`，首领 `YF304`、
 * 15 间房）—— 期望值各不相同，跨层那几条在 `procgen/gen/floors.test.ts`、
 * `floorPlanYf1.test.ts` 与 `floorPlanYf3.test.ts`，别照着这里改产品。
 */
const plan: FloorPlan = parseFloorPlan(readJson('floor-plan.json'), cfg)

/** D1 的配置，只为拿 `arena.maxStages`（一局几层）。 */
const d1 = parseCombatConfig(readJson('combat.json'))

/**
 * 生成一层楼并拆成 D1 的关卡表。
 *
 * ★ 改了（v5）：签名从 3 个参数变 4 个 —— `buildDungeonStages(seed, cfg, plan, d1)`。
 * v4 的 `build(seed, overrides)` 也一并删了：overrides 是给「现造一份 N 间房配置」
 * 用的，房间数不再由测试决定之后，它没有东西可覆盖。
 */
function build(seed: number): DungeonStages {
  return buildDungeonStages(seed, cfg, plan, d1)
}

describe('DungeonStages — 一局多层：层种子与「一层一个首领」', () => {
  it('层种子由 `runSeed` 派生：同一个 runSeed 逐位相同（报出它就能复现整局）', () => {
    expect(floorSeeds(12345, 3)).toEqual(floorSeeds(12345, 3))
    expect(floorSeeds(12345, 3)).toHaveLength(3)
  })

  it('同一局内每一层的种子互不相同，不同局也不一样', () => {
    const a = floorSeeds(12345, 3)
    expect(new Set(a).size).toBe(3)
    expect(a).not.toEqual(floorSeeds(999, 3))
  })

  it('**每一层有且只有一个首领房，就是 YF604**', () => {
    // ⚠️ 这条是「一局三层、一层一个首领」的**前提**：正式游戏里首领只在
    // `room.kind === 'boss'` 那一间刷（见 `BattleScene.spawnStage()`），
    // 所以生成器必须保证「有且只有一个」—— 多一间不会报错，只是首领贬值；
    // 少一间也不会报错，只是这一层从此没有出口。
    //
    // ★ 改了（v5）：v4 这条的名字是「…在**最后一间**、而且**不是侧室**」，
    // 两个说法在 v5 里都没了立足点：「末间」是**进度轴**的说法，而 v5 的
    // `order` 只是显示序（`model/types.ts`：「任何按 `order` 大小推出来的
    // 结论都是错的」—— 实测 YF604 在 16 间里排第 5，离末位很远，但没有任何
    // 问题）；主/侧室之分随 `Room.branch` 一起删了。v5 的说法是**位置写死在
    // 平面图里**：`floor-plan.json` 里 YF604 的 `fixed` 就是 `boss`（用户原话
    // 「604 为这层最终关卡（首领关），其他教室或房间随机生成」），
    // 所以断言从「末间 + 非侧室」改成「就是 YF604」。
    for (const runSeed of [1, 837, 424242]) {
      for (const [i, seed] of floorSeeds(runSeed, d1.arena.maxStages).entries()) {
        const d = build(seed)
        const where = `runSeed ${runSeed} 的第 ${i + 1} 层（种子 ${seed}）`
        const bosses = d.rooms.filter((r) => r.room.kind === 'boss')
        expect(bosses, `${where}首领房不是一间`).toHaveLength(1)
        expect(bosses[0]!.room.id, `${where}首领房不是 YF604`).toBe('YF604')
      }
    }
  })

  it('每一层都是完整的一层楼：16 间房，但**只有 1 张几何表**（整层）', () => {
    // ★ 改了（v5）：原来对的是 `arena.roomsPerFloor`（那时它说一层有几间）。
    // v5 一层几间由平面图画死：15 间编号教室 + 1 间楼梯间 = 16；`arena.roomsPerFloor`
    // 只剩「拿不到地图时的兜底读数」。
    //
    // ★ 又改了（2026-10-22）：这个 16 从代码常量 `FLOOR_ROOM_TOTAL` 变成
    // **平面图自己声明的 `plan.roomTotal`** —— 一局三层楼间数各不相同
    // （1F 14 / 3F 15 / 6F 16），一个全局常量配不了三张图。
    //
    // ★ 又改了（2026-10-21，整层连续）：老版这里断言的是
    // `d.stages.stages` **也是 16 张**（一间房一张几何表）。那个拆法就是这次要拆掉的
    // 东西 —— 现在 `stages` 里**恰好一关**（`FLOOR_STAGE`），房间里那些桌椅墙
    // 全在那一张里的 `solids`。
    //
    // ⚠️ **这两个数一起断言是有意的**：只留「16 间房」的话，
    // 谁把 `stages` 又拆回一间一张也不会被拦住（观感上像是"关卡多了"，
    // 而实际后果是**同层之内几何会随 `enterStage()` 换掉**，玩家走过去墙就变）。
    for (const seed of floorSeeds(20261012, d1.arena.maxStages)) {
      const d = build(seed)
      expect(d.rooms).toHaveLength(plan.roomTotal)
      expect(d.stages.stages).toHaveLength(1)
      expect(d.stages.stages[0]!.stage).toBe(FLOOR_STAGE)
    }
  })
})

/** v4 的那八个种子，**原样保留**（连通性不能只在一个种子上碰巧成立）。 */
const SEEDS = [1, 2, 3, 13, 837, 20261012, 7919, 424242]

/**
 * 任务 5.10：**小地图不许把没进过的房标成「走过」**。
 *
 * 场景那一半（真的绕过一间、回头看一眼）**现在走得通了**（整层连续，见文件头）——
 * 但那一半是浏览器里的事，跑不到 node 里来。这里钉的是**接缝**：
 * `visited`（整数下标）→ 小地图要的 `Room.id` 集合。
 * 这一份错了的失败模式是**静默错位一整间**（图上一间房绿错），所以值得单独测。
 *
 * ★ 改了（2026-10-21）：函数从 `visitedRoomIds` 改名成 `roomIdsOf` ——
 * 它**不是「走过」专用**的。`BattleScene` 里同时有「去过没有」（喂小地图）和
 * 「打完没有」（喂地上的房号与门色）两份，两份都走它。名字只提 `visited` 的时候，
 * 第二处调用看起来就像「把 visited 又翻了一遍」，而房号读 `visited` 正是
 * 用户当天报的「刚进普通关还没打怪就显示已清」。**下面这几条判据一条没改，只是换了名字。**
 */
describe('DungeonStages — 「走过哪些间」的换算（任务 5.10）', () => {
  const d = build(13)

  it('**下标就是 `order`** —— 这条前提破了，上面那个换算会静默错位', () => {
    // `roomIdsOf` 写的是 `rooms[order]`，一句话把「下标」和「order」当成了同一个数。
    // 生成器现在确实按平面图序推，所以两者相等；哪天有人只重排数组、不重编号，
    // 表现是「小地图上一间房绿错」—— 不报错、也不影响别的任何东西。
    expect(d.rooms.map((r) => r.order)).toEqual(d.rooms.map((_, i) => i))
    // 顺带：`order` 与 `id` 一对一（`rooms[order].room.id` 这个反查才有唯一答案）
    expect(new Set(d.rooms.map((r) => r.room.id)).size).toBe(d.rooms.length)
  })

  it('**绕过一间去更远的房**：中间那几间不许跟着变成「走过」', () => {
    // 玩家从楼梯间（0）直接去了第 7 间（跳过了 1—6）。
    const visited = roomIdsOf(new Set([0, 7]), d.rooms)
    expect(visited.has(d.rooms[0]!.room.id)).toBe(true)
    expect(visited.has(d.rooms[7]!.room.id)).toBe(true)
    for (let skipped = 1; skipped <= 6; skipped++) {
      expect(
        visited.has(d.rooms[skipped]!.room.id),
        `第 ${skipped + 1} 间没进过，却被标成了走过（${d.rooms[skipped]!.room.id}）`,
      ).toBe(false)
    }
    expect(visited.size, '走过几间就是几个 id').toBe(2)
  })

  it('一间都没进过 = 空集合（不是「全部都算没走过」那种靠默认值的写法）', () => {
    expect(roomIdsOf(new Set(), d.rooms).size).toBe(0)
  })

  it('认不出来的下标**跳过、不抛** —— 换层那一瞬间会递进来上一层的下标', () => {
    // 不跳的话 `rooms[99]` 是 `undefined`、`.room.id` 当场抛；而抛在这个位置
    // （每帧都跑）会让整个场景停住 —— 比「多一间房灰着」严重得多。
    const visited = roomIdsOf(new Set([0, 99, -1]), d.rooms)
    expect([...visited]).toEqual([d.rooms[0]!.room.id])
  })
})

/**
 * 「整层走不走得通」这条命根子。**两条都在 2026-10-21 从 `it.fails` 转正**
 * （原委见文件头），断言体按整层连续的模型重写过，一条都没有放松。
 */
describe('DungeonStages — 一层楼必须走得通', () => {
  /**
   * 每一间房**至少有一扇门**。没有门 = 孤岛：刷怪点、宝箱、清房判定全在墙外面，
   * 而玩家永远进不去 —— 这不会抛任何错，只会在小地图上留下一间永远灰着的教室。
   *
   * ⚠️ **别把判据写回 `doorTargets`**（那个字段随「一间房 = 一关」一起没了）：
   * 今天要问的是「这扇门归谁」（`ownerOrder`），因为开门/封门**按房判**
   * —— `doorShouldBeClosed({ ownerOrder, combatRooms })`。
   */
  it('每一间房都有门（没有孤岛）', () => {
    for (const seed of SEEDS) {
      const d = build(seed)
      for (const r of d.rooms)
        expect(
          r.doors.length,
          `种子 ${seed}：第 ${r.order + 1} 间（${r.room.id}）一扇门都没有`,
        ).toBeGreaterThan(0)
    }
  })

  /**
   * **每一间都能从楼梯间走到** —— 走不通的地牢就是坏关卡。
   *
   * 判据整个换掉了：老版走一张**抽象房间图**（边来自 `DoorTargets`），
   * 而那张图在整层连续下不存在 —— 两间房都开向同一段走廊时它们之间是通的，
   * 图上却没有这条边；反过来图上相邻也不代表真的走得过去。
   *
   * 现在直接跑 **D2 自己的 `assertReachable()`**，它问的是运行时真的会发生的那件事：
   * 在烘好的可走性网格上从楼梯间 flood 一遍，每一间房都要进得去、
   * 每一段走廊的每一格都要走得到（`walkability.ts` 往 D3 的 `FlowField` 里注的就是这份判定）。
   *
   * ⚠️ 这里**不能再手写一遍 BFS**：那份实现已经有两处（D2 的校验器 + 寻路网格），
   * 再抄一份进测试就有了第三个「可达」的定义 —— 而三者分岔的那天，
   * 测试会红着指向一个玩家根本走不到的地方。
   */
  it('**每一间都能从起点走到** —— 走不通的地牢就是坏关卡', () => {
    for (const seed of SEEDS) {
      const d = build(seed)
      // `assertReachable` 失败时自己抛（带着「哪一间没进去」），所以这里不用再断言返回值
      expect(() => assertReachable(d.map, cfg), `种子 ${seed}`).not.toThrow()
    }
  })
})

/**
 * ★ 新增（2026-10-21）：**楼梯间交出去的那两样东西分别是哪一间、哪个点**。
 *
 * 用户当天把楼梯间定成了「每层之间的中转站」：去下一层的入口要亮在**它里面**，
 * 有上一层时也**从它里面**回去。于是 `DungeonStages` 交出的那一对值
 * （`spawn` = 门外走廊、`stairwell` = 这一间本身）就成了两件事的分界线 ——
 * 而它们**长得几乎一样**（都是 `Point` 时代更是如此），接错一个不报任何错：
 *
 * - 拿 `spawn` 当楼梯间 → 「入口在门口」那个 bug 回来了（用户报的就是它）
 * - 拿 `stairwell` 当出生点 → 玩家每层出生在楼梯间里，而「出生在门外走廊上」
 *   是用户 2026-10-21 亲自定下的
 *
 * `stairwell` 在 2026-10-21 从 `Point`（中心）改成了 `Rect`：上下两个入口
 * 摆在哪儿要按这一间**多大**算（`Stairwell.stairPadSpots()`）。
 */
describe('DungeonStages — 楼梯间：出生点在门外、上下楼的入口在门里', () => {
  it('`stairwell` 就是那一间楼梯间的矩形（不是它的中心、也不是别的房）', () => {
    for (const seed of SEEDS) {
      const d = build(seed)
      const starts = d.rooms.filter((r) => r.room.kind === 'start')
      expect(starts, `种子 ${seed}：楼梯间不是一间`).toHaveLength(1)
      expect(d.stairwell, `种子 ${seed}：\`stairwell\` 与那一间的矩形对不上`).toEqual(
        starts[0]!.room.rect,
      )
      // 「中心」这件事仍然读得到（`Rect` 的约定是 `x` / `y` 就是中心）——
      // 上面那句 `toEqual` 已经把整条矩形钉住了，这里只是把那个约定写明白。
      expect(containsPoint(d.stairwell, d.stairwell.x, d.stairwell.y)).toBe(true)
      expect(d.stairwell.width, `种子 ${seed}：楼梯间没有宽度`).toBeGreaterThan(0)
      expect(d.stairwell.height, `种子 ${seed}：楼梯间没有高度`).toBeGreaterThan(0)
    }
  })

  it('**出生点在楼梯间门外** —— 不在这一间里，而且就在门口那一带', () => {
    // ⚠️ 这一条**不是**「出生点必须离楼梯间多远才算对」的审美判断，它挡的是两件事：
    // ① 出生点被算进楼梯间里 → 玩家一出生就「在楼梯间里」，
    //    而楼梯间是唯一会亮「上一层」那类入口的房间（`enterRoom()` 那一条分支）；
    // ② 出生点算到别处去了 → 玩家开局站在一间教室中间，或者要横穿半层楼才能上下楼。
    for (const seed of SEEDS) {
      const d = build(seed)
      expect(
        containsPoint(d.stairwell, d.spawn.x, d.spawn.y),
        `种子 ${seed}：出生点 (${d.spawn.x}, ${d.spawn.y}) 落在楼梯间 ${JSON.stringify(d.stairwell)} 里`,
      ).toBe(false)
      // 走廊那一格与这一间的边最多隔 3 格（`corridorPointAt()` 的取法 +
      // `navCellSize` 40px）—— 量到矩形边缘的距离，不是到中心的。
      const dx = Math.max(left(d.stairwell) - d.spawn.x, 0, d.spawn.x - right(d.stairwell))
      const dy = Math.max(top(d.stairwell) - d.spawn.y, 0, d.spawn.y - bottom(d.stairwell))
      const away = Math.hypot(dx, dy)
      expect(
        away,
        `种子 ${seed}：出生点离楼梯间有 ${Math.round(away)}px —— 那已经不是「门外」了`,
      ).toBeLessThan(cfg.navCellSize * 4)
    }
  })

  it('楼梯间**恰好一扇门** —— 出生点是顺着它算出来的', () => {
    // `buildDungeonStages()` 拿 `stairRoom.doors[0]` 去算走廊上那个点。
    // 多一扇门不会报错，只会让出生点**取决于房间表里的顺序**（哪天顺序变了，
    // 出生点就换到另一条走廊上去了）。
    for (const seed of SEEDS) {
      const d = build(seed)
      const stair = d.rooms.find((r) => r.room.kind === 'start')!
      expect(stair.doors, `种子 ${seed}：楼梯间的门不是一扇`).toHaveLength(1)
    }
  })
})

/**
 * ★ 新增（2026-10-21）：**刷怪点与宝箱的落点必须留在自己那间房里**。
 *
 * 这一条钉的是用户 2026-10-21 报的「宝箱和怪物生成位置有问题，会刷新在走廊和其他房间」。
 *
 * 根因在 `TerrainMap.safeSpawn()`（泛洪拿**摆放净空**当**通行半径**用，见那份注释），
 * 但它坏得**很安静**：`safeSpawn()` 自己的不变量一条都没破 —— 走廊那一片
 * 确实站得住、也确实从出生点走得到，错的只有「它在谁的房间」。
 * 所以这一条不看 `safeSpawn()` 的不变量，只看**玩家看得见的那件事**：
 * 落点在不在本间的矩形里（`Room.rect` 是**纯可走区**，走廊不在任何一间房里）。
 *
 * ⚠️ **要传 `safeSpawn()` 的第四个参数**，这里照抄 `CombatSession` / `BattleScene` 的调用口径
 * （通行半径 = 玩家）。少了它这一份就是红的 —— 那正是它能拦住回归的原因，
 * 所以下面每个用例都**顺带断言了「老口径确实坏」**：判据本身坏了会当场说出来，
 * 而不是变成一个永远绿的测试。
 */
describe('DungeonStages — 刷怪点与宝箱的落点不许出房（2026-10-21 用户报的 bug）', () => {
  /**
   * 与 `BattleScene.ENEMY_CLEARANCE` **必须是同一个数**。
   *
   * 它是 `private const`，node 里 import 不进来（那个文件拖 Phaser），所以只能抄一份 ——
   * 抄的东西会漂，于是下面有一条**读源码**的断言把它钉住：谁改了那边，
   * 这里会红着告诉他「这个数变了，这份测试的前提跟着变」。
   */
  const ENEMY_CLEARANCE = 26
  /** 通行半径 = 玩家。**不是**怪的半径，也不是宝箱的 —— 见 `safeSpawn()` 的注释。 */
  const PLAYER_RADIUS = validateBalance(readJson('balance.json')).baseline.player.radius
  /** 宝箱的**净空**是半边长（`visualSize` 是直径，56 → 28）。 */
  const CHEST_HALF = d1.chest.visualSize / 2
  /** 宝箱摆在玩家上方这么远（`BattleScene.chestSpot()` 的字面量）。 */
  const CHEST_LIFT = 60

  /**
   * 与 `CombatSession` 的构造一字不差：**同一个竞技场**、同一份几何、同一个格子尺寸。
   *
   * ⚠️ 竞技场不是 `combat.json` 里那个 1344×832 —— 那是「一间房一关」时代的读数。
   * 正式路径是 `BattleScene.applyArena()`：整层的包围盒（今天 10520×2920）**写回
   * `cfg.arena`**，之后 `TerrainMap` 的宽高、`stageGeometry()` 的取景框、
   * 寻路网格的行列数读的都是它。**照抄 `combat.json` 的 `arena` 会静默缩到七分之一**
   * （`fitMapFrame` 那一下），于是这份测试全挂在「出生点在墙里」上 —— 我自己先踩了一次。
   */
  function terrainOf(d: DungeonStages): TerrainMap {
    const arena = arenaOf(d.map)
    const floorCfg = { ...d1, arena: { ...d1.arena, ...arena } }
    const t = new TerrainMap(floorCfg, d.stages.navigationCellSize)
    t.setStage(stageGeometry(d.stages, FLOOR_STAGE, arena.width, arena.height))
    return t
  }
  const doorCenter = (u: DungeonRoom) => {
    const door = u.doors[0]!
    return { x: door.x + door.width / 2, y: door.y + door.height / 2 }
  }
  /** 一句话说清「哪一间的哪个点被扔到了哪儿」。 */
  const escape = (u: DungeonRoom, from: string, spot: { x: number; y: number }) =>
    `${u.room.id}(${u.room.kind}) 的${from}跑到房外了：` +
    `${JSON.stringify(spot)}，房间是 ${JSON.stringify(u.room.rect)}`

  it('`ENEMY_CLEARANCE` 与 `BattleScene` 同步（它是 private，只能读源码对账）', () => {
    const src = readFileSync(fileURLToPath(new URL('./BattleScene.ts', import.meta.url)), 'utf8')
    expect(
      src.includes(`const ENEMY_CLEARANCE = ${ENEMY_CLEARANCE}`),
      // 改了那边的话：把这份测试上的数改掉、再跑一遍 —— 「刷怪点留在房里」这个判据本身没问题
      `BattleScene.ts 里的 ENEMY_CLEARANCE 不再是 ${ENEMY_CLEARANCE} 了，` +
        '把本文件上方的常量改成同一个数（这份测试用它复现刷怪净空）',
    ).toBe(true)
  })

  it('**每一个刷怪点都落在它自己那间房里**', () => {
    for (const seed of SEEDS) {
      const d = build(seed),
        terrain = terrainOf(d)
      // 挪一挪是正常的（D2 的刷怪点可能落在书桌那一格里，`safeSpawn()` 把它贴到最近的
      // 合法格子中心）。**离谱的挪法才是那个 bug**：实测过 673px / 731px —— 直接到隔壁房。
      // 上限取 4 格：兜底是在**格子中心**上找最近的，落点离目标不会超过几格。
      const limit = 4 * terrain.cellSize
      for (const u of d.rooms)
        for (const [i, raw] of u.spawnPoints.entries()) {
          const spot = terrain.safeSpawn(raw.x, raw.y, ENEMY_CLEARANCE, PLAYER_RADIUS)
          expect(
            containsPoint(u.room.rect, spot.x, spot.y),
            `种子 ${seed}：${escape(u, `第 ${i + 1} 个刷怪点`, spot)}`,
          ).toBe(true)
          const moved = Math.hypot(spot.x - raw.x, spot.y - raw.y)
          expect(
            moved,
            `种子 ${seed}：${u.room.id} 的第 ${i + 1} 个刷怪点被挪了 ${moved.toFixed(1)}px` +
              `（从 ${JSON.stringify(raw)} 到 ${JSON.stringify(spot)}）—— 上限 ${limit}px。` +
              '挪这么远不是「贴齐格子」，是泛洪进不了这间房。',
          ).toBeLessThan(limit)
        }
    }
  })

  it('**宝箱无论玩家站在门前还是房中央，都落在本间房里**', () => {
    for (const seed of SEEDS) {
      const d = build(seed),
        terrain = terrainOf(d)
      for (const u of d.rooms) {
        // 宝箱的锚点是**玩家当时站的地方**：他要么刚从门进来，要么已经在房里走动。
        const stands: Array<[string, { x: number; y: number }]> = [
          ['门', doorCenter(u)],
          ['房中央', { x: u.room.rect.x, y: u.room.rect.y }],
        ]
        for (const [where, p] of stands) {
          const want = chestSpotIn(u, p.x, p.y, CHEST_LIFT, CHEST_HALF)
          const spot = terrain.safeSpawn(want.x, want.y, CHEST_HALF, PLAYER_RADIUS)
          expect(
            containsPoint(u.room.rect, spot.x, spot.y),
            `种子 ${seed}：玩家站在${where}时，${escape(u, '宝箱', spot)}`,
          ).toBe(true)
        }
      }
    }
  })

  /**
   * **判据的对照**：这一条要是也绿，上面几条测的就不是那个 bug 了。
   *
   * 两个老口径各钉一处历史错误，都是**量出来的**（2026-10-21，`SEEDS` 这八个种子）：
   *
   * | 老口径 | 症状 |
   * |---|---|
   * | 怪的净空当通行半径用（`safeSpawn(p, 26)`） | 9 个刷怪点出房（种子 3 六个、424242 三个） |
   * | 宝箱拿**直径**当半径用（`safeSpawn(p, 56)` = `chest.visualSize`） | **32/32 全出房**，每一个种子都如此 |
   *
   * 第二个数才是「宝箱全在走廊」的原始症状：56 > 门洞 ⇒ 泛洪进不了任何一间房。
   * 57 个采样点一个都不留 —— 判据不可能空转。
   */
  it('对照：两个老口径确实会把东西扔出房 —— 判据没有空转', () => {
    let enemiesOut = 0,
      chestsOut = 0,
      chests = 0
    for (const seed of SEEDS) {
      const d = build(seed),
        terrain = terrainOf(d)
      for (const u of d.rooms) {
        for (const raw of u.spawnPoints) {
          const spot = terrain.safeSpawn(raw.x, raw.y, ENEMY_CLEARANCE)
          if (!containsPoint(u.room.rect, spot.x, spot.y)) enemiesOut++
        }
        const want = chestSpotIn(u, doorCenter(u).x, doorCenter(u).y, CHEST_LIFT, CHEST_HALF)
        chests++
        // 老写法：`visualSize` 直接当净空半径（它其实是直径，56）
        const spot = terrain.safeSpawn(want.x, want.y, d1.chest.visualSize)
        if (!containsPoint(u.room.rect, spot.x, spot.y)) chestsOut++
      }
    }
    expect(enemiesOut, '老口径的怪一个都没出房 —— 这组种子已经碰不到那个形状了，得重挑').toBeGreaterThan(0)
    expect(
      chestsOut,
      `老口径的宝箱只有 ${chestsOut}/${chests} 出房 —— 这份判据快空转了，得重挑种子`,
    ).toBe(chests)
  })
})

/**
 * 道具关 / 宝箱关的宝箱**摆在房间正中心**（用户 2026-10-21 的原话）。
 *
 * 这一条与上面那一组是**两种摆法**：上面那种（玩家身前 60px）是精英关打完那一刻用的，
 * 这里这种是不用打的房用的。区别的理由写在 `chestSpotAtCenter()` 上。
 *
 * ⚠️ 老写法（玩家身前 60px）在这一类房里**稳定地错**，而错的地方很显眼：
 * 进门是在玩家刚跨过门口那一刻判定的，所以宝箱永远贴着刚进来那扇门，
 * 实测离房间中心 240—260px —— 也就是**画在他自己头上**。
 */
describe('DungeonStages — 道具关 / 宝箱关的宝箱在房间正中心（2026-10-21）', () => {
  /** 宝箱的**净空**是半边长（`visualSize` 是直径，56 → 28）。 */
  const CHEST_HALF = d1.chest.visualSize / 2
  const PLAYER_RADIUS = validateBalance(readJson('balance.json')).baseline.player.radius
  /** 宝箱摆在玩家上方这么远（老口径，`BattleScene.chestSpot()` 的字面量）。 */
  const CHEST_LIFT = 60

  /** 不用打的房 = 道具关 / 宝箱关（楼梯间也是，但它没有宝箱，下面按 `needsFight` 和关别筛）。 */
  const chestRooms = (d: DungeonStages) =>
    d.rooms.filter((u) => !u.needsFight && (u.room.kind === 'reward' || u.room.kind === 'chest'))

  function terrainOf(d: DungeonStages): TerrainMap {
    const arena = arenaOf(d.map)
    const floorCfg = { ...d1, arena: { ...d1.arena, ...arena } }
    const t = new TerrainMap(floorCfg, d.stages.navigationCellSize)
    t.setStage(stageGeometry(d.stages, FLOOR_STAGE, arena.width, arena.height))
    return t
  }

  it('**每一个非战斗房的宝箱落点都等于它自己的矩形中心**（8 个种子、逐间）', () => {
    let seen = 0
    for (const seed of SEEDS) {
      const d = build(seed)
      for (const u of chestRooms(d)) {
        seen++
        const spot = chestSpotAtCenter(u)
        expect(
          { x: spot.x, y: spot.y },
          `种子 ${seed}：${u.room.id}(${u.room.kind}) 的宝箱没在正中心`,
        ).toEqual({ x: u.room.rect.x, y: u.room.rect.y })
      }
    }
    // 空转的守卫：这一类房要是抽不出来，上面那个循环一次都不跑、而测试是绿的。
    expect(seen, '8 个种子里一间道具关/宝箱关都没抽到？种子或权重变了').toBeGreaterThan(8)
  })

  it('**中心点离四边都留得下宝箱**，而且 `safeSpawn()` 不会把它挪走', () => {
    // 「挪走」这一半才是真正要守的：`BattleScene` 交出去的落点还要过 `safeSpawn()`，
    // 而那是**玩家**在走（通行半径 = 玩家 12）—— 中心要是被课桌占着，
    // 落点会被顶开几十像素，「正中心」就只剩个近似。
    // （非战斗关别一件家具都不摆，由 `obstacles.ts` 早返回 + `colliders.test.ts` 钉着。）
    for (const seed of SEEDS) {
      const d = build(seed),
        terrain = terrainOf(d)
      for (const u of chestRooms(d)) {
        const c = chestSpotAtCenter(u)
        const r = u.room.rect
        expect(
          Math.min(c.x - (r.x - r.width / 2), r.x + r.width / 2 - c.x),
          `种子 ${seed}：${u.room.id} 的房间只有 ${r.width}px 宽，正中心放不下宝箱`,
        ).toBeGreaterThanOrEqual(CHEST_HALF)
        const got = terrain.safeSpawn(c.x, c.y, CHEST_HALF, PLAYER_RADIUS)
        expect(
          { x: got.x, y: got.y },
          `种子 ${seed}：${u.room.id} 正中心的宝箱被 safeSpawn 挪走了` +
            `（挪了 ${Math.hypot(got.x - c.x, got.y - c.y).toFixed(1)}px）—— 那一格上一定有东西`,
        ).toEqual({ x: c.x, y: c.y })
      }
    }
  })

  it('对照：老口径（玩家身前 60px）在这一类房里**离中心很远** —— 判据没有空转', () => {
    // 进门那一刻玩家就站在门内侧，所以「身前 60px」落的是**门口**，不是房里。
    // 这一条要是也绿，上面那条「等于中心」测的就不是这个 bug 了。
    let worst = Infinity
    for (const seed of SEEDS) {
      const d = build(seed)
      for (const u of chestRooms(d)) {
        const door = u.doors[0]!
        const anchor = { x: door.x + door.width / 2, y: door.y + door.height / 2 }
        const old = chestSpotIn(u, anchor.x, anchor.y, CHEST_LIFT, CHEST_HALF)
        const c = chestSpotAtCenter(u)
        worst = Math.min(worst, Math.hypot(old.x - c.x, old.y - c.y))
      }
    }
    expect(
      worst,
      `老口径最近的一次只离中心 ${worst.toFixed(0)}px —— 这组种子里道具房都太小了，得重挑`,
    ).toBeGreaterThan(100)
  })
})
