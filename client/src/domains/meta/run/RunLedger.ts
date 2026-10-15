/**
 * 一局的账本：数杀了多少、清了几间、到了第几层。
 *
 * ## 为什么 D4 自己数，而不是等 D1 报
 *
 * 经济是 D4 的设计输出，而**"数击杀"这件事总线已经给了**（`entity_killed`，
 * C1 里早就有）。让 D4 自己订阅总线，就不必为了发币去改 D1 的战斗代码 ——
 * 这是《人员分工方案》§四「跨域只走事件总线」最省事的一种用法。
 *
 * ## ⚠️ 清房数现在只能靠宿主自己报
 *
 * C1 里**还没有 `room_cleared` 事件**（D2 的改动日志点名要 D1 定稿，至今没定）。
 * 所以 `countClearedRoom()` 是给宿主调的：事件一定稿，把这里改成订阅即可，
 * 调用方一行都不用动。这条记在改动日志的缺口清单里。
 */

import type { GameEvents, TypedBus } from '@/core/events'
import type { RunInput } from '../progress/progress'

/**
 * 账本对总线的全部要求：**能订阅 `entity_killed`**。
 *
 * ## 为什么不写 `TypedBus<GameEvents>`
 *
 * `TypedBus<E>` 对 `E` 是**不变**的（`listenerCount(event: keyof E)` 让 E 出现在
 * 逆变位置），所以 `TypedBus<CombatEvents>`（D1 战斗场景那份，是 `GameEvents` 的
 * 超集）**不能**当成 `TypedBus<GameEvents>` 传进来 —— 类型系统会拦，而且拦得对。
 *
 * 收窄成"只订阅"这一条之后，`GameEvents` 的总线（测试场底座）和它的超集
 * （战斗场景）都能直接传，跨域也不靠强转。
 */
export type KillEventSource = Pick<TypedBus<GameEvents>, 'on'>

export class RunLedger {
  private killCount = 0
  private roomCount = 0
  private depthValue = 1
  private readonly unsubscribe: () => void

  constructor(bus: KillEventSource) {
    this.unsubscribe = bus.on('entity_killed', (e) => {
      // 只数敌人。玩家死亡也走这个事件（`kind: 'player'`），把它算进"击杀"会
      // 让玩家多拿一份币 —— 而且是**死得越多拿得越多**。
      if (e.kind === 'enemy') this.killCount += 1
    })
  }

  get kills(): number {
    return this.killCount
  }

  get clearedRooms(): number {
    return this.roomCount
  }

  get depth(): number {
    return this.depthValue
  }

  /** 宿主推进到新的一层时调 */
  setDepth(depth: number): void {
    this.depthValue = Math.max(1, Math.round(depth))
  }

  /** C1 还没有 `room_cleared`，所以清房由宿主报（见文件头） */
  countClearedRoom(): void {
    this.roomCount += 1
  }

  /** 结算要的那份输入 */
  input(outcome: RunInput['outcome']): RunInput {
    return {
      outcome,
      depth: this.depthValue,
      kills: this.killCount,
      clearedRooms: this.roomCount,
    }
  }

  /** 重新开一局。**`scene.restart()` 会建一个新的账本**，所以这条是给
   *  "不换场景的软重启"用的（演示用的测试场就是这种）。 */
  reset(): void {
    this.killCount = 0
    this.roomCount = 0
    this.depthValue = 1
  }

  /** 场景结束必须调 —— 不调的话总线上的订阅会留到下一个场景。 */
  dispose(): void {
    this.unsubscribe()
  }
}
