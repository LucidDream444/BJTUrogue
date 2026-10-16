import Phaser from 'phaser'
import type { ArenaConfig, ArenaContext, ArenaDefinition } from '../../ArenaBase'
import { ArenaBase } from '../../ArenaBase'

/**
 * 抓取怪的测试场。
 *
 * ## 这里要一眼看懂的六件事
 *
 * 1. **预警**：它站定、头顶冒「!」，读秒 2 秒。这段时间跑开或打死它都能取消。
 * 2. **扑向**：到点必定扑到玩家身上（不可躲），同时世界冻结、镜头推近。
 * 3. **咬人节拍**：吸附之后头顶那行红字是下一次咬击的倒计时（默认 4 秒一口）。
 * 4. **连点挣脱**：**左键连点**扣它 5% 最大血（满血 20 下）。它头顶那条血条就是进度条。
 * 5. **甩出**：压到「再一下就会死」时它保留 1 血被甩出去 —— 朝**敌人最多的方向**、距离固定。
 * 6. **落地爆炸**：落地那一刻它死，并在落点炸一圈（只打其它敌人；半径大到能盖住一间教室）。
 *
 * ## 这个场子**不能** import D1
 *
 * 架构守卫规定：`arenas/D3/` 的东西只许碰 `core/`、`test/` 底座和 `domains/enemies/`
 * （连 `import type` 也不行）。所以 D1 那边的三件事 —— 冻结、镜头特写、把「按下」转发进来 ——
 * 在这里是**照着做了一遍**：这正是白盒场子的本分，也是它存在的理由
 * （D1 的那个版本要跑进产品里才看得到）。
 */

/** 分裂怪当靶子：爆炸半径内的人越多，甩出去的方向就越明显。 */
const CROWD = 10
/** 冻结超过它就直接放人（毫秒）。和 D1 那条兜底同一个道理：解不开的抓取就是卡死。 */
const FREEZE_WATCHDOG_MS = 16000
/** 落地爆炸圈的动画时长（毫秒） */
const BLAST_FX_MS = 420

class GrabberGrindArena extends ArenaBase {
  protected get definition(): ArenaDefinition {
    return arena
  }
  protected configure(): ArenaConfig {
    return {
      walls: [
        // 一小段墙：看「撞墙提前落地」用（甩到那边会提前炸）
        { x: 900, y: 300, width: 40, height: 300 },
      ],
      spawns: [
        { kind: 'grabber', gen: 0, count: 1, x: 520, y: 420 },
        ...Array.from({ length: CROWD }, (_, i) => ({
          kind: 'splitter' as const,
          gen: 0,
          count: 1,
          x: 200 + (i % 5) * 90,
          y: 200 + Math.floor(i / 5) * 260,
        })),
      ],
      spawnGraceMs: 3000,
      rngSeed: 0x6a71,
    }
  }

  /* ---- 只在场子里用的状态 ---- */
  private readout!: Phaser.GameObjects.Text
  private frozen = false
  private frozenMs = 0
  private zoomBefore = 1
  /** 上一次看它还在飞的位置 —— 落地爆炸的圈画在那儿（D3 不对外暴露落点） */
  private lastFlyingAt: { x: number; y: number } | null = null
  private blastAt: { x: number; y: number; untilMs: number } | null = null
  /**
   * 最近半秒里「AoE 伤害事件」的条数。
   *
   * ⚠️ 这一行是刻意的：画面上的青蓝 EMP 波纹是**这个场子自己画的**（它看到「刚才在飞、现在不在了」
   * 就画），波纹出现**不等于**爆炸真的结算了。这个读数直接数伤害事件 ——
   * 有圈没数字 = 爆炸的路走岔了（这正是第一次试玩里发生的事）。
   */
  private recentBlastHits = 0
  private recentBlastUntilMs = 0

  protected override onArenaCreate(ctx: ArenaContext): void {
    ctx.hud.setNotice(
      '看它冒「!」：跑开 / 打死它两条都能取消 · 被抓住后【左键连点】挣脱 · G 重摆一场',
    )
    this.blastGfx = this.add.graphics().setDepth(4000)
    this.readout = this.add
      .text(24, 96, '', { fontFamily: 'monospace', fontSize: '14px', color: '#dcecff' })
      .setScrollFactor(0)
      .setDepth(5000)
    // 「按下」转给 D3 —— D1 里那一行就在 `CombatSession.onDown` 的暂停守卫**之前**，
    // 这里照着做：冻结期间按键不能被任何守卫吃掉。
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown() && this.frozen) ctx.enemies.grabPress()
    })
    this.input.keyboard?.on('keydown-G', () => this.respawnAll(ctx))
    // 调试把手：让自动化（无头浏览器）能读到场子的真实状态，而不是去猜画面。
    // **只在测试场里**，产品代码不依赖它（§五：场子不许变成产品的运行时依赖）。
    ;(window as unknown as { __grabArena?: unknown }).__grabArena = {
      status: () => ctx.enemies.grabStatus(),
      frozen: () => this.frozen,
      blastHits: () => this.recentBlastHits,
      live: () => ctx.enemies.liveEnemies.map((e) => ({ id: e.model.id, kind: e.model.enemyKind, hp: Math.ceil(e.model.hp), state: e.model.state })),
    }
    // 数落地爆炸的伤害事件（这个场子里没有别的 AoE 来源：没有肉盾、调试枪是 bullet/melee）
    ctx.bus.on('entity_damaged', (e) => {
      if (e.targetKind === 'enemy' && e.sourceKind === 'aoe') {
        this.recentBlastHits++
        this.recentBlastUntilMs = ctx.clock.nowMs + 500
      }
    })
  }

  /**
   * 每帧：驱动抓取电影时间、按需冻结世界、画读数。
   *
   * ⚠️ 这里的三件事和 D1 的 `BattleScene.driveGrab()` 是**同一套逻辑的复制品**。
   * 复制是刻意的（D3 的场子碰不到 D1），但改一边就要想起另一边。
   */
  protected override onArenaUpdate(dtMs: number, ctx: ArenaContext): void {
    const status = ctx.enemies.grabStatus()

    if (status) {
      if (!this.frozen) this.freeze(ctx, true)
      this.frozenMs += dtMs
      if (this.frozenMs > FREEZE_WATCHDOG_MS) {
        // 兜底：拿不到结束信号就自己放人（正常路径几秒内必然结束）
        ctx.enemies.abortGrab()
        this.freeze(ctx, false)
        ctx.hud.setNotice('抓取超时，已强制放人 —— 这一条不该出现，出现了说明有 bug')
      } else {
        ctx.enemies.tickGrab(dtMs)
      }
    } else if (this.frozen) {
      this.freeze(ctx, false)
    }

    // 飞行 → 落地的观察：飞着的时候记位置，死了就把圈画在最后那个位置
    const flung = ctx.enemies.liveEnemies.find((e) => e.model.state === 'flung')
    if (flung) {
      this.lastFlyingAt = { x: flung.view.x, y: flung.view.y }
    } else if (this.lastFlyingAt && this.blastAt === null) {
      this.blastAt = { ...this.lastFlyingAt, untilMs: ctx.clock.nowMs + BLAST_FX_MS }
      this.lastFlyingAt = null
    }
    this.drawEmpBlast(ctx)

    if (ctx.clock.nowMs > this.recentBlastUntilMs) this.recentBlastHits = 0

    const g = ctx.enemies.liveEnemies.find((e) => e.model.enemyKind === 'grabber')
    this.readout.setText(
      [
        `抓取怪  ${g ? `血 ${Math.ceil(g.model.hp)}/${g.model.maxHp}  状态 ${g.model.state}` : '（不在了）'}`,
        status
          ? `抓取中  阶段 ${status.phase}  按下 ${status.presses}  下一口 ${(status.msUntilBite / 1000).toFixed(1)}s  血条 ${(status.hpRatio * 100).toFixed(0)}%`
          : '抓取中  —（没抓住）',
        `玩家 ${Math.ceil(ctx.player.hp)}/${ctx.player.maxHp}   世界 ${this.frozen ? '冻结' : '正常'}`,
        `落地 EMP  最近 0.5 秒内炸到 ${this.recentBlastHits} 只（波纹是场子画的，这一行才是真的）`,
        'G 重摆一场 · SPACE 暂停 · 0 清场 · I 无敌',
      ].join('\n'),
    )
  }

  /** 冻结 / 解冻：**D1 那套的两行版**（时钟 + 物理世界）+ 镜头特写。 */
  private freeze(ctx: ArenaContext, on: boolean): void {
    const cam = ctx.scene.cameras.main
    if (on) {
      this.frozen = true
      this.frozenMs = 0
      ctx.clock.pause()
      ctx.scene.physics.world.pause()
      this.zoomBefore = cam.zoom
      cam.setZoom(Math.max(1.6, cam.zoom * 2.2)).centerOn(ctx.player.x, ctx.player.y)
      return
    }
    this.frozen = false
    this.frozenMs = 0
    ctx.clock.resume()
    ctx.scene.physics.world.resume()
    cam.setZoom(this.zoomBefore)
    ctx.scene.cameras.main.centerOn(ctx.world.width / 2, ctx.world.height / 2)
  }

  /** 落地 EMP：一张常驻 Graphics，每帧重画（脉冲环 + 电弧 + 淡出）。 */
  private drawEmpBlast(ctx: ArenaContext): void {
    const gfx = this.blastGfx
    gfx.clear()
    const at = this.blastAt
    if (!at) return
    if (ctx.clock.nowMs > at.untilMs) {
      this.blastAt = null
      return
    }
    const radius = ctx.bundle.enemies.enemies.grabber.grab.blastRadius
    const left = (at.untilMs - ctx.clock.nowMs) / BLAST_FX_MS
    const progress = 1 - left
    const fade = Math.max(0, left)
    const wave = radius * (0.18 + progress * 0.82)
    gfx.fillStyle(0x2bcbff, fade * 0.08).fillCircle(at.x, at.y, Math.max(6, wave * 0.45))
    // The outer boundary is the exact configured damage radius, so the debug readout
    // and the visual range have one source of truth.
    gfx.lineStyle(3, 0x42e8ff, fade).strokeCircle(at.x, at.y, radius)
    gfx.lineStyle(2, 0xe5ffff, fade * 0.9).strokeCircle(at.x, at.y, wave)
    gfx.lineStyle(1, 0x579bff, fade * 0.8).strokeCircle(at.x, at.y, wave * 0.62)
    for (let i = 0; i < 12; i++) {
      const angle = i * (Math.PI * 2 / 12) + progress * 2.2
      const inner = wave * (0.76 + (i % 2) * 0.06)
      const outer = wave + 10 + (i % 3) * 6
      gfx.lineStyle(i % 3 === 0 ? 3 : 2, i % 3 === 0 ? 0xe5ffff : 0x68c7ff, fade)
      gfx.lineBetween(
        at.x + Math.cos(angle) * inner,
        at.y + Math.sin(angle) * inner,
        at.x + Math.cos(angle + 0.1) * outer,
        at.y + Math.sin(angle + 0.1) * outer,
      )
    }
  }
  private blastGfx!: Phaser.GameObjects.Graphics

  private respawnAll(ctx: ArenaContext): void {
    ctx.enemies.killAll()
    for (const [i, at] of [
      { x: 520, y: 420 },
      ...Array.from({ length: CROWD }, (_, i) => ({
        x: 200 + (i % 5) * 90,
        y: 200 + Math.floor(i / 5) * 260,
      })),
    ].entries()) {
      ctx.enemies.requestSpawn(i === 0 ? 'grabber' : 'splitter', 0, at.x, at.y, 'debug')
    }
  }
}

export const arena: ArenaDefinition = {
  displayName: '缠抱怪 · 抓取与甩飞',
  description:
    '看「!」→ 扑向 → 自由冻结 → 左键连点挣脱 → 朝人堆甩出 → 落地爆炸（只打敌人）。G 重摆一场。',
  scene: GrabberGrindArena,
}
