/**
 * **逸夫楼 3F**（`public/config/floor-plan-yf3.json`）—— 一局的**第 1 层**。
 *
 * 用户 2026-10-22：「YF3 地图加入到游戏里，进入游戏先是 YF3，下一层是 YF6」。
 * 这一层的几何不是照着 3F 照片重新量的，而是**6F 那份 + 三处编辑**：
 *
 * | # | 编辑 | 为什么 |
 * |---|---|---|
 * | ① | `SHOP` = `YF601` ∪ `YF615` 的外接矩形，东边再让掉顶住楼梯间的那一列 | 用户：「楼梯间左侧两个房间合并成一个特殊的大房间，暂定为商店」 |
 * | ② | `C_W` 的左端从 x0 挪到 x28（隔着 SHOP 那 1 格墙），右端不动 | 合并之后 SHOP 铺满 y25..72，第 27 列非让不可 |
 * | ③ | 删掉 `C_W`↔`YF601` / `C_W`↔`YF615` 两扇门，在 SHOP 与 C_W 的共享墙上开一扇标准宽的门 | 门跟着房间走 |
 *
 * ## 这个文件守的就是那三个字：「只差这三处」
 *
 * 「其余 13 间教室、5 段走廊、14 扇门逐格照抄」这句话**要么被验，要么是句谎话**。
 * 所以下面把 6F 那份**原样跑一遍那三处编辑**，再与提交进仓库的 3F 那份
 * **逐间逐段逐门对**（`toEqual` 一整份，差一个数就红）。
 *
 * 它挡的是一类具体的坏法：**改了 6F 那份（挪一堵墙、开一扇门）而忘了同步 3F** ——
 * 两份表就此分岔，而分岔的症状是「第 1 层的某间房和别的层对不上」，
 * 两个文件各自都完全合法、生成器一声不吭。红在**改配置的那一天**，
 * 而不是三个月后有人打开第 1 层时。
 *
 * ⚠️ 这份测试**故意不 import 产品代码里的那条变换**：3F 那份已经是产品的真值
 * （`BattleScene` 直接读它），所以「该长成什么样」这件事必须**独立写一遍**才对得上账。
 * 拿同一个函数既生成又核对，等于自己证明自己。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { ConfigError } from '@/core/config'
import { parseRoomsConfig, type RoomsConfig } from '../config'
import {
  FLOOR_PLAN_NAME,
  FLOOR_PLAN_YF3_NAME,
  parseFloorPlan,
  type FloorPlan,
} from './floorPlan'

const CONFIG_DIR = fileURLToPath(new URL('../../../../public/config/', import.meta.url))
const readJson = (name: string): unknown => JSON.parse(readFileSync(CONFIG_DIR + name, 'utf8'))

/** `rooms.json` 结构上就是一份 `FloorPlanMetrics`（多出来的字段不影响）。 */
const cfg: RoomsConfig = parseRoomsConfig(readJson('rooms.json'))

const six: FloorPlan = parseFloorPlan(readJson(FLOOR_PLAN_NAME), cfg)
const yf3: FloorPlan = parseFloorPlan(readJson(FLOOR_PLAN_YF3_NAME), cfg)

// ---------------------------------------------------------------- 形状比对

interface RawRect {
  id: string
  x: number
  y: number
  width: number
  height: number
  fixed?: string
}
interface RawDoor {
  a: string
  b: string
  x: number
  y: number
  width: number
  height: number
}
interface RawPlan {
  stairwell: RawRect
  rooms: RawRect[]
  corridors: RawRect[]
  doors: RawDoor[]
  roomTotal: number
}

const asPlan = (raw: unknown): RawPlan => raw as RawPlan

/**
 * 一份平面图**几何上的全部内容**，化成可以直接 `toEqual` 的形状。
 *
 * 三张表都**按 id 排过序**：配置表里条目的先后不影响任何东西（`parseFloorPlan`
 * 按 id 建图，`order` 是按 id 升序编的），拿顺序去比会让「换了一行」与
 * 「换了一个坐标」报成同一种红。`fixed` 写进房间那一行里 —— 关别也是这一层的内容。
 */
interface PlanShape {
  stairwell: string
  roomTotal: number
  rooms: string[]
  corridors: string[]
  doors: string[]
}

function shapeOf(raw: unknown): PlanShape {
  const p = asPlan(raw)
  const box = (r: RawRect | RawDoor): string => `${r.x} ${r.y} ${r.width} ${r.height}`
  return {
    stairwell: `${p.stairwell.id} ${box(p.stairwell)}`,
    roomTotal: p.roomTotal,
    rooms: p.rooms.map((r) => `${r.id} ${box(r)} ${r.fixed ?? '-'}`).sort(),
    corridors: p.corridors.map((c) => `${c.id} ${box(c)}`).sort(),
    // 门是**无向**的（`a` / `b` 按字典序排好），所以这里也按字典序拼 ——
    // 否则「谁写在前面」这种无关紧要的差别会报成一处不同。
    doors: p.doors.map((d) => `${[d.a, d.b].sort().join('~')} ${box(d)}`).sort(),
  }
}

/** 3F 那间商店要并掉的两间 6F 教室。改 6F 那份时这两行是前提。 */
const UPPER = 'YF601'
const LOWER = 'YF615'
const WEST = 'C_W'
const SHOP = 'SHOP'

/**
 * **6F 那份 + 那三处编辑** = 3F 该长成的样子。
 *
 * 每一步的前提都当场断言（那两间房在不在、`C_W` 是不是从 x0 起、共享墙够不够长）——
 * 前提不成立时这里报的是「前提变了」，而不是一个莫名其妙的坐标差。
 * 这份实现与 `floor-plan-yf3.json` 的 `_edits_comment` 是同一件事的两种写法，
 * 有意如此：**两份写得一样才算对上了账**（见文件头）。
 */
function deriveYf3(sixRaw: unknown): PlanShape {
  // clone 是**必须**的：下面要 splice 掉两间房，改到外面那份就等于改真值。
  const plan = structuredClone(asPlan(sixRaw))
  const take = (list: RawRect[], id: string): RawRect => {
    const i = list.findIndex((s) => s.id === id)
    if (i < 0) throw new Error(`6F 平面图里没有 ${id} —— 那三处编辑的第一个前提变了`)
    return list.splice(i, 1)[0]!
  }

  // ① 两间并成一间
  const upper = take(plan.rooms, UPPER)
  const lower = take(plan.rooms, LOWER)
  const stair = plan.stairwell
  const x0 = Math.min(upper.x, lower.x)
  const y0 = Math.min(upper.y, lower.y)
  let x1 = Math.max(upper.x + upper.width, lower.x + lower.width)
  const y1 = Math.max(upper.y + upper.height, lower.y + lower.height)
  // 合并出来的矩形正好顶到楼梯间时让掉那一列 —— 相邻空间之间必须空出整整 1 格
  // （那一格才是墙，见 floor-plan.json 的 `_gap_comment`）。
  const yOverlap = y0 < stair.y + stair.height && stair.y < y1
  if (yOverlap && x1 > stair.x) throw new Error('合并出来的房间压到楼梯间上了')
  if (yOverlap && x1 === stair.x) x1 -= 1
  plan.rooms.push({ id: SHOP, x: x0, y: y0, width: x1 - x0, height: y1 - y0, fixed: 'shop' })

  // ② C_W 让位
  const west = plan.corridors.find((c) => c.id === WEST)
  if (west === undefined) throw new Error(`6F 平面图里没有 ${WEST}`)
  if (west.x !== x0) throw new Error(`${WEST} 不从 x${x0} 起 —— 第二个前提变了`)
  const westEnd = west.x + west.width
  west.x = x0 + (x1 - x0) + 1
  west.width = westEnd - west.x
  if (west.width <= 0) throw new Error(`${WEST} 让位之后没了`)

  // ③ 门跟着挪
  plan.doors = plan.doors.filter(
    (d) => ![d.a, d.b].some((id) => id === UPPER || id === LOWER),
  )
  const doorCells = 120 / 40 // doorWidth / navCellSize，与 rooms.json 一致
  const wallX = x1
  const spanY0 = Math.max(y0, west.y)
  const spanY1 = Math.min(y0 + (y1 - y0), west.y + west.height)
  const spanLen = spanY1 - spanY0
  if (spanLen < doorCells + 2) throw new Error(`共享墙只有 ${spanLen} 格，开不下门`)
  plan.doors.push({
    a: WEST,
    b: SHOP,
    x: wallX,
    y: spanY0 + Math.floor((spanLen - doorCells) / 2),
    width: 1,
    height: doorCells,
  })

  // ④ 房号：YF6xx → YF3xx（房号与门两端一起换）
  const ren = (id: string): string => (id.startsWith('YF6') ? `YF3${id.slice(3)}` : id)
  for (const r of plan.rooms) r.id = ren(r.id)
  for (const d of plan.doors) {
    d.a = ren(d.a)
    d.b = ren(d.b)
  }

  plan.roomTotal = plan.rooms.length + 1
  return shapeOf(plan)
}

// ---------------------------------------------------------------- 用例

describe('真的那份 floor-plan-yf3.json', () => {
  const yf3Raw = readJson(FLOOR_PLAN_YF3_NAME)

  it('过得了全部校验 —— 几何、门、连通性都在 parseFloorPlan 里（它没抛就是过了）', () => {
    expect(yf3.rooms).toHaveLength(14)
    expect(yf3.corridors).toHaveLength(6)
    expect(yf3.doors).toHaveLength(15)
    expect(yf3.stairwell.id).toBe('STAIR')
    // 少一间：15 间编号教室并成了 13 间 + 1 间商店（6F 是 15 + 1 = 16）
    expect(yf3.roomTotal).toBe(15)
    expect(yf3.rooms.length + 1).toBe(yf3.roomTotal)
  })

  it('**这一份就是「6F + 那三处编辑」** —— 逐间逐段逐门对，差一个数就红', () => {
    // 一个 `toEqual` 而不是十个小断言：差在哪儿由 vitest 的 diff 直接指出来
    // （是某间房挪了、某段走廊短了，还是多/少了一扇门）。
    expect(shapeOf(yf3Raw)).toEqual(deriveYf3(readJson(FLOOR_PLAN_NAME)))
  })

  it('房号全是 YF3xx（外加一间 SHOP）—— 第 1 层不出现 YF6xx', () => {
    const ids = [yf3.stairwell, ...yf3.rooms].map((r) => r.id)
    expect(ids.filter((id) => id.startsWith('YF6'))).toEqual([])
    expect(ids.filter((id) => id.startsWith('YF3')).sort()).toEqual(
      Array.from({ length: 13 }, (_, i) => `YF3${String(i + 2).padStart(2, '0')}`),
    )
    expect(ids).toContain(SHOP)
  })

  it('写死的关别跟着房号走：YF304 是首领，YF307 / YF312 是教休室，SHOP 是商店', () => {
    const fixed = yf3.rooms.filter((r) => r.fixed !== null).map((r) => `${r.id}=${r.fixed}`)
    // ⚠️ 6F 那份是 YF604 / YF607 / YF612（没有第四间）—— 房号一一对应，
    //    **除了 601 与 615**（它们属于 SHOP 了）。这两句一起看才拦得住
    //    「改了房号忘了改关别」。
    expect(fixed.sort()).toEqual(['SHOP=shop', 'YF304=boss', 'YF307=reward', 'YF312=reward'])
    expect(yf3.rooms.some((r) => r.id === 'YF604')).toBe(false)
    expect(six.rooms.filter((r) => r.fixed !== null).map((r) => r.id).sort()).toEqual([
      'YF604',
      'YF607',
      'YF612',
    ])
  })

  it('商店是楼梯间左边那一整块，**与楼梯间隔着 1 格墙**', () => {
    const shop = yf3.rooms.find((r) => r.id === SHOP)!
    expect(shop.cells).toEqual({ x: 0, y: 25, width: 27, height: 48 })
    expect(shop.fixed).toBe('shop')
    // 第 27 列是墙：SHOP 的右边（x + width = 27）与楼梯间的左边（x = 28）差 1 格。
    // 紧贴着写的话墙心会落在格边界上，一格中心都盖不住 —— 寻路认为两侧都通，
    // 物理体照样挡着（`_gap_comment` 描述的那个坑）。
    expect(yf3.stairwell.cells.x - (shop.cells.x + shop.cells.width)).toBe(1)
    // 商店里没有桌椅、没有刷怪点：`fixed: 'shop'` 不在 `combatKinds` 里，
    // 「非战斗房三空」是契约校验那条（这里钉的是**它的前提**：关别写对了）。
    expect(shop.fixed).not.toBe('main')
  })

  it('那扇新门开在 SHOP 与 C_W 的共享墙上，且是标准宽（120px = 3 格）', () => {
    const door = yf3.doors.find((d) => [d.a, d.b].includes(SHOP))!
    expect([door.a, door.b].sort()).toEqual([WEST, SHOP])
    expect(door.cells).toEqual({ x: 27, y: 45, width: 1, height: 3 })
    expect(door.axis).toBe('v') // 竖直墙上，人沿 x 穿过
    // ⚠️ 净宽是**长边**：竖门的 `rect.width` 是墙厚（1 格 = 40px），
    //    拿它去比 doorWidth 会得到「40 ≠ 120」而看着像门开窄了。
    expect(Math.max(door.rect.width, door.rect.height)).toBe(cfg.doorWidth)
    // 商店**只有这一扇门**：6F 那两扇（C_W↔YF601 / C_W↔YF615）连同那两间房一起没了，
// 留下一扇的话墙上会凭空多一个洞（那扇门的另一端指向不存在的空间，解析时就炸）。
    const shopDoors = yf3.doors.filter((d) => [d.a, d.b].includes(SHOP))
    expect(shopDoors.map((d) => `${d.a}~${d.b}`)).toEqual([`${WEST}~${SHOP}`])
  })

  it('包围盒与 6F **逐像素一样** —— 换层时 `applyArena()` 的前提', () => {
    // 物理世界边界、`TerrainMap` 的宽高、寻路网格的行列数都在 `CombatSession`
    // 构造时定死，之后改不了。两层的包围盒不同的话换层会当场抛（那边**当场抛**
    // 是对的：另一种表现是「第二层的墙全在错位」）。守护在
    // `floors.test.ts`，这里钉的是「今天确实一样」。
    expect(yf3.bounds).toEqual(six.bounds)
    expect(yf3.cols).toBe(six.cols)
    expect(yf3.rows).toBe(six.rows)
  })

  it('走廊与房间的**净宽下限**没被这次合并压坏（门不许比 minPassageWidth 窄）', () => {
    // `parseFloorPlan` 的 `checkDoors` 已经核过每扇门 —— 这一条钉的是
    // 「3F 这条路上没有一扇门的净宽是刚刚擦着下限过的」：擦着过的话，
    // 下次有人动一下 doorWidth，红的会是 3F 而 6F 还绿着，读的人会以为是 3F 写错了。
    for (const d of yf3.doors) {
      const clear = Math.max(d.rect.width, d.rect.height)
      expect(clear, `门 ${d.a}~${d.b}`).toBeGreaterThanOrEqual(cfg.minPassageWidth)
    }
  })

  it('把 `roomTotal` 改坏 → 当场抛（它是这一层自己的字段，别处没有第二份可对）', () => {
    const broken = { ...(yf3Raw as Record<string, unknown>), roomTotal: 14 }
    expect(() => parseFloorPlan(broken, cfg)).toThrow(ConfigError)
    expect(() => parseFloorPlan(broken, cfg)).toThrow(/楼梯间/)
  })
})