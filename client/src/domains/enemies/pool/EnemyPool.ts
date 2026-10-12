/**
 * 敌人对象池。**零 Phaser 依赖**（对「表现」是泛型的，见下），node 下可直接单测。
 *
 * ## 为什么泛型 `V` 而不是直接 `Actor`
 *
 * 池要管两样东西：**逻辑**（`EnemyModel`，纯数据）和**表现**（`Actor`，Sprite + 物理体）。
 * 如果这里 `import { Actor }`，整个文件就被拖进 Phaser 依赖 —— 池的复用逻辑
 * （最容易写出「回池后还带着上一只怪的状态」这类 bug 的地方）就再也不能在 node 里单测了。
 *
 * 所以池对表现层只要求两件事：造一个（`createView`）、回收一个（`destroyView`）。
 * `EnemySystem` 传真的 `Actor` 工厂；测试传 `null`。
 *
 * ## ⚠️ 释放必须同时 `ledger.releaseTarget()`
 *
 * 伤害账本按 `(源, 目标)` 配对记账（不变式 ④）。怪回池了但账本里还留着它的条目，
 * 下一只复用这个槽位的怪会**继承上一只的 tick 计时**：
 * 它一出生就在挨打，或者干脆不挨打。
 *
 * 这种事「忘了写」的概率极高（释放点会有好几处：死亡、清场、切场景、回池）。
 * 所以释放路径**只有一个** —— `release()`，而它内部一定调 `onRelease` 钩子，
 * `EnemySystem` 把钩子接到 `ledger.releaseTarget` 上。
 * 谁都不许绕过 `release()` 直接改 freelist。
 */

import { EnemyModel, type EnemySpec } from '../model/EnemyModel'
import type { EnemyKind } from '@/core/events'

/** 一个池槽位：逻辑模型 + 它的表现对象。 */
export interface PooledEnemy<V> {
  readonly model: EnemyModel
  readonly view: V
}

export interface EnemyPoolOptions<V> {
  /** 池容量上限（配置 `balance.spawn.poolCapacity`） */
  capacity: number
  /** 造一个表现对象。只在这一对 (model, view) 第一次被创建时调一次 */
  createView: (model: EnemyModel) => V
  /** 回收表现对象：从场景里摘掉、回它自己的池（子弹/粒子那种）。**不是销毁** */
  destroyView: (view: V) => void
  /**
   * 一个槽位被彻底释放时调（死亡、清场、场景 shutdown）。
   *
   * `EnemySystem` 必须把它接到 `ledger.releaseTarget(model)` —— 见文件头。
   * 设成必填而不是可选，就是为了让「忘了接」变成编译错误。
   */
  onRelease: (model: EnemyModel) => void
}

/**
 * 按 `kind:gen` 分组的空闲槽位表。
 *
 * 分开存的原因：分裂怪有三代、体型/贴图/血量都不同，肉盾又是另一个量级。
 * 混在一个 freelist 里的话，一只大肉盾回池后可能被拿去做第三代小分裂怪，
 * 每次都要重设体型 —— 而 Arcade 的圆形 body 尺寸是**保留在 `sourceWidth` 里的**，
 * 反复缩放正是最容易出「碰撞半径和贴图对不上」的路径。
 */
function keyOf(kind: EnemyKind, gen: number): string {
  return `${kind}:${gen}`
}

export class EnemyPool<V> {
  private readonly free = new Map<string, PooledEnemy<V>[]>()
  private readonly all: PooledEnemy<V>[] = []
  /** 已经拿出池、还没释放的槽位。用 Set 而不是计数器，是为了能在 `release` 里查重 */
  private readonly checkedOut = new Set<PooledEnemy<V>>()
  private readonly opts: EnemyPoolOptions<V>

  constructor(opts: EnemyPoolOptions<V>) {
    if (opts.capacity < 1) throw new Error('EnemyPool: capacity 必须 ≥ 1')
    this.opts = opts
  }

  /** 池里一共造过多少槽位（含在用的）。用来判断还能不能新建 */
  get created(): number {
    return this.all.length
  }

  /** 在用的槽位数量。`SpawnQueue` 拿它跟 `maxAliveSoft/Hard` 比 */
  get live(): number {
    return this.checkedOut.size
  }

  /** 空闲槽位数 */
  get idle(): number {
    return this.all.length - this.checkedOut.size
  }

  /**
   * 取一个槽位。**池满且无空闲时返回 `null`**（不抛异常、不自动扩容）：
   * 敌人刷不出来是「这一帧没刷」，不该让整个游戏崩掉。
   * 调用方（`SpawnQueue`）拿到 `null` 就把请求留在队列里等下一帧。
   */
  acquire(spec: EnemySpec, nowMs: number): PooledEnemy<V> | null {
    const key = keyOf(spec.kind, spec.gen)
    const bucket = this.free.get(key)
    let entry: PooledEnemy<V>

    if (bucket && bucket.length > 0) {
      entry = bucket.pop()!
    } else if (this.all.length < this.opts.capacity) {
      // 造新槽位。**只在容量允许时**。
      // ⚠️ `gen` 必须在构造时就定下来（模型用 `enemyKind` 决定穿透等身份行为），
      // 所以这里用 spec 的值，之后 `respawn` 会再写一遍。
      const model = new EnemyModel(spec.kind)
      entry = { model, view: this.opts.createView(model) }
      this.all.push(entry)
    } else {
      return null
    }

    this.checkedOut.add(entry)
    entry.model.respawn(spec, nowMs)
    return entry
  }

  /**
   * 释放回池。**这是唯一的释放路径。**
   *
   * 重复释放会抛异常而不是静默忽略 —— 双重释放说明调用方有两条路径都在回收同一个怪
   * （典型场景：致死那一帧既走了「死亡处理」又走了「清场」），
   * 静默忽略会让这个 bug 一直藏着，直到某只怪莫名其妙地出现在别处。
   */
  release(entry: PooledEnemy<V>): void {
    if (!this.checkedOut.delete(entry)) {
      throw new Error('EnemyPool: 重复释放同一个槽位（检查是不是有两条死亡/清场路径）')
    }

    // 顺序不能换：先让账本松手，再让模型和表现失活。
    // 反过来的话，`releaseTarget` 之前模型已经 `despawn`（alive=false），
    // 账本那边对「目标已经没了」的处理就只有 spawnSeq 兜底这一条路了。
    this.opts.onRelease(entry.model)
    entry.model.despawn()
    this.opts.destroyView(entry.view)

    const key = keyOf(entry.model.enemyKind, entry.model.gen)
    let bucket = this.free.get(key)
    if (!bucket) {
      bucket = []
      this.free.set(key, bucket)
    }
    bucket.push(entry)
  }

  /** 在用的槽位快照。遍历时**不要**在里面调用 `release`，会改 Set 的迭代器。 */
  activeEntries(): readonly PooledEnemy<V>[] {
    return [...this.checkedOut]
  }

  /**
   * 全部回收（切场景 / shutdown / 重开一局）。
   *
   * 每个槽位都走 `release()`，所以账本会被正确清干净 ——
   * 这正是「释放路径只有一条」的回报：清场不需要另写一套清理逻辑。
   */
  releaseAll(): void {
    for (const entry of [...this.checkedOut]) {
      this.release(entry)
    }
  }

  /** 测试与调试用：这个 key 有多少空闲槽位。 */
  idleCount(kind: EnemyKind, gen: number): number {
    return this.free.get(keyOf(kind, gen))?.length ?? 0
  }
}