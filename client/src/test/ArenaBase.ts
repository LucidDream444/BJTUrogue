/**
 * 白箱测试场的公共底座。**加一个测试场不需要碰这个文件** —— 抄 `arenas/_ArenaTemplate.ts`。
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

/** 一堵墙。`nav` 网格由它生成，物理碰撞体也由它生成。 */
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

export interface ArenaConfig {
  /** 场上没有别人时的初始刷怪 */
  spawns?: ArenaSpawnSpec[]
  walls?: WallSpec[]
  /** 假玩家的移动速度（px/s），默认取 `baseline.player.speed` */
  playerSpeed?: number
  /** 开局给玩家一点无敌时间，省得一进场就被围死。默认 0（测试场就是要挨打） */
  spawnGraceMs?: number
  /** 难度。默认 `normal` */
  difficulty?: Difficulty
  /** 固定随机种子 */
  rngSeed?: number
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
  scene: new () => ArenaBase
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
  /** 墙的**数据**（不是显示对象）。撒点与寻路网格都读它 */
  private wallSpecs: WallSpec[] = []
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
    this.clock = new GameClock()
    this.bus = new TypedBus<GameEvents>()
    this.bundle = parseConfigBundle({
      balance: readCachedConfig(this, 'balance.json'),
      difficulty: readCachedConfig(this, 'difficulty.json'),
      enemies: readCachedConfig(this, 'enemies.json'),
    })
    this.hud = new Hud(this)

    this.drawBackground(cfg.walls ?? [])

    this.player = new DummyPlayer({
      scene: this,
      x: WORLD_WIDTH / 2,
      y: WORLD_HEIGHT / 2,
      radius: this.bundle.balance.baseline.player.radius,
      maxHp: this.bundle.balance.baseline.player.maxHp,
      speed: cfg.playerSpeed ?? this.bundle.balance.baseline.player.speed,
      worldWidth: WORLD_WIDTH,
      worldHeight: WORLD_HEIGHT,
    })

    this.enemies = new EnemySystem({
      scene: this,
      bus: this.bus,
      clock: this.clock,
      bundle: this.bundle,
      difficulty: cfg.difficulty ?? 'normal',
      player: () => this.player.view(),
      nav: this.makeNav(cfg),
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
      world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
      tune,
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
    this.gun.update()
    this.juice.update(delta)
    this.hud.update(delta)

    this.onArenaUpdate(delta, this.ctx)
  }

  // ------------------------------------------------------------ 内部

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
    kb.addCapture(['SPACE', 'ZERO', 'R', 'I', 'ESC'])

    kb.on('keydown-SPACE', () => this.togglePause())
    kb.on('keydown-ZERO', () => this.enemies.killAll())
    kb.on('keydown-R', () => this.scene.restart())
    kb.on('keydown-I', () => {
      this.player.setInvulnerable(!this.player.isInvulnerable)
      this.hud.setNotice(this.player.isInvulnerable ? '无敌 ON' : '无敌 OFF')
    })
    kb.on('keydown-ESC', () => this.scene.start(MENU_SCENE_KEY))
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
    this.wallSpecs = []
    this.started = false
  }

  private drawBackground(walls: WallSpec[]): void {
    const g = this.add.graphics()
    g.fillStyle(0x0b0b10, 1)
    g.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT)
    // 网格：纯装饰，但它是「白箱」的一部分 —— 没有网格就看不出怪在不在动。
    g.lineStyle(1, 0x1e1e2a, 1)
    for (let x = 0; x <= WORLD_WIDTH; x += GRID_SIZE) g.lineBetween(x, 0, x, WORLD_HEIGHT)
    for (let y = 0; y <= WORLD_HEIGHT; y += GRID_SIZE) g.lineBetween(0, y, WORLD_WIDTH, y)
    g.setDepth(-100)

    this.wallSpecs = walls
    for (const w of walls) {
      const rect = this.add.rectangle(w.x, w.y, w.width, w.height, 0x3a3a4a)
      rect.setStrokeStyle(2, 0x6a6a80)
      rect.setDepth(-50)
      this.walls.push(rect)
      // 物理体：怪撞墙会被挡住。**注意这里不加碰撞体到敌人身上** ——
      // 敌人靠 nav 网格自己绕，撞墙只是兜底。加 collider 会让 200 只怪时
      // 每次分离力都触发一次碰撞解算，纯粹的性能负担。
    }
  }

  private makeNav(cfg: ArenaConfig): EnemySystemNavOptions | undefined {
    const walls = cfg.walls ?? []
    if (walls.length === 0) return undefined // 没有墙 = 不建 BFS 场，省一份纯浪费的开销

    const cellSize = GRID_SIZE * 2 // 80px 一格：够粗，BFS 才快；够细，绕得过 40px 的格子
    const cols = Math.ceil(WORLD_WIDTH / cellSize)
    const rows = Math.ceil(WORLD_HEIGHT / cellSize)

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
   * 场上随机一点。**避开墙**，否则怪会直接生在墙里然后卡一辈子。
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
      const x = Phaser.Math.Between(pad, WORLD_WIDTH - pad)
      const y = Phaser.Math.Between(pad, WORLD_HEIGHT - pad)
      if (!this.insideAnyWall(x, y, 20)) return { x, y }
    }
    return { x: WORLD_WIDTH / 2, y: 80 }
  }

  /** 点 `(x, y)` 周围 `slack` 的方框是否与任何一堵墙相交 */
  private insideAnyWall(x: number, y: number, slack: number): boolean {
    for (const w of this.wallSpecs) {
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