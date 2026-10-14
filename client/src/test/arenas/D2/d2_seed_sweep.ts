/**
 * **换种子。** 生成器的正确性不是「一张图看起来对」——而是「一千张图都对」。
 * 单测已经把一千个种子扫过了（`gen/generate.test.ts`），这一场解决的是另一件事：
 *
 * **把那个结论从终端搬到屏幕上，并且让人能亲手换。**
 *
 * 为什么值得单独一场：
 *
 * - 单测报「第 837 个种子红了」的时候，人要在脑子里把种子和画面接起来。
 *   这里按 `N` 换种子，红了的那张图**就在眼前**。
 * - 手感、审美这一类的判断（「这一层是不是太空」「连廊是不是太挤」
 *   「侧室怎么全挂在上面」）**写不进断言**。批量扫一遍然后用眼睛看，
 *   是唯一能做这件事的方式。
 *
 * ## 三个读数分别是哪一层
 *
 * | 读数 | 谁来算 | 它红了意味着 |
 * |---|---|---|
 * | 层 1 可达 | `validate/reachability.ts` 的房间图遍历 | 有房间从起点走不到 —— 「不回头」规则下这一局直接作废 |
 * | 层 2 可达 | 同上，门 → 出生点的 flood fill | 门被堵死、或出生点被围死 —— 怪出不来，房间清不掉 |
 * | 连廊净宽 / 最窄窄口 | 同上，逐段连廊从中线往上下数格，再与每一扇门宽取小 | 比 `minPassageWidth` 还窄 = 肉盾过不去 |
 *
 * 三个都是**纯函数**，不碰 Phaser —— 所以屏幕上的数和终端里的数是同一份代码算的，
 * 不存在「测试场和单测各算各的」。
 *
 * ## 换种子为什么走 `scene.restart()`
 *
 * 因为「把上一次画的东西清干净」比看起来难：`drawFloorplan` 往场景根上直接
 * `add.graphics()` / `add.text()`，场子拿不到那份清单。逐个名字去删是可行的，
 * 但**漏掉一个的失败模式是「上一张图留在原地，和新图叠在一起」**——
 * 那看起来像是生成器画重了，而实际上是清理漏了。
 *
 * `restart()` 把整棵显示树扔掉，不可能漏。代价是当前种子要存在**模块级**变量里
 * （实例会被销毁重建）。这是刻意的交换：拿一个进程内的全局变量，
 * 换「不可能漏清理」。`test/arenas/` 不是产品代码，这个全局不会外泄。
 */

import type { ArenaConfig, ArenaContext, ArenaDefinition } from '../../ArenaBase'
import { ArenaBase, WORLD_WIDTH } from '../../ArenaBase'
import type { RoomsConfig } from '@/domains/procgen/config'
import { drawFloorplan } from '@/domains/procgen/presentation/floorplan'
import { generateDungeon } from '@/domains/procgen/gen/generate'
import { checkReachability } from '@/domains/procgen/validate/reachability'
import { DEFAULT_SEED, D2_SEEDS, generateForArena, loadRoomsConfig, summarise } from './_shared'

/**
 * 缩略图占的高度，下面留给读数。
 *
 * 430 是**量出来的**：底座的按键说明钉在左下角（`Hud.update()` 里
 * `y = 720 − 15*3.4 = 669`，四行），这一场的读数有 12 行 12px（行距 3，约 180px），
 * 所以读数从 444 起到 624 收 —— 和说明之间留 45px，谁也不压谁。
 *
 * 缩到 430 **不损失任何信息**：整层楼 5600—7520px 宽（六张牌的实测范围），
 * 缩略图永远是**被宽度卡住**的（`scale = 1280/宽 ≈ 0.17—0.23`），
 * 而楼层高 840—960px 缩完只有 **143—210px** —— 430 里本来就空一大截。
 * 高度随种子变（有没有挂在下边的侧室、挂了几间），所以这里写的是**范围**，
 * 不是一个数：单个数的注释在这个 change 之后一定会过期。
 */
const PLAN_HEIGHT = 430
/** `A` 键批量扫的种子个数。约 30ms 一个，所以 100 个会卡住三秒左右 —— 提示里写明了。 */
const SWEEP_COUNT = 100
/** 批量扫的起点。与 `generate.test.ts` 的种子表同一起点、同一段步长。 */
const SEED_BASE = 13

// ⚠️ 模块级：`scene.restart()` 会把场子实例销毁重建，实例字段留不住。
let seedIndex = D2_SEEDS.indexOf(DEFAULT_SEED as (typeof D2_SEEDS)[number])
if (seedIndex < 0) seedIndex = 0
/** 上一次按 `A` 的结果。**跨 restart 保留** —— 不然按完键换了场景，结果就没了。 */
let sweepReport: string | null = null

class D2SeedSweepArena extends ArenaBase {
  protected get definition(): ArenaDefinition {
    return arena
  }

  override preload(): void {
    super.preload()
    loadRoomsConfig(this)
  }

  protected configure(): ArenaConfig {
    return { rngSeed: 0xd25e }
  }

  protected override onArenaCreate(ctx: ArenaContext): void {
    const seed = D2_SEEDS[seedIndex] ?? DEFAULT_SEED
    const { map, cfg, elapsedMs } = generateForArena(ctx.scene, seed)
    const reach = checkReachability(map, cfg)

    drawFloorplan(ctx.scene, map, cfg, {
      x: 0,
      y: 0,
      width: WORLD_WIDTH,
      height: PLAN_HEIGHT,
      labels: true,
      doors: true,
      spawns: true,
      obstacles: false,
    })

    const mainCount = map.rooms.filter((r) => r.branch === 'main').length
    const mark = (ok: boolean): string => (ok ? 'OK' : '× 红了')
    // 连廊净宽**逐段量**（顺序同 `map.passages`），这里报的是这一层的最小—最大。
    // 不报平均值：平均值会把「某一段被堵成 40」稀释掉，而那是要当场看见的。
    const clear = reach.passageClearWidths
    const lo = clear.length === 0 ? 0 : Math.min(...clear)
    const hi = clear.length === 0 ? 0 : Math.max(...clear)
    const clearText = clear.length === 0 ? '—' : lo === hi ? `${lo}px` : `${lo}..${hi}px`
    const lines = [
      `D2 · 换种子（${seedIndex + 1}/${D2_SEEDS.length}）`,
      ...summarise({ map, cfg, elapsedMs }),
      '',
      `主干 ${mainCount} · 侧室 ${map.rooms.length - mainCount} · 连廊 ${map.passages.length} 段`,
      `层 1 可达 ${mark(reach.layer1Ok)}（走过 ${reach.visitedRooms}/${reach.roomCount} 间）`,
      `层 2 可达 ${mark(reach.layer2Ok)}`,
      `连廊净宽 ${clearText} × ${clear.length} 段 · 最窄窄口 ${reach.narrowestOpeningWidth}px（下限 ${cfg.minPassageWidth}px）`,
      // 耗时**不在这里再印一遍** —— `summarise()` 的第三行已经有了。
      // 同一张屏上两个「生成耗时」只要有一点不一样，就成了两个真值来源。
      '',
      reach.problems.length === 0
        ? '问题：无'
        : `问题 ${reach.problems.length} 条：${reach.problems[0]}`,
      sweepReport === null
        ? `按 A 扫 ${SWEEP_COUNT} 个种子（会卡住约 3 秒）`
        : sweepReport,
    ]
    ctx.scene.add
      .text(8, PLAN_HEIGHT + 14, lines.join('\n'), {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: reach.layer1Ok && reach.layer2Ok ? '#9ad4ff' : '#ff9a9a',
        lineSpacing: 3,
      })
      .setDepth(1000)

    // ⚠️ `ev.repeat` 必须挡掉。浏览器按住不放会按系统重复率**不停地**发 keydown，
    // 而这两件事一件要重建场景、一件要同步跑 100 次生成（约 3 秒）——
    // 按住 `A` 不放 = 一串 3 秒的冻结接在一起，页面看起来就是死了。
    // （顺带：`A` 同时也是底座的「向左走」键，松开就好，这一场没有墙，走不出事。）
    ctx.scene.input.keyboard?.on('keydown-N', (ev: KeyboardEvent) => {
      if (ev.repeat) return
      seedIndex = (seedIndex + 1) % D2_SEEDS.length
      this.scene.restart()
    })
    ctx.scene.input.keyboard?.on('keydown-A', (ev: KeyboardEvent) => {
      if (ev.repeat) return
      sweepReport = runSweep(cfg)
      this.scene.restart()
    })

    ctx.hud.setNotice('N = 换下一个种子　A = 批量扫 100 个种子（会卡住约 3 秒）')
  }
}

/**
 * 批量扫。**读数和单测用的是同一个 `checkReachability`** ——
 * 这里不许另写一份判定：两份判定对同一张图给出不同结论，
 * 就是「测试场绿了但产品是坏的」那条没有报错的失败链。
 *
 * 步长 `7919`（第 1000 个质数）取自 `generate.test.ts` 的同一张种子表 ——
 * 刻意不换数：两边扫的是**同一批**种子，屏幕上绿了而终端里红了这种事才藏不住。
 */
function runSweep(cfg: RoomsConfig): string {
  const t0 = performance.now()
  let failed = 0
  let firstBadSeed: number | null = null
  let firstBadProblem = ''

  for (let i = 0; i < SWEEP_COUNT; i++) {
    const seed = SEED_BASE + i * 7919
    const r = checkReachability(generateDungeon(seed, cfg), cfg)
    if (r.problems.length > 0) {
      failed++
      if (firstBadSeed === null) {
        firstBadSeed = seed
        firstBadProblem = r.problems[0] ?? ''
      }
    }
  }

  const ms = performance.now() - t0
  if (failed === 0) {
    return `扫完了：${SEED_BASE} 起 ${SWEEP_COUNT} 个种子**全绿**，共 ${ms.toFixed(0)}ms（${(ms / SWEEP_COUNT).toFixed(1)}ms/层）`
  }
  return (
    `扫完了：${SWEEP_COUNT} 个种子里红了 ${failed} 个，共 ${ms.toFixed(0)}ms。` +
    `第一个是种子 ${firstBadSeed}：${firstBadProblem}`
  )
}

export const arena: ArenaDefinition = {
  displayName: 'D2 · 换种子',
  description:
    '按 N 换种子，看新的整层图 + 层1/层2 可达性 + 每段连廊净宽与全层最窄窄口 + 生成耗时。按 A 批量扫 100 个种子，把「一千张图都对」这个结论搬到屏幕上。',
  scene: D2SeedSweepArena,
}