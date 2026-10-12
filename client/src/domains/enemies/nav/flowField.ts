/**
 * 流向场（flow field）——「反向寻路」。**零 Phaser 依赖**，node 下可直接单测。
 *
 * ## 为什么是它，而不是给每只怪各跑一次 A*
 *
 * 群体追击里所有敌人追的是**同一个目标**（玩家）。逐个 A* 的代价是 O(敌人 × 路径长度)，
 * 200 只怪就是 200 条几乎相同的路径 —— 纯浪费。
 *
 * 反向来一遍：**从玩家出发**在粗网格上做一次 BFS，得到「每格到玩家几步」的距离场，
 * 顺便把「下一步该往哪格走」记下来。代价与**敌人数量无关**，只与房间大小有关
 * （40×30 的格子 = 1200 格）。之后每只怪查询自己所在格 = O(1)。
 *
 * ```
 *   A* per enemy        O(n × L)      200 只怪 → 200 次搜索
 *   flow field          O(grid)       → 1 次 BFS，全员复用
 * ```
 *
 * ## 重建节奏是「按需 + 节流」，不是每帧
 *
 * - 玩家**跨了格子**才重建（格子粒度足够，人不会瞬移）；
 * - 再叠一个 `rebuildIntervalMs` 下限，防止玩家在格子边界上来回蹭导致每帧重建。
 *
 * ## 它只解决「往哪走」，不解决「别叠在一起」
 *
 * 绕墙用这个场，扎堆用 `spatialHash.ts` 的分离力。两者输出加起来才是最终速度意图。
 * 这是刻意的分工：分离力是局部短程力，流向场是大尺度导航。
 *
 * ## 网格是**存在性**的，不是几何的
 *
 * 可走性由调用方给的 `isWalkable(x, y)` 决定（墙、障碍、门都归 D2 的房间生成）。
 * 本文件不知道房间长什么样，只知道「这一点能不能站人」。
 */

export interface FlowFieldConfig {
  /** 网格外接矩形的左下角（世界坐标） */
  originX: number
  originY: number
  /** 格子边长（px）。建议 24～48：太细 BFS 变慢，太粗怪会卡门框 */
  cellSize: number
  cols: number
  rows: number
  /** 世界坐标是否可站人。**会被频繁调用（每次重建 O(格数)），别在里面做重活。** */
  isWalkable: (x: number, y: number) => boolean
  /** 重建的最小间隔（毫秒，逻辑时间）。0 = 玩家一动就重建 */
  rebuildIntervalMs: number
  /**
   * 目标格不可走时，向外最多找几圈可走格当替代目标。
   *
   * 必须留一点余量：玩家贴着墙站着时，他所在格可能被判成不可走
   * （圆形碰撞体和格子网格本来就不完全对齐）。找不到替代目标 → 整张场不可达，
   * 所有敌人会一起退回「直线追」，表现就是集体往墙上怼。
   */
  targetSnapRadiusCells: number
}

/** 8 邻域，前 4 个是正交、后 4 个是对角（切角检查靠 `k >= 4` 区分）。 */
const NEIGHBOR_DX = [1, -1, 0, 0, 1, 1, -1, -1] as const
const NEIGHBOR_DY = [0, 0, 1, -1, 1, -1, 1, -1] as const

export class FlowField {
  private readonly cfg: FlowFieldConfig
  private readonly cols: number
  private readonly rows: number
  private readonly cellCount: number

  /**
   * 每格到目标的**步数**（8 邻域下每一步都算 1，包括对角）；-1 = 不可达。
   *
   * ⚠️ 刻意用**统一代价的 BFS**而不是带 √2 代价的 Dijkstra：
   * 两个档次的代价需要真正的优先队列（普通队列 + 松弛会让同一格反复入队，
   * 容量为格数的 `Int32Array` 会**静默越界丢弃**，距离场就悄悄算错了）。
   * 统一代价下每格恰好入队一次，`cellCount` 容量的队列正好够 —— 简单且显然正确。
   *
   * 代价是「最短路的**步数**」而不是几何距离，所以流向会被量化到 8 个方向。
   * **这个量化由 brain 侧消掉**：有直线视野时直接走直线追击（角度连续），
   * 只有被墙挡住时才用这里的流向。详见 `brains/steering.ts` 的 `desiredDir()`。
   */
  private readonly dist: Int32Array
  /** 每格的「下一步该去哪格」（格子索引）；-1 = 无（目标格或不可达） */
  private readonly next: Int32Array
  /** BFS 队列。统一代价 ⇒ 每格最多入队一次 ⇒ 容量 = 格数恰好够，不会越界。 */
  private readonly queue: Int32Array

  private built = false
  private lastBuildMs = Number.NEGATIVE_INFINITY
  /** 上次请求的目标格（玩家所在格）。-1 = 还没建过 */
  private lastTargetCell = -1
  /**
   * 上次 BFS 真正的起点格。目标格不可走时会吸附到最近的可走格，
   * 所以它**不一定等于** `lastTargetCell`。-1 = 目标周围全是墙，建了个空场。
   */
  private lastStartCell = -1
  /** 网格外接矩形，查询用 */
  private readonly minX: number
  private readonly minY: number
  private readonly maxX: number
  private readonly maxY: number

  constructor(cfg: FlowFieldConfig) {
    if (cfg.cellSize <= 0) throw new Error('FlowField: cellSize 必须 > 0')
    if (cfg.cols <= 0 || cfg.rows <= 0) throw new Error('FlowField: cols/rows 必须 > 0')

    this.cfg = cfg
    this.cols = cfg.cols
    this.rows = cfg.rows
    this.cellCount = cfg.cols * cfg.rows
    this.dist = new Int32Array(this.cellCount)
    this.next = new Int32Array(this.cellCount)
    this.queue = new Int32Array(this.cellCount)

    this.minX = cfg.originX
    this.minY = cfg.originY
    this.maxX = cfg.originX + cfg.cols * cfg.cellSize
    this.maxY = cfg.originY + cfg.rows * cfg.cellSize
  }

  /**
   * 上次 BFS 是否真的建出了一张可达的场。
   *
   * 判据是「吸附后的起点格存在」，不是「`dist[玩家格] === 0`」——
   * 玩家贴着墙站时他所在格本来就可能不可走，场是围绕**吸附后的**起点建起来的。
   * 用后者会让 HUD 在完全正常的情况下报「不可达」。
   */
  get reachable(): boolean {
    return this.built && this.lastStartCell >= 0
  }

  /** 目标格的索引，没建过是 -1。 */
  get targetCell(): number {
    return this.lastTargetCell
  }

  /**
   * 按需重建。**每个渲染帧（或每个 AI tick）调一次**，它自己判断要不要真的干活。
   *
   * @returns 这次是否真的重建了（测试与性能统计用）
   */
  update(targetX: number, targetY: number, nowMs: number): boolean {
    const cell = this.cellToIndexAt(targetX, targetY)
    if (cell < 0) {
      // 目标跑到网格外了：清场，让所有人退回直线追
      this.built = false
      this.lastTargetCell = -1
      this.lastStartCell = -1
      return false
    }

    const movedCell = cell !== this.lastTargetCell
    const due = nowMs - this.lastBuildMs >= this.cfg.rebuildIntervalMs
    if (!movedCell && !due) return false

    this.lastStartCell = this.build(cell, targetX, targetY)
    this.lastTargetCell = cell
    this.lastBuildMs = nowMs
    return true
  }

  /** 强制重建（换房间、墙被炸开、传送玩家之后用）。 */
  forceRebuild(targetX: number, targetY: number, nowMs: number): void {
    const cell = this.cellToIndexAt(targetX, targetY)
    if (cell < 0) return
    this.lastStartCell = this.build(cell, targetX, targetY)
    this.lastTargetCell = cell
    this.lastBuildMs = nowMs
  }

  /**
   * 取 `(x, y)` 处的流向，**单位向量**。
   *
   * - 返回 `null` = 「这个场帮不上忙」：还没建、不可达、或点在网格外。
   *   调用方应退回直线追击（`seek`），**不要当成「原地不动」** ——
   *   当成不动的话，玩家跑出网格范围全屏敌人会集体僵住。
   * - 返回 `(0, 0)` = 已经在自己所在的格子里了（`dist === 0`）。
   */
  dirAt(x: number, y: number): { x: number; y: number } | null {
    if (!this.built) return null
    const cell = this.cellToIndexAt(x, y)
    if (cell < 0) return null
    if (this.dist[cell]! < 0) return null

    const n = this.next[cell]!
    if (n < 0) return { x: 0, y: 0 } // 目标格

    const dx = this.cellCenterX(n) - this.cellCenterX(cell)
    const dy = this.cellCenterY(n) - this.cellCenterY(cell)
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len === 0) return { x: 0, y: 0 }
    return { x: dx / len, y: dy / len }
  }

  /** 该点所在的格子是否可达。HUD 调试与测试用。 */
  isReachableAt(x: number, y: number): boolean {
    if (!this.built) return false
    const cell = this.cellToIndexAt(x, y)
    return cell >= 0 && this.dist[cell]! >= 0
  }

  /** 可达格子数 / 总格子数。测试拿它断言「墙确实挡住了」。 */
  get reachableRatio(): number {
    if (!this.built) return 0
    let n = 0
    for (let i = 0; i < this.cellCount; i++) if (this.dist[i]! >= 0) n++
    return n / this.cellCount
  }

  // ------------------------------------------------------------ 内部

  /** @returns 真正使用的起点格；-1 = 目标周围没有可站的地方 */
  private build(targetCell: number, targetX: number, targetY: number): number {
    const { isWalkable } = this.cfg
    this.dist.fill(-1)
    this.next.fill(-1)

    const start = this.snapToWalkable(targetCell, targetX, targetY, isWalkable)
    if (start < 0) {
      // 目标周围全是墙：一场空。调用方会从 `reachable` 看出异常。
      this.built = true
      return -1
    }

    this.dist[start] = 0

    const queue = this.queue
    let head = 0
    let tail = 0
    queue[tail++] = start

    // 统一代价的 BFS：先出队的格子距离一定最小，所以每格只需处理一次。
    while (head < tail) {
      const cur = queue[head++]!
      const curDist = this.dist[cur]!
      const c = this.cellToCoords(cur)

      for (let k = 0; k < 8; k++) {
        const ncx = c.cx + NEIGHBOR_DX[k]!
        const ncy = c.cy + NEIGHBOR_DY[k]!
        if (ncx < 0 || ncy < 0 || ncx >= this.cols || ncy >= this.rows) continue

        const nCell = ncy * this.cols + ncx
        if (this.dist[nCell]! >= 0) continue // 已经访问过（BFS 下这就是最优距离）

        const nCxWorld = this.minX + (ncx + 0.5) * this.cfg.cellSize
        const nCyWorld = this.minY + (ncy + 0.5) * this.cfg.cellSize
        if (!isWalkable(nCxWorld, nCyWorld)) continue

        // 不许切角：斜着穿过两个墙角的缝会让怪视觉上插进墙里
        if (k >= 4) {
          const orthoY = this.minY + (c.cy + 0.5) * this.cfg.cellSize
          const orthoX = this.minX + (c.cx + 0.5) * this.cfg.cellSize
          if (!isWalkable(nCxWorld, orthoY)) continue
          if (!isWalkable(orthoX, nCyWorld)) continue
        }

        this.dist[nCell] = curDist + 1
        // 「下一步往哪走」在展开时就能直接定下来：从 nCell 回到目标的最佳首步就是 cur
        this.next[nCell] = cur
        queue[tail++] = nCell
      }
    }

    this.built = true
    return start
  }

  /**
   * 两点之间是否有直线视野（中间没有墙）。**射线采样**，不是解析求交。
   *
   * 用途是消掉流向场的 8 方向量化：有视野就直接走直线追击（角度连续、看着自然），
   * 没视野才用网格流向。采样步长取半格 —— 再细对「敌人别撞墙」没有可见收益，
   * 只增加开销；再粗会「穿」过薄墙，表现为怪贴着墙原地磨。
   *
   * 代价是 O(距离 / cellSize) 次 `isWalkable`，所以只在**确实需要**时调（见 brain）。
   */
  hasLineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    const { isWalkable } = this.cfg
    const dx = x1 - x0
    const dy = y1 - y0
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist === 0) return true

    const step = this.cfg.cellSize * 0.5
    const steps = Math.max(1, Math.ceil(dist / step))
    // 从 1 开始、到 steps-1 结束：两端点是实体自己所在的位置，本来就可站
    for (let i = 1; i < steps; i++) {
      const t = i / steps
      if (!isWalkable(x0 + dx * t, y0 + dy * t)) return false
    }
    return true
  }

  /**
   * 目标格不可走时，向外一圈圈找最近的可行格。
   *
   * 用切比雪夫环（正方形环）而不是欧氏圆：实现简单，且在网格上「环」本来就是方的。
   */
  private snapToWalkable(
    cell: number,
    targetX: number,
    targetY: number,
    isWalkable: (x: number, y: number) => boolean,
  ): number {
    const c = this.cellToCoords(cell)
    const maxR = Math.max(0, Math.floor(this.cfg.targetSnapRadiusCells))

    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          // 只看这一圈的边，内部上一轮已经查过
          if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue

          const cx = c.cx + dx
          const cy = c.cy + dy
          if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) continue

          const wx = this.minX + (cx + 0.5) * this.cfg.cellSize
          const wy = this.minY + (cy + 0.5) * this.cfg.cellSize
          if (isWalkable(wx, wy)) return cy * this.cols + cx
        }
      }
    }

    // 一圈都没找到：退而求其次，只要目标自己的坐标是可站的就用它。
    // （格子中心不可站但目标点可站 —— 贴着墙角站的情况，很常见。）
    if (isWalkable(targetX, targetY)) return cell
    return -1
  }

  private cellToCoords(index: number): { cx: number; cy: number } {
    const cy = Math.floor(index / this.cols)
    return { cx: index - cy * this.cols, cy }
  }

  /** 格子中心的 world X。 */
  private cellCenterX(index: number): number {
    return this.minX + (this.cellToCoords(index).cx + 0.5) * this.cfg.cellSize
  }

  /** 格子中心的 world Y。 */
  private cellCenterY(index: number): number {
    return this.minY + (this.cellToCoords(index).cy + 0.5) * this.cfg.cellSize
  }

  /** 世界坐标 → 格子索引；在网格外返回 -1。 */
  private cellToIndexAt(x: number, y: number): number {
    if (x < this.minX || y < this.minY || x >= this.maxX || y >= this.maxY) return -1
    const cx = Math.floor((x - this.minX) / this.cfg.cellSize)
    const cy = Math.floor((y - this.minY) / this.cfg.cellSize)
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return -1
    return cy * this.cols + cx
  }
}