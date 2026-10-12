import { describe, expect, it } from 'vitest'
import { SpatialHash } from './spatialHash'
import { FlowField } from './flowField'

/**
 * 空间哈希与流向场。
 *
 * 这两个是「敌人多了也不卡」的全部依据，所以测试盯的是**正确性边界**而不是性能数字：
 * 格子边界上的漏查、墙角的斜穿、队列越界 —— 这三类都是「大部分时候看着正常」的 bug。
 * 性能回归用规模断言（500 个实体对拍暴力解）兜，不测墙钟时间（那会变成 flaky 测试）。
 */

describe('SpatialHash', () => {
  it('查到半径内的，滤掉半径外的', () => {
    const hash = new SpatialHash<string>(32)
    hash.clear()
    hash.insert('near', 100, 100)
    hash.insert('edge', 120, 100) // 距离 20
    hash.insert('far', 200, 100) // 距离 100

    const out: string[] = []
    const n = hash.query(100, 100, 25, out)

    expect(n).toBe(2)
    expect(out.sort()).toEqual(['edge', 'near'])
  })

  it('半径是闭区间：正好等于半径的要算进来', () => {
    const hash = new SpatialHash<string>(32)
    hash.clear()
    hash.insert('exact', 130, 100)

    const out: string[] = []
    expect(hash.query(100, 100, 30, out)).toBe(1)
    expect(out[0]).toBe('exact')
  })

  it('跨格子边界不会漏（负坐标也不漏）—— Math.floor 与 |0 的区别', () => {
    const hash = new SpatialHash<string>(16)
    hash.clear()
    // 这两个点横跨 x=0 这条格子线，且都落在负半轴一侧
    hash.insert('a', -0.5, -0.5)
    hash.insert('b', 0.5, 0.5)

    const out: string[] = []
    // 用 |0 取格的实现会把 -0.5 和 0.5 都算成第 0 格，但 -1.5 会被算成第 -1 格……
    // 真正的坑是负半轴的向 0 截断：让这两个点看起来「同格」或「差两格」。
    expect(hash.query(0, 0, 2, out)).toBe(2)
    expect(out.sort()).toEqual(['a', 'b'])
  })

  it('查询点自己也会被查到（调用方按 id 自己排除）', () => {
    const hash = new SpatialHash<number>(32)
    hash.clear()
    hash.insert(7, 50, 50)

    const out: number[] = []
    expect(hash.query(50, 50, 10, out)).toBe(1)
    expect(out[0]).toBe(7)
  })

  it('clear 之后什么都查不到，且可以立刻重新插入', () => {
    const hash = new SpatialHash<string>(32)
    hash.clear()
    hash.insert('old', 10, 10)
    hash.clear()

    const out: string[] = []
    expect(hash.query(10, 10, 50, out)).toBe(0)
    expect(out.length).toBe(0) // out.length 被设成 0，不是留着旧内容
    expect(hash.size).toBe(0)

    hash.insert('new', 10, 10)
    expect(hash.query(10, 10, 50, out)).toBe(1)
    expect(out[0]).toBe('new')
  })

  it('规模对拍：500 个实体，哈希查询结果与暴力解完全一致', () => {
    const hash = new SpatialHash<number>(24)
    const pts: { id: number; x: number; y: number }[] = []
    // 固定序列，不用 Math.random —— 失败要能复现
    let seed = 12345
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    for (let i = 0; i < 500; i++) {
      pts.push({ id: i, x: next() * 1000, y: next() * 1000 })
    }

    hash.clear()
    for (const p of pts) hash.insert(p.id, p.x, p.y)

    const RADIUS = 40
    const out: number[] = []
    for (const q of pts) {
      hash.query(q.x, q.y, RADIUS, out)
      const brute = pts
        .filter((p) => (p.x - q.x) ** 2 + (p.y - q.y) ** 2 <= RADIUS * RADIUS)
        .map((p) => p.id)
        .sort((a, b) => a - b)
      expect([...out].sort((a, b) => a - b)).toEqual(brute)
    }
  })

  it('cellSize <= 0 直接抛，不允许退化成「所有东西一格」', () => {
    expect(() => new SpatialHash(0)).toThrow()
    expect(() => new SpatialHash(-1)).toThrow()
  })
})

// ------------------------------------------------------------------ 流向场

const CELL = 10
const COLS = 20
const ROWS = 20

function makeField(
  isWalkable: (x: number, y: number) => boolean = () => true,
  rebuildIntervalMs = 0,
): FlowField {
  return new FlowField({
    originX: 0,
    originY: 0,
    cellSize: CELL,
    cols: COLS,
    rows: ROWS,
    isWalkable,
    rebuildIntervalMs,
    targetSnapRadiusCells: 2,
  })
}

/**
 * 从世界坐标出发，一路顺着流向场走，返回经过的**格子中心**序列。
 *
 * ⚠️ 步进要用 `sign(d) * CELL`，不能写 `d * CELL`：`dirAt` 返回的是**单位向量**，
 * 对角方向是 `(0.707, 0.707)`，乘 CELL 只走 7.07px，会一点点漂到格子之间的缝里。
 * 单位向量是给物理体当速度用的；测试想走「格子到格子」就得显式取方向。
 */
function followFlow(field: FlowField, x: number, y: number, maxSteps = 200): number[][] {
  const path: number[][] = [[x, y]]
  let cx = x
  let cy = y
  for (let i = 0; i < maxSteps; i++) {
    const d = field.dirAt(cx, cy)
    if (!d) return path // 场帮不上忙
    if (d.x === 0 && d.y === 0) return path // 到目标格了
    const sx = Math.abs(d.x) < 1e-9 ? 0 : Math.sign(d.x)
    const sy = Math.abs(d.y) < 1e-9 ? 0 : Math.sign(d.y)
    cx += sx * CELL
    cy += sy * CELL
    path.push([cx, cy])
  }
  return path
}

describe('FlowField — 空房间', () => {
  it('朝向目标，且是单位向量', () => {
    const f = makeField()
    f.forceRebuild(105, 105, 0)

    const d = f.dirAt(5, 105)! // 正左方，同一行
    expect(d).not.toBeNull()
    expect(d.x).toBeCloseTo(1, 6)
    expect(d.y).toBeCloseTo(0, 6)
  })

  it('目标格上的流向是 (0,0)，不是 null（null 的含义是「帮不上忙」）', () => {
    const f = makeField()
    f.forceRebuild(105, 105, 0)
    expect(f.dirAt(105, 105)).toEqual({ x: 0, y: 0 })
  })

  it('任何位置的流向都是归一化的', () => {
    const f = makeField()
    f.forceRebuild(105, 105, 0)
    for (const [x, y] of [
      [5, 5],
      [195, 5],
      [195, 195],
      [5, 195],
      [55, 145],
    ] as const) {
      const d = f.dirAt(x, y)!
      expect(Math.hypot(d.x, d.y), `@${x},${y}`).toBeCloseTo(1, 6)
    }
  })

  it('空房间全部可达', () => {
    const f = makeField()
    f.forceRebuild(105, 105, 0)
    expect(f.reachable).toBe(true)
    expect(f.reachableRatio).toBe(1)
  })

  it('顺着流向走一定能到目标', () => {
    const f = makeField()
    f.forceRebuild(105, 105, 0)
    const path = followFlow(f, 5, 195)
    expect(path.length).toBeGreaterThan(1)
    const [ex, ey] = path[path.length - 1]!
    expect(ex).toBe(105)
    expect(ey).toBe(105)
  })
})

describe('FlowField — 墙', () => {
  // 一堵竖墙：挡住 x ∈ [90, 100)，y ∈ [0, 150) 的一切
  const wall = (x: number, y: number): boolean => !(x >= 90 && x < 100 && y >= 0 && y < 150)
  //              ↑ true = 可走

  it('墙后面的格子仍然可达（绕过去），而且路更长', () => {
    const f = makeField(wall)
    f.forceRebuild(105, 5, 0) // 目标在墙的右侧上方

    expect(f.reachable).toBe(true)
    // 墙把 y<150 那段封死了，左侧要绕到 y>=150 才能过去
    expect(f.isReachableAt(5, 5)).toBe(true)
  })

  it('顺着流向走，**一步都不会踩进墙里**', () => {
    const f = makeField(wall)
    f.forceRebuild(105, 5, 0)

    const path = followFlow(f, 5, 5, 400)
    expect(path.length).toBeGreaterThan(10) // 确实是绕路，不是直线
    for (const [px, py] of path) {
      // 采样点在格子中心，检查它所在的格子中心可走即可
      const ccx = Math.floor(px / CELL) * CELL + CELL / 2
      const ccy = Math.floor(py / CELL) * CELL + CELL / 2
      if (px < 0 || py < 0 || px >= COLS * CELL || py >= ROWS * CELL) continue
      expect(wall(ccx, ccy), `流向走到了墙里 @${px},${py}`).toBe(true)
    }
    const [ex, ey] = path[path.length - 1]!
    expect(ex).toBe(105)
    expect(ey).toBe(5)
  })

  it('完全封死的区域不可达，dirAt 返回 null（调用方据此退回直线追）', () => {
    // 一整条闭合的墙，把左上一小块封死
    const box = (x: number, y: number): boolean =>
      !(x >= 20 && x < 60 && y >= 20 && y < 60 && !(x >= 40 && x < 50 && y >= 20 && y < 30))
    const f = makeField(box)
    f.forceRebuild(150, 150, 0)

    // 箱子内部（左上角那块）与外界不通
    expect(f.isReachableAt(25, 25)).toBe(false)
    expect(f.dirAt(25, 25)).toBeNull()
    // 但箱子外面是通的
    expect(f.isReachableAt(75, 75)).toBe(true)
  })

  it('不许切角：只有对角相连的两格之间没有路', () => {
    // 只留 (0,0) 与 (1,1) 两格可走，(1,0) 与 (0,1) 是墙。
    // 这两格只在**对角**上相邻 —— 允许切角的实现会认为一步可达，
    // 怪就会斜着穿过两个墙角的缝、视觉上插进墙里。
    const diag = (x: number, y: number): boolean => {
      const cx = Math.floor(x / CELL)
      const cy = Math.floor(y / CELL)
      return (cx === 0 && cy === 0) || (cx === 1 && cy === 1)
    }
    const f = makeField(diag)
    f.forceRebuild(15, 15, 0) // 目标格 (1,1)

    expect(f.isReachableAt(15, 15)).toBe(true) // 目标格自己当然可达
    // 对角那格必须是**不可达**的 —— 这就是「不切角」的定义
    expect(f.isReachableAt(5, 5)).toBe(false)
    expect(f.dirAt(5, 5)).toBeNull()
    // 而且它确实没被算进距离场（不是「可达但流向是 0」）——
    // 整张场里**只有起点那一格**，那格对角邻居根本没能被展开到。
    // 允许切角的实现这里会是 2/400。
    expect(f.reachableRatio).toBeCloseTo(1 / (COLS * ROWS), 10)
  })
})

describe('FlowField — 重建节流与边界', () => {
  it('目标没换格且没到间隔 → 不重建', () => {
    const f = makeField(() => true, 100)
    expect(f.update(105, 105, 0)).toBe(true)
    expect(f.update(106, 106, 10)).toBe(false) // 同一格，10ms < 100ms
    expect(f.update(107, 108, 99)).toBe(false)
    expect(f.update(107, 108, 100)).toBe(true) // 到间隔了
  })

  it('目标换格立即重建（哪怕还没到间隔）', () => {
    const f = makeField(() => true, 1000)
    f.update(105, 105, 0)
    expect(f.update(115, 105, 1)).toBe(true) // 跨到右邻格
  })

  it('目标跑到网格外 → 清场，dirAt 返回 null', () => {
    const f = makeField()
    f.update(105, 105, 0)
    expect(f.dirAt(5, 5)).not.toBeNull()

    expect(f.update(-50, 105, 1)).toBe(false)
    expect(f.dirAt(5, 5)).toBeNull()
    expect(f.reachable).toBe(false)
  })

  it('还没建过时 dirAt 就是 null（不是 (0,0)，那会让敌人僵住）', () => {
    const f = makeField()
    expect(f.dirAt(5, 5)).toBeNull()
    expect(f.reachable).toBe(false)
  })

  it('目标站在不可走的格子上时，吸附到最近的可走格', () => {
    // 玩家贴着墙站，他所在格中心是墙 —— 很常见，不能因此让全场失控
    const wallAtTargetCell = (x: number, _y: number): boolean => !(x >= 100 && x < 110)
    const f = makeField(wallAtTargetCell)
    f.forceRebuild(105, 105, 0) // 目标格中心 (105,105) 不可走

    expect(f.reachable).toBe(true) // 吸附到了邻格
    expect(f.dirAt(5, 105)).not.toBeNull()
  })

  it('目标周围全是墙 → reachable=false，但不会崩', () => {
    const allWalls = (): boolean => false
    const f = makeField(allWalls)
    f.forceRebuild(105, 105, 0)
    expect(f.reachable).toBe(false)
    expect(f.reachableRatio).toBe(0)
    expect(f.dirAt(5, 5)).toBeNull()
  })
})

describe('FlowField — 视线', () => {
  it('空房间里任意两点都有视线', () => {
    const f = makeField()
    expect(f.hasLineOfSight(5, 5, 195, 195)).toBe(true)
  })

  it('被墙挡住时没有视线', () => {
    const wall = (x: number, _y: number): boolean => !(x >= 90 && x < 100)
    const f = makeField(wall)
    expect(f.hasLineOfSight(5, 50, 150, 50)).toBe(false)
    // 绕开墙的那一段则是有视线的
    expect(f.hasLineOfSight(5, 50, 80, 50)).toBe(true)
  })

  it('同一个点算有视线', () => {
    const f = makeField()
    expect(f.hasLineOfSight(5, 5, 5, 5)).toBe(true)
  })
})