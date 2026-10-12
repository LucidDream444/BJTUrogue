/**
 * 受击契约与「帧伤」账本。
 *
 * **零 Phaser 运行时依赖**，node 下可直接单测（`vite.config.ts` 的 test.environment 就是 node，
 * 任何需要 jsdom 的测试都说明逻辑没和表现层分开）。`architecture.test.ts` 会扫描本文件并断言它。
 *
 * ---
 *
 * ## 什么是「帧伤」
 *
 * 玩家提问里的原话是「子弹、近战武器对它都是帧伤（一旦接触会一直触发受击并播放受击音效受击动画）」。
 * 要的是**持续接触 → 持续结算**的手感。Arcade 的 `overlap` / `collide` 回调恰好天生如此：
 * `[源码]` 它**没有 enter/stay/exit 语义，持续重叠时每一个物理步都会触发**，且没有内建的 once 参数。
 *
 * 这正合适，**但它是经典 bug 源**（同一帧结算 N 次）。所以本文件存在的全部意义就是：
 * 把「持续接触」这件物理事实，翻译成**有确定语义、可被 Vitest 锁死的伤害节拍**。
 *
 * ## 四条不变式（全部有测试）
 *
 * 1. **每个 (攻击源, 目标) 配对，每 tick 最多结算一次。**
 *    实现：每个目标一个 `Map<sourceId, TickEntry>`，以**单调递增的数值 sourceId** 为键。
 *    ⚠️ 绝不用池槽位号或位运算 pairKey —— 槽位会复用，复用就会串味。
 * 2. **每个配对（源,目标），单帧最多推进一次 tick**（低端机 delta = 50ms 是合法的，
 *    但不该变成 3 次跳字）。实现：闸门是 `TickEntry.lastSettledFrameId`——**每配对一份**；
 *    且 `nextTickAtMs = nowMs + tickMs`（**用赋值，不用 `+=`**），所以不会「追赶」补结算。
 *    ⚠️ 作用域必须是「配对」而不是「账本」：见 `step()` 里记的两版错误实现
 *    （一版会变成结算零次，一版会让群怪伤害塌成 1/N）。
 * 3. **攻击源被回收时** `releaseSource(sourceId)` **清掉它的全部条目。**
 * 4. **目标死亡或回池时必须** `releaseTarget(target)`。
 *    否则池槽位复用后，旧子弹的 tick 会结算到新生成的敌人身上（「打到尸体上」）。
 *    目标侧另有一道保险：结算前校验 `entry.targetSpawnSeq === target.spawnSeq && target.alive`。
 *
 * ## 时序（已对 Phaser 3.90.0 源码核实）
 *
 * `[源码]` `physics/arcade/World.js` L936–1012：同一步里先跑 `collider.update()`
 * （**碰撞回调在此触发**），**之后**才 `emit(WORLD_STEP)`。低帧率的补步路径 `World.step()` 顺序相同。
 *
 * 于是得到一条可靠的时序保证：
 *
 * ```
 * 碰撞回调 touch()          ← 登记「这一步确实碰到了」
 *        ↓
 * WORLD_STEP → ledger.step()  ← 结算到期的 tick
 * ```
 *
 * `step()` 只结算**本步内被 touch 过**的条目 —— 这就是「脱接触即停伤」的实现方式，
 * 不需要额外参数：子弹飞出肉盾后不再有 touch，tick 自然停下，剩下的交给 ttl 清理。
 */

export type DamageSourceKind = 'bullet' | 'melee' | 'contact' | 'aoe'
export type DamageMode = 'instant' | 'tick'

export interface Knockback {
  x: number
  y: number
  strength: number
}

export interface HitRequest {
  /**
   * 单调递增、**永不复用**的数值 id。
   * 子弹 = D1 开火时分配的 `shotId`；敌人 = 实例 id；调试点击 = `++debugSeq`。
   */
  sourceId: number
  /**
   * 同一 `frameId` 内的去重键（`${frameId}:${hitKey}` 才是完整键）。
   * 例：`bullet:${shotId}`、`tick:${shotId}:${n}`、`debug:${n}`。
   */
  hitKey: string
  /** `instant` = 立即结算一次；`tick` = 交账本按节拍结算（此时 `amount` 是每 tick 伤害） */
  mode: DamageMode
  amount: number
  /** 取 `GameClock.frameId`。**不要自己造帧号。** */
  frameId: number
  /**
   * 取 `GameClock.nowMs`（**逻辑时间**）。**必须带**。
   *
   * 目标的受击反应要靠它：受击硬直什么时候结束、减速叠层多久过期、无敌帧还剩多少 ——
   * 全是「记一个时刻，之后比差值」。缺了它就只能靠调用方在外面偷偷塞一个字段，
   * 那种写法漏一处就静默失效（而且只在被打的瞬间才暴露）。
   */
  nowMs: number
  sourceKind: DamageSourceKind
  knockback?: Knockback
}

export interface HitResult {
  /** 实际扣掉的血量（会被 maxHp 截断，且死亡后为 0） */
  applied: number
  killed: boolean
  /**
   * **告诉 D1 这个源该不该销毁。**
   *
   * 普通敌人返回 `true`（攻击源被挡下）；**肉盾怪对任何源都返回 `false`**
   * （子弹穿透、近战挥砍也不被吃掉）。
   *
   * D1 的子弹逻辑因此永远是同一句 `if (result.consumed) recycleBullet()`——
   * **不需要知道有「穿透怪」这个东西存在**，也不必写任何分支。
   */
  consumed: boolean
}

/** 账本对「被打的东西」的唯一要求。`ActorModel` 天然满足。 */
export interface TickTarget {
  readonly id: number
  /** 每次 spawn 由单调计数器分配；池槽位复用后这个值也不同（不变式 ④ 的保险） */
  readonly spawnSeq: number
  readonly alive: boolean
  takeHit(req: HitRequest): HitResult
}

export interface TickOptions {
  sourceKind: DamageSourceKind
  /** 每 tick 造成的伤害 */
  amountPerTick: number
  /** 同一接触源最多结算几次；默认取 `LedgerConfig.maxTicksPerSourceDefault` */
  maxTicks?: number
  /** 脱接触多久后条目过期，默认取 `LedgerConfig.pairTtlMs` */
  ttlMs?: number
}

export interface LedgerConfig {
  /** tick 节拍，毫秒。形态上的「帧伤」就是这个频率在响 */
  tickMs: number
  /** 脱接触后多久清理条目 */
  pairTtlMs: number
  maxTicksPerSourceDefault: number
  /** 条目总数上限，防御性兜底；超过时丢弃最老的并 console.warn */
  maxEntries: number
}

export const DEFAULT_LEDGER_CONFIG: LedgerConfig = {
  tickMs: 100,
  pairTtlMs: 250,
  maxTicksPerSourceDefault: 8,
  maxEntries: 4096,
}

interface TickEntry {
  readonly sourceId: number
  readonly target: TickTarget
  readonly targetSpawnSeq: number
  readonly sourceKind: DamageSourceKind
  readonly amountPerTick: number
  readonly maxTicks: number
  readonly ttlMs: number
  /** 下一次该结算的时刻。**只由结算推进，touch 不会重置它** */
  nextTickAtMs: number
  lastTouchMs: number
  touchedThisStep: boolean
  ticksDone: number
  /** 这个配对最近一次真的结算了的 frameId —— 不变式 ② 的闸门就在这儿，每配对一份 */
  lastSettledFrameId: number
}

export interface LedgerSnapshotEntry {
  sourceId: number
  targetId: number
  amountPerTick: number
  ticksDone: number
  maxTicks: number
  nextTickInMs: number
  staleForMs: number
}

export interface LedgerStepResult {
  settled: number
  damage: number
  expired: number
  released: number
}

export class DamageLedger {
  private readonly cfg: LedgerConfig
  private readonly byTarget = new Map<TickTarget, Map<number, TickEntry>>()
  private readonly bySource = new Map<number, Set<TickTarget>>()
  private totalTicks = 0

  constructor(config: Partial<LedgerConfig> = {}) {
    this.cfg = { ...DEFAULT_LEDGER_CONFIG, ...config }
    if (this.cfg.tickMs <= 0) throw new Error('DamageLedger: tickMs 必须 > 0')
  }

  /** 条目总数，HUD 与测试用。 */
  get entryCount(): number {
    let n = 0
    for (const m of this.byTarget.values()) n += m.size
    return n
  }

  /** 累计结算过的 tick 次数。 */
  get tickCount(): number {
    return this.totalTicks
  }

  /**
   * 登记/刷新一次接触。**物理回调里调它，不要在回调里做别的。**
   *
   * - 首次接触：建条目，`nextTickAtMs = nowMs + tickMs`
   * - 后续接触：只刷新 `lastTouchMs`，**不动 `nextTickAtMs`**
   *   （否则持续接触会被无限推迟，永远不结算）
   */
  touch(sourceId: number, target: TickTarget, opts: TickOptions, nowMs: number): void {
    let perTarget = this.byTarget.get(target)
    if (!perTarget) {
      perTarget = new Map()
      this.byTarget.set(target, perTarget)
    }

    let entry = perTarget.get(sourceId)
    if (!entry) {
      entry = {
        sourceId,
        target,
        targetSpawnSeq: target.spawnSeq,
        sourceKind: opts.sourceKind,
        amountPerTick: opts.amountPerTick,
        maxTicks: opts.maxTicks ?? this.cfg.maxTicksPerSourceDefault,
        ttlMs: opts.ttlMs ?? this.cfg.pairTtlMs,
        nextTickAtMs: nowMs + this.cfg.tickMs,
        lastTouchMs: nowMs,
        touchedThisStep: true,
        ticksDone: 0,
        lastSettledFrameId: -1,
      }
      perTarget.set(sourceId, entry)

      let targets = this.bySource.get(sourceId)
      if (!targets) {
        targets = new Set()
        this.bySource.set(sourceId, targets)
      }
      targets.add(target)

      this.enforceEntryCap()
    } else {
      entry.lastTouchMs = nowMs
      entry.touchedThisStep = true
    }
  }

  /** 攻击源被回收（子弹进池、近战挥砍结束）时调用。不变式 ③。 */
  releaseSource(sourceId: number): void {
    const targets = this.bySource.get(sourceId)
    if (!targets) return
    for (const target of targets) {
      const perTarget = this.byTarget.get(target)
      if (!perTarget) continue
      perTarget.delete(sourceId)
      if (perTarget.size === 0) this.byTarget.delete(target)
    }
    this.bySource.delete(sourceId)
  }

  /** 目标死亡或回池时调用。不变式 ④——**漏了它就会打到尸体上**。 */
  releaseTarget(target: TickTarget): void {
    const perTarget = this.byTarget.get(target)
    if (!perTarget) return
    for (const sourceId of perTarget.keys()) {
      const targets = this.bySource.get(sourceId)
      if (!targets) continue
      targets.delete(target)
      if (targets.size === 0) this.bySource.delete(sourceId)
    }
    this.byTarget.delete(target)
  }

  /**
   * 每个物理步调一次，**挂在 `Phaser.Physics.Arcade.Events.WORLD_STEP` 上**。
   *
   * 不要挂在 `Scene.update()` 的渲染 delta 上：144Hz 屏会让伤害翻倍，掉帧时又会一次结算好几次。
   */
  step(nowMs: number, frameId: number): LedgerStepResult {
    const result: LedgerStepResult = { settled: 0, damage: 0, expired: 0, released: 0 }

    // 不变式 ②：**每个配对，单帧最多推进一次 tick**。
    //
    // 闸门在 `entry.lastSettledFrameId` 上（每配对一个），**不是**账本级的一个变量。
    // 走过两版错误实现，两条都值得留在这儿：
    //
    //   ✗ v1「同一个 frameId 直接 return」—— 掉帧时一帧内有 12 个物理步，
    //     只看了第 1 步，而它往往还没到 tick 时刻，于是**整帧一次都不结算**。
    //     「最多一次」变成了「恰好零次」。
    //   ✗ v2「账本级一个 settledThisFrame 标志」—— 一帧内**全体**只放行一次结算。
    //     后果：一发穿透弹同时穿过 3 只肉盾只结算 1 只；10 只分裂怪贴脸也只结算 1 只
    //     （接触伤害变成 1/10）。对一个主打割草的游戏，这等于把群怪手感整个抹掉。
    //
    // 正确的作用域是「每个 (源,目标) 配对」：同一步里 20 个配对同时到期就该结算 20 次，
    // 而**同一个**配对在一个渲染帧里最多结算一次（低帧率不放大伤害、不多播放受击反馈）。
    const removals: TickEntry[] = []
    const tickMs = this.cfg.tickMs

    for (const perTarget of this.byTarget.values()) {
      for (const entry of perTarget.values()) {
        const target = entry.target

        // 不变式 ④的保险：目标死了 / 槽位被复用了 → 丢弃，绝不结算
        if (!target.alive || target.spawnSeq !== entry.targetSpawnSeq) {
          removals.push(entry)
          result.released++
          continue
        }

        // 脱接触太久 → 过期
        if (nowMs - entry.lastTouchMs > entry.ttlMs) {
          removals.push(entry)
          result.expired++
          continue
        }

        // 只有**本步确实接触过**才结算 —— 这就是「脱接触即停伤」。
        //
        // `ticksDone < maxTicks` 这个条件不能换成「达到上限就删条目」：
        // 删了之后下一次 touch 会立刻建一个新条目，上限对**持续接触**根本不生效
        // （近战武器一直贴着砍，会打出远超 maxTicks 的次数）。
        // 达到上限后条目留着、只是不再结算，直到脱接触满 ttlMs 才消失 ——
        // 这才对应「需中断重接」的语义。
        if (
          entry.lastSettledFrameId !== frameId &&
          entry.touchedThisStep &&
          entry.ticksDone < entry.maxTicks &&
          nowMs >= entry.nextTickAtMs
        ) {
          const hit = target.takeHit({
            sourceId: entry.sourceId,
            hitKey: `tick:${entry.sourceId}:${entry.ticksDone}`,
            mode: 'instant',
            amount: entry.amountPerTick,
            frameId,
            nowMs,
            sourceKind: entry.sourceKind,
          })
          entry.ticksDone++
          this.totalTicks++
          result.settled++
          result.damage += hit.applied
          // 赋值而不是 += ：不追赶，不补结算
          entry.nextTickAtMs = nowMs + tickMs
          entry.lastSettledFrameId = frameId
        }

        entry.touchedThisStep = false
      }
    }

    for (const entry of removals) this.detach(entry)
    return result
  }

  /** HUD 与测试用。 */
  snapshot(nowMs: number): LedgerSnapshotEntry[] {
    const out: LedgerSnapshotEntry[] = []
    for (const perTarget of this.byTarget.values()) {
      for (const e of perTarget.values()) {
        out.push({
          sourceId: e.sourceId,
          targetId: e.target.id,
          amountPerTick: e.amountPerTick,
          ticksDone: e.ticksDone,
          maxTicks: e.maxTicks,
          nextTickInMs: Math.max(0, e.nextTickAtMs - nowMs),
          staleForMs: Math.max(0, nowMs - e.lastTouchMs),
        })
      }
    }
    return out
  }

  /** 换局/关场景时清干净。 */
  clear(): void {
    this.byTarget.clear()
    this.bySource.clear()
    this.totalTicks = 0
  }

  private detach(entry: TickEntry): void {
    const perTarget = this.byTarget.get(entry.target)
    if (perTarget) {
      perTarget.delete(entry.sourceId)
      if (perTarget.size === 0) this.byTarget.delete(entry.target)
    }
    const targets = this.bySource.get(entry.sourceId)
    if (targets) {
      targets.delete(entry.target)
      if (targets.size === 0) this.bySource.delete(entry.sourceId)
    }
  }

  private enforceEntryCap(): void {
    if (this.entryCount <= this.cfg.maxEntries) return
    // 防御性兜底：正常玩法永远到不了这里。到得了说明有源没 releaseSource。
    let oldest: TickEntry | undefined
    for (const perTarget of this.byTarget.values()) {
      for (const e of perTarget.values()) {
        if (!oldest || e.lastTouchMs < oldest.lastTouchMs) oldest = e
      }
    }
    if (oldest) {
      console.warn(
        `[DamageLedger] 条目数超过上限 ${this.cfg.maxEntries}，丢弃最老的条目 ` +
          `(source ${oldest.sourceId} → target ${oldest.target.id})。` +
          `这通常意味着有攻击源被回收时没调 releaseSource()。`,
      )
      this.detach(oldest)
    }
  }
}