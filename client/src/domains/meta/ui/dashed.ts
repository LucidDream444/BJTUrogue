/**
 * 虚线矩形。Phaser 没有内置虚线描边，所以按段自己画。
 *
 * 为什么单独一个文件：**"这里还没有东西"这个视觉约定要用在多个地方**
 * （角色卡的立绘位、暂停面板的人物立绘位、将来的奖励卡、关卡卡）。
 * 每个地方各写一份虚线算法的话，它们会在不同的地方长出不同的虚线段长 ——
 * 而"虚线看起来不太一样"没有人会当成 bug 报，只会觉得哪里怪。
 */

import type Phaser from 'phaser'

/** 描一圈虚线 */
export function dashRect(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  dash = 8,
  gap = 6,
): void {
  dashLine(g, x, y, x + w, y, dash, gap)
  dashLine(g, x + w, y, x + w, y + h, dash, gap)
  dashLine(g, x + w, y + h, x, y + h, dash, gap)
  dashLine(g, x, y + h, x, y, dash, gap)
}

/** 描一段虚线 */
export function dashLine(
  g: Phaser.GameObjects.Graphics,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  dash = 8,
  gap = 6,
): void {
  const len = Math.hypot(x1 - x0, y1 - y0)
  // 长度为 0 时下面会除以 0 → NaN → Phaser 画出一条不可见的废线。
  // 这种"什么都没画、也不报错"的结果最难查，所以直接返回。
  if (len === 0) return
  const ux = (x1 - x0) / len
  const uy = (y1 - y0) / len
  for (let d = 0; d < len; d += dash + gap) {
    const e = Math.min(d + dash, len)
    g.lineBetween(x0 + ux * d, y0 + uy * d, x0 + ux * e, y0 + uy * e)
  }
}
