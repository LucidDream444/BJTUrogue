/**
 * 生成器的自动化验收。**跑在 node 环境**（`vite.config.ts` 钉死的）——
 * 不加载 Phaser、不碰 DOM。需要 jsdom 就说明逻辑没和表现层分开。
 *
 * ---
 *
 * 配置是**读真文件**（`public/config/rooms.json`），不是测试里另捏一份。
 * 捏一份的话，真正的配置表可以错得离谱而全绿 ——
 * `core/config.contract.test.ts` 用的是同一个手法，理由也一样。
 *
 * 种子集合**写死**（`SEEDS`），不用随机数：失败要能复跑，
 * 「上次跑挂了一个」如果连是哪几个种子都不知道，报告就没有用。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { generateDungeon } from './generate'
import { parseRoomsConfig, type RoomsConfig } from '../config'
import { validateContract } from '../validate/contract'
import { assertReachable, checkReachability } from '../validate/reachability'
import { gridOfMap } from '../walkability'
import type { DungeonMap, Rect } from '../model/types'
import { mainRooms, sideRooms } from '../model/types'
import { left, right, top, bottom } from '../model/rect'

const CONFIG_DIR = fileURLToPath(new URL('../../../../public/config/', import.meta.url))

function readRooms(): RoomsConfig {
  return parseRoomsConfig(JSON.parse(readFileSync(CONFIG_DIR + 'rooms.json', 'utf8')))
}

const cfg = readRooms()

/** 批量扫描用的种子。**写死**，见文件头。 */
const SEEDS = Array.from({ length: 1000 }, (_, i) => i * 7919 + 13)

describe('D2 生成器 — 确定性与可复现', () => {
  it('同种子两次生成深度相等', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const a = generateDungeon(seed, cfg)
      const b = generateDungeon(seed, cfg)
      expect(b, `种子 ${seed}`).toEqual(a)
    }
  })

  it('不同种子会产出不同的图（否则"种子"是假的）', () => {
    const shapes = new Set(SEEDS.slice(0, 40).map((s) => JSON.stringify(generateDungeon(s, cfg))))
    // 40 个种子里至少要有 35 种不同的图。要求 40 个全不同是过强的断言：
    // 主干数只有 4 个取值、侧室挂载点组合也有限，撞图是正常的。
    expect(shapes.size).toBeGreaterThanOrEqual(35)
  })

  it('单点复跑：种子 837 连跑两次是同一张图', () => {
    expect(generateDungeon(837, cfg)).toEqual(generateDungeon(837, cfg))
  })

  it('elapsedMs 是唯一的例外 —— 换时钟不改地图', () => {
    const noClock = generateDungeon(12345, cfg)
    let t = 1000
    const fake = () => (t += 7)
    const withClock = generateDungeon(12345, cfg, fake)

    expect(withClock.elapsedMs).toBeGreaterThan(0)
    expect({ ...withClock, elapsedMs: 0 }).toEqual({ ...noClock, elapsedMs: 0 })
    expect(noClock.elapsedMs).toBe(0)
  })
})

describe('D2 生成器 — 房间数量与节奏', () => {
  it('任何种子的房间总数都是 15', () => {
    for (const seed of SEEDS.slice(0, 200)) {
      expect(generateDungeon(seed, cfg).rooms.length, `种子 ${seed}`).toBe(cfg.totalRooms)
    }
  })

  it('主干数落在 [8, 11] 且至少出现两个取值', () => {
    const counts = new Set<number>()
    for (const seed of SEEDS) {
      const n = mainRooms(generateDungeon(seed, cfg)).length
      expect(n, `种子 ${seed}`).toBeGreaterThanOrEqual(cfg.mainRoomMin)
      expect(n, `种子 ${seed}`).toBeLessThanOrEqual(cfg.mainRoomMax)
      counts.add(n)
    }
    expect(counts.size).toBeGreaterThanOrEqual(2)
  })

  it('侧室数 = 15 − 主干数，落在 4—7', () => {
    for (const seed of SEEDS.slice(0, 200)) {
      const map = generateDungeon(seed, cfg)
      const main = mainRooms(map).length
      const side = sideRooms(map).length
      expect(main + side, `种子 ${seed}`).toBe(cfg.totalRooms)
      expect(side, `种子 ${seed}`).toBeGreaterThanOrEqual(cfg.totalRooms - cfg.mainRoomMax)
      expect(side, `种子 ${seed}`).toBeLessThanOrEqual(cfg.totalRooms - cfg.mainRoomMin)
    }
  })

  it('末间恒为 boss，且不在侧室里', () => {
    for (const seed of SEEDS.slice(0, 200)) {
      const map = generateDungeon(seed, cfg)
      const last = map.rooms[map.rooms.length - 1]!
      expect(last.kind, `种子 ${seed}`).toBe('boss')
      expect(last.branch, `种子 ${seed}`).toBe('main')
    }
  })

  it('末间预算与主干数无关（N=8 与 N=11 的末间一样强）', () => {
    let boss8: number | null = null
    let boss11: number | null = null
    for (const seed of SEEDS) {
      const map = generateDungeon(seed, cfg)
      const mains = mainRooms(map)
      if (mains.length === 8 && boss8 === null) boss8 = mains[mains.length - 1]!.budget
      if (mains.length === 11 && boss11 === null) boss11 = mains[mains.length - 1]!.budget
      if (boss8 !== null && boss11 !== null) break
    }
    expect(boss8).not.toBeNull()
    expect(boss11).not.toBeNull()
    expect(boss11).toBe(boss8)
  })

  it('预算沿主干轴单调不减', () => {
    for (const seed of SEEDS.slice(0, 200)) {
      const budgets = mainRooms(generateDungeon(seed, cfg)).map((r) => r.budget)
      for (let i = 1; i < budgets.length; i++) {
        expect(budgets[i]!, `种子 ${seed} 第 ${i} 间`).toBeGreaterThanOrEqual(budgets[i - 1]!)
      }
    }
  })
})

describe('D2 生成器 — 几何契约', () => {
  it('每种种子都通过契约校验', () => {
    for (const seed of SEEDS) {
      const map = generateDungeon(seed, cfg)
      expect(() => validateContract(map, cfg), `种子 ${seed}`).not.toThrow()
    }
  })

  it('房间尺寸完全等于某个档位，没有中间尺寸', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      for (const r of generateDungeon(seed, cfg).rooms) {
        const hit = cfg.sizeTiers.some((t) => t.width === r.rect.width && t.height === r.rect.height)
        expect(hit, `种子 ${seed} 房间 #${r.order} 尺寸 ${r.rect.width}×${r.rect.height}`).toBe(true)
      }
    }
  })

  it('所有房间都是轴对齐矩形且互相不重叠', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const rooms = generateDungeon(seed, cfg).rooms
      for (let i = 0; i < rooms.length; i++) {
        const a = rooms[i]!.rect
        expect(a.width, `种子 ${seed}`).toBeGreaterThan(0)
        expect(a.height, `种子 ${seed}`).toBeGreaterThan(0)
        for (let j = i + 1; j < rooms.length; j++) {
          const b = rooms[j]!.rect
          const overlap =
            left(a) < right(b) && left(b) < right(a) && top(a) < bottom(b) && top(b) < bottom(a)
          expect(overlap, `种子 ${seed}：#${i} 与 #${j} 重叠`).toBe(false)
        }
      }
    }
  })

  it('难度档位不参与几何 —— 地图里没有任何难度字段', () => {
    // 生成器签名里就没有难度参数（`(seed, cfg, now?)`），所以「同一颗种子在
    // 三档难度下产出同一张图」在调用侧**不可能被破坏**。真正可能被破坏的是
    // 反向的那件事：将来有人为了「困难模式多放几张桌子」给 `DungeonMap`
    // 加一个难度字段。那时这条会红，而红的位置正是要拦下来的地方。
    const banned = ['difficulty', 'difficultyId', 'tier', 'mode']
    const keys = new Set<string>()
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk)
      if (v === null || typeof v !== 'object') return
      for (const [k, child] of Object.entries(v)) {
        keys.add(k)
        walk(child)
      }
    }
    walk(generateDungeon(SEEDS[0]!, cfg))
    for (const b of banned) {
      expect([...keys], `DungeonMap 里不该出现 "${b}" —— 难度只乘在"预算 → 刷怪"那一步`).not.toContain(b)
    }
  })
})

describe('D2 生成器 — 可达性（硬性验收标准）', () => {
  it('1000 个种子两层全绿', () => {
    const failures: string[] = []
    for (const seed of SEEDS) {
      const map = generateDungeon(seed, cfg)
      try {
        assertReachable(map, cfg)
      } catch (e) {
        failures.push(String(e))
      }
    }
    expect(failures.slice(0, 5).join('\n')).toBe('')
  })

  it('走廊实测可走宽度 ≥ corridorMinWidth', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const map = generateDungeon(seed, cfg)
      const r = checkReachability(map, cfg)
      expect(r.corridorWalkableWidth, `种子 ${seed}`).toBeGreaterThanOrEqual(cfg.corridorMinWidth)
    }
  })

  it('校验路径与运行时路径对同一坐标判定相同', () => {
    // 两条路径指的是：`checkReachability` 用的 `gridOfMap`，
    // 与运行时 D3 会注入给 FlowField 的 `buildWalkability`。
    // 两者必须读同一个 `navCellSize` / `navOrigin`，否则"同一份判定"只是名字相同。
    for (const seed of SEEDS.slice(0, 30)) {
      const map = generateDungeon(seed, cfg)
      const grid = gridOfMap(map)
      expect(grid.cellSize, `种子 ${seed}`).toBe(map.navCellSize)
      expect(grid.originX, `种子 ${seed}`).toBe(map.navOrigin.x)
      expect(grid.originY, `种子 ${seed}`).toBe(map.navOrigin.y)
    }
  })

  it('每个出生点都落在格中心上、且不被障碍物盖住', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const map = generateDungeon(seed, cfg)
      const grid = gridOfMap(map)
      for (const room of map.rooms) {
        for (const p of room.spawnPoints) {
          const cx = Math.floor((p.x - grid.originX) / grid.cellSize)
          const cy = Math.floor((p.y - grid.originY) / grid.cellSize)
          expect(grid.blocked[cy * grid.cols + cx], `种子 ${seed} 房间 #${room.order}`).toBe(0)
        }
      }
    }
  })

  it('每间房都有出生点 —— 空房 = 清不掉 = 整局作废', () => {
    for (const seed of SEEDS.slice(0, 200)) {
      for (const room of generateDungeon(seed, cfg).rooms) {
        expect(room.spawnPoints.length, `种子 ${seed} 房间 #${room.order}`).toBeGreaterThan(0)
      }
    }
  })
})

describe('D2 校验器 — 负样本（证明它不是永远通过）', () => {
  // 一个从来不会失败的校验器和一个没有校验器，在测试报告上长得一模一样。
  // 这一组把**每一类**检查各弄坏一次，要求它红、且红在正确的位置上。
  type AnyRec = Record<string, unknown>
  type MutRect = { x: number; y: number; width: number; height: number }
  type LooseMap = {
    rooms: AnyRec[]
    walls: AnyRec[]
    corridorRect: MutRect
    navCellSize: number
    navOrigin: { x: number; y: number }
    schemaVersion: number
    bounds: MutRect
    seed: number
  }

  const broken = (seed: number, mangle: (m: LooseMap) => void): DungeonMap => {
    const m = structuredClone(generateDungeon(seed, cfg)) as unknown as LooseMap
    mangle(m)
    return m as unknown as DungeonMap
  }

  const expectFails = (
    map: DungeonMap,
    pathPart: string,
    messagePart: string,
    withCfg: RoomsConfig = cfg,
  ): void => {
    let caught: Error | null = null
    try {
      validateContract(map, withCfg)
    } catch (e) {
      caught = e as Error
    }
    expect(caught, `本该被拒（期望命中 ${pathPart}）`).not.toBeNull()
    expect(caught!.message).toContain(pathPart)
    expect(caught!.message).toContain(messagePart)
  }

  const SEED = SEEDS[0]!

  it('枚举外的 kind 被拒，并列出合法取值', () => {
    const m = broken(SEED, (x) => {
      x.rooms[3]!.kind = 'library'
    })
    expectFails(m, 'rooms[3].kind', '合法取值')
  })

  it('房间总数不对被拒', () => {
    const m = broken(SEED, (x) => {
      x.rooms.pop()
    })
    expectFails(m, 'rooms', '房间总数')
  })

  it('主干数超出 [8, 11] 被拒', () => {
    const m = broken(SEED, (x) => {
      // 把一间主干改成侧室 —— 主干数掉到 7，同时侧室数涨到 8
      const victim = x.rooms.find((r) => r.branch === 'main' && r.kind === 'main')!
      victim.branch = 'side'
    })
    expectFails(m, 'rooms', '主干教室数')
  })

  it('末间不是 boss 被拒', () => {
    const m = broken(SEED, (x) => {
      x.rooms[x.rooms.length - 1]!.kind = 'main'
    })
    expectFails(m, `rooms[${m.rooms.length - 1}].kind`, "应是 'boss'")
  })

  it('走廊被堵死 —— 实测宽度不足被拒，且给出实际值', () => {
    const cell = cfg.navCellSize
    const m = broken(SEED, (x) => {
      // 在走廊正中间横一道整格高的墙 —— 可走宽度实测出来就是 0
      x.walls.push({
        x: x.corridorRect.x,
        y: x.corridorRect.y,
        width: x.corridorRect.width,
        height: cell,
      })
    })
    const r = checkReachability(m, cfg)
    const text = r.problems.join('\n')
    expect(text).toContain('走廊实测可走宽度')
    expect(text).toContain(`${cfg.corridorMinWidth}px`)
    expect(r.corridorWalkableWidth).toBe(0)
  })

  it('障碍物没按格对齐被拒', () => {
    const m = broken(SEED, (x) => {
      const room = x.rooms.find((r) => (r.obstacles as AnyRec[]).length > 0)!
      const o = (room.obstacles as AnyRec[])[0]!
      o.rect = { ...(o.rect as Rect), x: (o.rect as Rect).x + 7 }
    })
    expectFails(m, 'obstacles[0]', '格边界')
  })

  it('课桌短边不统一被拒', () => {
    const m = broken(SEED, (x) => {
      const room = x.rooms.find((r) =>
        (r.obstacles as AnyRec[]).some((o) => o.kind === 'desk'),
      )!
      const desk = (room.obstacles as AnyRec[]).find((o) => o.kind === 'desk')!
      const r = desk.rect as Rect
      desk.rect = { x: r.x, y: r.y, width: r.width, height: cfg.navCellSize * 2 }
    })
    expect(() => validateContract(m, cfg)).toThrow()
  })

  it('门口被堵死 —— 层 2 抓得住（这是墙厚=1 格时真正会红的那条）', () => {
    const cell = cfg.navCellSize
    const m = broken(SEED, (x) => {
      const room = x.rooms.find((r) => (r.doors as AnyRec[]).length > 0)!
      const door = (room.doors as AnyRec[])[0]! as { x: number; y: number; axis: string; width: number }
      const r = room.rect as Rect
      const inward = door.axis === 'h' ? Math.sign(r.y - door.y) || 1 : Math.sign(r.x - door.x) || 1

      // 门内侧**第一格**那一行，用椅子铺满整个门洞宽度。
      // 注意这是"往里退**整格**"：门在墙的中线上，而墙本身占掉一整格
      // （格心在墙上），所以内侧第一格的心在 `门心 + 一格`。
      const along0 = (door.axis === 'h' ? door.x : door.y) - door.width / 2 + cell / 2
      const depth = (door.axis === 'h' ? door.y : door.x) + inward * cell
      for (let i = 0; i < door.width / cell; i++) {
        const along = along0 + i * cell
        const rect: Rect =
          door.axis === 'h'
            ? { x: along, y: depth, width: cell, height: cell }
            : { x: depth, y: along, width: cell, height: cell }
        ;(room.obstacles as AnyRec[]).push({ kind: 'chair', rect })
      }
    })
    const r = checkReachability(m, cfg)
    expect(r.layer2Ok).toBe(false)
    expect(r.problems.join('\n')).toContain('内侧')
    expect(r.problems.join('\n')).toContain('进不来')
  })

  it('障碍物与门矩形重叠被拒（要更厚的墙才构造得出来）', () => {
    // ⚠️ **这条分支在墙厚 = 1 格时是不可达的**，不是漏测：
    //    门矩形恰好占满墙所在的那一格，而格对齐、又在房间内的障碍物
    //    只能与它**共边**，不能与它按面积重叠。所以现实里会红的是上面
    //    那条层 2 的"门口被堵死"。
    //    换个更厚的墙（2 格）这条结构性检查就能触发 —— 它防的是
    //    `wallThickness` 被调大之后没人再想起这件事。
    const thickCfg = { ...cfg, wallThickness: cfg.navCellSize * 2 }
    const cell = cfg.navCellSize
    const m = broken(SEED, (x) => {
      const room = x.rooms.find((r) => (r.doors as AnyRec[]).length > 0)!
      const door = (room.doors as AnyRec[])[0]! as { x: number; y: number; axis: string }
      const inward = Math.sign((room.rect as Rect).y - door.y) || 1
      const rect: Rect =
        door.axis === 'h'
          ? { x: door.x, y: door.y + inward * cell, width: cell * 3, height: cell }
          : { x: door.x + inward * cell, y: door.y, width: cell, height: cell * 3 }
      ;(room.obstacles as AnyRec[]).push({ kind: 'desk', rect })
    })
    expectFails(m, '挡住了', '堵在门口', thickCfg)
  })

  it('出生点被围死 —— 层 2 抓得住，且报出坐标', () => {
    const m = broken(SEED, (x) => {
      const room = x.rooms.find(
        (r) => (r.spawnPoints as unknown[]).length > 0 && r.branch === 'main',
      )!
      const p = (room.spawnPoints as { x: number; y: number }[])[0]!
      const grid = gridOfMap(x as unknown as DungeonMap)
      const cell = cfg.navCellSize
      const cx = Math.floor((p.x - grid.originX) / cell)
      const cy = Math.floor((p.y - grid.originY) / cell)

      // 把出生点**四邻**各放一把椅子 —— 出生点那一格**本身留着空**。
      // 这是刻意的：盖住出生点会先命中"被障碍物盖住"那条分支，
      // 而这条要验的是 spec 的核心 Scenario ——「从门走不到」。
      const at = (gx: number, gy: number): Rect => ({
        x: grid.originX + (gx + 0.5) * cell,
        y: grid.originY + (gy + 0.5) * cell,
        width: cell,
        height: cell,
      })
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        ;(room.obstacles as AnyRec[]).push({ kind: 'chair', rect: at(cx + dx!, cy + dy!) })
      }
    })
    const result = checkReachability(m, cfg)
    expect(result.layer2Ok).toBe(false)
    expect(result.problems.join('\n')).toContain('走不到')
    // spec 要求：失败时报出**种子、房间序号、出生点坐标**
    expect(result.problems.join('\n')).toMatch(/#\d+ 的出生点 \(\d/)
    let thrown: Error | null = null
    try {
      assertReachable(m, cfg)
    } catch (e) {
      thrown = e as Error
    }
    expect(thrown!.message).toContain(`种子 ${SEED}`)
  })

  it('界外的 kind 值被拒 —— 运行期数据没经过编译器，这一层要拦住', () => {
    const m = broken(SEED, (x) => {
      x.rooms[0]!.kind = 'side' // 曾经的方案：把"侧室"塞进 kind —— 现在它不是合法类型
    })
    expectFails(m, 'rooms[0].kind', '不是合法类型')
  })

  it('schemaVersion 对不上被拒（迁移必须显式做）', () => {
    const m = broken(SEED, (x) => {
      x.schemaVersion = 99
    })
    expectFails(m, 'schemaVersion', '迁移要显式写出来')
  })
})

describe('D2 生成器 — 耗时', () => {
  it('1000 次生成没有长尾（单次最慢 < 50ms）', () => {
    const worst = { seed: -1, ms: 0 }
    let total = 0
    for (const seed of SEEDS) {
      const t0 = performance.now()
      generateDungeon(seed, cfg)
      const ms = performance.now() - t0
      total += ms
      if (ms > worst.ms) {
        worst.seed = seed
        worst.ms = ms
      }
    }
    // 上限取 50ms 而不是"平均 2ms ×1.5"：生成发生在开屏/换层，
    // 而换层时玩家正盯着屏幕。有上限**且报出是哪个种子**，
    // 报告才是能查的 —— 单说"超时了"没法复跑。
    expect(worst.ms, `最慢的是种子 ${worst.seed}，${worst.ms.toFixed(1)}ms；1000 次共 ${total.toFixed(0)}ms`).toBeLessThan(50)
  })

  it('耗时读数是真的（不传时钟时为 0，传了就有值）', () => {
    expect(generateDungeon(1, cfg).elapsedMs).toBe(0)
    const map = generateDungeon(1, cfg, () => performance.now())
    expect(map.elapsedMs).toBeGreaterThanOrEqual(0)
  })
})