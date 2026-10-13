/**
 * `Rect` 的取数器与几何判定。**纯函数，零 Phaser 依赖。**
 *
 * 存在的理由很具体：`Rect` 的 `x` / `y` 是**中心点**（与 `ArenaBase` 的 `WallSpec`
 * 一致，见 `types.ts` 的文件头），所以「左边界」是 `x - width / 2`。
 * 这个式子在一个代码库里出现二十遍，迟早有一处写成 `x - width` ——
 * 那是一个**半个身位的错位**，而它的症状（怪卡在一个看不见的角里）和
 * 「寻路坏了」一模一样。所以这里写一次，别处只许取数。
 */

import type { Door, Point, Rect } from './types'

export function left(r: Rect): number {
  return r.x - r.width / 2
}

export function right(r: Rect): number {
  return r.x + r.width / 2
}

export function top(r: Rect): number {
  return r.y - r.height / 2
}

export function bottom(r: Rect): number {
  return r.y + r.height / 2
}

/** 由左上角与宽高造一个矩形（生成器排布时用着顺手）。 */
export function rectFromTopLeft(x: number, y: number, width: number, height: number): Rect {
  return { x: x + width / 2, y: y + height / 2, width, height }
}

/** 由两个角造一个矩形。参数顺序随意，会自动取最小/最大。 */
export function rectFromCorners(x0: number, y0: number, x1: number, y1: number): Rect {
  const minX = Math.min(x0, x1)
  const minY = Math.min(y0, y1)
  return rectFromTopLeft(minX, minY, Math.abs(x1 - x0), Math.abs(y1 - y0))
}

/**
 * 点是否落在矩形内（**含边界**）。
 *
 * 含边界是刻意的：寻路用「格子中心点采样」，而一张恰好压在格边界上的桌子，
 * 它的边界那一格该不该算堵，两侧必须给出同一个答案。含边界是最不容易写歪的那个。
 */
export function containsPoint(r: Rect, x: number, y: number): boolean {
  return x >= left(r) && x <= right(r) && y >= top(r) && y <= bottom(r)
}

/**
 * 两个矩形是否相交（**含贴合**）。
 *
 * 含贴合（`<=` 而不是 `<`）：一堵墙和一扇门共边时算"碰上了"，
 * 于是「门不许被障碍物挡住」这条校验会保守地拒绝贴合的情形。
 * 保守是对的 —— 贴合留下的是 0px 的缝，而玩家有半径。
 */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(right(a) < left(b) || right(b) < left(a) || bottom(a) < top(b) || bottom(b) < top(a))
}

/**
 * 两个矩形的交集。**贴不出面积就返回 `null`**，不返回零宽/零高的矩形。
 *
 * 返回 `null` 而不是退化矩形是刻意的：零宽矩形在绘制上是一条看不见的线，
 * 而在判定上它会与「贴着它的那条边」算相交 —— 于是「裁完了」和「没裁掉」
 * 在调用方眼里长得一模一样，直到某个角上多出一根一像素的刺。
 *
 * 用途：把**整层的墙**裁成「这一间房附近的那几段」。侧室门厅的封口、
 * 走廊的封口这些都是连续的墙，不裁的话一间房会连带画出半个楼层的墙。
 */
export function clipRect(r: Rect, box: Rect): Rect | null {
  const x0 = Math.max(left(r), left(box))
  const x1 = Math.min(right(r), right(box))
  const y0 = Math.max(top(r), top(box))
  const y1 = Math.min(bottom(r), bottom(box))
  if (x1 <= x0 || y1 <= y0) return null
  return rectFromTopLeft(x0, y0, x1 - x0, y1 - y0)
}

/** 矩形向外扩张 `pad`（边长 +2×pad），用于「门前净空」这类保守判定。 */
export function inflate(r: Rect, pad: number): Rect {
  return { x: r.x, y: r.y, width: r.width + pad * 2, height: r.height + pad * 2 }
}

/** 矩形面积。障碍物密度上限按它算。 */
export function area(r: Rect): number {
  return r.width * r.height
}

export function rectCenter(r: Rect): Point {
  return { x: r.x, y: r.y }
}

/** 矩形是否落在另一个矩形内（含贴合）。校验「障碍物没长出房间」用。 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    left(inner) >= left(outer) &&
    right(inner) <= right(outer) &&
    top(inner) >= top(outer) &&
    bottom(inner) <= bottom(outer)
  )
}

/**
 * 一扇门作为一块矩形（而不是线段）。
 *
 * 线段扩不出面积，而「门前净空」和「障碍物不许挡住门」**都要面积** ——
 * 所以门的几何判定一律用这个矩形，别处不要另写一份把 `axis` 翻来翻去的代码。
 *
 * 放在 `model/` 而不是 `gen/`：`validate/` 也要用它，
 * 而让校验器 import 生成器是层次倒置 —— 校验器的职责恰恰是**独立于**生成器地看数据。
 */
export function doorRect(d: Door, wallThickness: number): Rect {
  return d.axis === 'h'
    ? { x: d.x, y: d.y, width: d.width, height: wallThickness }
    : { x: d.x, y: d.y, width: wallThickness, height: d.width }
}