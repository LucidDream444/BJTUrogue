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
 * 上下两个入口离**楼梯间中心**多远（世界像素）。
 *
 * 4.25 格。挑这个数的两个约束：
 *
 * - **比一个方框宽**：`FloorExit.SIZE = 92`，于是两个方框之间还留着 78px 的净空 ——
 *   站在正中间时离两边的方框边缘各有 124px，而「够得着」的门槛只有 50
 *   （`BattleScene.EXIT_REACH`）。**不会出现「站一下同时够到上下楼」**。
 * - **放得进这一间**：楼梯间是平面图上那间 11×18 格的房（440×720），
 *   170 + 半个方框（46） = 216 < 220（半宽）。
 *   ⚠️ 卡的是**半宽**（220），不是高度 —— ★ 2026-10-22 晚这间房从 11×22 改成 11×18
 *   （三层统一到北排那一处楼梯间），高度从 880 掉到 720，**这个约束一个字没变**。
 *   高度那一侧余量还很足：360（半高）≥ 216。
 *
 * ⚠️ 它**不是**「摆哪儿好看」，是上面这两条推出来的。改它之前先看
 * `stairPadSpots()` 的钳制，以及 `Stairwell.test.ts` 里那三条断言。
 */
export const STAIR_PAD_OFFSET = 170

export interface StairPads {
  /** 上**上**一层（★ 2026-10-22 晚起 = 前进方向）。`y` 比中心**小** —— 画面坐标里 y 向下增长。 */
  readonly up: Point
  /** 下**下**一层（= 回去的路）。`y` 比中心**大**。 */
  readonly down: Point
}

/**
 * 两个入口在楼梯间里的位置。**以楼梯间中心为原点、沿着 y 轴分开**。
 *
 * 为什么是竖着分而不是横着分：平面图上这间房是**竖长**的（11×18 格），
 * 竖着分两边都还有余量；横着分的话 220px 的半宽里塞不下「170 + 46」。
 * （`Stairwell.test.ts` 钉着「这间恒为竖长」—— 哪天平面图把它改成横长的，
 * 该改的是这个函数，那条断言会在那之前先红。）
 *
 * ⚠️ **返回值只保证「在房间里」，不保证「站得上去」**：调用方（`BattleScene`）
 * 摆之前还要过一次 `TerrainMap.safeSpawn()` —— 门口那一带、以及将来楼梯间里
 * 真摆了东西的时候，那是唯一会说话的一道关。
 *
 * ## 钳制：**尽量分开，但绝不出去**
 *
 * `reach` 取「`STAIR_PAD_OFFSET`」与「房间还放得下多少」里小的那个。
 * 于是这间房只要比一个方框大，两个入口**整个**（含方框的四条边）都在房里；
 * 小到连一个方框都放不下时，两个点都退回中心（`reach = 0`）——
 * **房子再小也不会把入口摆到墙外去**（摆到墙外的入口玩家够不着，
 * 而画面上那个方框还在呼吸）。
 *
 * 那种螺丝壳楼梯间本来就不该存在（D2 的平面图校验器管着这一间的尺寸），
 * 这里只保证不比它要求的更糟。
 */
export function stairPadSpots(stairwell: Rect, padSize: number): StairPads {
  const halfPad = padSize / 2
  // 只受**高**约束：两个点都在中线上（x 不动），方框横着放不放得下与偏移无关 ——
  // 那是 `width >= padSize` 的事，往上下挪多远都改不了它。
  const reach = Math.min(STAIR_PAD_OFFSET, Math.max(0, stairwell.height / 2 - halfPad))
  return {
    up: { x: stairwell.x, y: stairwell.y - reach },
    down: { x: stairwell.x, y: stairwell.y + reach },
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