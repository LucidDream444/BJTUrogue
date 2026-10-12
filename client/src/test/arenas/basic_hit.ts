/**
 * 基础命中 —— **最小的一块空地**：一只分裂怪 + 一只肉盾，没有墙。
 *
 * 这个场子是「什么都通了」的冒烟场。它故意什么都不加：
 * 没有墙、没有持续刷怪、没有自定义读数。所以如果它坏了，坏的是**底座**，
 * 而不是某个场子的特殊配置。
 *
 * ## 该看什么
 *
 * 1. 打分裂怪 → 它**立刻**死（一枪一个）→ 分出两只第二代；
 * 2. 打肉盾 → **子弹穿过去了**，子弹没消失，而且飞过它体内的那一段一直在掉血；
 * 3. 打死分裂怪时画面**卡一下**（顿帧）→ 那是 `hitstopMs`；
 * 4. 打死肉盾时闪一下白 + 画面抖 → 那是 `flourish` 与 `trauma`；
 * 5. HUD 的 `ledger pairs` 在你停手之后要**回到 0**。不回来就是有人在漏 `release`。
 *
 * 第 2 条最容易看错：**子弹穿透是肉盾的身份，不是特例**。
 * 如果你怀疑它没生效，看 `gun contacts` 有没有比 `gun shots` 涨得快很多。
 */

import type { ArenaConfig, ArenaDefinition, ArenaContext } from '../ArenaBase'
import { ArenaBase, WORLD_HEIGHT, WORLD_WIDTH } from '../ArenaBase'

/** 两只怪摆在玩家的两边，出生就能看见，不用找 */
const PLAYER_X = WORLD_WIDTH / 2
const PLAYER_Y = WORLD_HEIGHT / 2

class BasicHitArena extends ArenaBase {
  protected get definition(): ArenaDefinition {
    return arena
  }

  protected configure(): ArenaConfig {
    return {
      spawns: [
        { kind: 'splitter', gen: 0, count: 1, x: PLAYER_X - 300, y: PLAYER_Y },
        { kind: 'tank', gen: 0, count: 1, x: PLAYER_X + 300, y: PLAYER_Y },
      ],
      // 开局两秒无敌：一进场就被肉盾砸一下的话，你还没看清就掉了一截血。
      spawnGraceMs: 2000,
    }
  }

  protected override onArenaCreate(ctx: ArenaContext): void {
    ctx.hud.setNotice('左边分裂怪 / 右边肉盾')
  }
}

export const arena: ArenaDefinition = {
  displayName: '基础命中',
  description: '一只分裂怪 + 一只肉盾，空地。看：一枪一个、子弹穿透、顿帧、闪屏。',
  scene: BasicHitArena,
}