/**
 * `floor-plan.json` 的解析与校验。
 *
 * 两类用例，缺一不可：
 *
 * - **2.10** 真的那份配置表**要过**。这是唯一的整合证明 —— 前面所有断言都建立在
 *   「解析器能读懂当前这份表」之上。它红了说明有人改了配置表没改解析器（或反过来）。
 * - **2.9** 每一类校验**要能响**。做法是把真的那份表**改坏一处**再解析，
 *   而不是手搓一个小 fixture：手搓的 fixture 迟早与真表漂移，
 *   于是校验器坏了、测试还是绿的。
 *
 * ⚠️ 这些用例全部跑在 `node` 环境下（`vite.config.ts` 把单测环境钉死了），
 * 读配置走 `node:fs` —— `public/` 下的文件**不许 import**（见 `architecture.test.ts`）。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { ConfigError } from '@/core/config'
import { checkRoomCount, parseFloorPlan } from './floorPlan'
import type { FloorPlanMetrics } from './floorPlan'

const CONFIG_DIR = fileURLToPath(new URL('../../../../public/config/', import.meta.url))
const readJson = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(CONFIG_DIR + name, 'utf8')) as Record<string, unknown>

/** `rooms.json` 结构上就是一份 `FloorPlanMetrics`（多出来的字段不影响）。 */
const METRICS = readJson('rooms.json') as unknown as FloorPlanMetrics

/** 真的那份配置表的一份**可变深拷贝** —— 每个用例改坏一处再解析。 */
const brokenPlan = (): Record<string, unknown> =>
  structuredClone(readJson('floor-plan.json')) as Record<string, unknown>

type AnyRec = Record<string, unknown>
const roomsOf = (plan: AnyRec): AnyRec[] => plan.rooms as AnyRec[]
const doorsOf = (plan: AnyRec): AnyRec[] => plan.doors as AnyRec[]

/** 解析并返回抛出的 `ConfigError`；没抛就当场失败（并把「没抛」说清楚）。 */
function expectConfigError(plan: unknown): ConfigError {
  try {
    parseFloorPlan(plan, METRICS)
  } catch (err) {
    if (err instanceof ConfigError) return err
    throw err
  }
  throw new Error('预期这份配置表会被挡下，但它解析通过了 —— 校验器漏了这条')
}

// ---------------------------------------------------------------- 2.10

describe('真的那份 floor-plan.json', () => {
  const plan = parseFloorPlan(readJson('floor-plan.json'), METRICS)

  it('过得了全部校验（这一条红了就是配置表与解析器对不上了）', () => {
    expect(plan.rooms).toHaveLength(15)
    expect(plan.corridors).toHaveLength(6)
    expect(plan.doors).toHaveLength(16)
    expect(plan.stairwell.id).toBe('STAIR')
  })

  it('换算：格 → px、左上角 → 中心点，两处都只在解析里做一次', () => {
    // YF604 在配置表里是 x=108 y=0 45×24 格 → 中心点 (108+22.5)*40, (0+12)*40
    const yf604 = plan.rooms.find((r) => r.id === 'YF604')!
    expect(yf604.cells).toMatchObject({ x: 108, y: 0, width: 45, height: 24 })
    expect(yf604.rect.x).toBe((108 + 45 / 2) * 40)
    expect(yf604.rect.y).toBe((0 + 24 / 2) * 40)
    expect(yf604.rect.width).toBe(45 * 40)
    expect(yf604.rect.height).toBe(24 * 40)
  })

  it('写死的关别：YF604 是首领，两间教休室是道具房，其余按种子抽', () => {
    const fixed = plan.rooms.filter((r) => r.fixed !== null).map((r) => `${r.id}=${r.fixed}`)
    expect(fixed.sort()).toEqual(['YF604=boss', 'YF607=reward', 'YF612=reward'])
    // 楼梯间恒为 start，且**不在** rooms 里（它不是按种子抽的那个集合的一员）
    expect(plan.rooms.some((r) => r.id === 'STAIR')).toBe(false)
  })

  it('这一层声明 16 间房：15 间编号教室 + 1 间楼梯间', () => {
    // ★ 改了（2026-10-22）：原先这里对着两个数（`rooms.json` 的 classroomCount 是
    //    15、代码里的 FLOOR_ROOM_TOTAL 是 16），因为「同一个量有两个名字」是这一节
    //    最容易读错的地方。现在**只有一个数**：平面图自己声明的 `roomTotal`，
    //    而它必须等于「rooms 的条数 + 楼梯间」—— 少加那 1 就是出生点没有一间
    //    属于它的房，多减那 1 就是漏了楼梯间。两层楼的间数不同（这里是 6F 的 16），
    //    所以这个数跟着文件走，不再是全局常量。
    expect(plan.rooms.length).toBe(15)
    expect(plan.roomTotal).toBe(16)
    expect(plan.rooms.length + 1).toBe(plan.roomTotal)
  })

  it('楼梯间是一间房，不是「不是房间」的空间 —— 出生点必须落在某间房里（下同）', () => {
    // 楼梯间的 id 与 rooms 里的都不重名，且它有完整的几何（能站人、有边界）
    expect(plan.stairwell.id).toBe('STAIR')
    expect(plan.rooms.some((r) => r.id === plan.stairwell.id)).toBe(false)
    expect(plan.stairwell.rect.width).toBeGreaterThan(0)
    expect(plan.stairwell.rect.height).toBeGreaterThan(0)
  })

  it('教休室是两张小房间：YF607 与 YF612 都比同层的普通教室小', () => {
    const area = (id: string): number => {
      const r = plan.rooms.find((x) => x.id === id)!
      return r.cells.width * r.cells.height
    }
    expect(area('YF607')).toBeLessThan(area('YF601'))
    expect(area('YF612')).toBeLessThan(area('YF601'))
  })

  it('YF612 的门开在它北侧的前室（C_X）上，不是穿 YF613 进去的', () => {
    const door = plan.doors.find((d) => d.a === 'C_X' || d.b === 'C_X')!
    expect([door.a, door.b].sort()).toEqual(['C_X', 'YF612'])
    // 而 YF613 与 YF612 之间**没有**门
    expect(plan.doors.some((d) => [d.a, d.b].includes('YF613') && [d.a, d.b].includes('YF612'))).toBe(false)
  })

  it('走廊是一张网：6 段全在同一个连通块里，每段都报得出它接的是谁', () => {
    // 从 C_W 出发能走到每一段
    const seen = new Set(['C_W'])
    const queue = ['C_W']
    while (queue.length > 0) {
      // ⚠️ 先 pop 再查 —— 写成 `find((c) => c.id === queue.pop())` 的话，
      //    谓词对每一段都跑一次，于是每跑一次就多弹一个 id 出来。
      const id = queue.pop()!
      const cur = plan.corridors.find((c) => c.id === id)!
      for (const next of cur.connectsTo) {
        if (seen.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
    expect([...seen].sort()).toEqual(plan.corridors.map((c) => c.id).sort())
  })

  it('每间房都有门，且每一扇门都恰好连着一个房间与一段走廊', () => {
    const corridorIds = new Set(plan.corridors.map((c) => c.id))
    const roomIds = new Set([...plan.rooms.map((r) => r.id), plan.stairwell.id])
    for (const d of plan.doors) {
      const ends = [corridorIds.has(d.a), corridorIds.has(d.b)]
      expect(ends.filter(Boolean)).toHaveLength(1)
      expect(roomIds.has(d.a) || roomIds.has(d.b)).toBe(true)
    }
    const withDoor = new Set(plan.doors.flatMap((d) => [d.a, d.b]))
    for (const id of roomIds) expect(withDoor.has(id)).toBe(true)
  })

  it('门是无向的：a / b 按字典序排好', () => {
    for (const d of plan.doors) expect(d.a < d.b).toBe(true)
  })

  it('整流形：全部坐标都是整数格，且换算后落在 navCellSize 的整数倍上', () => {
    for (const s of [plan.stairwell, ...plan.rooms, ...plan.corridors]) {
      for (const v of [s.cells.x, s.cells.y, s.cells.width, s.cells.height]) {
        expect(Number.isInteger(v)).toBe(true)
      }
      expect(Number.isInteger(s.rect.x - s.rect.width / 2)).toBe(true)
    }
    expect(plan.bounds.width % METRICS.navCellSize).toBe(0)
    expect(plan.bounds.height % METRICS.navCellSize).toBe(0)
  })
})

// ---------------------------------------------------------------- 2.9

describe('校验器：每一类各一条「改坏 → 报对」', () => {
  it('房间叠在一起 → 报重叠，并说出是哪两间', () => {
    const plan = brokenPlan()
    // 把 YF601 搬到 YF602 头上
    const yf601 = roomsOf(plan).find((r) => r.id === 'YF601')!
    const yf602 = roomsOf(plan).find((r) => r.id === 'YF602')!
    yf601.x = yf602.x as number
    yf601.y = yf602.y as number
    const err = expectConfigError(plan)
    expect(err.message).toContain('重叠')
    expect(err.message).toMatch(/YF60[12]/)
  })

  it('两间房贴死（中间没有墙）→ 报出来，并说明为什么贴上会静默出错', () => {
    const plan = brokenPlan()
    // 把 YF602 往西挪一格，正好贴上 YF601（YF601 占 x3..27，所以挪到 x28 就贴死）
    const yf601 = roomsOf(plan).find((r) => r.id === 'YF601')!
    const yf602 = roomsOf(plan).find((r) => r.id === 'YF602')!
    yf602.x = (yf601.x as number) + (yf601.width as number) + 1
    yf602.y = yf601.y
    const err = expectConfigError(plan)
    // ⚠️ 贴上会先撞上「门落在房间里」还是「贴死」，取决于改法 —— 两种都是对的，
    //    这里只要求它**别静默通过**，且报的是这两间房。
    expect(err.message).toMatch(/YF60[12]/)
  })

  it('门开在房间里面 → 报「门格落在某间房里」', () => {
    const plan = brokenPlan()
    const d = doorsOf(plan).find((x) => x.b === 'YF601')!
    d.y = (roomsOf(plan).find((r) => r.id === 'YF601')!.y as number) + 5
    const err = expectConfigError(plan)
    expect(err.message).toContain('YF601')
    expect(err.message).toContain('里面')
  })

  it('门太窄（净宽 < minPassageWidth）→ 报两个数', () => {
    const plan = brokenPlan()
    doorsOf(plan)[0].width = 2 // 2 格 = 80px < 120px
    const err = expectConfigError(plan)
    expect(err.message).toContain('80px')
    expect(err.message).toContain(`${METRICS.minPassageWidth}px`)
  })

  it('门指向一对其实不挨着的空间 → 报出它两侧真正站着谁', () => {
    const plan = brokenPlan()
    // 位置不动，只把「接的是哪条走廊」说错：那格确实是墙，墙的两侧也确实是
    // C_W 与 YF601，但不是它声称的 C_E —— 走这一条分支。
    // （挪坐标是**另一种**错，会被「门格落在房间里面」先拦下，见上一个用例。）
    const d = doorsOf(plan).find((x) => x.b === 'YF601')!
    d.a = 'C_E'
    const err = expectConfigError(plan)
    expect(err.message).toContain('两侧')
    expect(err.message).toContain('C_W') // 报出真实站着谁
    expect(err.message).toContain('C_E')
  })

  it('门引用了不存在的 id → 报出未知 id **与**合法 id 集合', () => {
    const plan = brokenPlan()
    doorsOf(plan)[0].b = 'YF616'
    const err = expectConfigError(plan)
    expect(err.message).toContain('YF616')
    expect(err.message).toContain('YF615') // 合法清单里有它
    expect(err.message).toContain('STAIR')
  })

  it('id 重名 → 报出来', () => {
    const plan = brokenPlan()
    roomsOf(plan)[1].id = roomsOf(plan)[0].id
    const err = expectConfigError(plan)
    expect(err.message).toContain('两次')
  })

  it('某间房没有门 → 连通性校验走不到它，且**逐个列出**走不到的 id', () => {
    const plan = brokenPlan()
    // 删掉 YF607 唯一的那扇门
    plan.doors = doorsOf(plan).filter((d) => d.b !== 'YF607')
    const err = expectConfigError(plan)
    expect(err.message).toContain('YF607')
    expect(err.message).not.toContain('YF608') // 其余的照样走得到，不该被牵连
  })

  it('走廊段不再相接时，靠那条走廊接进来的房间也走不到了', () => {
    const plan = brokenPlan()
    // 把 C_E 整段搬到地图外面 —— 挂在它上面的四间房（YF605/606/609/608）顿时孤立
    const cE = (plan.corridors as AnyRec[]).find((c) => c.id === 'C_E')!
    cE.y = 200
    const err = expectConfigError(plan)
    expect(err.message).toMatch(/YF60[5689]/)
  })

  it('声明了 16 间而几何只有 15 间（删了一间教室）→ **两个数字都报出来**', () => {
    const plan = brokenPlan()
    // ⚠️ 删房必须**连它的门一起删**。只删房的话，那扇门就成了悬空引用，
    //    而 `checkDoors` 排在 `checkRoomCount` 前面 —— 报出来的是「门引用了不存在
    //    的 id」，不是「房数对不上」。而「14」「15」两个串在**任何**含 id 清单的
    //    报错里都凑得出来（`YF614` / `doors[15]`），于是那两条断言会**看着是绿的**
    //    却一次都没走到这个校验器上。这是「测试钉错了东西」，不是校验器的毛病。
    const yf607 = roomsOf(plan).find((r) => r.id === 'YF607')!
    plan.rooms = roomsOf(plan).filter((r) => r !== yf607)
    plan.doors = doorsOf(plan).filter((d) => d.a !== 'YF607' && d.b !== 'YF607')
    const err = expectConfigError(plan)
    expect(err.message).toContain('16') // 声明的
    expect(err.message).toContain('14') // 几何里还有几间
    expect(err.message).toContain('15') // 14 + 楼梯间
    // 报错要说清楼梯间**算在总数里** —— 不然读的人会把它当成「多出来的那一间」
    expect(err.message).toContain('楼梯间')
  })

  it('房间数没变、只把 roomTotal 写错 → 照样拦得住（两种错法各报各的）', () => {
    // ★ 改了（2026-10-22）：这一条原先试的是「把 rooms.json 与平面图改成同一个数」
    //    （两个文件同时改，对账那条就静默通过了）。现在两个数**在同一份平面图里**，
    //    所以它守的是同一件事的另一个形态：几何是对的、只有声明被改坏。
    //    这也是删掉「教室数 vs classroomCount」那条判据后剩下的**唯一**一条 ——
    //    没有第二个文件会替它响，所以两种错法都要钉住。
    const plan = parseFloorPlan(readJson('floor-plan.json'), METRICS)
    expect(plan.rooms.length + 1).toBe(plan.roomTotal) // 正的那一侧先钉住
    // 写小了 = 漏了楼梯间（看着像「我数了一遍房间」）
    expect(() => checkRoomCount(plan.rooms, plan.roomTotal - 1)).toThrow(/漏了楼梯间/)
    // 写大了 = 多数了一间
    expect(() => checkRoomCount(plan.rooms, plan.roomTotal + 1)).toThrow(/多数了一间/)
    expect(() => checkRoomCount(plan.rooms, plan.roomTotal + 1)).toThrow(ConfigError)
  })

  it('坐标不是整数格 → 报出来（半格会把墙心从格中心挤出去）', () => {
    const plan = brokenPlan()
    roomsOf(plan)[0].x = 3.5
    const err = expectConfigError(plan)
    expect(err.message).toContain('整数')
  })

  it('关别写错 → 报出合法关别全集', () => {
    const plan = brokenPlan()
    roomsOf(plan).find((r) => r.id === 'YF604')!.fixed = '最终关'
    const err = expectConfigError(plan)
    expect(err.message).toContain('boss')
    expect(err.message).toContain('reward')
  })
})