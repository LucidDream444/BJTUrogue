/**
 * **紧凑排布**：把一层的房间按连通关系摆成一张不留缝的小图，返回每间的位置与大小。
 *
 * 这个函数原先长在 `domains/combat/Minimap.ts` 里（`compactLayout()` 私有方法），
 * 2026-10-16 搬到这里，**只为了一件事：它是纯逻辑，必须能单测。**
 * 长在 `Minimap` 里就进不了 node —— 那个类 import 了 Phaser，
 * 而 `architecture.test.ts` 钉着「每个 *.test.ts 的依赖闭包里不许有 phaser」。
 * 搬出来之后 `compactRooms.test.ts` 才量得了「最窄的一间还有多宽」那件事，
 * 而那正是小地图上写不写得上关别的唯一判据（见 `Minimap` 的 `PANEL`）。
 *
 * ## 为什么不留真实坐标里那些缝
 *
 * 正式游戏里每间房是**独立一屏**（各自 `fitMapFrame` 缩放到满屏），过门直接切换 ——
 * 房间之间那段 `roomGap`（连廊）**在画面上根本不存在**。照真实坐标画小地图，
 * 玩家看到的是「一段并不存在的距离」，既难看又跟体感对不上。
 *
 * 所以按**连通关系**排：主干教室肩并肩贴着，侧室紧贴宿主的上沿或下沿。
 * 每间房的形状（宽高比）保留，只是把缝去掉。
 *
 * ## 一件事要留意：侧室是**横着顺次排**的
 *
 * 同一个宿主下面挂了几个侧室时，每个往右挪 `自己的宽度`（`cursor`）。
 * 于是 `x` 会超出「所有主干宽度之和」，一排 7 间在极端的种子上能到 4880 宽 ——
 * `Minimap` 那个等比缩放吃的是这个数，所以面板尺寸是照**最宽的种子**定的。
 */
import type { Room } from '../model/types'

/** 小图上一块（左上角原点、地图单位，还没缩放）。**不是** `Rect` —— 那个的 `x`/`y` 是中心点。 */
export interface CompactBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/**
 * @param rooms 全部房间（顺序不限，函数自己按 `branch` 与 `order` 排）
 * @param targets 每间房的门通向哪几间，**与 `rooms` 同序**（`null` = 尽头）。
 *                侧室挂在哪一间主干上，就是从这里读的（唯一一个非 `null` 的目标 = 宿主）。
 */
export function compactRoomLayout(
  rooms: readonly Room[],
  targets: readonly (readonly (number | null)[])[] = [],
): Map<number, CompactBox> {
  const hostByOrder = new Map<number, number>()
  for (const [i, ts] of targets.entries()) {
    const order = rooms[i]?.order
    const host = ts.find((t): t is number => t !== null)
    if (order !== undefined && host !== undefined) hostByOrder.set(order, host)
  }

  const out = new Map<number, CompactBox>()
  const main = rooms.filter((r) => r.branch === 'main').sort((a, b) => a.order - b.order)
  // 主干等高：一层的侧室是挂在主干侧墙上的，主干之间本来也由连廊连成一条。
  const mainH = main.length ? Math.max(...main.map((r: Room) => r.rect.height)) : 1
  let x = 0
  for (const r of main) {
    out.set(r.order, { x, y: 0, w: r.rect.width, h: mainH })
    x += r.rect.width
  }

  // 侧室挂到它的宿主上（宿主 = 它唯一那扇门通向的那间）
  const cursor = new Map<number, number>()
  for (const r of rooms.filter((r) => r.branch === 'side')) {
    const host = hostByOrder.get(r.order)
    if (host === undefined) continue
    const box = out.get(host)
    if (box === undefined) continue
    // ⚠️ **保留它实际在宿主的哪一侧**（上/下），只把那条缝收掉。
    //    早先一律放到下面 —— 于是「小地图显示房间在下面，当前房间却有个上面的门」：
    //    地图和实际的门位对不上，比留着缝还糟。
    const hostRoom = hostBox(rooms, host)
    if (hostRoom === undefined) continue
    const below = r.rect.y > hostRoom.rect.y
    const px = box.x + (r.rect.x - hostRoom.rect.x) + (cursor.get(host) ?? 0)
    const py = below ? mainH : -r.rect.height
    out.set(r.order, { x: px, y: py, w: r.rect.width, h: r.rect.height })
    cursor.set(host, (cursor.get(host) ?? 0) + r.rect.width)
  }
  return out
}

/** `order` → 房间。**不走 `roomByOrder()`** —— 那个查的是 `DungeonMap`，这里只有一个数组。 */
function hostBox(rooms: readonly Room[], order: number): Room | undefined {
  return rooms.find((r) => r.order === order)
}

/**
 * 这一堆盒子整体的外框。`minX` / `minY` 可能是负的 —— 挂在主干**上沿**的侧室
 * 落在 `y = -它的高`。画的人要的正是这个：`(minX, minY)` 是左上角，
 * 减掉它才是「从 0 开始」的坐标。
 *
 * ⚠️ **不用 `Rect` 装它**：那个的 `x` / `y` 是中心点（全项目的几何都按中心点走），
 * 拿它当左上角用，错半个身位是必然的，而且**看起来像画歪了**，不像用错了类型。
 */
export interface CompactExtent {
  readonly minX: number
  readonly minY: number
  readonly width: number
  readonly height: number
}

export function compactExtent(boxes: ReadonlyMap<number, CompactBox>): CompactExtent {
  const all = [...boxes.values()]
  const minX = Math.min(0, ...all.map((b) => b.x))
  const minY = Math.min(0, ...all.map((b) => b.y))
  const maxX = Math.max(1, ...all.map((b) => b.x + b.w))
  const maxY = Math.max(1, ...all.map((b) => b.y + b.h))
  return { minX, minY, width: maxX - minX, height: maxY - minY }
}