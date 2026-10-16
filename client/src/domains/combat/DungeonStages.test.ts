import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { roomsConfigWithRoomCount } from '@/domains/procgen/config'
import { parseCombatConfig } from './config'
import { buildDungeonStages, floorSeeds } from './DungeonStages'

const CONFIG_DIR = fileURLToPath(new URL('../../../public/config/', import.meta.url))
const readJson = (name: string): unknown => JSON.parse(readFileSync(CONFIG_DIR + name, 'utf8'))

const d1 = () => parseCombatConfig(readJson('combat.json'))
/** 一层几间 / 几间侧室只从 `combat.json` 读 —— 测试里再写一遍就成了第二份会漂的事实。 */
const rooms = () =>
  roomsConfigWithRoomCount(
    { get: () => readJson('rooms.json') },
    d1().arena.roomsPerFloor,
    d1().arena.sideRoomsPerFloor,
  )
/** 多个种子 —— 连通性不能只在一个种子上碰巧成立。 */
const SEEDS = [1, 2, 3, 13, 837, 20261012, 7919, 424242]

function build(seed: number, overrides: Record<string, number> = {}) {
  const base = rooms()
  return buildDungeonStages(
    seed,
    overrides.totalRooms === undefined
      ? base
      : roomsConfigWithRoomCount(
          { get: () => readJson('rooms.json') },
          overrides.totalRooms,
          overrides.sideRooms ?? 0,
        ),
    d1(),
  )
}

describe('DungeonStages — 房间必须靠门连通', () => {
  /**
   * ⚠️ **这一组是那三类「走不通」的回归测试。**
   *
   * 早先门的去向读的是 D2 的 `DoorBarrier.toOrder`，而那份数据是**按洞口去重**过的
   * （一个洞只出一条，`ownerOrder` 只是谁先被扫到）。照它走会出三类错：
   * 一间房两扇门通向同一间、有些房间根本到不了、小地图和实际门位对不上。
   * 现在连通关系**从几何算**（跨过墙往两边各探一步），按构造就不可能不对称。
   */
  it('每一间房都有门（没有孤岛）', () => {
    for (const seed of SEEDS) {
      const d = build(seed)
      for (const r of d.rooms) {
        expect(r.doorTargets.length, `种子 ${seed}：第 ${r.order + 1} 间一扇门都没有`).toBeGreaterThan(0)
      }
    }
  })

  it('同一间的两扇门**不通向同一个房间**', () => {
    for (const seed of SEEDS) {
      const d = build(seed)
      for (const r of d.rooms) {
        const targets = r.doorTargets.filter((t): t is number => t !== null)
        expect(new Set(targets).size, `种子 ${seed}：第 ${r.order + 1} 间的门重复通向同一间`).toBe(
          targets.length,
        )
      }
    }
  })

  it('连通是对称的：A 有门通向 B，B 就有门通向 A', () => {
    for (const seed of SEEDS) {
      const d = build(seed)
      for (const r of d.rooms) {
        for (const t of r.doorTargets) {
          if (t === null) continue
          const back = d.rooms[t]!.doorTargets
          expect(back, `种子 ${seed}：${r.order + 1} → ${t + 1} 存在，但没有回头的门`).toContain(r.order)
        }
      }
    }
  })

  it('**每一间都能从起点走到** —— 走不通的地牢就是坏关卡', () => {
    for (const seed of SEEDS) {
      const d = build(seed)
      const seen = new Set<number>([0])
      const queue = [0]
      while (queue.length) {
        const at = queue.shift()!
        for (const t of d.rooms[at]!.doorTargets) {
          if (t === null || seen.has(t)) continue
          seen.add(t)
          queue.push(t)
        }
      }
      expect(seen.size, `种子 ${seed}：只走得到 ${seen.size}/${d.rooms.length} 间`).toBe(d.rooms.length)
    }
  })
})

describe('DungeonStages — 一层要有分支，不能是一条直线', () => {
  it('有侧室（= 有分支）', () => {
    expect(build(1).rooms.filter((r) => r.room.branch === 'side').length).toBeGreaterThan(0)
  })
  it('房间总数 = `arena.roomsPerFloor`（一层就这么多间）', () => {
    expect(build(1).rooms).toHaveLength(d1().arena.roomsPerFloor)
  })
  it('至少有一间开三个门 —— 走到那儿要选方向', () => {
    for (const seed of SEEDS) {
      expect(Math.max(...build(seed).rooms.map((r) => r.doorTargets.length))).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('DungeonStages — 门的位置和它的去向必须对得上', () => {
  /**
   * ⚠️ **这条是「过 B 的门却到了 C」的回归测试。**
   *
   * 判据是纯几何的：一扇门开在房间的**哪一面墙**上，它通向的那间房就得在**那一侧**。
   * 门的位置来自 D2、去向来自几何推导，两者只要有一个错位，这里就会挂 ——
   * 而错位的表现正是「走进 A 的门，到了 B」。
   */
  /**
   * 判据是**跟生成代码完全独立**的：一扇门的邻居，就是**所有房间里离这扇门最近的那一间**
   * （门到房间矩形的最短距离）。
   *
   * ⚠️ 别用「门离房间哪条边最近」判它开在哪面墙 —— 门要是正好开在**墙角**，
   * 到两条边的距离都是 0，会取错一个。也别用「目标房间的中心在哪个方向」——
   * 下墙上偏右 180px 的门会被判成开在右墙上。这两个我都写过，都会报假阳性。
   * 而「离门最近」既不带方向假设，也不依赖生成代码用的那套推断。
   */
  const distToRect = (
    p: { x: number; y: number },
    r: { x: number; y: number; width: number; height: number },
  ) => {
    const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width))
    const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height))
    return Math.hypot(dx, dy)
  }
  const nearestRoomTo = (
    p: { x: number; y: number },
    skip: number,
    all: readonly { order: number; rect: { x: number; y: number; width: number; height: number } }[],
    faces: (other: { order: number; rect: { x: number; y: number; width: number; height: number } }) => boolean,
  ) => {
    let best = -1
    let bestD = Infinity
    for (const r of all) {
      if (r.order === skip) continue
      if (!faces(r)) continue
      const d = distToRect(p, { x: r.rect.x - r.rect.width / 2, y: r.rect.y - r.rect.height / 2, width: r.rect.width, height: r.rect.height })
      if (d < bestD) {
        bestD = d
        best = r.order
      }
    }
    return best
  }

  it('门开在哪面墙，通向的房间就在哪一侧', () => {
    for (const seed of SEEDS) {
      const d = build(seed)
      for (const r of d.rooms) {
        r.doorRects.forEach((rect, i) => {
          const t = r.doorTargets[i]
          if (t === null || t === undefined) return
          const all = d.rooms.map((x) => ({ order: x.order, rect: x.room.rect }))
          // 门洞的形状说它开在哪面墙上：竖墙上的洞是高的 → 沿 ±X 找；横墙 → 沿 ±Y 找。
          const tall = rect.height >= rect.width
          const span = tall
            ? { lo: rect.y - rect.height / 2, hi: rect.y + rect.height / 2 }
            : { lo: rect.x - rect.width / 2, hi: rect.x + rect.width / 2 }
          const want = nearestRoomTo(rect, r.order, all, (other) => {
            const o = other.rect
            const oLo = tall ? o.y - o.height / 2 : o.x - o.width / 2
            const oHi = tall ? o.y + o.height / 2 : o.x + o.width / 2
            // **必须与门有重叠** —— 只按距离挑会挑到「角更近但斜着」的房间：
            // 实测门在 (420,20) 时，斜下方的侧室角距 120px、正右方的教室 200px，
            // 按距离会挑错那间。
            return Math.min(oHi, span.hi) - Math.max(oLo, span.lo) > 0
          })
          expect(
            t,
            `种子 ${seed}：第 ${r.order + 1} 间的第 ${i + 1} 扇门在 (${rect.x.toFixed(0)},${rect.y.toFixed(0)})，` +
              `离它最近的是第 ${want + 1} 间，却被记成通向第 ${t + 1} 间`,
          ).toBe(want)
        })
      }
    }
  })
})

describe('DungeonStages — 交出去的数据要和 solids 对齐', () => {
  it('每间的门数与门去向数相等（观感层按下标对号）', () => {
    for (const seed of SEEDS) {
      const d = build(seed)
      for (const r of d.rooms) {
        const doors = d.stages.stages[r.order]!.solids.filter((s) => s.id.startsWith('door'))
        expect(doors).toHaveLength(r.doorTargets.length)
        expect(r.doorRects).toHaveLength(r.doorTargets.length)
      }
    }
  })
})

describe('DungeonStages — 一局多层：层种子与「一层一个首领」', () => {
  it('层种子由 `runSeed` 派生：同一个 runSeed 逐位相同（报出它就能复现整局）', () => {
    expect(floorSeeds(12345, 3)).toEqual(floorSeeds(12345, 3))
    expect(floorSeeds(12345, 3)).toHaveLength(3)
  })

  it('同一局内每一层的种子互不相同，不同局也不一样', () => {
    const a = floorSeeds(12345, 3)
    expect(new Set(a).size).toBe(3)
    expect(a).not.toEqual(floorSeeds(999, 3))
  })

  it('**每一层有且只有一个首领房，就在最后一间，而且不是侧室**', () => {
    // ⚠️ 这条是「一局三层、一层一个首领」的**前提**：正式游戏里首领只在
    // `room.kind === 'boss'` 那一间刷（见 `BattleScene.spawnStage()`），
    // 所以生成器必须保证「有且只有一个、在末间、不在侧室」。
    // ⚠️ 它一变不会报错 —— 只会静默变成「这一层没有首领」或者「一层两个首领」。
    for (const runSeed of [1, 837, 424242]) {
      for (const [i, seed] of floorSeeds(runSeed, d1().arena.maxStages).entries()) {
        const d = build(seed)
        const where = `runSeed ${runSeed} 的第 ${i + 1} 层`
        const bosses = d.rooms.filter((r) => r.room.kind === 'boss')
        expect(bosses, `${where}首领房不是一间`).toHaveLength(1)
        expect(bosses[0]!.order, `${where}首领房不在最后一间`).toBe(d.rooms.length - 1)
        expect(bosses[0]!.room.branch, `${where}首领房是侧室`).toBe('main')
      }
    }
  })

  it('每一层都是完整的一层楼：房间数与几何表都对得上 `arena.roomsPerFloor`', () => {
    for (const seed of floorSeeds(20261012, d1().arena.maxStages)) {
      const d = build(seed)
      expect(d.rooms).toHaveLength(d1().arena.roomsPerFloor)
      expect(d.stages.stages).toHaveLength(d1().arena.roomsPerFloor)
    }
  })
})
