/**
 * 挣脱之后的甩出：**往哪甩**、**怎么落**。**零 Phaser**，node 下可直接单测。
 *
 * ## 往哪甩：周围敌人最多的那个方向
 *
 * 以玩家为圆心、`distance` 为半径，每 15° 取一个候选落点（共 24 个），
 * 数「落点 `blastRadius` 内有多少敌人」，取最多的那个。
 *
 * ⚠️ **平手必须结果确定**：取角度最小的那个候选（不摇随机、不看帧序）。
 * 甩出去的方向会影响玩家下一次看到什么，摇摆的规则等于没有规则。
 *
 * ⚠️ **挡在墙后的候选不算数**：落点在被墙隔开的地方时，甩出去的敌人会**撞墙提前落地**
 * （见 `shouldLand`），于是它实际炸的位置跟这里数出来的人数对不上。
 * 所以调用方要传一个「这一点飞得到吗」的判据，够不着的候选**在有别的选择时不选它**。
 *
 * ## 怎么落：固定距离 + 固定时间，落地判据只管「结束了吗」
 *
 * 飞行本身是物理体按速度意图走的（位置真值仍然只有一处），这里只回答
 * 「这一帧算不算落地了」：时间到了、或者它其实没在动（撞墙/被挡）。
 */

export interface Point2 {
  x: number
  y: number
}

/** 候选方向的个数。**定死**：它决定「平手取哪个」的粒度，改了要连着测试一起改。 */
export const FLING_DIRECTIONS = 24

/**
 * 选甩出方向（**单位向量**）。
 *
 * @param origin 玩家位置（甩出的圆心）
 * @param distance 固定甩出距离
 * @param blastRadius 落地爆炸半径（数人数用）
 * @param targets 场上的**其它敌人**（不含被甩的这一只，调用方先排掉）
 * @param blocked 两点之间是否被墙挡住（通常是寻路的 `hasLineOfSight`）；不传 = 全通
 */
export function pickFlingDirection(
  origin: Point2,
  distance: number,
  blastRadius: number,
  targets: readonly Point2[],
  blocked?: (a: Point2, b: Point2) => boolean,
): Point2 {
  let bestDir = { x: 1, y: 0 }
  let bestCount = -1
  for (let i = 0; i < FLING_DIRECTIONS; i++) {
    const angle = (i / FLING_DIRECTIONS) * Math.PI * 2
    const dir = { x: Math.cos(angle), y: Math.sin(angle) }
    const landing = { x: origin.x + dir.x * distance, y: origin.y + dir.y * distance }
    if (blocked?.(origin, landing)) continue
    let count = 0
    for (const t of targets) {
      if (Math.hypot(t.x - landing.x, t.y - landing.y) <= blastRadius) count++
    }
    // **严格大于**：平手时保留先到的那个（角度最小），于是结果可复现
    if (count > bestCount) {
      bestCount = count
      bestDir = dir
    }
  }
  // 没有任何候选是飞得到的（比如被墙围死）：退化成 +x 这个确定方向，
  // 让它照常飞出去、撞墙落地爆炸 —— 比「原地不动」清楚得多。
  return bestDir
}

/** 候选落点。测试与调试读数的共用算式，别在别处再推一遍。 */
export function landingPoint(origin: Point2, dir: Point2, distance: number): Point2 {
  return { x: origin.x + dir.x * distance, y: origin.y + dir.y * distance }
}

export interface LandingRule {
  /** 固定飞行时长（毫秒） */
  flingTimeMs: number
  /** 「它其实没在动」的判定阈值（px/帧的位移，默认 1） */
  stuckEpsilonPx?: number
  /** 连续多少毫秒几乎没动就判落地（撞墙/被挡），默认 80 */
  stuckMs?: number
}

/**
 * 这一帧算不算落地了。
 *
 * @param elapsedMs 已经飞了多久（从甩出那一刻起算）
 * @param stepPx 上一帧到这一帧它实际移动了多远（**从物理体读**，不是从速度意图读）
 * @param stuckForMs 已经连续「几乎没动」多久（调用方累计，见返回值的用法）
 * @param dtMs 这一帧的时长 —— 「连续没动多久」按**毫秒**累计，不按帧数
 *   （按帧数的话，30fps 和 144fps 下同一个数值的语义完全不同）
 */
export function shouldLand(
  cfg: LandingRule,
  elapsedMs: number,
  stepPx: number,
  stuckForMs: number,
  dtMs: number,
): { land: boolean; stuckForMs: number } {
  const epsilon = cfg.stuckEpsilonPx ?? 1
  const limit = cfg.stuckMs ?? 80
  const nextStuck = stepPx <= epsilon ? stuckForMs + Math.max(0, dtMs) : 0
  // 时间到 → 落地（主判据，确定）；撞墙/被挡住不动 → 提前落地
  const land = elapsedMs >= cfg.flingTimeMs || nextStuck >= limit
  return { land, stuckForMs: nextStuck }
}
