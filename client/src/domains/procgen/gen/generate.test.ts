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
import { parseRoomsConfig, passageClearWidth, type RoomsConfig } from '../config'
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

  it('侧室档位过滤后的分布 —— 大档没有被饿死', () => {
    // design 的 Open Question 2：档位要按 `k = 侧室宽 − roomGap ≤ 宿主宽度` 过滤，
    // 而大档侧室只有**最宽的那一档主干教室**挂得下 —— 会不会实际上几乎挑不到？
    // 实测（1000 个种子，5511 间侧室）：档 0 = 2140 / 档 1 = 2202 / 档 2 = 1169，
    // **没有被饿死**。这里钉的只是下限，不钉死具体数：调 `sideRoomTiers` 或
    // `mainWidthTiers` 是正常的平衡改动，而每次改都要来改这条测试的话，
    // 它就从「守门人」变成「噪音」了。
    const counts = new Array<number>(cfg.sideRoomTiers.length).fill(0)
    let total = 0
    for (const seed of SEEDS) {
      for (const r of sideRooms(generateDungeon(seed, cfg))) {
        counts[r.sizeTier] = (counts[r.sizeTier] ?? 0) + 1
        total++
      }
    }
    expect(total, '1000 个种子里一间侧室都没有').toBeGreaterThan(0)
    for (let t = 0; t < counts.length; t++) {
      expect(
        counts[t]! / total,
        `侧室档位分布 ${JSON.stringify(counts)}（共 ${total} 间）：档 ${t} 只被用了 ${counts[t]} 次`,
      ).toBeGreaterThan(0.1)
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
    // **主干与侧室查的不是同一张表**（见 `config.ts`）：主干只按宽度分档、
    // 高度是统一值（要与连廊等高），侧室宽高两维都取档。
    // 合成一句「尺寸等于某个档位」的话，主干教室高度被改掉也照样绿 ——
    // 而同一条带里的两条墙线正是靠这个高度重合的。
    for (const seed of SEEDS.slice(0, 100)) {
      for (const r of generateDungeon(seed, cfg).rooms) {
        if (r.branch === 'main') {
          expect(
            cfg.mainWidthTiers,
            `种子 ${seed} 主干 #${r.order} 的宽度 ${r.rect.width} 不是任何一档`,
          ).toContain(r.rect.width)
          expect(r.rect.height, `种子 ${seed} 主干 #${r.order} 的高度应是统一值`).toBe(
            cfg.mainRoomHeight,
          )
        } else {
          const hit = cfg.sideRoomTiers.some(
            (t) => t.width === r.rect.width && t.height === r.rect.height,
          )
          expect(
            hit,
            `种子 ${seed} 侧室 #${r.order} 尺寸 ${r.rect.width}×${r.rect.height} 不是任何一档`,
          ).toBe(true)
        }
        expect(r.sizeTier, `种子 ${seed} 房间 #${r.order}`).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('主干教室与连廊等价高、等底 —— 同一条带里的上下两面墙是同两条直线', () => {
    // 「等高」是侧室那面墙能一次贴合住宿主与连廊的前提（见 `layout.ts` 文件头 ①）。
    // 万一两者的 y 中心不同，症状不是报错，而是侧室的墙贴不住其中一条、露出缝 ——
    // 而缝在数据里看不出来，在游戏里是「怪从这个洞里走进教室」。
    for (const seed of SEEDS.slice(0, 100)) {
      const map = generateDungeon(seed, cfg)
      for (const p of map.passages) {
        expect(p.rect.height, `种子 ${seed} 连廊高`).toBe(cfg.mainRoomHeight)
        expect(top(p.rect), `种子 ${seed} 连廊上边`).toBe(-cfg.mainRoomHeight / 2)
        expect(p.rect.y, `种子 ${seed} 连廊中线`).toBe(0)
      }
      for (const r of mainRooms(map)) {
        expect(top(r.rect), `种子 ${seed} 主干 #${r.order} 的上边`).toBe(top(map.passages[0]!.rect))
      }
    }
  })

  it('连廊段数 = 主干数 − 1，且只夹在相邻两间之间', () => {
    // 「贯穿全层的一条走廊」也能凑出 N−1 段来（手工切一刀即可），所以数目对不算通过：
    // 还要每一段的 `between` 报出的确实是主干轴上相邻的两间。
    // 报错的症状是「门锁了，但不是该锁的那扇」—— 和「锁对了」长得一模一样。
    for (const seed of SEEDS.slice(0, 100)) {
      const map = generateDungeon(seed, cfg)
      const mains = mainRooms(map)
      expect(map.passages.length, `种子 ${seed}`).toBe(mains.length - 1)
      for (let i = 0; i < map.passages.length; i++) {
        const p = map.passages[i]!
        const ai = mains.findIndex((m) => m.order === p.between[0])
        const bi = mains.findIndex((m) => m.order === p.between[1])
        expect(ai, `种子 ${seed} 连廊 #${i} 的西端`).toBe(i)
        expect(bi, `种子 ${seed} 连廊 #${i} 的东端`).toBe(i + 1)
        // 段与段之间不重叠、按 x 从左到右 —— 缩略图与 D1 的封门都按这个顺序读
        if (i > 0) {
          expect(left(p.rect), `种子 ${seed} 连廊 #${i} 与 #${i - 1}`).toBeGreaterThan(
            right(map.passages[i - 1]!.rect),
          )
        }
      }
    }
  })

  it('侧室横跨「宿主东段 + 一整段连廊」，搭接不超宿主', () => {
    // 这条是**唯一一条新几何发明**（design 的 D 那一节），猜错的代价是整个平面结构。
    // 三段都要钉：西边界 = 宿主东边界 − 搭接；东边界 = 连廊东端；搭接 ∈ [门宽+半格, 宿主宽]。
    // 上界松一格就是侧室伸到宿主的西墙外面 —— 在缩略图上只是「侧室比教室宽一点」。
    for (const seed of SEEDS.slice(0, 100)) {
      const map = generateDungeon(seed, cfg)
      const mains = mainRooms(map)
      const minOverlap = cfg.navCellSize / 2 + cfg.doorWidth
      for (const room of sideRooms(map)) {
        const host = mains.find((m) => m.order === room.anchoredTo)!
        const overlap = right(host.rect) - left(room.rect)
        const tag = `种子 ${seed} 侧室 #${room.order}（挂 #${host.order}）`
        expect(overlap, `${tag} 的搭接长度`).toBeLessThanOrEqual(host.rect.width)
        // 下限：入口门整个落在搭接段里，否则有一半开在宿主外面 —— 几何上看不出来
        expect(overlap, `${tag} 的搭接长度`).toBeGreaterThanOrEqual(minOverlap)
        // 东边界接的是**连廊的东端**（下一间主干教室的西边界），不是连廊中间。
        // 接在这儿出口门才永远紧挨着前进门：从侧室出来的玩家一转身就看得见它。
        expect(right(room.rect), `${tag} 的东边界`).toBe(right(host.rect) + cfg.roomGap)
        expect(room.rect.width, `${tag} 的宽度`).toBe(overlap + cfg.roomGap)
      }
    }
  })

  it('每一扇门的门洞两端都落在格边界上', () => {
    // 门宽是奇数格只保证「长度是整格」，保证不了**位置**：整格宽的门摆在半个格子的
    // 偏移上，两端一样落在格中心 —— 于是实际能过的格子数比设计多一个。
    // 竖直墙上的门心偏移半格（`layout.ts` 文件头 ④）就是为了这两端。
    const cell = cfg.navCellSize
    const mod = (a: number, n: number): number => ((a % n) + n) % n
    for (const seed of SEEDS.slice(0, 100)) {
      const map = generateDungeon(seed, cfg)
      for (const room of map.rooms) {
        for (let i = 0; i < room.doors.length; i++) {
          const d = room.doors[i]!
          const along = d.axis === 'h' ? d.x : d.y
          const origin = d.axis === 'h' ? map.navOrigin.x : map.navOrigin.y
          const tag = `种子 ${seed} #${room.order} 的 doors[${i}]（${d.kind}/${d.axis}）`
          expect(mod(along - d.width / 2 - origin, cell), `${tag} 的门洞西/北端`).toBe(0)
          expect(mod(along + d.width / 2 - origin, cell), `${tag} 的门洞东/南端`).toBe(0)
        }
      }
    }
  })

  it('侧室的挂靠侧随种子变，不是按宿主序号交替', () => {
    // 交替（奇偶决定上下）是个很像设计、却会让「随机刷新」看着像花纹的实现。
    // 两条都要钉，因为它们抓的是不同的坏法：
    // ① 同一个锚点在不同种子上必须两侧都出现过 —— 抓「按锚点序号定侧」
    // ② 同一张图里两个锚点可以同侧 —— 抓「按序号奇偶交替」
    let north = 0
    let south = 0
    let sameSidedMapSeen = false
    for (const seed of SEEDS.slice(0, 400)) {
      const byAnchor = new Map<number, number>()
      for (const room of sideRooms(generateDungeon(seed, cfg))) {
        const band = room.rect.y < 0 ? -1 : 1
        byAnchor.set(room.anchoredTo!, band)
        if (room.anchoredTo === 0) {
          if (band < 0) north++
          else south++
        }
      }
      const bands = [...byAnchor.values()]
      if (bands.length >= 2 && new Set(bands).size === 1) sameSidedMapSeen = true
    }
    expect(north, '锚在主干 #0 上的侧室：一次都没挂到北侧').toBeGreaterThan(0)
    expect(south, '锚在主干 #0 上的侧室：一次都没挂到南侧').toBeGreaterThan(0)
    expect(sameSidedMapSeen, '一整批图里都没出现「两个锚点同侧」—— 像是按序号交替').toBe(true)
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

  it('难度档位不参与几何 —— 三档难度同种子产出逐项相同的地图', () => {
    // 生成器签名里就没有难度参数（`(seed, cfg, now?)`），所以「同一颗种子在
    // 三档难度下产出同一张图」在调用侧**不可能被破坏**。
    //
    // 那这条断言的力气花在哪儿？**花在两件会真的坏掉的事上**：
    //
    // ① `DungeonMap` 里冒出一个难度字段（比如为了「困难模式多放几张桌子」）
    // ② `RoomsConfig` 里冒出一个从 `difficulty.json` 派生的字段
    //    （比如把 `enemyCount` 乘进 `obstacleDensityMax`）
    //
    // 两条都是**悄悄**发生的：地图和配置都能照常跑，只有难度一调，
    // 几何跟着变 —— 而那正是「难度只乘在预算 → 刷怪那一步」这条约定的反面。
    // 所以难度档位的名字从**真文件**里读，不在这里另写一份。
    const diffRaw = JSON.parse(readFileSync(CONFIG_DIR + 'difficulty.json', 'utf8')) as {
      difficulties: Record<string, Record<string, number>>
    }
    const ids = Object.keys(diffRaw.difficulties)
    expect(ids.length, '难度档位至少要有三档').toBeGreaterThanOrEqual(3)

    // 三档下拿的是**同一份 cfg**，所以三张图逐项相同 —— 它们必须是同一个对象级别相等
    const ref = JSON.stringify(generateDungeon(SEEDS[0]!, cfg))
    for (const id of ids) {
      expect(JSON.stringify(generateDungeon(SEEDS[0]!, cfg)), `难度 ${id}`).toBe(ref)
    }

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
    const bannedMapKeys = ['difficulty', 'difficultyId', 'tier', 'mode']
    for (const b of bannedMapKeys) {
      expect([...keys], `DungeonMap 里不该出现 "${b}" —— 难度只乘在"预算 → 刷怪"那一步`).not.toContain(b)
    }
    // 反向：配置里也不许出现难度派生的字段名（含难度档位的 id 本身）
    const bannedCfgKeys = [...Object.keys(diffRaw.difficulties), ...Object.keys(diffRaw.difficulties[ids[0]!]!)]
    for (const b of bannedCfgKeys) {
      expect(Object.keys(cfg), `rooms.json 里不该出现 "${b}" —— 那是难度侧的旋钮`).not.toContain(b)
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

  it('每一段连廊的实测净宽 = mainRoomHeight − wallThickness', () => {
    // 这个数是**量出来的**（从连廊中线那一列上下数格），不是照配置抄的 ——
    // 两者不是一个数：`Passage.rect` 含墙，可走的是里面那一条。
    // 量错过一次（数着数着穿过侧室的出口门走进侧室，240 的连廊报成 520），
    // 所以这里钉的是**实测值**：改坏了，红的是这条，而不是等着人去看读数。
    for (const seed of SEEDS.slice(0, 100)) {
      const map = generateDungeon(seed, cfg)
      const r = checkReachability(map, cfg)
      expect(r.passageClearWidths.length, `种子 ${seed}`).toBe(map.passages.length)
      for (let i = 0; i < r.passageClearWidths.length; i++) {
        expect(r.passageClearWidths[i], `种子 ${seed} 连廊 #${i} 的净宽`).toBe(passageClearWidth(cfg))
      }
    }
  })

  it('最窄窄口（连廊净宽与每一扇门取小）≥ minPassageWidth', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const map = generateDungeon(seed, cfg)
      const r = checkReachability(map, cfg)
      expect(r.narrowestOpeningWidth, `种子 ${seed}`).toBeGreaterThanOrEqual(cfg.minPassageWidth)
      // 反过来也要钉：读数不能是「随手量到的最小值」—— 窄口就那么两处，
      // 报出比它俩更小的数说明量到别的地方去了（比如把墙里那一格数进去了）。
      const narrowest = Math.min(passageClearWidth(cfg), cfg.doorWidth)
      expect(r.narrowestOpeningWidth, `种子 ${seed}`).toBe(narrowest)
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
    passages: { rect: MutRect; between: number[] }[]
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

  it('连廊被拦腰切断 —— 实测净宽为 0，层 1 也抓得住', () => {
    const m = broken(SEED, (x) => {
      // 在**第一段**连廊正中间竖一道墙：宽两格、高 = 整条带高。
      //
      // 为什么不能只横一道「一格厚」的墙（首版那条负样本就是这么写的）：
      // 竖直墙上的门洞是 **3 格高**（`doorWidth` 120 = 3 格），而 40px 厚的墙
      // 只盖住中间那 2 格 —— 门洞最上面那一格还是通的，flood fill 从那里挤过去，
      // **一段被切断的连廊照样判绿**。这不是假设，是照着写的版本跑出来的。
      // 高 = `mainRoomHeight` 才能在带内把所有行都盖住。
      //
      // 这一条同时是 `floodWithin`（限定在连廊矩形里走）的存在理由：
      // 不限定范围的话，从西端的门出去可以绕「教室 → 别的门 → 整层楼 → 东端的门」，
      // 一段断掉的连廊会被判绿 —— 而这条负样本正卡在它上面。
      const p = x.passages[0]!.rect
      x.walls.push({
        x: p.x,
        y: p.y,
        width: cfg.navCellSize * 2,
        height: cfg.mainRoomHeight,
      })
    })
    const r = checkReachability(m, cfg)
    const text = r.problems.join('\n')
    // 层 1：这一段自己走不通。报的是**哪一段**（`between` 报出的两间房）
    expect(text).toContain('连廊 #0')
    expect(text).toContain('堵死')
    expect(r.layer1Ok).toBe(false)
    // 层 2：窄口读数跟着掉到 0，并给出配置里的下限
    expect(text).toContain(`${cfg.minPassageWidth}px`)
    expect(r.passageClearWidths[0]).toBe(0)
    expect(r.narrowestOpeningWidth).toBe(0)
    // 其余的连廊不受影响 —— 堵一段不是"全层都堵"
    expect(r.passageClearWidths.slice(1).every((w) => w === passageClearWidth(cfg))).toBe(true)
  })

  it('连廊被整段填实 —— 抓得住"这一段根本进不去"', () => {
    // 上一条切的是「进得去、出不来」。这一条填的是**整个**连廊矩形，
    // 于是连"西端门外那一格"都站不住 —— 是另一条分支，另一句报错。
    // 两条分开写，是为了让「报出来的话指向真正的症状」这件事也被测到：
    // 合成一句「连廊有问题」的话，看的人得自己去分辨是堵了还是没了。
    const m = broken(SEED, (x) => {
      const p = x.passages[0]!.rect
      x.walls.push({ x: p.x, y: p.y, width: p.width, height: p.height })
    })
    const r = checkReachability(m, cfg)
    const text = r.problems.join('\n')
    expect(text).toContain('连廊 #0')
    expect(text).toContain('进不去')
    expect(r.layer1Ok).toBe(false)
    expect(r.passageClearWidths[0]).toBe(0)
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