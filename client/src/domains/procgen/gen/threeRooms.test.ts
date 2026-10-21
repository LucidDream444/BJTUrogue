/**
 * **整层 16 间房的几种扫描。**
 *
 * ⚠️ 文件名叫 `threeRooms` 是**沿革**：v4 的主题是「三间小图」—— 靠
 * `roomsConfigWithRoomCount(cache, 3)` 现改出一张三间房的配置表。v5 里那个函数
 * **整个删了**：每一层固定 16 间（15 间编号教室 + 1 间楼梯间），几何由
 * `floor-plan.json` 画死，「把一层改成 N 间」这件事不存在了。所以这一份原地改成
 * **整层的扫描**，名字先留着 —— 「三间」这个概念在 v5 已经没有对应物了，
 * 真正改掉的是内容，改名只会让引用它的地方多一次无谓的同步。
 *
 * 能救活的用例全部重写保留（每一条的注释里都写了 v4→v5 改了什么），
 * 救不活的整条删掉 —— 账目写在这里，不留给下一个人去猜：
 *
 * | v4 的用例 | v5 的下场 |
 * |---|---|
 * | 「就是三间，且三间都在主干上（侧室 0 间）」 | **删**（三间 / 主干 / 侧室都不存在了），由下面「就是那 16 间」取代 |
 * | 「关别是位置推出来的那三个」 | **重写**：关别不再是位置推的，是「3 间写死 + 12 张牌」 |
 * | 「三间都打得起来」 | **重写**：不再要求「每一间都是战斗关别」（v5 固定有 7 间不打），只要求战斗关别都打得起来 |
 * | 「三间都摆得出家具」 | **重写**：分母从「全部房间」改成「战斗房」（非战斗房按设计就是空场地） |
 * | 「三间小图照样过契约校验与可达性」 | **重写**：几何不随种子走了，这一条改守「内容压不坏几何」 |
 * | 「房间数不合法时当场抛」 | **删**（`roomsConfigWithRoomCount` 没了；「配置表与平面图的房间数对账」搬去 `gen/floorPlan.test.ts`） |
 *
 * 它挡的四类错，**一类都不报错**：
 *
 * 1. **几何偷偷跟着种子动** —— 几何是「画」的，种子只该决定内容。哪天有人在
 *    `planLayout` 里顺手把矩形又算了一遍，表现是「同一层每次不一样」——
 *    而这看起来像「这次随机得挺随机」。
 * 2. **关别构成被摇歪** —— 发牌退化成 12 次独立抽签时，某些种子会抽出
 *    一层 10 间道具房：那一局没有仗可打，不抛异常，看上去只是「运气不好」。
 *    写死的三间被兜底成 `main` 也不会报错（2026-10-20 真出过一次）。
 * 3. **空房** —— 战斗关别却没有刷怪点。后果不是报错，是**那一间进门就放行**；
 *    在现场看起来像「门的判定写坏了」，而查门的判定永远查不出来。
 * 4. **空教室** —— 战斗房摆不出桌椅：这一间的家具内容就是空的，
 *    挡不挡路、好不好看全看不出，它只是「这局教室有点空」。
 *
 * 配置**读真文件**（`public/config/rooms.json` 与 `floor-plan.json`）：
 * 另捏一份的话，真配置可以错得离谱而这里全绿。种子**写死**，失败要能复跑。
 *
 * 整层的测试场（今天：`arenas/D2/d2_seeds` 换种子看整层）依赖的就是这些性质；
 * 与 `gen/generate.test.ts` 的分工是：那一份按**性质**细查，这一份按**整层**横扫。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { generateDungeon } from './generate'
import { kindBag } from './layout'
import { FLOOR_ROOM_TOTAL, parseFloorPlan, type FloorPlan } from './floorPlan'
import { isCombatKind, parseRoomsConfig, type RoomsConfig } from '../config'
import { roomNeedsFight } from '../roomFlow'
import { ROOM_KIND_LABELS, roomById, type RoomKind } from '../model/types'
import { validateContract } from '../validate/contract'
import { assertReachable } from '../validate/reachability'

/** 配置目录 —— 与 `colliders.test.ts` 同一个取法（测试从真文件读配置）。 */
const CONFIG_DIR = fileURLToPath(new URL('../../../../public/config/', import.meta.url))

const readJson = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(CONFIG_DIR + name, 'utf8')) as Record<string, unknown>

const cfg: RoomsConfig = parseRoomsConfig(readJson('rooms.json'))

/**
 * 整层楼的几何 —— 与**种子无关**（`floor-plan.json` 画死的 6F 平面图）。
 *
 * ⚠️ 它现在是 `generateDungeon` 的**第三个参数**：几何与内容分了家。
 * 与 `colliders.test.ts` 一样解析**一次**、几百个种子共用一份 ——
 * 放进循环里就是每个种子重解析一遍同一份表，而它一个字节都不会变。
 */
const plan: FloorPlan = parseFloorPlan(readJson('floor-plan.json'), cfg)

/** 批量扫描用的种子。**写死**，见文件头。 */
const SEEDS = Array.from({ length: 500 }, (_, i) => i * 7919 + 13)

/** 关别构成的读法：`main×5 chest×2 ...`（排序后拼串），跨种子比较用。 */
function tally(kinds: readonly RoomKind[]): string {
  const m = new Map<RoomKind, number>()
  for (const k of kinds) m.set(k, (m.get(k) ?? 0) + 1)
  return [...m.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, n]) => `${k}×${n}`)
    .join(' ')
}

describe('D2 整层 16 间房 — 几何是画的，与种子无关', () => {
  it('就是那 16 间：楼梯间打头，其余逐间对应平面图上的教室，走廊照搬平面图', () => {
    // ★ v4→v5：v4 这里数的是「三间」，还查 `mainRooms(map)`（主干数）——
    // 主干道与侧室随 v5 一起没了。这一条取代它，查的是新的事实：
    // `map.rooms` = [楼梯间, ...平面图上的 15 间编号教室]，一间不多、一间不少。
    // 50 个种子就够：这一条查的是**结构**，不是概率性质。
    for (const seed of SEEDS.slice(0, 50)) {
      const map = generateDungeon(seed, cfg, plan)
      expect(map.rooms.length, `种子 ${seed}`).toBe(FLOOR_ROOM_TOTAL)
      expect(map.rooms[0]!.id, `种子 ${seed}：rooms[0] 恒为楼梯间`).toBe(plan.stairwell.id)
      expect(
        map.rooms.map((r) => r.id),
        `种子 ${seed}`,
      ).toEqual([plan.stairwell.id, ...plan.rooms.map((r) => r.id).sort()])
      // `order` 就是下标（显示序），不是进度轴 —— 按它推「先打哪间」是错的
      //（`model/types.ts` 的 ⚠️），但它必须真的等于下标，
      // 否则 `roomByOrder` / 小地图的整数键会静默错位。
      map.rooms.forEach((room, i) => {
        expect(room.order, `种子 ${seed} ${room.id}`).toBe(i)
      })
      // 走廊：段数、顺序、矩形都照平面图（`DungeonMap.passages` 的注释：
      // 「顺序同 floor-plan.json 的 corridors」）。
      expect(
        map.passages.map((p) => `${p.id}@${JSON.stringify(p.rect)}`),
        `种子 ${seed}`,
      ).toEqual(plan.corridors.map((c) => `${c.id}@${JSON.stringify(c.rect)}`))
      // 包围盒是**空间**的并集，不是墙的并集 —— 墙比空间还往外铺 2 格，
      // 拿墙去算会让地图四周凭空多出一圈（`model/types.ts` 的 `bounds` 那条 ⚠️）。
      expect(map.bounds, `种子 ${seed}`).toEqual(plan.bounds)
    }
  })

  it('换种子不换一个像素 —— 边界 / 墙 / 走廊 / 房间矩形与门全等', () => {
    // ★ 这条是 v5 新增的。几何从「算」改成「画」之后，
    // 「同一层楼换个种子长得一样」第一次成为可断言的性质 —— 而它此前**没有守卫**
    //（`gen/generate.ts` 的文件头曾把这条性质指给 `layout.test.ts`，而那份文件
    // 到现在都不在仓库里 —— ★ 2026-10-20 指针改到了这一条）。
    //
    // 取什么：只要**位置**。关别 / 障碍物 / 刷怪点**刻意不在里面** —— 那是种子的工作；
    // 门在，因为门开在哪儿是几何。
    const geomOf = (seed: number): string => {
      const map = generateDungeon(seed, cfg, plan)
      return JSON.stringify({
        bounds: map.bounds,
        walls: map.walls,
        passages: map.passages,
        rooms: map.rooms.map((r) => ({ id: r.id, order: r.order, rect: r.rect, doors: r.doors })),
      })
    }
    const ref = geomOf(SEEDS[0]!)
    for (const seed of SEEDS.slice(1, 8)) {
      expect(geomOf(seed), `种子 ${seed} 与种子 ${SEEDS[0]} 的几何该逐字相同`).toBe(ref)
    }
  })
})

describe('D2 整层 16 间房 — 内容是种子挑的（关别 / 刷怪点 / 桌椅）', () => {
  it('关别：写死的三间照平面图，其余 12 间发一副**正好 12 张**的牌（不是独立抽签）', () => {
    // ★ v4→v5：v4 这里断言 `['start','main','boss']` —— 那时的关别是**位置推出来的**，
    // 三间房各自的位置决定关别。v5 里关别是**发**的：楼梯间恒 `start`、
    // 平面图写死的照抄（`YF604` 恒 `boss`、两间教休室恒 `reward`），
    // 剩下 12 间按 `roomKindWeights` 折成一副牌洗开发（`gen/layout.ts` 的 `kindBag`）。
    // 所以这一条改成三句：「牌数对得上」+「构成跨种子恒定」+「写死的照平面图」。
    const drawable = plan.rooms.filter((r) => r.fixed === null)
    const bag = kindBag(cfg.roomKindWeights, drawable.length)
    // 兜底一对一：牌少一张，就有一间会被 `?? 'main'` 静默兜成普通关
    //（`gen/layout.ts` 的 `assignKinds` 注释里那条 ⚠️）。
    expect(bag.length, `牌数该正好等于待发房间数（${drawable.length}）`).toBe(drawable.length)
    const expected = tally([
      'start',
      ...plan.rooms.flatMap((r) => (r.fixed === null ? [] : [r.fixed])),
      ...bag,
    ])

    const shapes = new Set<string>()
    for (const seed of SEEDS.slice(0, 50)) {
      const map = generateDungeon(seed, cfg, plan)
      // 构成恒定：同一张权重表折出来的牌，换种子只换**谁拿哪一张**。
      expect(tally(map.rooms.map((r) => r.kind)), `种子 ${seed}`).toBe(expected)
      // 写死的几间 —— 特别是 `YF604` 恒 `boss`。2026-10-20 修过一次
      //「fixed 没进表、全部被兜成 main」的静默漏（那一层没有首领），
      // 这一句就是那次修复的证据。
      expect(roomById(map, plan.stairwell.id).kind, `种子 ${seed}`).toBe('start')
      for (const r of plan.rooms) {
        if (r.fixed === null) continue
        expect(roomById(map, r.id).kind, `种子 ${seed} ${r.id}`).toBe(r.fixed)
      }
      shapes.add(map.rooms.map((r) => r.kind).join(','))
    }
    // 反向证据：上面「构成恒定」要是因为生成器**根本没理会种子**而成立，
    // 这里会露馅 —— 50 个种子里至少该出现两种不同的分配。
    expect(shapes.size, '50 个种子里至少该有两种关别分配（种子是不是没被用上？）').toBeGreaterThan(1)
    console.log(
      `[读] 一副牌：${expected}（待发 ${drawable.length} 间 + 写死 ${FLOOR_ROOM_TOTAL - drawable.length} 间）；50 个种子里 ${shapes.size} 种分配`,
    )
  })

  it('间间**打得起来** —— 500 个种子逐间查刷怪点', () => {
    // ★ v4→v5：v4 这一条先断言「每一间都是战斗关别」—— v5 里不存在了，
    // 一层固定有 7 间不打（楼梯间 + 4 间教休/奖励 + 2 间宝箱），那句整条去掉、
    // 改成 `continue`。留下的那句话原样成立：
    // **战斗关别必须有刷怪点** —— 空房不是报错，是那一间进门就放行。
    const empty: string[] = []
    let rooms = 0
    let combat = 0
    for (const seed of SEEDS) {
      const map = generateDungeon(seed, cfg, plan)
      for (const room of map.rooms) {
        rooms++
        if (!isCombatKind(cfg, room.kind)) continue
        combat++
        if (!roomNeedsFight(room, cfg)) {
          empty.push(`种子 ${seed} ${room.id}（${ROOM_KIND_LABELS[room.kind]}）`)
        }
      }
    }
    // 一条都不能有：空房 = 这一间进门就放行，看起来像门判定坏了。
    expect(empty.slice(0, 10)).toEqual([])
    // 反向证据：扫过的房间数对得上（不是空转），且这一层真的有要打的房。
    expect(rooms).toBe(SEEDS.length * FLOOR_ROOM_TOTAL)
    expect(combat).toBeGreaterThan(0)
  }, 30_000)

  it('战斗房都摆得出桌椅 —— 空教室看不出「桌椅挡不挡路」', () => {
    // ★ v4→v5：v4 的这条扫的是三间的全部房间（三间全是战斗关别）；
    // v5 里非战斗房按设计就是**空场地**（不摆桌椅、不刷怪，contract 只拒绝反方向），
    // 所以分母改成**战斗房**。
    //
    // ★ 期望仍是 100%，但**理由换了**：首版这条抄的是 v4 的旧摆法 —— 那份实现
    // 2026-10-16 就被换掉了（`gen/obstacles.ts` 的 ⚠️：改成「摆几组、散着摆」），
    // 连 v4 的最后版本上都已不成立。现行事实是「摆几组、散着摆」：
    // 组数按 `deskRowsMin`~`deskRowsMax`（今天 5~9）抽、每组位置**随处抽**，
    // 撞上门净空圈或已摆的组就重抽，**每个位置最多试 32 次** —— 重抽是主路径，
    // 32 次都没抽中才少摆一组，那才是兜底。
    // ⚠️ **那条兜底真的会触发，不是"理论上存在"**：1000 个种子 × 9000 间战斗房里
    // 实测有 **1 间只摆出 4 组**（种子 **6842029** 的 `YF602`，`want` 抽到 5、
    // 32 个位置都没落进去）—— 也就是「组数恒在 5~9 之间」**不成立**。
    // 那 9000 间的分布（2026-10-20 现量）：4 组 ×1、5 组 ×1769、6 组 ×1839、
    // 7 组 ×1973、8 组 ×1826、9 组 ×1592。
    // 所以别在这儿加一条 `组数 >= deskRowsMin` 的断言：它会红在一个**正确**的行为上。
    // （校验器那边也没有这条判据 —— `validate/contract.ts` 对障碍物只查四件事：
    // 非战斗房不许有、单件的尺寸形状、桌必须配椅、以及面积密度上限；
    // **组数不是契约的一部分**，实测 `deskRows` 三个字只出现在 `config.ts` 的解析、
    // `gen/obstacles.ts` 与这里。）
    // 所以 100% 不是构造保证，是**量出来的**：实测 200 个种子 × 战斗房 = 1800/1800
    // 一间不空（兄弟文件 `generate.test.ts` 拿 1000 个种子再扫一遍：9000/9000；
    // 「结构上就摆得下」那段推理同样管这里 —— 最小的两间都是 `fixed: reward`，
    // 能抽到战斗关别的最小一间是 `YF602` 17×18 格）。
    // 红了先量是哪一间、多大，再决定是调 `deskRowsMin` 还是改这里 ——
    // **不要**改成「> 95%」把回归静默掉。
    const bare: string[] = []
    let combat = 0
    let withDesk = 0
    for (const seed of SEEDS.slice(0, 200)) {
      const map = generateDungeon(seed, cfg, plan)
      for (const room of map.rooms) {
        if (!isCombatKind(cfg, room.kind)) continue
        combat++
        if (room.obstacles.some((o) => o.kind === 'desk')) withDesk++
        else bare.push(`种子 ${seed} ${room.id} ${room.rect.width}×${room.rect.height}`)
      }
    }
    expect(combat).toBeGreaterThan(0) // 战斗房一间都没有时百分比是 0/0
    console.log(
      `[读] 200 个种子 × ${FLOOR_ROOM_TOTAL} 间：战斗房 ${combat} 间，有桌椅 ${withDesk} 间（${((withDesk / combat) * 100).toFixed(1)}%），没桌椅的样例 ${bare.slice(0, 5).join(' / ') || '（一间都没有）'}`,
    )
    expect(bare.slice(0, 10)).toEqual([])
  }, 30_000)

  it('整层照样过契约校验与可达性 —— 内容是种子挑的，几何不许被压坏', () => {
    // ★ v4→v5：v4 这句的理由是「改的是房间数，几何不是另一套」—— v5 里几何
    // 根本不随种子走，理由换了一个：**内容**（桌椅、刷怪点、预算）不许把
    // 画出来的几何压坏。桌椅堵门（可达性）、刷怪点落在墙上、预算曲线不单调，
    // 这三样都在 `validate/` 里，跑一遍整层的成本低到值得每个种子都过。
    for (const seed of SEEDS.slice(0, 100)) {
      const map = generateDungeon(seed, cfg, plan)
      expect(() => validateContract(map, cfg), `种子 ${seed}`).not.toThrow()
      expect(() => assertReachable(map, cfg), `种子 ${seed}`).not.toThrow()
    }
  }, 30_000)
})