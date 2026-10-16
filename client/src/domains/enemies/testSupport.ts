/**
 * 敌人单测的公用夹具。**只在测试里 import，不进游戏包**
 * （主流程没有任何文件引用它，打包时会被摇掉）。
 *
 * 名字刻意**不叫** `*.test.ts` —— 那样 vitest 会把它当成一个「零用例的测试文件」收进套件，
 * 报告里会多一行没有意义的 0 passed。
 *
 * ## 为什么要模拟物理，而不是直接调 brain
 *
 * 只调 brain、手工摆 `self.x` 的话，「敌人会不会撞墙 / 会不会绕远 / 会不会追不上」
 * 这类问题一个都测不出来 —— 它们全都要跑很多 tick 才显形。
 * 所以这里用一个**极简的位置积分器**（`x += velIntent * dtSec`）代替 Arcade 物理：
 * 没有碰撞、没有墙，但足以验证「状态机会不会卡死」「多久能走到」。
 * 真实墙体的行为由 `nav/nav.test.ts` 的流向场测试覆盖。
 *
 * `arch-lint-allow`（文件级）：这个文件**故意**用随手编的数字造替身
 * （`maxHp: 100` / `speed: 60` / `radius: 8`）。它们不是平衡数值，
 * 也不该从配置表读 —— 夹具取配置的话，「配置改错了」会被测成「敌人逻辑坏了」。
 * 所以 `src/test/architecture.test.ts` 的那条守卫对整份文件豁免。
 * 加这个标记需要同时改那条测试里的豁免清单，所以不会有人偷偷加。
 */

import { EnemyModel, type EnemySpec } from './model/EnemyModel'
import { FixedRng } from '@/core/rng'
import type {
  ActorSnapshot,
  Brain,
  BrainAttack,
  BrainContext,
  BrainSelfInfo,
  NavView,
} from '@/core/actor/types'
import type { EnemyKind } from '@/core/events'

/** 夹具用的固定 tick 间隔（60fps）。所有时间断言都基于它。 */
export const TICK_MS = 16

export function makeSpec(kind: EnemyKind, over: Partial<EnemySpec> = {}): EnemySpec {
  return {
    kind,
    gen: 0,
    stats: { maxHp: 100, speed: 60, radius: 8 },
    pierceImmune: false,
    graceMs: 0,
    graceMoveMult: 1,
    flinchMs: 0,
    slowPerHit: 0,
    slowMaxStacks: 0,
    slowDurationMs: 0,
    slowMultPerStack: 1,
    minSpeedMult: 1,
    vulnerableMult: 1,
    ...over,
  }
}

export function makeSnapshot(
  id: number,
  x: number,
  y: number,
  over: Partial<ActorSnapshot> = {},
): ActorSnapshot {
  return {
    id,
    kind: 'enemy',
    x,
    y,
    vx: 0,
    vy: 0,
    radius: 8,
    hp: 100,
    maxHp: 100,
    alive: true,
    state: 'chase',
    ...over,
  }
}

export function makePlayerSnapshot(x: number, y: number): ActorSnapshot {
  return makeSnapshot(9999, x, y, { kind: 'player' })
}

/** 一个假的导航：固定回答「没视线」+ 固定的流向方向。用来验证 brain 走了哪条分支。 */
export function fakeNav(
  dir: { x: number; y: number } | null,
  los = false,
): NavView {
  return {
    dirAt: () => dir,
    hasLineOfSight: () => los,
  }
}

/**
 * 一只被接上 brain 的敌人，带一个极简位置积分器。
 *
 * `step()` 的顺序**刻意和 `EnemySystem` 一致**：
 * 先算 brain、再写回 `velIntent` / `setState`、最后积分位置。
 * 顺序反了（先积分再算 brain）会让所有「一 tick 延迟」的断言失效。
 */
export class EnemyFixture {
  readonly model: EnemyModel
  readonly brain: Brain
  x: number
  y: number
  vx = 0
  vy = 0
  /** 上一 tick brain 报的攻击；`undefined` = 本 tick 没攻击 */
  lastAttack: BrainAttack | undefined
  nowMs: number
  /**
   * 模拟「被墙/被玩家顶死了」：brain 照常输出意图，但**物理体一步都不动**，
   * 回读的速度也是 0（真实 Arcade body 撞墙后 `velocity` 就被解算成 0 了）。
   *
   * 反卡死逻辑读的是**回读速度**而不是意图速度 —— 只测意图的话，
   * 「想了但没动」和「真的在动」看起来一模一样，正好把要测的东西测没了。
   */
  pinned = false

  private readonly self: ActorSnapshot
  private readonly targetSnap: ActorSnapshot | null
  private readonly selfInfo: BrainSelfInfo
  private readonly ctx: BrainContext
  private readonly neighborsRef: ActorSnapshot[]

  constructor(opts: {
    kind: EnemyKind
    spec?: Partial<EnemySpec>
    brain: (model: EnemyModel) => Brain
    x?: number
    y?: number
    target?: ActorSnapshot | null
    neighbors?: ActorSnapshot[]
    nav?: NavView | null
    /** 同一个 `self` 快照对象复用（性能无关，测试里图个稳定） */
    id?: number
    startMs?: number
  }) {
    this.model = new EnemyModel(opts.kind)
    this.model.respawn(makeSpec(opts.kind, opts.spec), opts.startMs ?? 0)
    this.brain = opts.brain(this.model)
    this.x = opts.x ?? 0
    this.y = opts.y ?? 0
    this.nowMs = opts.startMs ?? 0

    const id = opts.id ?? this.model.id
    this.self = makeSnapshot(id, this.x, this.y, {
      radius: this.model.stats.radius,
      hp: this.model.hp,
      maxHp: this.model.maxHp,
      state: this.model.state,
    })
    this.targetSnap = opts.target === undefined ? makePlayerSnapshot(200, 0) : opts.target
    this.selfInfo = {
      gen: this.model.gen,
      speed: this.model.baseSpeed,
      spawnedAtMs: this.nowMs,
    }
    this.neighborsRef = opts.neighbors ?? []
    this.ctx = {
      nowMs: this.nowMs,
      dtSec: TICK_MS / 1000,
      self: this.self,
      selfInfo: this.selfInfo,
      target: this.targetSnap,
      neighbors: this.neighborsRef,
      nav: opts.nav ?? null,
      rng: new FixedRng(0.5),
    }
  }

  /**
 * 推进一个 tick。返回本 tick 的 brain 输出（内部对象，别存）。
 *
 * = `peek()`（算）+ 写回 model + 积分位置。三步的顺序和 `EnemySystem` 一致 ——
 * 先积分再算的话，所有「一 tick 延迟」的断言都会失效。
 */
  step(dtMs = TICK_MS): ReturnType<Brain> {
    const out = this.peek(dtMs)

    // 写回（真实项目里这一步是 EnemySystem.applyOutput）
    this.model.velIntent.x = out.vx
    this.model.velIntent.y = out.vy
    if (out.nextState !== undefined) this.model.setState(out.nextState as never, this.nowMs)

    // 积分位置
    this.vx = out.vx
    this.vy = out.vy
    if (!this.pinned) {
      this.x += out.vx * (dtMs / 1000)
      this.y += out.vy * (dtMs / 1000)
    }

    this.lastAttack = out.attack
    return out
  }

  /**
   * **只算不写**：刷新快照、跑一次 brain，但不写回 model、不积分位置。
   *
   * 「brain 是纯函数」这条契约只能这样验 —— 用 `step()` 验的话，
   * 写回那一步本来就会改 model，测出来的永远是「改了」，分不清是谁改的。
   */
  peek(dtMs = TICK_MS): ReturnType<Brain> {
    this.nowMs += dtMs

    // 快照回读（真实项目里这一步是 Actor.syncFromBody）
    this.self.x = this.x
    this.self.y = this.y
    this.self.vx = this.pinned ? 0 : this.vx
    this.self.vy = this.pinned ? 0 : this.vy
    this.self.hp = this.model.hp
    this.self.alive = this.model.alive
    this.self.state = this.model.state
    this.self.radius = this.model.stats.radius
    this.ctx.nowMs = this.nowMs
    this.selfInfo.gen = this.model.gen
    this.selfInfo.speed = this.model.speedNow(this.nowMs)

    return this.brain(this.ctx)
  }

  /** 一直 step 到 `predicate` 成立；返回用掉的 tick 数，超时返回 -1。 */
  stepUntil(predicate: (f: EnemyFixture) => boolean, maxTicks = 2000): number {
    for (let i = 0; i < maxTicks; i++) {
      this.step()
      if (predicate(this)) return i + 1
    }
    return -1
  }
}