/**
 * 房间转接判据的自动化验收。**跑在 node 环境** —— 不加载 Phaser、不碰 DOM。
 *
 * 挡的是三类**不报错**的错：
 *
 * 1. 门该关的时候开着（怪跑出去 / 房间清不完）或该开的时候关着（**软锁，整局作废**）
 * 2. 「回宿主那扇关死」判漏 —— 同一个洞在两边各记一次，只看自己那一头就会漏
 * 3. 「这一间要不要打」只认关别表 —— 战斗关别却没有出生点时把玩家锁死
 *
 * 配置读真文件、种子写死：与 `gen/generate.test.ts` / `colliders.test.ts` 同一个手法、
 * 同一个理由（失败要能复跑）。
 *
 * 三个种子是**挑过**的，不是随手写的 —— 它们的侧室构成不同：
 *
 * | 种子 | 侧室 |
 * |---|---|
 * | `837` | 4 间，其中 `#4` 是 **reward（不打）** |
 * | `13` | 7 间，`elite`（打）与 `chest` / `reward`（不打）**同一层里都有** |
 * | `7932` | 6 间，主干上有一段**连续三间不带侧室**（`#8 #9 #10`） |
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { barrierIndicesByRoom, collidersOf, type DoorBarrier } from './colliders'
import { generateDungeon } from './gen/generate'
import { isCombatKind, parseRoomsConfig, type RoomsConfig } from './config'
import { doorShouldBeClosed, leavesBehind, roomCleared, roomNeedsFight } from './roomFlow'
import type { Room } from './model/types'

const CONFIG_DIR = fileURLToPath(new URL('../../../public/config/', import.meta.url))

const cfg: RoomsConfig = parseRoomsConfig(
  JSON.parse(readFileSync(CONFIG_DIR + 'rooms.json', 'utf8')),
)

const SEEDS = [837, 13, 7932]

/** 门读数的写法：`3→4`。**用这个而不是下标** —— 下标会随排序变，签名不会。 */
function sig(b: DoorBarrier): string {
  return `${b.ownerOrder}→${b.toOrder}`
}

/** 玩家站在第 `k` 间、**且没有任何一间在战斗中**时，这扇门关着吗。 */
function closedStandingIn(b: DoorBarrier, k: number): boolean {
  return doorShouldBeClosed({
    ownerOrder: b.ownerOrder,
    toOrder: b.toOrder,
    currentOrder: k,
    ownerInCombat: false,
  })
}

/** 站在第 `k` 间时关着的全部门，签名排序后返回（可 `toEqual` 直接对表）。 */
function closedSet(barriers: readonly DoorBarrier[], k: number): string[] {
  return barriers.filter((b) => closedStandingIn(b, k)).map(sig).sort()
}

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
    //   判「没清」→ 门永远不开，而「不回头」规则下**整局作废**
    // 所以取前者。
    expect(roomCleared(-1, 0)).toBe(true)
  })
})

describe('D2 房间转接 — 门的开关理由', () => {
  it('正在战斗的那一间，它的前进门也是关的', () => {
    expect(
      doorShouldBeClosed({ ownerOrder: 5, toOrder: 6, currentOrder: 5, ownerInCombat: true }),
    ).toBe(true)
  })

  it('清完之后，前进门打开', () => {
    expect(
      doorShouldBeClosed({ ownerOrder: 5, toOrder: 6, currentOrder: 5, ownerInCombat: false }),
    ).toBe(false)
  })

  it('**两个理由取或，不是择一** —— 战斗没打完也开不了身后的门', () => {
    const where = { ownerOrder: 5, toOrder: 3, currentOrder: 5 } as const
    expect(doorShouldBeClosed({ ...where, ownerInCombat: true })).toBe(true)
    expect(doorShouldBeClosed({ ...where, ownerInCombat: false })).toBe(true)
  })

  it('尽头（`toOrder = null`）永远是关的 —— 门外是墙外', () => {
    expect(
      doorShouldBeClosed({ ownerOrder: 3, toOrder: null, currentOrder: 3, ownerInCombat: false }),
    ).toBe(true)
  })

  it('战斗中的房间，**它的每一扇门**都关着 —— 怪跑不出去，清房判定才成立', () => {
    for (const seed of SEEDS) {
      const map = generateDungeon(seed, cfg)
      const barriers = collidersOf(map, cfg).barriers
      for (const room of map.rooms) {
        for (const b of barriers.filter((x) => x.ownerOrder === room.order)) {
          expect(
            doorShouldBeClosed({
              ownerOrder: b.ownerOrder,
              toOrder: b.toOrder,
              currentOrder: room.order,
              ownerInCombat: true,
            }),
            `种子 ${seed} 在 #${room.order} 里，${sig(b)} 却开着`,
          ).toBe(true)
        }
      }
    }
  })
})

describe('D2 房间转接 — 「不回头」', () => {
  it('站在第 k 间时，通向更后面的门不关（自己这一间不由「不回头」关）', () => {
    for (let k = 0; k < 6; k++) {
      expect(leavesBehind(k, k + 1, k)).toBe(false)
      expect(leavesBehind(k, k + 5, k)).toBe(false)
    }
  })

  it('**同一个洞从两侧看是同一块挡板** —— 判据不能只看 `ownerOrder`', () => {
    // 侧室 #4 与宿主 #3 之间的那一个洞，去重后记在 #3 名下（`ownerOrder = 3`）。
    // 玩家走进 #4 之后，只看 `ownerOrder` 会算出「没被落在身后」→ 能倒回宿主，
    // 而那正是「不回头」要禁的事。
    const hole = bar837().find((b) => b.ownerOrder === 3 && b.toOrder === 4)!
    expect(hole.ownerOrder).toBe(3)
    expect(leavesBehind(hole.ownerOrder, hole.toOrder, 4)).toBe(true)
  })

  it('种子 837：**进 #3** —— 身后一路关死，前进门（`3→5`）与侧门（`3→4`）都开着', () => {
    expect(closedSet(bar837(), 3)).toEqual(['0→1', '1→0', '1→2', '2→1', '2→3', '3→2'])
  })

  it('种子 837：**站在侧室 #4 里** —— 回宿主那扇关着，去下一间主干那扇开着', () => {
    const closed = closedSet(bar837(), 4)
    expect(closed).toContain('3→4') // 侧室 ⇄ 宿主的那一个洞（记在 #3 名下）
    expect(closed).not.toContain('4→5') // 侧室的出口

    const out = bar837().filter(
      (b) => b.ownerOrder === 4 && !closedStandingIn(b, 4),
    )
    expect(out.map(sig)).toEqual(['4→5'])
  })

  it('种子 837：**进 #5** —— 只剩前进门，back 门（通 #3）关死', () => {
    const closed = closedSet(bar837(), 5)
    expect(closed).toEqual([
      '0→1',
      '1→0',
      '1→2',
      '2→1',
      '2→3',
      '3→2',
      '3→4',
      '3→5',
      '4→5',
      '5→3',
    ])
    const open = bar837()
      .filter((b) => b.ownerOrder === 5 && !closedStandingIn(b, 5))
      .map(sig)
    expect(open).toEqual(['5→6'])
  })

  it('种子 837：**#5 的 back 门通向的是 #3，不是 #4** —— 侧室不占主干的位置轴', () => {
    // 反直觉的那一条：不能用「比上一间的序号小」来判「不回头」，只能用 `toOrder` 比大小。
    const back5 = bar837().find((b) => b.ownerOrder === 5 && b.kind === 'back')
    expect(back5?.toOrder).toBe(3)
  })

  it('**每一间都出得去**：站在第 k 间时至少有一扇开着的门通向 order 更大的房间', () => {
    for (const seed of SEEDS) {
      const map = generateDungeon(seed, cfg)
      const barriers = collidersOf(map, cfg).barriers
      for (let k = 0; k < map.rooms.length - 1; k++) {
        const ways = barriers.filter(
          (b) =>
            !closedStandingIn(b, k) && b.toOrder !== null && b.toOrder > k,
        )
        expect(ways.length, `种子 ${seed}：站在 #${k} 时无路可走`).toBeGreaterThan(0)
      }
    }
  })

  it('侧室的出口通到主干、回宿主那一条关死', () => {
    for (const seed of SEEDS) {
      const map = generateDungeon(seed, cfg)
      const barriers = collidersOf(map, cfg).barriers
      for (const room of map.rooms) {
        if (room.branch !== 'side') continue
        const k = room.order
        const anchor = room.anchoredTo!

        const out = barriers.filter(
          (b) => !closedStandingIn(b, k) && b.toOrder !== null && b.toOrder > k,
        )
        expect(out.length, `种子 ${seed} 侧室 #${k} 出不来`).toBeGreaterThan(0)

        // 与宿主之间那个洞：两端各记过一次（去重后只剩一条），**哪一头看都必须是关的**
        const hole = barriers.filter(
          (b) =>
            (b.ownerOrder === anchor && b.toOrder === k) ||
            (b.ownerOrder === k && b.toOrder === anchor),
        )
        expect(hole.length, `种子 ${seed} 侧室 #${k} 与宿主 #${anchor} 之间没有洞`).toBeGreaterThan(0)
        for (const b of hole) {
          expect(closedStandingIn(b, k), `种子 ${seed} 侧室 #${k} 能倒回宿主`).toBe(true)
        }
      }
    }
  })

  it('**走过一间，关着的只会更多** —— 「此后任何清房判定都不会把它打开」', () => {
    for (const seed of SEEDS) {
      const map = generateDungeon(seed, cfg)
      const barriers = collidersOf(map, cfg).barriers
      for (let k = 0; k < map.rooms.length - 1; k++) {
        const after = new Set(closedSet(barriers, k + 1))
        for (const s of closedSet(barriers, k)) {
          expect(after.has(s), `种子 ${seed}：#${k} → #${k + 1} 之间，${s} 又开了`).toBe(true)
        }
      }
    }
  })
})

describe('D2 房间转接 — 「第几间的门」对上「第几号挡板」', () => {
  it('每一块挡板恰好属于一间，下标与物理层手里那份数组逐项对齐', () => {
    for (const seed of SEEDS) {
      const barriers = collidersOf(generateDungeon(seed, cfg), cfg).barriers
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

  it('种子 837：#3 是 5/6/7（含本该与 #4 共用的那一个洞），#4 只有 8，**不重复**', () => {
    const barriers = bar837()
    const byRoom = barrierIndicesByRoom(barriers)
    expect(byRoom.get(3)).toEqual([5, 6, 7])
    expect(byRoom.get(4)).toEqual([8])
    expect(byRoom.get(5)).toEqual([9, 10])
    expect(barriers[5]).toMatchObject({ ownerOrder: 3, toOrder: 4 })
    expect(barriers[8]).toMatchObject({ ownerOrder: 4, toOrder: 5 })
  })
})

describe('D2 房间转接 — 「这一间要不要打」', () => {
  it('不在 `combatKinds` 里的关别一律不打', () => {
    let seen = 0
    for (const seed of SEEDS) {
      for (const room of generateDungeon(seed, cfg).rooms) {
        if (isCombatKind(cfg, room.kind)) continue
        seen++
        expect(roomNeedsFight(room, cfg), `种子 ${seed} #${room.order} ${room.kind}`).toBe(false)
      }
    }
    expect(seen, '三个种子里一个非战斗关别都没有 —— 这条用例白跑了').toBeGreaterThan(0)
  })

  it('在 `combatKinds` 里、且真有刷怪点的要打（起点房也在内）', () => {
    for (const seed of SEEDS) {
      for (const room of generateDungeon(seed, cfg).rooms) {
        if (!isCombatKind(cfg, room.kind)) continue
        expect(room.spawnPoints.length, `种子 ${seed} #${room.order} ${room.kind}`).toBeGreaterThan(0)
        expect(roomNeedsFight(room, cfg)).toBe(true)
      }
    }
  })

  it('**战斗关别却没有出生点** —— 也判为不打（兜底那一条）', () => {
    // 不是假想：`gen/spawns.ts` 在「一个格都挑不出来」时返回空数组，
    // 而 `validate/contract.ts` 只拒绝反方向（非战斗房**有**刷怪点），这一头它管不着。
    // 照「清完才开门」的字面执行就是软锁。
    const start = generateDungeon(837, cfg).rooms.find((r) => r.order === 0)!
    const noSpawns: Room = { ...start, spawnPoints: [] }
    expect(isCombatKind(cfg, noSpawns.kind)).toBe(true)
    expect(roomNeedsFight(noSpawns, cfg)).toBe(false)
  })

  it('**侧室里两种都有** —— 这个判据不是「侧室通通不打」', () => {
    const rooms = generateDungeon(13, cfg).rooms.filter((r) => r.branch === 'side')
    expect(rooms.some((r) => roomNeedsFight(r, cfg))).toBe(true)
    expect(rooms.some((r) => !roomNeedsFight(r, cfg))).toBe(true)
  })
})

/** 种子 837 的门洞挡板 —— 用例里反复要用，读一次。 */
let bar837Cache: readonly DoorBarrier[] | null = null
function bar837(): readonly DoorBarrier[] {
  bar837Cache ??= collidersOf(generateDungeon(837, cfg), cfg).barriers
  return bar837Cache
}

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