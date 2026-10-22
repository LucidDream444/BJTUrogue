/**
 * **一局的楼层表**：`floors.json`（第几层走哪张平面图）。
 *
 * 用户 2026-10-22：「YF3 地图加入到游戏里，进入游戏先是 YF3，下一层是 YF6」。
 * 这个文件守的就是那句话 —— 以及它成立所依赖的**三件别人看不见的事**：
 *
 * | # | 前提 | 破了之后的样子 |
 * |---|---|---|
 * | 1 | 条数 = `combat.json` 的 `arena.maxStages` | 一局三层而表里两项 ⇒ 第 3 层拿不到图（今天由 `parseFloorsConfig` 当场抛） |
 * | 2 | 每个文件名都在 `FLOOR_PLAN_FILES` 里（= preload 真的加载过） | 第 1 层一进去就是 `undefined`，报出来的是「schemaVersion 不是整数」 |
 * | 3 | **每一层的包围盒一模一样** | 换层时 `BattleScene.applyArena()` 抛（物理世界边界在构造时定死） |
 *
 * 三条都是**无声的**：配置表各自都合法、生成器一声不吭，代价在「玩到第 2 层」时才付。
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

  it('用户要的顺序：**第 1 层是逸夫楼 3F**，第 2 层是 6F', () => {
    expect(parseFloorsConfig(readJson(FLOORS_CONFIG_NAME), MAX_STAGES).floors[0]).toBe(
      FLOOR_PLAN_YF3_NAME,
    )
    expect(parseFloorsConfig(readJson(FLOORS_CONFIG_NAME), MAX_STAGES).floors[1]).toBe(
      FLOOR_PLAN_NAME,
    )
  })

  it('每一项都被 preload 加载过（在 FLOOR_PLAN_FILES 里）—— 写在表里而没加载 = 第 1 层就是 undefined', () => {
    for (const name of parseFloorsConfig(readJson(FLOORS_CONFIG_NAME), MAX_STAGES).floors) {
      expect(FLOOR_PLAN_FILES, `${name} 不在 FLOOR_PLAN_FILES 里`).toContain(name)
    }
    // 反向：加载清单里也不该有**谁都不用的**图（那只是每次开屏多下一份文件）。
    // ⚠️ 今天两张都被用上（6F 是第 2/3 层）。将来加第 3 张图时，这条会逼着人
    //    同时把它排进 floors.json —— 那正是想要的：加载清单与楼层表不许各说各的。
    const used = new Set(parseFloorsConfig(readJson(FLOORS_CONFIG_NAME), MAX_STAGES).floors)
    expect([...FLOOR_PLAN_FILES].filter((n) => !used.has(n))).toEqual([])
  })

  it('每一项都解析得出来，且**间数写在它自己身上**（两层楼不同）', () => {
    expect(plans).toHaveLength(MAX_STAGES)
    expect(plans[0]!.roomTotal).toBe(15) // 逸夫楼 3F：13 间编号教室 + 商店 + 楼梯间
    expect(plans[0]!.rooms.length + 1).toBe(plans[0]!.roomTotal)
    expect(plans[1]!.roomTotal).toBe(16) // 6F：15 间编号教室 + 楼梯间

    // 反向证据①：层数对不上时先说「两个文件」，不是闷头往下取。
    expect(() => floorPlansForRun(cache, cfg, MAX_STAGES + 1)).toThrow(/maxStages/)

    // 反向证据②：**表里写了一个没人加载的文件名**（条数是对的，所以只有这一条拦得住）。
    // 报错必须指回 `FLOOR_PLAN_FILES` —— 不拦的话 `cache.get()` 给一个 `undefined`，
    // 一路走到底报出来的是「floorPlan.schemaVersion 要一个整数，拿到 undefined」，
    // 而那句话把人指向**平面图写错了**，真正的病因一个字都没提。
    const ghost = {
      ...(readJson(FLOORS_CONFIG_NAME) as Record<string, unknown>),
      floors: [FLOOR_PLAN_YF3_NAME, 'floor-plan-4f.json', FLOOR_PLAN_NAME],
    }
    const ghostCache = { get: (k: string): unknown => (k === FLOORS_CONFIG_NAME ? ghost : readJson(k)) }
    expect(() => floorPlansForRun(ghostCache, cfg, MAX_STAGES)).toThrow(/FLOOR_PLAN_FILES/)
  })

  it('**每一层的包围盒一模一样** —— 换层时 applyArena() 的前提', () => {
    // 物理世界边界、寻路网格的行列数、`TerrainMap` 的宽高都在 `CombatSession`
    // 构造时读走，之后改不了 —— 于是「几千层楼拼一局」这件事成立的前提是
    // **每层一样大**。今天 YF3 与 6F 的差别只在西头那块（两间并一间），
    // 整层 0..263 × 0..73 格一模一样。
    const first = plans[0]!.bounds
    for (const [i, p] of plans.entries()) {
      expect(p.bounds, `第 ${i + 1} 层（${FLOOR_PLAN_FILES.join('/')}）`).toEqual(first)
      expect(p.cols).toBe(plans[0]!.cols)
      expect(p.rows).toBe(plans[0]!.rows)
    }
    // 反向证据：这条判据今天**不是**恒真的 —— 两张图的房间数就不一样。
    expect(plans[0]!.rooms.length).not.toBe(plans[1]!.rooms.length)
  })

  it('两层都生成得出来、且过契约校验 —— 楼层表里的每一层真的能玩', () => {
    // `validateContract` 的第三个参数（这一层应当有几间）**逐层取** ——
    // 这正是 2026-10-22 把它从全局常量改成参数的原因：两层楼间数不同。
    for (const seed of [1, 13, 20261022]) {
      for (const [i, plan] of plans.entries()) {
        const map = generateDungeon(seed, cfg, plan)
        expect(map.rooms, `第 ${i + 1} 层 seed ${seed}`).toHaveLength(plan.roomTotal)
        expect(
          () => validateContract(map, cfg, plan.roomTotal),
          `第 ${i + 1} 层 seed ${seed}`,
        ).not.toThrow()
        // 首领恒有且只有一间 —— 少一间这一层就没有出口（不报错，只是走不了）
        expect(map.rooms.filter((r) => r.kind === 'boss')).toHaveLength(1)
      }
    }
  })

  it('第 1 层与第 2 层的房号**只在楼梯间上重合**', () => {
    const ids = (p: FloorPlan): string[] => [p.stairwell, ...p.rooms].map((r) => r.id)
    const first = new Set(ids(plans[0]!))
    const both = ids(plans[1]!).filter((id) => first.has(id))
    // 楼梯间两层同名（`STAIR`）是有意的：它就是「上下楼的那个地方」，
    // 而它**不打怪、不给强化、不记进度**，同名不会串。
    expect(both).toEqual(['STAIR'])
  })

  it('第 2、3 层是同一张图 —— 所以「按房号的记账必须按层清」这件事还在', () => {
    // `floors.json` 的 `_today_comment`：手头只有两张图，第 2、3 层都排 6F。
    // 这不是随手写的一句 —— `BattleScene.loadFloor()` 里那一串「清 visited /
    // cleared / lootedRooms / rewards.forgetFloor()」的理由正是**房号跨层重复**：
    // 不清的话第 3 层清完 `YF604` 时强化账本说「这间给过了」，于是三选一不弹
    // ⇒ `reward_finished` 不发 ⇒ **下楼口不亮，卡死在第 3 层**。
    // 哪天第 3 层换成另一张图，这条会红 —— 那时**别急着删它**，
    // 先看 `RewardRun.forgetFloor()` 是否还该留着（答案是：该，防御的是同一类错）。
    expect(parseFloorsConfig(readJson(FLOORS_CONFIG_NAME), MAX_STAGES).floors[2]).toBe(
      parseFloorsConfig(readJson(FLOORS_CONFIG_NAME), MAX_STAGES).floors[1],
    )
    const ids = (p: FloorPlan): Set<string> => new Set([p.stairwell, ...p.rooms].map((r) => r.id))
    const second = ids(plans[1]!)
    expect([...ids(plans[2]!)].filter((id) => second.has(id)).sort()).toEqual(
      [...second].sort(),
    )
  })
})