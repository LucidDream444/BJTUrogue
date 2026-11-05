import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseRoomsConfig } from '@/domains/procgen/config'
import { FLOOR_PLAN_FILES, parseFloorPlan } from '@/domains/procgen/gen/floorPlan'
import { bossArenaBoundsFromRect, bossArenaContainsCircle, bossArenaPoint } from './BossArenaBounds'
const room = { left: 100, top: 200, right: 600, bottom: 600 }
describe('boss destinations remain inside sealed room', () => {
  it('clamps teleports and summons beyond every wall', () => {
    expect(bossArenaPoint(900, -200, 40, room, 40, () => true)).toEqual({ x: 560, y: 240 })
  })
  it('finds the closest clear grid without escaping into a neighboring room', () => {
    const p = bossArenaPoint(300, 400, 40, room, 40, (x, y) => x !== 300 || y !== 400)
    expect(p).toBeTruthy()
    expect(p!.x).toBeGreaterThanOrEqual(140)
    expect(p!.x).toBeLessThanOrEqual(560)
    expect(p!.y).toBeGreaterThanOrEqual(240)
    expect(p!.y).toBeLessThanOrEqual(560)
  })
  it('rejects a fully obstructed room instead of placing in corridor', () => {
    expect(bossArenaPoint(300, 400, 40, room, 40, () => false)).toBeNull()
  })
  it('rejects a circle wider than the room', () => {
    expect(bossArenaPoint(300, 400, 300, room, 40, () => true)).toBeNull()
  })

  it('when furniture leaves clearance only in the corridor, rejects instead of reducing to player radius', () => {
    const walkable = (x: number, y: number, radius: number): boolean =>
      x >= room.right + radius || radius <= 12 && y >= room.top + radius && y <= room.bottom - radius
    expect(bossArenaPoint(800, 400, 46, room, 40, walkable)).toBeNull()
    expect(bossArenaPoint(800, 400, 12, room, 40, walkable)).not.toBeNull()
  })

  it('a center inside the room is insufficient when the actual collision circle crosses its wall', () => {
    expect(bossArenaContainsCircle(570, 400, 46, room)).toBe(false)
    expect(bossArenaContainsCircle(554, 400, 46, room)).toBe(true)
    expect(bossArenaContainsCircle(146, 246, 46, room)).toBe(true)
    expect(bossArenaContainsCircle(146, 245.99, 46, room)).toBe(false)
  })

  it('detects postUpdate double displacement even when the requested teleport target was safe', () => {
    const destination = bossArenaPoint(900, 400, 44.2, room, 40, () => true)!
    expect(bossArenaContainsCircle(destination.x, destination.y, 44.2, room)).toBe(true)
    expect(bossArenaContainsCircle(destination.x + 122.2, destination.y, 44.2, room)).toBe(false)
  })

  it('rejects malformed physics snapshots and inverted bounds', () => {
    expect(bossArenaContainsCircle(NaN, 400, 46, room)).toBe(false)
    expect(bossArenaContainsCircle(300, Infinity, 46, room)).toBe(false)
    expect(bossArenaContainsCircle(300, 400, -1, room)).toBe(false)
    expect(bossArenaContainsCircle(300, 400, 46, { ...room, right: 50 })).toBe(false)
  })

  it('real floor plans convert centered Rects back to original cell boundaries', () => {
    const read = (filename: string): unknown => JSON.parse(readFileSync(new URL(`../../../public/config/${filename}`, import.meta.url), 'utf8'))
    const metrics = parseRoomsConfig(read('rooms.json'))
    for (const filename of FLOOR_PLAN_FILES) {
      const plan = parseFloorPlan(read(filename), metrics)
      for (const space of plan.rooms.filter((entry) => entry.fixed === 'boss')) {
        const bounds = bossArenaBoundsFromRect(space.rect)
        expect(bounds, filename).toEqual({
          left: space.cells.x * metrics.navCellSize,
          top: space.cells.y * metrics.navCellSize,
          right: (space.cells.x + space.cells.width) * metrics.navCellSize,
          bottom: (space.cells.y + space.cells.height) * metrics.navCellSize,
        })
        for (const [x, y] of [[-10000, -10000], [100000, -10000], [-10000, 100000], [100000, 100000]]) {
          const point = bossArenaPoint(x!, y!, 46, bounds, metrics.navCellSize, () => true)!
          expect(bossArenaContainsCircle(point.x, point.y, 46, bounds), filename).toBe(true)
        }
      }
    }
  })
})
