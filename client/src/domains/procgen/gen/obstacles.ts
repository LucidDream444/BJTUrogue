/**
 * 室内的课桌与椅子。**纯函数，零 Phaser 依赖。**
 *
 * ---
 *
 * ## 为什么是「成排」而不是逐张随机撒
 *
 * 真教室就是成排的，这本身是理由，但更要紧的是**它让几何可控**：
 * 一排桌子占一整行格子，行与行之间天然留出通道，「这一排有没有把教室切成两半」
 * 是一个逐行就能回答的问题。随机撒的话，两张桌子偶然斜着错开半格就能封出一条死胡同，
 * 而那是要靠 flood fill 才发现的 —— 发现的成本高一个数量级。
 *
 * ## 三条硬约束，每条都在挡一种具体的坏结局
 *
 * | 约束 | 不守的话会怎样 |
 * |---|---|
 * | 不碰门的净空圈（`doorClearance`） | 一张课桌正堵在门口 → 房间进得去出不来 |
 * | 总面积 ≤ `obstacleDensityMax` | 「掩体少一些」变成口号；小教室里肉盾 slam 半径 110px 会盖住大半场地 |
 * | 按格对齐、只横竖、宽度恒 1 格 | 看着能挤过去的缝，寻路认为整格封死（可视 ≠ 可走性） |
 *
 * ## 与「出生点」的分工
 *
 * 这里**不管出生点**。出生点是 `spawns.ts` 的事，而且它跑在这之后 ——
 * 先从门做 flood fill，再**只从可达的格子里**挑出生点。
 * 那个顺序让「出生点被封死」在构造上不可能发生（见 `spawns.ts`）。
 * 反过来（先定出生点再摆桌子）就必须靠"摆完检查、不通重来"来兜，
 * 而重试次数不确定会让生成耗时出现长尾。
 */

import type { Obstacle, Rect, Room } from '../model/types'
import type { RoomsConfig } from '../config'
import { bottom, doorRect, left, inflate, rectsIntersect, right, top } from '../model/rect'
import { rngFor } from './seed'

export function placeObstacles(seed: number, cfg: RoomsConfig, room: Room): Obstacle[] {
  const cell = cfg.navCellSize
  const wt = cfg.wallThickness

  // 房间内部（四面各让开半堵墙）。所有边界都落在格边界上 ——
  // 见 `layout.ts` 文件头 ③，整层从半格起排就是为了这个。
  const rl = left(room.rect) + wt / 2
  const rt = top(room.rect) + wt / 2
  const nx = Math.floor((right(room.rect) - wt / 2 - rl) / cell)
  const ny = Math.floor((bottom(room.rect) - wt / 2 - rt) / cell)
  if (nx < cfg.deskLenCells[0] + 2 || ny < cfg.deskWidthCells + 2) return [] // 太小的房间不硬塞

  const taken = new Uint8Array(nx * ny)
  const at = (ix: number, iy: number): number => iy * nx + ix
  const isTaken = (ix: number, iy: number): boolean =>
    ix < 0 || iy < 0 || ix >= nx || iy >= ny || taken[at(ix, iy)] === 1

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
  const lenMin = cfg.deskLenCells[0]
  const lenMax = cfg.deskLenCells[1]
  // 课桌的**短边**（`deskWidthCells`）。`cellsRect(iy, …)` 那一维是短边，
  // `len` 那一维是长边 —— 长边只会横着摆（本函数只生成横排）。
  const dw = cfg.deskWidthCells

  // 课桌排：摆一排、空一行，最外圈留空当走道。
  // 不隔行的话，ny 稍大的房间里桌子会挤成一片，中间那条通道没了。
  const usableRows: number[] = []
  for (let iy = 1; iy <= ny - 1 - dw; iy += dw + 1) usableRows.push(iy)

  const wantRows = rng.between(cfg.deskRowsMin, cfg.deskRowsMax)
  const rowCount = Math.min(wantRows, usableRows.length)

  const obstacles: Obstacle[] = []

  for (let r = 0; r < rowCount; r++) {
    const iy = usableRows[r]!
    let ix = 1 // 最左一列留空当走道
    while (ix + lenMin <= nx - 1) {
      const len = rng.between(lenMin, Math.min(lenMax, nx - 1 - ix))
      const desk = cellsRect(ix, iy, len, dw)

      if (usedArea + desk.width * desk.height > areaCap) return obstacles
      if (touchesDoor(desk)) {
        ix += len + 1
        continue
      }
      let free = true
      for (let k = 0; k < len && free; k++)
        for (let j = 0; j < dw; j++) if (isTaken(ix + k, iy + j)) free = false
      if (!free) {
        ix += len + 1
        continue
      }

      for (let k = 0; k < len; k++)
        for (let j = 0; j < dw; j++) taken[at(ix + k, iy + j)] = 1
      obstacles.push({ kind: 'desk', rect: desk })
      usedArea += desk.width * desk.height

      // 椅子：摆在桌子旁边那一格（沿排的方向随机挑一张桌子的"座位"）。
      // 只挡路不挡子弹 —— 子弹能穿过椅子打后面的怪，这是刻意的。
      if (rng.next() < cfg.chairChance) {
        const seatIx = ix + rng.between(0, len - 1)
        const seatIy = iy + (rng.next() < 0.5 ? -1 : dw)
        if (!isTaken(seatIx, seatIy)) {
          const chair = cellsRect(seatIx, seatIy, 1, 1)
          if (!touchesDoor(chair) && usedArea + chair.width * chair.height <= areaCap) {
            taken[at(seatIx, seatIy)] = 1
            obstacles.push({ kind: 'chair', rect: chair })
            usedArea += chair.width * chair.height
          }
        }
      }

      ix += len + 1 // 桌子之间留一格当走道
    }
  }

  return obstacles
}