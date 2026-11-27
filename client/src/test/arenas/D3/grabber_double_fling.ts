import Phaser from 'phaser'
import type { ArenaConfig, ArenaContext, ArenaDefinition } from '../../ArenaBase'
import { ArenaBase } from '../../ArenaBase'

/**
 * 双缠抱怪 · 连续甩飞（回归场）。
 *
 * 复现的正是那个只在“两只都被甩出”时才出现的旧 bug：
 *
 *   A 抓住玩家 → 玩家连点挣脱，A 进入 flung
 *     → B 紧接着抓住玩家 → 玩家再挣脱，B 也进入 flung
 *     → 旧版 `EnemySystem.flight` 只有一个槽，B 覆盖 A
 *     → A 永远停在 flung：活着、不落地、不爆炸，清房卡住
 *
 * 这个场子会自动连点 QTE（不用手点），所以打开后观察两只怪是否都消失/落地；
 * HUD 会把每只怪的 `state` 直接打出来。若看到某只长期是 `flung`，就是回归。
 *
 * 场的自动化把手在 `window.__doubleGrabArena`，供无头浏览器读取同一份真实状态。
 */

/** 冻结超过它就直接放人（毫秒）；和 D1 / grabber_grind 的兜底同一个道理。 */
const FREEZE_WATCHDOG_MS = 16000
/** 自动 QTE 的连点间隔（毫秒）。 */
const AUTO_PRESS_MS = 70

class GrabberDoubleFlingArena extends ArenaBase {
  protected get definition(): ArenaDefinition {
    return arena
  }

  protected configure(): ArenaConfig {
    return {
      // 两只都放在抓取距离内，让它们有机会先后进入“!”预警。
      spawns: [
        { kind: 'grabber', gen: 0, count: 1, x: 520, y: 360 },
        { kind: 'grabber', gen: 0, count: 1, x: 760, y: 360 },
      ],
      spawnGraceMs: 1200,
      rngSeed: 0x6a72,
    }
  }

  private readout!: Phaser.GameObjects.Text
  private frozen = false
  private frozenMs = 0
  private zoomBefore = 1
  private nextPressAtMs = 0
  private lastGrabId: number | null = null

  protected override onArenaCreate(ctx: ArenaContext): void {
    ctx.hud.setNotice(
      '自动连点 QTE：A 被甩出后看 B 是否立刻接抓，两只最终都应落地消失；G 重摆一场',
    )
    this.readout = this.add
      .text(24, 96, '', { fontFamily: 'monospace', fontSize: '14px', color: '#dcecff' })
      .setScrollFactor(0)
      .setDepth(5000)

    this.input.keyboard?.on('keydown-G', () => this.reset(ctx))

    // 只读调试把手：无头测试直接读真实 EnemySystem 状态，不猜画面。
    ;(window as unknown as { __doubleGrabArena?: unknown }).__doubleGrabArena = {
      status: () => ctx.enemies.grabStatus(),
      live: () =>
        ctx.enemies.liveEnemies.map((e) => ({
          id: e.model.id,
          hp: Math.ceil(e.model.hp),
          state: e.model.state,
          x: Math.round(e.view.x),
          y: Math.round(e.view.y),
        })),
      frozen: () => this.frozen,
      reset: () => this.reset(ctx),
    }
  }

  protected override onArenaUpdate(dtMs: number, ctx: ArenaContext): void {
    const status = ctx.enemies.grabStatus()

    if (status) {
      if (!this.frozen) this.freeze(ctx, true)
      if (this.lastGrabId !== status.enemyId) {
        // A → B：世界已经冻结，不要重复推近镜头；只重置这一轮的电影时间和连点节拍。
        this.lastGrabId = status.enemyId
        this.frozenMs = 0
        this.nextPressAtMs = 0
      }
      this.frozenMs += dtMs
      if (this.frozenMs > FREEZE_WATCHDOG_MS) {
        ctx.enemies.abortGrab()
        this.freeze(ctx, false)
        ctx.hud.setNotice('抓取超时，已强制放人 —— 出现这一条说明还有 bug')
      } else {
        ctx.enemies.tickGrab(dtMs)
        // 自动连点：A、B 都会被挣脱，不必玩家手动点。
        // 冻结期间 `clock.nowMs` 不走，必须用渲染帧攒出来的 `frozenMs` 计节拍；
        // 用逻辑时钟的话第一次按下之后永远等不到第二次。
        if (status.phase === 'holding' && this.frozenMs >= this.nextPressAtMs) {
          ctx.enemies.grabPress()
          this.nextPressAtMs = this.frozenMs + AUTO_PRESS_MS
        }
      }
    } else if (this.frozen) {
      this.freeze(ctx, false)
    }

    const grabbers = ctx.enemies.liveEnemies.filter(
      (e) => e.model.enemyKind === 'grabber',
    )
    this.readout.setText(
      [
        `缠抱怪 ${grabbers.length} 只（初始 2 只）`,
        ...grabbers.map(
          (e) =>
            `  id ${e.model.id}  血 ${Math.ceil(e.model.hp)}/${e.model.maxHp}  state ${e.model.state}`,
        ),
        `抓取：${status ? `id ${status.enemyId} / ${status.phase} / 按下 ${status.presses}` : '—'}`,
        `世界：${this.frozen ? '冻结（抓取中）' : '正常'}`,
        `期望：两只都变为非 flung 并消失；若某只长期 flung，就是回归`,
      ].join('\n'),
    )
  }

  private freeze(ctx: ArenaContext, on: boolean): void {
    const cam = ctx.scene.cameras.main
    if (on) {
      this.frozen = true
      this.frozenMs = 0
      this.nextPressAtMs = 0
      ctx.clock.pause()
      ctx.scene.physics.world.pause()
      this.zoomBefore = cam.zoom
      cam.setZoom(Math.max(1.6, cam.zoom * 2.2)).centerOn(ctx.player.x, ctx.player.y)
      return
    }
    this.frozen = false
    this.frozenMs = 0
    this.lastGrabId = null
    ctx.clock.resume()
    ctx.scene.physics.world.resume()
    cam.setZoom(this.zoomBefore)
    cam.centerOn(ctx.world.width / 2, ctx.world.height / 2)
  }

  private reset(ctx: ArenaContext): void {
    if (this.frozen) this.freeze(ctx, false)
    // `despawnAll()` 会同时清掉 flights；只 `killAll()` 时旧的飞行记录可能还在。
    ctx.enemies.abortGrab()
    ctx.enemies.despawnAll()
    this.nextPressAtMs = 0
    this.lastGrabId = null
    ctx.enemies.requestSpawn('grabber', 0, 520, 360, 'debug')
    ctx.enemies.requestSpawn('grabber', 0, 760, 360, 'debug')
  }
}

export const arena: ArenaDefinition = {
  displayName: '缠抱怪 · 双甩飞回归',
  description:
    '自动连点。A 被甩出后 B 立刻接抓：两只都应落地爆炸并消失；若有一只长期 flung，就是旧 flight 单槽 bug 回归。G 重摆一场。',
  scene: GrabberDoubleFlingArena,
}
