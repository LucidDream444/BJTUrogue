import { containsPoint } from '@/domains/procgen/model/rect'
import type { Point, Rect } from '@/domains/procgen/model/types'

/**
 * ## 楼梯间（中转站）带来的两件**纯**逻辑
 *
 * 用户 2026-10-21 的三句话把楼梯间定成了什么：
 *
 * > 进入楼梯间会生成一个宝箱，这不对 ·
 * > 楼梯间不算起点，应该是每层之间的中转站，打完该层首领后去下一层的路应该出现在
 * > 楼梯间里，而不是楼梯间门口 · 如果有上一层，在楼梯间里可以回去
 *
 * 三句话里有两件是**逻辑**、不是画法，于是它们都落在这个文件里：
 *
 * | 这件事 | 这里的谁 |
 * |---|---|
 * | 上下两个入口摆在楼梯间的哪儿 | `stairPadSpots()` |
 * | 回上一层之后，那一层记得住什么 | `FloorProgress` |
 *
 * （第三件 —— 「不摆宝箱」—— 是关别的判据，在 D2 的 `roomHasChest()` 里。）
 *
 * ⚠️ **这个文件不许 import Phaser**（也不许 import `FloorExit`、`BattleScene`）：
 * 它是 `Stairwell.test.ts` 的测试对象，而 AGENTS.md §七 把 Vitest 的环境钉死在 `node` ——
 * 拉进 Phaser 的那一瞬间，这两件事就只能靠开浏览器看了。
 * 需要用到别处的常量时**从参数传进来**（`stairPadSpots()` 的 `padSize` 就是这么来的），
 * 不要在两边各写一份常数。
 */

/**
 * 两个互动点离**楼梯间正中线**多远（水平，世界像素）。
 *
 * 4.25 格 → 两个点相距 8.5 格 = 210px。挑这个数的两个约束：
 *
 * - **比一个方框宽**：`FloorExit.SIZE = 92`，于是两个方框之间还留着 118px 的净空 ——
 *   站在正中间时离两边的方框边缘各有 105 − 46 = 59px，而「够得着」的门槛只有 50
 *   （`BattleScene.EXIT_REACH`）。**不会出现「站一下同时够到上下楼」**。
 * - **放得进这一间**：楼梯间是平面图上那间 11×12 格的房（440×480），
 *   105 + 半个方框（46） = 151 < 220（半宽）。
 *
 * ⚠️ 它**不是**「摆哪儿好看」，是上面这两条推出来的。改它之前先看
 * `stairPadSpots()` 的钳制，以及 `Stairwell.test.ts` 里那几条断言。
 *
 * ★ 2026-11-04 从「竖向偏移 170」改成「横向半距 105」：用户要求**下一层在左、
 * 上一层在右**，而且互动点不再压在楼梯图上、要摆到楼梯**下方** —— 竖着分的那套
 * （上边一个、下边一个）随之作废。
 */
export const STAIR_PAD_SPREAD = 105

/**
 * 两个互动点比**楼梯间中心**低多少（世界像素）。
 *
 * 用户 2026-11-04：「互动点不要放在楼梯上面，放在楼梯下方」。90 让
 * 「楼梯图（约 173 高）+ 12px 间隙 + 方框（92）」这一组在 11×12 的房里
 * 上下留白接近：上边约 99、下边约 104（`CampusMapArt.paintStairs()` 按它摆楼梯图）。
 */
export const STAIR_PAD_DROP = 90

/**
 * 两段楼梯图之间的水平间隙（世界像素）。
 *
 * `CampusMapArt.paintStairs()` 用它把两段楼梯并排塞进楼梯间：
 * 中间留 20、两边各留半格（20），于是两段楼梯的中心正好落在两个互动点上方。
 */
export const STAIR_FLIGHT_GAP = 20

export interface StairPads {
  /** 上**上**一层（= 前进方向）。**右边**，且在楼梯图下方。 */
  readonly up: Point
  /** 下**下**一层（= 回去的路）。**左边**，且在楼梯图下方。 */
  readonly down: Point
}

/**
 * 两个互动点在楼梯间里的位置。**以楼梯间中心为原点，左右分开、同时下移**：
 *
 * | | x | y |
 * |---|---|---|
 * | `down`（下一层） | 中心 **−** 半个间距（左） | 中心 **+** `STAIR_PAD_DROP`（下） |
 * | `up`（上一层） | 中心 **+** 半个间距（右） | 同上 |
 *
 * 左右与楼梯图同序：左边那组楼梯向下、右边那组向上（用户 2026-11-04）。
 * 两点同一行，所以「上」与「下」不再靠 y 区分，而是靠**左 / 右** ——
 * 区分它们的颜色与箭头留在 `FloorExit`（青绿朝下 = 左、暖黄朝上 = 右）。
 *
 * ⚠️ **返回值只保证「在房间里」，不保证「站得上去」**：调用方（`BattleScene`）
 * 摆之前还要过一次 `TerrainMap.safeSpawn()` —— 门口那一带、以及将来楼梯间里
 * 真摆了东西的时候，那是唯一会说话的一道关。
 *
 * ## 钳制：**尽量分开，但绝不出去**
 *
 * `spread` 取「`STAIR_PAD_SPREAD`」与「房间半宽还放得下多少」里小的那个；
 * `drop` 同理，取「`STAIR_PAD_DROP`」与「房间半高还放得下多少」里小的那个。
 * 于是这间房只要放得下两个方框，它们**整个**（含方框的四条边）都在房里；
 * 小到连一个方框都放不下时，两个点都退回中心（`spread = drop = 0`）——
 * **房子再小也不会把入口摆到墙外去**（摆到墙外的入口玩家够不着，
 * 而画面上那个方框还在呼吸）。
 *
 * 那种螺丝壳楼梯间本来就不该存在（D2 的平面图校验器管着这一间的尺寸），
 * 这里只保证不比它要求的更糟。
 */
export function stairPadSpots(stairwell: Rect, padSize: number): StairPads {
  const halfPad = padSize / 2
  const spread = Math.min(STAIR_PAD_SPREAD, Math.max(0, stairwell.width / 2 - halfPad))
  const drop = Math.min(STAIR_PAD_DROP, Math.max(0, stairwell.height / 2 - halfPad))
  const y = stairwell.y + drop
  return {
    down: { x: stairwell.x - spread, y },
    up: { x: stairwell.x + spread, y },
  }
}

/** 一层楼的**进度快照**。就是 `BattleScene` 里那三份「按房的记账」。 */
export interface FloorSnapshot {
  /** 进过哪些房（`Room.order`）。 */
  readonly visited: ReadonlySet<number>
  /** 打完哪些房。 */
  readonly cleared: ReadonlySet<number>
  /** 哪一间的宝箱**开过**了。 */
  readonly lootedRooms: ReadonlySet<number>
}

/**
 * **每一层各自记着的那一份进度**，按键是层的序号（1 起）。
 *
 * ## 为什么需要它
 *
 * 楼梯间能上楼（用户 2026-10-21），于是「一层楼」不再是单向的：
 * 下到第 2 层、又回第 1 层，第 1 层必须**还是走的时候那个样子**。
 * 而 `loadFloor()` 每次都要把 `visited` / `cleared` / `lootedRooms` 清干净
 * （换层时必须清，理由写在那个函数头上）—— 于是**清了之后得有地方放**。
 *
 * ⚠️ **不记这一份的后果，两个方向都不报错：**
 *
 * - 不还原 `visited`：回上一层之后每一间都成了「没进过」—— 推开一扇已经打过的门，
 *   **整间房重新刷一遍怪**，而门还会在身后封上。
 * - 不还原 `cleared`：房号那行字和门的绿全变回「没打」，小地图上的进度也归零；
 *   更糟的是首领那一间也变成没打 —— 而它已经死了，**玩家再也拿不到那个「下一层」入口**
 *   （入口是打完首领那一刻亮的），那一局就卡死在这一层。
 * - 不还原 `lootedRooms`：**开过的宝箱会重新出现**，等于出门绕一圈就能刷武器。
 *
 * ## 存的是**副本**
 *
 * `save()` 收下的是引用、存进去的是新集合：`BattleScene` 在 `init()` 里
 * 对 `this.visited` 调的是 `clear()`（**原地改**，不是换一个）——
 * 存引用的话，重开一局那一瞬间会把上一局的快照一起抹掉，而这只在
 * 「第二局的一层」上表现出来（第一局永远是对的）。
 */
export class FloorProgress {
  private readonly floors = new Map<number, FloorSnapshot>()

  /** 存下第 `floor` 层的进度（**存副本**，见类头）。 */
  save(floor: number, snapshot: FloorSnapshot): void {
    this.floors.set(floor, {
      visited: new Set(snapshot.visited),
      cleared: new Set(snapshot.cleared),
      lootedRooms: new Set(snapshot.lootedRooms),
    })
  }

  /** 取回第 `floor` 层上次存下的进度。**没去过那一层时给 `null`**（= 全新的楼层）。 */
  restore(floor: number): FloorSnapshot | null {
    const found = this.floors.get(floor)
    if (found === undefined) return null
    // 也是副本：调用方拿到手就塞进 `this.visited`，之后想怎么改都行。
    return {
      visited: new Set(found.visited),
      cleared: new Set(found.cleared),
      lootedRooms: new Set(found.lootedRooms),
    }
  }

  /** 重开一局时丢掉全部记忆。 */
  forget(): void {
    this.floors.clear()
  }

  /** 记得哪几层（升序）。**调试与测试用** —— 产品里没有人问这个。 */
  remembered(): number[] {
    return [...this.floors.keys()].sort((a, b) => a - b)
  }
}

/**
 * 这一间是不是**装得下**那两个入口 —— 给 `Stairwell.test.ts` 与调试用的读数，
 * 顺手放在这里，免得「够不够大」这件事在测试里另写一遍。
 */
export function padsFitInside(stairwell: Rect, pads: StairPads, padSize: number): boolean {
  const half = padSize / 2
  return [pads.up, pads.down].every(
    (p) =>
      containsPoint(stairwell, p.x - half, p.y - half) &&
      containsPoint(stairwell, p.x + half, p.y + half),
  )
}