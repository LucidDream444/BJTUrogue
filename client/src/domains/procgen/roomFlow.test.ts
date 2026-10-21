/**
 * 房间转接判据的自动化验收。**跑在 node 环境** —— 不加载 Phaser、不碰 DOM。
 *
 * 挡的是三类**不报错**的错：
 *
 * 1. 门该关的时候开着 —— 怪跑出去、清房判定失效（「有一间永远清不掉」）
 * 2. 门该开的时候关着 —— **软锁，玩家被关在里面出不去**
 * 3. 「这一间要不要打」只认关别表 —— 战斗关别却没有出生点时把玩家锁死
 *
 * ## ★ v5 换掉了整整一组：第四类从「判漏」变成「判多」
 *
 * v4 的文件头第四条是「『回宿主那扇关死』判漏」—— 那是**「不回头」规则判不够严**。
 * v5 没有「不回头」了，风险**掉了个头**：现在是**门会不会因为玩家站在哪儿而关**。
 * 所以那一组 describe（原「不回头」）整个换成了「走廊里自由走动」，
 * 里面第一条就是它的反面：**没有任何一间在战斗时，整层楼一扇关着的门都没有**。
 *
 * 这不是「把旧用例改个名字」。旧用例里那几张写死的门签名表
 * （`['0→1','1→0','1→2',…]`）在 v5 里**一条都对不上**：`DoorBarrier` 的
 * `toOrder` / `kind` 两个字段已经删了（它们是主干道模型的产物，见 `colliders.ts`
 * 里 `DoorBarrier` 那条 ★），门现在**无向**，而「不回头」的前提正是「门有前后」。
 *
 * 配置读真文件、种子写死：与 `gen/generate.test.ts` / `colliders.test.ts` 同一个手法、
 * 同一个理由（失败要能复跑）。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { barrierIndicesByRoom, collidersOf, type DoorBarrier } from './colliders'
import { generateDungeon } from './gen/generate'
import { parseFloorPlan, type FloorPlan } from './gen/floorPlan'
import { isCombatKind, parseRoomsConfig, type RoomsConfig } from './config'
import { doorShouldBeClosed, roomCleared, roomNeedsFight } from './roomFlow'
import type { Room } from './model/types'

const CONFIG_DIR = fileURLToPath(new URL('../../../public/config/', import.meta.url))

const readJson = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(CONFIG_DIR + name, 'utf8')) as Record<string, unknown>

const cfg: RoomsConfig = parseRoomsConfig(readJson('rooms.json'))

/**
 * 整层楼的几何 —— 与**种子无关**（`floor-plan.json` 里写死的 6F 平面图）。
 *
 * ⚠️ 它是 `generateDungeon` 的**第三个参数**（v5 把几何与内容分了家）。
 * 所以这里解析一次、三个种子共用一份 —— 放进下面的循环里就是同一份表读好几遍。
 */
const plan: FloorPlan = parseFloorPlan(readJson('floor-plan.json'), cfg)

/**
 * 三个种子 —— `colliders.test.ts` 那 200 个的缩小版。
 *
 * ⚠️ **v5 里这三个种子能变的东西比 v4 少得多**：几何与种子无关，
 * 变的只有「关别 / 障碍物 / 刷怪点」。所以下面第一条用例是**取样自检**：
 * 三个种子的关别分配必须真的不一样，否则扫三个等于扫一个，
 * 用例全绿而一个都没测到。
 */
const SEEDS = [837, 13, 7932]

/** 一间都没在打 —— 最常问的那种局面。 */
const NOBODY_FIGHTING: ReadonlySet<number> = new Set<number>()

/** 门读数的写法：`3→C_W`。**用这个而不是下标** —— 下标会随排序变，签名不会。 */
function sig(b: DoorBarrier): string {
  return `${b.ownerOrder}→${b.toId}`
}

/** 在「`combatRooms` 里是这些人」的前提下，关着的全部门，签名排序后返回（可 `toEqual` 直接对表）。 */
function closedSet(barriers: readonly DoorBarrier[], combatRooms: ReadonlySet<number>): string[] {
  return barriers
    .filter((b) => doorShouldBeClosed({ ownerOrder: b.ownerOrder, combatRooms }))
    .map(sig)
    .sort()
}

describe('D2 房间转接 — 取样自检', () => {
  it('三个种子的关别分配确实不同 —— 否则下面成组的扫描是白跑的', () => {
    const shapes = SEEDS.map((seed) =>
      generateDungeon(seed, cfg, plan)
        .rooms.map((r) => `${r.id}:${r.kind}`)
        .join('|'),
    )
    expect(new Set(shapes).size, '三个种子给出了同一份关别分配').toBe(SEEDS.length)
  })
})

describe('D2 房间转接 — 清房判据', () => {
  it('存活 0，但队列里还有没出生的 —— 不算清', () => {
    expect(roomCleared(0, 1)).toBe(false)
    expect(roomCleared(0, 6)).toBe(false)
  })

  it('队列空了，但还有活着的 —— 不算清', () => {
    expect(roomCleared(1, 0)).toBe(false)
    expect(roomCleared(7, 0)).toBe(false)
  })

  it('两头都还有 —— 不算清', () => {
    expect(roomCleared(3, 2)).toBe(false)
  })

  it('两个都到 0 —— 才算清', () => {
    expect(roomCleared(0, 0)).toBe(true)
  })

  it('全扫一遍：只有两个数都是 0 才是清的', () => {
    for (let live = 0; live <= 5; live++) {
      for (let queued = 0; queued <= 5; queued++) {
        expect(roomCleared(live, queued), `live=${live} queued=${queued}`).toBe(
          live === 0 && queued === 0,
        )
      }
    }
  })

  it('读到负数时算「清」—— 两个失败模式里挑轻的那个', () => {
    // 计数为负是上游的 bug，这里只能挑一个方向失败：
    //   判「清」→ 门早开，玩家走掉、房里剩下一只（和分裂延迟那个窗口同一个后果）
    //   判「没清」→ 门永远不开。v4 里这一头还有「不回头」兜着（反正也回不去），
    //               v5 没有那条规则了，后果就只剩「玩家被关在这一间里」—— 一样是硬锁。
    // 所以取前者。
    expect(roomCleared(-1, 0)).toBe(true)
  })
})

describe('D2 房间转接 — 门的开关理由', () => {
  const question = (ownerOrder: number, combatRooms: ReadonlySet<number>): boolean =>
    doorShouldBeClosed({ ownerOrder, combatRooms })

  it('正在战斗的那一间，它的门关着', () => {
    expect(question(5, new Set([5]))).toBe(true)
  })

  it('不在战斗集合里 —— 门开着', () => {
    expect(question(5, NOBODY_FIGHTING)).toBe(false)
    expect(question(5, new Set([4, 6]))).toBe(false)
  })

  it('**集合里是别人，不影响这一扇** —— 判的是「属于」，不是「有没有人在打」', () => {
    expect(question(5, new Set([0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]))).toBe(false)
  })

  it('**放一个不存在的房间号进去，一扇门都不该关** —— 这是「属于」，不是「比大小」', () => {
    // 这条挡的是一类**写起来很自然**的错法。v4 那条「不回头」的判据是
    // `Math.min(ownerOrder, toOrder) < currentOrder` —— **比大小**；
    // v5 这条是 `combatRooms.has(ownerOrder)` —— **属于**。
    // 两种写法在正常输入下常常给出同样的答案，区别只在边界上，而这个用例就是那个边界：
    // 拿 -1 去比大小会把整层楼关死，判「属于」则一扇都不该动。
    //
    // 换句话说：它不测「-1 这间房在不在战斗」（那本来就没意义），
    // 它测的是**这条判据会不会被一个越界的数带偏**。
    for (const seed of SEEDS) {
      const barriers = collidersOf(generateDungeon(seed, cfg, plan), cfg).barriers
      expect(closedSet(barriers, new Set([-1])), `种子 ${seed}：-1 关掉了不该关的门`).toEqual([])
      expect(closedSet(barriers, new Set([9999])), `种子 ${seed}：9999 关掉了不该关的门`).toEqual(
        [],
      )
    }
  })

  it('战斗中的房间，**它的每一扇门**都关着 —— 怪跑不出去，清房判定才成立', () => {
    for (const seed of SEEDS) {
      const map = generateDungeon(seed, cfg, plan)
      const barriers = collidersOf(map, cfg).barriers
      for (const room of map.rooms) {
        for (const b of barriers.filter((x) => x.ownerOrder === room.order)) {
          expect(
            question(b.ownerOrder, new Set([room.order])),
            `种子 ${seed} 在 ${room.id} 里，${sig(b)} 却开着`,
          ).toBe(true)
        }
      }
    }
  })

  it('**另一头永远是走廊** —— 「走廊不会把门关上」就是这么成立的', () => {
    // `combatRooms` 装的是 `Room.order`，而走廊**没有 `order`**
    // （`DungeonMap.passages` 上是 `{id, rect}`，`Passage` 里没有这个字段）。
    // 于是「隔壁走廊正在战斗」这种事在类型上就写不出来。
    // 这一条钉的是**今天每一扇门都是「房间 ↔ 走廊」**这个前提 ——
    // 哪天造出「房间 ↔ 房间」的门，它就会红，而那正是需要重新想一遍的时候。
    for (const seed of SEEDS) {
      const map = generateDungeon(seed, cfg, plan)
      const passageIds = new Set(map.passages.map((p) => p.id))
      const roomIds = new Set(map.rooms.map((r) => r.id))
      for (const b of collidersOf(map, cfg).barriers) {
        expect(passageIds.has(b.toId), `种子 ${seed}：挡板 ${sig(b)} 的另一头不是走廊`).toBe(true)
        expect(roomIds.has(b.toId), `种子 ${seed}：挡板 ${sig(b)} 通向了房间 ${b.toId}`).toBe(false)
      }
    }
  })
})

describe('D2 房间转接 — 走廊里自由走动（v5 取代「不回头」）', () => {
  it('**没有一间在战斗时，整层楼一扇关着的门都没有**', () => {
    // 这是用户在 v5 提的那一条：「可以随意在走廊走，随意选择房间进入挑战」。
    // v4 在这里会输出一张长长的「关死了」的表（`['0→1','1→0','1→2',…]`），
    // 因为「不回头」会按玩家站在哪儿把身后的门一扇扇关掉。
    // v5 的 `doorShouldBeClosed` 的输入里**根本没有位置** —— 只有一个战斗集合。
    for (const seed of SEEDS) {
      const barriers = collidersOf(generateDungeon(seed, cfg, plan), cfg).barriers
      expect(barriers.length, `种子 ${seed} 一扇门都没有 —— 这条用例白跑了`).toBeGreaterThan(0)
      expect(closedSet(barriers, NOBODY_FIGHTING), `种子 ${seed} 有门被关着`).toEqual([])
    }
  })

  it('每一间房都至少有一扇门 —— 否则那一间进不去', () => {
    // 「门永远开着」本身还不够：一间房要是压根没有门，玩家照样到不了它。
    // 这是 v5 软锁的另一种形态，而它同样**不报错**（数据自洽，只是玩不到）。
    for (const seed of SEEDS) {
      const map = generateDungeon(seed, cfg, plan)
      for (const room of map.rooms) {
        expect(room.doors.length, `种子 ${seed} 的 ${room.id} 一扇门都没有`).toBeGreaterThan(0)
      }
    }
  })

  it('**只有正在战斗的那一间会关门** —— 别间的门不受牵连', () => {
    // 关着的门必须**正好**是它的那几扇，不能多也不能少：
    // 少了 → 怪跑出去（清房判定失效）；
    // 多了 → 玩家被关在走廊或别间里（软锁）。
    for (const seed of SEEDS) {
      const map = generateDungeon(seed, cfg, plan)
      const barriers = collidersOf(map, cfg).barriers
      for (const room of map.rooms) {
        const mine = barriers
          .filter((b) => b.ownerOrder === room.order)
          .map(sig)
          .sort()
        expect(
          closedSet(barriers, new Set([room.order])),
          `种子 ${seed}：${room.id} 战斗时，关着的门不是它自己那几扇`,
        ).toEqual(mine)
      }
    }
  })

  it('打完（从战斗集合里拿掉）那几扇门立刻全开 —— 不需要「回到」任何地方', () => {
    // v4 里「清完开门」和「不回头关门」是**两条独立的理由**，取或。
    // 于是有一类场面：一间房清完了，它的门却还是关的（被「不回头」压着）。
    // v5 只剩下一条理由，清完就一定开 —— 这条用例把那个「一定」钉住。
    for (const seed of SEEDS) {
      const map = generateDungeon(seed, cfg, plan)
      const barriers = collidersOf(map, cfg).barriers
      for (const room of map.rooms) {
        const after = new Set([...map.rooms.map((r) => r.order)].filter((o) => o !== room.order))
        expect(
          closedSet(barriers, after).filter((s) => s.startsWith(`${room.order}→`)),
          `种子 ${seed}：${room.id} 清完了，它的门还关着`,
        ).toEqual([])
      }
    }
  })
})

describe('D2 房间转接 — 「第几间的门」对上「第几号挡板」', () => {
  it('每一块挡板恰好属于一间，下标与物理层手里那份数组逐项对齐', () => {
    for (const seed of SEEDS) {
      const barriers = collidersOf(generateDungeon(seed, cfg, plan), cfg).barriers
      const byRoom = barrierIndicesByRoom(barriers)

      // 铺开正好是 0..n-1 的排列 —— 少一个（有门打不开）或多一个（有两扇一起动）
      // 都从这里露出来
      const flat = [...byRoom.values()].flat().sort((a, b) => a - b)
      expect(flat).toEqual(barriers.map((_, i) => i))

      for (const [room, idx] of byRoom) {
        for (const i of idx) expect(barriers[i]!.ownerOrder).toBe(room)
      }
    }
  })

  it('**挡板数 = 门数**：一个洞口一块，不多不少', () => {
    // `MapColliders.barriers` 的注释说「一个洞口一块」。这一条把它变成可执行的：
    // 造两块，门就永远封不住（另一块被撤掉了）；漏一块，就有一块看不见的墙。
    // v5 里门的另一头恒为走廊，而走廊没有 `doors` 列表，所以不会两边各记一次 ——
    // 这也正是「正好相等」在 v5 才成立的原因。
    for (const seed of SEEDS) {
      const map = generateDungeon(seed, cfg, plan)
      const doors = map.rooms.flatMap((r) => [...r.doors])
      expect(collidersOf(map, cfg).barriers.length, `种子 ${seed}：挡板数与门数不一致`).toBe(
        doors.length,
      )
    }
  })

  it('**每一间房都有自己的挡板** —— 有挡板的房间号，正好是全部房间号', () => {
    for (const seed of SEEDS) {
      const map = generateDungeon(seed, cfg, plan)
      const byRoom = barrierIndicesByRoom(collidersOf(map, cfg).barriers)
      const asc = (a: number, b: number): number => a - b
      expect([...byRoom.keys()].sort(asc), `种子 ${seed}：有房间没有挡板`).toEqual(
        map.rooms.map((r) => r.order).sort(asc),
      )
    }
  })
})

describe('D2 房间转接 — 「这一间要不要打」', () => {
  it('不在 `combatKinds` 里的关别一律不打', () => {
    let seen = 0
    for (const seed of SEEDS) {
      for (const room of generateDungeon(seed, cfg, plan).rooms) {
        if (isCombatKind(cfg, room.kind)) continue
        seen++
        expect(roomNeedsFight(room, cfg), `种子 ${seed} ${room.id} ${room.kind}`).toBe(false)
      }
    }
    expect(seen, '三个种子里一个非战斗关别都没有 —— 这条用例白跑了').toBeGreaterThan(0)
  })

  it('在 `combatKinds` 里、且真有刷怪点的要打（起点房也在内）', () => {
    for (const seed of SEEDS) {
      for (const room of generateDungeon(seed, cfg, plan).rooms) {
        if (!isCombatKind(cfg, room.kind)) continue
        expect(room.spawnPoints.length, `种子 ${seed} ${room.id} ${room.kind}`).toBeGreaterThan(0)
        expect(roomNeedsFight(room, cfg)).toBe(true)
      }
    }
  })

  it('**战斗关别却没有出生点** —— 也判为不打（兜底那一条）', () => {
    // 不是假想：`gen/spawns.ts` 在「一个格都挑不出来」时返回空数组，
    // 而 `validate/contract.ts` 只拒绝反方向（非战斗房**有**刷怪点），这一头它管不着。
    // 照「清完才开门」的字面执行就是软锁。
    //
    // ⚠️ 本来这里取的是 `order === 0`（v4 里那是第一间战斗房）。v5 里 `order 0`
    // 是**楼梯间**（`kind: 'start'`，出生点，本来就不打），于是这条用例会拿一间
    // 非战斗房去冒充战斗房 —— 它自己先红，而红的原因不是被测的那条判据。
    // 所以改成按 `isCombatKind` 挑一间真的。
    const room = generateDungeon(837, cfg, plan).rooms.find((r) => isCombatKind(cfg, r.kind))!
    const noSpawns: Room = { ...room, spawnPoints: [] }
    expect(isCombatKind(cfg, noSpawns.kind), `${room.id} 挑错了，它不是战斗关别`).toBe(true)
    expect(roomNeedsFight(noSpawns, cfg)).toBe(false)
  })

  it('**同一层里两种都有** —— 这个判据不是「通通不打」也不是「通通打」', () => {
    const rooms = generateDungeon(13, cfg, plan).rooms
    expect(rooms.some((r) => roomNeedsFight(r, cfg))).toBe(true)
    expect(rooms.some((r) => !roomNeedsFight(r, cfg))).toBe(true)
  })

  it('**定死的三间**：YF604 首领要打，YF607 / YF612 不打', () => {
    // 用户提的那条：「604 为这层最终关卡（首领关），其他教室或房间随机生成…」
    // 也就是——**关别是随机的，但这三间不是**。这一条钉住「哪几间不随机」，
    // 免得哪天生成器把 boss 摇到别处去（那种错不会抛异常，只会让这一层没有终点）。
    for (const seed of SEEDS) {
      const byId = new Map(generateDungeon(seed, cfg, plan).rooms.map((r) => [r.id, r]))
      expect(byId.get('YF604')!.kind, `种子 ${seed}：YF604 不是首领关`).toBe('boss')
      expect(roomNeedsFight(byId.get('YF604')!, cfg)).toBe(true)
      expect(roomNeedsFight(byId.get('YF607')!, cfg), `种子 ${seed}：YF607 变成要打了`).toBe(false)
      expect(roomNeedsFight(byId.get('YF612')!, cfg), `种子 ${seed}：YF612 变成要打了`).toBe(false)
    }
  })
})

describe('D2 房间转接 — 清房宽限窗口（配置）', () => {
  /**
   * 读 `enemies.json` 的**数据**，不 import D3 的代码 —— 域边界不破，约束照样钉得住。
   *
   * 为什么值得跨文件钉这一条：宽限窗口是**用时间换正确性**，
   * 而它换的那段时间的长短归 D3（`splitDelayMs`）。两边各自看都合理、
   * 合在一起就不够，是这类「两个域各调一个数」的典型错法 ——
   * 症状是「门提前开了、身后冒出一只怪」，而且只在**最后一只恰好是分裂怪**时出现。
   */
  const worstSplitDelayMs = (): number => {
    const raw = JSON.parse(readFileSync(CONFIG_DIR + 'enemies.json', 'utf8')) as {
      enemies: { splitter: { generations: { gen: number; splitDelayMs: number }[] } }
    }
    return Math.max(...raw.enemies.splitter.generations.map((g) => g.splitDelayMs))
  }

  it('`settleMs` 大于最大的 `splitDelayMs` —— 并且留了余量，不是卡着 1ms 过', () => {
    const worst = worstSplitDelayMs()
    expect(worst, '分裂怪一代理应有延迟，否则这条用例白跑').toBeGreaterThan(0)
    expect(cfg.settleMs, `settleMs ${cfg.settleMs} 覆盖不住最大分裂延迟 ${worst}ms`).toBeGreaterThan(
      worst,
    )
    expect(cfg.settleMs, `settleMs ${cfg.settleMs} 对 ${worst}ms 的余量太薄`).toBeGreaterThanOrEqual(
      worst * 1.5,
    )
  })

  it('缺字段 / 写 0 / 写 5 秒 / 写成小数，都在加载时当场拒掉', () => {
    const reparse = (mutate: (raw: Record<string, unknown>) => void): (() => unknown) => {
      const raw = JSON.parse(readFileSync(CONFIG_DIR + 'rooms.json', 'utf8')) as Record<
        string,
        unknown
      >
      mutate(raw)
      return () => parseRoomsConfig(raw)
    }

    expect(reparse((r) => delete r.settleMs)).toThrow(/settleMs/)
    expect(reparse((r) => (r.settleMs = 0))).toThrow(/settleMs/)
    expect(reparse((r) => (r.settleMs = 5000))).toThrow(/settleMs/)
    expect(reparse((r) => (r.settleMs = 300.5))).toThrow(/settleMs/)
    // 改本来就不该动的那几个字段，照旧照过 —— 免得这条用例其实在测别的
    expect(reparse((r) => (r.settleMs = 500))).not.toThrow()
  })
})