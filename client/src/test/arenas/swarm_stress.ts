/**
 * 压力场 —— 一次性要一大批怪，然后**持续补到稳态**。
 *
 * ## 为什么需要一个「人多」的场子
 *
 * 前面三个场子每只怪都看得很清楚，但产品里怪是**一起来**的。
 * 而下面的每一条，都是**只有数量上来才看得见**的：
 *
 * | 现象 | 单看一只怪 | 数量上来之后 |
 * |---|---|---|
 * | 同帧出生 | 看不出来 | 一次性 8 只出生 = 那一帧顶到天花板 + 8 路音效同时开 |
 * | AI 降频 | 30Hz 或 5Hz 都一样 | 远处那批不降频的话，AI 次数翻几倍 |
 * | 分离力 | 两只不会挤 | 十几只叠在一起会互相推成一条线 |
 * | 池子复用 | 看不出回收 | 不回收的话内存一路涨，**而且没有任何报错** |
 *
 * ## 该看什么
 *
 * 1. **`queue` 会先涨到一百多，然后自己排空。** 排空的速率由
 *    `maxSpawnsPerFrame`（8）决定 —— 一帧出 8 只，不是一帧出 150 只。
 *    如果 `queue` 一上来就是 0，说明**出生队列被绕过了**。
 * 2. **`ai near / far` 的比例。** 近处 30Hz、远处 5Hz（见 `enemies.json` 的 `ai`）。
 *    怪撒满一整场时，`far` 应该**远多于** `near`。两个数差不多大 = 降频没生效，
 *    那是**纯浪费**：远处那批怪的 AI 结果每帧都在被算，然后被丢掉。
 * 3. **`frame` 必须一直在涨。** 它停住就是**物理世界空了** ——
 *    `World.update()` 第一句 `if (isPaused || bodies.size === 0) return`，
 *    一个 body 都没有时 `WORLD_STEP` 不再触发，整个敌人系统会静默假死
 *    （见 `ArenaBase` 文件头那段 ⚠️）。
 * 4. **`pool` 要跟着 `alive` 一起回落。** `alive` 掉到 0 而 `pool` 还停在高位，
 *    说明有人 `park()` 了却没还回池子。
 * 5. **帧率。** 这个场子的意义是「它还能跑」而不是「它跑得好看」，
 *    但帧率掉到 10 以下就没法观察了 —— 那时候该怀疑的是 AI 频率而不是渲染。
 *
 * ## 别按 `0` 清场然后愣着
 *
 * `0` 会一次性打死所有怪，包括**第一代分裂怪** —— 一按下去，场上会瞬间多出
 * 两倍的第二代。那是对的（清场就该走完整的死亡流程），但会看起来像「越清越多」。
 * 想真的清干净，按 `0` 之后等它分裂完，再按一次。
 */

import type { ArenaConfig, ArenaDefinition, ArenaContext } from '../ArenaBase'
import { ArenaBase, WORLD_HEIGHT, WORLD_WIDTH } from '../ArenaBase'

/** 开局的量。印在 180 的软上限之上，好让 `queue` 有一次明显的涨落 */
const INITIAL_SWARM = 150
const INITIAL_TANKS = 8
/** 稳态：活着的怪少于这个数就补一批 */
const STEADY_THRESHOLD = 90
/** 补一批多少只 */
const REFILL_BATCH = 60
/** 两次补货之间至少隔这么久，免得每帧都在补 */
const REFILL_INTERVAL_MS = 1500

/** 用第二代：它**不再分裂**，所以「数量」和「分裂链」两件事不会互相干扰 */
const SWARM_GEN = 2

class SwarmStressArena extends ArenaBase {
  private nextRefillAtMs = 0

  protected get definition(): ArenaDefinition {
    return arena
  }

  protected configure(): ArenaConfig {
    return {
      // 几根柱子。人多 + 有障碍，才是寻路真正被压到的样子。
      walls: [
        { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, width: 160, height: 160 },
        { x: 300, y: 200, width: 120, height: 120 },
        { x: WORLD_WIDTH - 300, y: WORLD_HEIGHT - 200, width: 120, height: 120 },
        { x: 300, y: WORLD_HEIGHT - 200, width: 120, height: 120 },
        { x: WORLD_WIDTH - 300, y: 200, width: 120, height: 120 },
      ],
      // 撒点会自动避开墙（`ArenaBase.randomPoint`）。
      // 不写 x/y 就是随机撒 —— 这个场子要的正是「铺满一整场」。
      spawns: [
        { kind: 'splitter', gen: SWARM_GEN, count: INITIAL_SWARM },
        { kind: 'tank', gen: 0, count: INITIAL_TANKS },
      ],
      // 150+ 只怪同时贴脸，玩家 200 血撑不过两秒。这个场子看的是敌人，不是玩家。
      spawnGraceMs: 60_000,
      rngSeed: 0x5eed,
    }
  }

  protected override onArenaCreate(ctx: ArenaContext): void {
    // 这个场子看的是敌人的行为，不是玩家能撑多久 —— 所以默认无敌。
    // 想看「被围死」按 `I` 关掉。
    ctx.player.setInvulnerable(true)
    ctx.hud.setNotice('按 I 关掉无敌，就能看到被围死')
  }

  protected override onArenaUpdate(_dtMs: number, ctx: ArenaContext): void {
    // 用**逻辑**时钟算间隔而不是真实时钟：暂停时不该继续补怪。
    // （暂停时场景的 `update` 照常跑，`onArenaUpdate` 也照常被调 —— 它看的是时钟，
    //  而时钟停了，所以这里必须自己判一下。）
    if (ctx.clock.paused) return

    const nowMs = ctx.clock.nowMs
    if (nowMs < this.nextRefillAtMs) return
    if (ctx.enemies.liveEnemies.length >= STEADY_THRESHOLD) return

    this.nextRefillAtMs = nowMs + REFILL_INTERVAL_MS
    // 走 `requestSpawn` 而不是 `spawnNow`：两者最终是同一件事，
    // 但 `requestSpawn` 能顺手写清楚补货的理由，日志里分得出来。
    for (let i = 0; i < REFILL_BATCH; i++) {
      // 用底座的撒点（它会避开墙）。**不要自己按格子算坐标** ——
      // 那样迟早会把一批怪生在柱子里，而卡在柱子里的怪看起来和「寻路坏了」一模一样。
      const p = this.randomPoint()
      ctx.enemies.requestSpawn('splitter', SWARM_GEN, p.x, p.y, 'wave')
    }
  }
}

export const arena: ArenaDefinition = {
  displayName: '压力场',
  description: '150+ 只怪铺满场 + 持续补货。看：queue 排空、ai near/far 比例、frame 不停、pool 回落。',
  scene: SwarmStressArena,
}