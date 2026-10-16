import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseRoomsConfig } from '@/domains/procgen/config'
import { parseCombatConfig } from './config'
import { buildDungeonStages } from './DungeonStages'
import { applyPaintedRooms, parsePaintedRoomConfig, roomArtIndex } from './PaintedRooms'
import { parseStageCollisions, stageGeometry } from './StageGeometry'
import { TerrainMap } from './TerrainMap'
const json = (name: string) =>
  JSON.parse(
    readFileSync(new URL('../../../public/config/' + name + '.json', import.meta.url), 'utf8'),
  )
const combat = parseCombatConfig(json('combat'))
const paintings = parseStageCollisions(json('stage-collisions'), 3)
const art = parsePaintedRoomConfig(json('painted-rooms'))
const rooms = parseRoomsConfig({ ...json('rooms'), totalRooms: 7, mainRoomMin: 4, mainRoomMax: 4 })
describe('painted room art and matching collision', () => {
  it('keeps generated branches, safely spawns actors and leaves every traversal marker reachable', () => {
    for (const seed of [1, 2, 3, 13, 837, 7919, 424242, 20261012]) {
      const generated = buildDungeonStages(seed, rooms, combat)
      const painted = applyPaintedRooms(generated, paintings, art, combat)
      expect(() => parseStageCollisions(painted.stages, 7)).not.toThrow()
      const terrain = new TerrainMap(combat)
      painted.rooms.forEach((room, i) => {
        expect(room.doorTargets).toEqual(generated.rooms[i]!.doorTargets)
        const layout = stageGeometry(painted.stages, i + 1, combat.arena.width, combat.arena.height)
        terrain.setStage(layout)
        for (const point of room.spawnPoints)
          expect(terrain.isWalkable(point.x, point.y)).toBe(true)
        for (const d of layout.solids.filter((s) => s.id.startsWith('door-'))) {
          const near = terrain.safeSpawn(d.x + d.width / 2, d.y + d.height / 2, 12)
          const distance = Math.hypot(
            Math.max(d.x - near.x, 0, near.x - d.x - d.width),
            Math.max(d.y - near.y, 0, near.y - d.y - d.height),
          )
          expect(distance, 'unreachable room ' + i + ' gate ' + d.id).toBeLessThanOrEqual(50)
        }
      })
    }
  })
  it('shrinks the four desk/chair groups uniformly and keeps the teacher desk unchanged', () => {
    const painted = applyPaintedRooms(buildDungeonStages(1, rooms, combat), paintings, art, combat)
    painted.stages.stages.forEach((stage, i) => {
      expect(stage.furniture).toHaveLength(4)
      expect(stage.furniture.every((f) => f.scale === 0.62)).toBe(true)
      const variant = roomArtIndex(painted.rooms[i]!.room.kind, i + 1)
      const original = stageGeometry(
        { ...paintings, stages: paintings.stages.map((s) => ({ ...s, furniture: [] })) },
        variant + 1,
        combat.arena.width,
        combat.arena.height,
      )
      const final = stageGeometry(painted.stages, i + 1, combat.arena.width, combat.arena.height)
      for (const f of stage.furniture)
        for (const id of f.parts) {
          const before = original.solids.find((s) => s.id === id.replace('art-', ''))!
          const after = final.solids.find((s) => s.id === id)!
          expect(after.width / before.width).toBeCloseTo(0.62)
          expect(after.height / before.height).toBeCloseTo(0.62)
        }
      const teacher = final.solids.find((s) => s.id === 'art-teacher_desk')!
      expect(teacher.width).toBe(original.solids.find((s) => s.id === 'teacher_desk')!.width)
    })
  })
})
