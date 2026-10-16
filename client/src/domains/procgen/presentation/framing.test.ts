/**
 * 「一间房一屏」的取景尺寸与 zoom。**跑在 node 环境** —— 不加载 Phaser、不碰 DOM。
 *
 * 这一份盯的是两件事：
 *
 * 1. **zoom 要装得下最挤的那一间**，而且装得**紧**（不然「一屏」只是句空话，
 *    四周一大圈空地，隔壁房的怪照样在画面里动）。
 * 2. **不许按「全层包围盒」算**。那是这个函数最像对的错法：并集量的是跨度，
 *    一排教室横着排开就是整层那么宽 —— 实测种子里 7560px，zoom 会算成 0.17，
 *    也就是整层缩成一屏，而函数名字还叫「一间房一屏」。它**不报错**，
 *    画面上也不像坏了，只是每间教室小得看不清门在哪。
 *
 * 配置读真文件、种子写死：与 `colliders.test.ts` / `roomFlow.test.ts` 同一手法。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { parseRoomsConfig, type RoomsConfig } from '../config'
import { generateDungeon } from '../gen/generate'
import { bottom, left, right, top } from '../model/rect'
import { largestViewSize, roomFitSize, roomViewBox, zoomFor } from './framing'

const CONFIG_DIR = fileURLToPath(new URL('../../../../public/config/', import.meta.url))

const cfg: RoomsConfig = parseRoomsConfig(
  JSON.parse(readFileSync(CONFIG_DIR + 'rooms.json', 'utf8')),
)

const SEEDS = [837, 13, 7932, 15851]

/** 视口写死一个常见的笔记本尺寸 —— 与 `docs/UI规范.md` 的分辨率口径一致。 */
const VIEW = { width: 1280, height: 720 }

const sizeOf = (seed: number) => largestViewSize(generateDungeon(seed, cfg), cfg)

/**
 * 手算的上界：最大档位 + 两侧各一段连廊 + 两侧各留一格。
 * **只用来夹住**，不用来取值 —— 取值是从真地图上量出来的（见 `largestViewSize`）。
 */
const BOUND = {
  width:
    Math.max(...cfg.mainWidthTiers, ...cfg.sideRoomTiers.map((t) => t.width)) +
    2 * cfg.roomGap +
    2 * cfg.navCellSize,
  height:
    cfg.mainRoomHeight +
    Math.max(...cfg.sideRoomTiers.map((t) => t.height)) +
    2 * cfg.navCellSize,
}

describe('D2 取景 — 「一间房一屏」要装下多大一块', () => {
  it('**不是全层的包围盒** —— 逐维取最大，量出来的是跨度就说明写成了并集', () => {
    for (const seed of SEEDS) {
      const s = sizeOf(seed)
      expect(s.width, `种子 ${seed} 的取景宽（并集会得到 5000+）`).toBeLessThanOrEqual(BOUND.width)
      expect(s.height, `种子 ${seed} 的取景高`).toBeLessThanOrEqual(BOUND.height)
    }
  })

  it('夹得够紧：四个种子里都真的顶到过上界', () => {
    for (const seed of SEEDS) {
      const s = sizeOf(seed)
      // 宽顶到上界 = 这一层有「两侧都有连廊的最大档主干教室」；高顶到上界 = 有最高档的侧室。
      // 只要有一条顶不到，说明上界松了 —— 松了的上界挡不住并集那个错法。
      expect(
        s.width === BOUND.width || s.height === BOUND.height,
        `种子 ${seed}：取景 ${s.width}×${s.height}，上界 ${BOUND.width}×${BOUND.height}`,
      ).toBe(true)
    }
  })

  it('种子 837：1760×1120 —— 最宽的那间是主干 #1/#3/#9，最高的那间是带侧室的 #11', () => {
    // 2026-10-16 房间放大（主干 640×280 → 1280×600，见 rooms.json 的 _main_height_comment）
    expect(sizeOf(837)).toEqual({ width: 1760, height: 1120 })
  })

  it('取景尺寸与逐间量出来的最大值逐项相等（不是「差不多」）', () => {
    for (const seed of SEEDS) {
      const map = generateDungeon(seed, cfg)
      let w = 0
      let h = 0
      for (const room of map.rooms) {
        const b = roomViewBox(map, cfg, room)
        w = Math.max(w, right(b) - left(b))
        h = Math.max(h, bottom(b) - top(b))
      }
      expect(sizeOf(seed)).toEqual({ width: w, height: h })
    }
  })
})

describe('D2 取景 — zoom', () => {
  it('装得下：每间房的框乘上 zoom 都不超出视口', () => {
    for (const seed of SEEDS) {
      const map = generateDungeon(seed, cfg)
      const zoom = zoomFor(sizeOf(seed), VIEW.width, VIEW.height)
      for (const room of map.rooms) {
        const b = roomViewBox(map, cfg, room)
        const w = right(b) - left(b)
        const h = bottom(b) - top(b)
        expect(w * zoom, `种子 ${seed} 房间 #${room.order} 装不下（宽）`).toBeLessThanOrEqual(
          VIEW.width + 1e-9,
        )
        expect(h * zoom, `种子 ${seed} 房间 #${room.order} 装不下（高）`).toBeLessThanOrEqual(
          VIEW.height + 1e-9,
        )
      }
    }
  })

  it('装得紧：总有一条边正好顶到视口 —— 取 min 而不是 max', () => {
    for (const seed of SEEDS) {
      const s = sizeOf(seed)
      const zoom = zoomFor(s, VIEW.width, VIEW.height)
      const touches = s.width * zoom >= VIEW.width - 1e-9 || s.height * zoom >= VIEW.height - 1e-9
      expect(touches, `种子 ${seed}：${s.width}×${s.height} @ zoom ${zoom.toFixed(3)} 四周还有空地`).toBe(
        true,
      )
    }
  })

  it('种子 837 在 1280×720 上是 720/1120 = 0.643 —— 卡在**高**这边', () => {
    // 1760×1120：宽 1280/1760 = 0.727、高 720/1120 = 0.643，取小的那个。
    // 房间放大之后连「一层的最大取景」也一起变大了，于是又回到**高**这边卡住。
    expect(zoomFor(sizeOf(837), 1280, 720)).toBeCloseTo(720 / 1120, 9)
  })

  it('最大档位变大 → zoom 跟着变小（不是写死一个常数就完事）', () => {
    const base = { width: 1120, height: 680 }
    const bigger = { width: 1440, height: 680 }
    expect(zoomFor(bigger, 1280, 720)).toBeLessThan(zoomFor(base, 1280, 720))

    // 高这边同理：侧室档位长高，zoom 必须跟着退
    const taller = { width: 1120, height: 1040 }
    expect(zoomFor(taller, 1280, 720)).toBeLessThan(zoomFor(base, 1280, 720))
  })

  it('视口变了 → zoom 跟着变，且换的正是限制的那条边', () => {
    const s = { width: 1120, height: 680 }
    expect(zoomFor(s, 2560, 720)).toBeCloseTo(720 / 680, 9) // 宽放宽了，限制的仍是高
    expect(zoomFor(s, 1280, 1440)).toBeCloseTo(1280 / 1120, 9) // 高放宽了，限制的换成了宽
    expect(zoomFor(s, 2240, 1360)).toBeCloseTo(2, 9) // 两倍视口 → 两倍 zoom
  })

  it('视口或取景尺寸不合法时当场抛，不返回 0 / Infinity', () => {
    expect(() => zoomFor({ width: 1120, height: 680 }, 0, 720)).toThrow(/视口/)
    expect(() => zoomFor({ width: 1120, height: 680 }, 1280, 0)).toThrow(/视口/)
    expect(() => zoomFor({ width: 0, height: 680 }, 1280, 720)).toThrow(/取景尺寸/)
  })
})

/**
 * 「**教室占满屏幕**」那一套（`roomFitSize`）—— 与上面「装下取景框」是一对，
 * 但装的东西不一样：这里装的是**教室本体**，一个侧室、一段连廊都不并进来。
 * 用户看过整层场子之后的反馈原文：「教室应该是占满屏幕的」。
 */
describe('D2 取景 — 「教室占满屏幕」装的是教室本体', () => {
  const margin = cfg.wallThickness + cfg.navCellSize / 2
  const fitOf = (seed: number) => roomFitSize(generateDungeon(seed, cfg), cfg)

  it('逐项等于「最宽的那间 + 两圈留白」「最高的那间 + 两圈留白」', () => {
    for (const seed of SEEDS) {
      const map = generateDungeon(seed, cfg)
      const w = Math.max(...map.rooms.map((r) => r.rect.width))
      const h = Math.max(...map.rooms.map((r) => r.rect.height))
      expect(fitOf(seed)).toEqual({ width: w + margin * 2, height: h + margin * 2 })
    }
  })

  it('比取景框**小**：门外并进来的侧室与连廊不再算进这一块', () => {
    for (const seed of SEEDS) {
      const map = generateDungeon(seed, cfg)
      const box = largestViewSize(map, cfg)
      const fit = roomFitSize(map, cfg)
      expect(fit.width, `种子 ${seed} 的宽没有比取景框小`).toBeLessThan(box.width)
      expect(fit.height, `种子 ${seed} 的高没有比取景框小`).toBeLessThan(box.height)
    }
  })

  it('装得下：每间教室 + 两圈留白乘上 zoom 都进得了视口（每边至少留下一堵墙）', () => {
    for (const seed of SEEDS) {
      const map = generateDungeon(seed, cfg)
      const zoom = zoomFor(roomFitSize(map, cfg), VIEW.width, VIEW.height)
      for (const room of map.rooms) {
        const w = (room.rect.width + margin * 2) * zoom
        const h = (room.rect.height + margin * 2) * zoom
        expect(w, `种子 ${seed} 房间 #${room.order} 装不下（宽）`).toBeLessThanOrEqual(
          VIEW.width + 1e-9,
        )
        expect(h, `种子 ${seed} 房间 #${room.order} 装不下（高）`).toBeLessThanOrEqual(
          VIEW.height + 1e-9,
        )
      }
    }
  })

  it('占满：最大的那间教室乘上 zoom 之后**总有一条边正好贴到视口边**', () => {
    for (const seed of SEEDS) {
      const map = generateDungeon(seed, cfg)
      const fit = roomFitSize(map, cfg)
      const zoom = zoomFor(fit, VIEW.width, VIEW.height)
      const touches =
        fit.width * zoom >= VIEW.width - 1e-9 || fit.height * zoom >= VIEW.height - 1e-9
      expect(touches, `种子 ${seed}：${fit.width}×${fit.height} @ ${zoom.toFixed(3)} 四周还有空地`).toBe(
        true,
      )
    }
  })

  it('种子 837：1400×720 → zoom 1280/1400 = 0.914，最大那间占屏宽 91%、屏高 76%', () => {
    // 1280×600 的教室本体 + 两圈 60。宽 1280/1400 = 0.914、高 720/720 = 1 —— **卡宽**。
    const zoom = zoomFor(fitOf(837), VIEW.width, VIEW.height)
    expect(fitOf(837)).toEqual({ width: 1400, height: 720 })
    expect(zoom).toBeCloseTo(1280 / 1400, 9)
    expect((1280 * zoom) / VIEW.width).toBeGreaterThan(0.8)
    expect((600 * zoom) / VIEW.height).toBeGreaterThan(0.6)
  })
})