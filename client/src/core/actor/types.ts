/**
 * 玩家与敌人共用的「实体」形状。
 *
 * **零 Phaser 依赖**（只允许 `import type`），因为敌人的 AI 必须能在 node 下直测。
 *
 * ## 位置真值只有一处：Arcade body
 *
 * 这是本项目最容易写错的地方，单独强调：
 *
 * - **`ActorModel` 不自己积分位置。** 它只输出 `velIntent`（速度意图）。
 * - 每个物理步由 `Actor.syncFromBody()` 把 `body.center` / `body.velocity` **回读**进快照。
 * - brain 拿到的是**快照**，不是活的对象。
 *
 * 如果让逻辑自己算 `x += vx * dt`，就会和物理引擎各算一套，表现为「敌人穿墙」
 * 「碰撞位置对不上」「分离力把它们推向墙壁里」。**不要开第二套坐标系。**
 */

import type { Knockback } from './damage'
import type { RngLike } from '../rng'

/** 一个实体在某一瞬间的样子。brain 与表现层只读它。 */
export interface ActorSnapshot {
  id: number
  kind: 'player' | 'enemy'
  /** 位置真值来自 Arcade body（见文件头说明） */
  x: number
  y: number
  vx: number
  vy: number
  /** 碰撞半径，与贴图尺寸解耦 */
  radius: number
  hp: number
  maxHp: number
  alive: boolean
  state: string
}

/** brain 需要知道的关于「自己」的额外信息（快照里装不下的敌人专有量）。 */
export interface BrainSelfInfo {
  /** 分裂怪的代际，0/1/2 */
  gen: number
  /** 当前速度上限（已含减速与难度乘数） */
  speed: number
  /** 进入视野的时间，用于「生成宽限」 */
  spawnedAtMs: number
}

/**
 * 导航查询的**最小接口**。`domains/enemies/nav/flowField.ts` 的 `FlowField` 结构上满足它。
 *
 * 刻意只放两个方法：`core` 不知道「流向场」「网格」「BFS」这些概念存在，
 * 只声明「有人能回答『该往哪走』和『看得见吗』」。这样
 * ① 没有墙的测试场可以传 `null`（全场直线追，零开销）；
 * ② brain 可以用桩对象单测，不需要真的建一张网格。
 */
export interface NavView {
  /**
   * 该点的建议移动方向（单位向量）。
   * `null` = 导航帮不上忙（还没建、不可达、坐标在网格外）→ 调用方退回直线追。
   * `(0,0)` = 已经和目标在同一格。
   */
  dirAt(x: number, y: number): { x: number; y: number } | null
  /** 两点之间有没有墙。用来消掉流向场的 8 方向量化。 */
  hasLineOfSight(x0: number, y0: number, x1: number, y1: number): boolean
}

export interface BrainContext {
  /** 逻辑时间，取 `GameClock.nowMs` */
  nowMs: number
  /** 本帧与上一帧的间隔（秒），用于把「每秒速度」换算成位移意图 */
  dtSec: number
  self: ActorSnapshot
  selfInfo: BrainSelfInfo
  /** 玩家快照；null = 当前没有目标 */
  target: ActorSnapshot | null
  /** 同阵营邻居，来自空间哈希（见 `nav/spatialHash.ts`）。不是全量敌人。 */
  neighbors: readonly ActorSnapshot[]
  /**
   * 导航查询。**`null` 是合法值**（房间没有墙、或独立测试）。
   * 拿到 `null` 一律走直线追 —— 不要当成「站着不动」。
   */
  nav: NavView | null
  /** 确定性随机。爆炸扇形、粒子抖动用它，**不要用 `Math.random()`** */
  rng: RngLike
}

/** brain 想打出的攻击。由 `EnemySystem` 统一结算，brain 自己不碰物理。 */
export interface BrainAttack {
  kind: string
  radius: number
  damage: number
  knockback?: Knockback
  /** 顿帧时长（毫秒），0 = 不顿帧 */
  hitstopMs?: number
}

/** brain 的输出。**只输出意图，不直接改世界。** */
export interface BrainOutput {
  /** 速度意图，单位 px/s。0 就是停下 */
  vx: number
  vy: number
  /** 想切到的状态；`undefined` = 保持不变 */
  nextState?: string
  /** 想发动的攻击；`undefined` = 本 tick 不攻击 */
  attack?: BrainAttack
}

/** brain 是纯函数：给一份上下文，出一个意图。持有状态请放在 model 上。 */
export type Brain<C extends BrainContext = BrainContext> = (ctx: C) => BrainOutput

export const IDLE_OUTPUT: BrainOutput = { vx: 0, vy: 0 }