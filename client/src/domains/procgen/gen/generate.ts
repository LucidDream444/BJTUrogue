/**
 * 生成入口。**纯函数，零 Phaser 依赖，同一个 seed + 同一份配置 → 逐字节相同的地图。**
 *
 * ---
 *
 * ## 五步，顺序本身就是设计
 *
 * ```
 * 1. planLayout      房间在哪、多大、门开在哪儿           ← 只碰几何
 * 2. placeObstacles  每间教室的课桌椅                     ← 只碰几何
 * 3. buildGrid       把墙 + 障碍物烘成一张寻路网格         ← 唯一的"看全局"的一步
 * 4. placeSpawnPoints 从门 flood fill，**只从可达格里挑**   ← 这一步是软的还是硬的，全看上一步
 * 5. 组装 DungeonMap
 * ```
 *
 * 2 在前、4 在后是**不能换的**。换了就必须靠「摆完检查、不通重来」兜底，
 * 而重试次数不确定会让耗时出现长尾 —— 见 `spawns.ts` 的文件头。
 *
 * ## 网格在这里建**一次**，之后所有房间共用
 *
 * `placeSpawnPoints` 收到的是**整层楼**的网格，不是只包含自己那间房的。
 * 这不是省事，是必须：只喂自己那间房的话，flood fill 走不出门洞，
 * 于是「从门可达」退化成「在自己房间里可达」——
 * 而前者才是要证的那件事（玩家得进得来，怪得出得去）。
 *
 * ## 为什么 `now` 是参数而不是在这里读时钟
 *
 * `elapsedMs` 是唯一一个**不参与任何判定**的字段（见 `model/types.ts`）。
 * 但它一旦由生成器自己读时钟，`gen/` 里就再也无法用 grep 证明「生成是确定的」——
 * 而 grep 是这个约定唯一便宜的强制手段，它只在规则**绝对**时成立。
 *
 * 所以时钟从外面注入：不传 `now` 时 `elapsedMs` 就是 `0`。
 * 测试场和 D1 想显示耗时，自己传 `performance.now` 进来。
 * 这样「把假时钟换成真时钟，地图除 `elapsedMs` 外完全相同」是一件**可以写成断言的事**，
 * 而不是一句注释里的承诺。
 */

import type { DungeonMap, Obstacle } from '../model/types'
import { DUNGEON_SCHEMA_VERSION } from '../model/types'
import type { RoomsConfig } from '../config'
import { buildGrid, navExtentFor } from '../walkability'
import { planLayout } from './layout'
import { placeObstacles } from './obstacles'
import { placeSpawnPoints } from './spawns'

/**
 * 生成一层楼。
 *
 * @param seed 种子。同一个 seed + 同一份 `cfg` → 完全相同的地图
 * @param cfg  已校验的 `rooms.json`（**先过 `parseRoomsConfig`**，这里不再校验）
 * @param now  可选的时钟（毫秒）。不传则 `elapsedMs` 为 0，见文件头
 */
export function generateDungeon(
  seed: number,
  cfg: RoomsConfig,
  now?: () => number,
): DungeonMap {
  const t0 = now === undefined ? 0 : now()

  // 1. 几何：房间、门、墙
  const plan = planLayout(seed, cfg)

  // 2. 障碍物。`Room` 的字段全是 readonly，所以这里是**造新对象**而不是就地改 ——
  //    顺带让「哪一步产生了什么」在类型上看得见：第 2 步之前没有 obstacles，
  //    第 4 步之前没有 spawnPoints，不靠注释记。
  const withObstacles = plan.rooms.map(
    (room) => ({ ...room, obstacles: placeObstacles(seed, cfg, room) }) as const,
  )

  // 3. 整层一张网格。墙和全部房间的障碍物一起烘进去
  const obstacles: Obstacle[] = []
  for (const room of withObstacles) for (const o of room.obstacles) obstacles.push(o)

  const extent = navExtentFor(plan.bounds, cfg.navCellSize)
  const grid = buildGrid({
    walls: plan.walls,
    obstacles,
    cellSize: cfg.navCellSize,
    originX: extent.originX,
    originY: extent.originY,
    width: extent.width,
    height: extent.height,
  })

  // 4. 出生点：每个都从门可达（由构造保证，不是校验出来的）
  const rooms = withObstacles.map((room) => ({
    ...room,
    spawnPoints: placeSpawnPoints(seed, cfg, room, grid),
  }))

  return {
    schemaVersion: DUNGEON_SCHEMA_VERSION,
    seed,
    bounds: plan.bounds,
    passages: plan.passages,
    walls: plan.walls,
    rooms,
    navCellSize: cfg.navCellSize,
    // 网格的最小角。**校验器与运行时都从这里取**，不许各自算 —— 见 `walkability.ts`
    navOrigin: { x: extent.originX, y: extent.originY },
    elapsedMs: now === undefined ? 0 : now() - t0,
  }
}