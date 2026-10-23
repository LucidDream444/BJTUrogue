/**
 * 「一间房一屏」的取景尺寸与 zoom。**跑在 node 环境** —— 不加载 Phaser、不碰 DOM。
 *
 * 这一份盯的是四类**不报错**的错：
 *
 * 1. **zoom 装不下最挤的那一间** —— 取 max 而不是 min，或干脆写死一个数。
 *    被切掉的那两条边上是**墙和门**，玩家看到的是「这间房好像没有北墙」。
 * 2. **「装得紧」不是一句空话**：zoom 要正好装下、四周不留一大圈空地 ——
 *    空地本身不报错，代价是隔壁房的怪照样在画面里动。
 * 3. **按「全层跨度」算** —— 写成并集或包围盒。这是这两个函数**最像对的错法**：
 *    并集量的是跨度，一排教室横着排开就是整层那么宽。它不报错、画面上也不像坏了，
 *    只是每间教室小得看不清门在哪，而函数名字还叫「一间房一屏」。
 * 4. **「教室占满屏幕」拿错了框** —— `roomFitSize` 装的是教室**本体**，
 *    拿 `largestViewSize`（会把门外那一整块并进来）去定它的缩放，教室会被挤小。
 *    ★ v5 里这一条的后果从「挤小一点」变成「根本不是一个量级」（4840 vs 1920，见下）。
 *
 * ## ★ v5：几何不再随种子变 —— 这一份只用一个种子，扫的是**画布尺寸**
 *
 * v4 及以前房间尺寸是**算**出来的（按种子抽档位），所以这里写着四个种子、
 * 每个 describe 都扫一遍 —— 那时四个种子真的是四张不同的图。v5 的几何全部来自
 * `floor-plan.json`（照 6F 平面图照片量的），种子只决定**内容**（关别 / 桌椅 / 刷怪点），
 * 而取景几何一个都不读它们：**换种子不会变一个像素**（本文件 2026-10-20 现量过
 * 837 / 13 / 7932 / 15851，四个种子给出的是同一个数）。于是「扫种子」在这里已经
 * 什么都不测了（扫四个 = 扫一个），本文件只留 `SEED = 837`；该扫的东西换成
 * `VIEWPORTS` —— 画布尺寸才是 zoom 真正会随它变的东西（《UI规范》§二.4 决定用
 * `Scale.RESIZE`，窗口尺寸就是画布尺寸，它本来就是个变量）。
 *
 * 跟着删掉的一条：「夹得够紧：四个种子里都真的顶到过上界」。那条比的是**手算的上界**，
 * 而那个式子依赖 `mainWidthTiers` / `sideRoomTiers` / `roomGap` 三个已删字段；
 * 它原本的用途只是替「不是包围盒」那条证明「上界不松」，而 v5 的读数已经被
 * 「4840×1840」那条钉死、逐维相等又有另一条在管 —— 它没有独立要挡的东西了。
 *
 * 量出来的两个数（2026-10-20 现测，v5 之后；v4 的读数已随档位/连廊模型一起作废）：
 *
 * | 量 | 值 | 谁贡献的 |
 * |---|---|---|
 * | `largestViewSize` | **4840×1840** | 宽：朝 `C_W` 开门的那些房（`C_W` 长 4760px）；高：`YF611` |
 * | `roomFitSize` | **1920×1160** | 宽：`YF604` 的 1800；高：`YF611` 的 1040 |
 *
 * ⚠️ **这两个函数 v5 里不再决定产品画面上任何一屏的缩放** —— 依据是**它们没有调用点**
 * （`roomFitSize` / `largestViewSize` / `zoomFor` 除了本文件与 `framing.ts`
 * 没有任何引用；白箱场子只用 `roomViewBox`）**，而且「一间房一屏」这个取景口径本身
 * 已经废掉了**：✅ 用户 **2026-10-21 定了 A「整层连续 + 相机跟随」**，产品那边用的是
 * `combat.json` 的 `camera` + `BattleScene.fitCamera()`。
 * （本行原先写「2026-10-19 用户选的是……」—— 那天没有出处，2026-10-20 自查删掉；
 * 结论虽在 10-21 被用户确认，但**当时删得对**：判据是「有没有出处」，不是「后来对不对」。）
 * 所以这一份测的是「这两个函数自己还自洽吗」，**不是**「产品的一屏长这样」。
 *
 * 配置读真文件、种子写死：与 `colliders.test.ts` / `roomFlow.test.ts` 同一手法、同一个理由。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { parseRoomsConfig, type RoomsConfig } from '../config'
import { generateDungeon } from '../gen/generate'
import { parseFloorPlan, type FloorPlan } from '../gen/floorPlan'
import { bottom, left, right, top } from '../model/rect'
import type { DungeonMap } from '../model/types'
import { largestViewSize, roomFitSize, roomViewBox, zoomFor } from './framing'
import type { ViewSize } from './framing'

const CONFIG_DIR = fileURLToPath(new URL('../../../../public/config/', import.meta.url))

const readJson = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(CONFIG_DIR + name, 'utf8')) as Record<string, unknown>

const cfg: RoomsConfig = parseRoomsConfig(readJson('rooms.json'))

/**
 * 整层楼的几何 —— 与**种子无关**（`floor-plan.json` 里写死的 6F 平面图）。
 *
 * ⚠️ 它现在是 `generateDungeon` 的**第三个参数**：几何与内容分了家（v5），
 * 种子只决定关别、障碍物、刷怪点。所以这里解析**一次**、全文件共用。
 */
const plan: FloorPlan = parseFloorPlan(readJson('floor-plan.json'), cfg)

/**
 * 只用一个种子：v5 的几何与种子无关（见文件头），换种子量出来的是同一张图。
 *
 * v4 这里的 `SEEDS = [837, 13, 7932, 15851]` 是必要的 —— 那时房间尺寸按种子抽，
 * 四个种子是四张不同的图；现在那四个数只会把同一份几何量四遍。
 */
const SEED = 837

/**
 * 画布尺寸 —— **这一份里真正会变的东西**（几何不随种子变，见文件头）。
 *
 * 《UI规范》§二.4 决定用 `Scale.RESIZE`（窗口尺寸就是画布尺寸），所以
 * 「装得下 / 装得紧」不能只在一个尺寸上成立：1280×720 是常见的笔记本尺寸，
 * 另外三个是常见的桌面 / 窗口尺寸。
 */
const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 1024, height: 768 },
] as const

/** zoom 用例最常问的那个视口。单独拎出来只为了失败信息好读。 */
const VIEW = VIEWPORTS[0]

const mapOf = (seed: number): DungeonMap => generateDungeon(seed, cfg, plan)

/** 取景框逐维最大 —— 全层一个数，与种子无关（见文件头）。 */
const sizeOf = (seed: number): ViewSize => largestViewSize(mapOf(seed), cfg)

/** 「教室占满屏幕」要装下的那一块（教室本体 + 两圈留白，门外一格都不并）。 */
const fitOf = (seed: number): ViewSize => roomFitSize(mapOf(seed), cfg)

/**
 * 把全层所有取景框**并**起来的那一块 —— 只用来质检 `largestViewSize` 没写成它。
 * `largestViewSize` 要的是**逐维取最大**而不是并集：并集量的是跨度（见它文件头）。
 */
function unionOfViewBoxes(map: DungeonMap): ViewSize {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const room of map.rooms) {
    const b = roomViewBox(map, cfg, room)
    x0 = Math.min(x0, left(b))
    x1 = Math.max(x1, right(b))
    y0 = Math.min(y0, top(b))
    y1 = Math.max(y1, bottom(b))
  }
  return { width: x1 - x0, height: y1 - y0 }
}

describe('D2 取景 — 「一间房一屏」要装下多大一块', () => {
  it('**不是全层的包围盒** —— 量出来的是跨度就说明写成了并集', () => {
    // ★ v5 换了判据。v4 这里比的是「手算上界」（最大档位 + 两段连廊 + 两格留白），
    // 那个式子依赖 mainWidthTiers / sideRoomTiers / roomGap —— 三个字段随 v5 一起删了，
    // 而 `framing.ts` 也明确说「框有多大别手推、跑 largestViewSize」（那里记着
    // 一次心算错 40 的账）。v5 直接对着**跨度量**：把全层 16 个取景框并起来是
    // 10600×3000（比 bounds 还大一圈 —— 并进来的走廊四面各留了一格），
    // 整层包围盒是 10520×2920，而逐维最大才是 4840×1840。
    // 写成并集 / 包围盒的话，下面四条当场红，且红出来的数大得一眼认得出。
    const map = mapOf(SEED)
    const s = sizeOf(SEED)
    const union = unionOfViewBoxes(map)
    expect(s.width, `取景宽 ${s.width} —— 并集是 ${union.width}`).toBeLessThan(union.width)
    expect(s.height, `取景高 ${s.height} —— 并集是 ${union.height}`).toBeLessThan(union.height)
    expect(s.width, `取景宽 ${s.width} —— 全层才 ${map.bounds.width} 宽`).toBeLessThan(
      map.bounds.width,
    )
    expect(s.height, `取景高 ${s.height} —— 全层才 ${map.bounds.height} 高`).toBeLessThan(
      map.bounds.height,
    )
  })

  it('整层楼的取景尺寸是 4840×1840 —— 宽被 C_W（4760px 的长走廊）撑开，高来自 YF611', () => {
    // ★ v5 全换了：v4 这里是 1760×1120（「最宽的是主干 #1/#3/#9，最高的是带侧室的 #11」）
    // —— 主干 / 侧室 / 尺寸档位三个概念随 v5 一起没了，那个读数只对 v4 的几何成立。
    //
    // 4840 = 「房间 + 两侧各一格」再并进 C_W 那一段（4760px 长 + 两侧各一格）。
    // 朝 C_W 开门的房不止一间（楼梯间、YF601/602/603/613/614/615），随便哪一间都顶到这个数。
    // 1840 = YF611 的框高：本体 1040，并进 C_M（680px 高）之后比 YF604 的 1760 还高。
    // ⚠️ 4840 不是笔误：平面图上一条走廊就是几千像素，取景框把它整段并进来自然就是这个量级
    // —— `framing.ts` 的 largestViewSize 注释里记着这笔账（「一间房一屏」这个口径
    // 在连续平面上不再成立，所以它今天只服务白箱调试）。
    expect(sizeOf(SEED)).toEqual({ width: 4840, height: 1840 })
  })

  it('取景尺寸与逐间量出来的最大值逐项相等（不是「差不多」）', () => {
    const map = mapOf(SEED)
    let w = 0
    let h = 0
    for (const room of map.rooms) {
      const b = roomViewBox(map, cfg, room)
      w = Math.max(w, right(b) - left(b))
      h = Math.max(h, bottom(b) - top(b))
    }
    expect(sizeOf(SEED)).toEqual({ width: w, height: h })
  })
})

describe('D2 取景 — zoom', () => {
  it('装得下：每间房的框乘上 zoom 都不超出视口（四种画布尺寸）', () => {
    const map = mapOf(SEED)
    const s = sizeOf(SEED)
    for (const VIEW of VIEWPORTS) {
      const zoom = zoomFor(s, VIEW.width, VIEW.height)
      for (const room of map.rooms) {
        const b = roomViewBox(map, cfg, room)
        const w = right(b) - left(b)
        const h = bottom(b) - top(b)
        expect(
          w * zoom,
          `${VIEW.width}×${VIEW.height}：${room.id} 装不下（宽）`,
        ).toBeLessThanOrEqual(VIEW.width + 1e-9)
        expect(
          h * zoom,
          `${VIEW.width}×${VIEW.height}：${room.id} 装不下（高）`,
        ).toBeLessThanOrEqual(VIEW.height + 1e-9)
      }
    }
  })

  // 这条守的是 zoom 的**下界**，不是「取 min 而不是 max」：
  // 「总有一条边顶到视口」等价于 `zoom ≥ min(视口宽/框宽, 视口高/框高)` ——
  // 也就是「没按一个**比 s 更大的框**去算 zoom」（s = largestViewSize）。按并集
  // （10600×3000）或整层包围盒（10520×2920）算出来的 zoom 两条边都够不着 ——
  // 四个 VIEWPORTS 全红，2026-10-20 现测。旧名字里那句「取 min 而不是 max」
  // 是它兑现不了的承诺，它兑现的是「没按更松的框算」。
  //
  // ⚠️ **它在「取 max」下照样绿**：max ≥ min，总有一条边顶到（实测四个 VIEWPORTS 全绿）——
  // 拦 max 的是**上一条**「装得下」（max 时逐间检查，有 12 间的框横着超出视口，
  // 四个视口全红，实测）。别再把这条当 min/max 的判据。
  it('装得紧：zoom 不小于「正好装下」的值 —— 按并集 / 包围盒这类更大的框算 zoom 会在这里红', () => {
    const s = sizeOf(SEED)
    for (const VIEW of VIEWPORTS) {
      const zoom = zoomFor(s, VIEW.width, VIEW.height)
      const touches = s.width * zoom >= VIEW.width - 1e-9 || s.height * zoom >= VIEW.height - 1e-9
      expect(
        touches,
        `${VIEW.width}×${VIEW.height}：${s.width}×${s.height} @ zoom ${zoom.toFixed(3)} 四周还有空地`,
      ).toBe(true)
    }
  })

  it('4840×1840 在 1280×720 上是 1280/4840 = 0.264 —— 卡在**宽**这边', () => {
    // ★ v5 反过来了：v4 是 720/1120 = 0.643、卡在**高**这边（框 1760×1120）。
    // 现在 4840/1840 = 2.63 比视口 1280/720 = 1.78 更极端 ——
    // min(1280/4840 ≈ 0.2645，720/1840 ≈ 0.3913) 取的是宽那个。
    expect(zoomFor(sizeOf(SEED), 1280, 720)).toBeCloseTo(1280 / 4840, 9)
  })

  it('取景尺寸变大 → zoom 跟着变小（不是写死一个常数就完事）', () => {
    // ★ v5 里没有「档位」了（那个词随尺寸档位表一起删了），基准换成现测的 roomFitSize。
    const base = { width: 1920, height: 1160 }
    const wider = { width: 2460, height: 1160 }
    expect(zoomFor(wider, VIEW.width, VIEW.height)).toBeLessThan(
      zoomFor(base, VIEW.width, VIEW.height),
    )

    // 高这边同理：框长高，zoom 必须跟着退
    const taller = { width: 1920, height: 1480 }
    expect(zoomFor(taller, VIEW.width, VIEW.height)).toBeLessThan(
      zoomFor(base, VIEW.width, VIEW.height),
    )
  })

  it('视口变了 → zoom 跟着变，且换的正是限制的那条边', () => {
    const s = { width: 1920, height: 1160 }
    expect(zoomFor(s, 2560, 720)).toBeCloseTo(720 / 1160, 9) // 宽放宽了，限制的仍是高
    expect(zoomFor(s, 1920, 1440)).toBeCloseTo(1, 9) // 高放宽（1440/1160 > 1）了，限制的换成了宽（1920/1920 = 1）
    expect(zoomFor(s, 3840, 2320)).toBeCloseTo(2, 9) // 两倍视口 → 两倍 zoom
  })

  it('视口或取景尺寸不合法时当场抛，不返回 0 / Infinity', () => {
    expect(() => zoomFor({ width: 1920, height: 1160 }, 0, 720)).toThrow(/视口/)
    expect(() => zoomFor({ width: 1920, height: 1160 }, 1280, 0)).toThrow(/视口/)
    expect(() => zoomFor({ width: 0, height: 1160 }, 1280, 720)).toThrow(/取景尺寸/)
  })
})

/**
 * 「**教室占满屏幕**」那一套（`roomFitSize`）—— 与上面「装下取景框」是一对，
 * 但装的东西不一样：这里装的是**教室本体**，门外那条走廊一格都不并进来。
 * 用户看过整层场子之后的反馈原文：「教室应该是占满屏幕的」。
 */
describe('D2 取景 — 「教室占满屏幕」装的是教室本体', () => {
  const margin = cfg.wallThickness + cfg.navCellSize / 2

  it('逐项等于「最宽的那间 + 两圈留白」「最高的那间 + 两圈留白」', () => {
    const map = mapOf(SEED)
    const w = Math.max(...map.rooms.map((r) => r.rect.width))
    const h = Math.max(...map.rooms.map((r) => r.rect.height))
    expect(fitOf(SEED)).toEqual({ width: w + margin * 2, height: h + margin * 2 })
  })

  it('比取景框**小**：门外并进来的整条走廊不再算进这一块', () => {
    // ★ v5 里差得比 v4 远得多：v4 这条说的是「侧室与连廊不再算」（差一圈边上），
    // 现在差的是**门外那一整条走廊** —— 取景框 4840×1840、本体 + 留白 1920×1160。
    // 拿取景框定缩放的话，最大那间 YF604（1800 宽）会从占屏宽 87% 掉到 37%
    // （`framing.ts` 的 roomFitSize 注释里那张表算的正是这一笔）。
    const map = mapOf(SEED)
    const box = largestViewSize(map, cfg)
    const fit = roomFitSize(map, cfg)
    expect(fit.width, `取景框宽 ${box.width}、本体 + 留白宽 ${fit.width}`).toBeLessThan(box.width)
    expect(fit.height, `取景框高 ${box.height}、本体 + 留白高 ${fit.height}`).toBeLessThan(
      box.height,
    )
  })

  it('装得下：每间教室 + 两圈留白乘上 zoom 都进得了视口（每边至少留下一堵墙）', () => {
    const map = mapOf(SEED)
    const fit = fitOf(SEED)
    for (const VIEW of VIEWPORTS) {
      const zoom = zoomFor(fit, VIEW.width, VIEW.height)
      for (const room of map.rooms) {
        const w = (room.rect.width + margin * 2) * zoom
        const h = (room.rect.height + margin * 2) * zoom
        expect(w, `${VIEW.width}×${VIEW.height}：${room.id} 装不下（宽）`).toBeLessThanOrEqual(
          VIEW.width + 1e-9,
        )
        expect(h, `${VIEW.width}×${VIEW.height}：${room.id} 装不下（高）`).toBeLessThanOrEqual(
          VIEW.height + 1e-9,
        )
      }
    }
  })

  it('占满：最大的那间教室乘上 zoom 之后**总有一条边正好贴到视口边**', () => {
    const fit = fitOf(SEED)
    for (const VIEW of VIEWPORTS) {
      const zoom = zoomFor(fit, VIEW.width, VIEW.height)
      const touches =
        fit.width * zoom >= VIEW.width - 1e-9 || fit.height * zoom >= VIEW.height - 1e-9
      expect(
        touches,
        `${VIEW.width}×${VIEW.height}：${fit.width}×${fit.height} @ ${zoom.toFixed(3)} 四周还有空地`,
      ).toBe(true)
    }
  })

  it('1920×1160 → 在 1280×720 上 zoom = 720/1160 = 0.621，最大那间（YF604）占屏宽 87%、屏高 83%', () => {
    // ★ v5 全换了：v4 是 1400×720 → 1280/1400 = 0.914、卡**宽**。
    // 现在本体最大的是 YF604（1800×960），加两圈 60 得 1920×1160；
    // min(1280/1920 ≈ 0.667，720/1160 ≈ 0.621) → 这回卡**高**。
    const zoom = zoomFor(fitOf(SEED), VIEW.width, VIEW.height)
    expect(fitOf(SEED)).toEqual({ width: 1920, height: 1160 })
    expect(zoom).toBeCloseTo(720 / 1160, 9)
    expect((1800 * zoom) / VIEW.width).toBeGreaterThan(0.85) // YF604 的 1800 占屏宽 87%
    expect((960 * zoom) / VIEW.height).toBeGreaterThan(0.8) // 占屏高 83%
  })
})
