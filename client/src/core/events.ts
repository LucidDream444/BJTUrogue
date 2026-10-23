/**
 * C1 事件总线 —— **跨域通信的唯一通道**（《人员分工方案》）。
 *
 * 不要直接调用另一个域的方法或读它的内部状态，一律走这里。
 *
 * 本文件是 **D3 起草的 v0 提案**，终稿归 D1。改动需全员同意。
 * 零 Phaser 依赖，node 下可直测。
 *
 * ## 用法
 *
 * ```ts
 * const bus = new TypedBus<GameEvents>()
 * const unsub = bus.on('entity_killed', (e) => { ... })  // 返回退订函数
 * bus.emit('entity_killed', { ... })
 * unsub()                                                // 场景 shutdown 里必须调
 * ```
 *
 * ⚠️ **场景生命周期**：在 `create()` 里 `on()` 而 `shutdown` 里不 `off()`，
 * 重启 3 次就留 3 个 handler。**务必保存 `on()` 返回的退订函数并在 shutdown 里调用**——
 * 匿名函数传给 `off()` 会静默失败（引用不相等），这类 bug 没有任何报错。
 */

export type EventMap = Record<string, unknown>

export type Unsubscribe = () => void

export class TypedBus<E extends EventMap> {
  private readonly handlers = new Map<keyof E, Set<(payload: never) => void>>()

  /** 订阅。**返回退订函数**，请保存它并在 `shutdown` 里调用。 */
  on<K extends keyof E>(event: K, fn: (payload: E[K]) => void): Unsubscribe {
    let set = this.handlers.get(event)
    if (!set) {
      set = new Set()
      this.handlers.set(event, set)
    }
    set.add(fn as (payload: never) => void)
    return () => this.off(event, fn)
  }

  /** 订阅一次。 */
  once<K extends keyof E>(event: K, fn: (payload: E[K]) => void): Unsubscribe {
    const unsub = this.on(event, (payload) => {
      unsub()
      fn(payload)
    })
    return unsub
  }

  off<K extends keyof E>(event: K, fn: (payload: E[K]) => void): void {
    this.handlers.get(event)?.delete(fn as (payload: never) => void)
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    const set = this.handlers.get(event)
    if (!set || set.size === 0) return
    // 复制一份再遍历：handler 内部退订/新增不会让迭代器失效
    for (const fn of [...set]) {
      try {
        ;(fn as (p: E[K]) => void)(payload)
      } catch (err) {
        // 一个订阅者炸掉不能拖垮其他订阅者，更不能中断游戏主循环
        console.error(`[events] handler for "${String(event)}" threw:`, err)
      }
    }
  }

  /** 场景 shutdown 里调一次，清干净。 */
  clear(): void {
    this.handlers.clear()
  }

  listenerCount(event: keyof E): number {
    return this.handlers.get(event)?.size ?? 0
  }
}

/** 载荷为空的事件用它，`emit('x', {})`。 */
export type EmptyPayload = Record<string, never>

export type ActorKind = 'player' | 'enemy'
export type EnemyKind = 'splitter' | 'tank' | 'grabber'

// 伤害相关的两个枚举只定义在 actor/damage.ts 一份，这里转发，避免两处漂移。
// 依赖方向是 events → damage，反过来是禁止的（damage.ts 必须保持零依赖，见 architecture.test.ts）。
export type { DamageSourceKind, DamageMode } from './actor/damage'
import type { DamageSourceKind, DamageMode } from './actor/damage'

/**
 * 全局事件表。**新增事件 = 改契约，要在群里说。**
 *
 * 命名约定：`<名词>_<过去式动词>`，全小写下划线。
 */
export interface GameEvents extends EventMap {
  entity_spawned: {
    bossStage?: number
    id: number
    kind: ActorKind
    enemyKind?: EnemyKind
    /** 分裂怪的代际，0/1/2；其他敌人没有 */
    gen?: number
    x: number
    y: number
  }

  entity_damaged: {
    targetId: number
    targetKind: ActorKind
    amount: number
    hpAfter: number
    sourceId: number
    sourceKind: DamageSourceKind
    mode: DamageMode
    /**
     * 高频 tick 会被聚合：`batched: true` 时 `amount` 是这一批的总和、`tickCount` 是批内次数。
     * **飘字渲染归 D1**，聚合是为了不让事件洪泛拖垮渲染。
     */
    batched: boolean
    tickCount: number
    frameId: number
  }

  entity_killed: {
    bossStage?: number
    id: number
    kind: ActorKind
    enemyKind?: EnemyKind
    gen?: number
    x: number
    y: number
    sourceId: number
  }

  enemy_split: {
    parentId: number
    children: number[]
    parentGen: number
    childGen: number
  }

  app_paused: { reason: 'user' | 'hidden' }
  app_resumed: EmptyPayload
}
