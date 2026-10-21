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
/**
 * 门洞的一块**挡板**：矩形 + 它属于哪一间房。
 *
 * ★ 新增（2026-10-21，整层连续）。坐标与 `SolidRect` **同一约定**（`x` / `y` 是
 * **左上角**）—— 两者在 `StageColliders` 里挨着造 Zone，约定不同就是半个身位的错位，
 * 而且**两种都画得出来**（画面上一块门偏了半截，不报错）。转换在 `DungeonStages` 那一处做。
 *
 * 语义见 `DungeonStages.ts` 文件头：**它不在 `solids` 里**，是一个可以原地开关的实体。
 */
export interface StageBarrier extends MapRect {
  /** 这扇门开在**第几间房**的墙上（`Room.order`）。清场开门按它判 */
  ownerOrder: number
  /** 另一头是哪个空间（今天恒为一段走廊的 id） */
  toId: string
}
export interface StageLayout {
  stage: number
  playerSpawn: MapPoint
  solids: SolidRect[]
  /**
   * 门洞挡板。**可选** —— 只有「整层连续」的几何（`DungeonStages`）会给，
   * 手画的 `stage-collisions.json` 那一份没有（它是「一间房一关」时代的产物）。
   *
   * ⚠️ **不许把它们并进 `solids`**：`solids` 会进寻路网格，而把门也填上的话
   * 整层会被切成一间间孤岛 —— `reachableCells()` 到不了别的房、`safeSpawn()`
   * 只能在当前这一间里找落脚点，表现是「怪全挤在门口」。见 `DungeonStages.ts` 文件头。
   */
  barriers?: StageBarrier[]
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
    // 挡板是**可选**的（见 `StageLayout.barriers`）。有就查：矩形合法、
    // `ownerOrder` 是个非负整数。**不查「有没有和 solids 重叠」** —— 门洞是墙上挖掉的
    // 那一格，它天然贴着两侧的墙，用「不许相交」会保守到把每一扇门都拒掉，
    // 而那是**这批几何的常态**，不是错误。
    if (layout.barriers !== undefined) {
      if (!Array.isArray(layout.barriers)) throw new Error('stage-collisions: 门洞挡板必须是数组')
      for (const b of layout.barriers) {
        if (!validRect(b) || !Number.isInteger(b.ownerOrder) || b.ownerOrder < 0)
          throw new Error('stage-collisions: 门洞挡板越界或房号无效')
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
  // 挡板跟着一起搬。整层连续那一份里 `frame` 是恒等（`sourceSize` = 竞技场），
  // 但这里**照搬不省**：省掉的话，将来谁把手画的那份几何换回非恒等的取景框，
  // 门会留在原处而墙移走 —— 表现是「门开在一堵空墙上」，两边都不报错。
  const barriers = layout.barriers?.map((b) => ({
    ...b,
    ...point(b),
    width: b.width * frame.scale,
    height: b.height * frame.scale,
  }))
  return { stage, playerSpawn: point(layout.playerSpawn), solids, barriers }
}
