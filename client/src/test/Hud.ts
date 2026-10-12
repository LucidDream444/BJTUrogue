/**
 * 测试场的抬头显示。**白箱的一部分** —— 没有它，「怪在动但看不出对不对」。
 *
 * 全部是 `Text`，没有图片、没有字体资源（用系统字体，`fontFamily` 里写中文优先）。
 *
 * 为什么读数是这些而不是别的：**它们是几个「坏掉时看不出来」的量的直接读数。**
 *
 * | 读数 | 它坏掉的样子 |
 * |---|---|
 * | `fps` | 掉帧会让一帧内的补步变多 —— 帧伤次数、AI 次数都会跟着变 |
 * | `alive` / `ai near/far` | 降频逻辑坏掉的话，远处那群怪的 AI 会全在跑（或全不跑） |
 * | `frameId` | **不涨 = 物理世界空了**（`WORLD_STEP` 不再触发，见 `EnemySystem` 文件头） |
 * | `world bodies/steps` | `bodies` 是 0 或世界被暂停 = 同上，但这两行能区分是哪一种 |
 * | `moving` | **小于 `alive` 就是有怪不动**；一只都不动 = 速度意图没落到物理体上 |
 * | `ledger pairs` | 只涨不落 = 有人忘了 `releaseBullet()` |
 * | `freezeMs` | 顿帧没结束就恢复 = 表现层配对写错了 |
 */

import Phaser from 'phaser'
import type { EnemySystem } from '@/domains/enemies/EnemySystem'
import type { JuiceDirector } from '@/domains/enemies/presentation/JuiceDirector'
import type { GameClock } from '@/core/time'
import type { DummyPlayer } from './DummyPlayer'
import type { DebugGun } from './DebugGun'

/** 面板的右上角内边距 */
const PAD = 8
/** 行高 */
const LINE = 15

export class Hud {
  private readonly lines: Phaser.GameObjects.Text
  private readonly title: Phaser.GameObjects.Text
  private readonly hint: Phaser.GameObjects.Text
  /** 临时提示（暂停 / 无敌 …）。平时是空的 */
  private readonly notice: Phaser.GameObjects.Text

  private enemies: EnemySystem | null = null
  private clock: GameClock | null = null
  private player: DummyPlayer | null = null
  private gun: DebugGun | null = null
  private juice: JuiceDirector | null = null
  private scene: Phaser.Scene | null = null

  private accMs = 0
  private fps = 0

  constructor(scene: Phaser.Scene) {
    this.title = scene.add
      .text(PAD, PAD, '', { fontFamily: 'monospace', fontSize: '15px', color: '#ffffff' })
      .setDepth(1000)
      .setScrollFactor(0)

    this.lines = scene.add
      .text(PAD, PAD + LINE * 1.6, '', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#9ad4ff',
        lineSpacing: 2,
      })
      .setDepth(1000)
      .setScrollFactor(0)

    this.hint = scene.add
      .text(PAD, scene.scale.height - LINE * 3.4, '', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#7a7a90',
        lineSpacing: 2,
      })
      .setDepth(1000)
      .setScrollFactor(0)

    this.hint.setText(
      [
        'WASD/方向键 移动    左键 连射    右键 挥砍',
        '空格 暂停    I 无敌    0 清场    R 复位    Esc 回菜单',
        '（这是测试场，不是游戏。玩家是白方块，武器是调试枪 —— 都归临时设施，不进产品。）',
        '（音效要等第一次点击之后才会响 —— 浏览器不许页面自动出声。）',
      ].join('\n'),
    )

    // 横向居中、纵向**贴着标题下沿**（`update()` 里每帧摆正）。
    // 写死一个 y 曾经让提示压在标题第二行上 —— 标题是两三行还是四行取决于场子，
    // 常量 y 猜不对，所以改成问 `title.height` 要位置。
    this.notice = scene.add
      .text(scene.scale.width / 2, PAD, '', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffd166',
      })
      .setOrigin(0.5, 0)
      .setDepth(1001)
      .setScrollFactor(0)
  }

  /** 屏幕中上方的一行临时提示。传空串清掉。 */
  setNotice(text: string): void {
    this.notice.setText(text)
  }

  /**
   * 底座在**所有系统都建好之后**接线。
   *
   * HUD 必须先于它们出现（它要挂在最上层、`setScrollFactor(0)`），
   * 所以构造时拿不到这些对象 —— 只能事后 `bind()`。
   * 用对象参数而不是四个位置参数：**将来加一个依赖不会让调用点的参数错位**。
   */
  bind(deps: {
    scene: Phaser.Scene
    enemies: EnemySystem
    clock: GameClock
    player: DummyPlayer
    gun: DebugGun
    juice: JuiceDirector
  }): void {
    this.scene = deps.scene
    this.enemies = deps.enemies
    this.clock = deps.clock
    this.player = deps.player
    this.gun = deps.gun
    this.juice = deps.juice
  }

  setTitle(name: string, description: string): void {
    // 纵向位置由 `update()` 每帧按 `title.height` 顺下来，这里**不摆 y** ——
    // 摆的话就是第二个真值来源，两边迟早对不上。
    this.title.setText(`${name}\n${description}`)
  }

  update(deltaMs: number): void {
    // FPS 每 250ms 刷一次。每帧都改文字会每次都重建 canvas 纹理，
    // 而 HUD 本身不该成为掉帧的原因。
    this.accMs += deltaMs
    if (this.accMs >= 250) {
      this.fps = Math.round(1000 / Math.max(1, this.accMs / 12))
      this.accMs = 0
    }

    const e = this.enemies
    const c = this.clock
    const p = this.player
    const g = this.gun
    const j = this.juice
    const s = this.scene
    if (!e || !c || !p || !g || !j || !s) return

    // 布局每帧摆正，而不是在构造时算一次：`launcherMain` 用的是 `Scale.RESIZE`，
    // 改窗口大小之后写死的 y 会把提示条留在半空中。
    // 放这里而不是挂 `scale.on('resize')`：挂监听要配一套解绑逻辑（`destroy()` 时漏了
    // 就是场景重启后残留的回调），而这里本来每帧就会跑。
    //
    // **一列从上往下顺**：标题 → 提示 → 读数 → （底部）按键说明。
    // 三段都问上一段要高度，所以场子把标题写成两行还是四行都不会互相压。
    const titleBottom = this.title.y + this.title.height
    this.notice.setPosition(s.scale.width / 2, titleBottom + 2)
    this.lines.setY(titleBottom + this.notice.height + 10)
    this.hint.setY(s.scale.height - LINE * 3.4)

    const ai = e.aiStats
    // 物理世界的生死。**这是最该被显示、却最容易漏掉的一行**：
    // `World.update()` 第一句就是 `if (isPaused || bodies.size === 0) return`，
    // 于是「一个 body 都没有」和「世界被暂停了」都会让 `WORLD_STEP` 彻底停发，
    // 敌人系统**整个静默假死**（不刷怪、不跑 AI、不结算帧伤），而画面上
    // 唯一的迹象就是「场上空的」—— 和「刷怪逻辑写错了」长得一模一样。
    // 「**一只都不动**」= 速度意图没落到物理体上（或者 AI 完全没跑），标在行尾。
    //
    // 判据是 `moving === 0` 而不是「有几只不动」：受击硬直（`flinchMs`）和肉盾的
    // 下砸前摇（`windupMs` 700ms）**是设计上就要停住的**，按「有几只不动」算的话
    // 这行会一直闪 —— 一个天天闪的警告等于没有警告。
    // 全员静止才是那个 bug 的签名（第三代分裂怪和肉盾出生即 `chase`，
    // 状态从不切换 ⇒ 速度一次都没写过 ⇒ 场上所有怪一起站住）。
    //
    // `moving` 密集刷怪时会比 `alive` 少最多 `maxSpawnsPerFrame`（8）只 ——
    // 当帧刚出生的怪要下一帧才被算进来（见 `movingEnemies` 的注释）。
    // 所以**别拿这两个数相等当判据**。
    const frozen = e.movingEnemies === 0 && e.liveEnemies.length >= 2
    const stuckFlag = frozen ? '  ⚠️ 一只都没动' : ''

    const world = s.physics.world
    const worldFlag = world.isPaused ? '  ⚠️ PHYSICS PAUSED' : world.bodies.size === 0 ? '  ⚠️ 没有 body' : ''
    const rows = [
      `fps ${String(this.fps).padStart(3)}   frame ${c.frameId}   ${c.paused ? 'PAUSED' : c.frozen ? `FREEZE ${c.freezeRemainingMs.toFixed(0)}ms` : ''}`,
      `world    bodies ${String(world.bodies.size).padStart(3)}   steps ${String(e.worldSteps).padStart(5)}${worldFlag}`,
      `enemies  alive ${String(e.liveEnemies.length).padStart(3)} / pool ${e.pool.live}   moving ${String(e.movingEnemies).padStart(3)}   queue ${e.spawns.length}${stuckFlag}   ai ${ai.ticked}(near ${ai.near} / far ${ai.far})`,
      `ledger   pairs ${String(e.ledger.entryCount).padStart(3)}   ticks ${e.ledger.tickCount}   sources ${e.contactsTracked}`,
      `player   hp ${p.hp.toFixed(0)}/${p.maxHp}   hits ${p.hitCount}   taken ${p.damageTaken.toFixed(0)}   ${p.alive ? '' : 'DEAD'}`,
      `gun      shots ${g.shotsFired}   contacts ${g.contactsResolved}   ${g.swingActive ? 'swinging' : ''}`,
      `juice    hitstop budget ${j.hitstopBudgetRemainingMs.toFixed(0)}ms   trauma ${j.trauma.toFixed(2)}`,
    ]
    this.lines.setText(rows.join('\n'))
  }

  destroy(): void {
    this.title.destroy()
    this.lines.destroy()
    this.hint.destroy()
    this.notice.destroy()
  }
}