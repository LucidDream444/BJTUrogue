/**
 * 室内家具。**纯函数，零 Phaser 依赖。**
 *
 * 每间战斗房先抽一个**主题**（`rooms.json` 的 `furnitureThemeWeights`）：
 *
 * | 主题 | 形状 |
 * |---|---|
 * | `classic` | 一张 2—4 格的桌 + 正下方一把椅子（原有教室感） |
 * | `deskOnly` | 只有桌，没有椅子 |
 * | `chairOnly` | 只有椅子，成块/成排 |
 * | `longStrip` | 很长的一条桌（可带 0—1 把椅子） |
 * | `lShape` | 直角形：一竖 + 一横，由 1 格高的横向桌条拼成 |
 * | `notched` | 缺口矩形：C 形或 U 形，缺口朝外，不封死 |
 *
 * ## 所有形状都拆成「1 格高的横向桌条」
 *
 * 渲染层（`CampusMapArt.paintFurniture`）的桌贴图是横向的。竖条/整块会把它
 * 拉伸得很难看，所以 L 形与缺口形都用**多行横条**拼：每行仍是一条正常的桌。
 *
 * ## 三条硬约束
 *
 * | 约束 | 不守的后果 |
 * |---|---|
 * | 不碰门的净空圈（`doorClearance`） | 桌子堵在门口，房间进得去出不来 |
 * | 总面积 ≤ `obstacleDensityMax` | 小教室被塞满，肉盾 slam 没地方躲 |
 * | 按格对齐、只横竖 | 看着能挤过去的缝，寻路认为整格封死 |
 *
 * ## 连通性兜底（2026-11-27 新增）
 *
 * 摆完之后从**每一扇门的内侧格**做一次 4-邻域 flood fill：
 * 房间内所有没被家具占住的格子都必须是可达的。不是的话，**从后往前撤掉形状**
 * 直到重新连通。这保证不会出现「长条桌把房间切成两半、另一边永远走不到」——
 * 即使刷怪点本来就会被 `spawns.ts` 放在可达区，走不到的那一半也会白白浪费。
 *
 * ⚠️ **不再强制「桌 + 椅」成组。** `model/furniture.ts` 的 `furnitureUnits`
 * 仍是**手绘关**（`stage-collisions.json`）的读法；程序生成的家具可以只有桌、
 * 只有椅，校验器也不再要求配对（`validate/contract.ts`）。
 */

import type { Obstacle, Rect, Room } from '../model/types'
import type { RoomsConfig } from '../config'
import { isCombatKind } from '../config'
import { bottom, doorRect, left, inflate, rectsIntersect, right, top } from '../model/rect'
import { doorSideCells, isBlockedCell, type NavGrid } from '../walkability'
import { rngFor } from './seed'

type Theme = keyof RoomsConfig['furnitureThemeWeights']

interface PlacedShape {
  obstacles: Obstacle[]
  /** 整个形状的外框（中心点约定，与 `Rect` 相同）。 */
  box: Rect
  area: number
}

const THEMES: readonly Theme[] = [
  'classic',
  'deskOnly',
  'chairOnly',
  'longStrip',
  'lShape',
  'notched',
]
/** 这些主题按 `deskRowsMin~Max` 摆多组；大形状只摆 1—2 个。 */
const BULK_THEMES = new Set<Theme>(['classic', 'deskOnly', 'chairOnly'])
/** 大形状之后用来“填房间”的小家具；classic 会带回椅子。 */
const FILLERS: readonly Theme[] = ['classic', 'deskOnly', 'chairOnly']
const FEATURES: readonly Theme[] = ['longStrip', 'lShape', 'notched']

export function placeObstacles(seed: number, cfg: RoomsConfig, room: Room): Obstacle[] {
  // 非战斗关别**一间空房**：没有敌人的房间里家具只是占地方，还会挤掉宝箱落点。
  if (!isCombatKind(cfg, room.kind)) return []

  const cell = cfg.navCellSize
  const wt = cfg.wallThickness
  const rl = left(room.rect)
  const rt = top(room.rect)
  const nx = Math.round(room.rect.width / cell)
  const ny = Math.round(room.rect.height / cell)
  if (nx < 4 || ny < 4) return []

  const forbidden = room.doors.map((d) => inflate(doorRect(d, wt), cfg.doorClearance))
  const touchesDoor = (r: Rect): boolean => forbidden.some((f) => rectsIntersect(r, f))
  const gap = cfg.deskGapCells * cell
  const roomArea = room.rect.width * room.rect.height
  const areaCap = roomArea * cfg.obstacleDensityMax
  const rng = rngFor(seed, 'desks', room.order)

  // 房间自己的局部网格：只用来做连通性检查，不参与全层寻路。
  const grid: NavGrid = {
    cellSize: cell,
    originX: rl,
    originY: rt,
    cols: nx,
    rows: ny,
    blocked: new Uint8Array(nx * ny),
  }
  // 门内侧的起点格。`doorSideCells` 是生成/校验共用的几何，别自己再推一遍。
  const doorCells: { cx: number; cy: number }[] = []
  for (const door of room.doors) {
    for (const c of doorSideCells(grid, room, cfg, door).inside) {
      if (c.cx >= 0 && c.cy >= 0 && c.cx < nx && c.cy < ny) doorCells.push(c)
    }
  }

  const cellsRect = (ix: number, iy: number, wCells: number, hCells: number): Rect => ({
    x: rl + (ix + wCells / 2) * cell,
    y: rt + (iy + hCells / 2) * cell,
    width: wCells * cell,
    height: hCells * cell,
  })
  const randPos = (wCells: number, hCells: number): { ix: number; iy: number } => ({
    ix: rng.between(1, nx - wCells - 1),
    iy: rng.between(1, ny - hCells - 1),
  })
  const shapeOf = (obstacles: Obstacle[]): PlacedShape => {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    let area = 0
    for (const o of obstacles) {
      x0 = Math.min(x0, left(o.rect))
      y0 = Math.min(y0, top(o.rect))
      x1 = Math.max(x1, right(o.rect))
      y1 = Math.max(y1, bottom(o.rect))
      area += o.rect.width * o.rect.height
    }
    return {
      obstacles,
      box: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, width: x1 - x0, height: y1 - y0 },
      area,
    }
  }

  const placed: PlacedShape[] = []
  const taken: Rect[] = []
  let usedArea = 0

  const tryPlace = (build: () => PlacedShape | null, attempts = 32): boolean => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const shape = build()
      if (!shape) continue
      if (usedArea + shape.area > areaCap) return false
      if (shape.obstacles.some((o) => touchesDoor(o.rect))) continue
      // 组/形状之间至少留 `deskGapCells` 格；否则相邻形状会连成一堵意外的长墙。
      if (taken.some((t) => rectsIntersect(t, inflate(shape.box, gap)))) continue
      placed.push(shape)
      taken.push(shape.box)
      usedArea += shape.area
      return true
    }
    return false
  }

  // ---- 连通性：房间内所有空格都必须能从门走到 ----
  const roomConnected = (): boolean => {
    if (doorCells.length === 0) return true // 没有门的数据不全；不在这里判死
    grid.blocked.fill(0)
    for (const shape of placed) {
      for (const o of shape.obstacles) {
        const x0 = Math.round((left(o.rect) - rl) / cell)
        const y0 = Math.round((top(o.rect) - rt) / cell)
        const w = Math.round(o.rect.width / cell)
        const h = Math.round(o.rect.height / cell)
        for (let y = y0; y < y0 + h; y++) {
          for (let x = x0; x < x0 + w; x++) {
            if (x >= 0 && y >= 0 && x < nx && y < ny) grid.blocked[y * nx + x] = 1
          }
        }
      }
    }

    const seen = new Uint8Array(nx * ny)
    const queue = new Int32Array(nx * ny)
    let head = 0
    let tail = 0
    for (const c of doorCells) {
      if (isBlockedCell(grid, c.cx, c.cy)) continue
      const key = c.cy * nx + c.cx
      if (seen[key]) continue
      seen[key] = 1
      queue[tail++] = key
    }
    while (head < tail) {
      const key = queue[head++]!
      const cx = key % nx
      const cy = (key / nx) | 0
      const visit = (x: number, y: number): void => {
        if (x < 0 || y < 0 || x >= nx || y >= ny) return
        const next = y * nx + x
        if (seen[next] || grid.blocked[next]) return
        seen[next] = 1
        queue[tail++] = next
      }
      visit(cx + 1, cy)
      visit(cx - 1, cy)
      visit(cx, cy + 1)
      visit(cx, cy - 1)
    }

    let free = 0
    let reached = 0
    for (let i = 0; i < nx * ny; i++) {
      if (grid.blocked[i]) continue
      free++
      if (seen[i]) reached++
    }
    return free === reached
  }

  // ---- 主题形状 ----
  const maxDeskWidth = Math.min(cfg.deskWidthCellsMax, nx - 2)

  const buildClassic = (): PlacedShape | null => {
    if (maxDeskWidth < cfg.deskWidthCells || ny < 4) return null
    const dw = rng.between(cfg.deskWidthCells, maxDeskWidth)
    const { ix, iy } = randPos(dw, 2)
    const desk = cellsRect(ix, iy, dw, 1)
    const chair = cellsRect(ix + rng.between(0, dw - 1), iy + 1, 1, 1)
    return shapeOf([
      { kind: 'desk', rect: desk },
      { kind: 'chair', rect: chair },
    ])
  }

  const buildDeskOnly = (): PlacedShape | null => {
    if (maxDeskWidth < cfg.deskWidthCells) return null
    const dw = rng.between(cfg.deskWidthCells, maxDeskWidth)
    const { ix, iy } = randPos(dw, 1)
    return shapeOf([{ kind: 'desk', rect: cellsRect(ix, iy, dw, 1) }])
  }

  const buildChairCluster = (): PlacedShape | null => {
    const maxW = Math.min(4, nx - 2)
    const maxH = Math.min(3, ny - 2)
    if (maxW < 2 || maxH < 1) return null
    const w = rng.between(2, maxW)
    const h = rng.between(1, maxH)
    const { ix, iy } = randPos(w, h)
    const obstacles: Obstacle[] = []
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        obstacles.push({ kind: 'chair', rect: cellsRect(ix + x, iy + y, 1, 1) })
      }
    }
    return shapeOf(obstacles)
  }

  const buildLongStrip = (): PlacedShape | null => {
    const maxLen = Math.min(cfg.deskLongWidthCellsMax, nx - 2)
    const minLen = Math.min(cfg.deskWidthCellsMax + 1, maxLen)
    if (maxLen < cfg.deskWidthCells || minLen < cfg.deskWidthCells) return null
    const len = rng.between(minLen, maxLen)
    const chair = rng.between(0, 1) === 1
    const { ix, iy } = randPos(len, chair ? 2 : 1)
    const obstacles: Obstacle[] = [{ kind: 'desk', rect: cellsRect(ix, iy, len, 1) }]
    if (chair) {
      const col = ix + rng.between(0, len - 1)
      obstacles.push({ kind: 'chair', rect: cellsRect(col, iy + 1, 1, 1) })
    }
    return shapeOf(obstacles)
  }

  const buildLShape = (): PlacedShape | null => {
    const maxRows = Math.min(cfg.deskShapeRowsMax, ny - 2)
    if (maxRows < 3 || nx < 5) return null
    const legW = rng.between(2, Math.min(3, nx - 2))
    const legH = rng.between(3, maxRows)
    const footMax = Math.min(nx - 2, cfg.deskLongWidthCellsMax, legW + 4)
    if (footMax <= legW) return null
    const footW = rng.between(legW + 1, footMax)
    const { ix, iy } = randPos(footW, legH)
    const legRight = rng.between(0, 1) === 1
    const footBottom = rng.between(0, 1) === 1
    const legX = legRight ? ix + footW - legW : ix
    const obstacles: Obstacle[] = []
    for (let row = 0; row < legH; row++) {
      const footRow = footBottom ? row === legH - 1 : row === 0
      obstacles.push({
        kind: 'desk',
        rect: footRow
          ? cellsRect(ix, iy + row, footW, 1)
          : cellsRect(legX, iy + row, legW, 1),
      })
    }
    return shapeOf(obstacles)
  }

  const buildNotched = (): PlacedShape | null => {
    const maxW = Math.min(nx - 2, cfg.deskLongWidthCellsMax)
    if (maxW < 6 || ny < 5) return null
    const w = rng.between(6, maxW)
    const { ix, iy } = randPos(w, 3)
    const obstacles: Obstacle[] = []
    const add = (x: number, y: number, width: number): void => {
      obstacles.push({ kind: 'desk', rect: cellsRect(x, y, width, 1) })
    }
    const variant = rng.between(0, 3)
    if (variant === 0) {
      // C 形，缺口朝右
      const a = rng.between(2, w - 2)
      add(ix, iy, w)
      add(ix, iy + 1, a)
      add(ix, iy + 2, w)
    } else if (variant === 1) {
      // C 形，缺口朝左
      const b = rng.between(2, w - 2)
      add(ix, iy, w)
      add(ix + w - b, iy + 1, b)
      add(ix, iy + 2, w)
    } else if (variant === 2) {
      // U 形，缺口朝上
      const a = rng.between(2, Math.max(2, w - 4))
      const maxB = w - a - 2
      if (maxB < 2) return null
      const b = rng.between(2, maxB)
      add(ix, iy, a)
      add(ix + w - b, iy, b)
      add(ix, iy + 1, a)
      add(ix + w - b, iy + 1, b)
      add(ix, iy + 2, w)
    } else {
      // U 形，缺口朝下
      const a = rng.between(2, Math.max(2, w - 4))
      const maxB = w - a - 2
      if (maxB < 2) return null
      const b = rng.between(2, maxB)
      add(ix, iy, w)
      add(ix, iy + 1, a)
      add(ix + w - b, iy + 1, b)
      add(ix, iy + 2, a)
      add(ix + w - b, iy + 2, b)
    }
    return shapeOf(obstacles)
  }

  const builders: Record<Theme, () => PlacedShape | null> = {
    classic: buildClassic,
    deskOnly: buildDeskOnly,
    chairOnly: buildChairCluster,
    longStrip: buildLongStrip,
    lShape: buildLShape,
    notched: buildNotched,
  }

  const theme = pickTheme(rng, cfg.furnitureThemeWeights)
  if (BULK_THEMES.has(theme)) {
    const want = rng.between(cfg.deskRowsMin, cfg.deskRowsMax)
    for (let n = 0; n < want; n++) {
      if (!tryPlace(builders[theme])) break
    }
    // 普通主题偶尔也加一个大形状，免得所有普通房长得一模一样。
    if (rng.between(0, 9) < 3) {
      const feature = FEATURES[rng.between(0, FEATURES.length - 1)]!
      tryPlace(builders[feature])
    }
  } else {
    // 大形状主题：先放 1—2 个特色形状，再用 3—4 件小家具填房间。
    // ⚠️ 不加这一步的话，大房间可能只有一个 L/缺口块，看起来空荡荡的，
    //    而且整间房只有一种家具“样式”。填充物会带回椅子（classic/chairOnly）。
    const features = theme === 'longStrip' ? rng.between(1, 2) : 1
    for (let n = 0; n < features; n++) {
      if (!tryPlace(builders[theme])) break
    }
    const fillers = rng.between(3, 4)
    for (let n = 0; n < fillers; n++) {
      const filler = FILLERS[rng.between(0, FILLERS.length - 1)]!
      if (!tryPlace(builders[filler])) break
    }
  }

  // BOSS 房通常很大，用户反馈“偌大的房间只有一种家具”。额外塞一个大形状 + 两件小家具，
  // 保证它不会比小教室还空；`tryPlace` 仍会受面积/间距/门净空约束。
  if (room.kind === 'boss') {
    const feature = FEATURES[rng.between(0, FEATURES.length - 1)]!
    tryPlace(builders[feature])
    for (let n = 0; n < 2; n++) {
      const filler = FILLERS[rng.between(0, FILLERS.length - 1)]!
      if (!tryPlace(builders[filler])) break
    }
  }

  // 主题一个都没摆下（小房间/门净空圈）时用最朴素的一条桌兜底。
  if (placed.length === 0 && !tryPlace(buildDeskOnly, 64) && !tryPlace(buildClassic, 64)) {
    return []
  }

  // 连通性兜底：从后往前撤形状，直到房间恢复成一整片可达区域。
  while (placed.length > 0 && !roomConnected()) placed.pop()

  if (placed.length === 0) {
    taken.length = 0
    usedArea = 0
    if (!tryPlace(buildDeskOnly, 64)) return []
    if (!roomConnected()) return []
  }

  return placed.flatMap((shape) => shape.obstacles)
}

function pickTheme(
  rng: ReturnType<typeof rngFor>,
  weights: RoomsConfig['furnitureThemeWeights'],
): Theme {
  const total = THEMES.reduce((sum, theme) => sum + weights[theme], 0)
  let roll = rng.between(0, total - 1)
  for (const theme of THEMES) {
    roll -= weights[theme]
    if (roll < 0) return theme
  }
  return 'classic'
}
