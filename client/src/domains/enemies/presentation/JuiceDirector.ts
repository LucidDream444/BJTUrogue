/**
 * 打击感的**执行层**。对外只有三个方法：`create()` / `update()` / `shutdown()`。
 *
 * 决策（做不做、做多少）全在 `JuicePolicy`（纯逻辑、有单测）；本文件只负责「怎么做」。
 *
 * ---
 *
 * ## ⚠️ 顿帧必须是 `clock.freeze()` + `physics.world.pause()` **配对**
 *
 * 光冻结时钟是**假的顿帧**：`GameClock` 只是一个各域自愿查询的包装器，
 * 物理积分、子弹位移、sprite 位置全都不看它 —— 画面照常动，只有伤害 tick 和 AI 停了。
 * 那种状态比不做顿帧更糟：伤害和画面不同步，玩家看到的是「打中了但没反应」。
 *
 * 光暂停物理是**另一种坏的顿帧**：`WORLD_STEP` 不再触发，AI 与账本全停，
 * 但 `GameClock` 还在走 —— 于是「暂停」的那 60ms 里逻辑时间照常流逝，
 * 所有计时器（硬直、冷却、无敌帧）都被偷偷吃掉一截。
 *
 * 两个一起上才是真的「世界停了 60ms」。配对由 `syncPhysicsPause()` 每帧兜底。
 *
 * ## ⚠️ 绝不碰 `physics.world.timeScale`
 *
 * `[源码]` `World.js`：`msPerFrame = this._frameTimeMS * this.timeScale`，
 * 然后是 `while (this._elapsed >= msPerFrame)`。**`timeScale = 0` 让 msPerFrame 变成 0，
 * 那个 while 永不退出** —— 浏览器直接卡死。这不是「效果不好」，是死循环。
 *
 * ## ⚠️ 暂停/恢复有一帧延迟，这是**对的**
 *
 * `[源码]` `ArcadePhysics.js` L159：`world.update` 挂在 `SceneEvents.UPDATE` 上，
 * 而 `Systems.step` 是先 emit `UPDATE`、**之后**才调 `scene.update()`。
 * 所以 `scene.update()` 里的 `pause()` / `resume()` 对**下一帧**的物理生效。
 * 两端各延迟一帧、是对称的 —— 顿帧的总时长仍然准确。
 *
 * ## 肉盾用连续正弦，不用「每 hit 触发一次」
 *
 * 肉盾是帧伤怪：贴脸用近战砍一秒能结算 10 次，一发穿透弹在它体内也能结算 3 次。
 * 触发式的闪白/抖动会随结算频率变化，而频率取决于玩家的武器 ——
 * 换一把武器就会从「有力」变成「癫痫警告」。所以肉盾的闪白 / 抖动 / 挤压
 * 全是 `realNowMs` 的**正弦波**，频率写在配置里（`flashHz` / `jitterHz` / `squashHz`），
 * 伤害再密也不会变快。
 *
 * 分裂怪相反：它一击必杀，触发式的缩放冲击才对（一击一下，没有频率问题）。
 *
 * ## 表现层改 scale / alpha **不影响判定**
 *
 * 这是刻意的，不是巧合：`body` 是圆形的，半径在 `spawnAt()` 里按
 * `model.stats.radius` 设死，`setScale()` 不改变它。挤压效果把精灵拉扁，
 * 判定仍然是那个圆 —— 玩家不会因为「它看起来被压扁了」而打空。
 */

import Phaser from 'phaser'
import type { GameClock } from '@/core/time'
import type { GameEvents, EnemyKind, TypedBus, Unsubscribe } from '@/core/events'
import type { ConfigBundle } from '@/core/config'
import { GRAB_PRESS_SOURCE_ID } from '../EnemySystem'
import type { EnemySystem } from '../EnemySystem'
import { RadialBurstFx } from './RadialBurstFx'
import { JuicePolicy, juiceParamsFromConfig } from './JuicePolicy'
import { SfxPool } from './SfxPool'
import { EnemyHealthBars } from './EnemyHealthBars'
import { GrabAlertFx } from './GrabAlertFx'
import { PaperDeathFx } from './PaperDeathFx'
import { EmpBlastFx } from './EmpBlastFx'
import { GrabImpactFx } from './GrabImpactFx'
import { ASSETS, ANIMS, GRABBER_ART, TANK_ART } from '@/core/assetManifest'
import { textureKeyFor } from '@/core/assets'

/** 受击冲击淡出用多久。**小于肉盾的 `damageEventBatchMs` 才不会糊成一片常亮** */
const HIT_GLOW_MS = 140
/** 分裂怪受击时的缩放冲击幅度（视觉上的「砰」） */
const SPLITTER_PUNCH = 0.28
/** 肉盾闪白的最低透明度（1 = 不闪）。0.55 是「明显但不刺眼」 */
const TANK_FLASH_MIN_ALPHA = 0.55
/** 肉盾抖动幅度（弧度）。约 2°，再多就会被看成「它在转身」而不是「它在挨打」 */
const TANK_JITTER_RAD = 0.035
/** 肉盾挤压幅度（缩放比例） */
const TANK_SQUASH_AMPLITUDE = 0.06
/** 一次抖动的名义时长。见 `applyShake()` —— 抖动活着的时候会被反复续期 */
const SHAKE_TAIL_MS = 120
/**
 * 创伤 → 抖动强度的系数。
 *
 * `[源码]` `Shake.update()`：`offsetX = (rand * i.x * width * 2 - i.x * width) * zoom`，
 * 也就是**强度是相机宽度的比例**：0.05 在 960 宽的画面上等于 ±48px —— 非常大。
 * 所以这里给的是 0.03 这个量级，配合平方映射（见 `applyShake`）。
 */
const TRAUMA_TO_INTENSITY = 0.03
/** 连杀花式的白闪透明度。**刻意压低**：全屏白闪是光敏风险的直接来源 */
const FLOURISH_FLASH_ALPHA = 0.25
/** 连杀花式的白闪时长 */
const FLOURISH_FLASH_MS = 110
/** 单帧 dt 的上限：切标签页回来时 delta 可能上千毫秒，别让创伤一帧衰减掉 */
const MAX_DT_MS = 100

export interface JuiceDirectorOptions {
  scene: Phaser.Scene
  bus: TypedBus<GameEvents>
  clock: GameClock
  bundle: ConfigBundle
  enemies: EnemySystem
}

/**
 * 一只怪的视觉状态。
 *
 * 分裂怪用「冲击衰减」（一次性，回弹），肉盾用「连续波」（跟着受击持续跑），
 * 两种形状共用一张表 —— 分成两张表只会让「回收时忘清一张」变成新的 bug。
 */
interface VisualState {
  /** 最近一次受击的真实时刻。决定连续波还要不要继续跑 */
  lastHitRealMs: number
  /** 连续波的相位偏移，让每只怪的闪烁不同步（同步闪 = 全屏一起闪，很廉价） */
  phase: number
}

export class JuiceDirector {
  private readonly scene: Phaser.Scene
  private readonly bus: TypedBus<GameEvents>
  private readonly clock: GameClock
  private readonly bundle: ConfigBundle
  private readonly enemies: EnemySystem
  private readonly policy: JuicePolicy
  private readonly radialFx: RadialBurstFx
  private readonly healthBars: EnemyHealthBars
  /** 抓取怪头顶的「!」与红色咬人倒计时（抓取期间世界是冻的，这两样是唯一还在动的东西） */
  private readonly grabAlerts: GrabAlertFx
  private readonly paperDeaths: PaperDeathFx
  private readonly grabImpact: GrabImpactFx
  private readonly empBlast: EmpBlastFx
  private readonly sfx: SfxPool
  private readonly visuals = new Map<number, VisualState>()
  private readonly grabPhases = new Map<number, string>()
  private readonly animations = new Map(
    ANIMS.filter((anim) => anim.repeat === -1).map((anim) => [anim.textureKey, anim]),
  )
  private readonly unsubs: Unsubscribe[] = []

  /** 肉盾满血。**只算一次** —— `specFor()` 每次都走派生 + 缓存查找，不该每帧问 */
  private readonly tankMaxHp: number

  /** 相位偏移用的确定性随机状态。**不用 `Math.random()`** —— 同种子同表现，好复现 */
  private xorshift = 0x9e3779b9

  private disposed = false

  constructor(opts: JuiceDirectorOptions) {
    this.scene = opts.scene
    this.bus = opts.bus
    this.clock = opts.clock
    this.bundle = opts.bundle
    this.enemies = opts.enemies
    this.radialFx = new RadialBurstFx(
      opts.scene,
      opts.enemies,
      opts.clock,
      opts.bundle.enemies.stage2Boss,
    )
    this.healthBars = new EnemyHealthBars(opts.scene, opts.enemies)
    this.grabAlerts = new GrabAlertFx(opts.scene, opts.enemies, opts.bundle.enemies.enemies.grabber)
    this.paperDeaths = new PaperDeathFx(
      opts.scene,
      opts.clock,
      opts.bundle.balance.spawn.maxAliveHard,
    )
    this.grabImpact = new GrabImpactFx(opts.scene)
    this.empBlast = new EmpBlastFx(opts.scene)

    const enemies = opts.bundle.enemies.enemies
    this.policy = new JuicePolicy(
      juiceParamsFromConfig(opts.bundle.balance, enemies.splitter.juice, enemies.tank.juice),
    )
    this.tankMaxHp = opts.enemies.specFor('tank', 0).stats.maxHp

    this.sfx = new SfxPool({
      scene: opts.scene,
      keys: ASSETS.filter(
        (a) =>
          a.kind === 'audio' && (a.key.startsWith('sfx_enemy_') || a.key === 'sfx_kill_flourish'),
      ).map((a) => a.key),
      voicesPerKey: 8,
    })
  }

  /**
   * 订阅事件、建音效池。**在场景 `create()` 里调一次。**
   *
   * ⚠️ 每一条 `on()` 的退订函数都存进 `this.unsubs`，`shutdown()` 里逐个调用。
   * 匿名订阅不存退订函数的后果（见 `core/events.ts` 文件头）：
   * 重启 3 次就留 3 个 handler，一次受伤放 3 次音、震 3 次屏 ——
   * 而且 `off()` 传匿名函数是**静默失败**的（引用不相等），查都查不出来。
   */
  create(): void {
    // `scene.cache.audio` 要等 preload 结束才有内容，所以池子在这里建
    // （构造函数里建会把所有 key 判成「静默」，然后永久不出声）。
    this.sfx.create()

    this.unsubs.push(
      this.bus.on('entity_damaged', (e) => this.onDamaged(e)),
      this.bus.on('entity_killed', (e) => this.onKilled(e)),
      this.bus.on('entity_spawned', (e) => this.onSpawned(e)),
      // 暂停时把所有在播的音停掉。不停的话：菜单开着，肉盾的研磨音继续磨，
      // 玩家切回来时听到的是一段和画面无关的声音。
      this.bus.on('app_paused', () => this.sfx.stopAll()),
      // 恢复时重置策略：暂停期间的「真实时间」走了很长一截，
      // 连击窗口、震屏间隔、顿帧预算的记账全是过期的。
      this.bus.on('app_resumed', () => {
        this.policy.reset()
        // 重置完立刻把抖动强度写 0：`policy.reset()` 只改数字，
        // 相机的 `intensity` 还是暂停前那个值，不清的话恢复瞬间会猛地抖一下。
        this.applyShake()
      }),
    )
  }

  /**
   * 每渲染帧调一次（场景 `update()` 里）。**必须在 `clock.advance()` 之后。**
   *
   * @param realDeltaMs **和传给 `clock.advance()` 的那个 delta 是同一个值。**
   *        不在这里自己用 `performance.now()` 算差值：那会让 Phaser 内建的
   *        失焦钳制完全失效（切标签页回来会拿到一个上千毫秒的 delta）。
   *        这里只用它算创伤衰减，且夹到 `MAX_DT_MS` 兜底。
   */
  update(realDeltaMs: number): void {
    if (this.disposed) return

    this.syncPhysicsPause()

    // 衰减**按真实时间**：顿帧期间逻辑时间不走，用它衰减的话
    // 「击杀 → 顿帧 60ms → 恢复」这段时间创伤一点没减，抖动会拖到顿帧之后才开始。
    const dtMs = Number.isFinite(realDeltaMs) ? Math.min(MAX_DT_MS, Math.max(0, realDeltaMs)) : 0
    this.policy.decayTrauma(dtMs)
    this.applyShake()
    this.updateAnimations()
    this.updateVisuals(this.clock.realNowMs)
    this.paperDeaths.update()
    this.grabImpact.update(this.clock.realNowMs)
    this.empBlast.update(this.clock.realNowMs)
    this.healthBars.update()
    // 用表现时间：抓取期间逻辑时钟是停的，而倒计时必须继续走
    this.grabAlerts.update(this.clock.realNowMs)
    this.radialFx.update()
  }

  /** 场景 `shutdown` 里调。 */
  shutdown(): void {
    if (this.disposed) return
    this.disposed = true

    for (const unsub of this.unsubs) unsub()
    this.unsubs.length = 0

    this.sfx.destroy()
    this.healthBars.destroy()
    this.grabAlerts.destroy()
    this.paperDeaths.destroy()
    this.grabImpact.destroy()
    this.empBlast.destroy()
    this.radialFx.destroy()
    this.visuals.clear()
    this.grabPhases.clear()
    // 不要在这里 `world.pause()`：shutdown 之后再 pause，下一个场景就动不了了。
    // 反过来的情况（「要重启了但物理还暂停着」）由 `syncPhysicsPause()` 在 update 里兜住。
    // 同理不要在这里动相机 —— 相机可能已经归下一个场景了。
    this.policy.reset()
  }

  // ------------------------------------------------------------ 顿帧配对

  /**
   * 把 `clock.frozen` 与 `physics.world.isPaused` 拉回一致。
   *
   * 两个方向都要管：
   * ① 有人请求了顿帧 → `clock.frozen === true` 而物理还在跑 → 暂停；
   * ② 顿帧走完了 → `clock.frozen === false` 而物理还暂停着 → 恢复。
   *
   * ⚠️ 这里**不能**写成「每次 freeze 都记一个 pending，恢复时配对减一」。
   * `clock.freeze()` 是**取较长者**而不是叠加（见 `core/time.ts`）：
   * 两次 40ms 的请求得到的是 40ms 而不是 80ms —— 记账式的配对会数出 2 个待恢复，
   * 于是物理在顿帧还没走完时就被提前恢复了。用「当前状态」而不是「计数器」才是对的。
   */
  private syncPhysicsPause(): void {
    const world = this.scene.physics.world
    if (this.clock.frozen) {
      if (!world.isPaused) world.pause()
    } else if (world.isPaused && !this.clock.paused) {
      // 暂停菜单也走 `world.pause()`。那种情况下 `clock.paused` 是 true，
      // 不该被我们恢复 —— 否则暂停菜单一开，世界照常跑。
      world.resume()
    }
  }

  // ------------------------------------------------------------ 读数（测试场 HUD 用）

  /**
   * 当前震屏强度（0 — `traumaCap`）。
   *
   * **两个都是「坏掉时看不出来」的量**：创伤不衰减时画面会一直抖到通关，
   * 而只从画面上分不出「抖得对」和「没在衰减」，只有一个数字能。
   */
  get trauma(): number {
    return this.policy.trauma
  }

  /** 窗口内还剩多少顿帧额度（ms）。一直是 0 = 预算比例配错了 */
  get hitstopBudgetRemainingMs(): number {
    return this.policy.budgetRemaining(this.clock.realNowMs)
  }

  // ------------------------------------------------------------ 事件

  private onDamaged(e: GameEvents['entity_damaged']): void {
    if (e.targetKind !== 'enemy') return

    const entry = this.enemies.entryOf(e.targetId)
    if (!entry) return

    const realNowMs = this.clock.realNowMs
    // ⚠️ 事件里**没有** `enemyKind`（`entity_damaged` 的载荷只有 targetId/targetKind，
    // 因为它是通用事件，玩家受伤也走它）。所以类型要从池条目里读。
    // 不要去改事件载荷加一个 `enemyKind`：那是改 C1 契约，得全员同意，
    // 而这里已经有 id → 对象 的正规通路了。
    if (entry.model.enemyKind === 'tank') {
      // 肉盾是帧伤怪：这里**每次结算都到**，一发穿透弹最多 3 次、贴脸近战 10 次/秒。
      // 音效走限频闸门；闪白/抖动/挤压不在事件里触发，走 `updateVisuals` 的连续波。
      if (this.policy.tryTankHitSfx(realNowMs)) {
        // 血越少音越高 —— 这是「它快死了」的听觉线索，
        // 比血条更早被玩家感知到（玩家打架时视线在准星上，不在 HUD 上）。
        const ratio = this.tankMaxHp > 0 ? clamp01(e.hpAfter / this.tankMaxHp) : 1
        this.sfx.play(
          'sfx_enemy_tank_hit',
          (1 - ratio) * this.bundle.enemies.enemies.tank.juice.hpPitchCents,
          0.55,
        )
      }
    } else if (entry.model.enemyKind === 'grabber' && e.sourceId === GRAB_PRESS_SOURCE_ID) {
      // 每次 QTE 按下都会走 entity_damaged；固定池保证短促砍击声可以重叠。
      this.sfx.play('sfx_enemy_grabber_qte_hit', 0, 0.9)
      this.grabImpact.play(entry.view.x, entry.view.y, realNowMs)
    } else if (entry.model.enemyKind === 'grabber') {
      // 预警阶段的普通攻击仍有放大反馈，但不冒充 QTE 的砍击音。
      this.grabImpact.play(entry.view.x, entry.view.y, realNowMs)
    } else {
      // 分裂怪一击必杀，所以「受击」和「死亡」几乎总是同一帧发生，
      // 受击音和爆裂音会叠在一起 —— 这正是想要的：闷响 + 脆响。
      this.sfx.play('sfx_enemy_splitter_hit', 0, 0.7)
    }

    this.markHit(e.targetId, realNowMs)
  }

  private onKilled(e: GameEvents['entity_killed']): void {
    if (e.kind !== 'enemy') return

    const kind: EnemyKind = e.enemyKind ?? 'splitter'
    const gen = e.gen ?? 0
    const realNowMs = this.clock.realNowMs
    const juice = this.bundle.enemies.enemies

    // 每个表现量都从配置里取，没有一个是写在这里的常数：
    // 顿帧与创伤是**按代际递减**的（gen0 45ms/0.2 → gen2 0/0.05），
    // 因为最后一代一次会死 8 只，按第一代的量给会把画面钉死。
    const gens = juice.splitter.generations
    const genDef = gens[gen] ?? gens[gens.length - 1]!
    if (kind === 'splitter') {
      this.paperDeaths.play(e.x, e.y, gen, genDef.visualScale, genDef.splitDelayMs)
    }
    const baseHitstopMs =
      kind === 'tank' ? juice.tank.slam.hitstopMs : kind === 'grabber' ? 0 : genDef.hitstopMs
    // 肉盾的死亡是这一场里最大的事，创伤直接给满（`traumaCap` 也来自配置）。
    const baseTrauma =
      kind === 'tank' ? this.bundle.balance.juice.traumaCap : kind === 'grabber' ? 0 : genDef.trauma

    const feedback = this.policy.onHit(
      { enemyKind: kind, gen, killed: true, baseHitstopMs, baseTrauma },
      realNowMs,
    )

    if (feedback.hitstopMs > 0) this.clock.freeze(feedback.hitstopMs)
    this.policy.addTrauma(feedback.trauma)

    if (kind === 'tank') {
      this.sfx.play('sfx_enemy_tank_death', 0, 1)
    } else if (kind === 'grabber') {
      // 落地时已经由 onGrabBlast 播放 EMP；不再叠加分裂怪的爆裂音。
    } else {
      // 连杀的音调逐级升高（`pitchCentsFor`）。这是「连杀」唯一的听觉线索 ——
      // 同一个音连响 8 次听起来只是 8 个音，升调才让玩家**听出自己在连杀**。
      this.sfx.play('sfx_enemy_splitter_pop', this.policy.pitchCentsFor(feedback.combo), 0.8)
    }

    if (feedback.flourish) {
      // 连杀到 `comboFlourishAt` 只触发**这一次**（见 `JuicePolicy.onHit`）。
      // 这是「割草爽感」的顶点信号 —— 玩家会为了再听一次而主动去找群怪。
      this.sfx.play('sfx_kill_flourish', 0, 0.5)
      this.policy.addTrauma(juice.splitter.juice.flourishFlash)
      const flash = this.scene.cameras.main.flashEffect
      // 白闪的透明度要在 `flash()` **之前**设：`start()` 会把当前值拷进 `_alpha`，
      // 之后每帧用 `_alpha * (1 - progress)` 算，结束时再还原。
      flash.alpha = FLOURISH_FLASH_ALPHA
      this.scene.cameras.main.flash(FLOURISH_FLASH_MS, 255, 255, 255, false)
    }

    this.visuals.delete(e.id)
    this.grabPhases.delete(e.id)
  }

  private onSpawned(e: GameEvents['entity_spawned']): void {
    if (e.kind !== 'enemy') return

    // ⚠️ **必须重置视觉变换**，这是池化的直接后果：
    // `Actor.park()` 只做 `body.stop()` + 从物理世界摘除 + 隐藏，
    // **不还原 alpha / scale / rotation**。上一只怪死的时候被压扁、闪白、
    // 转到一半，这些值全都留在那个精灵对象上；槽位复用时它就带着这些值出场 ——
    // 玩家看到的是「新刷出来的怪是半透明歪的」，而且只在被打死过之后才出现。
    //
    // 放在 `entity_spawned` 上而不是 `park()` 里：park 是 `Actor` 的通用能力，
    // 而 scale/alpha 是**表现层**借用的东西，谁借的谁还。
    const entry = this.enemies.entryOf(e.id)
    if (entry) {
      entry.view.setAlpha(1)
      // Keep the Chinese cover title readable in every movement direction.
      entry.view.setFlipX(false)
      entry.view.setScale(entry.view.visualScale, entry.view.visualScale)
      entry.view.rotation = 0
      this.grabPhases.delete(e.id)
    }

    // 分裂出来的孩子（gen > 0）出生给一声轻「啵」。
    // 第一代是波次刷的，那一声该由 D2 的刷怪提示负责，不是这里。
    if ((e.gen ?? 0) > 0) {
      this.sfx.play('sfx_enemy_splitter_pop', 0, 0.35)
    }
  }

  /**
   * 肉盾下砸。由 `EnemySystem` 的域内钩子调。
   *
   * **不走总线**：这是一次已经发生的物理事件（在 `EnemySystem` 里判定命中），
   * 不是需要广播的领域事件。走上总线的话 D1（玩家伤害）也会收到，
   * 而它不该知道敌人的表现细节 —— 玩家挨的这一下由 D1 自己的受伤表现负责。
   */
  onSlam(_x: number, _y: number, radius: number, hitstopMs: number): void {
    if (this.disposed) return

    // 走**同一份**预算：否则一场混战里「连杀不给顿帧」而「下砸给顿帧」，降档逻辑等于没写。
    const granted = this.policy.requestHitstop(hitstopMs, this.clock.realNowMs)
    if (granted > 0) this.clock.freeze(granted)

    this.sfx.play('sfx_enemy_tank_slam', 0, 1)
    // 范围越大震得越狠。系数取自配置的 `traumaCap`，不另立常数。
    this.policy.addTrauma(this.bundle.balance.juice.traumaCap * clamp01(0.6 + radius / 400))
    // 下砸另外给一次**定向**的短促重抖：创伤那套是连续的余震，
    // 而「砸下来」需要一个明确的开场重击，两者叠加才是那一下的分量。
    this.scene.cameras.main.shake(160, TRAUMA_TO_INTENSITY * 2, false)
  }

  /** 抓取怪落地的电磁脉冲：只负责表现，伤害仍由 EnemySystem 结算。 */
  onGrabBlast(x: number, y: number, radius: number): void {
    if (this.disposed) return
    this.empBlast.play(x, y, radius, this.clock.realNowMs)
    // 两个可重叠声部：电磁放电 + 笔记本砸地的低频重击。
    this.sfx.play('sfx_enemy_grabber_emp', 0, 1)
    this.sfx.play('sfx_enemy_grabber_land', 0, 1)
    this.policy.addTrauma(this.bundle.balance.juice.traumaCap * 0.55)
    this.scene.cameras.main.shake(180, TRAUMA_TO_INTENSITY * 1.5, false)
  }

  // ------------------------------------------------------------ 视觉

  private markHit(id: number, realNowMs: number): void {
    let v = this.visuals.get(id)
    if (!v) {
      v = { lastHitRealMs: 0, phase: this.rand() * Math.PI * 2 }
      this.visuals.set(id, v)
    }
    v.lastHitRealMs = realNowMs
  }

  /** Logical time freezes animation during pause and hitstop, including paper death copies. */
  private updateAnimations(): void {
    for (const { model, view } of this.enemies.liveEnemies) {
      if (!model.alive || this.enemies.isBoss(model.id)) continue
      // Artwork uses a fixed overhead view: mirroring a textbook would reverse its title.
      view.setFlipX(false)
      let key = view.texture.key
      let index = 0
      let directFrame: number | null = null
      if (model.enemyKind === 'tank') {
        const slam = this.bundle.enemies.enemies.tank.slam
        const attacking =
          this.enemies.isPlayerInRange(model.id, slam.range) &&
          (model.state === 'windup' || model.state === 'recover')
        key = attacking ? TANK_ART.attack : TANK_ART.walk
        const anim = this.animations.get(key)
        if (!anim) continue
        if (attacking) {
          const age = model.stateAgeMs(this.clock.nowMs)
          const half = Math.floor(anim.frames.length / 2)
          index =
            model.state === 'windup'
              ? Math.min(half - 1, Math.floor((age / slam.windupMs) * half))
              : half +
                Math.min(
                  anim.frames.length - half - 1,
                  Math.floor((age / slam.recoverMs) * (anim.frames.length - half)),
                )
        } else if (view.body.velocity.lengthSq() > 1) {
          index =
            (Math.floor((this.clock.nowMs * anim.frameRate) / 1000) + model.id) % anim.frames.length
        }
      } else if (model.enemyKind === 'grabber') {
        key = GRABBER_ART.texture
        const hit = this.visuals.get(model.id)
        if (hit && this.clock.realNowMs - hit.lastHitRealMs < HIT_GLOW_MS) {
          directFrame = GRABBER_ART.frames.hurt
        } else if (model.state === 'windup') {
          directFrame = GRABBER_ART.frames.windup
        } else if (model.state === 'flung') {
          directFrame = GRABBER_ART.frames.flung
        } else {
          const grab = this.enemies.grabStatus()
          if (grab?.enemyId === model.id) {
            const phase = grab.phase
            const previous = this.grabPhases.get(model.id)
            if (previous !== phase) {
              this.sfx.play(
                phase === 'pounce' ? 'sfx_enemy_grabber_pounce' : 'sfx_enemy_grabber_latch',
                0,
                0.8,
              )
              this.grabPhases.set(model.id, phase)
            }
            directFrame =
              grab.phase === 'pounce' ? GRABBER_ART.frames.pounce : GRABBER_ART.frames.holding
          } else if (model.state === 'chase') {
            this.grabPhases.delete(model.id)
            directFrame =
              (Math.floor((this.clock.nowMs * 8) / 1000) + model.id) % 2 === 0
                ? GRABBER_ART.frames.walkA
                : GRABBER_ART.frames.walkB
          } else {
            directFrame = GRABBER_ART.frames.idle
          }
        }
      } else {
        const anim = this.animations.get(key)
        if (!anim) continue
        index =
          (Math.floor((this.clock.nowMs * anim.frameRate) / 1000) + model.id) % anim.frames.length
      }
      const anim = this.animations.get(key)
      if (!anim && directFrame === null) continue
      const texture = textureKeyFor(this.scene, key)
      const frame = directFrame ?? anim!.frames[index]!
      // A missing or intentionally placeholder sheet has no numbered animation frames.
      if (!this.scene.textures.get(texture).has(String(frame))) continue
      if (view.texture.key !== texture) view.setTexture(texture, frame)
      else if (String(view.frame.name) !== String(frame)) view.setFrame(frame)
    }
  }

  /**
   * 每帧把「受击中的怪」的视觉变换写一遍。
   *
   * 两种形状（见文件头）：肉盾是连续正弦，分裂怪是衰减的缩放冲击。
   */
  private updateVisuals(realNowMs: number): void {
    const tankJuice = this.bundle.enemies.enemies.tank.juice
    // 肉盾的连续波在「最后一次受击」之后再跑一会儿才收，
    // 否则松手的那一瞬间它会突然弹回原样 —— 而它并没有「恢复」，
    // 只是这一秒没人打它。留一小段尾巴，读起来像是「它在喘」。
    const tankTailMs = Math.max(tankJuice.damageEventBatchMs, HIT_GLOW_MS) * 2

    for (const [id, v] of this.visuals) {
      const entry = this.enemies.entryOf(id)
      if (!entry) {
        // 怪已经回池了（击杀 → 分裂延迟 → `reapDead` 一条链走完）。
        // 顺手清掉：ids 单调递增永不复用，所以这个键永远不会再匹配上任何东西，
        // 不清就是纯粹的内存只涨不落。
        this.visuals.delete(id)
        continue
      }
      const view = entry.view
      const ageMs = realNowMs - v.lastHitRealMs

      if (ageMs > tankTailMs) {
        view.setAlpha(1)
        view.setScale(view.visualScale, view.visualScale)
        view.rotation = 0
        this.visuals.delete(id)
        continue
      }

      if (entry.model.enemyKind === 'tank') {
        // 连续正弦：频率写在配置里，伤害再密也不会闪得更快（见文件头）。
        // 用秒做自变量、再乘 Hz —— `Math.sin` 的参数是弧度不是圈。
        const t = (realNowMs / 1000) * Math.PI * 2 + v.phase
        const wave = 0.5 + 0.5 * Math.sin(t * tankJuice.flashHz)
        view.setAlpha(TANK_FLASH_MIN_ALPHA + (1 - TANK_FLASH_MIN_ALPHA) * wave)
        view.rotation = Math.sin(t * tankJuice.jitterHz) * TANK_JITTER_RAD
        const squash = 1 + Math.sin(t * tankJuice.squashHz) * TANK_SQUASH_AMPLITUDE
        // 挤压保持面积：横着压扁就竖着拉长。只缩不拉会看成「它在缩小」，
        // 而我们要表达的是「它被压了一下」，不是「它变小了」。
        view.setScale(view.visualScale / squash, view.visualScale * squash)
      } else {
        // 分裂怪与抓取 QTE 都用触发式缩放冲击：快速回弹的「砰」。
        // `k` 从 1 线性衰减到 0，超过窗口就是 0（不回弹、不残留）。
        const k = Math.max(0, 1 - ageMs / HIT_GLOW_MS)
        const punch = entry.model.enemyKind === 'grabber' ? 0.18 : SPLITTER_PUNCH
        const s = view.visualScale * (1 + punch * k)
        view.setScale(s)
        view.setAlpha(1)
        view.rotation = 0
      }
    }
  }

  /**
   * 把创伤变成抖动强度，每帧写一次。
   *
   * **每帧写 `intensity` 而不是「攒够了抖一次」**：创伤本来就是一个连续量，
   * 分次触发在低频时会抖得断断续续。
   *
   * 用 `shakeEffect.intensity.set()` 直接改正在跑的那个效果，**不重启它**：
   * `start()` 会把 `_elapsed` 归零，每帧重启等于让这个效果永远跑不完 ——
   * 抖动会一直挂着不结束。当前值写进去就够了，`update()` 每帧按新强度取随机偏移。
   *
   * 强度用**平方**映射而不是线性：线性的 0.2 残余创伤还在明显晃，
   * 玩家会觉得「画面一直在抖」但说不上哪里不对；平方让它很快消失。
   */
  private applyShake(): void {
    const fx = this.scene.cameras.main.shakeEffect
    const intensity = this.policy.trauma * this.policy.trauma * TRAUMA_TO_INTENSITY

    fx.intensity.set(intensity)
    if (intensity > 0 && !fx.isRunning) {
      // 只有「从没在抖」到「开始抖」才 start。已在跑的话上面那行就够了。
      fx.start(SHAKE_TAIL_MS, intensity)
    }
  }

  /** 确定性随机（相位偏移用）。**不用 `Math.random()`** —— 同种子同表现，便于复现 bug */
  private rand(): number {
    let x = this.xorshift
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.xorshift = x >>> 0
    return (this.xorshift >>> 8) / 0x1000000
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
