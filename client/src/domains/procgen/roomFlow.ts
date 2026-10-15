/**
 * **房间之间的转接**：这一间还要不要打、打完了没有、这一扇门现在该不该关着。
 *
 * 纯函数，零 Phaser 依赖（与 `colliders.ts` / `walkability.ts` 同一个层次、同一个理由：
 * 这些判断必须在没有浏览器的环境里可测）。
 *
 * ## 它管的四件事
 *
 * | 问题 | 函数 |
 * |---|---|
 * | 这一间要不要打 | `roomNeedsFight` |
 * | 打完了没有 | `roomCleared` |
 * | 这一扇门现在该不该关着 | `doorShouldBeClosed` |
 * | 这一扇门是不是被落在身后了 | `leavesBehind` |
 *
 * ## 为什么门的状态不写进 `DungeonMap`
 *
 * 地图是纯函数产物（同一颗种子逐字段可复现），而「这一局哪扇门开着」是**过程**，
 * 不是地图的属性。放进数据，地图就不再只由种子决定；而且封门是玩法的形状，
 * 调平衡不该改到生成器上去。所以 `DungeonMap` 一个字段都不加，
 * 状态由场景拿着，这里只出**判据**。
 *
 * ## `combatKinds` 与 `spawnPoints` 取「或」
 *
 * 「这一间打不打」有两个来源，它们说的不是一件事：
 *
 * - `combatKinds`（配置）说的是**这一类关别该不该打** —— 语义
 * - `spawnPoints`（地图）说的是**这一间实际有没有怪** —— 事实
 *
 * 正常情况两者一致；不一致时**以「没有出生点」为准**。理由是不对称的代价：
 * 把一间本该打的房放过去，玩家少打一场；把一间没怪的房锁上，玩家被关在里面
 * —— 没有怪可打，门永远不会开，而「不回头」规则下**整局作废**。
 * 宁可少打一场。
 *
 * ## 两条真存在的「不一致」，都不是假设
 *
 * - **非战斗关别却有空房**：`gen/spawns.ts` 对非战斗关别**早返回空数组**
 *   （`layout.ts` 也把预算写成 0）。今天它们本来就一致，
 *   但一条只认 `combatKinds` 的实现会在关别表改动的第一天把道具关变成牢房。
 * - **战斗关别却没有怪**：同一份 `gen/spawns.ts` 在**一个格都挑不出来**时
 *   也返回空数组（`candidates.length === 0`）。这不是理论分支 —— 它是那条
 *   「怪站不进去就只能给空房」的兜底，而 `validate/contract.ts` **只拒绝反方向**
 *   （非战斗房**有**刷怪点），这一头它管不着。
 *
 * 所以「或」不是为了将来，是为了今天就已经存在的那条路径。
 */

import type { RoomsConfig } from './config'
import { isCombatKind } from './config'
import type { Room } from './model/types'

/**
 * 这一间要不要打。
 *
 * `false` 的房间**一进场就算已清**（见 `doorShouldBeClosed` 的 `ownerInCombat`）——
 * 不这么做的话，道具关 / 宝箱关会把玩家关在里面：它们没有出生点，
 * 照「清完才开门」的字面执行，门永远不会开。
 */
export function roomNeedsFight(room: Room, cfg: RoomsConfig): boolean {
  return isCombatKind(cfg, room.kind) && room.spawnPoints.length > 0
}

/**
 * 这一间打完了没有。
 *
 * 两个输入都必须是**现在还活着 / 还没出来的数量**，只看存活是不够的：
 *
 * - 队列里排着一只还没出生的怪时，房间看起来是空的 —— 门提前打开，
 *   玩家走进隔壁，那只怪随后出生在身后的空房里。表现为「有一间永远清不掉」。
 * - 最后一只怪是**分裂怪**时还有第二段延迟：子代既不在存活里、也还没进队列。
 *   那一段**从 `EnemySystem` 的公开面看不到**，所以调用方要额外拿一个
 *   时间窗口兜住它（见 `docs/地牢生成设计.md` 与本次 change 的 design）。
 *
 * 这里只做算术：两个数都到 0 才算清。**时间窗口不在这条判据里** ——
 * 判据是纯的，等多久是调度的事。
 */
export function roomCleared(liveInRoom: number, queuedInRoom: number): boolean {
  return liveInRoom <= 0 && queuedInRoom <= 0
}

/**
 * 这一扇门是不是**被落在身后**了 —— 「不回头」规则。
 *
 * 判据一句话：**门两端的房间号里，小的那个比玩家现在所在的小，这扇门就关死了。**
 *
 * 取**两端的最小值**，而不是只看 `ownerOrder`：一扇门连着 {`ownerOrder`, `toOrder`}
 * 两间（去重后的挡板两端的编号都在这一对里，见 `colliders.ts` 文件头那条 ⚠️）。
 * 只看 `ownerOrder` 会漏掉一类：侧室 `#4` 与宿主 `#3` 之间那个洞，
 * 去重后可能记在 `#3` 名下（`ownerOrder = 3`）。玩家走进 `#4` 之后，
 * 只看 `ownerOrder` 会算出「没被落在身后」，于是**能倒回宿主** —— 而那正是
 * 「不回头」要禁的事。
 *
 * ## 为什么是比大小，不是记一个「走过的房间」集合
 *
 * 记集合就有了第二份状态，而它和地图上的顺序迟早会分岔（分岔了不会报错，
 * 只会表现为「这一扇门莫名其妙能走」）。`Room.order` 本来就是地图上唯一的顺序来源，
 * 大小关系直接从它来。
 *
 * ⚠️ **一个反直觉的地方**：主干 `#5` 的 back 门 `toOrder` 是 **3** 而不是 4 ——
 * 因为侧室不占主干的位置轴，`#5` 的背面是连廊另一头的 `#3`。
 * 所以这条规则只能用 `toOrder` 比大小，**不能用「比上一间的序号小」**。
 */
export function leavesBehind(
  ownerOrder: number,
  toOrder: number | null,
  currentOrder: number,
): boolean {
  if (toOrder === null) return true // 尽头/墙外，永远不通
  return Math.min(ownerOrder, toOrder) < currentOrder
}

/** 判「这一扇门现在该不该关着」的输入。 */
export interface DoorStateInput {
  /** 门洞开在**第几间**的墙上 */
  readonly ownerOrder: number
  /** 穿过去到哪一间。`null` = 墙外 */
  readonly toOrder: number | null
  /** 玩家现在在第几间 */
  readonly currentOrder: number
  /** 这扇门所属的那一间**现在还在不在战斗**（要打、且没清完） */
  readonly ownerInCombat: boolean
}

/**
 * 这一扇门现在该不该关着。**所有理由取或** —— 任何一条成立就关上。
 *
 * | 理由 | 什么时候成立 |
 * |---|---|
 * | 尽头 | `toOrder === null`：门外面是墙外，本来就没有地方可去 |
 * | 落在身后 | 「不回头」 |
 * | 正在战斗 | 这一间要打且没清完：**怪不能跑出去** |
 *
 * 最后一条不只是玩法，它是**清房判定成立的前提**：怪不可能跑到隔壁房间去，
 * 「本房间敌人全部死亡」才是一个可判定的条件，而不是「差不多能判」。
 *
 * ⚠️ 这里判的是**门该是什么状态**，不是「谁来把它变成那个状态」。
 * 挡板的开关是场景的事（`colliders.ts` 里那条：「开关状态不在数据里、也不该在」）。
 */
export function doorShouldBeClosed(input: DoorStateInput): boolean {
  const { ownerOrder, toOrder, currentOrder, ownerInCombat } = input
  if (leavesBehind(ownerOrder, toOrder, currentOrder)) return true
  return ownerInCombat
}