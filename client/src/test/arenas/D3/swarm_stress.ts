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
 * ## ⚠️ 这个场子默认的怪**不会分裂** —— 那是设计如此，不是坏了
 *
 * 默认入群的是**第三代**（`childCount: 0`），就是为了让「数量」和「分裂链」
 * 两件事不互相干扰。所以在这里打爆一只怪、什么也没出来，是对的。
 *
 * 这条以前只写在源码注释里，没写在画面上 —— 于是「分裂怪不分裂」看起来完全像
 * 一个 bug（确实被这么报过一次）。现在 HUD 上的提示行**一直**标着当前是哪一代。
 * 想在这里验分裂链：**按 `G` 换成第一代**。
 *
 * ## 按 `G` 换一代之后，别急着按 `0` 清场
 *
 * 换到第一代之后按 `0`，会一次性打死所有怪，包括**第一代分裂怪** ——
 * 一按下去，场上会瞬间多出两倍的第二代。那是对的（清场就该走完整的死亡流程），
 * 但会看起来像「越清越多」。想真的清干净，按 `0` 之后等它分裂完，再按一次。
 */

import type { ArenaConfig, ArenaDefinition, ArenaContext } from '../../ArenaBase'
import { ArenaBase, WORLD_HEIGHT, WORLD_WIDTH } from '../../ArenaBase'

/** 开局的量。印在 180 的软上限之上，好让 `queue` 有一次明显的涨落 */
const INITIAL_SWARM = 150
const INITIAL_TANKS = 8
/** 稳态：活着的怪少于这个数就补一批 */
const STEADY_THRESHOLD = 90
/** 补一批多少只 */
const REFILL_BATCH = 60
/** 两次补货之间至少隔这么久，免得每帧都在补 */
const REFILL_INTERVAL_MS = 1500

/** 切换入群代际的键 */
const GEN_KEY = 'G'

/**
 * 默认用**第二代**：它 `childCount: 0`，**不再分裂** ——
 * 「数量」和「分裂链」两件事于是不会互相干扰，`queue` 的涨落才读得干净。
 *
 * ⚠️ **所以在这个场子里看到「打爆了不分裂」是设计如此，不是分裂坏了。**
 * 想验分裂链去 `splitter_chain`；想在这里看「人多 + 分裂」，按 `G`。
 */
const SWARM_GEN_TERMINAL = 2
/** 按 `G` 换到这一代：会分裂，用来验「人多的时候分裂链还对不对」 */
const SWARM_GEN_SPLITTING = 0

class SwarmStressArena extends ArenaBase {
  private nextRefillAtMs = 0
  /** 当前入群的那一代。改它只影响**之后**出生的怪，已经在场上的不动 */
  private gen = SWARM_GEN_TERMINAL

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
        { kind: 'splitter', gen: SWARM_GEN_TERMINAL, count: INITIAL_SWARM },
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
    this.showNotice(ctx)

    // 换入群代际。**只影响之后出生的怪** —— 已经在场上的那批不会变，
    // 所以按下之后要看 `queue` 里那批（和补货的新怪）才是新代际。
    ctx.scene.input.keyboard?.on(`keydown-${GEN_KEY}`, () => {
      this.gen = this.gen === SWARM_GEN_TERMINAL ? SWARM_GEN_SPLITTING : SWARM_GEN_TERMINAL
      // 换完立刻补一批，不然要等下一次补货间隔才看得见差别。
      this.nextRefillAtMs = 0
      this.showNotice(ctx)
    })
  }

  /** 提示行必须**一直说清当前是哪一代**：否则「不分裂」和「分裂坏了」长得一样。 */
  private showNotice(ctx: ArenaContext): void {
    const splitting = this.gen !== SWARM_GEN_TERMINAL
    ctx.hud.setNotice(
      `第 ${this.gen + 1} 代${splitting ? '（会分裂）' : '（不分裂，设计如此）'}   ` +
        `${GEN_KEY} 换一代   I 关掉无敌`,
    )
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
      ctx.enemies.requestSpawn('splitter', this.gen, p.x, p.y, 'wave')
    }
  }
}

export const arena: ArenaDefinition = {
  displayName: '压力场',
  description:
    '150+ 只怪铺满场 + 持续补货。看：queue 排空、moving 不掉、ai near/far 比例、frame 不停、pool 回落。G 换代际验分裂。',
  scene: SwarmStressArena,
}