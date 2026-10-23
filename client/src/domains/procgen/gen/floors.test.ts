/**
 * **一局的楼层表**：`floors.json`（第几层走哪张平面图）。
 *
 * 用户 2026-10-22：「YF3 地图加入到游戏里，进入游戏先是 YF3，下一层是 YF6」——
 * ★ 晚一点改成「进去后先是 YF1，然后可以从楼梯间上一层，进入 YF3（YF2 还没做，
 * 先这样上 3 过渡）」。所以今天是**三层三张图**：`[yf1, yf3, 6f]`。
 * 这个文件守的就是那句话 —— 以及它成立所依赖的**四件别人看不见的事**：
 *
 * | # | 前提 | 破了之后的样子 |
 * |---|---|---|
 * | 1 | 条数 = `combat.json` 的 `arena.maxStages` | 一局三层而表里两项 ⇒ 第 3 层拿不到图（今天由 `parseFloorsConfig` 当场抛） |
 * | 2 | 每个文件名都在 `FLOOR_PLAN_FILES` 里（= preload 真的加载过） | 第 1 层一进去就是 `undefined`，报出来的是「schemaVersion 不是整数」 |
 * | 3 | **每一层的包围盒一模一样** | 换层时 `BattleScene.applyArena()` 抛（物理世界边界在构造时定死） |
 * | 4 | **最后一层有首领房** | 三层全是空房 / 商店 ⇒ 永远打不出首领 ⇒ 通不了关（不报错，只是没有结局） |
 *
 * 四条都是**无声的**：配置表各自都合法、生成器一声不吭，代价在「玩到第 2 层」时才付。
 * 所以它们在这里逐条钉住，而不是写在 `floors.json` 的注释里 —— 注释不会红。
 *
 * ## 为什么这里读得到 `combat.json`
 *
 * 第 1 条是**跨域的约定**（D2 的表 vs D1 的「一局几层」），两边各有一个真值，
 * 所以它只能在一个看得见两边的地方验。读的是 D1 **自己的解析器**而不是
 * `JSON.parse(...).arena.maxStages`：后者是照着字段名抄近路，D1 换个字段名时
 * 它读到 `undefined`，于是 `floors.length !== undefined` 恒真、**这条测试变成哑的**。
 * 运行时没有跨域调用被引入（D1 单向读 D2 的表，方向没变）。
 *
 * 这里读的是**真的那两份文件**，种子写死：与 `generate.test.ts` 同一个手法、
 * 同一个理由（失败要能复跑）。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { ConfigError } from '@/core/config'
import { parseCombatConfig } from '@/domains/combat/config'
import { FLOORS_CONFIG_NAME, parseFloorsConfig, parseRoomsConfig, type RoomsConfig } from '../config'
import {
  FLOOR_PLAN_FILES,
  FLOOR_PLAN_NAME,
  FLOOR_PLAN_YF1_NAME,
  FLOOR_PLAN_YF2_NAME,
  FLOOR_PLAN_YF3_NAME,
  floorPlansForRun,
  type FloorPlan,
} from './floorPlan'
import { generateDungeon } from './generate'
import { validateContract } from '../validate/contract'

const CONFIG_DIR = fileURLToPath(new URL('../../../../public/config/', import.meta.url))
const RAW: Record<string, unknown> = {}
const readJson = (name: string): unknown => {
  const hit = RAW[name]
  if (hit !== undefined) return hit
  const parsed: unknown = JSON.parse(readFileSync(CONFIG_DIR + name, 'utf8'))
  RAW[name] = parsed
  return parsed
}

const cfg: RoomsConfig = parseRoomsConfig(readJson('rooms.json'))

/** D1 的配置，只为拿 `arena.maxStages`（一局几层）。 */
const d1 = parseCombatConfig(readJson('combat.json'))
const MAX_STAGES = d1.arena.maxStages

/**
 * `floorPlansForRun` 要的那个「缓存」—— 产品的 `cache.json` 就长这样（一个 `get`）。
 * 这里换成了「按名字现读磁盘」，于是**加载清单里写的每个文件都真的读得到**，
 * 而「表里写了一个没人加载的名字」这种情况由 `floorPlansForRun()` 自己拦。
 */
const cache = { get: (key: string): unknown => readJson(key) }

/** 产品那条路：`floors.json` → 每一层一份已解析的平面图。 */
const plans: readonly FloorPlan[] = floorPlansForRun(cache, cfg, MAX_STAGES)

describe('一局的楼层表（floors.json）', () => {
  it('条数 MUST 等于 combat.json 的 arena.maxStages —— 对不上时当场抛，不静默跑', () => {
    expect(parseFloorsConfig(readJson(FLOORS_CONFIG_NAME), MAX_STAGES).floors).toHaveLength(
      MAX_STAGES,
    )
    // 少一层、多一层都要拦：多的是「多的那层永远走不到」（无害但说明有人改错了一边），
    // 少的是「第 3 层没有图」。
    expect(() => parseFloorsConfig(readJson(FLOORS_CONFIG_NAME), MAX_STAGES + 1)).toThrow(ConfigError)
    expect(() => parseFloorsConfig(readJson(FLOORS_CONFIG_NAME), MAX_STAGES - 1)).toThrow(ConfigError)
  })

  it('用户要的顺序：**1F → 2F → 3F → 6F**（最后一层是 6F）', () => {
    // ★ 改了（2026-10-23）：2F 的图做出来了，一局从三层变四层 ——
    // 用户：「按照照片做 YF2 的地图」「YF1 上去是 YF2」。上一版是 [yf1, yf3, 6f]
    // （YF2 还没有，先拿 3F 过渡）。
    // 最后一项是**最后一层** —— 首领关（YF604）在它上面，见下面那条「最后一层必须有首领房」。
    expect(parseFloorsConfig(readJson(FLOORS_CONFIG_NAME), MAX_STAGES).floors).toEqual([
      FLOOR_PLAN_YF1_NAME,
      FLOOR_PLAN_YF2_NAME,
      FLOOR_PLAN_YF3_NAME,
      FLOOR_PLAN_NAME,
    ])
  })

  it('每一项都被 preload 加载过（在 FLOOR_PLAN_FILES 里）—— 写在表里而没加载 = 第 1 层就是 undefined', () => {
    for (const name of parseFloorsConfig(readJson(FLOORS_CONFIG_NAME), MAX_STAGES).floors) {
      expect(FLOOR_PLAN_FILES, `${name} 不在 FLOOR_PLAN_FILES 里`).toContain(name)
    }
    // 反向：加载清单里也不该有**谁都不用的**图（那只是每次开屏多下一份文件）。
    // ⚠️ 今天**三张都被用上**（1F / 3F / 6F 各占一层）。将来加第 4 张图时，这条会
    //    逼着人同时把它排进 floors.json —— 那正是想要的：加载清单与楼层表不许
    //    各说各的。（★ 改了 2026-10-22 晚：上一版写的是「今天两张都被用上
    //    （6F 是第 2/3 层）」，三层三张图之后那句话早就不对了。）
    const used = new Set(parseFloorsConfig(readJson(FLOORS_CONFIG_NAME), MAX_STAGES).floors)
    expect([...FLOOR_PLAN_FILES].filter((n) => !used.has(n))).toEqual([])
  })

  it('每一项都解析得出来，且**间数写在它自己身上**（四层楼各不相同）', () => {
    expect(plans).toHaveLength(MAX_STAGES)
    // ★ 改了（2026-10-23）：**四层**了 —— 2F 这一层 9 间编号教室 + 3 电梯间 + 楼梯间 = 13。
    // 四个数仍然**互不相同**（13 / 17 / 18 / 19）：一个全局常量配不了四层。
    expect(plans[0]!.roomTotal).toBe(17) // 逸夫楼 1F：13 间编号教室 + 3 电梯间 + 楼梯间
    expect(plans[0]!.rooms.length + 1).toBe(plans[0]!.roomTotal)
    expect(plans[1]!.roomTotal).toBe(13) // 2F：9 间编号教室 + 3 电梯间 + 楼梯间
    expect(plans[1]!.rooms.length + 1).toBe(plans[1]!.roomTotal)
    expect(plans[2]!.roomTotal).toBe(18) // 3F：13 间编号教室 + 商店 + 3 电梯间 + 楼梯间
    expect(plans[3]!.roomTotal).toBe(19) // 6F：15 间编号教室 + 3 电梯间 + 楼梯间
    expect(new Set(plans.map((p) => p.roomTotal)).size).toBe(4)

    // 反向证据①：层数对不上时先说「两个文件」，不是闷头往下取。
    expect(() => floorPlansForRun(cache, cfg, MAX_STAGES + 1)).toThrow(/maxStages/)

    // 反向证据②：**表里写了一个没人加载的文件名**（条数是对的，所以只有这一条拦得住）。
    // 报错必须指回 `FLOOR_PLAN_FILES` —— 不拦的话 `cache.get()` 给一个 `undefined`，
    // 一路走到底报出来的是「floorPlan.schemaVersion 要一个整数，拿到 undefined」，
    // 而那句话把人指向**平面图写错了**，真正的病因一个字都没提。
    //
    // ⚠️ 缺的那个 key 必须交 `undefined`，**不能顺手落到 `readJson` 上** ——
    //    那个函数对不存在的文件是 `readFileSync` 直接抛 `ENOENT`，而**真缓存对缺 key
    //    给的是 `undefined`**（`cache.json.get`）。让它抛的话，这条测试守的就变成了
    //    「`readFileSync` 会不会抛」，报出来的是 `ENOENT`，而该守的那句
    //    「指回 `FLOOR_PLAN_FILES`」一个字都验不到 —— 一条绿着的哑测试。
    const GHOST_PLAN = 'floor-plan-4f.json'
    const ghost = {
      ...(readJson(FLOORS_CONFIG_NAME) as Record<string, unknown>),
      // 4 项（= 今天的 MAX_STAGES），其中第 2 项是个没人加载的文件名
      floors: [FLOOR_PLAN_YF1_NAME, GHOST_PLAN, FLOOR_PLAN_YF3_NAME, FLOOR_PLAN_NAME],
    }
    const ghostCache = {
      get: (k: string): unknown =>
        k === FLOORS_CONFIG_NAME ? ghost : k === GHOST_PLAN ? undefined : readJson(k),
    }
    expect(() => floorPlansForRun(ghostCache, cfg, MAX_STAGES)).toThrow(/FLOOR_PLAN_FILES/)
  })

  it('**每一层的外框一模一样** —— 换层时 applyArena() 的前提', () => {
    // 物理世界边界、寻路网格的行列数、`TerrainMap` 的宽高都在 `CombatSession`
    // 构造时读走，之后改不了 —— 于是「三层楼拼一局」这件事成立的前提是
    // **每层一样大**。三张图的差别都在楼内（1F 是两块拼的、3F 西头两间并成了
    // 商店、6F 是原样），整层 0..263 × 0..73 格一模一样。
    //
    // ★ 改了（2026-10-22 晚）：这个外框现在是平面图里**声明**的 `footprint`，
    //    不再由所有空间的并集推出来（`boundsOf` 已删）。**这条用例因此从
    //    「三层恰好一样」升级成「三层声明得一样」** —— 上一版它其实是靠
    //    「三层的房间都铺到了楼的边上」间接成立的，而 1F 的房间从 y25 起
    //    （楼的最北一条带在那一层是墙），推出来会矮 25 格。
    const first = plans[0]!.bounds
    for (const [i, p] of plans.entries()) {
      expect(p.bounds, `第 ${i + 1} 层（${FLOOR_PLAN_FILES.join('/')}）`).toEqual(first)
      expect(p.cols).toBe(plans[0]!.cols)
      expect(p.rows).toBe(plans[0]!.rows)
    }
    expect([plans[0]!.cols, plans[0]!.rows]).toEqual([263, 73]) // 楼的尺寸（格）
    // 反向证据①：这条判据今天**不是**恒真的 —— 四张图的房间数就不一样。
    expect(new Set(plans.map((p) => p.rooms.length)).size).toBe(4)
    // 反向证据②（★ 新增）：外框也不再恒等于「房间的并集」—— 1F 的**房间**
    // 从 y25 起，另外两层从 y0 起。所以这条用例守的确实是那个声明值，
    // 而不是顺手又验了一遍推导。
    // ⚠️ 这里只看**房间**（+ 楼梯间），不看走廊：★ 2026-10-22 晚·六之后，1F
    // 大厅的北端（`C_HALL` / `C_N`）伸到了 y0，把空间并集又撑回了整高 ——
    // 但那走廊是**内容**，外框是**楼**。哪天大厅收回去，并集又会矮 25 格。
    const minRoomY = (p: (typeof plans)[number]): number =>
      Math.min(...[p.stairwell, ...p.rooms].map((s) => s.cells.y))
    // 2F 的 YF201 也从 y25 起（它是西头那一整块竖长的房），
    // 所以四层的「最北一间房」是 [25, 25, 0, 0]。
    expect(plans.map(minRoomY)).toEqual([25, 25, 0, 0])
  })

  it('三层都生成得出来、且过契约校验 —— 楼层表里的每一层真的能玩', () => {
    // `validateContract` 的第三个参数（这一层应当有几间）**逐层取** ——
    // 这正是 2026-10-22 把它从全局常量改成参数的原因：三层楼间数不同。
    for (const seed of [1, 13, 20261022]) {
      for (const [i, plan] of plans.entries()) {
        const map = generateDungeon(seed, cfg, plan)
        expect(map.rooms, `第 ${i + 1} 层 seed ${seed}`).toHaveLength(plan.roomTotal)
        expect(
          () => validateContract(map, cfg, plan.roomTotal),
          `第 ${i + 1} 层 seed ${seed}`,
        ).not.toThrow()
      }
    }
  })

  it('★ **最后一层必须有首领房** —— 没有它这一局永远打不出结局', () => {
    // ⚠️ 这条原先是 `validate/contract.ts` 里那句「首领房**恰好** 1 间」的
    //    后半截。2026-10-22 晚放宽成「至多 1 间」之后（用户给第 1 层的要求是
    //    「所有房间都是空房间」，那一层因此一间首领都没有），这句话**不能跟着
    //    一起消失** —— 它只是从「每张图」搬到了「一局的最后一层」：
    //    最后一层打不出首领 ⇒ `finishRun()` 永远不触发 ⇒ 通关结算不出现，
    //    而玩家会把整层翻遍找一间不存在的首领房（没有任何报错）。
    //
    // 判据用**生成结果**而不是 `fixed` 字段：首领也可以是抽出来的
    // （今天 `roomKindWeights` 明令不许出现 boss，但那是配置层的另一条规矩）。
    for (const seed of [1, 13, 20261022]) {
      const last = plans[plans.length - 1]!
      const map = generateDungeon(seed, cfg, last)
      expect(
        map.rooms.filter((r) => r.kind === 'boss').map((r) => r.id),
        `最后一层 seed ${seed} 的首领房`,
      ).toHaveLength(1)
    }
    // 反向证据：这条判据今天**不是**恒真的 —— 第 1 层一间都没有（用户要的空房层），
    // 所以「每层都有首领」是一种**会被这条测试放过去、但那层确实没有**的写法。
    const first = generateDungeon(1, cfg, plans[0]!)
    expect(first.rooms.filter((r) => r.kind === 'boss')).toHaveLength(0)
  })

  it('三层的房号**只在楼梯间上重合** —— 顺手证明第 3 层不再是 6F 的复制品', () => {
    const ids = (p: FloorPlan): string[] => [p.stairwell, ...p.rooms].map((r) => r.id)
    const first = new Set(ids(plans[0]!))
    // 楼梯间三层同名（`STAIR`）是有意的：它就是「上下楼的那个地方」，
    // 而它**不打怪、不给强化、不记进度**，同名不会串。
    // ★ 改了（2026-10-22 晚·七）：**三个电梯间也三层同名**（`E_A` / `E_B` / `E_C`）——
    // 理由与楼梯间一模一样：它们是**同一部电梯在三层的同一个位置**，也是设施。
    // 它们同样不打怪、不给强化、不记进度（`kind = 'elevator'`，不在 `combatKinds` 里）。
    const facilities = ['E_A', 'E_B', 'E_C', 'STAIR']
    expect(ids(plans[1]!).filter((id) => first.has(id)).sort()).toEqual(facilities)
    expect(ids(plans[2]!).filter((id) => first.has(id)).sort()).toEqual(facilities)
    // ⚠️ ★ 改了（2026-10-22 晚）：这一段原先是**另一条用例**
    //    （「第 2、3 层是同一张图」），它守的是「按房号的记账必须按层清」这件事
    //    还在 —— 那时第 2、3 层都是 6F，房号一模一样。现在三层三张图，
    //    **房号不再跨层重复了**，但那条记账**照旧不能删**：`visited` / `cleared` /
    //    `combatRooms` 记的是 `order`（每层重排的 0、1、2…），三层逐层撞号。
    //    理由写在了 `BattleScene.loadFloor()` 那一段上，不在这里重复。
    expect(ids(plans[1]!)).not.toEqual(ids(plans[2]!))
  })
})