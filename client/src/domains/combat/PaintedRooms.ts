import type { DungeonStages } from './DungeonStages'
import type { CombatConfig } from './config'
import {
  fitMapFrame,
  stageGeometry,
  type MapPoint,
  type MapRect,
  type StageCollisionConfig,
} from './StageGeometry'
import { TerrainMap } from './TerrainMap'

export type GateSide = 'north' | 'south' | 'west' | 'east'
interface RoomArtTemplate {
  stage: number
  name: string
  floor: MapRect
  gates: Record<GateSide, MapPoint[]>
}
export interface PaintedRoomConfig {
  schemaVersion: 1
  deskScale: number
  templates: RoomArtTemplate[]
  gateSize: { width: number; height: number }
}

export function roomArtIndex(kind: string, stage: number): number {
  return kind === 'boss' ? 2 : kind === 'elite' ? 1 : (stage - 1) % 3
}

export function parsePaintedRoomConfig(raw: unknown): PaintedRoomConfig {
  const cfg = raw as PaintedRoomConfig
  if (
    !cfg ||
    !Number.isFinite(cfg.deskScale) ||
    cfg.deskScale <= 0 ||
    cfg.deskScale > 1 ||
    cfg.schemaVersion !== 1 ||
    !Array.isArray(cfg.templates) ||
    cfg.templates.length !== 3 ||
    !cfg.gateSize ||
    ![cfg.gateSize.width, cfg.gateSize.height].every((v) => Number.isFinite(v) && v > 0)
  )
    throw new Error('painted-rooms: 房间美术配置无效')
  cfg.templates.forEach((t, i) => {
    if (
      t.stage !== i + 1 ||
      typeof t.name !== 'string' ||
      !t.floor ||
      ![t.floor.x, t.floor.y, t.floor.width, t.floor.height].every(Number.isFinite) ||
      t.floor.width <= 0 ||
      t.floor.height <= 0
    )
      throw new Error('painted-rooms: 房间尺寸无效')
    for (const side of ['north', 'south', 'west', 'east'] as const) {
      if (
        !Array.isArray(t.gates?.[side]) ||
        !t.gates[side].length ||
        t.gates[side].some((p) => !p || ![p.x, p.y].every(Number.isFinite))
      )
        throw new Error('painted-rooms: 缺少通行位置')
    }
  })
  return cfg
}

/** Door orientation comes from its actual D2 opening, including branches above and below. */
export function paintedGateSide(room: DungeonStages['rooms'][number], doorIndex: number): GateSide {
  const door = room.doorRects[doorIndex]!
  return door.height >= door.width
    ? door.x < room.room.rect.x
      ? 'west'
      : 'east'
    : door.y < room.room.rect.y
      ? 'north'
      : 'south'
}

/** Keep the generated room graph, use the complete paintings and their authored collision shapes. */
export function applyPaintedRooms(
  dungeon: DungeonStages,
  paintings: StageCollisionConfig,
  art: PaintedRoomConfig,
  combat: CombatConfig,
): DungeonStages {
  const frame = fitMapFrame(
    combat.arena.width,
    combat.arena.height,
    paintings.sourceSize.width,
    paintings.sourceSize.height,
  )
  const toWorld = (p: MapPoint) => ({
    x: frame.x + p.x * frame.scale,
    y: frame.y + p.y * frame.scale,
  })
  const stages = dungeon.rooms.map((room, index) => {
    const variant = roomArtIndex(room.room.kind, index + 1)
    const template = paintings.stages[variant]!
    const anchors = art.templates[variant]!
    const counts: Record<GateSide, number> = { north: 0, south: 0, west: 0, east: 0 }
    const gates = room.doorTargets.map((_, doorIndex) => {
      const side = paintedGateSide(room, doorIndex)
      const anchor = anchors.gates[side][counts[side]++]
      if (!anchor) throw new Error('painted-rooms: 通行位置不足：' + side)
      return { id: 'door-' + (index + 1) + '-' + doorIndex, ...anchor, ...art.gateSize }
    })
    return {
      stage: index + 1,
      playerSpawn: { ...template.playerSpawn },
      furniture: template.furniture
        .filter((f) => f.id.startsWith('front_') || f.id.startsWith('back_'))
        .map((f) => ({
          ...f,
          scale: art.deskScale,
          offset: { x: 0, y: 0 },
          parts: f.parts.map((id) => 'art-' + id),
        })),
      // Only desk/chair groups shrink. Rendering and collision share this furniture transform.
      // Door leaves in the painting are props, not generated traversal triggers.
      solids: [...template.solids.map((s) => ({ ...s, id: 'art-' + s.id })), ...gates],
    }
  })
  const config: StageCollisionConfig = {
    ...paintings,
    navigationCellSize: combat.terrain.navigationCellSize,
    stages,
  }
  const terrain = new TerrainMap(combat)
  const rooms = dungeon.rooms.map((room, index) => {
    const variant = roomArtIndex(room.room.kind, index + 1)
    const floor = art.templates[variant]!.floor
    const layout = stageGeometry(config, index + 1, combat.arena.width, combat.arena.height)
    terrain.setStage(layout)
    const spawn = terrain.safeSpawn(layout.playerSpawn.x, layout.playerSpawn.y, 0)
    // Farthest-point sampling keeps enemies distributed in the reachable painted room.
    const candidates: MapPoint[] = []
    for (
      let y = floor.y + config.navigationCellSize;
      y < floor.y + floor.height;
      y += config.navigationCellSize * 2
    ) {
      for (
        let x = floor.x + config.navigationCellSize;
        x < floor.x + floor.width;
        x += config.navigationCellSize * 2
      ) {
        const p = toWorld({ x, y })
        if (!terrain.isWalkable(p.x, p.y, config.navigationCellSize / 2)) continue
        const safe = terrain.safeSpawn(p.x, p.y, config.navigationCellSize / 2)
        if (Math.hypot(safe.x - p.x, safe.y - p.y) < 1) candidates.push(p)
      }
    }
    const spawnPoints = [spawn]
    while (spawnPoints.length < Math.max(2, room.spawnPoints.length) && candidates.length) {
      let best = 0,
        distance = -1
      candidates.forEach((p, i) => {
        const d = Math.min(...spawnPoints.map((s) => (p.x - s.x) ** 2 + (p.y - s.y) ** 2))
        if (d > distance) {
          best = i
          distance = d
        }
      })
      spawnPoints.push(candidates.splice(best, 1)[0]!)
    }
    return { ...room, spawnPoints, rectInBox: { x: 0, y: 0, ...paintings.sourceSize } }
  })
  return { ...dungeon, stages: config, rooms }
}
