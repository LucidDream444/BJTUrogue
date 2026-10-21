/**
 * 碰撞几何的自动化验收。**跑在 node 环境** —— 不加载 Phaser、不碰 DOM。
 *
 * 这一份测试要挡住的三类错，都是**不报错**的那种：
 *
 * 1. 椅子混进挡弹列表 → 子弹在椅子前面停住（现场看起来像「枪卡了」）
 * 2. 门挡板造了两块 / 偏了半格 → 门缝里挤得过去，或者多出一块看不见的墙
 * 3. 挡板位置与墙上的**缺口**对不上 → 封门封不住，而这一条**只看数据看不出来**
 *    （所以下面有一组是「把挡板喂进寻路网格，那几格必须变堵」）
 *
 * 配置读真文件、种子写死：与 `gen/generate.test.ts` 同一个手法、同一个理由。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { collidersOf, overlapsWithArea } from './colliders'
import { generateDungeon } from './gen/generate'
import { parseRoomsConfig, type RoomsConfig } from './config'
import { parseFloorPlan } from './gen/floorPlan'
import type { FloorPlan } from './gen/floorPlan'
import { buildGrid, gridOfMap, navExtentFor, type NavGrid } from './walkability'
import { bottom, containsPoint, doorRect, left, right, top } from './model/rect'
import type { Door, DungeonMap, Rect } from './model/types'

const CONFIG_DIR = fileURLToPath(new URL('../../../public/config/', import.meta.url))

const readJson = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(CONFIG_DIR + name, 'utf8')) as Record<string, unknown>

function readRooms(): RoomsConfig {
  return parseRoomsConfig(readJson('rooms.json'))
}

const cfg = readRooms()

/**
 * 整层楼的几何 —— 与**种子无关**（`floor-plan.json` 里写死的 6F 平面图）。
 *
 * ⚠️ 它现在是 `generateDungeon` 的**第三个参数**：几何与内容分了家，
 * 种子只决定关别、障碍物、刷怪点。所以这里解析**一次**、200 个种子共用一份 ——
 * 放进 `maps()` 里就是每个种子重解析一遍同一份表（200 次），
 * 而它一次都不会变。
 */
const plan: FloorPlan = parseFloorPlan(readJson('floor-plan.json'), cfg)

/** 批量扫描用的种子。**写死**，见文件头。 */
const SEEDS = Array.from({ length: 200 }, (_, i) => i * 7919 + 13)

function maps(): DungeonMap[] {
  return SEEDS.map((s) => generateDungeon(s, cfg, plan))
}

/**
 * 地图上所有的门。
 *
 * ⚠️ v4 的括号里写的是「含同一洞口的两次记录」—— **v5 里没有了**：
 * 16 扇门全是「房间 ↔ 走廊」，走廊不是 `Room`，所以一个洞口只记一次。
 * 想验去重的话得自己造重复（见下面那条用例）。
 */
function allDoors(map: DungeonMap): Door[] {
  return map.rooms.flatMap((r) => [...r.doors])
}

describe('D2 碰撞几何 — 谁挡什么', () => {
  it('墙全在 solids 里，一段不多一段不少', () => {
    for (const map of maps()) {
      const col = collidersOf(map, cfg)
      const walls = col.solids.filter((c) => c.kind === 'wall')
      expect(walls.length).toBe(map.walls.length)
      // 逐项对得上（不是只对数）：数目对了但换了一段墙的话，下面那条
      // 「挡板和墙不重叠」会以一种看不懂的方式挂掉
      for (const w of map.walls) {
        expect(walls.some((c) => c.rect.x === w.x && c.rect.y === w.y && c.rect.width === w.width && c.rect.height === w.height)).toBe(true)
      }
    }
  })

  it('桌椅全在 solids 里，且 kind 原样带过来', () => {
    for (const map of maps()) {
      const col = collidersOf(map, cfg)
      const furniture = col.solids.filter((c) => c.kind !== 'wall')
      const expected = map.rooms.flatMap((r) => [...r.obstacles])
      expect(furniture.length).toBe(expected.length)
      for (const o of expected) {
        expect(furniture.some((c) => c.kind === o.kind && c.rect.x === o.rect.x && c.rect.y === o.rect.y)).toBe(true)
      }
    }
  })

  it('**椅子不挡子弹**；墙与课桌挡', () => {
    for (const map of maps()) {
      const col = collidersOf(map, cfg)
      const bulletChairs = col.bulletStoppers.filter((c) => c.kind === 'chair')
      expect(bulletChairs).toEqual([])
      expect(col.bulletStoppers.filter((c) => c.kind === 'wall').length).toBe(map.walls.length)
      expect(col.bulletStoppers.filter((c) => c.kind === 'desk').length).toBe(
        map.rooms.flatMap((r) => [...r.obstacles]).filter((o) => o.kind === 'desk').length,
      )
    }
  })

  it('两个列表的差集**恰好**是椅子 —— 别处不许分岔', () => {
    for (const map of maps()) {
      const col = collidersOf(map, cfg)
      const chairs = col.solids.filter((c) => c.kind === 'chair')
      expect(col.bulletStoppers.length).toBe(col.solids.length - chairs.length)
    }
  })

  it('非战斗关别（道具关 / 宝箱关）一件家具都不进碰撞几何', () => {
    for (const map of maps().slice(0, 50)) {
      const col = collidersOf(map, cfg)
      for (const room of map.rooms) {
        if (room.obstacles.length > 0) continue
        // 空场地：它那一片区域里除了墙，不该有任何一块碰撞矩形
        const inside = col.solids.filter(
          (c) => c.kind !== 'wall' && containsPoint(room.rect, c.rect.x, c.rect.y),
        )
        expect(inside).toEqual([])
      }
    }
  })
})

describe('D2 碰撞几何 — 门挡板', () => {
  it('每块挡板都等于 doorRect(那扇门) —— 用的是同一条式子', () => {
    for (const map of maps()) {
      const col = collidersOf(map, cfg)
      for (const b of col.barriers) {
        const matched = allDoors(map).some((d) => {
          const r = doorRect(d, cfg.wallThickness)
          return r.x === b.rect.x && r.y === b.rect.y && r.width === b.rect.width && r.height === b.rect.height
        })
        expect(matched).toBe(true)
      }
    }
  })

  it('**一个洞口只出一块**：任意两块零面积相交', () => {
    for (const map of maps()) {
      const col = collidersOf(map, cfg)
      for (let i = 0; i < col.barriers.length; i++) {
        for (let j = i + 1; j < col.barriers.length; j++) {
          expect(overlapsWithArea(col.barriers[i]!.rect, col.barriers[j]!.rect)).toBe(false)
        }
      }
    }
  })

  it('几扇门就几块挡板 —— 独立数一遍洞口数对账', () => {
    for (const map of maps()) {
      const col = collidersOf(map, cfg)
      const doors = allDoors(map)
      const distinct = new Set(doors.map((d) => JSON.stringify(doorRect(d, cfg.wallThickness))))
      expect(col.barriers.length).toBe(distinct.size)
      // ⚠️ **v4 这里比的是「门数 > 挡板数」**，理由是「侧室的门在数据里记了两次、
      // 去重真的在做事」。★ v5 里它变成了**等号**：`Passage` 只剩 `{id, rect}`
      // 两个字段（走廊不是 `Room`、没有 `doors` 数组），16 扇门全部是
      // 「房间 ↔ 走廊」，每个洞口只被记一次。`colliders.ts` 文件头把这件事
      // 写成了「**今天这一条是空转的**」，两边说的是同一件事。
      //
      // v4 那句嘱咐（「哪天生成器不再重复记录门了……该做的是把重复记录的理由
      // 重新读一遍，而不是把这一句删掉」）在这里就是**照办**：去重仍然要有人证明它在做事，
      // 所以由**下面那条用例自己把重复造出来** —— 真数据里没有重复可数，
      // 那就手动塞一个。这一条只负责「数得对」。
      expect(doors.length).toBe(col.barriers.length)
    }
  })

  it('**塞一个重复的洞口进去，挡板数一块都不许多** —— 去重真的在做事', () => {
    // 上一条在 v5 里是空转的（真数据一个重复都没有），所以「按几何去重」
    // 这段代码没有任何真数据会走到它。**没人走的分支会烂掉**，
    // 而它烂掉的那天症状是「凭空多出一块看不见的墙」—— 与去重这件事毫无关联，
    // 排查的人不会想到这儿。
    //
    // 所以这里手工造出那个重复：把同一间房的第一扇门**再抄一遍**
    // （一模一样、连顺序都不变 —— `collidersOf` 就是按 `axis + 位置 + 宽` 去重的）。
    const map = maps()[0]!
    const withDup = structuredClone(map) as unknown as { rooms: { doors: unknown[] }[] }
    const host = withDup.rooms.find((r) => r.doors.length > 0)!
    host.doors.push(structuredClone(host.doors[0]))

    const before = collidersOf(map, cfg).barriers.length
    const after = collidersOf(withDup as unknown as DungeonMap, cfg).barriers.length
    expect(after, '同一洞口记了两次却出了两块挡板 —— 去重没生效').toBe(before)
    // 门**数**确实多了 —— 否则上面那句是恒真的（比如抄进了一个被忽略的地方）
    expect(allDoors(withDup as unknown as DungeonMap).length).toBe(allDoors(map).length + 1)
  })

  it('挡板**正好填住缺口**：不与任何一段墙、任何一件家具重叠', () => {
    for (const map of maps()) {
      const col = collidersOf(map, cfg)
      for (const b of col.barriers) {
        for (const w of map.walls) expect(overlapsWithArea(b.rect, w)).toBe(false)
        for (const o of map.rooms.flatMap((r) => [...r.obstacles])) {
          expect(overlapsWithArea(b.rect, o.rect)).toBe(false)
        }
      }
    }
  })

  it('**封门封得住**：每一扇门的那几格，开着是通的、关上是堵的', () => {
    // 这一条才是整件事的证明。前面几条都在看数据长得对不对，
    // 只有这一条在问「把它当成实体之后，那条路真的断了吗」。
    //
    // 口径：`gridOfMap` 是开着的那张（门是缺口），把挡板当成墙再建一张是关上的那张。
    // 两张都用**同一个** `buildGrid` —— 在这里另写一份采样就会变成「我自己说的」。
    for (const map of maps().slice(0, 20)) {
      const ext = navExtentFor(map.bounds, map.navCellSize)
      const barriers = collidersOf(map, cfg).barriers
      const shut = buildGrid({
        walls: [...map.walls, ...barriers.map((b) => b.rect)],
        obstacles: map.rooms.flatMap((r) => [...r.obstacles]),
        cellSize: map.navCellSize,
        originX: ext.originX,
        originY: ext.originY,
        width: ext.width,
        height: ext.height,
      })
      const open = gridOfMap(map)

      for (const b of barriers) {
        const cells = cellsCoveredBy(b.rect, open)
        // 至少 `门宽 / 格边长` 格：120px 的门沿墙方向必然盖住 3 个格心。
        // **这一条盯的是「偏半格」** —— 挡板要是落在两个格心之间，
        // 它一格都盖不住，于是关着也能穿过去，而数据上完全看不出毛病。
        expect(cells.length).toBeGreaterThanOrEqual(cfg.doorWidth / map.navCellSize)
        for (const { cx, cy } of cells) {
          expect(open.blocked[cy * open.cols + cx], `门开着时这一格该是通的（${cx},${cy}）`).toBe(0)
          expect(shut.blocked[cy * shut.cols + cx], `关上后这一格该是堵的（${cx},${cy}）`).toBe(1)
        }
      }
    }
  })
})

/**
 * 格心落在矩形里的那些格。与 `buildGrid` 的采样口径同一条（**只看格心**）。
 *
 * 刻意不改用 `containsPoint`：那个是**含边界**的（见它的注释），而 `buildGrid`
 * 的采样是 `px < left || px > right → 跳过` —— 也是含边界。两者一致，
 * 但**用同一套取数器**（`left` / `top` 那四个）才看得出来是一致的。
 */
function cellsCoveredBy(r: Rect, grid: NavGrid): { cx: number; cy: number }[] {
  const out: { cx: number; cy: number }[] = []
  for (let cy = 0; cy < grid.rows; cy++) {
    for (let cx = 0; cx < grid.cols; cx++) {
      const px = grid.originX + (cx + 0.5) * grid.cellSize
      const py = grid.originY + (cy + 0.5) * grid.cellSize
      if (px < left(r) || px > right(r)) continue
      if (py < top(r) || py > bottom(r)) continue
      out.push({ cx, cy })
    }
  }
  return out
}

describe('D2 碰撞几何 — 与寻路网格同口径', () => {
  it('solids 里的墙与桌椅，在寻路网格上都是堵的 —— 两处判定不许分岔', () => {
    // `walkability.ts` 文件头那条链子的两端：物理挡得住的东西，寻路也必须认为过不去。
    // 两边各推一遍就会出现「怪绕着一张桌子走、玩家撞在空气上」。
    for (const map of maps().slice(0, 20)) {
      const grid = gridOfMap(map)
      for (const c of collidersOf(map, cfg).solids) {
        const covered = cellsCoveredBy(c.rect, grid)
        // 细长的墙可能一个格心都盖不住（40px 的墙正好落在格边界之间）——
        // 那不是错，是这套「格心采样」的已知取舍，见《地牢生成设计》§五那条 ⚠️。
        if (covered.length === 0) continue
        for (const { cx, cy } of covered) {
          expect(grid.blocked[cy * grid.cols + cx]).toBe(1)
        }
      }
    }
  })
})