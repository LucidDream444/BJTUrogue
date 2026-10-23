/**
 * 室内的**桌椅组**（一张课桌 + 正下方紧贴的一把椅子）。**纯函数，零 Phaser 依赖。**
 *
 * ---
 *
 * ## 为什么是「桌 + 椅」成组，而不是「长条桌 + 随手撒椅子」
 *
 * ★ 2026-10-15 改的。首版课桌是 **1 格宽 × 2—4 格长**的横条，椅子按 `chairChance`
 * 随机撒在某一列旁边 —— 那是「一条长桌坐一排人」的形状，掩体密度高，但**不是教室的样子**。
 * 现在的几何照 **D1 三张手绘关里的桌椅关系**（`public/config/stage-collisions.json` 的
 * `furniture`：`desk_*` 与 `chair_*` 成对，椅子贴在桌子**正下方**）：
 * 一张 `deskWidthCells` ~ `deskWidthCellsMax` 宽、`deskHeightCells` 高的桌
 * （**宽每组各抽一次**，配表里是 2~4），正下方紧贴一把 1 格的椅子。
 *
 * 跟着改的还有三件事，都不是巧合：
 *
 * | 改了什么 | 为什么 |
 * |---|---|
 * | 桌椅**成组**摆 | 视觉上要用 D1 那张「桌 + 椅」的贴图（`FurnitureTextures`），贴图是**一整件**，拆开就没了 |
 * | 椅子**必有**（`chairChance` 没了） | 贴图里就带着椅子；「有的桌子有椅子、有的没有」会让同一张素材两种命运 |
 * | 组与组之间 `deskGapCells` | 桌椅组占**两行**格子（桌一行、椅一行）；挨着摆的两组会连成一张更长的桌 —— 也就是一堵**过不去**的墙 |
 *
 * ## 摆几组、**散着摆**（2026-10-16 起），不是成排居中
 *
 * 组数照 `deskRowsMin`~`deskRowsMax` 抽（配表里是 5~9），每组桌长抽
 * `deskWidthCells`~`deskWidthCellsMax`、位置在房内**随处抽**（内墙各留一格），
 * 组间至少留 `deskGapCells` 格。
 *
 * ⚠️ **文件头这一节原先写的是「成排 / 整块居中摆」**（`maxRows` / `maxDesks`
 * 由房间尺寸算出来、再整块居中），还配了「为什么成排」的理由。那套 2026-10-16
 * 就被换掉了（那两个字眼今天全仓库只剩这条注释自己），理由也反了过来：
 * 成排落地之后是「**桌椅恒在正中一片、每张桌都一样长、数量由房间宽度定**」——
 * 玩起来就是「一进门正中间一排桌子，哪间都一样」。
 *
 * 散着摆没有「步长 ≥ 宽」那条构造保证，所以 **`taken` 数组必须有**（见下面
 * `const taken` 那段）。安全网在别处：`spawns.ts` 跑在这之后，从门做 flood fill、
 * **只从可达的格子里**挑出生点 —— 「摆出一块到不了的区域」顶多是那块地没人去，
 * **不会把出生点或门封死**，而「成排」原本要防的正是这个。
 *
 * ⚠️ `deskRowGapCells` 这条配置键**今天没有任何生成代码读它**（只有 `config.ts`
 * 的解析与 `rooms.json` 的键还在）—— 「排」的概念随 2026-10-16 的改动一起不用了。
 *
 * ## 三条硬约束，每条都在挡一种具体的坏结局
 *
 * | 约束 | 不守的话会怎样 |
 * |---|---|
 * | 不碰门的净空圈（`doorClearance`） | 一张课桌正堵在门口 → 房间进得去出不来 |
 * | 总面积 ≤ `obstacleDensityMax` | 「掩体少一些」变成口号；小教室里肉盾 slam 半径 110px 会盖住大半场地 |
 * | 按格对齐、只横竖、尺寸取自配置 | 看着能挤过去的缝，寻路认为整格封死（可视 ≠ 可走性） |
 *
 * ## 与「出生点」的分工
 *
 * 这里**不管出生点**。出生点是 `spawns.ts` 的事，而且它跑在这之后 ——
 * 先从门做 flood fill，再**只从可达的格子里**挑出生点。
 * 那个顺序让「出生点被封死」在构造上不可能发生（见 `spawns.ts`）。
 * 反过来（先定出生点再摆桌子）就必须靠"摆完检查、不通重来"来兜，
 * 而重试次数不确定会让生成耗时出现长尾。
 *
 * ## ⚠️ 椅子贴桌子哪一格：**由种子定，不是固定贴左边**
 *
 * 固定贴左边（比如永远贴 `ix`）会让一整层楼的椅子**全在同一侧**，
 * 而那是「生成器只写了一种情况」的指纹 —— 看起来像贴图与碰撞错开了半个身位。
 * 抽的是**格子下标**（`rng.between(0, dw - 1)`），所以桌子宽几格就有几种贴法。
 */

import type { Obstacle, Rect, Room } from '../model/types'
import type { RoomsConfig } from '../config'
import { isCombatKind } from '../config'
import { bottom, doorRect, left, inflate, rectsIntersect, right, top } from '../model/rect'
import { rngFor } from './seed'

export function placeObstacles(seed: number, cfg: RoomsConfig, room: Room): Obstacle[] {
  // 非战斗关别**一间空房**：道具关、宝箱关，以及配置里被排除出 `combatKinds` 的
  // 楼梯间。课桌在这几类房里没有任何玩法理由 ——
  // 它是**掩体**（见文件头：密度上限是拿「肉盾 slam 半径盖住大半场地」反推的），
  // 没有敌人的房间里，一模一样的课桌只是占地方、还把宝箱的落点挤掉。
  //
  // ⚠️ **楼梯间（`start`）是 v5 才被排除出去的**：v4 里 `start` 是一间真的教室，
  // 摆桌椅说得通；现在它是出生点，摆桌椅就是把玩家堵在门口。
  //
  // 早返回而不是走到摆桌逻辑里再判：那样 `taken` / `areaCap` 这些量会被算一半，
  // 而且下一个人加一种障碍物时得记得再判一次 —— 漏判的表现是空房里冒出课桌。
  if (!isCombatKind(cfg, room.kind)) return []

  const cell = cfg.navCellSize
  const wt = cfg.wallThickness

  // ★ 改了（v5）：房间矩形**就是**它的可走格跨度，不再往里让半堵墙。
  //
  // v4 的 `Rect` 是**含墙**的矩形（墙骑在它的四条边上，各吃半层），所以这里
  // 写的是 `left(rect) + wt/2`。v5 里墙是**房间之外**的那一格
  // （见 `model/types.ts` 的文件头与 `layout.ts` 的 `buildWallRects`），
  // 照旧式子让 20px 的话，桌椅会整体偏半格 —— 而按格对齐是「可视 = 可走性」
  // 的前提：偏半格之后 `buildGrid` 的中心点采样与桌子的实际位置**各说各话**，
  // 表现是「看着能挤过去的缝，寻路认为整格封死」，**两边都不报错**。
  const rl = left(room.rect)
  const rt = top(room.rect)
  const nx = Math.floor(room.rect.width / cell)
  const ny = Math.floor(room.rect.height / cell)

  const dh = cfg.deskHeightCells
  // 一组占**两行**：桌子那一行 + 椅子那一行（椅子贴在桌子正下方，所以恒为一格）
  const unitRows = dh + 1

  // 放不下就**一间空房**
  if (nx - 2 < cfg.deskWidthCells || ny < unitRows + 2) return []

  // 门的净空圈。**门自己也算** —— 一扇门只挖掉了墙，"门前"那几格还得由障碍物让开。
  const forbidden: Rect[] = room.doors.map((d) => inflate(doorRect(d, wt), cfg.doorClearance))
  const touchesDoor = (r: Rect): boolean => forbidden.some((f) => rectsIntersect(r, f))

  const cellsRect = (ix: number, iy: number, wCells: number, hCells: number): Rect => ({
    x: rl + (ix + wCells / 2) * cell,
    y: rt + (iy + hCells / 2) * cell,
    width: wCells * cell,
    height: hCells * cell,
  })

  // 一组占的面积：桌（`deskWidthCellsMax` 格，按最大算，宁可保守）+ 椅 1 格
  const unitArea = (cfg.deskWidthCellsMax * dh + 1) * cell * cell
  const roomArea = room.rect.width * room.rect.height
  const areaCap = roomArea * cfg.obstacleDensityMax
  let usedArea = 0

  const rng = rngFor(seed, 'desks', room.order)

  // ⚠️ **2026-10-16 改成「摆几组、散着摆」。** 原来是「成排、整块居中铺满」——
  //    几何可控（一排有没有把房间切成两半，逐行就能答），但落地之后是：
  //    **桌椅恒在正中一片、每张桌都一样长、数量由房间宽度定**。
  //    玩起来就是「一进门正中间一排桌子，哪儿都一样」。
  //
  //    散着摆的安全网**已经在了**：`spawns.ts` 跑在这之后，从门做 flood fill、
  //    **只从可达的格子里**挑出生点（见那个文件）。所以「摆出一块到不了的区域」
  //    顶多是那块地没人去，**不会把出生点或门封死** —— 而「成排」原本要防的
  //    正是这个。门净空那一圈（`doorClearance`）也照旧拦着。
  //
  //    保留不动的三条：门净空、密度上限、**按格对齐只横竖**（可视 ≠ 可走性）。
  const want = rng.between(cfg.deskRowsMin, cfg.deskRowsMax)
  const obstacles: Obstacle[] = []
  // 已经摆下的组。散着摆没有「步长 ≥ 宽」这条构造保证，所以这里**必须**有 `taken` ——
  // 早先成排摆位时它是多余的（见下），现在不是了。
  const taken: Rect[] = []

  for (let n = 0; n < want; n++) {
    // 桌长**每组抽一次**：2~`deskWidthCellsMax` 格。于是同一间房里
    // 「两格的桌」「三格的桌」「四格的桌」都有 —— 这是不改数据模型就能拿到的形状多样性
    // （桌恒为一条横线，配上正下方一格的椅子就是那个拐角「L」）。
    const dw = rng.between(cfg.deskWidthCells, cfg.deskWidthCellsMax)
    for (let attempt = 0; attempt < 32; attempt++) {
      // 位置**随处抽**（内墙各留一格），不再居中
      const ix = rng.between(1, Math.max(1, nx - dw - 1))
      const iy = rng.between(1, Math.max(1, ny - unitRows - 1))
      const desk = cellsRect(ix, iy, dw, dh)
      // 椅子贴桌子跨度的**哪一格**由种子定（见文件头 ⚠️）
      const chair = cellsRect(ix + rng.between(0, dw - 1), iy + dh, 1, 1)
      const unit = {
        x: left(desk),
        y: top(desk),
        width: right(desk) - left(desk),
        height: bottom(chair) - top(desk),
      }
      if (touchesDoor(desk) || touchesDoor(chair)) continue
      // 组间至少留 `deskGapCells` 格 —— 否则两张桌贴着会长成一条更长的桌，
      // 而「一块过不去的长墙」正是散着摆最容易出的事
      if (taken.some((t) => rectsIntersect(t, inflate(unit, cfg.deskGapCells * cell)))) continue
      if (usedArea + unitArea > areaCap) return obstacles
      // **桌子先进、椅子紧跟**：`model/furniture.ts` 的配对、校验器那条「每张桌正下方
      // 一把椅子」都靠这个形状。顺序本身不参与判据，但把两件放在相邻两行
      // 让「这一组是什么」在任何一处读起来都是同一件事。
      obstacles.push({ kind: 'desk', rect: desk })
      // 椅子只挡路不挡子弹 —— 子弹能穿过椅子打后面的怪，这是刻意的。
      obstacles.push({ kind: 'chair', rect: chair })
      taken.push(unit)
      usedArea += unitArea
      break
    }
  }
  return obstacles
}