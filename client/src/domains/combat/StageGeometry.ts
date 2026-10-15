/** Reference-image coordinates shared by furniture rendering, physics and pathfinding. */
export interface MapPoint {
  x: number
  y: number
}
export interface MapRect extends MapPoint {
  width: number
  height: number
}
export interface SolidRect extends MapRect {
  id: string
}
export interface MapFurniture {
  id: string
  parts: string[]
  bounds: MapRect
  repair: { x: number; width: number; margin: number }
  polygons: [number, number][][]
  scale: number
  offset: MapPoint
}
export interface StageLayout {
  stage: number
  playerSpawn: MapPoint
  solids: SolidRect[]
}
export interface StageCollisionConfig {
  navigationCellSize: number
  schemaVersion: 1
  sourceSize: { width: number; height: number }
  stages: (StageLayout & { furniture: MapFurniture[] })[]
}

export function fitMapFrame(
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
) {
  const scale = Math.min(width / sourceWidth, height / sourceHeight)
  return { scale, x: (width - sourceWidth * scale) / 2, y: (height - sourceHeight * scale) / 2 }
}

/** Proportional scale about the original furniture center, also used for every collider part. */
export function furnitureRect(rect: MapRect, furniture: MapFurniture): MapRect {
  const center = {
    x: furniture.bounds.x + furniture.bounds.width / 2,
    y: furniture.bounds.y + furniture.bounds.height / 2,
  }
  return {
    x: center.x + (rect.x - center.x) * furniture.scale + furniture.offset.x,
    y: center.y + (rect.y - center.y) * furniture.scale + furniture.offset.y,
    width: rect.width * furniture.scale,
    height: rect.height * furniture.scale,
  }
}

export function parseStageCollisions(raw: unknown, stageCount: number): StageCollisionConfig {
  const config = raw as StageCollisionConfig
  if (
    !config ||
    config.schemaVersion !== 1 ||
    !config.sourceSize ||
    !Number.isFinite(config.sourceSize.width) ||
    config.sourceSize.width <= 0 ||
    !Number.isFinite(config.sourceSize.height) ||
    config.sourceSize.height <= 0 ||
    !Array.isArray(config.stages) ||
    config.stages.length !== stageCount ||
    !Number.isFinite(config.navigationCellSize) ||
    config.navigationCellSize <= 0
  )
    throw new Error('stage-collisions: 地图尺寸、导航网格或关卡数量无效')
  const { width, height } = config.sourceSize
  const validRect = (r: MapRect) =>
    r &&
    [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
    r.x >= 0 &&
    r.y >= 0 &&
    r.width > 0 &&
    r.height > 0 &&
    r.x + r.width <= width &&
    r.y + r.height <= height
  const validPoint = (p: MapPoint) => p && [p.x, p.y].every(Number.isFinite)
  const stages = new Set<number>()
  for (const layout of config.stages) {
    if (
      !layout ||
      !Number.isInteger(layout.stage) ||
      layout.stage < 1 ||
      layout.stage > stageCount ||
      stages.has(layout.stage) ||
      !Array.isArray(layout.solids) ||
      !layout.solids.length ||
      !Array.isArray(layout.furniture)
    )
      throw new Error('stage-collisions: 关卡编号或碰撞数据无效')
    stages.add(layout.stage)
    const ids = new Set<string>()
    for (const r of layout.solids) {
      if (!validRect(r) || typeof r.id !== 'string' || !r.id || ids.has(r.id))
        throw new Error('stage-collisions: 碰撞范围越界或标识重复')
      ids.add(r.id)
    }
    const furnitureIds = new Set<string>(),
      assigned = new Set<string>()
    for (const f of layout.furniture) {
      if (
        !f ||
        !f.id ||
        furnitureIds.has(f.id) ||
        !validRect(f.bounds) ||
        !Number.isFinite(f.scale) ||
        f.scale <= 0 ||
        f.scale > 1 ||
        !validPoint(f.offset) ||
        !f.repair ||
        !Number.isFinite(f.repair.margin) ||
        f.repair.margin < 0 ||
        ![f.repair.x, f.repair.width].every(Number.isFinite) ||
        f.repair.x < 0 ||
        f.repair.width <= 0 ||
        f.repair.x + f.repair.width > width ||
        !Array.isArray(f.parts) ||
        !f.parts.length ||
        !Array.isArray(f.polygons) ||
        !f.polygons.length
      )
        throw new Error('stage-collisions: 家具缩放或素材范围无效')
      if (!validRect(furnitureRect(f.bounds, f)))
        throw new Error('stage-collisions: 家具缩放后越界')
      furnitureIds.add(f.id)
      for (const part of f.parts) {
        if (!ids.has(part) || assigned.has(part))
          throw new Error('stage-collisions: 家具碰撞部件不存在或重复')
        assigned.add(part)
      }
      for (const polygon of f.polygons) {
        if (
          !Array.isArray(polygon) ||
          polygon.length < 3 ||
          polygon.some(
            (p) =>
              !Array.isArray(p) ||
              p.length !== 2 ||
              !p.every(Number.isFinite) ||
              p[0] < f.bounds.x ||
              p[0] > f.bounds.x + f.bounds.width ||
              p[1] < f.bounds.y ||
              p[1] > f.bounds.y + f.bounds.height,
          )
        )
          throw new Error('stage-collisions: 家具裁切轮廓越界')
      }
    }
    const p = layout.playerSpawn
    if (
      !validPoint(p) ||
      p.x < 0 ||
      p.y < 0 ||
      p.x >= width ||
      p.y >= height ||
      stageGeometry(config, layout.stage, width, height).solids.some(
        (r) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height,
      )
    )
      throw new Error('stage-collisions: 出生点必须位于可通行区域')
  }
  return config
}

export function stageGeometry(
  config: StageCollisionConfig,
  stage: number,
  width: number,
  height: number,
): StageLayout {
  const layout = config.stages.find((s) => s.stage === stage)
  if (!layout) throw new Error(`stage-collisions: 缺少第 ${stage} 关碰撞数据`)
  const frame = fitMapFrame(width, height, config.sourceSize.width, config.sourceSize.height)
  const point = (p: MapPoint) => ({
    x: frame.x + p.x * frame.scale,
    y: frame.y + p.y * frame.scale,
  })
  const solids = layout.solids.map((r) => {
    const furniture = layout.furniture.find((f) => f.parts.includes(r.id))
    const bounds = furniture ? furnitureRect(r, furniture) : r
    return {
      id: r.id,
      ...point(bounds),
      width: bounds.width * frame.scale,
      height: bounds.height * frame.scale,
    }
  })
  if (frame.y > 0)
    solids.push(
      { id: 'frame_top', x: 0, y: 0, width, height: frame.y },
      { id: 'frame_bottom', x: 0, y: height - frame.y, width, height: frame.y },
    )
  if (frame.x > 0)
    solids.push(
      { id: 'frame_left', x: 0, y: 0, width: frame.x, height },
      { id: 'frame_right', x: width - frame.x, y: 0, width: frame.x, height },
    )
  return { stage, playerSpawn: point(layout.playerSpawn), solids }
}
