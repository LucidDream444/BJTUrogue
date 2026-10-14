/**
 * D4 —— 奖励选择界面的宿主场。**按 J 模拟"清房"**，弹出三选一。
 *
 * 候选内容在这一版是**假数据**：奖励池设计归 D1（`RewardCandidate` 这个形状由 D4 定）。
 * 真接进来时，宿主把 `offer()` 换成"从奖励池抽三个"，`pick()` 换成"把效果落到这一局"。
 */

import Phaser from 'phaser'
import type { ArenaConfig, ArenaContext, ArenaDefinition } from '../../ArenaBase'
import { ArenaBase, WORLD_HEIGHT, WORLD_WIDTH } from '../../ArenaBase'
import { RewardOverlay, type RewardCandidate } from '@/domains/meta/reward/RewardOverlay'

/** 假候选。三个不同类型的，好看出"选项之间要有区别" */
const FAKE_POOL: RewardCandidate[] = [
  { id: 'demo_hp', name: '强健体魄', description: '生命上限 +10' },
  { id: 'demo_rate', name: '快速击发', description: '攻击速度 +15%' },
  { id: 'demo_dmg', name: '强化弹头', description: '基础伤害 +20%' },
]

class D4RewardArena extends ArenaBase {
  private overlay!: RewardOverlay

  protected get definition(): ArenaDefinition {
    return arena
  }

  protected configure(): ArenaConfig {
    return {
      spawns: [
        { kind: 'splitter', gen: 0, count: 2, x: WORLD_WIDTH / 2 - 220, y: WORLD_HEIGHT / 2 },
      ],
      spawnGraceMs: 3000,
    }
  }

  protected override onArenaCreate(ctx: ArenaContext): void {
    this.overlay = new RewardOverlay({
      scene: ctx.scene,
      offer: () => FAKE_POOL,
      pick: (id) => {
        // 选完要把世界放开 —— 奖励不是暂停菜单，"选完继续打"。
        ctx.clock.resume()
        this.physics.world.resume()
        ctx.hud.setNotice(`选了：${id}（演示数据，D1 接上真奖励池后这里才作数）`)
      },
    })

    const kb = ctx.scene.input.keyboard
    if (kb) {
      kb.addCapture(['J'])
      kb.on('keydown-J', () => this.openReward(ctx))
    }

    this.hud.setNotice('J = 模拟清房，弹三选一')
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.overlay.destroy())
    ;(window as unknown as { __whitebox?: unknown }).__whitebox = { game: this.game }
  }

  private openReward(ctx: ArenaContext): void {
    if (this.overlay.isOpen) return
    // 奖励是"打完一间房"的停顿，所以把世界停住 —— 与暂停菜单同一个道理。
    ctx.clock.pause()
    this.physics.world.pause()
    this.overlay.show()
  }
}

export const arena: ArenaDefinition = {
  displayName: 'D4 奖励三选一',
  description:
    '按 J 模拟清房：弹出三项奖励，先点一项看说明，再点「确认选择」。（内容还是演示数据）',
  scene: D4RewardArena,
}
