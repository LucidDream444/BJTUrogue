/**
 * 白箱测试场的公共底座。**加一个测试场不需要碰这个文件** —— 抄 `arenas/_ArenaTemplate.ts`
 * 放进 `arenas/<你的域>/`（一人一个文件夹，见 `AGENTS.md` §五）。
 *
 * 它负责每个场子都要的那一坨：世界、网格底、假玩家、敌人系统、打击感、调试枪、HUD。
 * 场子自己只需要回答三个问题：
 *
 * | 你要写的 | 回答什么 |
 * |---|---|
 * | `configure()` | 世界多大、有没有墙、开局刷什么 |
 * | `onArenaCreate(ctx)` | 还需要什么东西（可选） |
 * | `onArenaUpdate(dtMs, ctx)` | 每帧要额外干什么（可选，比如持续刷怪） |
 *
 * ---
 *
 * ## 这里的「玩家」不是玩家角色
 *
 * 《人员分工方案》里玩家角色归 D1。测试场需要的是一个**假目标**：
 * 一个白色方块 + 一个满足 `TickTarget` 的伤害模型，够敌人追、够肉盾砸、够挨打就行。
 * 见 `DummyPlayer.ts`。**不要把这里的任何东西搬进产品代码** ——
 * 它的命中判定是「圆 vs 圆」，而真玩家的受伤、无敌帧、击退全归 D1。
 *
 * ## ⚠️ 测试场必须要有一个「活着的东西」挂在物理世界里
 *
 * `World.update()` 第一句是 `if (isPaused || bodies.size === 0) return`。
 * 把敌人全清掉之后，如果场上连一个 body 都没有，`WORLD_STEP` 就不再触发，
 * 敌人系统会**静默假死**（见 `EnemySystem.ts` 文件头）。
 * 所以假玩家的 body 一定要在物理世界里（这里是 `add.existing`，永不摘除），
 * **而且这个 body 必须始终 enable** —— 哪怕你想做一个「空场子」。
 */

import Phaser from 'phaser'
import { GameClock } from '@/core/time'
import { TypedBus, type GameEvents, type EnemyKind } from '@/core/events'
import {
  CONFIG_FILE_NAMES,
  configUrl,
  parseConfigBundle,
  type ConfigBundle,
  type ConfigFileName,
  type Difficulty,
} from '@/core/config'
import { preloadAssets, ensurePlaceholderTextures, registerAnimations } from '@/core/assets'
import { EnemySystem, type EnemySystemNavOptions } from '@/domains/enemies/EnemySystem'
import { JuiceDirector } from '@/domains/enemies/presentation/JuiceDirector'
import { DummyPlayer } from './DummyPlayer'
import { DebugGun } from './DebugGun'
import { Hud } from './Hud'
import { MENU_SCENE_KEY } from './arenaCatalog'

/** 固定世界尺寸。**不跟随相机** —— 测试场要的是确定的坐标系，不是好看的运镜。 */
export const WORLD_WIDTH = 1280
export const WORLD_HEIGHT = 720

/** 一格多少 px。网格底纯装饰，但这个值也用来画墙 */
export const GRID_SIZE = 40

/**
 * 调试枪挥砍的判定半径。**调试设施的常数，不是平衡数值**（见 `tune()` 里的说明）。
 * 它比肉盾的半径大，所以调试枪砍得到肉盾身上 —— 那是它唯一的取舍依据。
 */
export const DEBUG_MELEE_REACH = 64

/**
 * 门洞挡板的样子。**纯装饰，不参与判定**（判定看 `body.enable`）。
 *
 * 开着的时候只描一圈绿边：门洞本来就是墙上的一个缺口，不描的话，
 * 「这儿有扇门」在画面上和「这段墙漏了一块」长得**一模一样** ——
 * 而后者看起来像生成器漏了墙。关上时填成红的，一眼能看出现在过不去。
 */
const DOOR_OPEN_STROKE = 0x44dd88
const DOOR_SHUT_STROKE = 0xff4466
const DOOR_SHUT_FILL = 0xff4466
/** 画在底座的灰墙（−50）之上、角色（0）之下 —— 压在墙上才看得见。 */
const DOOR_DEPTH = -45

/**
 * 一块矩形。`x` / `y` 是**中心点**（与 `Rect` 同一约定，见 `procgen/model/rect.ts`）。
 *
 * ⚠️ **它本身既不是「墙」也不是「碰撞体」，是一种几何数据** —— 传进哪个字段
 * 才决定它有什么行为：
 *
 * | 字段 | 画出来 | 进寻路网格 | 挡人 | 挡怪 | 挡子弹 |
 * |---|---|---|---|---|---|
 * | `ArenaConfig.walls` | ✅ 灰方块 | ✅ | ❌ | ❌（网格绕） | ❌ |
 * | `collision.solids` | ❌ | ❌ | ✅ | ✅ | ❌ |
 * | `collision.bulletStoppers` | ❌ | ❌ | ❌ | ❌ | ✅ |
 * | `collision.barriers` | ✅ 绿框 / 红块 | ❌ | 关着时 | 关着时 | 关着时 |
 *
 * 同一样东西**同时**进 `walls` 和 `collision.solids` 是正常的，D2 的场子就是这么干的
 * ——「看得见」「寻路绕开」「撞上去会停」本来就是三件事，各配各的。
 *
 * ⚠️ **`挡怪` 那一列与「寻路网格」那一列是两套机制，别当成一回事。**
 * `walls` 里的东西怪不撞（没有碰撞体），但会**绕着走**（进了网格）；
 * `collision.solids` 里的东西怪撞得住，但**不会绕**（没进网格，只在原地磨）。
 * 两边都想要的，就两处都填 —— 产品里这两件事是一致的（产品的网格吃障碍物），
 * 测试场里不是（`makeNav` 只吃 `walls`）。
 */
export interface WallSpec {
  x: number
  y: number
  width: number
  height: number
}

export interface ArenaSpawnSpec {
  kind: EnemyKind
  gen: number
  count: number
  /** 不填就随机撒在场上（避开墙） */
  x?: number
  y?: number
}

/**
 * **碰撞几何**：交给底座，让它变成真的物理体。
 *
 * 这三个列表就是 D2 的 `collidersOf()` 交出来的那三个（`@/domains/procgen/colliders`），
 * **名字故意一模一样** ——「哪一块该挡什么」是在生成那一侧算好的，
 * 底座不再自己判断一次。各判一次的话，「椅子挡人不挡弹」这种分岔会分头漂移。
 *
 * ⚠️ **不填 = 一个物理体都不造。** 这是故意的：`walls` 被好几个场子用着，
 * 让它突然长出碰撞体会**改掉别人的场子**。想挡人就在这里显式说一遍。
 *
 * ⚠️ **椅子不许进 `bulletStoppers`**（椅子挡人不挡弹）。判断在 D2 那边做，
 * 这里只负责把列表搬过来 —— 搬错了不会报错，只会「子弹在椅子前面停住」。
 */
export interface ArenaCollision {
  /** 挡移动的（墙 + 课桌 + 椅子）。**给玩家，不给怪** —— 怪吃的是寻路网格 */
  solids?: WallSpec[]
  /** 挡子弹的（墙 + 课桌）。**椅子不在里面** */
  bulletStoppers?: WallSpec[]
  /**
   * 门洞挡板，一块 = 一扇门。**造出来时全是开着的**。
   *
   * 底座只负责「造出来 + 能开关」，**什么时候关是玩法**（进房关门、清完开门），
   * 那是 D1 的场景逻辑。开关见 `DoorBarrierControl`。
   */
  barriers?: WallSpec[]
}

export interface ArenaConfig {
  /** 场上没有别人时的初始刷怪 */
  spawns?: ArenaSpawnSpec[]
  /** 墙：**画出来 + 进寻路网格**。不挡人 —— 要挡人放进 `collision.solids` */
  walls?: WallSpec[]
  /** 碰撞几何。**不填 = 一个物理体都不造**，见 `ArenaCollision` */
  collision?: ArenaCollision
  /**
   * 这一场的**活动范围**（世界坐标，左上角恒在原点）。默认 `1280×720`。
   *
   * ## 为什么它是个可选项，而不是直接写死世界尺寸
   *
   * 底座原来把这个范围钉死在 1280×720，而它在两处是**硬的**，不是审美问题：
   *
   * | 用在哪 | 钉死的后果 |
   * |---|---|
   * | `DummyPlayer` 的四条夹子 | 玩家**出不去**第一屏：`sprite.x` 被夹在 `[r, 1278]`，而物理体每帧从 `GameObject` 同步（`Body.preUpdate → updateFromGameObject`），所以夹的是位置本身 |
   * | `makeNav()` 的网格行列数 | 网格外的格一律 `isWalkable = false`，于是 x > 1280 的地方**怪一律认为不可走** |
   *
   * 前两条的症状都是**没有报错**：玩家贴着看不见的边停住、怪站在几千像素外不动。
   * 整层的场子（`d2_room_flow`：种子 837 就有 7560×880）必须能在地图坐标里跑，
   * 否则镜头推不过连廊、门挡板的下标也对不上全层那一份。
   *
   * ## 为什么默认值仍然是 1280×720
   *
   * **不填的场子行为一个字都不变** —— 这条是这次改动的全部约束。
   * 已开工的场子（D1/D3/D4）都没有这个字段，走的还是原来那条路。
   */
  field?: { width: number; height: number }
  /**
   * 假玩家的出生点。默认是世界正中心。
   *
   * ⚠️ 造了碰撞体之后，正中心**有可能正好落在一张课桌或一段墙里**
   * （生成器摆桌子时不知道底座把出生点钉在那儿）—— 那时要显式给一个空位，
   * 否则玩家一进场就卡在桌子里，而那看起来和「碰撞坏了」一模一样。
   */
  playerSpawn?: { x: number; y: number }
  /** 假玩家的移动速度（px/s），默认取 `baseline.player.speed` */
  playerSpeed?: number
  /** 开局给玩家一点无敌时间，省得一进场就被围死。默认 0（测试场就是要挨打） */
  spawnGraceMs?: number
  /** 难度。默认 `normal` */
  difficulty?: Difficulty
  /** 固定随机种子 */
  rngSeed?: number
}

/**
 * 门洞挡板的开关。**底座只提供「怎么开关」，不决定「什么时候关」。**
 *
 * 关 = 让那块静态体上场，开 = `body.enable = false` —— **是同一块体在翻转，
 * 不是造一块拆一块**。源码核实过：`World.collideSpriteVsGroup` 的两条路径
 * （静态树那条、遍历 `getChildren()` 那条）都跳过 `!bodyB.enable` 的体，
 * 所以停用是引擎支持的开关方式，不必重建。
 *
 * ⚠️ 热键 `E` 绑的是 `setAllClosed()`。**产品里不许这么干** ——
 * 一间房的门该开着还是关着，取决于「这一间有没有清完」，那是 D1 按 `room.order`
 * 逐个判的，`setClosedAt(i, …)` 才是那条路上的形状。
 */
export interface DoorBarrierControl {
  /** 几扇门（= 几个洞）。**同一个洞只算一块** —— 见 `colliders.ts` 的 ⚠️ */
  readonly count: number
  setAllClosed(closed: boolean): void
  allClosed(): boolean
  setClosedAt(index: number, closed: boolean): void
  isClosedAt(index: number): boolean
}

/** 碰撞体造完之后，场子能问到的东西。**没造碰撞体时两个数都是 0、`doors` 是 `null`。** */
export interface ArenaColliderInfo {
  /**
   * 挡人的静态体个数。
   * ⚠️ 是**几何块数**，不是「地图上有几段墙」—— 墙、课桌、椅子各算一块。
   */
  readonly solidCount: number
  /** 挡子弹的静态体个数。**比 `solidCount` 少的那些就是椅子** */
  readonly bulletStopperCount: number
  /** 门洞挡板。这一场没有门就是 `null` —— 不是「一个关不动的空控制器」 */
  readonly doors: DoorBarrierControl | null
}

/** 交给场子的那包东西。`onArenaCreate` / `onArenaUpdate` 都收它。 */
export interface ArenaContext {
  scene: Phaser.Scene
  enemies: EnemySystem
  bus: TypedBus<GameEvents>
  clock: GameClock
  bundle: ConfigBundle
  gun: DebugGun
  player: DummyPlayer
  hud: Hud
  world: { width: number; height: number }
  /** 从配置里读出来的常用数值，省得每个场子都 `bundle.baseline.bullet.damage` 一遍 */
  tune: ArenaTune
  /** 造出来的碰撞体。这一场没配 `collision` 时是个全 0 的空读数 */
  colliders: ArenaColliderInfo
}

/** 场子会用到的那几个配置读数。**全部来自配置表，没有一个是写死的**。 */
export interface ArenaTune {
  bulletDamage: number
  bulletSpeed: number
  bulletRadius: number
  fireIntervalMs: number
  playerSpeed: number
  playerRadius: number
  playerMaxHp: number
  /** 肉盾的穿透 tick 伤害（D1 本来要从 `EnemySystem.tankPierceTickDamage` 取） */
  tankPierceTickDamage: number
  tankBulletMaxTicks: number
  /** 普通敌人的接触伤害用不到（那是敌人打玩家），这里只留近战 */
  meleeDamage: number
  meleeRange: number
  meleeTickMs: number
}

/**
 * 一个测试场的定义。**只有 `registry.ts` 会读它，场子自己不需要 import 任何东西来注册。**
 */
export interface ArenaDefinition {
  /** 菜单里显示的名字 */
  displayName: string
  /** 一句话说明：这个场子是干什么的、该看什么 */
  description: string
  scene: new () => Phaser.Scene
}

/** 一块门洞挡板的运行时状态：物理体 + 它的样子。**开关只翻 `body.enable`。** */
interface DoorRuntime {
  readonly body: Phaser.Physics.Arcade.StaticBody
  readonly vis: Phaser.GameObjects.Rectangle
  closed: boolean
}

export abstract class ArenaBase extends Phaser.Scene {
  protected clock!: GameClock
  protected bus!: TypedBus<GameEvents>
  protected bundle!: ConfigBundle
  protected enemies!: EnemySystem
  protected juice!: JuiceDirector
  protected gun!: DebugGun
  protected player!: DummyPlayer
  protected hud!: Hud
  protected ctx!: ArenaContext

  private walls: Phaser.GameObjects.Rectangle[] = []
  /**
   * **所有挡人的几何**（墙 + 桌椅 + 门挡板），撒点要躲开的东西。
   *
   * 与 `cfg.walls` **不是一回事**：`cfg.walls` 是「画出来 + 进寻路网格」的那一份，
   * 这里多的是「只挡人、不画也不进网格」的桌椅。撒点读的是这一份。
   */
  private blockingSpecs: WallSpec[] = []
  private solidGroup: Phaser.Physics.Arcade.StaticGroup | null = null
  private bulletGroup: Phaser.Physics.Arcade.StaticGroup | null = null
  /** 造出来的碰撞几何相关的所有 GameObject（Zone 与挡板的样子），拆场景时逐个销毁 */
  private colliderObjects: Phaser.GameObjects.GameObject[] = []
  private doorRuntimes: DoorRuntime[] = []
  private colliderInfo: ArenaColliderInfo = { solidCount: 0, bulletStopperCount: 0, doors: null }
  /**
   * 这一场的活动范围。**`configure()` 之后定下来，之后只读** ——
   * 见 `ArenaConfig.field`：整层的场子要靠它才能在地图坐标里跑。
   */
  private field: { width: number; height: number } = { width: WORLD_WIDTH, height: WORLD_HEIGHT }
  private started = false

  /** 场子的元信息。**子类必须给**，`registry.test.ts` 会检查它存在。 */
  protected abstract get definition(): ArenaDefinition

  /** 场子回答：世界多大、有没有墙、开局刷什么。**在 `create()` 里被调一次。** */
  protected abstract configure(): ArenaConfig

  /** 可选：还需要别的东西。此时 `ctx` 已经就绪，可以刷怪、可以订阅事件。 */
  protected onArenaCreate(_ctx: ArenaContext): void {}

  /** 可选：每帧多干点什么（持续刷怪、给玩家加血、统计）。**在 `update()` 末尾调。** */
  protected onArenaUpdate(_dtMs: number, _ctx: ArenaContext): void {}

  // ------------------------------------------------------------ 生命周期

  preload(): void {
    // 占位期：清单里全是 placeholder，所以这里不下载任何文件，
    // 但真美术到位后这一句就会自动开始加载 —— 测试场不用改。
    preloadAssets(this)

    // 配置表走 **Phaser 的 loader**，在 `preload` 里异步取。
    // 场景生命周期保证了 `create()` 一定在所有加载完成之后才跑，
    // 所以 `create()` 里读 `cache.json` 是同步的、一定拿得到。
    //
    // ⚠️ 别改成 `import.meta.glob('../../public/config/*.json', { query: '?raw' })`。
    // 看起来更直接，但 `public/` 下的文件**不参与打包**，Vite 遇到指向它的
    // import 会**静默**换成空模块（只在终端打一行 warning，不报错），
    // 于是三份 JSON 全变成 `undefined`、`create()` 当场中断 ——
    // 表现是「进得去场子，但黑屏，一个东西都没有」。
    // 这条有架构测试守着（`architecture.test.ts` 的 public 守卫）。
    for (const name of CONFIG_FILE_NAMES) {
      this.load.json(name, configUrl(name))
    }
  }

  create(): void {
    // 场景建不起来的时候，**把原因画在屏幕上**（见 `showFatal`）。
    // 空白的画布和「配置文件写错了」在现场长得一模一样，
    // 而写测试场的人多半是别人的 AI —— 它看不见控制台。
    try {
      this.createArena()
    } catch (err) {
      this.showFatal(err)
    }
  }

  private createArena(): void {
    // 暂停状态挂在**场景级**的物理世界上。`R` 复位走的是 `scene.restart()`，
    // 万一那个世界被留给了下一个实例，这里不复位就会「一进去世界就是停的」。
    // 幂等且免费，所以无条件写一句。
    this.physics.world.resume()

    // ⚠️ 顺序：先造纹理，再造任何 Sprite。反过来会拿到 `__MISSING` 洋红方块。
    ensurePlaceholderTextures(this)
    registerAnimations(this)

    const cfg = this.configure()
    // ⚠️ 顺序：`field` 必须在 `drawBackground` / `DummyPlayer` / `makeNav` **之前**定下来
    // —— 那三处都读它。默认值与原来的写死值逐字相同，所以没填这个字段的场子行为不变。
    this.field = cfg.field ?? { width: WORLD_WIDTH, height: WORLD_HEIGHT }
    this.clock = new GameClock()
    this.bus = new TypedBus<GameEvents>()
    this.bundle = parseConfigBundle({
      balance: readCachedConfig(this, 'balance.json'),
      difficulty: readCachedConfig(this, 'difficulty.json'),
      enemies: readCachedConfig(this, 'enemies.json'),
    })
    this.hud = new Hud(this)

    this.drawBackground(cfg.walls ?? [], this.field)

    this.player = new DummyPlayer({
      scene: this,
      x: cfg.playerSpawn?.x ?? this.field.width / 2,
      y: cfg.playerSpawn?.y ?? this.field.height / 2,
      radius: this.bundle.balance.baseline.player.radius,
      maxHp: this.bundle.balance.baseline.player.maxHp,
      speed: cfg.playerSpeed ?? this.bundle.balance.baseline.player.speed,
      worldWidth: this.field.width,
      worldHeight: this.field.height,
    })

    // ⚠️ 必须在 `new DebugGun(...)` **之前**：枪要拿到挡弹那一组才能接上。
    // 也必须在 `this.player` 之后：玩家接 collider 要用它的物理体。
    this.buildCollision(cfg)

    this.enemies = new EnemySystem({
      scene: this,
      bus: this.bus,
      clock: this.clock,
      bundle: this.bundle,
      difficulty: cfg.difficulty ?? 'normal',
      player: () => this.player.view(),
      nav: this.makeNav(cfg, this.field),
      rngSeed: cfg.rngSeed ?? 0xd3d3,
      hooks: {
        // 肉盾下砸 → 顿帧 + 震屏 + 音效。产品里由场景接线，测试场由底座接线。
        onSlam: (x, y, radius, hitstopMs) => this.juice.onSlam(x, y, radius, hitstopMs),
      },
    })
    // ⚠️ **不能漏。** 构造只建对象，`create()` 才把它挂到 `WORLD_STEP` 上。
    // 漏了它的现场长这样：场上空的、`queue` 里排着怪、AI 一次不跑、帧伤一次不结，
    // 而控制台一声不吭 —— 和「刷怪逻辑写错了」完全分不出来。
    // （曾经真漏过一次：`juice.create()` 和 `gun.create()` 都在，就这句不在。）
    this.enemies.create()

    // 怪 × 场景几何。**必须在 `new EnemySystem(...)` 之后**（要它的 `group`），
    // 见 `attachEnemyColliders()`。没配 `collision` 的场子里它什么都不做。
    this.attachEnemyColliders()

    this.juice = new JuiceDirector({
      scene: this,
      bus: this.bus,
      clock: this.clock,
      bundle: this.bundle,
      enemies: this.enemies,
    })
    this.juice.create()

    // 只算一次：`tune()` 是纯读配置，但算两次意味着「枪用的」和「场子看到的」
// 有可能来自不同的值 —— 现在不会，将来加个按难度改数值的分支就会。
    const tune = this.tune()

    this.gun = new DebugGun({
      scene: this,
      enemies: this.enemies,
      player: this.player,
      tune,
      clock: this.clock,
      // 这一场没造挡弹体时是 `null`，枪就只打怪 —— 见 `DebugGun` 的 `blockers`
      blockers: this.bulletGroup,
    })
    this.gun.create()

    this.ctx = {
      scene: this,
      enemies: this.enemies,
      bus: this.bus,
      clock: this.clock,
      bundle: this.bundle,
      gun: this.gun,
      player: this.player,
      hud: this.hud,
      world: this.field,
      tune,
      colliders: this.colliderInfo,
    }

    // HUD 的所有依赖这时才齐（它得先于它们建出来才能画在最上层）
    this.hud.bind({
      scene: this,
      enemies: this.enemies,
      clock: this.clock,
      player: this.player,
      gun: this.gun,
      juice: this.juice,
    })

    this.spawnInitial(cfg.spawns ?? [])
    if ((cfg.spawnGraceMs ?? 0) > 0) this.player.grantGrace(cfg.spawnGraceMs!)

    this.hud.setTitle(this.definition.displayName, this.definition.description)
    this.bindDebugKeys()
    this.onArenaCreate(this.ctx)

    // 场景重启（切场子）时必须拆干净，否则监听器与池子会叠加。
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown())

    this.started = true
  }

  override update(_time: number, delta: number): void {
    if (!this.started) return

    // ⚠️ 必须先 advance：帧号是「同帧去重」的唯一依据（见 `core/time.ts`），
    // 而物理步回调（WORLD_STEP）在 `scene.update()` **之前**就已经跑过了，
    // 读的是**上一帧**的帧号。这是引擎的顺序，不是 bug —— 见 `EnemySystem.ts` 文件头。
    this.clock.advance(delta)

    this.player.update(delta, this.gun.aimX, this.gun.aimY)
    // ⚠️ 世界冻着（我们自己的暂停 / 抓取定格）时**不许开火**：调试枪用 `realNowMs`
    // 判间隔、不看 `clock.paused`，于是冻结期间子弹会**原地堆在玩家脚下**，
    // 解冻的第一步就全部命中 —— 而抓取怪挣脱时只剩 1 血，正好被当场打死，
    // 「落地才死 → 落地爆炸」整条链静默消失。产品里的武器系统本来就尊重暂停，
    // 这条是给测试场补上同样的口径。
    if (!this.clock.paused) this.gun.update()
    this.juice.update(delta)
    this.hud.update(delta)

    this.onArenaUpdate(delta, this.ctx)
  }

  // ------------------------------------------------------------ 内部

  /**
   * 把 `cfg.collision` 变成真的物理体。**不配就一个都不造**（见 `ArenaCollision`）。
   *
   * ## 为什么用 `Zone` 当宿主
   *
   * `Zone` 是「有位置、有尺寸、什么都不渲染」的 GameObject，正好是碰撞体该长的样子：
   * `StaticBody` 的尺寸取自 `gameObject.displayWidth / displayHeight`
   * （`Zone` 自己带这两个属性，值 = 尺寸 × 缩放，源码已核实），位置取自 `x/y` 与原点。
   * 用 `Rectangle` + `setVisible(false)` 也行，但那会白白多一个渲染对象。
   *
   * ## ⚠️ 必须同时进 Group —— 否则判定被静默跳过
   *
   * `World.collideSpriteVsGroup` 走静态树那条路径时有一句
   * `if (… || !group.contains(bodyB.gameObject)) continue`：**体进了世界、
   * 没进组，判定一声不吭地不生效**。表现是「碰撞体造了，人照样穿过去」，
   * 而控制台什么都没有。所以这里每一个 Zone 都 `group.add()`。
   *
   * ## 玩家接在这里，怪在 `attachEnemyColliders()`
   *
   * 玩家那一条在下面直接接；怪那一条要等 `this.enemies` 建好，见那个方法
   * （以及它里面「挡住 ≠ 绕开」那一段 —— 那一句是读这一块最容易读错的地方）。
   *
   * ⚠️ 这里写的是**一次 `collider(组, 静态组)`**，不是给每只怪各接一条。
   * 静态体走的是 `staticTree`，**不每帧重建、永远全速搜索**；本项目同时在场的怪
   * 定位「数百量级」，离 §1 那个 5,000 动态体的量级余量还差一个数量级。
   * 早先那版注释拿「几百只怪逐个接会贵」当理由不接怪 —— **理由是错的，
   * 因为这里根本没有「逐个接」这种写法**，何况怪平时走的是寻路网格、
   * 真撞上静态体的机会本来就少。
   */
  private buildCollision(cfg: ArenaConfig): void {
    const c = cfg.collision
    if (!c) {
      this.colliderInfo = { solidCount: 0, bulletStopperCount: 0, doors: null }
      return
    }

    const solids = this.physics.add.staticGroup()
    const stoppers = this.physics.add.staticGroup()
    for (const spec of c.solids ?? []) solids.add(this.makeStaticZone(spec))
    for (const spec of c.bulletStoppers ?? []) stoppers.add(this.makeStaticZone(spec))

    // 门洞挡板：**同一块 Zone 同时进两个组**。开关只是一次 `enable` 翻转，
    // 两个组各看它一次，于是「挡人」和「挡子弹」永远同步 ——
    // 分成两块的话，总有一天只关了一半，而那看起来像「子弹穿得过关着的门」。
    this.doorRuntimes = (c.barriers ?? []).map((spec) => {
      const zone = this.makeStaticZone(spec)
      solids.add(zone)
      stoppers.add(zone)
      const rt: DoorRuntime = {
        body: zone.body as Phaser.Physics.Arcade.StaticBody,
        vis: this.add
          .rectangle(spec.x, spec.y, spec.width, spec.height)
          .setDepth(DOOR_DEPTH),
        closed: false,
      }
      this.colliderObjects.push(rt.vis)
      this.setDoorClosed(rt, false) // 造出来是**开着**的：没人在屋里的时候门不该是封的
      return rt
    })

    this.solidGroup = solids
    this.bulletGroup = stoppers
    this.physics.add.collider(this.player.gameObject, solids)
    // 怪那一侧**不在这里接**：`this.enemies` 这会儿还没建（它在 `buildCollision()`
    // 之后才 `new`）。怪 × solids 接在 `attachEnemyColliders()`，由 `createArena()`
    // 在 `enemies.create()` 之后调 —— 顺序写错的表现是「怪直接穿过课桌」，
    // 那和「碰撞几何没配对」长得一模一样。

    // 撒点也要躲开它们，否则持续刷怪的场子会把怪生进课桌里。
    // **墙也要补进来**：`drawBackground` 只收了 `cfg.walls`，桌椅是这里才到的。
    for (const spec of [...(c.solids ?? []), ...(c.barriers ?? [])]) {
      this.blockingSpecs.push(spec)
    }

    this.colliderInfo = {
      solidCount: solids.getLength(),
      bulletStopperCount: stoppers.getLength(),
      doors: this.makeDoorControl(),
    }
  }

  /**
   * **怪 × 场景几何**（墙、桌椅、关着的门）。玩家那一条在 `buildCollision()` 里，
   * 这一条必须等 `this.enemies` 建好才能接，所以单独一个方法。
   *
   * ## 为什么怪也要接：几何本来拦不住它们
   *
   * 以前怪那一侧**一条 `collider` 都没有** —— 位置只由 `body.velocity` 积分，
   * 撞上什么几何都直接穿过去。走位正常的时候看不出来（寻路网格本来就绕开了墙），
   * 露馅的是**课桌椅子**：它们压根不在网格里。
   *
   * 怪的位置既然是引擎按速度推出来的，给它们接上静态体之后就是**真的挡得住**，
   * 不是摆样子。
   *
   * ⚠️ **挡住 ≠ 绕开，这两件事必须分开说。** 怪往哪儿走是**寻路网格**说了算，
   * 而底座的 `makeNav()` 只吃 `cfg.walls` —— 桌椅压根没进过它的输入
   * （这是 D3 那边的待办，见 `d2_classroom.ts` 文件头那张表）。于是接上这一条之后：
   *
   * - 直冲课桌的怪会**顶着桌子原地磨**（引擎把速度沿着法线清掉，AI 下一步又把
   *   速度写回去），而不是像产品里那样绕过去；
   * - 那**不是**这一条接错了，是「物理说不许过、寻路说往前走」两边在打架 ——
   *   产品里两者一致（产品的网格是吃障碍物的），测试场里不一致。
   *
   * 所以这个接线在测试场里说的是「几何**挡得住**」，**不是**「怪会绕」。
   * 想看后者得先让 `makeNav` 看见障碍物。
   *
   * ## 关着的门连着怪一起挡
   *
   * 门挡板那块 `Zone` 同时进了 `solids`（见 `buildCollision`），所以 `E` 关门之后
   * 怪也过不去 —— 这正是产品要的（封门就是把人**和怪**关在一间里）。
   */
  private attachEnemyColliders(): void {
    // 没配 `collision` 的场子（旧场子、D3 的场子）`solidGroup` 是 null，
    // 这一条就什么都不做 —— **旧场子的行为一个字都不许变**。
    if (this.solidGroup === null) return
    this.physics.add.collider(this.enemies.group, this.solidGroup)
  }

  /** 一块静态碰撞体。**看得见的是 `Zone` 自己的空** —— 它不渲染，只站位置。 */
  private makeStaticZone(spec: WallSpec): Phaser.GameObjects.Zone {
    const zone = this.add.zone(spec.x, spec.y, spec.width, spec.height)
    // `true` = 静态体。尺寸与位置由构造时的 `displayWidth/displayHeight` 与原点推出，
    // 之后**不改** —— 改了要显式 `updateFromGameObject()`，而这里没人改。
    this.physics.add.existing(zone, true)
    this.colliderObjects.push(zone)
    return zone
  }

  /**
   * 门洞挡板的控制器。
   *
   * 闭包抓的是 `this.doorRuntimes` **这个数组本身**，而 `teardown()` 用的是
   * `length = 0`（原地清空）而不是换一个新数组 —— 换掉的话，场景关了之后
   * 手里还攥着旧 ctx 的场子会继续翻**已经销毁**的物理体。
   */
  private makeDoorControl(): DoorBarrierControl {
    const rts = this.doorRuntimes
    const apply = (index: number, closed: boolean): void => {
      const rt = rts[index]
      if (!rt) return
      this.setDoorClosed(rt, closed)
    }
    return {
      count: rts.length,
      setAllClosed: (closed) => {
        for (let i = 0; i < rts.length; i++) apply(i, closed)
      },
      // 空数组返回 `false`：一扇门都没有的时候，「门全关着」不是一句真话
      allClosed: () => rts.length > 0 && rts.every((r) => r.closed),
      setClosedAt: apply,
      isClosedAt: (index) => rts[index]?.closed ?? false,
    }
  }

  /** 关 = 这块静态体上场；开 = 停用它（引擎支持的开关方式，见 `DoorBarrierControl`）。 */
  private setDoorClosed(rt: DoorRuntime, closed: boolean): void {
    rt.closed = closed
    rt.body.enable = closed
    if (closed) {
      rt.vis.setFillStyle(DOOR_SHUT_FILL, 0.45).setStrokeStyle(2, DOOR_SHUT_STROKE, 1)
    } else {
      // 开着的时候**不填**：填了会挡住门洞里能看见的地板，看起来像一堵墙
      rt.vis.setFillStyle(DOOR_SHUT_FILL, 0).setStrokeStyle(2, DOOR_OPEN_STROKE, 0.9)
    }
  }

  /**
   * 场景没建起来时，**把原因画在屏幕上**，而不是留一块黑画布。
   *
   * 为什么值得这么写：黑画布是**最没有信息量的失败**——
   * 「配置表没加载上」「场子代码抛异常」「页面根本没加载对」
   * 在现场长得一模一样，而看的人多半是别人家的 AI 或队友，
   * 他们看不见浏览器控制台，只能看见「什么都没有」，然后开始猜。
   *
   * 所以：控制台留一份完整的，屏幕上留一份能直接读的。
   */
  private showFatal(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[test] 场景初始化失败：', err)

    const cx = WORLD_WIDTH / 2
    const cy = WORLD_HEIGHT / 2
    this.add
      .rectangle(cx, cy, WORLD_WIDTH, WORLD_HEIGHT, 0x1a0000)
      .setDepth(10_000)
      .setScrollFactor(0)
    this.add
      .text(cx, cy - 60, '测试场没能建起来', {
        fontFamily: 'monospace',
        fontSize: '32px',
        color: '#ff5555',
      })
      .setOrigin(0.5)
      .setDepth(10_001)
      .setScrollFactor(0)
    this.add
      .text(cx, cy + 10, message, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffbbbb',
        align: 'center',
        wordWrap: { width: WORLD_WIDTH - 160 },
      })
      .setOrigin(0.5)
      .setDepth(10_001)
      .setScrollFactor(0)
    this.add
      .text(cx, cy + 140, '控制台里有完整堆栈。改完刷新页面。', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#888888',
      })
      .setOrigin(0.5)
      .setDepth(10_001)
      .setScrollFactor(0)
  }

  /**
   * 每个场子都有的调试热键。
   *
   * 为什么放在底座而不是各场子自己绑：**这些键的意思是「观察方式」，不是「玩法」**。
   * 每个场子都该有暂停、清场、复位、无敌 —— 少一个的场子会让人在那里手动改代码。
   * 而且绑定方式统一了，就不会出现两个场子里同一个键干不同的事。
   *
   * 这里**不用手动退订**：场景的键盘插件在 `SHUTDOWN` 时会把监听器全部清掉
   * （`KeyboardPlugin.shutdown()` 里 `removeAllListeners`）。而这些键只在
   * 本场景存活期间有意义，所以场景自己的生命周期就是正确的退订时机。
   */
  private bindDebugKeys(): void {
    const kb = this.input.keyboard
    if (!kb) return

    // 空格默认会滚动页面；不捕获的话按一下整页就会往下跳。
    kb.addCapture(['SPACE', 'ZERO', 'R', 'I', 'E', 'ESC'])

    kb.on('keydown-SPACE', () => this.togglePause())
    kb.on('keydown-ZERO', () => this.enemies.killAll())
    kb.on('keydown-R', () => this.scene.restart())
    kb.on('keydown-I', () => {
      this.player.setInvulnerable(!this.player.isInvulnerable)
      this.hud.setNotice(this.player.isInvulnerable ? '无敌 ON' : '无敌 OFF')
    })
    kb.on('keydown-E', () => this.toggleDoors())
    kb.on('keydown-ESC', () => this.scene.start(MENU_SCENE_KEY))
  }

  /**
   * `E` 键：所有门洞挡板一起开关。**这是「能开关」的演示，不是玩法。**
   *
   * 产品里一间房的门该不该关，取决于「这一间有没有清完」—— 那是 D1 按
   * `DoorBarrierControl.setClosedAt(i, …)` 逐扇判的。底座这个键存在的理由只有一个：
   * **不开一次关一次就看不出来封门到底封没封住**，而「封不住」在现场的表现是
   * 「怪还是从门里进来」——和「门本来就是开的」长得一模一样。
   *
   * 没配挡板的场子按 `E` 会明说一句，而不是安静地什么都不发生：
   * 后者会让人以为「这个键坏了」，于是去查按键绑定。
   */
  private toggleDoors(): void {
    const doors = this.colliderInfo.doors
    if (!doors || doors.count === 0) {
      this.hud.setNotice('这一场没有门洞挡板（configure() 里没配 collision.barriers）')
      return
    }
    const closed = !doors.allClosed()
    doors.setAllClosed(closed)
    this.hud.setNotice(closed ? `关门：${doors.count} 扇全封上（再按 E 放开）` : `开门：${doors.count} 扇全放开`)
  }

  private togglePause(): void {
    if (this.clock.paused) {
      this.clock.resume()
      this.hud.setNotice('')
    } else {
      this.clock.pause()
      this.physics.world.pause()
      this.hud.setNotice('已暂停（空格继续）')
    }
  }

  private teardown(): void {
    this.juice?.shutdown()
    this.gun?.shutdown()
    this.enemies?.shutdown()
    this.hud?.destroy()
    // 退订全部总线监听。`TypedBus.clear()` 是最后一道：任何忘了保存退订函数的
    // 订阅者都会在这里被一起清掉（这也是它存在的意义）。
    this.bus?.clear()
    for (const w of this.walls) w.destroy()
    this.walls = []
    // `Zone` 与挡板的样子都在这里销毁。**顺带把静态体带走**：不过就算不销毁，
    // `ArcadePhysics` 在 `SHUTDOWN` 时也会清空 `staticTree`/`staticBodies`，
    // 所以这里图的是「场景重启后不留一个还在跑的显示对象」，不是防物理泄漏。
    for (const o of this.colliderObjects) o.destroy()
    this.colliderObjects = []
    this.solidGroup?.destroy()
    this.bulletGroup?.destroy()
    this.solidGroup = null
    this.bulletGroup = null
    // ⚠️ **原地清空**，不要 `= []` —— 换掉数组的话，手里还攥着旧 `ctx` 的
    // 场子会继续翻已经销毁的物理体（`makeDoorControl` 的闭包抓的是这个数组）。
    this.doorRuntimes.length = 0
    this.colliderInfo = { solidCount: 0, bulletStopperCount: 0, doors: null }
    this.blockingSpecs = []
    this.started = false
  }

  private drawBackground(walls: WallSpec[], field: { width: number; height: number }): void {
    const g = this.add.graphics()
    g.fillStyle(0x0b0b10, 1)
    g.fillRect(0, 0, field.width, field.height)
    // 网格：纯装饰，但它是「白箱」的一部分 —— 没有网格就看不出怪在不在动。
    // 铺满活动范围：整层的场子里，只铺左上角那一块会留下「没铺到的地方一片死黑」，
    // 而那片黑看起来像生成器少生成了一段地板。
    g.lineStyle(1, 0x1e1e2a, 1)
    for (let x = 0; x <= field.width; x += GRID_SIZE) g.lineBetween(x, 0, x, field.height)
    for (let y = 0; y <= field.height; y += GRID_SIZE) g.lineBetween(0, y, field.width, y)
    g.setDepth(-100)

    // 拷一份，不持有 `cfg.walls` 本身：`buildCollision` 之后还要往里加桌椅
    this.blockingSpecs = [...walls]
    for (const w of walls) {
      const rect = this.add.rectangle(w.x, w.y, w.width, w.height, 0x3a3a4a)
      rect.setStrokeStyle(2, 0x6a6a80)
      rect.setDepth(-50)
      this.walls.push(rect)
      // ⚠️ **这里不造任何物理体。** 灰方块是纯装饰 ——
      // 「看得见」「怪绕着走」「撞上去会停」是三件事，各配各的：
      // 寻路网格读 `cfg.walls`；「撞上去会停」要 `cfg.collision.solids` 显式说一遍
      // （见 `WallSpec` 那张表）。
      //
      // 顺手在这里补一个 body 看起来更省事，但那是**改别人的场子**：
      // 已经用了 `walls` 的场子（D3 的 `swarm_stress` 有一根柱子正好在
      // 世界正中心，也就是假玩家的出生点）会突然发现玩家卡在墙里。
    }
  }

  private makeNav(
    cfg: ArenaConfig,
    field: { width: number; height: number },
  ): EnemySystemNavOptions | undefined {
    const walls = cfg.walls ?? []
    if (walls.length === 0) return undefined // 没有墙 = 不建 BFS 场，省一份纯浪费的开销

    const cellSize = GRID_SIZE * 2 // 80px 一格：够粗，BFS 才快；够细，绕得过 40px 的格子
    // 网格铺满**整个活动范围**（见 `ArenaConfig.field`）。按画布尺寸铺的话，
    // 网格外的格一律 `isWalkable = false` —— 整层场子里那是「几千像素外的怪全都站在原地」，
    // 而这和「寻路坏了」在现场长得一模一样，只是它连一行报错都没有。
    const cols = Math.ceil(field.width / cellSize)
    const rows = Math.ceil(field.height / cellSize)

    // 把墙印进一张位图：**一格只有在它的中心点落在墙里时才算堵**。
    //
    // ⚠️ 不能写成「取墙的包围盒、把相交的格子全填上」。那样一格只要**碰到**墙的边
    // 就算堵，而 `FlowField` 的格子是 80px 的粗格 —— 一堵 80px 厚的墙会连它两侧
    // 各一格的**空地**一起封掉。症状是「一堵不挨着别的墙的墙，把地图切成两半，
    // 中间明明留了 160px 的缺口却没人过得去」。用中心点采样才和
    // `isWalkable()` 的语义一致：**「这一格的中心能不能站」**。
    const blocked = new Uint8Array(cols * rows)
    for (const w of walls) {
      const x0 = Math.max(0, Math.floor((w.x - w.width / 2) / cellSize))
      const x1 = Math.min(cols - 1, Math.floor((w.x + w.width / 2) / cellSize))
      const y0 = Math.max(0, Math.floor((w.y - w.height / 2) / cellSize))
      const y1 = Math.min(rows - 1, Math.floor((w.y + w.height / 2) / cellSize))
      for (let cy = y0; cy <= y1; cy++) {
        // 格子中心。与 `isWalkable` 用的是同一个换算（原点在 0）。
        const py = (cy + 0.5) * cellSize
        if (Math.abs(py - w.y) > w.height / 2) continue
        for (let cx = x0; cx <= x1; cx++) {
          const px = (cx + 0.5) * cellSize
          if (Math.abs(px - w.x) > w.width / 2) continue
          blocked[cy * cols + cx] = 1
        }
      }
    }

    // ⚠️ `originX/originY` 是网格的**最小角**，不是「格子中心的偏移」。
    // `FlowField` 的换算固定是 `index = floor((x - originX) / cellSize)`，
    // 格子中心 = `originX + (cx + 0.5) * cellSize`（源码已核实）。
    // 写成 `cellSize / 2` 的话整张寻路网格会平移半格 —— 症状是「怪贴着墙走」和
    // 「本该能过的门口过不去」，而且**只在有墙的场子里出现**。
    const origin = 0 // 网格最小角 = 世界原点。见上面的 ⚠️
    return {
      originX: origin,
      originY: origin,
      cellSize,
      cols,
      rows,
      isWalkable: (x: number, y: number) => {
        const cx = Math.floor((x - origin) / cellSize)
        const cy = Math.floor((y - origin) / cellSize)
        if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false
        return blocked[cy * cols + cx] === 0
      },
    }
  }

  private spawnInitial(spawns: ArenaSpawnSpec[]): void {
    for (const s of spawns) {
      // 只给 x 不给 y（或反过来）是**场子写错了**。当场抛比默默随机撒点好：
      // 后者会让「我明明设了坐标」的场子看起来只是「运气不好撒歪了」。
      if ((s.x === undefined) !== (s.y === undefined)) {
        throw new Error(`[test] 刷怪点要么 x/y 都给，要么都不给（${s.kind} 第 ${s.gen} 代）`)
      }
      for (let i = 0; i < s.count; i++) {
        const p = s.x === undefined ? this.randomPoint() : { x: s.x, y: s.y! }
        this.enemies.spawnNow(s.kind, s.gen, p.x, p.y)
      }
    }
  }

  /**
   * 场上随机一点。**避开挡人的东西**（墙、桌椅、门挡板），
   * 否则怪会直接生在桌子/墙里然后卡一辈子。
   * `protected`：持续刷怪的场子要能调它（自己按格子算坐标迟早会把怪生在柱子里，
   * 而「卡在柱子里的怪」看起来和「寻路坏了」一模一样）。
   *
   * ⚠️ 这里**不能**用 `physics.overlapRect()` 去问物理世界：装饰用的墙是
   * 没有 body 的 `Rectangle`（见 `drawBackground`），那个查询**永远返回空数组** ——
   * 于是这个「避开墙」的函数会安静地每次都返回墙里的点。
   * 直接对墙的矩形做包含判断才是对的，而且不依赖物理世界在那一刻的状态。
   */
  protected randomPoint(): { x: number; y: number } {
    const pad = 60
    for (let attempt = 0; attempt < 32; attempt++) {
      const x = Phaser.Math.Between(pad, this.field.width - pad)
      const y = Phaser.Math.Between(pad, this.field.height - pad)
      if (!this.insideAnyBlocker(x, y, 20)) return { x, y }
    }
    return { x: this.field.width / 2, y: 80 }
  }

  /**
   * 点 `(x, y)` 周围 `slack` 的方框是否与**任何挡人的东西**相交
   * （墙、桌椅、门挡板 —— 即 `blockingSpecs`，比 `cfg.walls` 多）。
   */
  private insideAnyBlocker(x: number, y: number, slack: number): boolean {
    for (const w of this.blockingSpecs) {
      if (
        Math.abs(x - w.x) < w.width / 2 + slack &&
        Math.abs(y - w.y) < w.height / 2 + slack
      ) {
        return true
      }
    }
    return false
  }

  private tune(): ArenaTune {
    const b = this.bundle.balance.baseline
    return {
      bulletDamage: b.bullet.damage,
      bulletSpeed: b.bullet.speed,
      bulletRadius: b.bullet.radius,
      fireIntervalMs: b.bullet.fireIntervalMs,
      playerSpeed: b.player.speed,
      playerRadius: b.player.radius,
      playerMaxHp: b.player.maxHp,
      tankPierceTickDamage: this.enemies.tankPierceTickDamage,
      tankBulletMaxTicks: this.bundle.enemies.enemies.tank.frameDamage.bullet.maxTicksPerSource,
      // 近战没有独立的配置表（那是 D1 的武器表，还没起草）。测试场里用
      // 「一颗子弹的伤害 + 半个身位」当近似，**只是为了能压住肉盾的血线**，
      // 不代表任何设计意图。
      meleeDamage: b.bullet.damage,
      // ⚠️ 这一条**是调试设施的常数，不是平衡数值**，所以它留在这里而不是进配置表。
      // 近战范围的正主是 D1 的武器表（还没起草）。取 64 的理由只有一个：
      // 它比肉盾的半径大，调试枪才砍得到肉盾身上（肉盾半径见 enemies.json）。
      // 真武器接上之后这个值就该被删掉，而不是「对齐成一样」。
      meleeRange: DEBUG_MELEE_REACH,
      meleeTickMs: this.bundle.balance.frameDamage.tickMs,
    }
  }
}

/** 从 Phaser 的缓存里取一份配置表。**取不到就是真的没加载上**，当场抛。 */
function readCachedConfig(scene: Phaser.Scene, name: ConfigFileName): unknown {
  if (!scene.cache.json.exists(name)) {
    throw new Error(
      `配置表 ${name} 没加载上（preload 里 load.json 失败了）。\n` +
        `如果是从 file:// 直接双击打开 html —— 那条路取不到 public/ 下的文件，` +
        `请走 npm run dev 或任意静态服务器。`,
    )
  }
  return scene.cache.json.get(name)
}