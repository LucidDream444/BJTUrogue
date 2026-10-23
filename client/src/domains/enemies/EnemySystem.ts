/**
 * 敌人域的总装。**这是 D1 唯一需要认识的东西。**
 *
 * ```
 *   SpawnQueue ──┐
 *                ├──→ EnemyPool ──→ EnemyModel（逻辑）+ Actor（表现）
 *   分裂链 ──────┘         │
 *                         ├──→ SpatialHash（分离力的邻居查询）
 *                         ├──→ FlowField（绕墙）
 *                         └──→ DamageLedger（帧伤结算）
 * ```
 *
 * ---
 *
 * ## 与物理引擎的时间关系（改这里之前先读这段）
 *
 * Phaser 3.90 每渲染帧的顺序（已对源码核实，详见 `core/actor/Actor.ts` 文件头）：
 *
 * ```
 *   body.preUpdate()          位置真值在这里推进
 *   colliders                 ← D1 的子弹 overlap 回调在这 → 我们 bulletContact() / touch()
 *   emit(WORLD_STEP)          ← 我们挂在**这个**事件上
 *       └─ ledger.step()      必须晚于 colliders，否则本步的接触真值还没登记
 *   World.postUpdate()        body.position → sprite.x/y，每帧一次
 * ```
 *
 * 掉帧时补步循环会让 colliders + WORLD_STEP 一帧内跑 N 次，**N 次共用同一个 `frameId`**。
 * 所以本文件里 AI、刷怪、哈希重建、分裂都是**按 `frameId` 去重**的：
 * 掉帧时跑 20 遍 AI 不会让游戏更快，只会让那一帧更卡。
 * 唯一每个物理步都要做的是 `touchContact()` + `ledger.step()` —— 那正是帧伤的节拍。
 *
 * ## 只会话一次的坑：全场 body 都停用后 WORLD_STEP 不再触发
 *
 * `physics.world.disableBody()` 把 body 从 `world.bodies` 里删掉，而
 * `World.update()` 的第一句是 `if (isPaused || bodies.size === 0) return` ——
 * **早于** `_elapsed += delta`。于是 WORLD_STEP 一次都不发，账本永远不 step，
 * 所有帧伤与表现静默僵住。
 *
 * 正常游戏里总有玩家和子弹，不会发生。但**测试场要注意**：
 * 一个只有敌人的空场子，把敌人全清掉之后整个系统会「假死」。
 * 同理，不要把本系统的收尾工作挂在 WORLD_STEP 上（见 `shutdown()`）。
 */

import Phaser from 'phaser'
import { Actor } from '@/core/actor/Actor'
import {
  DamageLedger,
  type DamageSourceKind,
  type HitResult,
  type TickTarget,
} from '@/core/actor/damage'
import { allocActorId } from '@/core/actor/ActorModel'
import type { ActorEventSink, DamageEventInfo, KillEventInfo } from '@/core/actor/ActorModel'
import type {
  ActorSnapshot,
  Brain,
  BrainAttack,
  BrainContext,
  BrainSelfInfo,
  NavView,
} from '@/core/actor/types'
import type { GameClock } from '@/core/time'
import type { GameEvents, EnemyKind, TypedBus } from '@/core/events'
import { Rng } from '@/core/rng'
import {
  deriveGrabber,
  deriveSplitterGeneration,
  deriveTank,
  type ConfigBundle,
  type DerivedGrabber,
  type DerivedSplitterGeneration,
  type DerivedTank,
  type Difficulty,
  type DifficultyModifiers,
  type EnemyDef,
  type GrabberDef,
  type SplitterGenerationDef,
  type TankDef,
} from '@/core/config'
import {
  EnemyModel,
  specFromGrabber,
  specFromSplitter,
  specFromTank,
  type EnemySpec,
  type EnemyState,
} from './model/EnemyModel'
import { EnemyPool, type PooledEnemy } from './pool/EnemyPool'
import { SpawnQueue, type SpawnReason } from './spawn/SpawnQueue'
import { ContactResolver } from './contact/ContactResolver'
import { planSplitChildren } from './spawn/splitFan'
import { SpatialHash } from './nav/spatialHash'
import { FlowField } from './nav/flowField'
import { makeGrabberBrain } from './brains/GrabberBrain'
import { makeSplitterBrain } from './brains/SplitterBrain'
import { makeTankBrain } from './brains/TankBrain'
import { GrabQte } from './grab/grabQte'
import { pickFlingDirection, shouldLand } from './grab/fling'
import { targetsInBlast } from './grab/blast'
import { makeRadialBossBrain } from './brains/RadialBossBrain'
import { RadialProjectiles } from './projectiles/RadialProjectiles'
import { bossArt } from './presentation/bossArt'

type EnemyActor = Actor<EnemyState>
export type Entry = PooledEnemy<EnemyActor>

/**
 * 抓取中的那一只的全部状态。
 *
 * ⚠️ `movieMs` 是**电影时间**（由 D1 每帧喂 dt 攒出来的），不是 `clock.nowMs` ——
 * 抓取期间世界是冻结的，逻辑时钟停在那一刻，用它算咬人节拍会永远到不了点（静默死锁）。
 * 它同时也是「切走标签页时时间也停」的保证：rAF 停了，D1 不喂 dt，电影时间就不走。
 */
interface GrabRun {
  entry: Entry
  /** 吸附阶段才有（扑向期间还没有玩法判定） */
  qte: GrabQte | null
  phase: 'pounce' | 'holding'
  movieMs: number
  /** 扑向的起点（它站定的那个位置） */
  fromX: number
  fromY: number
}

interface FlightRun {
  entry: Entry
  /** 甩出那一刻的逻辑时间（飞行发生在**解冻之后**，用逻辑时钟是对的） */
  startedAtMs: number
  stuckMs: number
  lastX: number
  lastY: number
  /** 上一次采样时的逻辑时间（算 dt 用） */
  lastAtMs: number
}

/** 抓取状态快照。D1 每帧读它决定冻结 / 镜头 / 表现。 */
export interface GrabStatus {
  enemyId: number
  /** 抓取者的显示名（表现层与提示行用） */
  displayName: string
  /** `pounce` = 扑向动画中（还没有玩法判定）；`holding` = 吸附完成 */
  phase: 'pounce' | 'holding'
  /** 它当前的**血量比例**（抓取进度条就是这条血） */
  hpRatio: number
  /** 下一次咬击还有多久（毫秒） */
  msUntilBite: number
  /** 玩家已经按了多少下（表现层读数用） */
  presses: number
}

/** 敌人系统眼里的玩家。**D1 提供**（玩家角色归 D1），测试场塞一个假目标。 */
export interface PlayerView {
  /** 玩家的伤害模型 —— 账本的结算目标，也是「打玩家」的唯一入口 */
  readonly model: TickTarget
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  alive: boolean
}

/** 每帧被问一次「玩家现在在哪」。返回 `null` = 当前没有可追击的目标。 */
export type PlayerProvider = () => PlayerView | null

/**
 * 域内的表现钩子。**刻意不走总线**：顿帧、震屏、烟尘是 D3 自己的表现，
 * 加进 `GameEvents` 就等于改 C1 契约（要全员同意），而它跟别的域没关系。
 */
export interface EnemySystemHooks {
  /** 肉盾砸下来了。表现层据此做顿帧 / 震屏 / 烟尘 */
  onSlam?: (x: number, y: number, radius: number, hitstopMs: number) => void
  /** 抓取怪落地时的电磁脉冲表现；伤害结算仍留在本域。 */
  onGrabBlast?: (x: number, y: number, radius: number) => void
  /**
   * 抓取怪咬玩家一口。
   *
   * ⚠️ **不能走 `PlayerView.model.takeHit`**：那个入口在 `clock.paused` 时直接返回
   * （「暂停时什么都不该发生」是它对的设计），而抓取期间世界**正是冻结的** ——
   * 走那条路咬击会被静默吞掉，玩家永远咬不死，机制整个失效。
   * 所以由 D1 提供一个「剧本站定伤害」的入口：**绕过暂停守卫，但护盾 / 无敌帧 / 死亡照旧**。
   */
  onGrabBite?: (amount: number, sourceId: number, nowMs: number) => void
}

export interface EnemySystemNavOptions {
  originX: number
  originY: number
  cellSize: number
  cols: number
  rows: number
  isWalkable: (x: number, y: number) => boolean
  /** Map owner snaps all spawns, including split children, to safe ground. */
  safeSpawn?: (x: number, y: number, radius: number) => { x: number; y: number }
  /** Projectile geometry is narrower than enemy navigation clearance. */
  projectileBlocked?: (x0: number, y0: number, x1: number, y1: number, radius: number) => boolean
}

export interface EnemySystemOptions {
  scene: Phaser.Scene
  bus: TypedBus<GameEvents>
  clock: GameClock
  bundle: ConfigBundle
  difficulty: Difficulty
  player: PlayerProvider
  /**
   * 地图网格。**不传 = 没有墙**，全场直线追、零导航开销 ——
   * 空的测试场就该不传（建一张 BFS 场是纯粹的浪费）。
   */
  nav?: EnemySystemNavOptions
  /** 固定随机种子，保证同局可复现。地牢种子归 D2 */
  rngSeed?: number
  hooks?: EnemySystemHooks
}

/** 一帧的 AI 记账。抽出来是为了让「远处降频」这件事可断言、能在 HUD 上看到。 */
export interface AiTickStats {
  /** 这一帧真正跑了 brain 的敌人 */
  ticked: number
  /** 近处（按 `nearTickHz`） */
  near: number
  /** 远处（按 `farTickHz` 降频） */
  far: number
}

/** 一具等待分裂 / 等待回收的尸体。 */
interface PendingDeath {
  entry: Entry
  /** 到点执行 */
  atMs: number
  /** 分裂链的下一代替。`split` 之外没有意义 */
  childGen: number
  /** 死者最后的速度方向（弧度），孩子们的扇形以它为轴 */
  baseAngleRad: number
  reason: 'split' | 'recycle'
}

/**
 * 「近」的判定半径（px）。
 *
 * 520 是屏幕对角线的量级：屏幕内的怪必须跑满帧率（玩家看得见它抖），
 * 屏幕外的降到 `farTickHz`。200 只怪时这一条把 AI 开销压掉大约一半。
 */
const NEAR_RADIUS_SQ = 520 * 520

/**
 * 抓取时「玩家按下攻击键」用的攻击源 id。
 *
 * 用一个**负数常量**：它不参与伤害账本（那一套是给子弹/挥砍的持续接触用的），
 * 只出现在 `HitResult` 与伤害事件里给调试与人看。负数不会和任何实体 id 撞。
 */
export const GRAB_PRESS_SOURCE_ID = -11

/**
 * 邻居查询半径的额外余量（px）。
 *
 * `separation()` 的判据是 `self.radius + other.radius + pad < dist`，
 * 所以查询半径至少要盖住「自己半径 + 最大邻居半径 + pad」。最大半径是肉盾的 40、
 * pad 配置里是 24 —— 120 有充足余量。查多了只是多扫几格，
 * **漏掉**邻居才会真的出错：表现是「怪叠在一起不散开」。
 */
const SEP_QUERY_MARGIN = 120

export class EnemySystem implements ActorEventSink {
  private readonly scene: Phaser.Scene
  private readonly bus: TypedBus<GameEvents>
  private readonly clock: GameClock
  private readonly bundle: ConfigBundle
  private readonly diffMods: DifficultyModifiers
  private readonly playerOf: PlayerProvider
  private readonly patrolOrigins = new Map<number, { x: number; y: number }>()
  private readonly safeSpawn?: EnemySystemNavOptions['safeSpawn']
  private readonly projectileBlocked?: EnemySystemNavOptions['projectileBlocked']
  private readonly hooks: EnemySystemHooks
  private readonly rng: Rng

  readonly radialShots: RadialProjectiles
  readonly ledger: DamageLedger
  readonly spawns: SpawnQueue
  readonly pool: EnemyPool<EnemyActor>

  /**
   * D1 的子弹 overlap 用的组。
   *
   * ```ts
   * physics.add.overlap(bulletGroup, enemySystem.group, (bullet, enemy) => {
   *   const r = enemySystem.bulletContact(bullet.shotId, enemy, impact, tickDmg, maxTicks)
   *   if (r.consumed) recycleBullet(bullet)   // ← 永远只有这一句，没有 if (enemy is tank)
   * })
   * ```
   *
   * 停放的怪**还在这个组里**，但 `body.enable === false` 且已从 `world.bodies` 摘除，
   * `collideSpriteVsGroup` 的两条路径都会跳过它（源码已核实）。所以
   * **不要**为了「尸体别被打」去 `group.remove()` —— 那既会触发 Arcade Group 的
   * remove 回调，又意味着下次出生还要再 `add()` 一次，而 `add` 回调会重置
   * `maxVelocity`（见 `createActor`）。
   */
  private readonly crowdCollider: Phaser.Physics.Arcade.Collider
  readonly group: Phaser.Physics.Arcade.Group

  private readonly hash = new SpatialHash<ActorSnapshot>(48)
  private readonly nav: FlowField | null

  /** 模型 id → 池槽位。sink 回调只给 id，得靠它找回表现对象 */
  private readonly finalBosses = new Set<number>()
  private readonly bossStages = new Map<number, number>()
  /**
   * **同类冷却**：所有抓取怪共享的「最早可以起手」时刻（逻辑时间）。
   *
   * 一次抓取结束（挣脱）之后写一次，于是连锁抓取被挡住。字段挂在系统上而不是模型上 ——
   * 它是**这一局所有同类共享**的一格状态，跟「谁抓的」无关。
   */
  private grabberReadyAtMs = 0
  /** 正在抓的那一只（**同一时刻最多一只**）。null = 没有抓取。 */
  private grab: GrabRun | null = null
  /** 正在飞的被甩飞者。落地那一刻做两件事：它死、以及炸一圈。 */
  private flight: FlightRun | null = null
  private readonly byId = new Map<number, Entry>()
  private readonly brains = new Map<EnemyModel, Brain>()
  /** 每只怪一份复用的快照。**同时**喂 `ctx.self` 和空间哈希 —— 两者必须是同一份数据 */
  private readonly snaps = new Map<EnemyModel, ActorSnapshot>()
  private readonly nextAiAt = new Map<EnemyModel, number>()
  private readonly pendingDeaths: PendingDeath[] = []

  /** 派生结果按 (代际, 难度) 缓存。配置整局不变，没理由每只怪出生都重算一遍 15 个字段 */
  private readonly splitterCache = new Map<number, DerivedSplitterGeneration>()
  private tankCache: DerivedTank | null = null
  private grabberCache: DerivedGrabber | null = null

  /** 每渲染帧重建一次的在用槽位列表。免得每个物理步都 `[...checkedOut]` 分配一个数组 */
  private readonly frameEntries: Entry[] = []

  /**
   * 「碰到了 → 伤害」的翻译层。**纯逻辑，所以它能在 node 下被单测** ——
   * 这正是它单独成文件的原因：`EnemySystem` 是 Phaser 接线层，测不了，
   * 而这里守着唯一一个「只在高负载机器上复现」的 bug（见该文件头）。
   */
  private readonly contacts: ContactResolver

  // ---- 复用的上下文对象。每帧 × 200 只怪都新分配的话，GC 会在最需要帧率时插一脚 ----
  private readonly ctx: BrainContext
  private readonly selfInfo: BrainSelfInfo
  private readonly neighborBuf: ActorSnapshot[] = []
  private readonly blank: ActorSnapshot
  private targetSnap: ActorSnapshot | null = null
  private lastFrameId = -1
  private lastAiMs = 0
  private lastAiStats: AiTickStats = { ticked: 0, near: 0, far: 0 }
  /** `WORLD_STEP` 一共进来过几次。**它不涨 = 物理世界没在步**，见文件头那段 ⚠️ */
  private worldStepCount = 0
  /** 上一个物理步里**物理体速度非零**的活怪数。HUD 读数，见 `movingEnemies` */
  private movingCount = 0
  /** `create()` 有没有被调过。没调过就刷怪 = 队列永远没人取，见 `assertWired()` */
  private wired = false
  private disposed = false

  constructor(opts: EnemySystemOptions) {
    this.scene = opts.scene
    this.bus = opts.bus
    this.clock = opts.clock
    this.bundle = opts.bundle
    this.radialShots = new RadialProjectiles(opts.bundle.enemies.stage2Boss.projectile)
    this.diffMods = opts.bundle.difficulty.difficulties[opts.difficulty]
    this.playerOf = opts.player
    this.safeSpawn = opts.nav?.safeSpawn
    this.projectileBlocked = opts.nav?.projectileBlocked
    this.hooks = opts.hooks ?? {}
    this.rng = new Rng(opts.rngSeed ?? 0x5eed)

    const b = opts.bundle.balance
    this.ledger = new DamageLedger({
      tickMs: b.frameDamage.tickMs,
      pairTtlMs: b.frameDamage.pairTtlMs,
      maxTicksPerSourceDefault: b.frameDamage.maxTicksPerSourceDefault,
    })

    this.spawns = new SpawnQueue({
      maxSpawnsPerFrame: b.spawn.maxSpawnsPerFrame,
      overflowStaggerMs: b.spawn.overflowStaggerMs,
      maxAliveSoft: b.spawn.maxAliveSoft,
      maxAliveHard: b.spawn.maxAliveHard,
      maxQueueAgeMs: b.spawn.maxQueueAgeMs,
      maxQueueLength: b.spawn.maxQueueLength,
    })

    this.pool = new EnemyPool<EnemyActor>({
      capacity: b.spawn.poolCapacity,
      createView: (model) => this.createActor(model),
      destroyView: (actor) => actor.park(),
      // ⚠️ 账本配对（不变式 ④）。池的 `release()` 一定会调到这里，所以
      // 「怪回池了但账本还记着它」在结构上就不可能发生 —— 不需要任何调用方记得。
      onRelease: (model) => {
        this.radialShots.removeOwner(model.id)
        this.ledger.releaseTarget(model)
        this.brains.delete(model)
        this.snaps.delete(model)
        this.nextAiAt.delete(model)
        this.byId.delete(model.id)
        this.bossStages.delete(model.id)
        this.finalBosses.delete(model.id)
        this.patrolOrigins.delete(model.id)
      },
    })

    // 不传 defaults：Arcade Group 的 add 回调会把 defaults 里每一项往 body 上打一遍，
    // 而默认值包含 maxVelocity(10000,10000) —— 见 `createActor`。
    this.group = opts.scene.physics.add.group({ runChildUpdate: false })
    this.crowdCollider = opts.scene.physics.add.collider(this.group, this.group)

    this.nav = opts.nav
      ? new FlowField({
          originX: opts.nav.originX,
          originY: opts.nav.originY,
          cellSize: opts.nav.cellSize,
          cols: opts.nav.cols,
          rows: opts.nav.rows,
          isWalkable: opts.nav.isWalkable,
          // 玩家跨格子才重建；再叠一个下限，防止他贴着格子边界来回蹭导致每帧重建
          rebuildIntervalMs: 250,
          targetSnapRadiusCells: 2,
        })
      : null

    this.blank = {
      id: 0,
      kind: 'enemy',
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: 0,
      hp: 0,
      maxHp: 0,
      alive: false,
      state: '',
    }
    this.contacts = new ContactResolver(this.ledger, opts.clock)
    this.selfInfo = { gen: 0, speed: 0, spawnedAtMs: 0 }
    this.ctx = {
      nowMs: 0,
      dtSec: 1 / 60,
      self: this.blank,
      selfInfo: this.selfInfo,
      target: null,
      neighbors: this.neighborBuf,
      nav: this.navView(),
      rng: this.rng,
    }
  }

  // ------------------------------------------------------------ 生命周期

  /** 挂到物理世界的 step 事件上。**在场景的 `create()` 里调一次。** */
  create(): void {
    this.wired = true
    this.scene.physics.world.on(Phaser.Physics.Arcade.Events.WORLD_STEP, this.onWorldStep, this)
  }

  /**
   * 忘了调 `create()` 就刷怪时**当场炸**。
   *
   * 为什么值得为「调用方少写一行」专门写一段抛错：这个疏漏的现场**没有任何声音** ——
   * 怪全躺在队列里、AI 一次不跑、帧伤一次不结，画面上只是「场上空的」，
   * 和「刷怪逻辑写错了」「配置表读错了」长得一模一样，
   * 而类型检查、lint、构建、全部单测**一个都不会红**（真发生过）。
   * 炸在这里，屏幕上于是写着「EnemySystem.create() 没被调用」。
   */
  private assertWired(): void {
    if (this.wired) return
    throw new Error(
      'EnemySystem 还没 create() 就被要求刷怪 —— 队列永远不会有人取走，怪不会出现。\n' +
        '场景建好 EnemySystem 之后、第一次 requestSpawn 之前，必须调一次 enemies.create()。',
    )
  }

  /**
   * 拆干净。**场景 `shutdown` 里必须调**，而且不能指望 WORLD_STEP 帮你收尾
   * （见文件头：「全场 body 都停用后 WORLD_STEP 不再触发」）。
   *
   * 漏了它的后果：监听器留着（重启 3 次就有 3 个 handler，每帧跑 3 遍 AI），
   * 账本和哈希里留着指向已销毁对象的条目。
   *
   * ## ⚠️ 这个方法被调到的时候，场景**可能已经被引擎拆掉一半了**
   *
   * 它是从场景的 `SHUTDOWN` 事件里调的，而 `SHUTDOWN` 的监听器**按注册顺序**跑；
   * 引擎自己的那些（`ArcadePhysics`、`UpdateList`、`DisplayList`…）都在场景 `boot`
   * 时就注册好了，比任何 `create()` 里的都早。所以到这里：
   *
   * | 想碰的东西 | 到这儿是什么样 | 谁干的 |
   * |---|---|---|
   * | `scene.physics.world` | **`null`** | `ArcadePhysics.shutdown()` 的 `this.world = null` |
   * | `group.children` | **`undefined`**（组已被销毁） | `UpdateList.shutdown()` 把表里的对象全 `destroy()` |
   *
   * **不加护栏的后果不是「少退订一个监听器」，是整个页面死掉：** 异常在
   * `SceneManager.processQueue` 里抛出 → 排在后面的 `start` 那条 op 永远轮不到
   * （`scene.restart()` 只发 op，stop 和 start 是**两条**）→ 场景停在 SHUTDOWN；
   * 异常再从 `Game.step` 冲出 rAF 回调，而 Phaser 是**先调回调再排下一帧**，
   * 于是下一帧再也不会被排上 —— 帧号冻住，画面停死，点哪儿都不应。
   * 2026-10-15 实测：按 `A` / `N` / `R` 全都这样（D2 的换种子场子里查出来的），
   * 而屏幕上显示的却是「扫种子扫了 3 秒」—— 量错了七倍的估算把真凶盖了一整天。
   *
   * 护栏**不会漏掉任何清理**：
   * - world 真被销毁时，`World.destroy()` → `shutdown()` 里有 `removeAllListeners()`
   *   （源码已核实），`WORLD_STEP` 的监听器早随 world 一起没了；
   * - 组真被销毁时，`Group.destroy()` 会把 `children` 置成 `undefined`，也早清空了。
   *
   * **没被拆掉的那条路上，这里做的事一个字都没少** —— 所以这里不是「假装清理过了」。
   */
  shutdown(): void {
    if (this.disposed) return
    this.disposed = true

    // `?.` 两层都要：`physics` 是场景插件本身（关了也还在），被置 null 的是 `.world`
    const world = this.scene.physics?.world
    if (world) {
      world.off(Phaser.Physics.Arcade.Events.WORLD_STEP, this.onWorldStep, this)
      this.crowdCollider.destroy()
    }
    this.pool.releaseAll() // 每只怪都走 release() → ledger.releaseTarget，不用另写一套清理
    this.spawns.clear()
    this.pendingDeaths.length = 0
    this.contacts.clear()
    this.frameEntries.length = 0
    this.ledger.clear()
    this.radialShots.clear()
    this.hash.clear()
    // `clear(false, false)`：只移出组，**不销毁**对象 —— Actor 归池管。
    // 传 true 会把它们 destroy 掉，下次 acquire 复用就是一个已销毁的 Sprite。
    //
    // ⚠️ 组可能**已经被 `UpdateList.shutdown()` 销毁**（见上面那段 ⚠️）：销毁过的组
    // `children` 是 `undefined`，`clear()` 里 `children.size` 会当场抛 ——
    // 而且是在「已经清空」的组上抛的，判据和 `world` 那条一样：引擎拆过就不用再拆。
    if (this.group.children) this.group.clear(false, false)
  }

  // ------------------------------------------------------------ 每步 / 每帧

  /** 物理体速度是否非零（阈值 1px/s，把浮点残渣和分离力的微推排除掉）。 */
  private isMovingBody(entry: Entry): boolean {
    const v = entry.view.body.velocity
    return v.x * v.x + v.y * v.y > 1
  }

  /** 世界步回调。挂在 WORLD_STEP 上，掉帧时一帧会被调 N 次（N 次共用同一个 frameId）。 */
  private onWorldStep(): void {
    if (this.disposed) return
    this.worldStepCount++

    const nowMs = this.clock.nowMs
    const frameId = this.clock.frameId

    if (frameId !== this.lastFrameId) {
      this.lastFrameId = frameId
      // 每渲染帧一次。空间哈希、流向场、AI、刷怪、分裂都是「整帧共用」的东西，
      // 按物理步重跑纯属浪费（掉帧时是 N 倍浪费）。
      this.frameEntries.length = 0
      for (const e of this.pool.activeEntries()) this.frameEntries.push(e)

      this.refreshSnaps()
      const target = this.playerOf()
      this.nav?.update(target?.x ?? 0, target?.y ?? 0, nowMs)
      this.runAi(target, nowMs)
      this.stepRadialShots(target, nowMs)
      // 先让到点的尸体分裂（要用它的当前坐标），再刷怪 —— 这样新生的孩子
      // 当帧就能被 `drainSpawns` 取走（受单帧限额约束，多余的顺延）。
      this.stepFlight(nowMs)
      this.reapDead(nowMs)
      this.drainSpawns(nowMs)
    }

    // 这两句**每个物理步**都要跑 —— 它们就是帧伤的节拍本身。
    // 掉帧时一帧内跑 N 次是正确的：物理步多了，接触次数本来就该多，
    // 而「每个配对单帧最多结算一次」由账本的 lastSettledFrameId 闸门守着。
    this.touchContact(nowMs)
    this.ledger.step(nowMs, frameId)

    // **把 brain 写好的速度意图落到物理体上。这是它唯一的写入点。**
    //
    // ⚠️ 这段以前**不存在**，速度只在状态切换时被写过一次（见 `runAi` 里那段 ⚠️）。
    // 两个症状：① 怪沿着「上一次状态切换那一刻的速度」直线滑行，玩家移动了不跟、
    // 撞上墙不绕；② `graceMs: 0` 的怪（第三代分裂怪、肉盾）出生即 `chase`、
    // 状态从不切换，速度一次都没写过 —— **原地不动**。
    //
    // 放在**每个物理步**而不是每帧：Arcade 的 body 每个步都按当前 velocity 积分，
    // 而 `WORLD_STEP` 是 `World.step()` 的**最后一句**（`World.js` L1058，
    // 在 `body.update(delta)` 之后）—— 所以这里写的速度作用于**下一个**步。
    // 一帧有 N 个物理步时写 N 次是幂等的（意图一帧只变一次），不浪费。
    //
    // 只写活着的：死掉的那只已经 `park()` 过了（`Actor.park()` 里 `body.stop()`，
    // 并且把 body 摘出了物理世界），它的位置要**冻在死的那一刻** ——
    // `reapDead` 之后正是拿 `entry.view.x/y` 去算孩子出生的坐标。
    // 这里再写一次速度（哪怕写 0）都不是「没效果」，而是「多了一个改尸体位置的路径」。
    let moving = 0
    for (let i = 0; i < this.frameEntries.length; i++) {
      const entry = this.frameEntries[i]!
      if (!entry.model.alive) continue
      entry.view.applyVelocityIntent()
      // 读数从**物理体**上取，不是从 `velIntent` 上取 —— 这两者不同才是问题本身：
      // 上面那行的缺失会让意图算得好好的而 body 一动不动。从意图取数就永远读不出这个 bug。
      if (this.isMovingBody(entry)) moving++
    }
    this.movingCount = moving
  }

  /** 把每只活着的怪的位置/速度回读进各自的快照。哈希与 brain 吃的是同一份。 */
  private refreshSnaps(): void {
    for (let i = 0; i < this.frameEntries.length; i++) {
      const entry = this.frameEntries[i]!
      const model = entry.model
      if (!model.alive) continue
      let snap = this.snaps.get(model)
      if (!snap) {
        snap = { ...this.blank }
        this.snaps.set(model, snap)
      }
      entry.view.writeSnapshot(snap)
    }
  }

  private rebuildHash(): void {
    this.hash.clear()
    for (let i = 0; i < this.frameEntries.length; i++) {
      const model = this.frameEntries[i]!.model
      if (!model.alive) continue
      const snap = this.snaps.get(model)
      if (snap) this.hash.insert(snap, snap.x, snap.y)
    }
  }

  // ------------------------------------------------------------ 每帧 AI

  private runAi(target: PlayerView | null, nowMs: number): void {
    this.rebuildHash()

    // 目标快照：brain 拿到的是**快照**，不是活对象（见 core/actor/types.ts 文件头）
    if (target) {
      const snap = this.targetSnap ?? (this.targetSnap = { ...this.blank, kind: 'player' })
      snap.id = target.model.id
      snap.kind = 'player'
      snap.x = target.x
      snap.y = target.y
      snap.vx = target.vx
      snap.vy = target.vy
      snap.radius = target.radius
      // 当前的 `PlayerView` 只暴露「活着/没活着」，没有血量。brain 也不该关心玩家血量 ——
      // 一旦它开始关心，就会出现「怪在你残血时更凶」这种玩家察觉不到、平衡也调不动的暗规则。
      snap.hp = target.alive ? 1 : 0
      snap.maxHp = 1
      snap.alive = target.alive
      snap.state = ''
      this.ctx.target = snap
    } else {
      this.ctx.target = null
    }

    this.ctx.nav = this.navView()
    this.ctx.nowMs = nowMs
    const dtSec = (nowMs - this.lastAiMs) / 1000
    this.ctx.dtSec = dtSec > 0 && dtSec < 0.5 ? dtSec : 1 / 60
    this.lastAiMs = nowMs

    let ticked = 0
    let near = 0
    let far = 0

    for (let i = 0; i < this.frameEntries.length; i++) {
      const entry = this.frameEntries[i]!
      const model = entry.model
      if (!model.alive) continue

      const brain = this.brains.get(model)
      const self = this.snaps.get(model)
      if (!brain || !self) continue

      const due = this.nextAiAt.get(model) ?? 0
      if (nowMs < due) continue

      const actor = entry.view
      const origin = this.patrolOrigins.get(model.id)
      const alertRadius = this.isStage2Boss(model.id)
        ? this.bundle.enemies.stage2Boss.aggroRadius
        : this.defFor(model.enemyKind).aggroRadius
      const distanceFromOrigin =
        origin && target ? Math.hypot(actor.x - origin.x, actor.y - origin.y) : 0
      const distanceToPlayer = target
        ? Math.hypot(actor.x - target.x, actor.y - target.y)
        : Infinity
      const activityRadius = this.isStage2Boss(model.id)
        ? this.bundle.enemies.stage2Boss.aggroRadius
        : this.bundle.enemies.enemies.tank.aggroRadius
      const alertTarget =
        target && distanceFromOrigin <= activityRadius && distanceToPlayer <= alertRadius
          ? target
          : null
      const isNear = alertTarget
        ? (actor.x - alertTarget.x) * (actor.x - alertTarget.x) +
            (actor.y - alertTarget.y) * (actor.y - alertTarget.y) <=
          NEAR_RADIUS_SQ
        : false
      const ai = this.aiCfgFor(model)
      this.nextAiAt.set(model, nowMs + 1000 / Math.max(1, isNear ? ai.nearTickHz : ai.farTickHz))

      // 邻居：只查自己周围一圈，**不是全场**。这是「200 只怪也不卡」的关键。
      // 查询结果写进 `neighborBuf`（length 被设成结果数），brain 同步读完就还回来。
      this.hash.query(self.x, self.y, model.stats.radius + SEP_QUERY_MARGIN, this.neighborBuf)

      this.ctx.self = self
      this.selfInfo.gen = model.gen
      this.selfInfo.speed = model.speedNow(nowMs)
      this.selfInfo.spawnedAtMs = 0

      this.ctx.target = alertTarget ? this.targetSnap : null
      const out = brain(this.ctx)

      // **brain 只输出意图**：写回 model，由 `onWorldStep` 的末尾统一交给物理体。
      // 一帧的延迟是无所谓的（速度是 px/s 的量），换来的是一条硬规矩：
      // brain 不碰物理、不碰别的实体，所以它能在 node 里直测。
      //
      // ⚠️ **这里不许再顺手 `applyVelocityIntent()`。** 曾经这里是这样写的：
      // 「状态刚切进去就要被 Actor 看见，所以不等下一物理步，直接同步一次速度」——
      // 于是**速度就只在状态切换的那一刻被写过**，之后再没人写。
      // brain 每 tick 算出来的新方向全部烂在 `model.velIntent` 里，物理体永远
      // 沿着上一次状态切换时的那个速度直线滑行：玩家跑了不跟、被墙挡住不绕，
      // 而 `graceMs: 0` 的怪（第三代分裂怪、肉盾）出生就是 `chase`、
      // **从头到尾没切换过状态**，于是速度一次都没写过 —— 原地不动。
      // 唯一的写入点是 `onWorldStep` 末尾那个循环，见那里的注释。
      if (!alertTarget && origin) {
        // Smooth circular patrol. It does not chase the player and does not add the old target-point zigzag.
        const patrolRadius = Math.min(activityRadius * 0.45, alertRadius * 0.65)
        const phase = nowMs / 2600 + model.id * 0.73
        const speed = model.speedNow(nowMs)
        const offsetX = actor.x - origin.x,
          offsetY = actor.y - origin.y
        const outside = Math.hypot(offsetX, offsetY) > patrolRadius
        if (outside) {
          const distance = Math.max(1, Math.hypot(offsetX, offsetY))
          model.velIntent.x = (-offsetX / distance) * speed
          model.velIntent.y = (-offsetY / distance) * speed
        } else {
          model.velIntent.x = -Math.sin(phase) * speed
          model.velIntent.y = Math.cos(phase) * speed
        }
      } else {
        model.velIntent.x = out.vx
        model.velIntent.y = out.vy
      }
      const next = out.nextState
      if (next !== undefined && next !== model.state) {
        model.setState(next as EnemyState, nowMs)
      }
      if (out.attack) this.resolveAttack(entry, out.attack)

      ticked++
      if (isNear) near++
      else far++
    }

    // 用完还回去。留着一个 length > 0 的常驻数组，下一帧在 runAi 之前
    // 读 `ctx.neighbors` 的任何代码（含调试 HUD）都会拿到上一帧的邻居。
    this.neighborBuf.length = 0
    this.lastAiStats = { ticked, near, far }
  }

  /**
   * brain 报了攻击 → **由系统统一结算**（brain 不碰物理、不碰别的实体）。
   *
   * 范围在这里**重新量一次是刻意的**：brain 是在「前摇结束」那一 tick 报的，
   * 而玩家可能在那 700ms 里已经跑开了 —— 前摇存在的全部意义就是「跑得掉」。
   * 拿 brain 里的旧距离判定，前摇就退化成了一个纯装饰。
   */
  private stepRadialShots(target: PlayerView | null, nowMs: number): void {
    if (this.clock.paused || this.clock.frozen) return
    this.radialShots.step(
      nowMs,
      target,
      (id) => this.byId.get(id)?.model.alive ?? false,
      (x0, y0, x1, y1) =>
        this.projectileBlocked
          ? !this.projectileBlocked(x0, y0, x1, y1, this.radialShots.cfg.radius)
          : !this.nav || this.nav.hasLineOfSight(x0, y0, x1, y1),
      (shot) =>
        target?.model.takeHit({
          sourceId: shot.ownerId,
          hitKey: `radial:${shot.id}`,
          mode: 'instant',
          amount: shot.damage,
          frameId: this.clock.frameId,
          nowMs,
          sourceKind: 'bullet',
        }),
    )
  }

  // ------------------------------------------------------------ 抓取序列

  /** 抓取怪那一份配置。取用点很多，收在这里免得到处都是三段下标。 */
  private grabberConfig() {
    return this.bundle.enemies.enemies.grabber.grab
  }

  /**
   * 开始一次抓取。**同一时刻最多一只** —— 已经有抓取在跑时，这一只白起手了：
   * 它的 brain 已经把状态写回 `chase`（`resolveAttack` 跑在状态写回之后），这里什么都不做。
   */
  private startGrab(entry: Entry): void {
    const model = entry.model
    if (!model.alive || this.grab) return
    model.setState('grabbing', this.clock.nowMs)
    model.velIntent.x = 0
    model.velIntent.y = 0
    this.grab = {
      entry,
      qte: null,
      phase: 'pounce',
      movieMs: 0,
      fromX: entry.view.x,
      fromY: entry.view.y,
    }
  }

  /**
   * **每帧由 D1 喂一次**（抓取期间世界冻结，这是唯一还活着的时间线）。
   * 没有抓取时是空转。
   *
   * ⚠️ `dtMs` 用渲染帧的 delta，不是 `clock.nowMs` 的差：冻结时后者是 0（永远到不了咬人时刻），
   * 而渲染帧的 delta 在**切走标签页时也会停**（rAF 停）—— 玩家不会在看不见的时候被咬。
   */
  tickGrab(dtMs: number): void {
    const g = this.grab
    if (!g) return
    if (!g.entry.model.alive) {
      this.endGrab()
      return
    }
    const cfg = this.grabberConfig()
    g.movieMs += Math.max(0, dtMs)
    const target = this.playerOf()

    if (g.phase === 'pounce') {
      // 扑向：**脚本化位移**。冻结期间物理是停的，所以这一段只动表现；
      // 吸附完成那一刻把唯一的位置真值（物理体）对齐过去。
      const t = Math.min(1, g.movieMs / cfg.pounceMs)
      const to = target ?? { x: g.fromX, y: g.fromY }
      g.entry.view.setPosition(g.fromX + (to.x - g.fromX) * t, g.fromY + (to.y - g.fromY) * t)
      if (t < 1) return
      g.entry.view.body.reset(to.x, to.y)
      g.phase = 'holding'
      // **玩法判定从「吸附完成」这一刻才开始**：咬人节拍与连点都从这时起算
      const d = this.derivedGrabber(this.bundle.enemies.enemies.grabber)
      g.qte = new GrabQte(
        {
          pressDamage: d.pressDamage,
          biteIntervalMs: cfg.biteIntervalMs,
          biteDamage: d.biteDamage,
          hardLimitMs: cfg.biteIntervalMs * 2,
        },
        g.movieMs,
      )
      return
    }

    const r = g.qte!.tick(g.movieMs)
    if (r.bite && target?.alive) {
      this.hooks.onGrabBite?.(r.damage, g.entry.model.id, this.clock.nowMs)
    }
    // 两条无条件出口：硬上限到了、或者玩家已经死了 —— 抓取**一定要能解开**
    if (r.timedOut || (target && !target.alive)) this.endGrab()
  }

  /**
   * 玩家按下一次攻击键（D1 转发，只在吸附阶段有效）。
   *
   * 扣的是 `pressDamage`（= 最大血量 × 5%，派生好的），**与武器无关、也不看武器冷却**。
   */
  grabPress(): void {
    const g = this.grab
    if (!g || g.phase !== 'holding' || !g.qte) return
    const model = g.entry.model
    if (!model.alive) return
    const r = g.qte.press(model.hp)
    // 挣脱阈值不是死亡阈值：那一下**只把它打到 1 血**。
    // 它要活着飞出去、落地才死 —— 死了的实体会被立刻 park（位置冻住），尸体飞不起来。
    const damage = r.escaped ? Math.max(0, model.hp - 1) : r.damage
    if (damage > 0) {
      model.takeHit({
        sourceId: GRAB_PRESS_SOURCE_ID,
        // 每按一次换一个 key：`frameId` 在冻结期间是不变的，
        // 同一个 key 会被「同帧去重」静默吃掉后面的按下
        hitKey: `grab-press:${g.qte.presses}`,
        mode: 'instant',
        amount: damage,
        frameId: this.clock.frameId,
        nowMs: this.clock.nowMs,
        sourceKind: 'melee',
      })
    }
    if (r.escaped) this.releaseGrab(g)
  }

  /** 抓取状态快照。D1 每帧读它决定冻结 / 镜头 / 表现；`null` = 没有抓取。 */
  grabStatus(): GrabStatus | null {
    const g = this.grab
    if (!g) return null
    const model = g.entry.model
    return {
      enemyId: model.id,
      displayName: this.bundle.enemies.enemies.grabber.displayName,
      phase: g.phase,
      hpRatio: model.maxHp > 0 ? Math.max(0, Math.min(1, model.hp / model.maxHp)) : 0,
      msUntilBite: g.qte
        ? g.qte.msUntilNextBite(g.movieMs)
        : this.grabberConfig().biteIntervalMs,
      presses: g.qte?.presses ?? 0,
    }
  }

  /**
   * **无条件结束抓取** —— D1 的兜底出口。
   *
   * 抓取期间世界冻结、敌人系统整体停机，「解冻」只能由 D1 的时间线来按。
   * 万一 D3 这边的结束条件没走到（bug、异常路径），D1 会用这个把抓取强制拆掉 ——
   * 一个解不开的抓取就是永久卡死，这条通道必须存在。
   */
  abortGrab(): void {
    this.endGrab()
  }

  /** 抓取结束（没挣脱的那些路径：硬上限、玩家死、抓取者死）。 */
  private endGrab(): void {
    const g = this.grab
    if (!g) return
    const model = g.entry.model
    if (model.alive && model.state === 'grabbing') model.setState('chase', this.clock.nowMs)
    // 同类冷却**从抓取结束起算** —— 异常结束同样要挡住连锁抓
    this.grabberReadyAtMs = this.clock.nowMs + this.grabberConfig().sameTypeCooldownMs
    this.grab = null
  }

  /** 挣脱：把它甩出去。它飞出去之后才落地、才死、才炸。 */
  private releaseGrab(g: GrabRun): void {
    const cfg = this.grabberConfig()
    const model = g.entry.model
    const player = this.playerOf()
    const origin = player
      ? { x: player.x, y: player.y }
      : { x: g.entry.view.x, y: g.entry.view.y }
    const others = this.weaponTargets().filter((t) => t.id !== model.id)
    const dir = pickFlingDirection(
      origin,
      cfg.flingDistance,
      cfg.blastRadius,
      others,
      this.nav ? (a, b) => !this.nav!.hasLineOfSight(a.x, a.y, b.x, b.y) : undefined,
    )
    const speed = this.derivedGrabber(this.bundle.enemies.enemies.grabber).flingSpeed
    // 飞行是**意图**，不是一次性冲量：`applyVelocityIntent()` 每步都会覆盖物理体的速度，
    // 设一次等于下一帧就被抹掉（brain 的 `flung` 分支负责把它原样喂回去）。
    model.flingVx = dir.x * speed
    model.flingVy = dir.y * speed
    model.setState('flung', this.clock.nowMs)
    this.grabberReadyAtMs = this.clock.nowMs + cfg.sameTypeCooldownMs
    this.grab = null
    this.flight = {
      entry: g.entry,
      startedAtMs: this.clock.nowMs,
      stuckMs: 0,
      lastX: g.entry.view.x,
      lastY: g.entry.view.y,
      lastAtMs: this.clock.nowMs,
    }
  }

  /**
   * 飞行与落地。**跑在解冻之后**（挂在每帧那一段，物理是活的）——
   * 位置由物理体走，这里只回答「这一帧算不算落地了」。
   */
  private stepFlight(nowMs: number): void {
    const f = this.flight
    if (!f) return
    const model = f.entry.model
    if (!model.alive || model.state !== 'flung') {
      // 它在半空中就没了（被补枪、被别的爆炸卷进去、被清场……）：
      // **爆炸照放**，摆在它最后待过的位置。甩出去那一下是挣脱的回报，
      // 不能因为「它提前死了」就悄无声息地取消掉。
      this.blastAt(f.lastX, f.lastY, model.id)
      this.flight = null
      return
    }
    const cfg = this.grabberConfig()
    const x = f.entry.view.x
    const y = f.entry.view.y
    const r = shouldLand(
      { flingTimeMs: cfg.flingTimeMs },
      nowMs - f.startedAtMs,
      Math.hypot(x - f.lastX, y - f.lastY),
      f.stuckMs,
      Math.max(0, nowMs - f.lastAtMs),
    )
    f.stuckMs = r.stuckForMs
    f.lastX = x
    f.lastY = y
    f.lastAtMs = nowMs
    if (!r.land) return

    this.flight = null
    // 落地：**它死在这儿**（挣脱时特意留了 1 血），炸在它落下的位置
    this.blastAt(x, y, model.id)
    // ⚠️ 用 `dieOnLanding()` 而不是 `takeHit()`：飞行的整段免疫外来伤害
    //（它只剩 1 血，玩家正握着枪），而落地这一下必须**一定生效** ——
    // 走 takeHit 会被那条免伤挡掉，它就会带着 1 血永远飞下去（实测踩过）。
    model.dieOnLanding(nowMs)
  }

  /**
   * 落点爆炸。**只打其它敌人** —— 爆炸半径内的玩家不掉血、不被击退，
   * 这是挣脱这件事的正反馈（规格里专门有一条）。玩家不在 `weaponTargets()` 里，
   * 所以这条规则是结构性的，不是靠调用方记得跳过。
   */
  private blastAt(x: number, y: number, excludeId: number): void {
    const cfg = this.grabberConfig()
    this.hooks.onGrabBlast?.(x, y, cfg.blastRadius)
    const damage = this.derivedGrabber(this.bundle.enemies.enemies.grabber).blastDamage
    if (damage <= 0) return
    const ids = targetsInBlast({ x, y }, cfg.blastRadius, this.weaponTargets()).filter(
      (id) => id !== excludeId,
    )
    if (!ids.length) return
    // 一次性源：每次落地**新分配**一个 sourceId（`weaponHit` 的接口注释要求）
    const source = allocActorId()
    for (const id of ids) this.weaponHit(id, source, damage, null)
  }

  private resolveAttack(entry: Entry, attack: BrainAttack): void {
    if (attack.kind === 'grab') {
      // ⚠️ **不重新量距离。** 肉盾的下砸要在这一帧重量一次（前摇的意义就是「跑得掉」），
      //    抓取相反：预警到点就锁死、必定扑中。躲的窗口是那 2 秒预警本身，
      //    最后一帧翻盘只会让玩家学不到任何确定的规则。
      this.startGrab(entry)
      return
    }
    if (attack.kind === 'radial') {
      if (!this.clock.paused && !this.clock.frozen && this.playerOf()?.alive)
        this.radialShots.emit(
          entry.model.id,
          entry.view.body.center.x,
          entry.view.body.center.y,
          this.clock.nowMs,
          attack.damage,
        )
      return
    }
    const target = this.playerOf()
    if (!target || !target.alive) return

    const dx = target.x - entry.view.x
    const dy = target.y - entry.view.y
    const reach = attack.radius + target.radius
    if (dx * dx + dy * dy > reach * reach) return

    target.model.takeHit({
      sourceId: entry.model.id,
      hitKey: `attack:${entry.model.id}:${this.clock.frameId}`,
      mode: 'instant',
      amount: attack.damage,
      frameId: this.clock.frameId,
      nowMs: this.clock.nowMs,
      // 归到 'aoe'：下砸是一个**范围**判定，不是「贴着打」的接触伤害。
      // 玩家的减伤/闪避若按 sourceKind 分类，它该和「子弹」「接触」区分开。
      sourceKind: 'aoe',
      // 击退**只上报，不执行**：玩家物理体归 D1，D3 不许去推它。
      // D1 的玩家模型读 `req.knockback` 决定怎么处理（通常是写成 velIntent）。
      knockback: attack.knockback,
    })

    this.hooks.onSlam?.(entry.view.x, entry.view.y, attack.radius, attack.hitstopMs ?? 0)
  }

  private aiCfgFor(model: EnemyModel) {
    return this.defFor(model.enemyKind).ai
  }

  private navView(): NavView | null {
    return this.nav
  }

  // ------------------------------------------------------------ 接触伤害

  /**
   * 敌人贴到玩家 → 登记一次接触，由账本按 `tickMs` 节拍结算。
   *
   * **刻意不走 brain。** 账本要的是「这一刻它们挨着」这个物理事实，
   * 而 brain 是按 `nearTickHz` 降频跑的 —— 照 brain 来就会出现
   * 「远处的怪摸到你却不掉血」，而那个 bug 只在玩家往回跑的时候才出现。
   */
  /** Solid collision reports contact after separating bodies, so overlap is no longer required. */
  playerContact(enemyGO: Phaser.GameObjects.GameObject): void {
    if (this.disposed || this.clock.paused || this.clock.frozen) return
    const actor = enemyGO as EnemyActor
    const model = actor.model as EnemyModel | undefined
    if (!model || this.byId.get(model.id)?.view !== actor) return
    const target = this.playerOf()
    if (target?.alive) this.registerPlayerContact(model, target, this.clock.nowMs)
  }

  private registerPlayerContact(model: EnemyModel, target: PlayerView, nowMs: number): void {
    if (!model.alive || model.state === 'spawning') return
    const amountPerTick = this.contactDamagePerTick(model)
    if (amountPerTick <= 0) return
    this.ledger.touch(
      model.id,
      target.model,
      {
        sourceKind: 'contact',
        amountPerTick,
        maxTicks: this.bundle.balance.frameDamage.contactMaxTicks,
      },
      nowMs,
    )
  }

  private touchContact(nowMs: number): void {
    const target = this.playerOf()
    if (!target?.alive) return
    for (const entry of this.frameEntries) {
      if (!entry.model.alive || !entry.view.body.enable) continue
      // Read the post-separation body center, not the AI snapshot from an earlier step.
      const center = entry.view.body.center
      const dx = target.x - center.x,
        dy = target.y - center.y
      // Arcade circle separation can leave a sub-pixel gap; this is numerical slop, not attack range.
      const reach = entry.model.stats.radius + target.radius + 1
      if (dx * dx + dy * dy > reach * reach) continue
      this.registerPlayerContact(entry.model, target, nowMs)
    }
  }

  /** 接触伤害。**分裂怪按代际**（每一代不一样），其余按模板。 */
  private contactDamagePerTick(model: EnemyModel): number {
    if (model.enemyKind === 'splitter') {
      const gens = this.bundle.enemies.enemies.splitter.generations
      const g = gens[model.gen] ?? gens[gens.length - 1]!
      return Math.round(g.contactDamagePerTick * this.diffMods.enemyDamage)
    }
    return Math.round(
      this.unitDefFor(model.enemyKind).contactDamagePerTick * this.diffMods.enemyDamage,
    )
  }

  // ------------------------------------------------------------ 刷怪

  /**
   * 把一只怪排进出生队列。**不立刻出生** —— 理由见 `SpawnQueue` 文件头
   * （同帧 8 只怪一起进物理世界 = 那一帧顶到天花板 + 表现层同时开 8 路音）。
   */
  requestSpawn(
    kind: EnemyKind,
    gen: number,
    x: number,
    y: number,
    reason: SpawnReason,
    delayMs = 0,
  ): boolean {
    this.assertWired()
    const nowMs = this.clock.nowMs
    return this.spawns.push({
      spec: this.specFor(kind, gen),
      x,
      y,
      atMs: nowMs + delayMs,
      enqueuedAtMs: nowMs,
      reason,
    })
  }

  requestBoss(stage: number, x: number, y: number, maxHp: number, finalBoss = false): boolean {
    const spec = this.specFor('tank', 0)
    const ranged = stage === 2 && !finalBoss ? this.bundle.enemies.stage2Boss : null
    return this.spawns.push({
      spec: {
        ...spec,
        // 首领用肉盾模板（怪物模板太少），但**不吃穿透** ——
        // 见 `EnemySpec.pierceImmune`。写在这里而不是「出生时推一下」：
        // spec 是整份重写的，回池复用时不会把首领身份留给下一只蘑菇怪。
        pierceImmune: true,
        stats: {
          ...spec.stats,
          maxHp,
          ...(ranged
            ? { speed: ranged.speed * this.diffMods.enemySpeed, radius: ranged.radius }
            : {}),
        },
      },
      x,
      y,
      bossStage: stage,
      finalBoss,
      reason: 'wave',
      atMs: this.clock.nowMs,
      enqueuedAtMs: this.clock.nowMs,
    })
  }
  bossStatus(
    stage: number,
  ): { id: number; hp: number; maxHp: number; x: number; y: number } | null {
    for (const [id, bossStage] of this.bossStages) {
      const entry = this.byId.get(id)
      if (bossStage === stage && entry?.model.alive)
        return {
          id,
          hp: entry.model.hp,
          maxHp: entry.model.maxHp,
          x: entry.view.x,
          y: entry.view.y,
        }
    }
    return null
  }
  /** Stable public snapshots; consumers never hold pooled EnemyModel references. */
  weaponTarget(id: number): { id: number; x: number; y: number; radius: number } | null {
    const e = this.byId.get(id)
    if (!e?.model.alive || !e.view.body.enable) return null
    return { id, x: e.view.body.center.x, y: e.view.body.center.y, radius: e.view.body.halfWidth }
  }
  weaponTargets(): { id: number; x: number; y: number; radius: number }[] {
    const result: { id: number; x: number; y: number; radius: number }[] = []
    for (const id of this.byId.keys()) {
      const target = this.weaponTarget(id)
      if (target) result.push(target)
    }
    return result
  }
  weaponHit(id: number, sourceId: number, amount: number, tick: number | null): HitResult {
    const e = this.byId.get(id)
    if (!e?.model.alive) return { applied: 0, killed: false, consumed: false }
    // Fixed weapon damage follows the existing heavy-cannon rule, while still using takeHit.
    const multiplier = e.model.state === 'recover' ? e.model.vulnerableMult : 1
    return e.model.takeHit({
      sourceId,
      hitKey: 'weapon:' + sourceId + ':' + (tick ?? 'impact'),
      sourceKind: 'aoe',
      mode: tick === null ? 'instant' : 'tick',
      amount: amount / multiplier,
      nowMs: this.clock.nowMs,
      frameId: this.clock.frameId,
    })
  }
  weaponSlow(id: number, multiplier: number, untilMs: number): void {
    const e = this.byId.get(id)
    if (!e?.model.alive) return
    e.model.weaponSlowMultiplier = multiplier
    e.model.weaponSlowUntilMs = untilMs
  }

  /** Pulse shot has one exact impact, without armor tick damage or vulnerability amplification. */
  pulseContact(sourceId: number, enemy: Phaser.GameObjects.GameObject, amount: number): HitResult {
    const model = (enemy as EnemyActor).model as EnemyModel | undefined
    if (!model || !model.alive || !this.byId.has(model.id))
      return { applied: 0, killed: false, consumed: true }
    const multiplier = model.state === 'recover' ? model.vulnerableMult : 1
    const result = model.takeHit({
      sourceId,
      hitKey: 'pulse:' + sourceId,
      sourceKind: 'bullet',
      mode: 'instant',
      amount: amount / multiplier,
      nowMs: this.clock.nowMs,
      frameId: this.clock.frameId,
    })
    return { ...result, consumed: true }
  }

  /** 测试场 / 调试用：立刻就要（仍然受单帧限额与软/硬上限约束）。 */
  spawnNow(kind: EnemyKind, gen: number, x: number, y: number): boolean {
    return this.requestSpawn(kind, gen, x, y, 'debug')
  }

  /**
   * **三种模板的公共取值入口。**
   *
   * 谁要读「这个 kind 的某条数值」都走这里，别在别处再写一遍
   * `kind === 'tank' ? A : B` —— 那种写法在加第三种模板时**不报错**，
   * 只会让新怪静默继承分裂怪的那份数值（aggro 半径、接触伤害、贴图……）。
   *
   * `default` 里那句 `const never: never = kind` 是刻意的：将来再加模板时，
   * **这里会当场编译不过**，而不是安静地走错分支。
   */
  private defFor(kind: EnemyKind): EnemyDef {
    switch (kind) {
      case 'splitter':
        return this.bundle.enemies.enemies.splitter
      case 'tank':
        return this.bundle.enemies.enemies.tank
      case 'grabber':
        return this.bundle.enemies.enemies.grabber
      default: {
        const never: never = kind
        throw new Error(`未处理的敌人模板：${String(never)}`)
      }
    }
  }

  /**
   * 数值**直接挂在 def 上**的那两个模板（肉盾、抓取怪）。
   *
   * 分裂怪不在这里：它的 `textureKey` / `visualScale` / 接触伤害是**每一代各一份**
   * （`generations[]`），拿不到一个平坦值 —— 所以它的那几处永远走「按代际」的支路。
   * 这个类型收窄不是洁癖：它让「以后再加模板时忘了补支路」变成编译错误。
   */
  private unitDefFor(kind: 'tank' | 'grabber'): TankDef | GrabberDef {
    return kind === 'tank'
      ? this.bundle.enemies.enemies.tank
      : this.bundle.enemies.enemies.grabber
  }

  /** **配置 → 模型参数的唯一入口。** 派生结果按 (代际, 难度) 缓存。 */
  specFor(kind: EnemyKind, gen: number): EnemySpec {
    switch (kind) {
      case 'splitter': {
        const def = this.bundle.enemies.enemies.splitter
        const gens = def.generations
        const g = gens[gen] ?? gens[gens.length - 1]!
        return specFromSplitter(this.derivedGen(g), def)
      }
      case 'tank': {
        const def = this.bundle.enemies.enemies.tank
        return specFromTank(this.derivedTank(def), def)
      }
      case 'grabber': {
        const def = this.bundle.enemies.enemies.grabber
        return specFromGrabber(this.derivedGrabber(def), def)
      }
      default: {
        const never: never = kind
        throw new Error(`未处理的敌人模板：${String(never)}`)
      }
    }
  }

  private derivedGen(g: SplitterGenerationDef): DerivedSplitterGeneration {
    let hit = this.splitterCache.get(g.gen)
    if (!hit) {
      hit = deriveSplitterGeneration(g, this.diffMods, this.bundle.balance)
      this.splitterCache.set(g.gen, hit)
    }
    return hit
  }

  private derivedTank(def: TankDef): DerivedTank {
    if (!this.tankCache) this.tankCache = deriveTank(def, this.diffMods, this.bundle.balance)
    return this.tankCache
  }

  private derivedGrabber(def: GrabberDef): DerivedGrabber {
    if (!this.grabberCache) {
      this.grabberCache = deriveGrabber(def, this.diffMods, this.bundle.balance)
    }
    return this.grabberCache
  }

  /** 每发子弹打在肉盾身上的穿透 tick 伤害。D1 从这取，别在武器代码里写死 */
  get tankPierceTickDamage(): number {
    return this.derivedTank(this.bundle.enemies.enemies.tank).pierceTickDamage
  }

  private drainSpawns(nowMs: number): void {
    const result = this.spawns.drain(nowMs, this.pool.live)

    for (let i = 0; i < result.spawned.length; i++) {
      const req = result.spawned[i]!
      const entry = this.pool.acquire(req.spec, nowMs)

      if (!entry) {
        // 池满了。**留在队列里等**，不是丢掉 —— 丢掉一只分裂怪的孩子，
        // 玩家看到的就是「打爆了但什么都没出来」，整个割草爽感的机制就没了。
        //
        // ⚠️ `enqueuedAtMs` 必须保留原值（不能写 nowMs）：写 nowMs 等于「刚刚入队」，
        // 积压兜底会永远判不出来，队列会一直涨。只有 `atMs` 该被推后。
        this.spawns.push({
          ...req,
          atMs: nowMs + this.bundle.balance.spawn.overflowStaggerMs,
        })
        continue
      }

      const model = entry.model
      const position = this.safeSpawn?.(req.x, req.y, model.stats.radius) ?? req
      const portrait =
        req.bossStage === undefined ? null : bossArt(req.bossStage, req.finalBoss ?? false)
      entry.view.spawnAt({
        x: position.x,
        y: position.y,
        collideWorldBounds: this.nav !== null,
        textureKey: portrait?.key ?? this.textureKeyFor(model.enemyKind, model.gen),
        visualScale:
          req.bossStage === 2 && !req.finalBoss
            ? this.bundle.enemies.stage2Boss.visualScale
            : this.visualScaleFor(model.enemyKind, model.gen),
        // 速度上限：Arcade 默认 maxVelocity 是 (10000,10000)，分离力 + 击退叠起来
        // 能把怪甩出房间。这只是兜底，不参与正常移动。
        speedCap: model.stats.speed * 3,
      })
      // Bosses and textbooks share pool buckets. Never carry a boss tint into a normal enemy.
      entry.view.clearTint().setTint(portrait?.tint ?? 0xffffff)

      this.byId.set(model.id, entry)
      if (req.bossStage !== undefined) this.bossStages.set(model.id, req.bossStage)
      if (req.finalBoss) this.finalBosses.add(model.id)
      this.patrolOrigins.set(model.id, { x: position.x, y: position.y })
      model.sink = this
      this.brains.set(model, this.makeBrain(model))
      this.nextAiAt.set(model, 0) // 出生的下一帧立刻跑一次 AI，别等满一个降频周期
      this.snaps.set(model, { ...this.blank })

      this.bus.emit('entity_spawned', {
        bossStage: req.bossStage,
        id: model.id,
        kind: 'enemy',
        enemyKind: model.enemyKind,
        gen: model.gen,
        x: position.x,
        y: position.y,
      })
    }
  }

  /** 贴图 key。**分裂怪按代际**（每一代是一张图），其余按模板。 */
  private textureKeyFor(kind: EnemyKind, gen: number): string {
    if (kind === 'splitter') {
      const gens = this.bundle.enemies.enemies.splitter.generations
      return (gens[gen] ?? gens[gens.length - 1]!).textureKey
    }
    return this.unitDefFor(kind).textureKey
  }

  private visualScaleFor(kind: EnemyKind, gen: number): number {
    if (kind === 'splitter') {
      const gens = this.bundle.enemies.enemies.splitter.generations
      return (gens[gen] ?? gens[gens.length - 1]!).visualScale
    }
    return this.unitDefFor(kind).visualScale
  }

  /**
   * 造表现对象。**只在池子新建槽位时调一次**，所以这是唯一的 `group.add` 时机。
   *
   * ⚠️ 为什么不能每次出生都 `group.add()` 一次：
   * Arcade Group 的 `createCallbackHandler`（`PhysicsGroup.js`，已核实）会把
   * `this.defaults` 里每一项往 body 上打一遍 —— 其中包含
   * `setMaxVelocityX(10000)` / `setMaxVelocityY(10000)` / `setEnable(true)`。
   * 前者会**静默抹掉 `spawnAt()` 设的速度上限**（表现是偶发的「怪被甩出房间」，
   * 只在分离力叠满时出现）；后者会让一具停放中的尸体**重新变成可命中的目标**
   * （表现是「子弹打在空气上消失了」）。两个都不报错。
   */
  private createActor(model: EnemyModel): EnemyActor {
    const actor = new Actor<EnemyState>(this.scene, model)
    this.group.add(actor)
    // 上面那句 add 把 body.enable 打开了，但它并不在 world.bodies 里 ——
    // 撤销掉，让「刚造好的槽位」和「停放中的槽位」是同一种状态。
    // （`spawnAt()` 会自己在 `_parked` 分支里 world.add 回来。）
    this.scene.physics.world.disableBody(actor.body)
    return actor
  }

  private makeBrain(model: EnemyModel): Brain {
    if (this.isStage2Boss(model.id)) {
      const cfg = this.bundle.enemies.stage2Boss
      return makeRadialBossBrain(
        model,
        cfg,
        Math.round(cfg.projectile.damage * this.diffMods.enemyDamage),
      )
    }
    const def = this.bundle.enemies.enemies
    if (model.enemyKind === 'grabber') {
      const g = def.grabber
      return makeGrabberBrain(model, {
        sepStrength: g.ai.separationStrength,
        sepPad: g.ai.separationPad,
        grabRange: g.grab.range,
        telegraphMs: g.grab.telegraphMs,
        cooldownMs: g.grab.cooldownMs,
        releaseRangeMult: g.grab.releaseRangeMult,
        // 同类冷却是**所有 grabber 共享**的，所以读系统上那一个字段，不是这只怪自己的
        sameTypeReadyAtMs: () => this.grabberReadyAtMs,
      })
    }
    if (model.enemyKind === 'tank') {
      const t = def.tank
      return makeTankBrain(model, {
        sepStrength: t.ai.separationStrength,
        sepPad: t.ai.separationPad,
        slamRange: t.slam.range,
        slamWindupMs: t.slam.windupMs,
        slamCooldownMs: t.slam.cooldownMs,
        slamRecoverMs: t.slam.recoverMs,
        slamDamage: this.derivedTank(t).slamDamage,
        slamRadius: t.slam.radius,
        slamKnockback: t.slam.knockback,
        slamHitstopMs: t.slam.hitstopMs,
        unstuckMs: t.antiPin.unstuckMs,
        stuckSpeedThreshold: t.antiPin.stuckSpeedThreshold,
        lateralEscapeMs: t.antiPin.lateralEscapeMs,
        lateralSpeedMult: t.antiPin.lateralSpeedMult,
        staggerMs: t.hitSlow.staggerMs,
        staggerSpeedMult: t.hitSlow.staggerSpeedMult,
        staggerCooldownMs: t.hitSlow.staggerCooldownMs,
      })
    }
    return makeSplitterBrain(model, {
      sepStrength: def.splitter.ai.separationStrength,
      sepPad: def.splitter.ai.separationPad,
    })
  }

  // ------------------------------------------------------------ 死亡与分裂链

  /**
   * 到点的尸体：该分裂的分裂，该回收的回收。
   *
   * **顺序是有讲究的**：先取坐标 → 算孩子的出生位 → `pool.release()` → 入队。
   * 反过来的话（先 release 再算）会拿到一份 `park()` 过的对象：
   * `byId` 里的映射已被清掉，而 `planSplitChildren` 要用死者**当前的坐标** ——
   * 那坐标在 `park()` 之后读到的就是停放前的旧值或者别的什么，反正不是「死在哪」。
   */
  private reapDead(nowMs: number): void {
    for (let i = this.pendingDeaths.length - 1; i >= 0; i--) {
      const pd = this.pendingDeaths[i]!
      if (nowMs < pd.atMs) continue
      this.pendingDeaths.splice(i, 1)

      const { entry } = pd
      if (!this.byId.has(entry.model.id)) {
        // 已经被 shutdown / 清场回收了。静默跳过 —— 这时候再 release 一次
        // 会抛「重复释放」，而那是我们自己的清场路径，不是 bug。
        continue
      }

      const x = entry.view.x
      const y = entry.view.y
      const parentId = entry.model.id
      const parentGen = entry.model.gen

      const plans = pd.reason === 'split' ? this.planChildren(parentGen, x, y, pd.baseAngleRad) : []

      this.pool.release(entry) // 内部一定会调 ledger.releaseTarget

      for (let k = 0; k < plans.length; k++) {
        const p = plans[k]!
        this.requestSpawn('splitter', pd.childGen, p.x, p.y, 'split', p.delayMs)
      }

      if (plans.length > 0) {
        // `children` 填不满：具体 id 要等它们真的出生才知道。
        // 表现层要配对父子，请用 `entity_spawned` 的 (gen, 时间) 对齐 ——
        // 在这里编 id 会编出一个永远不存在的实体。
        this.bus.emit('enemy_split', {
          parentId,
          children: [],
          parentGen,
          childGen: pd.childGen,
        })
      }
    }
  }

  private planChildren(gen: number, x: number, y: number, baseAngleRad: number) {
    const gens = this.bundle.enemies.enemies.splitter.generations
    const def = gens[gen] ?? gens[gens.length - 1]!
    return planSplitChildren({
      parentX: x,
      parentY: y,
      fanAngleDeg: def.fanAngleDeg,
      spawnRadius: def.spawnRadius,
      childCount: def.childCount,
      spawnStaggerMs: def.spawnStaggerMs,
      baseAngleRad,
    })
  }

  // ------------------------------------------------------------ ActorEventSink

  onDamaged(info: DamageEventInfo): void {
    if (!this.byId.has(info.targetId)) return
    this.bus.emit('entity_damaged', {
      targetId: info.targetId,
      targetKind: 'enemy',
      amount: info.amount,
      hpAfter: info.hpAfter,
      sourceId: info.sourceId,
      sourceKind: info.sourceKind,
      mode: info.mode,
      // 逐条发，不在这里攒批。聚合是**表现**的事（飘字合并、音效限频），
      // 归 `presentation/JuiceDirector`；模型层一旦开始攒批，
      // 任何直接订阅总线的调试工具看到的就是「伤害怎么晚了一截」。
      batched: false,
      tickCount: 1,
      frameId: info.frameId,
    })
  }

  /**
   * 死亡。**分裂链在这里启动**，不在 `EnemyModel` 里 ——
   * 模型只负责「我死了」（`alive = false`），什么时候分裂、裂几只、往哪裂
   * 全是系统的事（`EnemyModel.test.ts` 有断言锁着这条分工）。
   *
   * 尸体**还占着池槽位**直到 `splitDelayMs` 走完（见 `reapDead`）：
   * 玩家看到的是「尸体停一下 → 炸开」，而不是「原地消失 → 那边凭空冒出一堆」。
   */
  onKilled(info: KillEventInfo): void {
    const entry = this.byId.get(info.targetId)
    if (!entry) return
    this.radialShots.removeOwner(info.targetId)

    const model = entry.model
    const nowMs = this.clock.nowMs
    const x = entry.view.x
    const y = entry.view.y

    this.bus.emit('entity_killed', {
      bossStage: this.bossStages.get(model.id),
      id: model.id,
      kind: 'enemy',
      enemyKind: model.enemyKind,
      gen: model.gen,
      x,
      y,
      sourceId: info.sourceId,
    })

    const gens = this.bundle.enemies.enemies.splitter.generations
    const def = gens[model.gen] ?? gens[gens.length - 1]!
    const canSplit =
      model.enemyKind === 'splitter' && def.childCount > 0 && model.gen + 1 < gens.length

    // 扇形的中心朝向用**死者最后的速度意图**，这样「你打退它，它朝你反方向炸开」，
    // 而不是永远朝世界右方炸。静止时退化成 0 弧度 —— 也还行，至少是确定的。
    const vl = Math.hypot(model.velIntent.x, model.velIntent.y)
    const baseAngleRad = vl > 1e-3 ? Math.atan2(model.velIntent.y, model.velIntent.x) : 0

    // 先推状态，再 park。park() 会 `model.despawn()`，但它**不动 `state`** ——
    // 顺序其实不敏感，写成这样只是为了让「state 在 park 之后仍然是 splitting」
    // 这件事在代码里显式可见（brain 与表现层都要读它）。
    if (canSplit) model.setState('splitting', nowMs)
    entry.view.park() // 停物理、隐藏。此后 model.alive 已经是 false

    this.pendingDeaths.push({
      entry,
      atMs: nowMs + (canSplit ? def.splitDelayMs : 0),
      childGen: model.gen + 1,
      baseAngleRad,
      reason: canSplit ? 'split' : 'recycle',
    })
  }

  // ------------------------------------------------------------ D1 的调用口

  /**
   * **子弹碰到敌人。** 返回的 `HitResult.consumed` 就是「这颗子弹该不该回收」。
   *
   * 普通敌人 `consumed: true`（挡下）；**肉盾 `false`**（穿透）。于是
   * 「肉盾每 100ms 结算一次帧伤」不需要 D1 写任何分支 ——
   * 子弹继续飞，overlap 继续响，我们继续 `touch()`。
   *
   * @param impactDamage 冲击那一发的伤害（同一个源只算一次）
   * @param pierceTickDamage 穿透期间每 tick 的伤害
   * @param maxTicks 同一个源最多结算几次 tick（配置 `frameDamage.bullet.maxTicksPerSource`）
   */
  bulletContact(
    shotId: number,
    enemyGO: Phaser.GameObjects.GameObject,
    impactDamage: number,
    pierceTickDamage: number,
    maxTicks: number,
  ): HitResult {
    return this.contactSource(shotId, enemyGO, 'bullet', impactDamage, pierceTickDamage, maxTicks)
  }

  /**
   * **扫掠射线落到某只怪身上**（D1 的特殊弹走这条，手枪走 `bulletContact`）。
   *
   * 两条路**共用同一套结算**（`ContactResolver`）：冲击每个源只算一次、
   * 帧伤按 `tickMs` 进账本。区别只是 D1 手上有什么 ——
   * 物理重叠回调给的是碰撞对象，射线路径给的是怪 id。
   *
   * ⚠️ **不要为了省一个方法就把射线路径改回 `weaponHit()`。**
   * 那条路是「一次性的固定伤害」：`hitKey` 里的 `frameId` 让基类的去重跨不了帧，
   * 而**可穿透的目标根本不进 `hitIds`**（D1 那边只记 `consumed` 的），
   * 于是同一发子弹**每一帧都兑现一次全额冲击**。肉盾半径 40、停留 = 直径 ÷ 弹速
   * （≈5~12 帧，看武器）—— 一发 54 点的大威力弹能打出 600 点以上，
   * 520 血的肉盾一发就没了，「穿过去」和「帧伤跳字」两个特性一个都看不见。
   * `contact.test.ts` 里那条「13 点，不是 90 点」说的是同一件事，只是走的重叠路径。
   */
  bulletRayContact(
    shotId: number,
    enemyId: number,
    impactDamage: number,
    pierceTickDamage: number,
    maxTicks: number,
  ): HitResult {
    const entry = this.byId.get(enemyId)
    // 不在池子里的 id（已经回收 / 不是我们的东西）：让子弹回池，别让它一直飞。
    if (!entry) return { applied: 0, killed: false, consumed: true }
    return this.contacts.contact(
      shotId,
      entry.model,
      'bullet',
      impactDamage,
      pierceTickDamage,
      maxTicks,
    )
  }

  /**
   * **近战碰到敌人。** 挥砍是一个持续存在的源：接触期间按 tick 结算，
   * 离开时 D1 调 `releaseMelee(swingId)`。
   *
   * 肉盾同样 `consumed: false`（挥砍不被它吃掉）。如果 D1 用 `consumed` 结束一次挥砍，
   * 这里返回 `true` 会让肉盾的近战帧伤静默退化成「一次挥砍只掉一下」。
   */
  meleeContact(
    swingId: number,
    enemyGO: Phaser.GameObjects.GameObject,
    impactDamage: number,
    tickDamage: number,
    maxTicks: number,
  ): HitResult {
    return this.contactSource(swingId, enemyGO, 'melee', impactDamage, tickDamage, maxTicks)
  }

  /**
   * 子弹被回收时调。**D1 一定要调**，否则：
   * ① 账本里那条 `(子弹, 怪)` 配对会一直留到 TTL 过期；
   * ② `impactDone` 整张表随子弹序号无限增长 —— 长时间游玩慢慢吃内存。
   */
  releaseBullet(shotId: number): void {
    this.contacts.release(shotId)
  }

  /** 近战挥砍结束时调，同上。 */
  releaseMelee(swingId: number): void {
    this.releaseBullet(swingId)
  }

  private contactSource(
    sourceId: number,
    enemyGO: Phaser.GameObjects.GameObject,
    kind: DamageSourceKind,
    impactDamage: number,
    tickDamage: number,
    maxTicks: number,
  ): HitResult {
    const model = (enemyGO as EnemyActor).model as EnemyModel | undefined
    if (!model || !this.byId.has(model.id)) {
      // 碰到的不是池子里的敌人（别的组的东西、或者已回收的槽位）。
      // 让子弹回池，否则它会一直飞下去。
      return { applied: 0, killed: false, consumed: true }
    }
    return this.contacts.contact(sourceId, model, kind, impactDamage, tickDamage, maxTicks)
  }

  // ------------------------------------------------------------ 调试 / 测试场

  /** 当前这一帧的 AI 记账 */
  get aiStats(): AiTickStats {
    return this.lastAiStats
  }

  /**
   * `WORLD_STEP` 一共进来过几次。
   *
   * **它不涨就等于整个敌人系统是死的** —— 不刷怪、不跑 AI、不结算帧伤，
   * 而且一声不吭。物理世界一空（`bodies.size === 0`）或一被暂停就会这样，
   * 见文件头那段 ⚠️。HUD 直接显示它，就是为了把「静默」这两个字去掉。
   */
  get worldSteps(): number {
    return this.worldStepCount
  }

  /**
   * 上一个物理步里**真的在动**的活怪数（按物理体速度算，不是按速度意图）。
   *
   * 为什么值得占 HUD 一行：这个数**小于 `liveEnemies.length` 就是有人不动**，
   * 而「不动」的原因里最坏的一种是「速度意图根本没被写进物理体」——
   * 那会让怪沿着上一次状态切换时的速度直线滑行、或者干脆站住，
   * 而 AI 次数、账本、队列、帧率**全部正常**，画面上只是「怪有点呆」。
   * 从 `velIntent` 取数是读不出这个 bug 的（意图一直是对的），必须读物理体。
   *
   * ⚠️ **它可能比 `liveEnemies.length` 少最多 `maxSpawnsPerFrame` 只**：
   * 当帧刚出生的怪不在 `frameEntries` 里（那个数组在 `runAi` 之前就填好了），
   * 所以要等下一帧才被算进来。密集刷怪时 `moving` 略小于 `alive` 是正常的 ——
   * 判据是「**一只都不动**」，不是「两个数相等」。
   */
  get movingEnemies(): number {
    return this.movingCount
  }

  /**
   * 还记着冲击（穿透/持续伤害）的源。**只涨不落 = 有人忘了 release**。
   *
   * 测试场的 HUD 直接显示它：漏 `releaseBullet()` 的话这里会一直往上涨，
   * 而那种泄漏**不会有任何报错**（见 `ContactResolver`）。
   */
  get contactsTracked(): number {
    return this.contacts.trackedSources
  }

  /** 池里活着的敌人（只读快照）。遍历时不要在里面刷怪 */
  /** Horizontal target direction for enemy presentation; zero retains its current facing. */
  isStage2Boss(id: number): boolean {
    return this.bossStages.get(id) === 2 && !this.finalBosses.has(id)
  }
  isFinalBoss(id: number): boolean {
    return this.finalBosses.has(id)
  }
  isBoss(id: number): boolean {
    return this.bossStages.has(id)
  }

  playerDirectionX(id: number): number {
    const target = this.playerOf(),
      entry = this.byId.get(id)
    if (!target?.alive || !entry) return 0
    const dx = target.x - entry.view.body.center.x
    return Math.abs(dx) > 1 ? Math.sign(dx) : 0
  }

  isPlayerInRange(id: number, radius: number): boolean {
    const target = this.playerOf(),
      entry = this.byId.get(id)
    if (!target?.alive || !entry) return false
    const center = entry.view.body.center
    return Math.hypot(target.x - center.x, target.y - center.y) <= radius
  }

  get liveEnemies(): readonly Entry[] {
    return this.pool.activeEntries()
  }

  /**
   * 按 id 找**池条目**（表现对象 + 模型）。**给表现层用** ——
   * `JuiceDirector` 订阅的事件里只有 id，没有对象。
   *
   * 返回整个条目而不是只返回 `view`：表现层要同时读
   * 「对象」（改 alpha / scale / 播动画）和「模型」（`enemyKind`、
   * 当前状态、血量比），只给 `view` 的话它还得再找一次模型。
   *
   * 返回 `undefined` 是**正常情况**，不是错误：事件逐帧投递，
   * 而怪可能在这几帧里已经被回收（`killAll()` 一条链就走完了，
   * 或者击杀 → 分裂延迟 → `reapDead` 已经把槽位还回池子）。
   * 所以调用方一律 `if (!entry) return`，**不要拿它当断言用**。
   */
  entryOf(id: number): Entry | undefined {
    return this.byId.get(id)
  }

  /** 调试用：把场上全部打死（测试场的「清场」按钮）。会正常走分裂链 */
  killAll(): void {
    for (const entry of this.pool.activeEntries()) {
      entry.model.takeHit({
        sourceId: -1,
        hitKey: `debug-kill:${entry.model.id}`,
        mode: 'instant',
        amount: Number.MAX_SAFE_INTEGER,
        frameId: this.clock.frameId,
        nowMs: this.clock.nowMs,
        // `DamageSourceKind` 没有 'debug' 这一档，也不该有 ——
        // 加一个只给调试用的枚举值，等于让「玩家被什么打死的」多出一种永远不出现的答案。
        // 清场用 'aoe' 最贴切：它就是一次把所有人都扫掉的范围伤害。
        sourceKind: 'aoe',
      })
    }
  }
}
