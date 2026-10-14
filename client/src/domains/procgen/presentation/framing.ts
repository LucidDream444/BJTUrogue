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
import {
  bottom,
  clipRect,
  containsPoint,
  left,
  rectContains,
  rectFromCorners,
  rectsIntersect,
  right,
  top,
} from '../model/rect'
import type { DungeonMap, Rect, Room } from '../model/types'

/**
 * 取景框：**这一间房 + 它每一扇门外的那一块**。
 *
 * ## 为什么不是「对称留白」
 *
 * `inflate(room.rect, 一格)` 会把画面的大半花在**这一间房背后**，
 * 而门外那条路一格都看不见 —— 可「这扇门外确实有地方可去」正是这个场子
 * 最要看的一条。所以框要**朝门外长出去**。
 *
 * ## 门外是哪儿，靠**探针**算，不靠类型猜
 *
 * 门外那块东西是个变量：主干教室的 `back`/`forward` 门外面是**一段连廊**，
 * 侧室那两扇门外面是**宿主教室**和**连廊**，而主干的 `side` 门外面是**侧室**。
 * 按 `DoorKind` 或按 `branch` 分支去猜，就要写四套规则，而每套都要和
 * `layout.ts` 的摆位保持同步 —— 那边一改，这边**不报错**，只是框错了一格。
 *
 * 所以这里只做一件事：**从门心朝门外面走半格，看落进哪个矩形里。**
 * 半格够了 —— 所有相邻空间都是**贴边**的（连廊的西边就是教室的东边，
 * 侧室朝主干那一面就在带的那条线上），而墙骑在那条线上、厚一格，
 * 走半格正好越过它落到对面那块的内部。
 *
 * | 门 | 门心 | 门外半格处 | 落进 |
 * |---|---|---|---|
 * | 主干 `back` | `(左边界, +20)` | `(左边界 − 20, +20)` | 西边那段连廊（起点没有，落空 → 不并） |
 * | 主干 `forward` | `(右边界, +20)` | `(右边界 + 20, +20)` | 东边那段连廊 |
 * | 主干的 `side` | `(…, ±带边)` | `(…, ±带边 ∓ 20)` | 挂在它上面的侧室 |
 * | 侧室的两扇 | `(…, ±带边)` | `(…, ±带边 ∓ 20)` | 宿主教室 / 连廊 |
 *
 * 落空是**正常**的（起点西边、首领东边都是整层的外沿），不并就是了。
 *
 * ## 并进来的那块，四面再各留一格
 *
 * 留的那一格是给**墙**的：框边恰好压在墙上时，墙只剩半个身子，
 * 看起来像「这儿有一条奇怪的横线」。留一格之后墙整条落在框里。
 *
 * 框最大 `1120×680`（最大档主干 640 + 两侧连廊 400 + 两格留白 80 = 1120，
 * 高 280 + 侧室 320 + 两格留白 80 = 680），进得了 1280×720。
 * 这串加法**写全**：之前这里写的是 1080，正是把 640+400+80 心算错了 40 ——
 * 而框的上限是个会被 `chooseClassroom` 拿去过滤的数，错 40 就是**悄悄少一间候选**。
 */
export function roomViewBox(map: DungeonMap, cfg: RoomsConfig, room: Room): Rect {
  const cell = cfg.navCellSize
  let x0 = left(room.rect) - cell
  let x1 = right(room.rect) + cell
  let y0 = top(room.rect) - cell
  let y1 = bottom(room.rect) + cell

  for (const beyond of spacesBeyondDoors(map, room, cell)) {
    x0 = Math.min(x0, left(beyond) - cell)
    x1 = Math.max(x1, right(beyond) + cell)
    y0 = Math.min(y0, top(beyond) - cell)
    y1 = Math.max(y1, bottom(beyond) + cell)
  }

  return rectFromCorners(x0, y0, x1, y1)
}

/**
 * 每一扇门外面的那**一块空间**（连廊或别的房间）。同一块被两扇门撞上时只返回一次。
 *
 * 排除房间自己：探针落在自己身上说明方向算反了，那种情况下并进来的是本房，
 * 框会缩成原样 —— 而「框比预期的窄」在现场看起来和「门外没东西」一模一样。
 */
function spacesBeyondDoors(map: DungeonMap, room: Room, depth: number): Rect[] {
  const out: Rect[] = []
  const push = (r: Rect): void => {
    // 落回本房自己 = 方向算反了。并进来的是本房，框会缩成「对称留白」那副样子，
    // 而**框比预期窄**在现场看起来和「门外没东西」一模一样，没人会去查方向。
    if (rectContains(r, room.rect)) return
    if (!out.includes(r)) out.push(r)
  }

  for (const d of room.doors) {
    // 门的法线方向：竖直墙上开的那扇沿 ±x 出入，水平墙上那扇沿 ±y。
    // 朝哪边是**门心在本房轴线的哪一侧**定的，不是按 kind 定的（见上）。
    let px = d.x
    let py = d.y
    if (d.axis === 'v') px += d.x < room.rect.x ? -depth : depth
    else py += d.y < room.rect.y ? -depth : depth

    for (const p of map.passages) if (containsPoint(p.rect, px, py)) push(p.rect)
    for (const other of map.rooms) {
      if (other === room) continue
      if (containsPoint(other.rect, px, py)) push(other.rect)
    }
  }
  return out
}

/**
 * 整块都在取景框里 —— 没被切到。
 *
 * 判定的是「能不能替它下结论」，不是「要不要画」：填充可以裁着画，
 * 但**描边、标签、门、刷怪点**一旦被取景框切掉一半，剩下那一半就是在说谎
 * （沿框边的那两条线会被读成一堵墙，门会被读成一扇半截的门）。
 *
 * 放在 `framing.ts` 而不是 `floorplan.ts`：场子也要问同一个问题
 * （「这一段连廊要不要贴名字」），而 `floorplan.ts` 一进依赖闭包就把 Phaser
 * 带进去了。
 */
export function fullyInside(r: Rect, box: Rect): boolean {
  return (
    left(r) >= left(box) &&
    right(r) <= right(box) &&
    top(r) >= top(box) &&
    bottom(r) <= bottom(box)
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