/**
 * **几何契约**校验。纯函数，零 Phaser 依赖，node 下可直跑。
 *
 * ---
 *
 * ## 这个文件是「尺寸契约」的可执行版本
 *
 * spec `procgen-config-contract` 用一张表写了尺寸契约（40px 格 / 走廊 ≥ 120 /
 * 课桌短边 1 格 / 按格对齐 / 只横竖 / 椅子 1 格）。**一张写在文档里的表会被忘掉；
 * 一个会抛异常的断言不会。**
 *
 * 这里校验的是**生成出来的地图**，不是配置表（配置表的自洽在校验器里跑，
 * 见 `config.ts`）。两者都要有，因为它们抓的是不同的错：
 *
 * | 谁错了 | 谁抓得住 |
 * |---|---|
 * | `rooms.json` 里写了 `wallThickness: 20` | `config.ts`（它知道 20 < 一格 = 会漏洞） |
 * | 生成器把某间房摆到了格中心之间 | **这个文件**（配置完全合法，map 是错的） |
 *
 * ## 一条最值钱的检查：**对齐**
 *
 * 「按格对齐」这句话有两种，**方向相反**，混了就是那个著名的「墙上有洞」：
 *
 * ```
 * 房间边界 → 必须落在【格中心】上   （墙以它为中心，正好封掉那一格）
 * 障碍物边界 → 必须落在【格边界】上 （障碍物正好占满整格，不多不少）
 * ```
 *
 * 墙厚 20px 的时候，墙以格中心为中心，只覆盖半格 —— 而寻路看的是格中心，
 * 于是一格中心都没覆盖到：**寻路认为墙两侧都通，物理体照样挡着玩家**。
 * 症状是「怪穿墙、玩家不穿」，两边都不报错。下面两条 `onCellCenter` /
 * `onCellBoundary` 就是钉死这件事的。
 *
 * ## 枚举合法性为什么要 `as readonly string[]`
 *
 * `DungeonMap` 是 TS 类型，所以 `kind` 在编译期已经是 `RoomKind` 了 ——
 * 但那正是这个校验器存在的理由：它要在**运行期**看住从存档 JSON、
 * 从别人手写的测试夹具里读进来的数据，那些数据没经过编译器。
 * 不 cast 的话 `includes` 会被 TS 优化成 `true`，检查形同虚设。
 */

import type { DungeonMap, Point, Rect, Room } from '../model/types'
import {
  DUNGEON_SCHEMA_VERSION,
  mainRooms,
  ROOM_KINDS,
  ROOM_KINDS_EMITTED,
  sideRooms,
} from '../model/types'
import type { RoomsConfig } from '../config'
import { doorRect, left, rectContains, rectsIntersect, right, top, bottom } from '../model/rect'
import { MapValidationError, type MapErrorContext } from './errors'

export interface ContractReport {
  roomCount: number
  mainCount: number
  sideCount: number
  obstacleCount: number
  spawnPointCount: number
}

/** 非负取模。`-1 % 40` 是 `-1`，不是 39 —— 对齐判定用得到。 */
function mod(a: number, n: number): number {
  return ((a % n) + n) % n
}

export function validateContract(map: DungeonMap, cfg: RoomsConfig): ContractReport {
  const cell = cfg.navCellSize
  const wt = cfg.wallThickness
  const ox = map.navOrigin.x
  const oy = map.navOrigin.y
  const n = map.rooms.length

  const fail = (path: string, message: string, context: MapErrorContext = {}): never => {
    throw new MapValidationError(path, message, { seed: map.seed, ...context })
  }

  /** 落在**格中心**上（房间边界、走廊边线、出生点要满足这个） */
  const onCellCenter = (v: number, origin: number): boolean => mod(v - origin, cell) === cell / 2
  /** 落在**格边界**上（障碍物要满足这个） */
  const onCellBoundary = (v: number, origin: number): boolean => mod(v - origin, cell) === 0

  const where = (path: string, r: Rect): string =>
    `${path} = ${r.width}×${r.height} @ (${r.x}, ${r.y})`

  // ------------------------------------------------------------ 0. 版本

  // 红线 3 的同一件事：数据带版本号是为了将来能迁移。版本对不上**必须显式处理**，
  // 不能靠"字段看起来还行"蒙混过去 —— 那正是迁移出错的形态。
  if (!Number.isInteger(map.schemaVersion)) {
    fail('schemaVersion', `要一个整数，拿到 ${JSON.stringify(map.schemaVersion)}`)
  }
  if (map.schemaVersion !== DUNGEON_SCHEMA_VERSION) {
    fail(
      'schemaVersion',
      `本版校验器只认 ${DUNGEON_SCHEMA_VERSION}，拿到 ${map.schemaVersion} —— ` +
        `迁移要显式写出来，不能靠字段名撞对了就放过`,
    )
  }

  // spec `map-reachability`「网格粒度一致」：
  // 校验器与运行时的格边长不一致时，两边判出的可走性不同，**而两边都不报错**。
  if (map.navCellSize !== cfg.navCellSize) {
    fail(
      'navCellSize',
      `地图用 ${map.navCellSize}px、配置是 ${cfg.navCellSize}px —— ` +
        `格边长必须唯一，否则「同一份可走性判定」只是函数名相同`,
    )
  }

  // ------------------------------------------------------------ 1. 数量

  // spec `dungeon-pacing`「单局房间总数恒为 15」
  if (n !== cfg.totalRooms) {
    fail('rooms', `房间总数应为配置的 ${cfg.totalRooms}，实际 ${n}`)
  }

  const mains = mainRooms(map)
  const sides = sideRooms(map)
  const mainCount = mains.length
  const sideCount = sides.length

  // spec `dungeon-pacing`「主干数超出区间时被拒」
  if (mainCount < cfg.mainRoomMin || mainCount > cfg.mainRoomMax) {
    fail(
      'rooms',
      `主干教室数 ${mainCount} 不在 [${cfg.mainRoomMin}, ${cfg.mainRoomMax}] 内` +
        `（来自 rooms.json 的 mainRoomMin / mainRoomMax）`,
    )
  }
  // spec `dungeon-pacing`「侧室数守恒」：侧室数不独立配置，由总数减出来
  if (mainCount + sideCount !== n) {
    fail('rooms', `主干 ${mainCount} + 侧室 ${sideCount} ≠ 总数 ${n}（有房间的 branch 既不是 main 也不是 side）`)
  }

  if (n === 0) fail('rooms', '一间房都没有')

  // ------------------------------------------------------------ 2. 逐间房

  for (let i = 0; i < n; i++) {
    const room = map.rooms[i]!
    const at = (field: string): string => `rooms[${i}].${field}`
    const ctx: MapErrorContext = { roomOrder: room.order }

    // spec `dungeon-layout`「进度是单向的整数」：
    // order 是唯一的顺序来源，所以它必须是 0,1,2,… 连号。有洞就说明
    // 有人按数组下标当进度用了 —— 而数组下标在别处会被重新排序。
    if (room.order !== i) {
      fail(at('order'), `order 必须从 0 起升序连号，第 ${i} 项的 order 是 ${room.order}`, ctx)
    }

    // spec `procgen-config-contract`「出现枚举外的类型时报错」
    if (!(ROOM_KINDS as readonly string[]).includes(room.kind)) {
      fail(
        at('kind'),
        `"${room.kind}" 不是合法类型。合法取值：${ROOM_KINDS.join(' / ')}` +
          `（本期生成器只产出：${ROOM_KINDS_EMITTED.join(' / ')}）`,
        ctx,
      )
    }
    if (room.branch !== 'main' && room.branch !== 'side') {
      fail(at('branch'), `branch 只能是 'main' 或 'side'，拿到 ${JSON.stringify(room.branch)}`, ctx)
    }

    // ---- 尺寸契约
    const tier = cfg.sizeTiers.findIndex(
      (t) => t.width === room.rect.width && t.height === room.rect.height,
    )
    if (tier < 0) {
      const list = cfg.sizeTiers.map((t) => `${t.width}×${t.height}`).join(' / ')
      fail(at('rect'), `${where(at('rect'), room.rect)} 不匹配任何尺寸档位（${list}）`, ctx)
    }
    if (room.sizeTier !== tier) {
      fail(at('sizeTier'), `记的是 ${room.sizeTier}，尺寸反查出来是 ${tier} —— 两处不一致`, ctx)
    }

    // 房间边界落在**格中心**上（见文件头：墙以它为中心，正好封掉一格）
    if (!onCellCenter(left(room.rect), ox) || !onCellCenter(right(room.rect), ox)) {
      fail(
        at('rect'),
        `${where(at('rect'), room.rect)} 的左右边界没落在格中心上 —— ` +
          `球心在 x = ${ox} + ${cell}/2 + ${cell}k 处。落在格边界上的话，` +
          `以它为中线的那堵墙一格中心都盖不住，寻路会认为墙两侧都走得通`,
        ctx,
      )
    }
    if (!onCellCenter(top(room.rect), oy) || !onCellCenter(bottom(room.rect), oy)) {
      fail(at('rect'), `${where(at('rect'), room.rect)} 的上下边界没落在格中心上`, ctx)
    }

    // ---- 房间必须在包围盒里
    if (!rectContains(map.bounds, room.rect)) {
      fail(at('rect'), `${where(at('rect'), room.rect)} 超出了地图包围盒`, ctx)
    }

    // ---------------------------------------------------------- 门
    for (let j = 0; j < room.doors.length; j++) {
      const d = room.doors[j]!
      const dp = `rooms[${i}].doors[${j}]`
      if (d.axis !== 'h' && d.axis !== 'v') {
        fail(`${dp}.axis`, `axis 只能是 'h' 或 'v'，拿到 ${JSON.stringify(d.axis)}`, ctx)
      }
      if (d.kind !== 'back' && d.kind !== 'forward' && d.kind !== 'side') {
        fail(`${dp}.kind`, `门只有 'back' / 'forward' / 'side'，拿到 ${JSON.stringify(d.kind)}`, ctx)
      }
      // 门洞宽必须是整格：不是整格的话两端落在格中心上，实际能过的格子数
      // 会比设计的多一个 —— 而"多一个"不会有人发现，直到有人量碰撞箱。
      if (d.width % cell !== 0) {
        fail(
          `${dp}.width`,
          `门洞宽 ${d.width} 不是 navCellSize（${cell}）的整数倍 —— ` +
            `两端落在格中心上时，实际可过的格子数会比设计多一个`,
          ctx,
        )
      }
      if (d.toOrder !== null) {
        if (!Number.isInteger(d.toOrder) || d.toOrder < 0 || d.toOrder >= n) {
          fail(`${dp}.toOrder`, `指向 ${d.toOrder}，不在 [0, ${n - 1}] 内`, ctx)
        }
      }
    }

    // spec `dungeon-layout`「每一个主干教室至少有一扇门直接开在主干道上」
    if (room.branch === 'main') {
      const toCorridor = room.doors.filter(
        (d) => d.axis === 'h' && rectsIntersect(doorRect(d, wt), map.corridorRect),
      )
      if (toCorridor.length === 0) {
        const kinds = room.doors.map((d) => `${d.kind}/${d.axis}`).join(', ') || '一扇都没有'
        fail(
          at('doors'),
          `主干教室没有一扇门直接开在主干道上（现有的门：${kinds}）—— ` +
            `那样它只能从侧室绕进来，而"主干"这个名字就没意义了`,
          ctx,
        )
      }
    }

    // ---- 侧室的接对
    if (room.branch === 'side') {
      if (room.anchoredTo === null) {
        fail(at('anchoredTo'), `侧室必须记下它挂在哪间主干教室上（order）`, ctx)
      }
      const hostIdx = mains.findIndex((m) => m.order === room.anchoredTo)
      if (hostIdx < 0) {
        fail(at('anchoredTo'), `anchoredTo = ${room.anchoredTo}，但主干轴上没有这个 order 的房间`, ctx)
      }
      const next = mains[hostIdx + 1]
      if (next === undefined) {
        // 首领不参与挂载（它的出口要汇回下一间，而它后面没有下一间），
        // 所以走到这里说明选挂载点的地方漏了这一条。
        fail(
          at('anchoredTo'),
          `挂在主干最后一间（order ${room.anchoredTo}）上 —— ` +
            `侧室的出口要汇回主干下一间，而首领后面没有下一间`,
          ctx,
        )
      }
      if (!room.doors.some((d) => d.toOrder === room.anchoredTo)) {
        fail(
          at('doors'),
          `没有一扇门通向它的宿主（order ${room.anchoredTo}）—— ` +
            `"入口来自宿主"是侧室作为绕行路线的前提`,
          ctx,
        )
      }
      if (!room.doors.some((d) => d.toOrder === next.order)) {
        fail(
          at('doors'),
          `没有一扇门汇回主干下一间（order ${next.order}）—— ` +
            `那样侧室就是一条死路，"绕行"变成"白跑"`,
          ctx,
        )
      }
    } else if (room.anchoredTo !== null) {
      fail(at('anchoredTo'), `主干教室不该有 anchoredTo，拿到 ${room.anchoredTo}`, ctx)
    }

    // ---------------------------------------------------------- 障碍物
    let obstacleArea = 0
    for (let j = 0; j < room.obstacles.length; j++) {
      const o = room.obstacles[j]!
      const op = `rooms[${i}].obstacles[${j}]`
      if (o.kind !== 'desk' && o.kind !== 'chair') {
        fail(`${op}.kind`, `障碍物只有 'desk' / 'chair'，拿到 ${JSON.stringify(o.kind)}`, ctx)
      }
      const r = o.rect
      if (r.width % cell !== 0 || r.height % cell !== 0) {
        fail(op, `${where(op, r)} 的边长不是 navCellSize（${cell}）的整数倍`, ctx)
      }
      // 障碍物边界落在**格边界**上（正好占满整格）
      if (!onCellBoundary(left(r), ox) || !onCellBoundary(top(r), oy)) {
        fail(
          op,
          `${where(op, r)} 的位置没落在格边界上 —— ` +
            `那样它只盖住格中心的一部分，而寻路只看格中心：` +
            `看着能挤过去的缝，寻路可能认为整格封死`,
          ctx,
        )
      }
      if (!rectContains(room.rect, r)) {
        fail(op, `${where(op, r)} 长到了房间外面`, ctx)
      }

      const wc = r.width / cell
      const hc = r.height / cell
      const shortSide = Math.min(wc, hc)
      const longSide = Math.max(wc, hc)
      if (o.kind === 'chair') {
        if (wc !== 1 || hc !== 1) {
          fail(op, `椅子恒为 1 格，拿到 ${wc}×${hc} 格`, ctx)
        }
      } else {
        if (shortSide !== cfg.deskWidthCells) {
          fail(
            op,
            `课桌的短边应恒为 ${cfg.deskWidthCells} 格（deskWidthCells），拿到 ${shortSide} 格 —— ` +
              `短边不统一，桌子就会横七竖八`,
            ctx,
          )
        }
        if (longSide < cfg.deskLenCells[0] || longSide > cfg.deskLenCells[1]) {
          fail(
            op,
            `课桌的长边应落在 [${cfg.deskLenCells[0]}, ${cfg.deskLenCells[1]}] 格里，拿到 ${longSide} 格`,
            ctx,
          )
        }
      }

      // spec `dungeon-layout`「障碍物不挡住门」
      for (let k = 0; k < room.doors.length; k++) {
        if (rectsIntersect(doorRect(room.doors[k]!, wt), r)) {
          fail(
            op,
            `${where(op, r)} 挡住了 rooms[${i}].doors[${k}] —— ` +
              `一张课桌正堵在门口，房间进得去出不来`,
            ctx,
          )
        }
      }

      obstacleArea += r.width * r.height
    }

    // spec `dungeon-layout`「障碍物密度受配置上限约束」
    const roomArea = room.rect.width * room.rect.height
    if (obstacleArea > roomArea * cfg.obstacleDensityMax + 1e-9) {
      fail(
        at('obstacles'),
        `障碍物占了 ${((obstacleArea / roomArea) * 100).toFixed(1)}%，` +
          `超过 obstacleDensityMax = ${cfg.obstacleDensityMax}（教室面积 ${roomArea}）`,
        ctx,
      )
    }

    // ---------------------------------------------------------- 出生点
    const ix0 = left(room.rect) + wt / 2
    const ix1 = right(room.rect) - wt / 2
    const iy0 = top(room.rect) + wt / 2
    const iy1 = bottom(room.rect) - wt / 2
    for (let j = 0; j < room.spawnPoints.length; j++) {
      const p = room.spawnPoints[j]!
      const pp = `rooms[${i}].spawnPoints[${j}]`
      if (!(p.x > ix0 && p.x < ix1 && p.y > iy0 && p.y < iy1)) {
        fail(
          pp,
          `出生点 (${p.x}, ${p.y}) 不在教室内部 ` +
            `(x ∈ (${ix0}, ${ix1}), y ∈ (${iy0}, ${iy1}))`,
          { ...ctx, point: p },
        )
      }
      // 出生点落在格中心上 —— 「这一点算不算堵」的判定是按格中心做的
      // （见 `walkability.ts`）。出生点不在格中心上，那句话就答不了。
      if (!onCellCenter(p.x, ox) || !onCellCenter(p.y, oy)) {
        fail(pp, `出生点 (${p.x}, ${p.y}) 没落在格中心上`, { ...ctx, point: p })
      }
    }
  }

  // ------------------------------------------------------------ 3. 全局

  // spec `dungeon-layout`「最后一间恒为首领」+「首领房不可能是侧室」
  const first = map.rooms[0]!
  if (first.kind !== 'start') {
    fail('rooms[0].kind', `起点房的 kind 应是 'start'，拿到 '${first.kind}'`, { roomOrder: 0 })
  }
  const last = map.rooms[n - 1]!
  if (last.kind !== 'boss') {
    fail(
      `rooms[${n - 1}].kind`,
      `最后一间应是 'boss'，拿到 '${last.kind}' —— 需求 §1.1 的单局终点是首领`,
      { roomOrder: last.order },
    )
  }
  if (last.branch !== 'main') {
    fail(`rooms[${n - 1}].branch`, `首领房不能是侧室`, { roomOrder: last.order })
  }

  // spec `dungeon-pacing`「预算单调不减」
  for (let i = 1; i < mains.length; i++) {
    const prev = mains[i - 1]!
    const cur = mains[i]!
    if (cur.budget < prev.budget) {
      fail(`rooms[${cur.order}].budget`, `预算沿进度轴单调不减，但 ${prev.budget} → ${cur.budget} 降了`, {
        roomOrder: cur.order,
      })
    }
  }

  // spec `dungeon-pacing`「爬升按进度百分比参数化」：
  // 末间强度与主干数无关 —— 否则长局的末尾呈指数级强于短局。
  const boss = mains[mains.length - 1]!
  if (boss.kind !== 'boss') {
    fail(`rooms[${boss.order}].kind`, `主干轴最后一间应是 'boss'，拿到 '${boss.kind}'`, {
      roomOrder: boss.order,
    })
  }

  return {
    roomCount: n,
    mainCount,
    sideCount,
    obstacleCount: map.rooms.reduce((s: number, r: Room) => s + r.obstacles.length, 0),
    spawnPointCount: map.rooms.reduce((s: number, r: Room) => s + r.spawnPoints.length, 0),
  }
}

/** 便利：房间的出生点数组里有没有落在这个点上的（校验与测试共用）。 */
export function spawnPointAt(room: Room, p: Point): boolean {
  return room.spawnPoints.some((q) => Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6)
}