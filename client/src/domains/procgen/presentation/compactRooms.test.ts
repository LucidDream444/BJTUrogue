import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { parseRoomsConfig } from '@/domains/procgen/config'
import { ROOM_KIND_LABELS, type RoomKind } from '@/domains/procgen/model/types'
import { parseCombatConfig } from '@/domains/combat/config'
import { buildDungeonStages } from '@/domains/combat/DungeonStages'
import { compactExtent, compactRoomLayout } from './compactRooms'

/**
 * ⚠️ **这一组量的是「小地图上写不写得上关别」。**
 *
 * `Minimap` 的面板尺寸（300×150）与字号（10px）不是随手挑的，是**照最宽的那个种子
 * 倒推**出来的：紧凑排布在这一局里最宽能到 4880，按面板内框等比缩下来，
 * 最窄的一间只剩 40 来像素，而 `1 普通战` 那一串字要约 40px。
 *
 * 所以这一组钉两件事，任何一件破掉，小地图上的关别都会**悄悄退化成只有号**
 * （代码不报错、画面不报错，只是信息没了）：
 *
 * 1. 一排房间的紧凑外框**不会比量过的那些更宽/更高**（widening 会等比压小每一间）；
 * 2. 最窄的那一间在现面板尺寸下**放得下 `号 + 关别`**。
 *
 * 破了的话有两条路，别硬把断言放宽：要么把 `Minimap` 的 `PANEL` 调大，
 * 要么承认「某些种子下不写关别」并在那边把退化写清楚。
 */
const CONFIG_DIR = fileURLToPath(new URL('../../../../public/config/', import.meta.url))
const readJson = (name: string): unknown => JSON.parse(readFileSync(CONFIG_DIR + name, 'utf8'))

/** 一局的那七个房间参数。和 `BattleScene` 里的 `ROOMS_PER_RUN` 同一组 ——
 *  这里**独立写死**是刻意的：测试要能发现「有人把三个数改成相等」。 */
const PER_RUN = { totalRooms: 7, mainRoomMin: 4, mainRoomMax: 4 }

/** 多个种子 —— 「最窄的一间有多宽」不能只在一个种子上碰巧够。 */
const SEEDS = [1, 2, 3, 13, 777, 837, 7919, 31337, 424242, 20261012]

/**
 * 小地图那套尺寸的**副本**（`domains/combat/Minimap.ts` 的 `PANEL` / `LABEL_FONT`）。
 *
 * ⚠️ 抄过来而不是 import：`Minimap` import 了 Phaser，而 `architecture.test.ts`
 * 钉着「每个 *.test.ts 的依赖闭包里不许有 phaser」。抄的代价是**这两个数漂了
 * 这里不报错** —— 所以那边 `PANEL` / `LABEL_FONT` 的注释里点名了这份测试。
 */
const PANEL = { width: 300, height: 150, padding: 8, titleH: 16 } as const
const LABEL_FONT = 10

/**
 * 标号「号 + 一个空格 + 关别」的宽度**上界**。
 *
 * 按 Microsoft YaHei / 10px 估：一个汉字 ≈ 字号（10），一个数字 ≈ 6、空格 ≈ 3。
 * 取的是上界（宁可判「放不下」也不放过去）—— 真值只有浏览器的排版知道，
 * `Minimap.redraw()` 拿 `Text.width` 实测，这里只是**给面板尺寸兜底**的粗尺子。
 *
 * 这把尺子**在真浏览器里对过账**（2026-10-16，无头 Edge + `measureText`）：
 * 10px 下 `1 普通战` 实测 **38.8px**（这把尺子给 39）、`7 首领` 28.8（给 29）、
 * 12px 的标题 `第 1 / 7 间 · 普通战` 103.4px（面板内宽 284，绰绰有余）。
 * 所以它是**略偏严**的上界，不是随手拍的数。
 */
function labelWidth(order: number, kind: RoomKind): number {
  const label = ROOM_KIND_LABELS[kind]
  return String(order + 1).length * 6 + 3 + label.length * LABEL_FONT
}

function build(seed: number) {
  const rooms = parseRoomsConfig({ ...(readJson('rooms.json') as object), ...PER_RUN })
  const d1 = parseCombatConfig(readJson('combat.json'))
  return buildDungeonStages(seed, rooms, d1)
}

function layoutFor(seed: number) {
  const d = build(seed)
  const rooms = d.rooms.map((r) => r.room)
  const targets = d.rooms.map((r) => r.doorTargets)
  const boxes = compactRoomLayout(rooms, targets)
  return { d, rooms, targets, boxes, ext: compactExtent(boxes) }
}

describe('compactRoomLayout — 紧凑排布', () => {
  it('每间房都排进去了（侧室也不例外）', () => {
    for (const seed of SEEDS) {
      const { rooms, boxes } = layoutFor(seed)
      expect(boxes.size, `种子 ${seed}：排进去的房间数和地图上的房间数对不上`).toBe(rooms.length)
    }
  })

  it('主干教室肩并肩、等高，谁也不压着谁', () => {
    for (const seed of SEEDS) {
      const { d, boxes } = layoutFor(seed)
      let prevRight: number | null = null
      for (const r of d.rooms.filter((x) => x.room.branch === 'main').sort((a, b) => a.order - b.order)) {
        const b = boxes.get(r.order)!
        // 紧挨着：上一间的右缘就是这一间的左缘（缝被收掉了，见那边的文件头）
        if (prevRight !== null)
          expect(b.x, `种子 ${seed}：第 ${r.order + 1} 间的主干之间留着缝`).toBeCloseTo(prevRight, 6)
        expect(b.y, `种子 ${seed}：第 ${r.order + 1} 间的主干不等高`).toBe(0)
        prevRight = b.x + b.w
      }
    }
  })

  it('侧室留在宿主**实际的那一侧**（上/下不能反）', () => {
    // 「小地图显示房间在下面，当前房间却有个上面的门」—— 地图和实际的门位对不上，
    // 比留着缝还糟。这条判据取的是地图坐标里它本来在宿主的哪一边。
    for (const seed of SEEDS) {
      const { rooms, targets, boxes } = layoutFor(seed)
      for (const r of rooms.filter((x) => x.branch === 'side')) {
        // 宿主 = 它唯一那扇门通向的那一间（紧凑排布就是这么认的）
        const host = targets[r.order]!.find((t): t is number => t !== null)
        if (host === undefined) continue
        const mine = boxes.get(r.order)!
        const hostBox = boxes.get(rooms[host]!.order)!
        const wasBelow = r.rect.y > rooms[host]!.rect.y
        // 在下面 → 我的上沿就贴着宿主的下沿；在上面 → 我的下沿贴着宿主的上沿。
        const touching = wasBelow ? mine.y - (hostBox.y + hostBox.h) : hostBox.y - (mine.y + mine.h)
        expect(Math.abs(touching), `种子 ${seed}：第 ${r.order + 1} 间侧室没贴着宿主`).toBeLessThanOrEqual(
          1e-6,
        )
      }
    }
  })
})

describe('compactRoomLayout — 小地图上写不写得上关别', () => {
  /**
   * 这一组是**给 `Minimap` 的面板尺寸兜底的**。量出来的（2026-10-16）：
   * 外框 3680×1120 ~ 4880×1720，按内框 284×118 缩下来最窄的一间 47~49px。
   */
  it('外框不比量过的更宽/更高', () => {
    for (const seed of SEEDS) {
      const { ext } = layoutFor(seed)
      expect(ext.width, `种子 ${seed}：一排房间比量过的更宽了（小地图会把每一间压得更小）`).toBeLessThanOrEqual(
        4880,
      )
      expect(ext.height, `种子 ${seed}：一排房间比量过的更高了`).toBeLessThanOrEqual(1720)
    }
  })

  it('最窄的一间也放得下「号 + 关别」', () => {
    const inner = {
      width: PANEL.width - PANEL.padding * 2,
      height: PANEL.height - PANEL.padding * 2 - PANEL.titleH,
    }
    for (const seed of SEEDS) {
      const { d, boxes, ext } = layoutFor(seed)
      const scale = Math.min(inner.width / ext.width, inner.height / ext.height)
      for (const r of d.rooms) {
        const b = boxes.get(r.order)!
        const w = b.w * scale
        const h = b.h * scale
        const want = labelWidth(r.order, r.room.kind)
        expect(
          w - 4 >= want && h >= LABEL_FONT + 4,
          `种子 ${seed}：第 ${r.order + 1} 间（${r.room.kind}）在小地图上只有 ${w.toFixed(1)}×${h.toFixed(1)}px，` +
            `写不下「${r.order + 1} ${ROOM_KIND_LABELS[r.room.kind]}」（约 ${want}px）—— 关别会退化成只有号。` +
            `调大 Minimap 的 PANEL，或承认这一档不写关别。`,
        ).toBe(true)
      }
    }
  })
})