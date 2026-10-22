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
 *
 * ---
 *
 * ## ★ v5（平面图落地）把这一份**拆掉了一半**
 *
 * v4 的验收标准里有一大半是**几何**的：房间尺寸等于哪一档、主干与连廊等高等底、
 * 连廊段数 = 主干数 − 1、侧室横跨「宿主东段 + 一整段连廊」、侧室挂靠哪一侧、
 * 侧室档位分布…… 那些题在这一版**整组作废**了。
 *
 * ⚠️ 作废的意思是**它们描述的东西不存在了**，不是「换个写法还能测」：
 * 几何现在写在 `public/config/floor-plan.json` 里（照 6F 平面图照片量出来的格坐标），
 * 而且**与种子无关** —— `plan.bounds` 恒为 10520×2920，1000 个种子一共只有一张图。
 * 拿种子去扫几何，扫的是一份读一千遍的常量。
 *
 * 于是这一份的题目收窄成一句话：**只管「与种子有关的那一半」** ——
 * 关别、桌椅、刷怪点、威胁预算。几何那一半搬到了：
 *
 * | 那一半 | 谁盯 |
 * |---|---|
 * | 平面图解析、格坐标自洽、门与空间对得上 | `gen/floorPlan.test.ts` |
 * | 画出来对不对（缩略图 / 全图 / 标签 / 取景） | `presentation/*.test.ts` |
 * | **几何一个字都不随种子动** | **本文档**「几何不受关别影响」那一组 |
 * | 手里这份 map 自不自洽（含存档 / 手写夹具） | `validate/contract.ts`（由本文档的负样本组驱动） |
 *
 * ## 因此 `generateDungeon` 多了第三个参数
 *
 * `generateDungeon(seed, cfg, plan, now?)` —— 几何与内容分了家：
 * `plan` 说「房子在哪儿」，`seed` 说「屋里装什么」。下面每一处调用都要带上它。
 *
 * ⚠️ **`SEEDS` 这一列种子今天是「穷举」而不是「抽样」。** v5 的变化量只有关别 / 桌椅 /
 * 刷怪点三样，所以扫 1000 个种子仍然有意义（它扫的是关别分配的分布与桌椅的排布），
 * 但想清楚「这条用例在扫什么」比 v4 那时更要紧 —— 写错了不会红，只会白跑。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { generateDungeon } from './generate'
import { parseRoomsConfig, isCombatKind, type RoomsConfig } from '../config'
import { validateContract } from '../validate/contract'
import { assertReachable, checkReachability } from '../validate/reachability'
import { gridOfMap } from '../walkability'
import type { DungeonMap, Rect } from '../model/types'
import { ROOM_KINDS, ROOM_KIND_LABELS, type RoomKind } from '../model/types'
import { left, right, top, bottom } from '../model/rect'
import { chairBelongsTo, countObstacles, furnitureUnits } from '../model/furniture'
import { placeObstacles } from './obstacles'
import type { Room } from '../model/types'
import { parseFloorPlan, type FloorPlan } from './floorPlan'
import { kindBag } from './layout'
import { progressT, threatBudgetAt } from './budget'

const CONFIG_DIR = fileURLToPath(new URL('../../../../public/config/', import.meta.url))

const readJson = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(CONFIG_DIR + name, 'utf8')) as Record<string, unknown>

function readRooms(): RoomsConfig {
  return parseRoomsConfig(readJson('rooms.json'))
}

const cfg = readRooms()

/**
 * 整层楼的几何 —— 与**种子无关**（`floor-plan.json` 里写死的 6F 平面图）。
 *
 * 解析一次、1000 个种子共用一份：放进循环里就是同一份表读 1000 遍，
 * 而它一次都不会变（见文件头）。
 *
 * ⚠️ 产品里**第 1 层不是这一张**（逸夫楼 3F，见 `floor-plan-yf3.json`）。
 * 这里固定用 6F 是因为这一批用例的期望值（`YF604` 是首领、16 间房）都是照着
 * 它写的；两层各有一组用例，跨层的那些在 `floors.test.ts`。
 */
const plan: FloorPlan = parseFloorPlan(readJson('floor-plan.json'), cfg)

/** 批量扫描用的种子。**写死**，见文件头。 */
const SEEDS = Array.from({ length: 1000 }, (_, i) => i * 7919 + 13)

/** 平面图上**写死了关别**的那些房间（`YF604` 是 boss，两间教休室是 reward）。 */
const FIXED = plan.rooms.filter((r) => r.fixed !== null)

describe('D2 生成器 — 确定性与可复现', () => {
  it('同种子两次生成深度相等', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const a = generateDungeon(seed, cfg, plan)
      const b = generateDungeon(seed, cfg, plan)
      expect(b, `种子 ${seed}`).toEqual(a)
    }
  })

  it('不同种子会产出不同的图（否则"种子"是假的）', () => {
    const shapes = new Set(
      SEEDS.slice(0, 40).map((s) => JSON.stringify(generateDungeon(s, cfg, plan))),
    )
    // ⚠️ v4 这里只要 35/40，理由写在当时：「主干数只有 4 个取值、侧室挂载点组合也有限，
    // 撞图是正常的」。那句话在 v5 **不成立了** —— 几何不再随种子变，可变的是
    // 关别分配 × 桌椅位置 × 刷怪点，熵比 v4 大得多（v4 还要为「同一种子撞图」辩护）。
    //
    // 所以这里跟着收紧到 40/40。**这不是好胜**：v4 那条 35 的下限本身是「几何也在摇」
    // 的产物，而今天几何那一份熵没了，留一个宽松的下限会让「种子其实没接上」
    // （比如 `rngFor` 的域参数被写死）过得去。
    expect(shapes.size, '40 个种子里有撞图的').toBe(40)
  })

  it('单点复跑：种子 837 连跑两次是同一张图', () => {
    expect(generateDungeon(837, cfg, plan)).toEqual(generateDungeon(837, cfg, plan))
  })

  it('elapsedMs 是唯一的例外 —— 换时钟不改地图', () => {
    const noClock = generateDungeon(12345, cfg, plan)
    let t = 1000
    const fake = (): number => (t += 7)
    // ⚠️ 时钟是**第四个**参数：第三个位置在 v5 归了 `plan`。写错位置时
    // `plan` 收到一个函数，生成器会去读 `plan.bounds.width` 然后拿到 `undefined`
    // —— 那时报的是「地图尺寸是 NaN」，不是「参数传错了」。
    const withClock = generateDungeon(12345, cfg, plan, fake)

    expect(withClock.elapsedMs).toBeGreaterThan(0)
    expect({ ...withClock, elapsedMs: 0 }).toEqual({ ...noClock, elapsedMs: 0 })
    expect(noClock.elapsedMs).toBe(0)
  })
})

describe('D2 生成器 — 房间构成', () => {
  it('任何种子的房间总数都等于平面图声明的 16（15 间编号教室 + 1 间楼梯间）', () => {
    for (const seed of SEEDS.slice(0, 200)) {
      const map = generateDungeon(seed, cfg, plan)
      // ⚠️ **对照项是 `plan.roomTotal`，不是某个全局常量**（★ 改了 2026-10-22）：
      // 「这一层几间房」随层走（6F 十六、YF3 十五），它写在平面图里。
      // 楼梯间**算在里面** —— `map.rooms` 里它是一间房（出生点在里面，
      // 打完首领下楼的入口也在里面）；照「编号教室数」去查会得出
      // 「实际 16 ≠ 应为 15」这种看着合理的假警，而修法是把楼梯间删掉。
      expect(map.rooms.length, `种子 ${seed}`).toBe(plan.roomTotal)
    }
  })

  it('楼梯间恒为第一间，且全层只有它一间 start', () => {
    // `order` 是显示序，不是进度轴 —— 但**「楼梯间在下标 0」这条是构造出来的**：
    // 出生点必须有唯一确定的答案。两间 start 意味着「玩家从哪一间开始」没有答案。
    for (const seed of SEEDS.slice(0, 200)) {
      const map = generateDungeon(seed, cfg, plan)
      expect(map.rooms[0]!.kind, `种子 ${seed} 的第一间`).toBe('start')
      expect(map.rooms[0]!.id, `种子 ${seed} 的第一间`).toBe(plan.stairwell.id)
      expect(map.rooms.filter((r) => r.kind === 'start').length, `种子 ${seed}`).toBe(1)
    }
  })

  it('首领恒为 YF604，且全层只有它一间 boss —— 藏在别处等于这层没有出口', () => {
    for (const seed of SEEDS.slice(0, 200)) {
      const map = generateDungeon(seed, cfg, plan)
      const bosses = map.rooms.filter((r) => r.kind === 'boss')
      expect(bosses.length, `种子 ${seed}`).toBe(1)
      expect(bosses[0]!.id, `种子 ${seed}：首领房挪位了`).toBe('YF604')
    }
  })

  it('**写死关别的那几间**：平面图上 `fixed` 是哪一类，生成出来就是哪一类', () => {
    // 判据从 `plan` 自己来，不在这里另抄一份房间名单 ——
    // 抄一份的话，平面图上改了 `fixed` 而这里没跟着改，两边会各说各话。
    // 真值今天有三条：`YF604` = boss、`YF607` / `YF612` = reward（两间教休室）。
    expect(FIXED.length, '平面图上一个 fixed 都没有 —— 这一条会白跑').toBeGreaterThan(0)
    for (const seed of SEEDS.slice(0, 200)) {
      const byId = new Map(generateDungeon(seed, cfg, plan).rooms.map((r) => [r.id, r]))
      for (const room of FIXED) {
        expect(byId.get(room.id)!.kind, `种子 ${seed}：${room.id} 的关别没按平面图写死`).toBe(
          room.fixed,
        )
      }
    }
  })

  it('不写死的那 13 间：关别都从 `roomKindWeights` 的键里来，且没有 start / boss', () => {
    const allowed = new Set(Object.keys(cfg.roomKindWeights))
    expect(allowed.size, '真表里至少要有两类关别').toBeGreaterThan(1)
    expect(allowed.has('start'), '真表里不该有 start —— 配置加载会当场拒').toBe(false)
    expect(allowed.has('boss'), '真表里不该有 boss —— 配置加载会当场拒').toBe(false)
    let seen = 0
    for (const seed of SEEDS.slice(0, 200)) {
      for (const r of generateDungeon(seed, cfg, plan).rooms) {
        if (r.kind === 'start' || r.kind === 'boss') continue
        if (FIXED.some((f) => f.id === r.id)) continue
        seen++
        expect(allowed.has(r.kind), `种子 ${seed} ${r.id} 是 ${r.kind}，不在 roomKindWeights 里`).toBe(
          true,
        )
      }
    }
    expect(seen, '三个种子里一间随机关别都没有 —— 这条用例白跑了').toBeGreaterThan(0)
  })

  it('关别分配真的随种子变 —— 一层的关别不是常量', () => {
    const shapes = new Set(
      SEEDS.slice(0, 40).map((s) =>
        generateDungeon(s, cfg, plan)
          .rooms.map((r) => `${r.id}:${r.kind}`)
          .join('|'),
      ),
    )
    expect(shapes.size, '40 个种子的关别分配都一样 —— "随机"是假的').toBeGreaterThanOrEqual(30)
  })
})

describe('D2 生成器 — 威胁预算', () => {
  it('**层有多深都不改难度** —— 最远那一跳恒拿 `base × growth`', () => {
    // ⚠️ v4 这条叫「末间预算与主干数无关（N=8 与 N=11 的末间一样强）」，判据是主干序号；
    // v5 的立足点换成**到楼梯间的跳数**（`gen/budget.ts`：`t = 跳数 / 最远跳数`）。
    //
    // 同一件事，但 v5 里**不能再靠扫种子来证明**：几何与种子无关 ⇒ 这一层的直径是
    // 一个常量 ⇒ 1000 个种子的 `maxDist` 是同一个数，扫它扫不出「直径变了会怎样」。
    // 所以这里直接钉公式本身：`t = 1` 那一头恒定。
    const farthest = threatBudgetAt(1, cfg)
    expect(farthest, '最远那一跳的预算').toBe(threatBudgetAt(progressT(9, 9), cfg))
    // 换一个直径，同一个「最远」还是同一个数 —— 这才是「改几何不许改难度」那句话。
    expect(threatBudgetAt(progressT(3, 3), cfg), '3 跳的一层与 9 跳的一层').toBe(farthest)
    expect(threatBudgetAt(progressT(20, 20), cfg)).toBe(farthest)
    // 反向：不是所有 t 都相等，否则上面三条恒真、什么都没测。
    expect(threatBudgetAt(progressT(0, 9), cfg), '出生点那一跳的预算').toBeLessThan(farthest)
  })

  it('生成出来的预算：最远的战斗关 = 最远那一跳的预算，且非战斗关恒为 0', () => {
    let combat = 0
    for (const seed of SEEDS.slice(0, 200)) {
      const map = generateDungeon(seed, cfg, plan)
      const hops = validateContract(map, cfg, plan.roomTotal).hopOf
      let maxHop = 0
      for (const r of map.rooms) {
        if (!isCombatKind(cfg, r.kind)) continue
        combat++
        expect(r.budget, `种子 ${seed} ${r.id}（${r.kind}）的预算`).toBe(
          threatBudgetAt(progressT(hops.get(r.id) ?? 0, maxHopOf(map, cfg, hops)), cfg),
        )
        maxHop = Math.max(maxHop, hops.get(r.id) ?? 0)
      }
      expect(maxHop, '这一层一个能走到的战斗关都没有').toBeGreaterThan(0)
    }
    expect(combat, '一条战斗关都没扫到 —— 这条用例白跑了').toBeGreaterThan(0)
  })

  it('预算沿「离楼梯间多远」单调不减 —— 更远的不许更弱', () => {
    // 逐间比会被同跳数之间的噪声打红，而**同跳数内部谁强谁弱不是这里要守的事**
    // （真正的要求是「远的不比近的弱」）。所以按跳数分组取组内最大、只比组间 ——
    // `validate/contract.ts` 用的是同一条判据，这里在生成侧再验一遍。
    for (const seed of SEEDS.slice(0, 200)) {
      const map = generateDungeon(seed, cfg, plan)
      const hops = validateContract(map, cfg, plan.roomTotal).hopOf
      const byHop = new Map<number, number>()
      for (const r of map.rooms) {
        if (!isCombatKind(cfg, r.kind)) continue
        const h = hops.get(r.id)
        if (h === undefined) continue
        byHop.set(h, Math.max(byHop.get(h) ?? 0, r.budget))
      }
      const levels = [...byHop.keys()].sort((a, b) => a - b)
      for (let i = 1; i < levels.length; i++) {
        expect(
          byHop.get(levels[i]!)!,
          `种子 ${seed}：跳数 ${levels[i]} 的预算比跳数 ${levels[i - 1]} 还低`,
        ).toBeGreaterThanOrEqual(byHop.get(levels[i - 1]!)!)
      }
    }
  })
})

/** 本层战斗关里最远的跳数 —— `threatBudget` 的分母。 */
function maxHopOf(map: DungeonMap, c: RoomsConfig, hops: Map<string, number>): number {
  let max = 0
  for (const r of map.rooms) {
    if (!isCombatKind(c, r.kind)) continue
    max = Math.max(max, hops.get(r.id) ?? 0)
  }
  return max
}

describe('D2 生成器 — 几何契约', () => {
  it('每种种子都通过契约校验', () => {
    for (const seed of SEEDS) {
      const map = generateDungeon(seed, cfg, plan)
      expect(() => validateContract(map, cfg, plan.roomTotal), `种子 ${seed}`).not.toThrow()
    }
  })

  it('每一扇门的门洞两端都落在格边界上', () => {
    // 门宽是奇数格只保证「长度是整格」，保证不了**位置**：整格宽的门摆在半个格子的
    // 偏移上，两端一样落在格中心 —— 于是实际能过的格子数比设计多一个。
    // （★ v5 改的只是**为什么**：v5 里空间矩形的边界就落在格边界上，
    //  门洞是墙上挖掉的那几格，天然整格；v4 那时房间边界落在格**中心**上，
    //  所以门心还得单独偏半格。判据没变，理由换了。）
    const cell = cfg.navCellSize
    const mod = (a: number, n: number): number => ((a % n) + n) % n
    for (const seed of SEEDS.slice(0, 100)) {
      const map = generateDungeon(seed, cfg, plan)
      for (const room of map.rooms) {
        for (let i = 0; i < room.doors.length; i++) {
          const d = room.doors[i]!
          const along = d.axis === 'h' ? d.x : d.y
          const origin = d.axis === 'h' ? map.navOrigin.x : map.navOrigin.y
          const tag = `种子 ${seed} ${room.id} 的 doors[${i}]（${d.axis}）`
          expect(mod(along - d.width / 2 - origin, cell), `${tag} 的门洞西/北端`).toBe(0)
          expect(mod(along + d.width / 2 - origin, cell), `${tag} 的门洞东/南端`).toBe(0)
        }
      }
    }
  })

  it('所有房间都是轴对齐矩形、互相不重叠，且不与走廊重叠', () => {
    // ★ v5 里这一条**比 v4 更重要**：几何不再是算出来的，是从照片上量进
    // `floor-plan.json` 的。算错一格不会报错 —— 两间房重叠 40px 在游戏里是
    // 「这两间之间没有墙」，也就是玩家能从 YF601 直接穿进 YF602。
    for (const seed of SEEDS.slice(0, 100)) {
      const map = generateDungeon(seed, cfg, plan)
      const rooms = map.rooms
      for (let i = 0; i < rooms.length; i++) {
        const a = rooms[i]!.rect
        expect(a.width, `种子 ${seed}`).toBeGreaterThan(0)
        expect(a.height, `种子 ${seed}`).toBeGreaterThan(0)
        for (let j = i + 1; j < rooms.length; j++) {
          const b = rooms[j]!.rect
          const overlap =
            left(a) < right(b) && left(b) < right(a) && top(a) < bottom(b) && top(b) < bottom(a)
          expect(overlap, `种子 ${seed}：${rooms[i]!.id} 与 ${rooms[j]!.id} 重叠`).toBe(false)
        }
        // 走廊↔走廊重叠是**允许**的（它们是同一条走廊，见 floor-plan.json 的
        // `_gap_comment`），所以只判房间↔走廊。`validate/contract.ts` 里那一条同款。
        for (const p of map.passages) {
          const overlap =
            left(a) < right(p.rect) &&
            left(p.rect) < right(a) &&
            top(a) < bottom(p.rect) &&
            top(p.rect) < bottom(a)
          expect(overlap, `种子 ${seed}：${rooms[i]!.id} 与走廊 ${p.id} 重叠`).toBe(false)
        }
      }
    }
  })

  it('难度档位不参与几何 —— 三档难度同种子产出逐项相同的地图', () => {
    // 生成器签名里就没有难度参数（`(seed, cfg, plan, now?)`），所以「同一颗种子在
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
    const ref = JSON.stringify(generateDungeon(SEEDS[0]!, cfg, plan))
    for (const id of ids) {
      expect(JSON.stringify(generateDungeon(SEEDS[0]!, cfg, plan)), `难度 ${id}`).toBe(ref)
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
    walk(generateDungeon(SEEDS[0]!, cfg, plan))
    const bannedMapKeys = ['difficulty', 'difficultyId', 'tier', 'mode']
    for (const b of bannedMapKeys) {
      expect([...keys], `DungeonMap 里不该出现 "${b}" —— 难度只乘在"预算 → 刷怪"那一步`).not.toContain(b)
    }
    // 反向：配置里也不许出现难度派生的字段名（含难度档位的 id 本身）
    const bannedCfgKeys = [
      ...Object.keys(diffRaw.difficulties),
      ...Object.keys(diffRaw.difficulties[ids[0]!]!),
    ]
    for (const b of bannedCfgKeys) {
      expect(Object.keys(cfg), `rooms.json 里不该出现 "${b}" —— 那是难度侧的旋钮`).not.toContain(b)
    }
  })
})

describe('D2 生成器 — 可达性（硬性验收标准）', () => {
  it('1000 个种子两层全绿', () => {
    const failures: string[] = []
    for (const seed of SEEDS) {
      const map = generateDungeon(seed, cfg, plan)
      try {
        assertReachable(map, cfg)
      } catch (e) {
        failures.push(String(e))
      }
    }
    expect(failures.slice(0, 5).join('\n')).toBe('')
  })

  it('每一段走廊的实测净宽都 ≥ 门宽 —— 走廊不是这一层最窄的地方', () => {
    // ⚠️ **v4 这一条叫「实测净宽 = mainRoomHeight − wallThickness」，v5 整条换掉了。**
    // v4 里 6 段连廊等高、等宽，所以有一个**常数**可以照配置抄下来对；
    // v5 的走廊是一张 S 形**网**，6 段的尺寸各不相同、而且**两种朝向都有**
    // （`C_S` 是竖的 6×22 格，`C_W` 是横的 119×6 格）。而且 `mainRoomHeight` 没了。
    //
    // 换成 V5 真正要守的那件事：**走廊都比门宽**。门是全层最窄的地方
    // （`measureNarrowestOpening` 的注释），走廊要是比门还窄，玩家就会卡在
    // 走廊里而读数显示「门够宽」—— 一条正确的废话。
    //
    // ⚠️ 净宽量的是**短轴**（`measurePassageClearWidth` 里 `vertical` 那一句）：
    // 拿长轴去量，`C_W` 量出来是 4760px，永远绿灯。
    for (const seed of SEEDS.slice(0, 100)) {
      const map = generateDungeon(seed, cfg, plan)
      const r = checkReachability(map, cfg)
      expect(r.passageClearWidths.length, `种子 ${seed}`).toBe(map.passages.length)
      for (let i = 0; i < r.passageClearWidths.length; i++) {
        const p = map.passages[i]!
        expect(
          r.passageClearWidths[i],
          `种子 ${seed} 走廊 ${p.id}（${p.rect.width}×${p.rect.height}px）的实测净宽` +
            `不该比门宽 ${cfg.doorWidth} 还窄`,
        ).toBeGreaterThanOrEqual(cfg.doorWidth)
        // 也不能量到长轴上去 —— 短轴是 min(宽, 高)，量出来的数不许超过它。
        expect(
          r.passageClearWidths[i],
          `种子 ${seed} 走廊 ${p.id} 的净宽比它的短轴还长 —— 量到长轴/别的地方去了`,
        ).toBeLessThanOrEqual(Math.min(p.rect.width, p.rect.height) + 1e-6)
      }
    }
  })

  it('最窄窄口（走廊净宽与每一扇门取小）≥ minPassageWidth', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const map = generateDungeon(seed, cfg, plan)
      const r = checkReachability(map, cfg)
      expect(r.narrowestOpeningWidth, `种子 ${seed}`).toBeGreaterThanOrEqual(cfg.minPassageWidth)
      // 反过来也要钉：读数不能是「随手量到的最小值」—— 窄口就是**门**那一处
      // （走廊比门宽得多），报出比最小门宽更小的数说明量到别的地方去了。
      // ⚠️ 门宽读的是**门自己的** `width`，不是配置表的 `doorWidth`：
      // 门洞的实际宽度写在 `floor-plan.json` 里，两边不一致时照配置抄会量出一个
      // 这层楼里根本不存在的数。
      const narrowestDoor = Math.min(...map.rooms.flatMap((x) => x.doors.map((d) => d.width)))
      expect(r.narrowestOpeningWidth, `种子 ${seed}`).toBe(narrowestDoor)
    }
  })

  it('校验用的网格参数与地图自己声明的一致', () => {
    // ⚠️ 这条原先叫「校验路径与运行时路径对同一坐标判定相同」，**名字是错的**（2026-10-19 核实）：
    // 运行时 D3 吃的那份 `isWalkable` 来自 **D1 的 `combat/TerrainMap.ts`**（`CombatSession.ts:114`），
    // **不是**本域的 `buildWalkability` —— 那个函数在生产代码里 0 个调用点（见 `walkability.ts` 文件头）。
    // 所以这条**证明不了**「校验与运行时一致」；它证明的是 `gridOfMap` 读的
    // `navCellSize` / `navOrigin` 就是地图自己声明的那两个数。
    for (const seed of SEEDS.slice(0, 30)) {
      const map = generateDungeon(seed, cfg, plan)
      const grid = gridOfMap(map)
      expect(grid.cellSize, `种子 ${seed}`).toBe(map.navCellSize)
      expect(grid.originX, `种子 ${seed}`).toBe(map.navOrigin.x)
      expect(grid.originY, `种子 ${seed}`).toBe(map.navOrigin.y)
      // ★ v5：网格原点必须**吸附到格的整数倍**上（`navExtentFor` 的活）。
      // 不吸附的话「空间边界落在格边界上」这条校验全体失效 —— 相位一偏半格，
      // 所有空间一起错位，而错位之后**每一条检查都还自洽**。
      //
      // ⚠️ 写成 `% cell === 0` 直接比会**假红**：这一层的原点就是**负的**（`-80`），
      // 而 JS 里负数的 `%` 返回 `-0` —— `toBe` 用的是 `Object.is`，
      // `Object.is(-0, 0)` 是 **false**。于是「原点吸附对了」被报成「吸附错了」。
      // 归一化在**取模之后**（写在取值前没用：`-80 % 40` 自己就是 `-0`）。
      const snap = (v: number): number => {
        const m = v % grid.cellSize
        return m === 0 ? 0 : m
      }
      expect(snap(grid.originX), `种子 ${seed} navOrigin.x`).toBe(0)
      expect(snap(grid.originY), `种子 ${seed} navOrigin.y`).toBe(0)
    }
  })

  it('每个出生点都落在格中心上、且不被障碍物盖住', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const map = generateDungeon(seed, cfg, plan)
      const grid = gridOfMap(map)
      for (const room of map.rooms) {
        for (const p of room.spawnPoints) {
          const cx = Math.floor((p.x - grid.originX) / grid.cellSize)
          const cy = Math.floor((p.y - grid.originY) / grid.cellSize)
          expect(grid.blocked[cy * grid.cols + cx], `种子 ${seed} 房间 ${room.id}`).toBe(0)
        }
      }
    }
  })

  it('每间**战斗**房都有出生点 —— 空房 = 清不掉 = 把玩家和门一起锁住', () => {
    // ⚠️ 判据是 `combatKinds`，不是「所有房间」。原先这条写的是「每间房」，
    // 那是关别表落地之前的实话；道具关 / 宝箱关**本来就不该有怪**，
    // 拿「每间房」去要求它们，等于把「空房」这件事从设计里抹掉。
    // 非战斗房那一侧由下面「非战斗房三空」那条守着。
    for (const seed of SEEDS.slice(0, 200)) {
      for (const room of generateDungeon(seed, cfg, plan).rooms) {
        if (!isCombatKind(cfg, room.kind)) continue
        expect(room.spawnPoints.length, `种子 ${seed} 房间 ${room.id}`).toBeGreaterThan(0)
      }
    }
  })
})

describe('D2 校验器 — 负样本（证明它不是永远通过）', () => {
  // 一个从来不会失败的校验器和一个没有校验器，在测试报告上长得一模一样。
  // 这一组把**每一类**检查各弄坏一次，要求它红、且红在正确的位置上。
  //
  // ★ v5 换掉了其中五条，都是「v4 那条检查已经不存在了」：
  //
  // | v4 的负样本 | v5 |
  // |---|---|
  // | 主干数超出 [8, 11] 被拒 | 删（没有主干数了）→ 换成「start 恰好一间」「boss 恰好一间」 |
  // | 末间不是 boss 被拒 | 删（`order` 不是进度轴，boss 不在末间而在 YF604） |
  // | 侧室挂着配置表外的关别被拒 | 删（`sideKindWeights` 没了） |
  // | 起点房不在第一间被拒 | **留下并改判据**（v5 改判「第一间应是 start」） |
  // | 连廊被切断 / 填实 | **留下并改报错文本**（v5 按走廊 id 报，不按 `between`） |
  type AnyRec = Record<string, unknown>
  type MutRect = { x: number; y: number; width: number; height: number }
  type LooseMap = {
    rooms: AnyRec[]
    walls: AnyRec[]
    passages: { id: string; rect: MutRect }[]
    navCellSize: number
    navOrigin: { x: number; y: number }
    schemaVersion: number
    bounds: MutRect
    seed: number
  }

  const broken = (seed: number, mangle: (m: LooseMap) => void): DungeonMap => {
    const m = structuredClone(generateDungeon(seed, cfg, plan)) as unknown as LooseMap
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
      validateContract(map, withCfg, plan.roomTotal)
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

  it('房间总数不对被拒 —— 报的是这一层的 16（楼梯间算在里面）', () => {
    const m = broken(SEED, (x) => {
      x.rooms.pop()
    })
    expectFails(m, 'rooms', `应有 ${plan.roomTotal} 间房（含楼梯间）`)
  })

  it('**两间 start** 被拒 —— 玩家从哪一间开始就没有答案了', () => {
    const m = broken(SEED, (x) => {
      // 把一间随机关别改成 start。这一改同时让「房间数是 16」仍然成立、
      // 几何一个字没动 —— 只靠肉眼与几何校验都看不出来。
      const victim = x.rooms.find((r) => r.kind !== 'start' && r.kind !== 'boss')!
      victim.kind = 'start'
    })
    expectFails(m, 'rooms', "起点房（kind: 'start'）应当恰好有 1 间")
  })

  it('**两间 boss** 被拒 —— 两个首领就是两个出口', () => {
    const m = broken(SEED, (x) => {
      // ⚠️ 挑的这间必须**既不是 start 也不是 boss**：v5 里 `rooms` 的第一间就是
      // 楼梯间（start），拿 `find(r => r.kind !== 'boss')` 去挑会选中它 ——
      // 于是这一改**把唯一那间 start 删掉了**，先撞上「start 应当恰好 1 间」，
      // 而那条报错看着跟自己要说的事毫无关系。首版就是这样红的。
      const victim = x.rooms.find(
        (r) => r.kind !== 'start' && r.kind !== 'boss' && !FIXED.some((f) => f.id === r.id),
      )!
      victim.kind = 'boss'
    })
    expectFails(m, 'rooms', "首领房（kind: 'boss'）应当恰好有 1 间")
  })

  it('起点房不在第一间被拒', () => {
    // ⚠️ 触发它比 v4 绕一点，两处都是：
    //
    // ① **先得让 start 的数量仍然是 1**。v4 那条写的是「把第 3 间改成 start」，
    //    v5 里那么改会先撞上「start 应当恰好 1 间」（变成两间）——
    //    那条也是对的报错，但不是这一条要验的。所以这里是**搬**而不是加。
    // ② 搬走之后第一间要放一个**合法**关别。首版写的是 `'normal'` ——
    //    那不是 `ROOM_KINDS` 里的值，于是先命中「不是合法类型」，
    //    报的是「这个关别不存在」，而这一条要验的是「它不在第一间」。
    const m = broken(SEED, (x) => {
      x.rooms[0]!.kind = 'main'
      x.rooms[3]!.kind = 'start'
    })
    expectFails(m, 'rooms[0].kind', "第一间应是 'start'")
  })

  it('连廊被拦腰切断 —— 实测净宽为 0，层 1 也抓得住', () => {
    const m = broken(SEED, (x) => {
      // 在**第一段**走廊正中间竖一道墙：宽两格、高 = 整段走廊。
      //
      // ⚠️ 为什么不能只横一道「一格厚」的墙（首版那条负样本就是这么写的）：
      // 竖直墙上的门洞是 **3 格高**（`doorWidth` 120 = 3 格），而 40px 厚的墙
      // 只盖住中间那 2 格 —— 门洞最上面那一格还是通的，flood fill 从那里挤过去，
      // **一段被切断的走廊照样判绿**。这不是假设，是照着写的版本跑出来的。
      // 高 = 整段走廊的高度，才能在带内把所有行都盖住。
      const p = x.passages[0]!.rect
      x.walls.push({
        x: p.x,
        y: p.y,
        width: cfg.navCellSize * 2,
        height: p.height,
      })
    })
    const r = checkReachability(m, cfg)
    const text = r.problems.join('\n')
    const id = m.passages[0]!.id
    // ★ 层 1 报的是**走廊 id**（`走廊「C_W」有 N/M 格从楼梯间走不到`）。
    // v4 报的是「连廊 #0」+ `between` 两端的房间号 —— `Passage.between` 在 v5 删了：
    // v5 的走廊是一张网，一段走廊的两头可以接三四个方向，没有「夹在哪两间之间」。
    expect(text).toContain(`走廊「${id}」`)
    expect(text).toContain('从楼梯间走不到')
    expect(r.layer1Ok).toBe(false)
    // 层 2：窄口读数跟着掉到 0，并给出配置里的下限
    expect(text).toContain(`${cfg.minPassageWidth}px`)
    expect(r.passageClearWidths[0]).toBe(0)
    expect(r.narrowestOpeningWidth).toBe(0)
    // 其余的走廊不受影响 —— 堵一段不是"全层都堵"
    expect(r.passageClearWidths.slice(1).every((w) => w > 0)).toBe(true)
  })

  it('连廊被整段填实 —— 层 2 从净宽那一头抓住', () => {
    // 上一条切的是「进得去、出不来」。这一条填的是**整个**走廊矩形。
    //
    // ⚠️ **v5 的报错位置换了，这不是退回，是判据换了。** v4 的层 1 会报
    // 「这一段进不去」；v5 的层 1 判据是「走廊的**每一格**都要走得到」——
    // 整段填实之后可走格数是 0，于是 `missed.length === 0`，**层 1 反而无话可说**。
    // 抓住它的是层 2 的净宽读数（`measurePassageClearWidth` 起手那一句
    // 「中线那一格就堵着 → 返回 0」）。所以这条用例改成钉层 2 ——
    // 钉的是「它**被抓住了**」，不是「它在哪一层被抓」。
    const m = broken(SEED, (x) => {
      const p = x.passages[0]!.rect
      x.walls.push({ x: p.x, y: p.y, width: p.width, height: p.height })
    })
    const r = checkReachability(m, cfg)
    const text = r.problems.join('\n')
    expect(r.passageClearWidths[0]).toBe(0)
    expect(r.layer2Ok).toBe(false)
    expect(text).toContain(`${cfg.minPassageWidth}px`)
    expect(text).toContain(`走廊`)
  })

  it('障碍物没按格对齐被拒', () => {
    const m = broken(SEED, (x) => {
      const room = x.rooms.find((r) => (r.obstacles as AnyRec[]).length > 0)!
      const o = (room.obstacles as AnyRec[])[0]!
      o.rect = { ...(o.rect as Rect), x: (o.rect as Rect).x + 7 }
    })
    expectFails(m, 'obstacles[0]', '格边界')
  })

  it('课桌尺寸不合契约被拒（桌 2—4 格宽、1 格高、椅 1 格）', () => {
    const cell = cfg.navCellSize
    const m = broken(SEED, (x) => {
      // 把某张桌**加高一格**（1 → 2 格）。
      //
      // ⚠️ 首版走的是"加宽两格"，**测不到**：桌宽是个区间（`deskWidthCells` ~
      // `deskWidthCellsMax`，今天 2~4），抽到的那张恰好是 2 格宽，+2 = 4 格 ——
      // **仍然合法**，于是校验器一声不吭，用例红在自己身上。
      // 改高度是确定的：高度**恒为** `deskHeightCells`，多一格必然超。
      //
      // 挑的这张桌必须**下面还有一格余地**，不然加高会让它先长出房间
      // （"长到了房间外面"那条排在尺寸契约**前面**，报出来的就不是这一条了）。
      // 所以从后往前找一张够深的：桌椅组是"桌一行 + 正下方椅一行"，
      // 椅子下面还有一格的话，桌子长高那一格就落在椅子上 ——
      // 而**尺寸契约排在"桌椅成组"前面**（成组那条在障碍物循环**之后**），
      // 所以它还是会红在尺寸上。
      let grown = false
      for (const room of x.rooms) {
        for (const o of room.obstacles as AnyRec[]) {
          if (o.kind !== 'desk') continue
          const r = o.rect as Rect
          if (bottom(r) + cell > bottom(room.rect as Rect)) continue
          // ⚠️ `Rect` 存的是**中心点**：只改 `height` 不动 `y` 的话，桌子是**上下各长半格** ——
          // 上边界从格边界挪到半格上，先红的就成了"位置没落在格边界上"（报的是对齐，
          // 不是尺寸）。往**下**长一格要把中心也下移半格，上边界才留在原地。
          o.rect = { ...r, y: r.y + cell / 2, height: r.height + cell }
          grown = true
          break
        }
        if (grown) break
      }
    })
    // 没找到能加高的桌子时上面那圈会**静默地什么都不做**，
    // 然后这条用例红在"本该被拒"上 —— 那句话说的是校验器的错，不是这里的错。
    // 先钉一句"确实动过"，红了就知道该看哪儿。
    const desks = (m.rooms as unknown as { obstacles: AnyRec[] }[]).flatMap((r) =>
      r.obstacles.filter((o) => o.kind === 'desk'),
    )
    expect(
      desks.some((d) => (d.rect as Rect).height !== cfg.deskHeightCells * cell),
      '一张加高的桌子都没造出来 —— 这条用例会红在校验器上，而问题在这里',
    ).toBe(true)
    expectFails(m, 'obstacles', '尺寸超出契约')
  })

  it('课桌底下没有椅子被拒 —— 桌椅是成组的', () => {
    const m = broken(SEED, (x) => {
      const room = x.rooms.find((r) => (r.obstacles as AnyRec[]).some((o) => o.kind === 'chair'))!
      const obstacles = room.obstacles as AnyRec[]
      // 把一把椅子**抽走**，桌子留在原地。生成侧构造上不可能产出这种数据，
      // 这条守的是"别处塞进来的家具"（D1 的宝箱落点、将来的新家具）。
      const chair = obstacles.find((o) => o.kind === 'chair')!
      obstacles.splice(obstacles.indexOf(chair), 1)
    })
    expectFails(m, 'obstacles', '底下没有椅子')
  })

  it('孤零零的椅子被拒 —— 每把椅子都要属于某张桌', () => {
    const cell = cfg.navCellSize
    const m = broken(SEED, (x) => {
      const room = x.rooms.find((r) => (r.obstacles as AnyRec[]).some((o) => o.kind === 'chair'))!
      const r = room.rect as Rect
      // **加**一把，而不是把某把挪走 —— 挪走会让它那张桌子变成"底下没有椅子"，
      // 而桌子在 `obstacles` 里排在椅子前面，先红的就成了桌子那条。
      // 摆在房间内部的**左上角那一格**（`placeObstacles` 从 `ix = 1` / `iy = 1` 起摆，
      // 且要求周围留一格，所以那里一定没有桌子）。
      ;(room.obstacles as AnyRec[]).push({
        kind: 'chair',
        rect: {
          // ★ v5：房间矩形**就是**可走格跨度，不再往里让半堵墙（v4 是 `left(r) + wt/2`）。
          x: left(r) + cell / 2,
          y: top(r) + cell / 2,
          width: cell,
          height: cell,
        },
      })
    })
    expectFails(m, 'obstacles', '孤零零')
  })

  it('门口被堵死 —— 层 2 抓得住', () => {
    const cell = cfg.navCellSize
    const m = broken(SEED, (x) => {
      const room = x.rooms.find((r) => (r.doors as AnyRec[]).length > 0)!
      const door = (room.doors as AnyRec[])[0]! as {
        x: number
        y: number
        axis: string
        width: number
      }
      const r = room.rect as Rect
      const inward = door.axis === 'h' ? Math.sign(r.y - door.y) || 1 : Math.sign(r.x - door.x) || 1

      // 门内侧**第一格**那一行，用椅子铺满整个门洞宽度。
      // 注意这是"往里退**整格**"：门洞占满墙所在的那一格
      // （★ v5 改了 —— v4 的门骑在房间边界上、墙各吃半层，那时是另一套数），
      // 所以内侧第一格的格心在 `门心 + 一格`。
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
    let placed = false
    const m = broken(SEED, (x) => {
      // ⚠️ 这一条要绕三个弯，前两个是别的检查造成的，后一个是几何本身的：
      //
      // ① 挑的房必须是**要打架的**关别。首版挑的是「第一间有门的房」，
      //    而 v5 里那是楼梯间（start）—— 于是先撞上「不在 combatKinds 里，
      //    却摆着 1 件桌椅」。那条报错也对，但不是这一条要验的。
      // ② 摆的矩形必须是**合法尺寸**的课桌（`deskWidthCells`~`Max` × `deskHeightCells`）：
      //    边长、格对齐、在房间内、尺寸四条都排在「挡住门」**前面**，
      //    随手捏一个矩形撞不到这一条。
      // ③ 墙要**加厚到 2 格**（`thickCfg`）才重叠得上 —— 见下面注释块。
      //
      // 门矩形是 `doorRect(door, wallThickness)`：以门心为中心、厚 = `wallThickness`。
      // 门心在**墙那一格的格心**上，所以墙厚 1 格时门矩形**正好就是那一格** ——
      // 而障碍物不可能落在那一格里（它在房间矩形**外面**，v5 里房间矩形就是可走格跨度）。
      // 于是墙厚 1 格时这一条分支**不可达**；加厚到 2 格，门矩形才往房间里多探半格。
      const grid = gridOfMap(x as unknown as DungeonMap)
      const cellOf = (v: number, origin: number): number => Math.floor((v - origin) / cell)
      const rooms = x.rooms as unknown as {
        kind: string
        rect: Rect
        doors: AnyRec[]
        obstacles: AnyRec[]
      }[]

      for (const room of rooms) {
        if (!isCombatKind(cfg, room.kind as RoomKind)) continue
        const r = room.rect
        const c0 = cellOf(left(r), grid.originX)
        const c1 = cellOf(right(r) - 1, grid.originX)
        const r0 = cellOf(top(r), grid.originY)
        const r1 = cellOf(bottom(r) - 1, grid.originY)
        for (const raw of room.doors) {
          const d = raw as { x: number; y: number; width: number; axis: string }
          const gx = cellOf(d.x, grid.originX)
          const gy = cellOf(d.y, grid.originY)
          // 「往里」= 房间中心在门心的哪一侧。门开在房间墙上，这一侧就是房间。
          const inX = Math.sign(r.x - d.x) || 1
          const inY = Math.sign(r.y - d.y) || 1
          const at = (col0: number, row0: number): Rect => ({
            x: grid.originX + (col0 + 1) * cell, // 两格宽：格边界 + 一格 = 中心
            y: grid.originY + row0 * cell + cell / 2,
            width: 2 * cell,
            height: cell, // deskHeightCells = 1
          })
          // 桌子摆在**门内侧那一格**上：一个方向贴着门洞宽度里的格子，
          // 另一个方向（桌宽那两格）整两格都落在房间里
          // （`c0/c1` / `r0/r1` 是房间自己的格跨度，越过它就撞上"长到了房间外面"）。
          const candidates: [number, number][] =
            d.axis === 'h'
              ? [
                  [gx - 1, gy + inY],
                  [gx, gy + inY],
                ]
              : [[gx + inX, gy]]
          const fit = candidates.find(
            ([c, rr]) => c >= c0 && c + 1 <= c1 && rr >= r0 && rr <= r1,
          )
          if (!fit) continue
          room.obstacles.push({ kind: 'desk', rect: at(fit[0], fit[1]) })
          placed = true
          break
        }
        if (placed) break
      }
    })
    // 一次都没摆上时上面那圈会**静默返回**，然后这条用例红在"本该被拒"上 ——
    // 那句话说的是校验器的错，而问题在这里。先钉一句"确实摆上过"。
    expect(placed, '一张堵门的桌子都没摆出来 —— 这条用例会红在校验器上，而问题在这里').toBe(
      true,
    )
    expectFails(m, '挡住了', '堵在门口', thickCfg)
  })

  it('出生点被围死 —— 层 2 抓得住，且报出坐标', () => {
    const m = broken(SEED, (x) => {
      const room = x.rooms.find((r) => (r.spawnPoints as unknown[]).length > 0)!
      const p = (room.spawnPoints as { x: number; y: number }[])[0]!
      const grid = gridOfMap(x as unknown as DungeonMap)
      const cell = cfg.navCellSize
      const cx = Math.floor((p.x - grid.originX) / cell)
      const cy = Math.floor((p.y - grid.originY) / cell)

      // 把出生点**四邻**各放一把椅子 —— 出生点那一格**本身留着空**。
      // 这是刻意的：盖住出生点会先命中"不在教室内部"那条分支，
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
    expect(result.problems.join('\n')).toMatch(/房间 #\d+（\w+）的出生点 \(\d+, \d+\)/)
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

  it('门的一端指向不存在的空间被拒 —— 那扇门看着完好，通不到任何地方', () => {
    // ★ v5 新增的一条（`contract.ts` 里 `known.length > 0` 那一段）。
    // 指到空气上时 `collidersOf` 造出来的挡板照样存在（它只读门的坐标），
    // 于是洞口、挡板、画在地图上的那一格**全都对**，只是它通不到任何地方。
    const m = broken(SEED, (x) => {
      const room = x.rooms.find((r) => (r.doors as AnyRec[]).length > 0)!
      const door = (room.doors as AnyRec[])[0]!
      // 按字典序那一端（`a < b`）改成空气 —— 另一端不动，免得先撞上排序那条。
      const a = door.a as string
      const b = door.b as string
      door.b = a < b ? `${b}__不存在` : b
      door.a = a < b ? a : `${a}__不存在`
    })
    expectFails(m, 'rooms', '指向不存在的空间')
  })

  it('门的两端没按字典序排被拒 —— 排好序是为了让同一扇门在两处读起来一样', () => {
    const m = broken(SEED, (x) => {
      const room = x.rooms.find((r) => (r.doors as AnyRec[]).length > 0)!
      const door = (room.doors as AnyRec[])[0]!
      const a = door.a
      door.a = door.b
      door.b = a
    })
    expectFails(m, 'rooms', '按字典序在前')
  })

  // ---- 关别表那三条规则（v5 起判据是 `combatKinds` + `isCombatKind`）

  /** 把一间房改造成**合法**的非战斗房：关别对了，三项也都清空了。 */
  const asNonCombat = (m: LooseMap, order: number): AnyRec => {
    const r = m.rooms[order]!
    r.kind = 'reward'
    r.obstacles = []
    r.spawnPoints = []
    r.budget = 0
    return r
  }

  /** 一间**随机关别**的房间的 order —— 定死关别的那几间（YF604 / 两间教休室）不能用。 */
  const someRandomOrder = (m: LooseMap): number => {
    const r = m.rooms.find(
      (x) => x.kind !== 'start' && x.kind !== 'boss' && !FIXED.some((f) => f.id === (x.id as string)),
    )!
    return r.order as number
  }

  it('非战斗房摆着课桌被拒（三条里先撞上的那条）', () => {
    const m = broken(SEED, (x) => {
      const victim = asNonCombat(x, someRandomOrder(x))
      const donor = x.rooms.find((r) => (r.obstacles as AnyRec[]).length > 0)!
      victim.obstacles = [(donor.obstacles as AnyRec[])[0]]
    })
    expectFails(m, 'obstacles', '是不打架的关别')
  })

  it('非战斗房有刷怪点被拒 —— 门会永远等不到清空', () => {
    const m = broken(SEED, (x) => {
      const victim = asNonCombat(x, someRandomOrder(x))
      const rect = victim.rect as MutRect
      victim.spawnPoints = [{ x: rect.x, y: rect.y }]
    })
    expectFails(m, 'spawnPoints', '永远等不到清空')
  })

  it('非战斗房留着威胁预算被拒', () => {
    const m = broken(SEED, (x) => {
      asNonCombat(x, someRandomOrder(x)).budget = 8
    })
    expectFails(m, 'budget', '一个没有敌人的场地没有威胁')
  })
})

describe('D2 配置 — 关别表（schemaVersion 5）', () => {
  // 与上面那组同一条理由：一个从来不拒绝的配置加载器，和没有加载器长得一样。
  // 这一组把**每一类**新校验各踩一次；读的是真文件、再就地弄坏一处，
  // 所以「真表本身是合法的」也顺带被证明了（下面每个用例都要先复制出一份好表）。
  //
  // ★ v5 换掉了这一组的**主语**：v4 弄坏的是 `sideKindWeights`（侧室的关别权重），
  // 现在它叫 `roomKindWeights`，而且语义变了 —— **它现在是「发牌」的依据，
  // 不是 12 次独立抽签**（`gen/layout.ts` 的 `kindBag`：按最大余数法折成一副
  // 正好 12 张的牌再洗）。所以「权重为 0」的报错理由也跟着改了：
  // 不是「这一类永远抽不到」，而是「留一个拿不到名额的名字不如删掉」。
  type Raw = Record<string, unknown>

  const rawRooms = (): Raw => readJson('rooms.json')

  const expectConfigFails = (
    mangle: (raw: Raw) => void,
    pathPart: string,
    messagePart: string,
  ): void => {
    const raw = rawRooms()
    mangle(raw)
    let caught: Error | null = null
    try {
      parseRoomsConfig(raw)
    } catch (e) {
      caught = e as Error
    }
    expect(caught, `本该被拒（期望命中 ${pathPart}）`).not.toBeNull()
    expect(caught!.message).toContain(pathPart)
    expect(caught!.message).toContain(messagePart)
  }

  it('真表本身合法（负样本的前提）', () => {
    expect(() => parseRoomsConfig(rawRooms())).not.toThrow()
  })

  it('空权重表被拒 —— 那 12 间教室的关别就是从这张表里抽的', () => {
    expectConfigFails(
      (raw) => {
        raw.roomKindWeights = {}
      },
      'rooms.roomKindWeights',
      '至少要有一类关别',
    )
  })

  it('权重为 0 被拒 —— 留一个拿不到名额的名字不如删掉', () => {
    expectConfigFails(
      (raw) => {
        raw.roomKindWeights = { elite: 0 }
      },
      'rooms.roomKindWeights.elite',
      '权重要大于 0',
    )
  })

  it('权重为负被拒', () => {
    expectConfigFails(
      (raw) => {
        raw.roomKindWeights = { reward: -1 }
      },
      'rooms.roomKindWeights.reward',
      '权重要大于 0',
    )
  })

  it('"boss" 混进权重表被拒 —— 它由位置决定，不是能抽出来的内容', () => {
    // 放进去的后果很具体：`kindBag` 会真的发出一个 boss 名额，
    // 于是这一层有**两个**首领（一个是 YF604，一个是抽出来的），
    // 而它在几何上完全合法 —— 只是多了一个出口。
    expectConfigFails(
      (raw) => {
        raw.roomKindWeights = { elite: 2, boss: 1 }
      },
      'rooms.roomKindWeights.boss',
      '由**位置**决定',
    )
  })

  it('"start" 混进权重表同样被拒', () => {
    expectConfigFails(
      (raw) => {
        raw.roomKindWeights = { start: 1 }
      },
      'rooms.roomKindWeights.start',
      '由**位置**决定',
    )
  })

  it('本期不产出的关别混进权重表被拒 —— 报在配置表，而不是等到地图校验才炸', () => {
    // `shop` / `hidden` 是合法的枚举值、留给迭代 2，但生成器今天不产出。
    // 不拦的话，抽到它会在 `validate/contract.ts` 的「关别必须是产出集合的一员」
    // 当场炸 —— **报的是地图错，真正的原因在配置表里**，报错位置指错了地方。
    expectConfigFails(
      (raw) => {
        raw.roomKindWeights = { shop: 1 }
      },
      'rooms.roomKindWeights.shop',
      '本期不产出',
    )
  })

  it('combatKinds 里的关别不存在被拒', () => {
    expectConfigFails(
      (raw) => {
        raw.combatKinds = ['main', 'library']
      },
      'rooms.combatKinds[1]',
      '要一个关别',
    )
  })

  it('combatKinds 缺 main 被拒 —— 否则整层没有一处会刷怪', () => {
    expectConfigFails(
      (raw) => {
        raw.combatKinds = ['elite', 'boss']
      },
      'rooms.combatKinds',
      '必须含 main',
    )
  })

  it('combatKinds 缺 boss 被拒 —— 首领房不打怪那一局就没有出口', () => {
    expectConfigFails(
      (raw) => {
        raw.combatKinds = ['main', 'elite']
      },
      'rooms.combatKinds',
      '必须含 boss',
    )
  })

  it('**combatKinds 含 start 被拒** —— 那意味着出生点摆满课桌、还刷一屋子怪', () => {
    // ★ **这条是 v5 加的。** v4 里 start 在 `combatKinds` 里是对的，因为那时
    // 「起点房」是一间真的教室（主干第一间）。v5 里 start 是**楼梯间**，
    // 也就是玩家的出生点 —— 怪直接围在玩家脸上，而那是这一层的第一帧。
    expectConfigFails(
      (raw) => {
        raw.combatKinds = ['main', 'elite', 'boss', 'start']
      },
      'rooms.combatKinds',
      '不许含 start',
    )
  })

  it('combatKinds 里重复的关别被拒', () => {
    expectConfigFails(
      (raw) => {
        raw.combatKinds = ['main', 'main']
      },
      'rooms.combatKinds[1]',
      '重复了',
    )
  })

  it('每个关别都有非空中文名 —— 加枚举值忘了加名字，这里就红', () => {
    for (const kind of ROOM_KINDS) {
      const label = ROOM_KIND_LABELS[kind]
      expect(label, `${kind} 没有中文名`).toBeTruthy()
      expect(label.trim(), `${kind} 的中文名是空白`).not.toBe('')
    }
  })

  it('中文名互不相同 —— 两个关别写同一个词，画面上就分不出来', () => {
    const labels = ROOM_KINDS.map((k) => ROOM_KIND_LABELS[k])
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('D2 关别与桌椅', () => {
  /** 换掉 `combatKinds` 再解析一遍 —— 别的字段一个都不动。 */
  const cfgWithCombat = (kinds: string[]): RoomsConfig => {
    const raw = readJson('rooms.json')
    raw.combatKinds = kinds
    return parseRoomsConfig(raw)
  }

  /**
   * 与关别无关的那一半：矩形、门、空间身份。
   *
   * ⚠️ v4 这份里还有 `branch` / `sizeTier` / `anchoredTo` —— 三个字段都随主干道一起删了。
   * 留下的是「**只有关别变了**」这句话真正需要的那些：几何（矩形 + 门）与身份（id + order）。
   */
  const geometryOf = (map: DungeonMap): unknown =>
    map.rooms.map((r) => ({ id: r.id, order: r.order, rect: r.rect, doors: r.doors }))

  it('几何不受 combatKinds 影响 —— 改它只动桌椅 / 刷怪点 / 预算', () => {
    // 这是「关别」与「打不打架」解耦的直接验收：关别是生成出来的事实，
    // `combatKinds` 是对它的解释。改解释不该动一个像素。
    const lean = cfgWithCombat(['main', 'boss'])
    for (const seed of SEEDS.slice(0, 50)) {
      const a = generateDungeon(seed, cfg, plan)
      const b = generateDungeon(seed, lean, plan)
      expect(geometryOf(b), `种子 ${seed}`).toEqual(geometryOf(a))
      expect(b.passages, `种子 ${seed}`).toEqual(a.passages)
      expect(b.walls, `种子 ${seed}`).toEqual(a.walls)
      expect(b.bounds, `种子 ${seed}`).toEqual(a.bounds)
      expect(b.navOrigin, `种子 ${seed}`).toEqual(a.navOrigin)
      expect(b.navCellSize, `种子 ${seed}`).toBe(a.navCellSize)
      // 反向：**关别本身也不许变**。`combatKinds` 是「哪些关别要打」，
      // 不是「哪些关别会出现」—— 混起来的话，把 elite 移出 combatKinds
      // 会顺手让 elite 从全层消失，而那是两件事。
      expect(
        b.rooms.map((r) => r.kind),
        `种子 ${seed}`,
      ).toEqual(a.rooms.map((r) => r.kind))
      // 至少要有东西真的变了，否则上面全是恒真
      const anySpawns = (m: DungeonMap): number =>
        m.rooms.reduce((s, r) => s + r.spawnPoints.length, 0)
      expect(anySpawns(b), `种子 ${seed}：换 combatKinds 之后刷怪点一个都没变`).toBeLessThan(
        anySpawns(a),
      )
    }
  })

  it('几何不受关别**本身**影响 —— 抽到什么关别，房子还是那几间房子', () => {
    // ★ v5 里这条的力气花在两件新事上，而它们比 v4 那条更要紧：
    //
    // ① **几何是**与种子无关的 —— 1000 个种子的矩形逐项相同。v4 里房间尺寸随
    //    种子变（档位），所以那时只能拿「换一种关别配置」来对比；现在可以直接
    //    扫种子。
    // ② 关别抽签**不许碰几何** —— 这是 v5 的架构决定（`plan` 管房子、`seed` 管内容），
    //    而违反它的形态很隐蔽：某天有人在「关别是精英关」时把房间挑大一点，
    //    两边都能跑，只是几何开始跟着种子动。
    const ref = generateDungeon(SEEDS[0]!, cfg, plan)
    const geometry = mapGeometry(ref)
    let sawDifferentKinds = false
    for (const seed of SEEDS.slice(1, 200)) {
      const map = generateDungeon(seed, cfg, plan)
      expect(geometryOf(map), `种子 ${seed}：几何跟着种子变了`).toEqual(geometryOf(ref))
      expect(map.passages, `种子 ${seed}`).toEqual(ref.passages)
      expect(map.walls, `种子 ${seed}`).toEqual(ref.walls)
      expect(map.bounds, `种子 ${seed}`).toEqual(ref.bounds)
      if (mapGeometry(map) !== geometry) sawDifferentKinds = true
    }
    expect(sawDifferentKinds, '200 个种子的关别分配全都一样 —— 上面那堆恒真').toBe(true)
  })

  it('非战斗房三空、战斗房基本都有桌椅 —— 1000 个种子', () => {
    let combatRooms = 0
    let combatRoomsWithDesks = 0
    let nonCombatRooms = 0
    for (const seed of SEEDS) {
      for (const r of generateDungeon(seed, cfg, plan).rooms) {
        const where = `种子 ${seed} 房间 ${r.id}（${r.kind}）`
        if (isCombatKind(cfg, r.kind)) {
          combatRooms++
          if (r.obstacles.length > 0) combatRoomsWithDesks++
        } else {
          nonCombatRooms++
          expect(r.obstacles.length, `${where} 摆着桌椅`).toBe(0)
          expect(r.spawnPoints.length, `${where} 有刷怪点`).toBe(0)
          expect(r.budget, `${where} 还留着预算`).toBe(0)
        }
      }
    }
    expect(nonCombatRooms, '真表里道具关/宝箱关一间都没抽到？').toBeGreaterThan(0)

    // 实测 **9000/9000，100%**（`[读]` 那行）。写成"大于某个比例"是首版的写法，
    // 当时的理由抄的是 v4 的顾虑：棋盘格大一点就有空房（小房间 + 门净空圈，
    // `placeObstacles` 里 `nx - 2 < deskWidthCells || ny < unitRows + 2` 那条早返回）。
    // **那份顾虑在这份几何上不成立**，原因很具体：
    //
    // 会摆不下的是**小房间**，而这份平面图上最小的两间 —— `YF612`（9×8 格）与
    // `YF607`（10×11 格）—— **都是 `fixed: reward`**，永远不是战斗房。
    // 能抽到战斗关别的最小一间是 `YF602`（17×18 格）：17−2 = 15 格宽、
    // 18 行远多于「桌一行 + 椅一行 + 前后各留一格」。**结构上就摆得下。**
    //
    // 所以钉成 1：**不是**"希望它是 100%"，是"这份几何下它就该是 100%"。
    // 哪天它红了，先去看是不是有人往 `floor-plan.json` 里加了一间小教室
    // —— 那时要做的判断是"这间够不够当战斗房"，而不是把这条放宽。
    expect(
      combatRoomsWithDesks / combatRooms,
      '战斗房有桌椅的比例（这份几何上应当恒为 1 —— 最小的可抽房间是 17×18 格）',
    ).toBe(1)
    console.log(
      `[读] 1000 个种子：战斗房 ${combatRooms} 间（${((combatRoomsWithDesks / combatRooms) * 100).toFixed(1)}% 有桌椅）、` +
        `非战斗房 ${nonCombatRooms} 间（全部三空）`,
    )
  })

  it('发牌发得**正好**是那一副牌 —— 1000 个种子的关别计数逐项精确', () => {
    // ⚠️ 首版这条叫「每一类关别都没有被饿死」，判据是「实际次数 > 权重比例的一半」。
    // **那个判据是错的**，它把 v5 的机制当成了 v4 的机制：
    //
    // - v4 是**每间房独立按权重抽一次**（12 次有放回抽样），所以实际分布只能
    //   围着期望值抖 —— 那时用"别饿死"这种松判据是对的。
    // - v5 是 `gen/layout.ts` 的 `kindBag`：按最大余数法把权重折成一副
    //   **正好 12 张**的牌再洗。每颗种子的牌**同一个多重集**，只有洗的顺序变。
    //   所以跨种子合计 **必然**等于「配额 × 种子数」，一票不多一票不少。
    //
    // 实测那行 `[读]` 就是证据：4:2:2:2 折成 12 张是 **5:3:2:2**
    // （4.8 : 2.4 : 2.4 : 2.4 取整得 4:2:2:2，剩两张按小数部分补 —— 先补 main(.8)，
    //  再补书写顺序最前的小数 .4，也就是 elite），于是 1000 个种子是
    // 5000 / 3000 / 2000 / 2000。
    // 拿"权重比例"去当期望（4800 / 2400 / 2400 / 2400）会得出
    // 「elite 超发 25%」这个**假结论** —— 而它只是整数化的余数。
    //
    // 期望值直接**问 `kindBag` 要**，不在这里另写一遍最大余数法：
    // 那个算法自己的用例在 `gen/threeRooms.test.ts` 的「正好 12 张的牌」那条
    //（它直接调 `kindBag`、钉它的牌数），在这里抄一份的话，
    // 抄错的那天两边会各说各话，而这条用例会红在生成器上。
    const drawable = plan.rooms.filter((r) => r.fixed === null).length
    const bag = kindBag(cfg.roomKindWeights, drawable)
    expect(bag.length, '牌正好发 12 张 —— 固定关别那几间不占牌').toBe(drawable)

    const quota = new Map<string, number>()
    for (const k of bag) quota.set(k, (quota.get(k) ?? 0) + 1)

    const count = new Map<string, number>()
    let dealt = 0
    for (const seed of SEEDS) {
      for (const r of generateDungeon(seed, cfg, plan).rooms) {
        if (r.kind === 'start' || r.kind === 'boss') continue
        if (FIXED.some((f) => f.id === r.id)) continue
        dealt++
        count.set(r.kind, (count.get(r.kind) ?? 0) + 1)
      }
    }
    expect(dealt, '每颗种子发 12 张').toBe(drawable * SEEDS.length)

    const report: string[] = []
    for (const kind of Object.keys(cfg.roomKindWeights)) {
      const want = (quota.get(kind) ?? 0) * SEEDS.length
      const got = count.get(kind) ?? 0
      report.push(`${kind}: ${got}（配额 ${quota.get(kind) ?? 0}/副，共 ${want}）`)
      expect(got, `${kind} 发出去的张数（每副牌里是固定的 ${quota.get(kind) ?? 0} 张）`).toBe(want)
    }
    // 牌里不该出现权重表以外的关别 —— `kindBag` 只可能发写入的键，
    // 所以这一条守的是**发牌之后**有人又改了 kind（比如兜底的 `?? 'main'` 兜错了）。
    for (const kind of count.keys()) {
      expect(quota.has(kind), `发出来的「${kind}」不在这副牌里`).toBe(true)
    }
    console.log(`[读] 每副牌 ${drawable} 张 × ${SEEDS.length} 颗种子 = ${dealt} —— ${report.join('，')}`)
  })

  // --------------------------------------------------------------- 桌椅组

  it('每张桌配一把椅子，椅子贴桌子正下方、且在桌子那一跨里 —— 200 个种子', () => {
    // 这一条与校验器那条是**同一个事实的两个方向**：校验器守"别处塞进来的坏家具"，
    // 这里守"生成器自己吐出来的就是成组的"。`furnitureUnits` 找不到椅子会抛，
    // 所以它本身就是一条断言；再显式比一次桌/椅数量，是防"两件都没了"这种同时漏掉的形态。
    for (const seed of SEEDS.slice(0, 200)) {
      for (const room of generateDungeon(seed, cfg, plan).rooms) {
        const where = `种子 ${seed} 房间 ${room.id}（${room.kind}）`
        const units = furnitureUnits(room)
        const counted = countObstacles(room.obstacles)
        expect(counted.desk, `${where} 桌/椅数量不对`).toBe(counted.chair)
        expect(units.length, `${where} 桌椅组数 ≠ 桌子数`).toBe(counted.desk)
        for (const u of units) {
          // 桌宽是一个**区间**（每组抽一次）—— 见 `gen/obstacles.ts`
          expect(u.desk.width, `${where} 桌宽`).toBeGreaterThanOrEqual(
            cfg.deskWidthCells * cfg.navCellSize,
          )
          expect(u.desk.width, `${where} 桌宽`).toBeLessThanOrEqual(
            cfg.deskWidthCellsMax * cfg.navCellSize,
          )
          expect(u.desk.height, `${where} 桌高`).toBe(cfg.deskHeightCells * cfg.navCellSize)
          expect(u.chair.width, `${where} 椅宽`).toBe(cfg.navCellSize)
          expect(chairBelongsTo(u.chair, u.desk), `${where} 椅子没贴在桌子正下方`).toBe(true)
        }
      }
    }
  })

  it('桌椅都落在房间矩形里 —— 不越界', () => {
    // ⚠️ 2026-10-16：桌椅从「成排、整块居中铺满」改成「**摆几组、散着摆、桌长逐组抽**」。
    //    原来那条「左右上下留的走道一样宽」测的就是居中本身，居中一取消它自然不成立 ——
    //    但它真正要防的东西还在，而且更重要：**桌椅不许越出房间**。
    //
    // ★ v5 又改了一层：房间矩形**就是**可走格跨度，墙在房间**外面**那一格。
    //    v4 的矩形含墙（墙骑在四条边上、各吃半层），所以那时判的是 `left + wt/2`。
    //    照旧式子判的话，一整圈桌子的边界都会被判成越界 —— 而那是对的几何。
    for (const seed of SEEDS.slice(0, 200)) {
      for (const room of generateDungeon(seed, cfg, plan).rooms) {
        for (const o of room.obstacles) {
          const tag = `种子 ${seed} ${room.id} 的 ${o.kind}`
          expect(left(o.rect), `${tag} 越出左边界`).toBeGreaterThanOrEqual(left(room.rect))
          expect(right(o.rect), `${tag} 越出右边界`).toBeLessThanOrEqual(right(room.rect))
          expect(top(o.rect), `${tag} 越出上边界`).toBeGreaterThanOrEqual(top(room.rect))
          expect(bottom(o.rect), `${tag} 越出下边界`).toBeLessThanOrEqual(bottom(room.rect))
        }
      }
    }
  })

  it('桌椅落在房间里 —— 拿平面图上没有的尺寸再扫一遍', () => {
    // 上一条扫的是**真几何**（平面图上那 16 间）；这一条拿一堆**不在平面上**的尺寸
    // 直接调 `placeObstacles`，理由与 v4 那条一样：`floor-plan.json` 改一次尺寸
    // 不会有人想起这张表，而摆位函数里「占地多少算放得下」的那些边界条件
    // 恰恰只在极端尺寸上才走得到。
    const bare = (w: number, h: number): Room => ({
      id: 'TEST',
      order: 0,
      kind: 'main',
      rect: { x: w / 2, y: h / 2, width: w, height: h },
      doors: [],
      obstacles: [],
      spawnPoints: [],
      budget: 1,
    })
    // 最窄的那两档（教休室 360×320 / 楼梯间 440×880）、中间档、最大档，
    // 外加一个比平面图上任何一间都小的（240×240）。
    const sizes = [
      [240, 240],
      [360, 320],
      [440, 880],
      [1000, 720],
      [1320, 1040],
      [1800, 960],
      [2400, 1200],
    ] as const
    let placed = 0
    for (const [w, h] of sizes) {
      for (const seed of [1, 2, 3, 13, 837]) {
        const room = bare(w, h)
        for (const o of placeObstacles(seed, cfg, room)) {
          placed++
          expect(left(o.rect), `${w}×${h} 种 ${seed} 越出左边界`).toBeGreaterThanOrEqual(
            left(room.rect),
          )
          expect(right(o.rect), `${w}×${h} 种 ${seed} 越出右边界`).toBeLessThanOrEqual(
            right(room.rect),
          )
          expect(top(o.rect), `${w}×${h} 种 ${seed} 越出上边界`).toBeGreaterThanOrEqual(
            top(room.rect),
          )
          expect(bottom(o.rect), `${w}×${h} 种 ${seed} 越出下边界`).toBeLessThanOrEqual(
            bottom(room.rect),
          )
        }
      }
    }
    expect(placed, '七个尺寸 35 次调用一件家具都没摆下 —— 这条用例白跑了').toBeGreaterThan(0)
  })

  it('组与组不重叠 —— 散着摆最怕的就是两张桌贴成一条更长的墙', () => {
    // ⚠️ 原来是「排数由房间高度封顶」：成排摆位时「排」是个有意义的量，散着摆之后没有了。
    //    换成散摆真正会出的那个错：**两组离得太近**，视觉上长成一条过不去的长墙。
    const cell = cfg.navCellSize
    for (const seed of SEEDS.slice(0, 200)) {
      for (const room of generateDungeon(seed, cfg, plan).rooms) {
        const units = furnitureUnits(room)
        for (let i = 0; i < units.length; i++) {
          for (let j = i + 1; j < units.length; j++) {
            const a = units[i]!
            const b = units[j]!
            const aBox = {
              x: left(a.desk),
              y: top(a.desk),
              width: a.desk.width,
              height: bottom(a.chair) - top(a.desk),
            }
            const bBox = {
              x: left(b.desk),
              y: top(b.desk),
              width: b.desk.width,
              height: bottom(b.chair) - top(b.desk),
            }
            const gapX = Math.max(aBox.x - (bBox.x + bBox.width), bBox.x - (aBox.x + aBox.width))
            const gapY = Math.max(aBox.y - (bBox.y + bBox.height), bBox.y - (aBox.y + aBox.height))
            // 两组要么横向分开 ≥ deskGapCells 格，要么纵向分开 ≥ 1 组的高度
            expect(
              gapX >= cfg.deskGapCells * cell - 1e-6 || gapY >= -1e-6,
              `种子 ${seed} 房间 ${room.id}：第 ${i + 1} 组与第 ${j + 1} 组贴得太近（横向差 ${gapX.toFixed(0)}px）`,
            ).toBe(true)
          }
        }
      }
    }
  })

  it('1000 次生成没有长尾（单次最慢 < 50ms）', () => {
    const worst = { seed: -1, ms: 0 }
    let total = 0
    for (const seed of SEEDS) {
      const t0 = performance.now()
      generateDungeon(seed, cfg, plan)
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
    expect(
      worst.ms,
      `最慢的是种子 ${worst.seed}，${worst.ms.toFixed(1)}ms；1000 次共 ${total.toFixed(0)}ms`,
    ).toBeLessThan(50)
  })

  it('耗时读数是真的（不传时钟时为 0，传了就有值）', () => {
    expect(generateDungeon(1, cfg, plan).elapsedMs).toBe(0)
    const map = generateDungeon(1, cfg, plan, () => performance.now())
    expect(map.elapsedMs).toBeGreaterThanOrEqual(0)
  })
})

/** 关别分配（与几何无关的那一半），拿去比「换种子有没有换掉关别」。 */
function mapGeometry(map: DungeonMap): string {
  return map.rooms.map((r) => `${r.id}:${r.kind}`).join('|')
}