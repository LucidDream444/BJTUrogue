/**
 * 实体的 Phaser 外壳 —— 玩家与敌人共用。**这是唯一 import Phaser 的实体文件。**
 *
 * 分工：`ActorModel` 管逻辑（血量、状态、速度意图），`Actor` 管「物理体 + 贴图」。
 * 位置真值在 Arcade body，`ActorModel` 完全不碰坐标。
 *
 * ---
 *
 * ## 每个渲染帧里，Phaser 到底按什么顺序动了什么（已对 3.90.0 源码核实）
 *
 * ```
 * World.update(time, delta)                       physics/arcade/World.js L936
 * │  if (isPaused || bodies.size === 0) return    ← 早于 _elapsed += delta，所以暂停不累积
 * │  _elapsed += delta
 * │  for each body: body.preUpdate(...)
 * │      ├─ updateFromGameObject()   sprite.x/y + offset → body.position   [Body.js L1128]
 * │      └─ body.update(delta)       按 velocity 积分
 * │  if (willStep):
 * │      tree.load(bodies)
 * │      colliders.update() ──────────★ 碰撞回调（我们的 touch() 在这）
 * │      emit(WORLD_STEP) ────────────★ 我们的 ledger.step() 在这
 * │  while (_elapsed >= msPerFrame):                ← 掉帧时一帧内会跑好几个「补步」
 * │      World.step(delta)                          L1055
 * │          for each body: body.update(delta)
 * │          colliders.update() ──────★ touch() 又一次
 * │          emit(WORLD_STEP) ────────★ ledger.step() 又一次
 * │          stepsLastFrame++
 * World.postUpdate()                               L1083 —— 每渲染帧**只一次**
 * │  if (stepsLastFrame) for each body: body.postUpdate()   body.position → sprite.x/y
 * ```
 *
 * 两条从这张图推出来的结论，写代码时别违反：
 *
 * 1. **touch 永远早于 ledger.step**（同一个物理步内），所以「本步接触过才结算」成立。
 * 2. 掉帧时一帧内有 N 个补步，**它们共用同一个 `GameClock.frameId`**（帧号每渲染帧才 +1）。
 *    这正是伤害账本「每个配对单帧最多结算一次」要处理的情形。
 *
 * ## 回池必须用 `world.disableBody(body)`，不能用 sprite 级的 `disableBody()`
 *
 * `[源码]` 两者名字一样但做的事完全不同：
 *
 * | 调用 | 真正做的事 | 出处 |
 * |---|---|---|
 * | `sprite.disableBody()` | 只 `body.stop()` + `body.enable = false` | `components/Enable.js` L97–117 |
 * | `world.disableBody(body)` | `tree.remove()` + `bodies.delete()` + `enable = false` | `World.js` L634 |
 * | `sprite.enableBody(...)` | 只 `body.reset()` + `active/visible`，**从不 world.add()** | `components/Enable.js` L59–79 |
 * | `world.add(body)` | `bodies.set(body)` + `enable = true` | `World.js` L464 |
 *
 * 用错 sprite 级那个的后果：尸体留在 RTree 里继续参与碰撞（子弹打空气），
 * 而且 `enableBody()` 唤不回来 —— 因为 `world.bodies` 里根本没有它。
 * **静默失效，不报错。**
 *
 * ⚠️ 顺带一个坑：`world.disableBody()` 会把 body 移出 `world.bodies`，
 * 而 `World.update()` 第一句就是 `if (isPaused || bodies.size === 0) return` ——
 * **全场实体都回池后，WORLD_STEP 不再触发**。所以表现层不能依赖 WORLD_STEP 做收尾清理，
 * 场景 shutdown / 换局要自己走一遍（见 `EnemySystem.shutdown()`）。
 */

import Phaser from 'phaser'
import { ActorModel, type ActorStats } from './ActorModel'
import type { ActorSnapshot } from './types'
import { textureKeyFor } from '../assets'
import { PLACEHOLDER_MISSING_KEY } from '../assetManifest'

export interface ActorSpawnOptions {
  x: number
  y: number
  /** 清单里的逻辑 key（不是 `__placeholder` 那个），内部会走 `textureKeyFor()` 解析 */
  textureKey: string
  /**
   * 速度硬上限（px/s）。默认 `3 × stats.speed`。
   *
   * 必须设：Arcade 的 `maxVelocity` 默认是 `(10000, 10000)`，分离力 + 击退叠起来
   * 能把敌人甩出房间。这个上限只做兜底，不参与正常移动。
   */
  speedCap?: number
  /** 撞墙停住。房间边界由 D2 提供，默认关闭 */
  collideWorldBounds?: boolean
}

/** 速度上限相对基础速度的倍数。够宽松，正常玩不会碰到。 */
const SPEED_CAP_MULT = 3

export class Actor<S extends string = string> extends Phaser.Physics.Arcade.Sprite {
  /**
   * `declare` 不能省。`tsconfig` 开了 `useDefineForClassFields: true`，
   * 写成普通字段声明会编译出 `Object.defineProperty(this, 'body', { value: undefined })`，
   * 把父类装好的 body **在构造期抹掉** —— 表现为 `this.body` 永远是 undefined，
   * 而且报错位置离真正的原因很远。子类化任何 Phaser 类时都要记住这条。
   */
  declare body: Phaser.Physics.Arcade.Body

  readonly model: ActorModel<S>

  /**
   * 物理世界引用。**在构造期抓一次**，因为 `this.scene` 的类型上没有 `.physics`，
   * 每次访问都转型既丑又慢。Actor 与场景同生共死，不需要考虑世界被替换。
   */
  private readonly physicsWorld: Phaser.Physics.Arcade.World

  /** 是否处于回池状态。`wake()` / `park()` 靠它做幂等。 */
  private _parked = true

  constructor(scene: Phaser.Scene, model: ActorModel<S>) {
    // 先给一个占位 texture key，`spawnAt()` 会用真实 key 覆盖。
    // 不能传一个不存在的 key —— Phaser 会当场警告并给绿黑格子。
    //
    // 用**常量**而不是把那个字符串再抄一遍：抄一遍的话，它就不再是「一个地方定义的
    // 东西」了，改名字时这一处会被漏掉，而漏掉的后果是「洋红方块变成绿黑格子」——
    // 一个没人会联想到「有人改了个常量名」的现象。
    super(scene, 0, 0, PLACEHOLDER_MISSING_KEY)

    this.model = model
    this.physicsWorld = scene.physics.world

    scene.add.existing(this)
    scene.physics.add.existing(this)

    this.setOrigin(0.5, 0.5)
    this.body.setBounce(0)
    this.body.setDrag(0, 0)
    this.body.setFriction(0, 0)
    this.setActive(false)
    this.setVisible(false)

    // ⚠️ 构造完必须把 body 从物理世界里摘掉，否则上面那句 `_parked = true` 是句假话。
    //
    // `scene.physics.add.existing(this)` 会把 body 加进 `world.bodies`、`enable = true`，
    // 位置停在 (0, 0)。那就是一个**真实存在的、可被命中的目标** ——
    // 池子造槽位（`createView`）与 `spawnAt()` 之间只要隔了任何一帧，
    // 一发流弹就会打在一个看不见的、半径 1 的 body 上，而且它还会出现在
    // `enemyGroup` 的 overlap 扫描里。没什么报错，只是「子弹偶尔凭空消失」。
    //
    // `spawnAt()` 里那句 `if (this._parked) physicsWorld.add(this.body)` 会把它装回来。
    this.physicsWorld.disableBody(this.body)
  }

  get parked(): boolean {
    return this._parked
  }

  /** 本实体是否正参与物理模拟。与 `model.alive` 不同：死亡过场里 body 可能还在。 */
  get simulating(): boolean {
    return !this._parked && this.body.enable
  }

  // ------------------------------------------------------------ 生命周期

  /**
   * 取出并放到 `(x, y)`。**从池里 spawn 走这里，不要走 `setActive` / `setPosition`。**
   *
   * 顺序是有讲究的，别调换：
   * 1. `setTexture` —— 换贴图会重置 frame，必须在算圆形 body 偏移之前做
   * 2. `setCircle` —— 偏移按**当前 frame 的原始像素**算（不受 scale 影响）
   * 3. `body.reset(x, y)` —— 顺带把 `prev` / `prevFrame` 对齐，避免出现「上一帧在十万八千里外」
   *    的插值鬼影；不 reset 的话第一次 `postUpdate` 会让 sprite 瞬移一大截
   * 4. `updateFromGameObject()` —— ⚠️ **必须补这一句**，见下面注释
   */
  spawnAt(opts: ActorSpawnOptions): void {
    const { x, y } = opts
    const radius = this.model.stats.radius

    this.setTexture(textureKeyFor(this.scene, opts.textureKey))
    this.applyCircleBody(radius)

    this.setActive(true)
    this.setVisible(true)
    this.setPosition(x, y)

    // sprite 级 enableBody 不会 world.add()，所以回池过的实体必须自己加回去
    if (this._parked) {
      this.physicsWorld.add(this.body)
      this._parked = false
    }
    this.body.enable = true

    this.body.reset(x, y)
    // ⚠️ `Body.reset()` 用 `gameObject.getTopLeft()` 定位，**完全不管 body.offset**。
    // 圆形 body 的 offset 是为了把圆从 frame 左上角挪到视觉中心，
    // 所以 reset 之后 body 的圆心和贴图中心是对不上的（半径 ≠ frame 一半时必然错位）。
    // 下一帧的 `preUpdate` 会自己纠正，但这一帧内任何读 `body.center` 的代码
    // （分裂子体取父体位置、分离力、调试绘制）都会读到错的。
    // `updateFromGameObject()` 是 `preUpdate` 内部用的同一个函数，这里显式补一次。
    // （`components/Enable.js` L134 也是这么干的。）
    this.body.updateFromGameObject()

    this.body.setMaxVelocity(opts.speedCap ?? this.model.stats.speed * SPEED_CAP_MULT)
    this.body.setCollideWorldBounds(opts.collideWorldBounds ?? false)
    this.body.stop()

    this.model.alive = true
  }

  /**
   * 回池。调用方**必须先 `ledger.releaseTarget(model)`**（伤害账本不变式 ④），
   * 否则这个 id 的 tick 会结算到复用同一槽位的下一个实体身上。
   * 顺序放在 `EnemySystem.despawn()` 里统一保证。
   */
  park(): void {
    if (this._parked) return

    this.body.stop()
    // 必须 world 级：sprite 级的那个只改 enable，尸体会留在 RTree 里继续参与碰撞
    this.physicsWorld.disableBody(this.body)

    this.model.despawn()
    this._parked = true
    this.setActive(false)
    this.setVisible(false)
  }

  /** 彻底销毁（场景 shutdown 用）。回池请用 `park()`。 */
  override destroy(fromScene?: boolean): void {
    if (!this._parked && this.body) {
      this.physicsWorld.disableBody(this.body)
    }
    this._parked = true
    super.destroy(fromScene)
  }

  // ------------------------------------------------------------ 每步同步

  /**
   * 每个物理步调一次：把 body 的位置/速度**回读**进快照。
   *
   * 传入 `out` 是为了让调用方复用同一个对象 —— 200 个敌人 × 60fps 全在分配小对象的话
   * GC 会在最需要帧率的时刻插一脚。**brain 不许把这个对象存起来**，它下一步就被覆写了。
   */
  writeSnapshot(out: ActorSnapshot): ActorSnapshot {
    const body = this.body
    out.id = this.model.id
    out.kind = this.model.kind
    // circle body 的 center 就是圆心；sprite 的 x/y 也一样（origin 0.5）。
    // 用 body.center 而不是 this.x，因为 body 是积分真值（postUpdate 才把位移写回 sprite）。
    out.x = body.center.x
    out.y = body.center.y
    out.vx = body.velocity.x
    out.vy = body.velocity.y
    out.radius = this.model.stats.radius
    out.hp = this.model.hp
    out.maxHp = this.model.maxHp
    out.alive = this.model.alive
    out.state = this.model.state
    return out
  }

  /** 分配一份新快照。测试与冷路径用；热路径请用 `writeSnapshot()`。 */
  snapshot(): ActorSnapshot {
    return this.writeSnapshot({
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
    })
  }

  /**
   * 把 model 里的 `velIntent` 写进 body。
   *
   * **每步都要调**，即使意图是 0：不写的话上一帧的 velocity 会一直生效
   * （Arcade 不做自动减速，`drag` 我们也设成 0 了）。
   */
  applyVelocityIntent(): void {
    const v = this.model.velIntent
    this.body.setVelocity(v.x, v.y)
  }

  /** 按 y 排序渲染层级（俯视角里「靠下的挡住靠上的」）。每帧调一次即可。 */
  updateDepth(): void {
    this.setDepth(this.y)
  }

  // ------------------------------------------------------------ 内部

  /**
   * 把碰撞体设成半径 `radius` 的圆，并**居中到贴图中心**。
   *
   * 偏移量必须用 **frame 的原始像素**（`realWidth` / `realHeight`），不是 `this.width` ——
   * 后者含 scale，而 `Body.offset` 是按纹理空间解释的
   * （`updateFromGameObject()` 里是 `scaleX * (offset.x - displayOriginX)`）。
   * 用 `this.width` 在有缩放的实体上会算错，而且只在缩放时才错，很难查。
   */
  private applyCircleBody(radius: number): void {
    const frame = this.frame
    const fw = frame.realWidth
    const fh = frame.realHeight
    // 圆是内切在贴图里的：半径为 r 的圆，左上角在 (w/2 - r, h/2 - r) 处居中
    this.body.setCircle(radius, fw / 2 - radius, fh / 2 - radius)
  }
}

/** 便利构造：给一个 model 造一个已就位或已回池的 Actor。 */
export function createActor<S extends string>(
  scene: Phaser.Scene,
  model: ActorModel<S>,
): Actor<S> {
  return new Actor<S>(scene, model)
}

export type { ActorStats }