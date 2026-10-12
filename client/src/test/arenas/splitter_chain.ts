/**
 * 分裂链 —— 三只第一代分裂怪，开阔地，**不刷新的怪**。
 *
 * ## 该看什么
 *
 * 1. **代数变化看得见**：白色方块一代比一代小、一代比一代快。看错的话
 *    `generations` 表里的 `radius`/`speed` 没接上；
 * 2. **出生有间隔**：不是「啪」一下四只全出来，而是每代按 `spawnStaggerMs`
 *    一只一只冒出来（`queue` 读数会短暂地不为 0）。全冒出来只说明
 *    **出生队列被绕过了**，同帧挤进物理世界会让顿帧和音效一起糊掉；
 * 3. **连击与第 5 杀**：HUD 上没直接显示连击数（那是 `JuicePolicy` 的内部状态），
 *    但**第 5 杀会闪一下白屏**（`comboFlourishAt: 5`，`flourishFlash`）。
 *    一条完整的链是 **1 + 2 + 8 = 11 杀**（`generations` 里的 `childCount` 是 2 / 4 / 0）。
 *    所以三只一代 = **33 杀**，第 5 杀会出现三次（每只一条链一次）。
 *    ⚠️ 闪屏应该**每条链只闪一次**，不是「过了 5 之后每杀都闪」——
 *    后者会累加成一整片白，而那是配置写错（`===` 写成 `>=`）才会有的现象。
 * 4. ⚠️ **最该盯的一条：`ledger pairs` 要在全部死完之后回到 0。**
 *    这是「每个持续伤害源都配了一次释放」的直接证据。
 *    停手之后它还在涨或停在某个正数，就是有源没被释放 ——
 *    那种泄漏**只在长局里才会变成问题**，短测永远碰不到，所以只能靠这个数字看。
 *
 * ## 还有一条只有这个场子能验的
 *
 * 第三代（gen 2）的配置是 `hitstopMs: 0, trauma: 0.05` —— **它没有顿帧**，
 * 而一条链里 8 次击杀有 8 次是第三代。所以「连击」这件事必须在
 * 「顿帧为 0 就提前返回」**之前**算，否则连击会在第 4 杀卡死，第 5 杀永远不出现。
 * 这个场子就是那个 bug 的现场：**看不到白闪 = 连击被 0 顿帧的代数截断了。**
 *
 * ## 为什么是 3 只而不是 1 只
 *
 * 1 只只有 11 杀，且出生量小 —— 看不出「生成本身会不会打架」。
 * 3 只一代同时死会撞上同帧出生限额（`maxSpawnsPerFrame`），
 * 顺带验证了 `queue` 会自己排空而不是丢怪。
 */

import type { ArenaConfig, ArenaDefinition, ArenaContext } from '../ArenaBase'
import { ArenaBase, WORLD_HEIGHT, WORLD_WIDTH } from '../ArenaBase'

/** 三只一代分散摆开，**不要靠太近**：靠太近时它们的分离力会互相挤，看不出主动追击 */
const HORNS = [
  { x: WORLD_WIDTH / 2 - 360, y: WORLD_HEIGHT / 2 - 200 },
  { x: WORLD_WIDTH / 2 + 360, y: WORLD_HEIGHT / 2 - 200 },
  { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 + 240 },
]

class SplitterChainArena extends ArenaBase {
  protected get definition(): ArenaDefinition {
    return arena
  }

  protected configure(): ArenaConfig {
    return {
      spawns: HORNS.map((p) => ({ kind: 'splitter', gen: 0, count: 1, x: p.x, y: p.y })),
      // 不设无敌：分裂链的爽感有一部分来自「你也在被追」。
      // 真扛不住了按 `I`。
    }
  }

  protected override onArenaCreate(ctx: ArenaContext): void {
    ctx.hud.setNotice('3 只一代 → 33 杀。盯 ledger pairs 归零')
  }
}

export const arena: ArenaDefinition = {
  displayName: '分裂链',
  description: '三只一代分裂怪。看：33 杀、第 5 杀闪屏、出生间隔、ledger 归零。',
  scene: SplitterChainArena,
}