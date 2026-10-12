/**
 * 肉盾磨血 —— 两只肉盾 + **带缺口的一堵墙**，中间还有柱子。
 *
 * 这个场子一次回答两个问题，因为它们在产品里是同时发生的：
 *
 * ## 一、帧伤与持续输出的手感
 *
 * 1. **右键按住不放**贴在肉盾身上砍。`tickMs` 是 100ms，所以血线是**每 0.1 秒**
 *    往下跳一格，不是连续掉 —— 连续掉说明有人在按帧结算而不是按 tick。
 * 2. **音效比伤害稀**：`damageEventBatchMs` 把 10 次/秒的结算合并成约 4 次/秒的音。
 *    音效跟着结算频率走的话，换个射速快的武器就会从「有分量」变成「癫痫警告」。
 * 3. **被打得越多音调越高**（`hpPitchCents`）：血越少声音越尖。听不出变化 = 音高没接上。
 * 4. **它会越走越慢**（`hitSlow`）：一直打，它几乎挪不动。
 *    不加 `hitSlow` 的话它反而更快贴到你脸上 —— 是**反的**，很好认。
 * 5. **下砸**：站近一点等它举手（`windupMs` 700ms 的前摇），砸下来那一下画面
 *    会卡一下 + 抖一下。前摇没有提示的话这个技能是「不讲理」的。
 * 6. **穿透**：用左键打它，子弹**穿过去继续飞**，`gun contacts` 比 `gun shots` 涨得快。
 *
 * ## 二、寻路 —— 墙是故意摆的
 *
 * 墙中间留了一个 **160px 的缺口**（两格寻路网格）。这个缺口是刻意选的：
 * 它**刚好比两格宽一点**，所以「格子中心点在不在墙里」这种印格子的做法
 * 能把它留出来，而「矩形相交」那种做法会把它封死。
 *
 * 所以：**怪会不会绕到缺口这边来**，就是寻路网格对不对的直接读数。
 * 如果它们贴着墙左右蹭、或者干脆卡在墙里不动 —— 那是网格的原点/格子大小错了
 * （`ArenaBase.makeNav` 里那两条 ⚠️ 说的就是这个）。
 *
 * 柱子（120×120）比一格大，用来验「绕单点障碍」而不是「绕长墙」。
 */

import type { ArenaConfig, ArenaDefinition, ArenaContext } from '../ArenaBase'
import { ArenaBase, WORLD_HEIGHT, WORLD_WIDTH } from '../ArenaBase'

const MID_Y = WORLD_HEIGHT / 2
/** 墙上缺口的宽度。**160 = 两格寻路网格**（`ArenaBase` 里 `GRID_SIZE * 2`） */
export const GAP_WIDTH = 160

class TankGrindArena extends ArenaBase {
  protected get definition(): ArenaDefinition {
    return arena
  }

  protected configure(): ArenaConfig {
    const halfGap = GAP_WIDTH / 2
    return {
      walls: [
        // 一堵横墙，中间留缺口。左右两段各 320 宽。
        { x: WORLD_WIDTH / 2 - halfGap - 160, y: MID_Y, width: 320, height: 80 },
        { x: WORLD_WIDTH / 2 + halfGap + 160, y: MID_Y, width: 320, height: 80 },
        // 两根柱子：比一格寻路网格大，验「绕单点障碍」
        { x: 180, y: 160, width: 120, height: 120 },
        { x: WORLD_WIDTH - 180, y: WORLD_HEIGHT - 160, width: 120, height: 120 },
      ],
      // 两只肉盾都放在**墙的另一边**（一上一下），玩家在缺口处出生。
      // 故意让它们必须穿过缺口才能过来 —— 不然「绕路」这件事根本不会发生。
      spawns: [
        { kind: 'tank', gen: 0, count: 1, x: WORLD_WIDTH / 2 - 200, y: 150 },
        { kind: 'tank', gen: 0, count: 1, x: WORLD_WIDTH / 2 + 200, y: WORLD_HEIGHT - 150 },
      ],
      // 肉盾一次下砸 22，200 血挨不住几轮。开局给 4 秒把位置站好。
      spawnGraceMs: 4000,
      rngSeed: 0x7a47,
    }
  }

  protected override onArenaCreate(ctx: ArenaContext): void {
    ctx.hud.setNotice('右键按住不放，贴在肉盾身上砍')
  }
}

export const arena: ArenaDefinition = {
  displayName: '肉盾磨血',
  description: '两只肉盾 + 一堵带 160px 缺口的墙。看：帧伤 tick、音效限频、音高、减速、绕路。',
  scene: TankGrindArena,
}