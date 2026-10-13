/**
 * 地图校验的错误类型。**零 Phaser 依赖。**
 *
 * ---
 *
 * ## 为什么不能直接用 `core/config.ts` 的 `ConfigError`
 *
 * 形状一样（一个 `path` 字段 + 一句话），前缀不一样：那边是「配置表错误 @」。
 * 借过来的话，一张**生成错了**的地图会报成配置表错了 —— 而这两个故障的
 * 排查方向完全相反（改 JSON vs 改算法），现场却长得一模一样。
 *
 * ## 为什么错误必须自带「种子」
 *
 * 「某个种子生成了坏地图」这件事，**能复现才有意义**。
 * 一条「房间 #7 的第 3 个出生点不可达」没法拿去复跑；加上种子，
 * 一条命令就能把同一张图再生成一次（spec `map-reachability`：
 * 「批量校验报告种子 837 失败 → 能单独用种子 837 复现同一张图」）。
 *
 * 所以上下文是**错误类型的一部分**，不是拼在消息里的一句话 ——
 * 拼进去的话，将来谁改一下措辞，复现信息就没了。
 */

import type { Point } from '../model/types'

export interface MapErrorContext {
  /** 这次生成用的种子。**复现的钥匙** */
  seed?: number
  /** 出问题的房间在进度轴上的序号 */
  roomOrder?: number
  /** 出问题的点（通常是出生点坐标） */
  point?: Point
  /** 出问题的字段路径，例：`rooms[3].rect` */
  path?: string
}

/** 把上下文渲染成一行可复现的说明。 */
function describe(context: MapErrorContext): string {
  const bits: string[] = []
  if (context.seed !== undefined) bits.push(`种子 ${context.seed}`)
  if (context.roomOrder !== undefined) bits.push(`房间 #${context.roomOrder}`)
  if (context.point !== undefined) {
    bits.push(`坐标 (${round(context.point.x)}, ${round(context.point.y)})`)
  }
  return bits.length === 0 ? '' : `（${bits.join(' · ')}）`
}

const round = (n: number): number => Math.round(n * 100) / 100

export class MapValidationError extends Error {
  /** 出问题的字段路径。**C2 契约要求的形式**，例 `rooms[3].rect` */
  readonly path: string
  readonly context: MapErrorContext

  constructor(path: string, message: string, context: MapErrorContext = {}) {
    super(`地图校验失败 @ ${path}：${message}${describe(context)}`)
    this.name = 'MapValidationError'
    this.path = path
    this.context = context
  }
}