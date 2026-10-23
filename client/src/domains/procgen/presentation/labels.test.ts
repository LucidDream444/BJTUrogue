/**
 * 门标注 / 连廊标注的推导。**跑在 node 环境** —— 不加载 Phaser、不碰 DOM。
 *
 * ★ v5 给这一份换过题：v4 的门标注是**有向**的（印 `→5`、字段 `kind` / `toOrder`，按主干道
 * 进度标），v5 的门（`Door`）**无向**、另一头恒为走廊（`floor-plan.json` 的 16 扇全是
 * 「房间 ↔ 走廊」）—— 那几个字段连类型都没有了。所以下面读字段的地方全改成了 v5 的
 * `toId` / `rooms`，测的东西在 v5 里不存在的用例**整条删掉**（每条都留着「为什么」）。
 * ⚠️ 别只看 diff：删掉的那一组里有「同一个洞只标一次」，它在 v5 里**空转**
 * （16 扇门全是房间 ↔ 走廊，走廊没有 `doors`），换成了同一类的
 * 「标注指回它自己那一间的门」。
 *
 * 这一份盯的是三类**画出来不像坏、但读不出东西**的错：
 *
 * 1. **标注跟它指的空间对不上**：字写着 `→C_M`、数据里那扇门通向的却是别处。
 *    这种错在图上和「生成器把房间接到别处去了」长得一模一样 —— 那是最难查的一类。
 * 2. **落点叠在一起**：位置一撞，两条都读不出来，看起来还像「这一层门特别多」。
 * 3. **连廊名跟它串起来的房间对不上**：v5 的 `PassageLabel.rooms` 是从 `room.doors`
 *    **反查**出来的，照几何「挨着就算通」写不会报错，只会让缩略图标着一串走不到的房号。
 *
 * 配置读真文件、种子写死：与 `colliders.test.ts` / `roomFlow.test.ts` / `framing.test.ts`
 * 同一手法、同一个理由（失败要能复跑）。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { parseRoomsConfig, type RoomsConfig } from '../config'
import { collidersOf, type DoorBarrier } from '../colliders'
import { generateDungeon } from '../gen/generate'
import { parseFloorPlan, type FloorPlan } from '../gen/floorPlan'
import { bottom, doorRect, left, right, top } from '../model/rect'
import type { Door, DungeonMap, Point, Rect } from '../model/types'
import {
  cullLabels,
  doorLabels,
  fullyInside,
  passageLabels,
  planRoom1to1Labels,
  roomViewBox,
} from './framing'

const CONFIG_DIR = fileURLToPath(new URL('../../../../public/config/', import.meta.url))

const readJson = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(CONFIG_DIR + name, 'utf8')) as Record<string, unknown>

const cfg: RoomsConfig = parseRoomsConfig(readJson('rooms.json'))

/**
 * 整层楼的几何 —— 与**种子无关**（`floor-plan.json` 里写死的 6F 平面图：263×73 格、
 * `10520×2920px`）。
 *
 * ⚠️ 它是 `generateDungeon` 的**第三个参数**（v5 把几何与内容分了家；v4 只有 seed 与 cfg，
 * 几何是种子算出来的）。所以这里解析**一次**、三个种子共用一份 —— 放进 `mapOf` 里
 * 就是每个种子把同一份表重解析一遍，而它一个像素都不会变。
 */
const plan: FloorPlan = parseFloorPlan(readJson('floor-plan.json'), cfg)

/** 三个种子 —— `colliders.test.ts` 那 200 个的缩小版。 */
const SEEDS = [837, 13, 7932]

const mapOf = (seed: number): DungeonMap => generateDungeon(seed, cfg, plan)

/**
 * 门洞的位置键。与 `collidersOf` 造挡板时那条去重口径**同一套字段**
 * （`axis + 位置 + 宽度`）—— 这里再写一遍是**故意的**：
 * 这道用例要问的正是「标注用的去重口径和造挡板用的是不是同一条」。
 */
function rectKey(d: { axis: string; x: number; y: number; width: number }): string {
  return `${d.axis}:${d.x}:${d.y}:${d.width}`
}

/** 挡板 / 标注 → 位置键。两者的字段名不同（`rect` vs 摊平），这里统一。 */
function holeKey(x: { rect: { x: number; y: number; width: number }; axis: string }): string {
  return rectKey({ ...x.rect, axis: x.axis })
}

/**
 * 原始 `Door` → 位置键。
 *
 * ⚠️ 必须过一道 `doorRect`：`Door` 上只记了**沿墙那条边的长度**（`width`），厚度是配置
 * 给的（`wallThickness`），而挡板与标注记的是**整块矩形**。少了这一道，竖门会拿
 * `width = 120` 去比 `rect.width = 40`，一扇都对不上 —— 而那种对不上看起来
 * 和「生成器把门挪了」一模一样。
 */
function doorKey(d: Door): string {
  return holeKey({ rect: doorRect(d, cfg.wallThickness), axis: d.axis })
}

function roomCenter(map: DungeonMap, order: number): Point {
  const room = map.rooms.find((r) => r.order === order)
  if (room === undefined) throw new Error(`地图上没有第 ${order} 间`)
  return { x: room.rect.x, y: room.rect.y }
}

/** 某一间房的取景框。v5 按 **id** 找房（`order` 只是下标，不再是身份）。 */
function boxOfRoom(map: DungeonMap, id: string): Rect {
  const room = map.rooms.find((r) => r.id === id)
  if (room === undefined) throw new Error(`地图上没有 id 为「${id}」的房间`)
  return roomViewBox(map, cfg, room)
}

/**
 * 「这一段连廊上真开了门的房间」—— 从 `Room.doors` **反着数一遍**，按 `map.rooms`
 * 原序（= `order` 升序）。顺序与去重都与 `passageLabels` 的写法一致，
 * 这样两边对不上就只能是**内容**错，不是排法错。
 */
function roomsOn(map: DungeonMap, passageId: string): string[] {
  const out: string[] = []
  for (const room of map.rooms) {
    for (const d of room.doors) {
      // 两端都要核：一扇门里得有这段连廊，也得有这间房 ——
      // 只核一头的话，一段连廊上任何一扇别的门都会把别的房间算进来。
      if (d.a !== passageId && d.b !== passageId) continue
      if (d.a !== room.id && d.b !== room.id) continue
      if (!out.includes(room.id)) out.push(room.id)
    }
  }
  return out
}

describe('D2 门标注 — 一条挡板一条标注', () => {
  it('标注集合与门挡板集合**逐项对上**（不多不少、位置是同一块）', () => {
    for (const seed of SEEDS) {
      const map = mapOf(seed)
      const barriers = collidersOf(map, cfg).barriers
      const labels = doorLabels(map, cfg)

      // 用键排序后对表：**多一条**（同一个洞标两遍）和**少一条**（有门没标）
      // 都从这里露出来，而不必分别写两条用例。
      expect(labels.map(holeKey).sort()).toEqual(barriers.map(holeKey).sort())

      // 逐条对齐三个字段：位置一样、方向一样还不够，**通向哪个空间也要一样**。
      // ★ v4 这里对齐的是 `toOrder` / `kind`（主干道模型），两个字段都删了；
      // 今天的另一头是 `toId`，恒为走廊段 id —— 见 `framing.ts` 的 `DoorLabel`。
      const byKey = new Map<string, DoorBarrier>(barriers.map((b) => [holeKey(b), b]))
      for (const l of labels) {
        const b = byKey.get(holeKey(l))!
        expect(l.ownerOrder).toBe(b.ownerOrder)
        expect(l.toId).toBe(b.toId)
        expect(l.axis).toBe(b.axis)
      }
    }
  })

  it('印的字就是 `toId`', () => {
    // ★ v4 印的是 `→${toOrder}`（一个进度序号，如 `→5`）；v5 印的是**空间 id**
    // （`→YF604` / `→C_W`）—— 进度序号已经不再决定任何东西（玩家在走廊里随意走、
    // 随意挑房间进），而 id 是平面图上的名字，玩的人和读代码的人都用它。
    // `→✕` 那条分支也一起没有了：`Door` 的两头都必须是平面上真有的空间
    // （`gen/floorPlan.ts` 的 `checkDoors` 在解析时就拦），没有「拿不到目的地」这一种情况。
    for (const seed of SEEDS) {
      for (const l of doorLabels(mapOf(seed), cfg)) {
        expect(l.text).toBe(`→${l.toId}`)
      }
    }
  })
})

describe('D2 门标注 — 标注指回它自己那一间的门（v5 取代「同一个洞只标一次」）', () => {
  it('每条标注都能在 `ownerOrder` 那一间的 `doors` 里找到同一个洞，且 `toId` 是数据的另一头', () => {
    // ★ 为什么换题：v4 的题是「侧室与宿主之间那个洞在数据里记了两条 `Door`（`→4` 与 `→3`），
    // 照 `room.doors` 逐条出标注就会叠成一团糊字」。v5 里 16 扇门全是「房间 ↔ 走廊」，
    // 而**走廊没有 `doors`**（`Passage` 只剩 `{id, rect}`），所以一个洞只会被记一次 ——
    // 那条去重今天**空转**（`colliders.ts` 与 `framing.ts` 两处都写着这一点），
    // 照原样留着就是一条恒真的空壳。
    //
    // 换成的这条盯的是**同一类错**（标注与它指的空间对不上，v4 查 `toOrder`、v5 查 `toId`），
    // 而且两个方向都查：宿主（这个洞得真记在 `ownerOrder` 那一间名下）与另一头。
    for (const seed of SEEDS) {
      const map = mapOf(seed)
      const labels = doorLabels(map, cfg)
      expect(labels.length, `种子 ${seed} 一条门标注都没有 —— 这一条是空跑的`).toBeGreaterThan(0)

      for (const l of labels) {
        const room = map.rooms.find((r) => r.order === l.ownerOrder)
        expect(
          room,
          `种子 ${seed}：标注 ${l.text} 的宿主 order=${l.ownerOrder} 不在图上`,
        ).toBeDefined()
        const here = room!.doors.filter((d) => doorKey(d) === holeKey(l))
        expect(here.length, `种子 ${seed}：${room!.id} 名下没有 ${l.text} 这个洞的原始记录`).toBe(1)

        const d = here[0]!
        // `a` / `b` 是**按字典序**排好的（门无向），所以「另一头」= 不是本房的那一个。
        // ⚠️ 但「恒取 a」/「恒取 b」两种写法**在今天的几何上不是各错一半**：6 个走廊 id
        // 全以 `'C_'` 开头，字典序排在全部房间 id（`'STAIR'` / `'YF6xx'`）**之前**
        // （`'C' < 'S'`），而 16 扇门全部是「房间 ↔ 走廊」（实测三个种子：`a` 恒是走廊、
        // `b` 恒是房间）—— 于是「恒取 a」表现为 **100% 正确**（它只是碰巧对）、
        // 「恒取 b」表现为 **100% 指回本房**。**这条用例抓不住「恒取 a」**；
        // 抓「恒取 b」的是下面 `expect(l.toId).not.toBe(room!.id)` 那一句
        // （`colliders.ts` 的 `barrier()` 那条注释记的就是这个坑）。
        expect(
          d.a === room!.id || d.b === room!.id,
          `种子 ${seed}：${room!.id} 的 ${l.text} 记录里没有这间房 —— 洞挂错房了`,
        ).toBe(true)
        expect(l.toId, `种子 ${seed}：${room!.id} 的 ${l.text} 指到了自己身上`).not.toBe(room!.id)
        expect([d.a, d.b], `种子 ${seed}：${room!.id} 的 ${l.text} 指到了数据外的空间`).toContain(
          l.toId,
        )
      }
    }
  })
})

describe('D2 门标注 — 落点', () => {
  it('**没有任何两条落在同一个点上**（三个种子、每层 16 扇门全不重合）', () => {
    // ⚠️ v4 这里写的是「28 个门洞」—— 那时门数随种子变。v5 的几何与种子无关，
    // 每层恒为 16 扇（`floor-plan.json` 的 16 条 `doors`）。
    for (const seed of SEEDS) {
      const at = doorLabels(mapOf(seed), cfg).map((l) => `${l.at.x},${l.at.y}`)
      expect(new Set(at).size, `种子 ${seed}：有标注叠在一起`).toBe(at.length)
    }
  })

  it('每一条都在**门外那一侧**：比门洞本身离宿主更远', () => {
    for (const seed of SEEDS) {
      const map = mapOf(seed)
      for (const l of doorLabels(map, cfg)) {
        const owner = roomCenter(map, l.ownerOrder)
        if (l.axis === 'v') {
          // 竖直墙上开门 → 出入沿 x。标注必须比门洞更靠外（否则压在房间里，
          // 读起来像「这一间有扇门通向自己」）
          expect(Math.abs(l.at.x - owner.x), `种子 ${seed} ${l.text}`).toBeGreaterThan(
            Math.abs(l.rect.x - owner.x),
          )
        } else {
          expect(Math.abs(l.at.y - owner.y), `种子 ${seed} ${l.text}`).toBeGreaterThan(
            Math.abs(l.rect.y - owner.y),
          )
        }
        // 而且没跑远：沿墙那一维只错开一点，法线那维只出一段
        expect(Math.abs(l.at.x - l.rect.x)).toBeLessThanOrEqual(40)
        expect(Math.abs(l.at.y - l.rect.y)).toBeLessThanOrEqual(40)
      }
    }
  })
})

describe('D2 连廊标注', () => {
  it('每一段连廊一条标注：id / 矩形逐项来自数据，`rooms` 与「这一段上真开了门的房间」逐项相同', () => {
    // ★ v4 这里对的是 `Passage.between`（「这段连廊连着哪两间」的升序两间）——
    // `between` 连类型都删了：v5 的走廊是一张**网**（`C_J` 接 `C_W`、`C_S` 接 `C_M`，
    // `C_W` 上还开着通往楼梯间的门），「它连着哪两间」不再是一般的情形。
    // 现在 `PassageLabel.rooms` 从 `room.doors` **反查**，所以这里也照着门反着数一遍：
    // 「照几何挨着就算通」是这条判据最像对的错法（两段地板贴在一起但隔着墙是**合法**的，
    // `checkSpacesSeparated` 查的就是它），反查的写法才分得开。
    for (const seed of SEEDS) {
      const map = mapOf(seed)
      const labels = passageLabels(map, cfg)
      expect(labels.map((l) => l.id)).toEqual(map.passages.map((p) => p.id))
      expect(labels.map((l) => l.rect)).toEqual(map.passages.map((p) => p.rect))

      for (const l of labels) {
        // 印的字：`连廊 C_W · STAIR YF601 …`；一段都没挂房间时只印 id
        //（空着不印的话，一段连廊有没有名字会看不出规律）。
        expect(l.text).toBe(
          l.rooms.length === 0 ? `连廊 ${l.id}` : `连廊 ${l.id} · ${l.rooms.join(' ')}`,
        )
        expect(l.rooms, `种子 ${seed}：${l.id} 那一串房间与它的门对不上`).toEqual(
          roomsOn(map, l.id),
        )
      }
      // 两种形状今天都真有（一段空的、一段挂着房间）—— 少了一种，那条分支就从没被跑到
      expect(
        labels.some((l) => l.rooms.length === 0),
        `种子 ${seed}：没有一段空连廊`,
      ).toBe(true)
      expect(
        labels.some((l) => l.rooms.length > 0),
        `种子 ${seed}：没有一段挂着房间的连廊`,
      ).toBe(true)
    }
  })

  it('落点落在**连廊自己的矩形里**（不是落在旁边那间教室的地面上）', () => {
    for (const seed of SEEDS) {
      for (const l of passageLabels(mapOf(seed), cfg)) {
        expect(l.at.x, `种子 ${seed} 连廊标注跑出连廊了`).toBeGreaterThanOrEqual(left(l.rect))
        expect(l.at.x).toBeLessThanOrEqual(right(l.rect))
        expect(l.at.y).toBeGreaterThanOrEqual(top(l.rect))
        expect(l.at.y).toBeLessThanOrEqual(bottom(l.rect))
      }
    }
  })
})

describe('D2 1:1 那一场谁上谁下 — 门标注赢，连廊名让位', () => {
  it('两样抢同一个落点时让位的是连廊名 —— 拿全层最近的一对（YF612）把 gap 提到刚碰上', () => {
    // ★ v4 里这一条靠的是「837 的 #4 侧室那扇门 `→11` 与 `连廊 9→11` 只差 2px」——
    // 那组坐标随主干道模型一起作废了（`→N` 换成了 `→C_X` 这样的 id、连廊名从六个字符
    // 长到四十个）。**v5 里没有任何一对自然相撞**：实测三个种子 × 每间房的取景框，
    // 按 1:1 的 gap=34 筛，`dropped` 全是 0 —— 门少了一半多、高度从 8:1 拉到 3.6:1
    // 之后铺得开得多。所以这一条不再靠「恰好撞上」，改成**把 gap 提到刚撞上**：
    // 全层最近的一对就是 YF612 的 `→C_X` 与 `连廊 C_X · YF612`（差 60 / 50）。
    //
    // 它钉的是**序**（门先上、连廊名让位）。而「这一对真的撞得上」由最后那半句反向
    // 验证保证 —— 没有它，这条用例在两根落点离得很远时一样会绿。
    const map = mapOf(837)
    const box = boxOfRoom(map, 'YF612')
    const doors = doorLabels(map, cfg).filter((d) => fullyInside(d.rect, box))
    const passages = passageLabels(map, cfg).filter((p) => fullyInside(p.rect, box))
    expect(doors, 'YF612 的框里不止一扇门 —— 这一条要的是「一对一」的局面').toHaveLength(1)
    expect(passages, 'YF612 的框里没有连廊名 —— 这一条白跑了').toHaveLength(1)

    // 刚碰上那个 gap：两轴距离的较大者 + 1（`cullLabels` 判的是「两个轴都近」）
    const gap =
      Math.max(
        Math.abs(doors[0]!.at.x - passages[0]!.at.x),
        Math.abs(doors[0]!.at.y - passages[0]!.at.y),
      ) + 1

    const plan = planRoom1to1Labels(map, cfg, { box, scale: 1, gap })
    expect(
      plan.doors.map((d) => d.text),
      '门牌被连廊名挤掉了 —— 序反了',
    ).toEqual([doors[0]!.text])
    expect(plan.passages, '连廊名没有被筛掉 —— 先印的没有赢').toHaveLength(0)
    expect(plan.dropped).toBe(1)

    // 反向：把序倒过来（连廊名先印），让位的就该是门牌 —— 证明这一对**真在 gap 内相撞**，
    // 上面那半句不是「两条本来就离得很远」也能绿的东西。
    const flipped = cullLabels(doors, 1, gap, passages)
    expect(flipped.dropped.map((d) => d.text)).toEqual([doors[0]!.text])
  })

  it('`occupied`（房名）先来的赢 —— 落在它上面那条让开，同一框里别的一条都不动', () => {
    // ★ v4 里这一条把房名点算在「#9 教室顶上 + 一格」，而那个点**恰好**贴着某扇门的
    // 门牌。v5 的几何里房名点跟任何门牌都碰不上（实测三个种子 × 16 间房的取景框，
    // 按 gap=34 一条都不筛），照原样写就是一条恒真的空壳。
    // 所以把房名点放在**一扇门牌真正的落点**上 —— 造一个必然相撞的局面。
    // 与 `roomFlow.test.ts` 里那份「战斗关别却没有出生点」的手造地图同一个手法：
    // **造不出来的状态也得有判据**，否则这一条等于没写。
    const map = mapOf(837)
    const box = boxOfRoom(map, 'YF604')
    const doors = doorLabels(map, cfg).filter((d) => fullyInside(d.rect, box))
    expect(
      doors.length,
      'YF604 框里的门太少 —— 这一条要的是「压掉一条、别的还在」',
    ).toBeGreaterThan(1)

    const without = planRoom1to1Labels(map, cfg, { box, scale: 1, gap: 34 })
    expect(without.doors.length, '没有房名占位时不该筛掉任何一条').toBe(doors.length)

    const nameAt = { at: doors[0]!.at }
    const plan = planRoom1to1Labels(map, cfg, { box, scale: 1, gap: 34, occupied: [nameAt] })
    expect(plan.doors.length, '压在房名上的那条没有让开').toBe(doors.length - 1)
    expect(
      plan.doors.some((d) => d.at.x === nameAt.at.x && d.at.y === nameAt.at.y),
      '房名占掉的那条门牌还在 —— 先来的没有赢',
    ).toBe(false)
  })
})

describe('D2 标注 — 两个尺度读的是同一份推导', () => {
  it('**缩略图上要标的那一份**与 1:1 特写读的是同一份推导', () => {
    // 这条用例钉的是**调用点**，不是数学：绘制层（`floorplan.ts`）的两个入口
    // 都必须从 `./framing` 拿这些推导，不许自己再数一遍 `room.doors` / `map.passages`。
    //
    // 为什么要为「谁 import 谁」写一道用例：第二个推导在现场**不报错**，
    // 它只是让同一扇门在两个尺度上写着两个号。而那看起来像「生成器把侧室
    // 接到别处去了」—— 上一版（v4）就是照 `room.doors` 逐条标的，双记的洞叠成两块字。
    // 绘制层 import Phaser，进不了 node 测试，所以这里读源码文本 ——
    // 与 `architecture.test.ts` 查依赖闭包是同一个手法。
    const src = readFileSync(new URL('./floorplan.ts', import.meta.url), 'utf8')
    expect(src).toMatch(/import \{[^}]*\bdoorLabels\b[^}]*\} from '\.\/framing'/)
    expect(src).toMatch(/import \{[^}]*\bpassageLabels\b[^}]*\} from '\.\/framing'/)
    expect(src).not.toMatch(/\bmap\.passages\b[\s\S]{0,40}连廊/)
  })
})

describe('D2 标注筛选 — 两个轴都要近才算撞', () => {
  const gap = 20

  it('只在一个轴上近 —— **两条都留着**', () => {
    // 这正是房名与门牌那一对的情形：`YF612 道具关 (#12)` 这样的房名又宽又扁、`→C_X`
    // 这样的门牌又窄又高。实测（三个种子一致）：YF612 的 1:1 框里，房名落点
    // `(4580, 2200)` 与门牌落点 `(4520, 2110)` 差 dx=60 / dy=90（世界坐标）——
    // **不在同一行、也不在同一列**。按**圆心距离**筛会把它们拆散，而拆掉的恰好是
    // 「这一间 → 下一间」这种最该留下来的组合。
    const { kept, dropped } = cullLabels([{ at: { x: 0, y: 0 } }, { at: { x: 40, y: 5 } }], 1, gap)
    expect(kept).toHaveLength(2)
    expect(dropped).toHaveLength(0)
  })

  it('两个轴都近 —— 后到的被筛掉，先到的留下', () => {
    const a = { at: { x: 0, y: 0 } }
    const b = { at: { x: 5, y: 5 } }
    const { kept, dropped } = cullLabels([a, b], 1, gap)
    expect(kept).toEqual([a])
    expect(dropped).toEqual([b])
  })

  it('`scale` 是先算过的：世界坐标差 200 缩到 0.13 之后只剩 26px', () => {
    // ⚠️ 0.13 是**主干道时代**缩略图的缩放（984×132 的盒子）。拿它当**输入**没问题 ——
    // 这条测的是 `scale` 这个乘法本身；但**别读成「现在的缩略图缩放是 0.13」**。
    // v5 的几何恒为 10520×2920px，按 1280px 宽的屏幕盒子算是 ≈ 0.122。
    // 换成 0.17 结论不变（34 > 20、1.7 < 20）。
    const { kept } = cullLabels([{ at: { x: 0, y: 0 } }, { at: { x: 200, y: 0 } }], 0.13, gap)
    // 200 × 0.13 = 26 > 20 → 放得下；按世界坐标判的话会误以为差得很远
    expect(kept).toHaveLength(2)
    const tight = cullLabels([{ at: { x: 0, y: 0 } }, { at: { x: 200, y: 0 } }], 1, gap)
    expect(tight.kept).toHaveLength(2)
    const overlap = cullLabels([{ at: { x: 0, y: 0 } }, { at: { x: 10, y: 0 } }], 0.13, gap)
    expect(overlap.kept).toHaveLength(1)
  })

  it('`occupied` 里的点一定赢 —— 房名先印、先占地', () => {
    const room = { at: { x: 100, y: 100 } }
    const label = { at: { x: 104, y: 104 } }
    const { kept, dropped } = cullLabels([label], 1, gap, [room])
    expect(kept).toHaveLength(0)
    expect(dropped).toEqual([label])
  })

  it('`kept + dropped` 正好是全部，且顺序稳定（同一张图两次跑结果一样）', () => {
    const items = [
      { at: { x: 0, y: 0 } },
      { at: { x: 3, y: 3 } },
      { at: { x: 500, y: 0 } },
      { at: { x: 502, y: 1 } },
      { at: { x: 1000, y: 0 } },
    ]
    const one = cullLabels(items, 1, gap)
    const two = cullLabels(items, 1, gap)
    expect(one.kept.length + one.dropped.length).toBe(items.length)
    expect(two.kept).toEqual(one.kept)
    expect(two.dropped).toEqual(one.dropped)
    expect(one.kept.map((k) => k.at.x)).toEqual([0, 500, 1000])
  })
})
