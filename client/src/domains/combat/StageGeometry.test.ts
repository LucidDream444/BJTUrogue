import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCombatConfig } from './config'
import { fitMapFrame, parseStageCollisions, stageGeometry } from './StageGeometry'
import { TerrainMap } from './TerrainMap'
import { FlowField } from '@/domains/enemies/nav/flowField'

const read = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../public/config/${name}`, import.meta.url), 'utf8'))
const cfg = parseCombatConfig(read('combat.json'))
const raw = read('stage-collisions.json')
// ⚠️ ★ 修（2026-10-23）：这里用的是**夹具自己的关数**，不是 `cfg.arena.maxStages`。
//
// 这份 `stage-collisions.json` 是 v4 时代**手画的三关**，今天只剩这个文件在用
// （产品那条路走 D2 的 `buildDungeonStages()`，层数由 `floors.json` 决定）。
// 一局从三层变四层之后，`parseStageCollisions(raw, 4)` 会因为「关卡数量无效」
// **在 import 那一刻就抛** —— 整个文件一条用例都跑不到，报的却是一句
// 「地图尺寸、导航网格或关卡数量无效」，看不出是层数变了。
const STAGES = raw.stages.length
const layouts = parseStageCollisions(raw, STAGES)
const frame = fitMapFrame(
  cfg.arena.width,
  cfg.arena.height,
  layouts.sourceSize.width,
  layouts.sourceSize.height,
)
const point = (x: number, y: number) => ({
  x: frame.x + x * frame.scale,
  y: frame.y + y * frame.scale,
})
const map = (stage: number) => {
  const terrain = new TerrainMap(cfg, layouts.navigationCellSize)
  terrain.setStage(stageGeometry(layouts, stage, cfg.arena.width, cfg.arena.height))
  return terrain
}

describe('campus map collisions', () => {
  it('fits reference geometry to the background without stretching', () => {
    const f = fitMapFrame(1344, 832, 2048, 1152)
    expect(f).toEqual({ x: 0, y: 38, scale: 0.65625 })
    expect(fitMapFrame(600, 900, 2048, 1152).scale).toBe(600 / 2048)
    const layout = stageGeometry(layouts, 1, 1344, 832)
    const desk = layout.solids.find((r) => r.id === 'desk_front_left')!
    expect(desk.x).toBe((700 + 211 / 2 + (708 - (700 + 211 / 2)) * 0.4) * f.scale)
    expect(desk.y).toBe(38 + (554 + 226 / 2 + (560 - (554 + 226 / 2)) * 0.4 - 22) * f.scale)
    expect(desk.width).toBeCloseTo(184 * 0.4 * f.scale)
  })

  for (const stage of [1, 2, 3]) {
    it(`stage ${stage}: furniture, walls and image margins are solid; entry is clear`, () => {
      const terrain = map(stage)
      for (const r of terrain.solids)
        expect(terrain.isWalkable(r.x + r.width / 2, r.y + r.height / 2)).toBe(false)
      const start = stageGeometry(layouts, stage, terrain.width, terrain.height).playerSpawn
      expect(terrain.isWalkable(start.x, start.y, 12)).toBe(true)
      expect(terrain.isWalkable(400, 10)).toBe(false)
      expect(terrain.isWalkable(400, 820)).toBe(false)
    })

    it(`stage ${stage}: relocated spawns remain reachable at player and boss sizes`, () => {
      const terrain = map(stage),
        spawn = stageGeometry(layouts, stage, terrain.width, terrain.height).playerSpawn
      for (const radius of [12, 18, 40]) {
        const nav = new FlowField({
          originX: 0,
          originY: 0,
          cellSize: terrain.cellSize,
          cols: Math.ceil(terrain.width / terrain.cellSize),
          rows: Math.ceil(terrain.height / terrain.cellSize),
          isWalkable: (x, y) => terrain.isWalkable(x, y, radius),
          rebuildIntervalMs: 0,
          targetSnapRadiusCells: 10,
        })
        const start = terrain.safeSpawn(spawn.x, spawn.y, radius)
        nav.update(start.x, start.y, 0)
        for (const r of terrain.solids) {
          const safe = terrain.safeSpawn(r.x + r.width / 2, r.y + r.height / 2, radius)
          expect(terrain.isWalkable(safe.x, safe.y, radius)).toBe(true)
          expect(nav.isReachableAt(safe.x, safe.y)).toBe(true)
        }
      }
    })
  }

  it('all three cross-aisles admit a boss with visual scale and navigation-cell clearance', () => {
    for (const stage of [1, 2, 3]) {
      const terrain = map(stage)
      const left = stage === 2 ? 430 : 540
      const right = stage === 2 ? 1520 : stage === 3 ? 1520 : 1500
      const y = stage === 2 ? 754 : stage === 3 ? 780 : 779
      // Current tank radius is 40, with 1.15 visual scale: conservatively reserve 48 world pixels.
      for (let x = left; x <= right; x += 8) {
        const p = point(x, y)
        expect(terrain.isWalkable(p.x, p.y, 48), 'stage ' + stage + ' aisle x=' + x).toBe(true)
      }
      const start = point(left, y),
        target = point(right, y)
      const nav = new FlowField({
        originX: 0,
        originY: 0,
        cellSize: terrain.cellSize,
        cols: Math.ceil(terrain.width / terrain.cellSize),
        rows: Math.ceil(terrain.height / terrain.cellSize),
        isWalkable: (x, y) => terrain.isWalkable(x, y, 48),
        rebuildIntervalMs: 0,
        targetSnapRadiusCells: 10,
      })
      nav.update(target.x, target.y, 0)
      expect(nav.isReachableAt(start.x, start.y)).toBe(true)
    }
  })

  it('open doors keep their passage while door leaves and the lab closed door block movement', () => {
    for (const [stage, x, y, walkable] of [
      [1, 1830, 778, true],
      [1, 1720, 650, false],
      [2, 1720, 350, false],
      [3, 1820, 420, true],
      [3, 1920, 450, false],
    ] as const) {
      const p = point(x, y)
      expect(map(stage).isWalkable(p.x, p.y, 12), `stage ${stage} at ${x},${y}`).toBe(walkable)
    }
  })

  it('catches high-speed projectile crossings and keeps a clear aisle shootable', () => {
    const terrain = map(1)
    expect(terrain.crossesSolid(point(670, 670), point(950, 670), 4)).toBe(true)
    expect(terrain.crossesSolid(point(500, 550), point(500, 800), 4)).toBe(false)
    expect(terrain.crossesSolid(point(1710, 760), point(1900, 760), 4)).toBe(false)
    expect(terrain.crossesSolid(point(1800, 650), point(1680, 650), 4)).toBe(true)
  })

  it('changing floors replaces previous obstacles and spawn reachability', () => {
    const terrain = map(1),
      p = point(1230, 670)
    expect(terrain.isWalkable(p.x, p.y)).toBe(false)
    terrain.safeSpawn(p.x, p.y, 12)
    terrain.setStage(stageGeometry(layouts, 3, terrain.width, terrain.height))
    expect(terrain.isWalkable(p.x, p.y)).toBe(true)
    expect(terrain.safeSpawn(p.x, p.y, 12)).toEqual(p)
  })

  it('rejects malformed, incomplete and overlapping spawn configurations', () => {
    const bad = structuredClone(raw)
    bad.stages[0].solids[0].width = Infinity
    expect(() => parseStageCollisions(bad, STAGES)).toThrow()
    expect(() => parseStageCollisions({ ...raw, stages: raw.stages.slice(1) }, STAGES)).toThrow()
    const inside = structuredClone(raw)
    inside.stages[0].playerSpawn = { x: 10, y: 10 }
    expect(() => parseStageCollisions(inside, STAGES)).toThrow()
    const duplicate = structuredClone(raw)
    duplicate.stages[2].stage = 1
    expect(() => parseStageCollisions(duplicate, STAGES)).toThrow()
  })
})
