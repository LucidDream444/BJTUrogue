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
 * 一张 `deskWidthCells × deskHeightCells` 的桌，正下方紧贴一把 1 格的椅子。
 *
 * 跟着改的还有三件事，都不是巧合：
 *
 * | 改了什么 | 为什么 |
 * |---|---|
 * | 桌椅**成组**摆 | 视觉上要用 D1 那张「桌 + 椅」的贴图（`FurnitureTextures`），贴图是**一整件**，拆开就没了 |
 * | 椅子**必有**（`chairChance` 没了） | 贴图里就带着椅子；「有的桌子有椅子、有的没有」会让同一张素材两种命运 |
 * | 排与排之间 `deskRowGapCells` | 桌椅组占**两行**格子（桌一行、椅一行），行距写死一格的旧式子会撞上 |
 *
 * ## 为什么成排，而不是逐张随机撒
 *
 * 真教室就是成排的，这本身是理由，但更要紧的是**它让几何可控**：
 * 一排桌子占整行格子，行与行之间天然留出通道，「这一排有没有把教室切成两半」
 * 是一个逐行就能回答的问题。随机撒的话，两张桌子偶然斜着错开半格就能封出一条死胡同，
 * 而那是要靠 flood fill 才发现的 —— 发现的成本高一个数量级。
 *
 * ## 一整块**居中**摆，不是从左上角铺
 *
 * 排数 / 每排张数先由房间尺寸算出来（`maxRows` / `maxDesks`），再整块居中。
 * 早先是「从 `iy = 1`、`ix = 1` 起一格一格试，撞到边界就停」，于是桌椅恒偏左上，
 * 右下角留一大片空当 —— 那不是教室的样子，是「生成器只会从角上铺」的指纹。
 * 居中还有一个副产品：**摆位不再需要 `taken` 数组**（见下）。
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
  // 起点房 / 首领房。课桌在这三类房里没有任何玩法理由 ——
  // 它是**掩体**（见文件头：密度上限是拿「肉盾 slam 半径盖住大半场地」反推的），
  // 没有敌人的房间里，一模一样的课桌只是占地方、还把宝箱的落点挤掉。
  //
  // 早返回而不是走到摆桌逻辑里再判：那样 `taken` / `areaCap` 这些量会被算一半，
  // 而且下一个人加一种障碍物时得记得再判一次 —— 漏判的表现是空房里冒出课桌。
  if (!isCombatKind(cfg, room.kind)) return []

  const cell = cfg.navCellSize
  const wt = cfg.wallThickness

  // 房间内部（四面各让开半堵墙）。所有边界都落在格边界上 ——
  // 见 `layout.ts` 文件头 ③，整层从半格起排就是为了这个。
  const rl = left(room.rect) + wt / 2
  const rt = top(room.rect) + wt / 2
  const nx = Math.floor((right(room.rect) - wt / 2 - rl) / cell)
  const ny = Math.floor((bottom(room.rect) - wt / 2 - rt) / cell)

  const dw = cfg.deskWidthCells
  const dh = cfg.deskHeightCells
  // 一组占**两行**：桌子那一行 + 椅子那一行（椅子贴在桌子正下方，所以恒为一格）
  const unitRows = dh + 1
  const step = dw + cfg.deskGapCells // 同一排里相邻两组的横向步长
  const pitch = unitRows + cfg.deskRowGapCells // 相邻两排之间的纵向步长

  // 排布是**算出来的、居中的、互不重叠的**（见文件头），所以这里没有 `taken` 数组：
  // 横向步长 ≥ dw、纵向步长 ≥ unitRows，两组桌椅在构造上就压不到一起。
  // 早先的 `taken` 是给「边试边退」的写法兜底的 —— 那种写法下重叠是一条要靠数组
  // 才拦得住的错，而重叠在寻路里**不报错**，只表现为「这块地方过不去」。
  const maxDesks = nx - 2 >= dw ? Math.floor((nx - 2 - dw) / step) + 1 : 0
  const maxRows = ny >= unitRows ? Math.floor((ny - unitRows) / pitch) + 1 : 0
  // 放不下就**一间空房**（`maxRows === 0` 在最小档侧室里是真会发生的：内部 5 行、
  // 一组占 2 行 + 排距 1 行 → 满打满算 2 排，够；但把 deskRowGapCells 调大就会到 0）。
  if (maxDesks === 0 || maxRows === 0) return []

  // 门的净空圈。**门自己也算** —— 一扇门只挖掉了墙，"门前"那几格还得由障碍物让开。
  const forbidden: Rect[] = room.doors.map((d) => inflate(doorRect(d, wt), cfg.doorClearance))
  const touchesDoor = (r: Rect): boolean => forbidden.some((f) => rectsIntersect(r, f))

  const cellsRect = (ix: number, iy: number, wCells: number, hCells: number): Rect => ({
    x: rl + (ix + wCells / 2) * cell,
    y: rt + (iy + hCells / 2) * cell,
    width: wCells * cell,
    height: hCells * cell,
  })

  const roomArea = room.rect.width * room.rect.height
  const areaCap = roomArea * cfg.obstacleDensityMax
  let usedArea = 0

  const rng = rngFor(seed, 'desks', room.order)

  // 摆几排由两个东西共同决定：配置抽的签（`deskRowsMin`—`deskRowsMax`）与房间高度
  // 容得下几排。房间高度是**真上限** —— 抽到 3 而房间只放得下 2 排时取 2，
  // 这一条以前会表现成「桌椅贴着下墙摆出去」，因为旧式子只在下边留了一格。
  const wantRows = rng.between(cfg.deskRowsMin, cfg.deskRowsMax)
  const rowCount = Math.min(wantRows, maxRows)

  // 整块居中：跨 `spanY` 行、`usedX` 列，两边余数对半分。
  const spanY = (rowCount - 1) * pitch + unitRows
  const startY = Math.floor((ny - spanY) / 2)
  const usedX = maxDesks * dw + (maxDesks - 1) * cfg.deskGapCells
  const startX = Math.floor((nx - usedX) / 2)

  const obstacles: Obstacle[] = []
  const unitArea = (dw * dh + 1) * cell * cell // 桌 + 椅（椅恒 1 格）

  for (let r = 0; r < rowCount; r++) {
    const iy = startY + r * pitch
    for (let k = 0; k < maxDesks; k++) {
      const ix = startX + k * step
      const desk = cellsRect(ix, iy, dw, dh)
      // 椅子贴桌子跨度的**哪一格**由种子定（见文件头 ⚠️）。抽的是格子下标，
      // 所以只要桌子比一格宽，就有 `dw` 种贴法。
      const seatIx = ix + rng.between(0, dw - 1)
      const chair = cellsRect(seatIx, iy + dh, 1, 1)

      if (usedArea + unitArea > areaCap) return obstacles
      // 撞门净空 → **这一张跳过**，不是整排跳过：跳过整排会在门前留下一整条空行，
      // 看起来像「这一排生成失败了」。
      if (touchesDoor(desk) || touchesDoor(chair)) continue

      // **桌子先进、椅子紧跟**：`model/furniture.ts` 的配对、校验器那条「每张桌正下方
      // 一把椅子」都靠这个形状。顺序本身不参与判据，但把两件放在相邻两行
      // 让「这一组是什么」在任何一处读起来都是同一件事。
      obstacles.push({ kind: 'desk', rect: desk })
      // 椅子只挡路不挡子弹 —— 子弹能穿过椅子打后面的怪，这是刻意的。
      obstacles.push({ kind: 'chair', rect: chair })
      usedArea += unitArea
    }
  }

  return obstacles
}