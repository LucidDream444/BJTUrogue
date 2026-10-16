/**
 * 门标注 / 连廊标注的推导。**跑在 node 环境** —— 不加载 Phaser、不碰 DOM。
 *
 * 这一份是任务书里「地图视觉上要优化：表现上分支关的门没连上下一个主干道关」
 * 的那一条的自动化验收。它盯的是三类**画出来不像坏、但读不出东西**的错：
 *
 * 1. **同一个洞标两条**：侧室与宿主之间那个洞在数据里是**两条互为正反的 `Door`**
 *    （`→4` 与 `→3`），照 `room.doors` 逐条出标注就会叠成一团糊字。
 * 2. **标注内容跟 `toOrder` 对不上**：写 `→4` 而数据是 `5`。这种错在图上
 *    和「生成器把侧室接到别处去了」长得一模一样 —— 那是最难查的一类。
 * 3. **落点叠在一起**：位置一撞，两条都读不出来，看起来还像「这一层门特别多」。
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
import { bottom, left, right, top } from '../model/rect'
import type { DungeonMap, Point, Rect } from '../model/types'
import {
  cullLabels,
  doorLabels,
  fullyInside,
  passageLabels,
  planRoom1to1Labels,
  roomViewBox,
} from './framing'

const CONFIG_DIR = fileURLToPath(new URL('../../../../public/config/', import.meta.url))

const cfg: RoomsConfig = parseRoomsConfig(
  JSON.parse(readFileSync(CONFIG_DIR + 'rooms.json', 'utf8')),
)

const SEEDS = [837, 13, 7932]

const mapOf = (seed: number): DungeonMap => generateDungeon(seed, cfg)

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

function roomCenter(map: DungeonMap, order: number): Point {
  const room = map.rooms.find((r) => r.order === order)
  if (room === undefined) throw new Error(`地图上没有第 ${order} 间`)
  return { x: room.rect.x, y: room.rect.y }
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

      // 逐条对齐三个字段：位置一样、方向一样还不够，**通向哪一间也要一样**
      const byKey = new Map<string, DoorBarrier>(barriers.map((b) => [holeKey(b), b]))
      for (const l of labels) {
        const b = byKey.get(holeKey(l))!
        expect(l.ownerOrder).toBe(b.ownerOrder)
        expect(l.toOrder).toBe(b.toOrder)
        expect(l.kind).toBe(b.kind)
        expect(l.axis).toBe(b.axis)
      }
    }
  })

  it('印的字就是 `toOrder`', () => {
    for (const seed of SEEDS) {
      for (const l of doorLabels(mapOf(seed), cfg)) {
        expect(l.text).toBe(`→${l.toOrder}`)
      }
    }
  })

  it('墙外那扇印 `→✕`，且**落点一点不变** —— `toOrder` 只决定印什么字', () => {
    // ⚠️ 今天的生成器**一扇 `toOrder = null` 的门都不出**（三个种子里 0 条）。
    // 但类型允许它，而且 `collidersOf` 的封死色、校验器、可达性、清房判据
    // 四处都替它留着分支 —— 所以这里手工造一份出来，把 837 里 `#3` ⇄ `#4`
    // 那个洞的两条改成墙外。与 `roomFlow.test.ts` 里那份「战斗关别却没有出生点」
    // 的手造地图同一个手法：**造不出来的状态也得有判据**，
    // 否则等哪天真出一个，没人知道该印什么、该印在哪。
    const map = mapOf(837)
    // ⚠️ 洞的坐标是**跟着房间尺寸走的** —— 2026-10-16 房间放大（640×280 → 1280×600）之后
    // 整层坐标全变了。这里跟着改成新的 `#3 ⇄ #4` 那个洞。
    const hole = { axis: 'h' as const, x: 4700, y: -300, width: 120 }
    const sealed: DungeonMap = {
      ...map,
      rooms: map.rooms.map((r) => ({
        ...r,
        doors: r.doors.map((d) => (rectKey(d) === rectKey(hole) ? { ...d, toOrder: null } : d)),
      })),
    }

    const label = doorLabels(sealed, cfg).find((l) => holeKey(l) === rectKey(hole))
    expect(label?.text).toBe('→✕')

    // 落点与没堵死时**逐项相同**：位置跟着几何走，不跟着数据走。
    // 跟着数据走的话，门一被堵上，标注会跳到别处 —— 看起来像「这堵墙上多了一扇门」。
    const open = doorLabels(map, cfg).find((l) => holeKey(l) === rectKey(hole))!
    expect(label?.at).toEqual(open.at)
    expect(label?.rect).toEqual(open.rect)
    expect(label?.ownerOrder).toBe(open.ownerOrder)
  })
})

describe('D2 门标注 — 同一个洞从两侧看只标一次', () => {
  it('**去重确实在起作用**（原始 `room.doors` 比挡板多，多出来的正是双记的洞）', () => {
    for (const seed of SEEDS) {
      const map = mapOf(seed)
      const raw = map.rooms.flatMap((r) => r.doors)
      const labels = doorLabels(map, cfg)
      expect(
        raw.length,
        `种子 ${seed}：原始门 ${raw.length} 条、标注 ${labels.length} 条 —— 一样多说明这条用例是空跑的`,
      ).toBeGreaterThan(labels.length)
    }
  })

  it('种子 837：`#3` ⇄ `#4` 那一个洞，原始数据两条（`→4` 与 `→3`），标注只剩一条 `→4`', () => {
    const map = mapOf(837)
    // ⚠️ 洞的坐标是**跟着房间尺寸走的** —— 2026-10-16 房间放大（640×280 → 1280×600）之后
    // 整层坐标全变了。这里跟着改成新的 `#3 ⇄ #4` 那个洞。
    const hole = { axis: 'h' as const, x: 4700, y: -300, width: 120 }

    // 先确认这个洞在数据里**真的是双记的** —— 不然这条用例测的是别的东西
    const rawHere = map.rooms.flatMap((r) => r.doors).filter((d) => rectKey(d) === rectKey(hole))
    expect(rawHere.map((d) => `${d.kind}→${d.toOrder}`).sort()).toEqual(['side→3', 'side→4'])

    const labelsHere = doorLabels(map, cfg).filter((l) => holeKey(l) === rectKey(hole))
    expect(labelsHere).toHaveLength(1)
    // 剩下的是**记在宿主名下**那一条：字读作 `→4`（从主干那一侧看，穿过去是侧室）
    expect(labelsHere[0]!.ownerOrder).toBe(3)
    expect(labelsHere[0]!.text).toBe('→4')
  })
})

describe('D2 门标注 — 落点', () => {
  it('**没有任何两条落在同一个点上**（三个种子 28 个门洞全不重合）', () => {
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

  it('种子 837：**侧室 #4 的两扇门都标得出来** —— 回宿主那扇 `→4`、去下一间主干那扇 `→5`', () => {
    const map = mapOf(837)
    const labels = doorLabels(map, cfg)

    // 这是用户报的那条缺口：站在 #4 里，两个洞一个回 #3、一个通向 #5，
    // 光看亮线的颜色（都是 side 黄）是分不出来的。
    const exit = labels.filter((l) => l.ownerOrder === 4)
    expect(exit.map((l) => l.text)).toEqual(['→5'])
    // 回宿主那扇记在 #3 名下（同一个洞，只标一次），照样在旁边印出 `→4`
    const back = labels.filter((l) => l.ownerOrder === 3 && l.toOrder === 4)
    expect(back.map((l) => l.text)).toEqual(['→4'])

    // 且两条分在**那堵墙的两侧**：#4 挂在主干的上方，所以回宿主那扇的标注
    // 还要往北（`y` 更小），出口那扇的标注落在主干那一带。
    // 两条都挤在墙上或都挤进同一间，现场就是一团糊字 —— 而糊字和没标是一样的。
    expect(back[0]!.at.y).toBeLessThan(exit[0]!.at.y)
    expect(exit[0]!.at).not.toEqual(back[0]!.at)
  })

  it('#5 的后门标的是 `→3` 而不是 `→4` —— 侧室不占主干的位置轴', () => {
    const labels = doorLabels(mapOf(837), cfg)
    const back5 = labels.find((l) => l.ownerOrder === 5 && l.kind === 'back')!
    expect(back5.text).toBe('→3')
  })
})

describe('D2 连廊标注', () => {
  it('每一段连廊一条标注，`between` 与数据逐项相同（一个字都不推）', () => {
    for (const seed of SEEDS) {
      const map = mapOf(seed)
      const labels = passageLabels(map, cfg)
      expect(labels.map((l) => l.between)).toEqual(map.passages.map((p) => p.between))
      expect(labels.map((l) => l.rect)).toEqual(map.passages.map((p) => p.rect))

      for (const l of labels) {
        expect(l.text).toBe(`连廊 ${l.between[0]}→${l.between[1]}`)
      }
      expect(labels.length).toBeGreaterThan(0)
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
  /** `d2_classroom` 的取景框：挑出的那间主干教室 + 它东西两段连廊。 */
  const classroomBox = (seed: number): { map: DungeonMap; box: Rect } => {
    const map = mapOf(seed)
    // 场子挑房间的规则在 `_shared.ts`（`chooseClassroom`）；这里只要**同一间房**
    // 的框，所以取种子 837 里那间（`d2_classroom` 挑中的就是 #9，见那个场子的注释）。
    const room = map.rooms.find((r) => r.order === 9)!
    return { map, box: roomViewBox(map, cfg, room) }
  }

  it('种子 837：`→11` 上屏、`连廊 9→11` 让位 —— 两条只差 2px，必然要舍一条', () => {
    // 这是用户报的那条缺口：`→11` 是**挂在连廊正下方的侧室**那扇门，
    // 而连廊名的落点（下沿往里去 28px）和它（洞心 + 法线 30）只差 2px。
    // 让连廊名赢，就等于把「分支关的门连不连得上下一段主干」的答案筛掉。
    const { map, box } = classroomBox(837)
    const plan = planRoom1to1Labels(map, cfg, { box, scale: 1, gap: 34 })

    const side = plan.doors.filter((d) => d.ownerOrder === 10)
    expect(side.map((d) => d.text)).toEqual(['→11'])
    expect(plan.passages.map((p) => p.text)).not.toContain('连廊 9→11')
    // 让位的那条**确实被算进 `dropped`** —— 静默消失的话，读数里印的「筛掉 N 条」
    // 就是一句看着像真的假话（场子拿它当读数）。
    expect(plan.dropped).toBeGreaterThan(0)
  })

  it('反过来把序倒过来（连廊名先印）就会被筛掉 —— 这条用例钉的正是「序」', () => {
    // 拿同一批标注，只换先后：如果两条谁先印谁赢，那么换过来结论必须反过来。
    // 没有这一条，上面那条用例在「两根落点其实离得很远」的地图上也会绿。
    const { map, box } = classroomBox(837)
    const doors = doorLabels(map, cfg).filter((d) => fullyInside(d.rect, box))
    const passages = passageLabels(map, cfg).filter((p) => fullyInside(p.rect, box))
    const nameFirst = cullLabels(doors, 1, 34, passages)

    expect(nameFirst.dropped.map((d) => d.text)).toEqual(['→11'])
  })

  it('`occupied`（房名）依旧先来的赢 —— 门标注要让开房间名', () => {
    const { map, box } = classroomBox(837)
    const room = map.rooms.find((r) => r.order === 9)!
    const nameAt = { at: { x: room.rect.x, y: top(room.rect) + cfg.navCellSize } }
    const plan = planRoom1to1Labels(map, cfg, { box, scale: 1, gap: 34, occupied: [nameAt] })
    // 门标注一条都不许落在房名那块地方
    for (const d of plan.doors) {
      const dx = Math.abs(d.at.x - nameAt.at.x)
      const dy = Math.abs(d.at.y - nameAt.at.y)
      expect(dx >= 34 || dy >= 34, `${d.text} 压在房名上`).toBe(true)
    }
  })

  it('**缩略图上要标的那一份**与 1:1 特写读的是同一份推导', () => {
    // 这条用例钉的是**调用点**，不是数学：绘制层（`floorplan.ts`）的两个入口
    // 都必须从 `./framing` 拿这两份推导，不许自己再数一遍 `room.doors` / `map.passages`。
    //
    // 为什么要为「谁 import 谁」写一道用例：第二个推导在现场**不报错**，
    // 它只是让同一扇门在两个尺度上写着两个号。而那看起来像「生成器把侧室
    // 接到别处去了」—— 上一版就是照 `room.doors` 逐条标的，双记的洞叠成两块字。
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
    // 这正是侧室那一对的情形：`→5` 与 `#4 侧室·奖励关` 横向差半个房名宽度、
    // 纵向差不到一行字。按**圆心距离**筛会把它们拆散，而拆掉的恰好是
    // 「这一间 → 下一间」这种最该留下来的组合。
    const { kept, dropped } = cullLabels(
      [{ at: { x: 0, y: 0 } }, { at: { x: 40, y: 5 } }],
      1,
      gap,
    )
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

  it('`scale` 是先算过的：世界坐标差 200 在 0.13 的缩略图上只有 26px', () => {
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