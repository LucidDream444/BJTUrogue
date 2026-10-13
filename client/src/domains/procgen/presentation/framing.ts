/**
 * 「要看哪一块」—— 取景与裁剪。**纯函数，零 Phaser 依赖。**
 *
 * ---
 *
 * ## 为什么不和 `floorplan.ts` 放一起
 *
 * 因为它们回答的是两个问题：`floorplan.ts` 回答「**怎么画**」，
 * 这里回答「**画哪一块**」。把它们混在一起，后果是具体的：
 *
 * `presentation/floorplan.ts` 是整个 `procgen/` 里唯一 import Phaser 的文件 ——
 * 那是**拿 Phaser 换绘制便利**，代价是大方承认的。但「画哪一块」是纯几何，
 * 任何测试、任何别的场子都可能要问它。混在一起，那些人就得**为了问一个纯几何问题
 * 把 Phaser 拉进依赖闭包**，而 `architecture.test.ts` 会当场红
 * （Vitest 的环境钉死在 `node` 上，见 `AGENTS.md` §七）。
 *
 * 所以：**判定与几何在这里，绘制在那一边。** 分界线就是 `import Phaser`
 * 这一个词出现在哪个文件里。
 */

import type { RoomsConfig } from '../config'
import { bottom, clipRect, left, rectFromCorners, rectsIntersect, right, top } from '../model/rect'
import type { DungeonMap, Rect, Room } from '../model/types'

/**
 * 取景框：**这一间房 + 它门外那条走廊**。
 *
 * ## 为什么框是**不对称**的
 *
 * 主干教室南北交替挂在走廊两侧，所以走廊只在房间的**一侧**。对称留白
 * （`inflate(room.rect, r)`）会把一半的画面花在房间背后的空气上 ——
 * 而那一侧除了外墙什么都没有，是这个场子里最不该浪费的一圈。
 *
 * 框的四条边：
 *
 * - 左右和背面：各留**一格**。再宽就只剩背景了。
 * - 走廊那一侧：并到**走廊外沿再加一格**，正好能看见走廊对面的墙 ——
 *   也就是「这扇门外确实有条路」，而不是一片黑。
 *
 * ⚠️ **只在 y 上并走廊，x 上不并。** 走廊横着贯穿整层（8000px 宽），
 * 按它的 x 范围取框会取到一整层楼，缩到屏幕上什么都看不清。
 *
 * 没有开向走廊的门（侧室只有 `v` 向的门）就不并 —— 它的门外是宿主教室，
 * 按对称留白处理。
 */
export function roomWithCorridorBox(map: DungeonMap, cfg: RoomsConfig, room: Room): Rect {
  const side = cfg.navCellSize
  const hasCorridorDoor = room.doors.some((d) => d.axis === 'h')

  let y0 = top(room.rect) - side
  let y1 = bottom(room.rect) + side
  if (hasCorridorDoor) {
    y0 = Math.min(y0, top(map.corridorRect) - side)
    y1 = Math.max(y1, bottom(map.corridorRect) + side)
  }

  return rectFromCorners(
    left(room.rect) - side,
    y0,
    right(room.rect) + side,
    y1,
  )
}

/**
 * 框里的那几段墙。**裁过**（见 `clipRect`）。
 *
 * 整层的墙是连续的：走廊的边墙、侧室门厅的封口都是一整条。
 * 不裁的话一间房会连带画出半层楼 —— 而画出来的那些墙**在框外面**，
 * 看起来就是「墙上多出来一段莫名其妙的东西」，比不画更糟。
 */
export function wallsNearRoom(map: DungeonMap, box: Rect): Rect[] {
  const out: Rect[] = []
  for (const w of map.walls) {
    if (!rectsIntersect(w, box)) continue
    const c = clipRect(w, box)
    if (c !== null) out.push(c)
  }
  return out
}