/**
 * **桌椅组**：把一间房里那些 `desk` / `chair` 障碍物重新读成「一张桌 + 它那把椅子」。
 *
 * ---
 *
 * ## 为什么需要它：地图数据里**没有**「组」这个字段
 *
 * `Obstacle` 只有 `{ kind, rect }`（见 `model/types.ts`），桌椅是**两件**障碍物：
 * 它们的**玩法差别**正是「桌子挡弹、椅子不挡弹」。而画面上它们是**一件**东西 ——
 * 一张贴图（D1 三张手绘关里的 `front_left` 之类，本就是一整件桌椅）。
 *
 * 于是「哪把椅子属于哪张桌」这件事，必须在**读**的时候算出来，而不是在**写**的时候
 * 再存一个字段：存了字段就有两个真值来源（几何与字段），而它们分岔的那天不会有人发现
 * —— 分岔的表现只是「有一张桌子的椅子画歪了」。
 *
 * ## 判据只有一条：**椅子紧贴在桌子正下方，且横向落在桌子的跨度里**
 *
 * | 数 | 含义 |
 * |---|---|
 * | `top(chair) === bottom(desk)` | 贴着（不是隔一格，也不是重叠） |
 * | `left(chair) ≥ left(desk)` 且 `right(chair) ≤ right(desk)` | 横向在桌子的跨度里 |
 *
 * 生成侧（`gen/obstacles.ts`）**构造上**就满足它，校验侧（`validate/contract.ts`）
 * 有一条把它钉死：每张桌恰好配一把椅子、每把椅子恰好属于一张桌。
 * 所以这里的「找不到」不是要兜底的情况，而是**数据坏了** —— 直接抛，
 * 绝不猜一把椅子回去（猜错的表现是「桌椅贴图贴到别人桌上」，看起来像画法错了）。
 *
 * ## 为什么椅子在下、不在上
 *
 * 照 D1 那三张图：教室里所有椅子都贴着各自桌子的**下方**（下沿那一侧）。
 * 允许上下随机的话，同一种贴图要镜像两次、房间里的家具朝向也乱，
 * 而「朝向」在这张地图上没有任何玩法含义 —— 那就只是白捡的一份复杂度。
 */

import type { Obstacle, Rect, Room } from './types'
import { bottom, left, right, top } from './rect'

/** 一张课桌与它那把椅子。**两个矩形都是地图坐标**（和 `Obstacle` 一样）。 */
export interface FurnitureUnit {
  readonly desk: Rect
  readonly chair: Rect
}

/**
 * 「这把椅子属于这张桌」。**这一条只有这一处实现** —— 画法与校验器都调它。
 *
 * 两处各写一遍的话，它们会在**浮点最后几位**上分家：`top(chair)` 与 `bottom(desk)`
 * 是两条不同的算式（一个是 `y − h/2`，一个是 `y + h/2`），数学上相等、二进制上
 * 不一定，于是校验器放着过、画法当场抛。所以这里带一个 1e-6 的容差，
 * 而且两边读**同一个函数**。
 */
const EPS = 1e-6
export function chairBelongsTo(chair: Rect, desk: Rect): boolean {
  return (
    Math.abs(top(chair) - bottom(desk)) < EPS &&
    left(chair) >= left(desk) - EPS &&
    right(chair) <= right(desk) + EPS
  )
}

/**
 * 一间房里的一组组桌椅。**组序 = `room.obstacles` 里桌子的出现顺序**，
 * 所以它对同一个 `DungeonMap` 是稳定的（换种子才换）—— 画法那边靠这一点
 * 让「哪一组用哪张变体贴图」是确定的（见 `arenas/joint/_d1Scenes.ts`）。
 */
export function furnitureUnits(room: Room): FurnitureUnit[] {
  const chairs = room.obstacles.filter((o) => o.kind === 'chair')
  const units: FurnitureUnit[] = []
  for (const o of room.obstacles) {
    if (o.kind !== 'desk') continue
    const desk = o.rect
    const chair = chairs.find((c) => chairBelongsTo(c.rect, desk))
    if (chair === undefined) {
      throw new Error(
        `furnitureUnits：房间 #${room.order} 有一张课桌 (${left(desk)}, ${top(desk)}) ` +
          `${desk.width}×${desk.height} 底下没有椅子 —— ` +
          `桌椅是成组的（见本文件头），少了哪一半都不该画出来。` +
          `这张地图没有过校验器（validate/contract.ts 有一条专门查它）。`,
      )
    }
    units.push({ desk, chair: chair.rect })
  }
  return units
}

/** 一组桌椅的外框（地图坐标）：**从桌子的上沿到椅子的下沿**，横向取两者的并集。 */
export function unitBox(unit: FurnitureUnit): Rect {
  const x0 = Math.min(left(unit.desk), left(unit.chair))
  const x1 = Math.max(right(unit.desk), right(unit.chair))
  const y0 = Math.min(top(unit.desk), top(unit.chair))
  const y1 = Math.max(bottom(unit.desk), bottom(unit.chair))
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, width: x1 - x0, height: y1 - y0 }
}

/** 计数用：一间房里各类障碍物各几件。**读数与测试读它**，免得各处各数一遍。 */
export function countObstacles(obstacles: readonly Obstacle[]): {
  desk: number
  chair: number
} {
  return {
    desk: obstacles.filter((o) => o.kind === 'desk').length,
    chair: obstacles.filter((o) => o.kind === 'chair').length,
  }
}