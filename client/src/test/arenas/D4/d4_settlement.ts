/**
 * D4 —— 结算界面的宿主场。**验的是"钱怎么进来、怎么留住"。**
 *
 * ## 该看什么
 *
 * | 按键 | 干了什么 | 该看到什么 |
 * |---|---|---|
 * | `K` | 模拟"通关" → 弹结算 | 结果为「通关」，到达第 3 层，币更多 |
 * | `L` | 模拟"阵亡" → 弹结算 | 结果为「阵亡」，**币照样进账** |
 * | 连按 `L` | 反复阵亡 | 币**只涨不跌** —— 这是"死亡不丢币"那条设计 |
 *
 * 击杀数是**真的**：`RunLedger` 订阅了总线的 `entity_killed`，
 * 所以先用调试枪打死几只怪，结算里的「击杀」就会是那个数。
 *
 * ## 为什么结算是"模拟"触发的
 *
 * 真触发要等 D1 的战斗场景（血量归零 / 通关）。这一场只验 D4 这一侧：
 * 宿主调 `show()` 之后，加币、统计、界面都对。**接法就是 `SettlementHost` 那三个方法**。
 */

import Phaser from 'phaser'
import type { ArenaConfig, ArenaContext, ArenaDefinition } from '../../ArenaBase'
import { ArenaBase, WORLD_HEIGHT, WORLD_WIDTH } from '../../ArenaBase'
import { MENU_SCENE_KEY } from '../../arenaCatalog'
import {
  META_CONFIG_NAME,
  META_CONFIG_URL,
  parseMetaConfig,
  type MetaConfig,
} from '@/domains/meta/metaConfig'
import { ProfileStore } from '@/domains/meta/profile/ProfileStore'
import { LocalStorageProfileStorage } from '@/domains/meta/profile/storage'
import { RunLedger } from '@/domains/meta/run/RunLedger'
import { SettlementOverlay } from '@/domains/meta/settlement/SettlementOverlay'
import type { RunInput } from '@/domains/meta/progress/progress'

class D4SettlementArena extends ArenaBase {
  private overlay!: SettlementOverlay
  private ledger!: RunLedger
  private store!: ProfileStore
  private meta!: MetaConfig
  private outcome: RunInput['outcome'] = 'dead'

  protected get definition(): ArenaDefinition {
    return arena
  }

  override preload(): void {
    super.preload()
    this.load.json(META_CONFIG_NAME, META_CONFIG_URL)
  }

  protected configure(): ArenaConfig {
    // 有怪可打：击杀数才是真的，而不是编一个数字。
    return {
      spawns: [
        { kind: 'splitter', gen: 0, count: 3, x: WORLD_WIDTH / 2 - 260, y: WORLD_HEIGHT / 2 },
        { kind: 'splitter', gen: 1, count: 4, x: WORLD_WIDTH / 2 + 260, y: WORLD_HEIGHT / 2 },
      ],
      spawnGraceMs: 5000,
    }
  }

  protected override onArenaCreate(ctx: ArenaContext): void {
    this.meta = parseMetaConfig(this.cache.json.get(META_CONFIG_NAME))
    this.store = new ProfileStore({ storage: new LocalStorageProfileStorage() })
    this.store.load()
    this.ledger = new RunLedger(ctx.bus)

    this.overlay = new SettlementOverlay({
      scene: ctx.scene,
      store: this.store,
      meta: this.meta,
      host: {
        runInput: () => this.ledger.input(this.outcome),
        // ⚠️ **软重启，不是 `scene.restart()`。**
        //
        // 场景重启会踩到底座 teardown 里的一个崩溃：`EnemySystem.shutdown()`
        // 在物理世界已经被销毁之后还去读 `scene.physics.world`（读 null 的 `off`），
        // 于是 `teardown()` 半路中断 —— `gun.shutdown()` / `hud.destroy()` /
        // `bus.clear()` 都不再执行。那是 D3 的文件（`EnemySystem.ts`），
        // 不在 D4 的改动范围里，所以这里绕开它，并把这条记进改动日志让 D3 修。
        //
        // 对演示来说软重启反而更贴：这一场要验的是"结算与发币"，不是场景生命周期。
        restart: () => this.softRestart(),
        backToMenu: () => this.scene.start(MENU_SCENE_KEY),
      },
    })

    const kb = ctx.scene.input.keyboard
    if (kb) {
      kb.addCapture(['K', 'L'])
      kb.on('keydown-K', () => this.finish('cleared'))
      kb.on('keydown-L', () => this.finish('dead'))
    }

    this.hud.setNotice('K = 模拟通关    L = 模拟阵亡（先打几只怪，击杀数才是真的）')

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.ledger.dispose()
      this.overlay.destroy()
    })
    ;(window as unknown as { __whitebox?: unknown }).__whitebox = { game: this.game }
  }

  /** 结算时**先停世界**：结算界面是死胡同，后面那局已经结束了。 */
  private finish(outcome: RunInput['outcome']): void {
    if (this.overlay.isOpen) return
    this.outcome = outcome
    // 通关当作打到第 3 层、阵亡当作第 1 层 —— 层数是币的主要来源，
    // 两个结果拉开差距才看得出"进度换收益"。
    this.ledger.setDepth(outcome === 'cleared' ? 3 : 1)
    this.clock.pause()
    this.physics.world.pause()
    this.overlay.show()
  }

  private softRestart(): void {
    this.overlay.hide()
    this.clock.resume()
    this.physics.world.resume()
    // ⚠️ 顺序要紧：`killAll()` 走**完整的死亡流程**，所以它会往账本里记击杀。
    // 先清场再 `reset()`，否则上一局清场那几下会被算进新一局的收益里
    // （实测踩到过：第二局凭空多出 7 个击杀）。
    this.enemies.killAll()
    this.ledger.reset()
    // 重新铺一批怪：不铺的话"下一局"是空场，看着像卡住了。
    for (let i = 0; i < 3; i++) {
      this.enemies.spawnNow('splitter', 0, WORLD_WIDTH / 2 - 260 + i * 40, WORLD_HEIGHT / 2)
    }
  }
}

export const arena: ArenaDefinition = {
  displayName: 'D4 结算界面',
  description:
    '按 K 模拟通关、L 模拟阵亡。币从这一局带出去，死亡不清空 —— 连按 L 看总币只涨不跌。先打几只怪，击杀数才是真的。',
  scene: D4SettlementArena,
}
