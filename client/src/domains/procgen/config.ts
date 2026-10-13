/**
 * `rooms.json` 的加载与校验。**零 Phaser 依赖**，node 下可直接单测。
 *
 * 风格照 `core/config.ts`：错误一律抛 `ConfigError` 并**带字段路径**
 * （形如 `rooms.sizeTiers[1].width`）。理由在那个文件里写着 ——
 * 「配置表写错了」和「生成器写错了」在现场长得一模一样，而字段路径是唯一
 * 能让人一眼分辨的东西。
 *
 * ---
 *
 * ## 为什么没有并进 `core/config.ts` 的 `CONFIG_FILE_NAMES`
 *
 * `CONFIG_FILE_NAMES` 是**共用层**的清单（`AGENTS.md` §四：`core/` 改动需全员同意），
 * 而 `configUrl()` 的参数类型被钉死在那三个名字上。D2 往里面加一个文件，
 * 等于替其他四个人改共用层的公开形状。
 *
 * 所以这里自己走一遍同样的事：**同一个相对路径规则**（`config/rooms.json`，
 * **不带前导斜杠** —— `base` 是 `./`，部署时产物按版本号分目录，绝对路径会 404），
 * **同一套 `load.json` + `fetch` 两条路**。
 *
 * 代价是这一段逻辑有两份。这是**刻意的交换**：一份重复的加载器，
 * 换共用层不动一行。等哪天 `rooms.json` 真的该进共用清单时，
 * 那是一次全员同意的改动，不是 D2 顺手做的。
 */

import { ConfigError } from '@/core/config'
import type { Rect } from './model/types'

// ---------------------------------------------------------------- 形状

export interface RoomSizeTier {
  width: number
  height: number
}

/**
 * `rooms.json` 的落地形状。
 *
 * 名字里的 `Min` / `Max` 一律**含两端**（和 `Rng.between` 的语义一致）。
 */
export interface RoomsConfig {
  schemaVersion: number

  // 房间数量。**侧室数不在这里** —— 由 totalRooms − 主干数 得出，
  // 独立配置的话迟早出现「主干 + 侧室 ≠ 15」这种自相矛盾的地图。
  totalRooms: number
  mainRoomMin: number
  mainRoomMax: number

  sizeTiers: RoomSizeTier[]

  // 几何（px）
  corridorMinWidth: number
  roomGap: number
  wallThickness: number

  // 门
  doorWidth: number
  doorClearance: number

  // 障碍物
  deskWidthCells: number
  deskLenCells: [number, number]
  deskRowsMin: number
  deskRowsMax: number
  chairChance: number
  obstacleDensityMax: number

  // 刷怪点
  spawnPointsMin: number
  spawnPointsMax: number
  spawnPointMinGap: number

  // 威胁预算曲线
  budgetBase: number
  budgetGrowth: number

  navCellSize: number
}

/** 配置文件在 `public/` 下的相对路径。**不带前导斜杠**（见文件头）。 */
export const ROOMS_CONFIG_NAME = 'rooms.json'
export const ROOMS_CONFIG_URL = `config/${ROOMS_CONFIG_NAME}`

// ---------------------------------------------------------------- 取值

function need<T>(value: T | undefined | null, path: string): T {
  if (value === undefined || value === null) throw new ConfigError(path, '缺这个字段')
  return value
}

function needNumber(
  value: unknown,
  path: string,
  opts: { min?: number; max?: number; integer?: boolean } = {},
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ConfigError(path, `要一个有限数字，拿到 ${JSON.stringify(value)}`)
  }
  if (opts.integer && !Number.isInteger(value)) {
    throw new ConfigError(path, `要整数，拿到 ${value}`)
  }
  if (opts.min !== undefined && value < opts.min) {
    throw new ConfigError(path, `不能小于 ${opts.min}，拿到 ${value}`)
  }
  if (opts.max !== undefined && value > opts.max) {
    throw new ConfigError(path, `不能大于 ${opts.max}，拿到 ${value}`)
  }
  return value
}

function needObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigError(path, `要一个对象，拿到 ${JSON.stringify(value)}`)
  }
  return value as Record<string, unknown>
}

function needArray(value: unknown, path: string, minLen = 1): unknown[] {
  if (!Array.isArray(value)) {
    throw new ConfigError(path, `要一个数组，拿到 ${JSON.stringify(value)}`)
  }
  if (value.length < minLen) {
    throw new ConfigError(path, `至少要 ${minLen} 项，只有 ${value.length} 项`)
  }
  return value
}

// ---------------------------------------------------------------- 校验

/**
 * 校验一份 `rooms.json`。
 *
 * ⚠️ **校验器只管「配置自己自不自洽」，不管「生成出来的地图对不对」** ——
 * 后者在 `validate/` 里。这个分工不是洁癖：一张地图可能是错的而配置完全合法
 * （比如某个种子恰好把课桌摆到了门口），那时该报错的是地图校验，不是这里。
 */
export function parseRoomsConfig(raw: unknown): RoomsConfig {
  const root = needObject(raw, 'rooms')

  if (root.schemaVersion === undefined) {
    // 红线 3 的同一个精神：带版本号是为了将来能迁移。缺了就是没给迁移留路。
    throw new ConfigError('rooms.schemaVersion', '缺这个字段（红线 3：数据要带 schemaVersion）')
  }
  const schemaVersion = needNumber(root.schemaVersion, 'rooms.schemaVersion', { integer: true })

  const totalRooms = needNumber(need(root.totalRooms, 'rooms.totalRooms'), 'rooms.totalRooms', {
    integer: true,
    min: 2,
  })
  const mainRoomMin = needNumber(need(root.mainRoomMin, 'rooms.mainRoomMin'), 'rooms.mainRoomMin', {
    integer: true,
    min: 2,
  })
  const mainRoomMax = needNumber(need(root.mainRoomMax, 'rooms.mainRoomMax'), 'rooms.mainRoomMax', {
    integer: true,
    min: 2,
  })

  if (mainRoomMax < mainRoomMin) {
    throw new ConfigError(
      'rooms.mainRoomMax',
      `不能小于 mainRoomMin（${mainRoomMin}），拿到 ${mainRoomMax}`,
    )
  }
  if (mainRoomMax > totalRooms) {
    throw new ConfigError(
      'rooms.mainRoomMax',
      `主干教室数不能超过总房间数 ${totalRooms}，拿到 ${mainRoomMax}`,
    )
  }

  // 尺寸档位。**宽高必须是寻路格的整数倍** —— 按格对齐是「可视 = 可走性」的前提，
  // 而它必须从档位这一层就成立，否则后面每一处都得各自取整，迟早有一处忘了。
  const navCellSizeRaw = need(root.navCellSize, 'rooms.navCellSize')
  const navCellSize = needNumber(navCellSizeRaw, 'rooms.navCellSize', {
    integer: true,
    min: 8,
    max: 96,
  })

  const sizeTiers = needArray(need(root.sizeTiers, 'rooms.sizeTiers'), 'rooms.sizeTiers').map(
    (t, i): RoomSizeTier => {
      const o = needObject(t, `rooms.sizeTiers[${i}]`)
      const width = needNumber(o.width, `rooms.sizeTiers[${i}].width`, { integer: true, min: 1 })
      const height = needNumber(o.height, `rooms.sizeTiers[${i}].height`, { integer: true, min: 1 })
      if (width % navCellSize !== 0) {
        throw new ConfigError(
          `rooms.sizeTiers[${i}].width`,
          `必须是 navCellSize（${navCellSize}）的整数倍，拿到 ${width}`,
        )
      }
      if (height % navCellSize !== 0) {
        throw new ConfigError(
          `rooms.sizeTiers[${i}].height`,
          `必须是 navCellSize（${navCellSize}）的整数倍，拿到 ${height}`,
        )
      }
      return { width, height }
    },
  )

  const corridorMinWidth = needNumber(
    need(root.corridorMinWidth, 'rooms.corridorMinWidth'),
    'rooms.corridorMinWidth',
    { min: 1 },
  )
  const roomGap = needNumber(need(root.roomGap, 'rooms.roomGap'), 'rooms.roomGap', { min: 0 })
  const wallThickness = needNumber(
    need(root.wallThickness, 'rooms.wallThickness'),
    'rooms.wallThickness',
    { min: 1 },
  )

  // ⚠️ **墙厚必须 ≥ 一格。** 寻路是「格子中心点落在墙里才算堵」（见 `ArenaBase.makeNav`
  // 的 ⚠️），所以一堵比格还薄的墙，当它的中心落在格边界上时**一格中心都不覆盖** ——
  // 寻路会认为墙两侧都走得通，那是字面意义上的「墙上有洞」。
  // 现实里玩家撞得过去吗？撞不过（物理体是墙的矩形）。于是症状是
  // **怪径直穿墙走、玩家却被挡**，而两边都不报错。
  if (wallThickness < navCellSize) {
    throw new ConfigError(
      'rooms.wallThickness',
      `必须 ≥ navCellSize（${navCellSize}），否则薄墙落在格边界上时会一格中心都不覆盖 —— ` +
        `寻路认为墙两侧都走得通。拿到 ${wallThickness}`,
    )
  }

  const doorWidth = needNumber(need(root.doorWidth, 'rooms.doorWidth'), 'rooms.doorWidth', {
    min: 1,
  })
  if (doorWidth % navCellSize !== 0) {
    throw new ConfigError(
      'rooms.doorWidth',
      `必须是 navCellSize（${navCellSize}）的整数倍，否则门洞两端会落在格中心上、` +
        `实际能过的格子数比设计的多一个。拿到 ${doorWidth}`,
    )
  }
  const doorClearance = needNumber(
    need(root.doorClearance, 'rooms.doorClearance'),
    'rooms.doorClearance',
    { min: 0 },
  )

  // ⚠️ **净空圈至少要有整整一格。** 这个下限不是手感问题，是两条判定能不能对上的问题：
  //
  // - 障碍物生成按「离门矩形 ≥ doorClearance」避让
  // - 契约校验按「障碍物不与门矩形相交」拒绝
  //
  // 门矩形恰好占满墙所在的那一格（`wallThickness == navCellSize`），而格对齐、
  // 又在房间内的障碍物只能与它**共边**。所以 `doorClearance = 0` 时，
  // 一张紧贴门口内侧的课桌在生成器眼里完全合法（离门 0px ≥ 0），
  // 在校验器眼里却是"挡住了门" —— 同一张图，两个域给出的结论相反，
  // 而**玩家过不去是真的**。
  //
  // 要 ≥ 一格：贴门口那一格必须空出来，两条判定才都指向"这里能过"。
  if (doorClearance < navCellSize) {
    throw new ConfigError(
      'rooms.doorClearance',
      `必须 ≥ navCellSize（${navCellSize}），否则紧贴门口内侧的障碍物` +
        `在生成器眼里合法、在校验器眼里是"挡住了门" —— 同一张图两个结论，` +
        `而玩家过不去是真的。拿到 ${doorClearance}`,
    )
  }

  // 门洞不能比走廊还窄：走廊宽度的下限是「最宽的东西过得去」，门洞得守同一条。
  // 反过来的配置（走廊 200、门 40）会长成「能并排走两个人的走廊，
  // 尽头是一扇要侧身过的门」——那种地方会变成玩家的卡点。
  if (doorWidth < corridorMinWidth) {
    throw new ConfigError(
      'rooms.doorWidth',
      `不能比 corridorMinWidth（${corridorMinWidth}）还窄 —— 两者守的是同一条 ` +
        `「最宽的东西过得去」。拿到 ${doorWidth}`,
    )
  }

  // 门洞必须比最宽的障碍物宽，否则「门被课桌堵住」会变成几何上不可避免的事。
  const deskWidthCells = needNumber(
    need(root.deskWidthCells, 'rooms.deskWidthCells'),
    'rooms.deskWidthCells',
    { integer: true, min: 1 },
  )
  if (doorWidth < deskWidthCells * navCellSize * 2) {
    throw new ConfigError(
      'rooms.doorWidth',
      `门洞（${doorWidth}）太窄了：课桌宽 ${deskWidthCells} 格 = ${deskWidthCells * navCellSize}px，` +
        `门至少要有两张桌子宽（${deskWidthCells * navCellSize * 2}px），否则门必然堵`,
    )
  }

  const deskLenCells = needLenPair(need(root.deskLenCells, 'rooms.deskLenCells'), 'rooms.deskLenCells')
  const deskRowsMin = needNumber(need(root.deskRowsMin, 'rooms.deskRowsMin'), 'rooms.deskRowsMin', {
    integer: true,
    min: 0,
  })
  const deskRowsMax = needNumber(need(root.deskRowsMax, 'rooms.deskRowsMax'), 'rooms.deskRowsMax', {
    integer: true,
    min: 0,
  })
  if (deskRowsMax < deskRowsMin) {
    throw new ConfigError(
      'rooms.deskRowsMax',
      `不能小于 deskRowsMin（${deskRowsMin}），拿到 ${deskRowsMax}`,
    )
  }

  const chairChance = needNumber(need(root.chairChance, 'rooms.chairChance'), 'rooms.chairChance', {
    min: 0,
    max: 1,
  })
  const obstacleDensityMax = needNumber(
    need(root.obstacleDensityMax, 'rooms.obstacleDensityMax'),
    'rooms.obstacleDensityMax',
    { min: 0, max: 1 },
  )

  const spawnPointsMin = needNumber(
    need(root.spawnPointsMin, 'rooms.spawnPointsMin'),
    'rooms.spawnPointsMin',
    { integer: true, min: 1 },
  )
  const spawnPointsMax = needNumber(
    need(root.spawnPointsMax, 'rooms.spawnPointsMax'),
    'rooms.spawnPointsMax',
    { integer: true, min: 1 },
  )
  if (spawnPointsMax < spawnPointsMin) {
    throw new ConfigError(
      'rooms.spawnPointsMax',
      `不能小于 spawnPointsMin（${spawnPointsMin}），拿到 ${spawnPointsMax}`,
    )
  }
  const spawnPointMinGap = needNumber(
    need(root.spawnPointMinGap, 'rooms.spawnPointMinGap'),
    'rooms.spawnPointMinGap',
    { min: 0 },
  )

  const budgetBase = needNumber(need(root.budgetBase, 'rooms.budgetBase'), 'rooms.budgetBase', {
    min: 0,
  })
  const budgetGrowth = needNumber(
    need(root.budgetGrowth, 'rooms.budgetGrowth'),
    'rooms.budgetGrowth',
    { min: 1 },
  )

  return {
    schemaVersion,
    totalRooms,
    mainRoomMin,
    mainRoomMax,
    sizeTiers,
    corridorMinWidth,
    roomGap,
    wallThickness,
    doorWidth,
    doorClearance,
    deskWidthCells,
    deskLenCells,
    deskRowsMin,
    deskRowsMax,
    chairChance,
    obstacleDensityMax,
    spawnPointsMin,
    spawnPointsMax,
    spawnPointMinGap,
    budgetBase,
    budgetGrowth,
    navCellSize,
  }
}

function needLenPair(value: unknown, path: string): [number, number] {
  const arr = needArray(value, path, 2)
  if (arr.length !== 2) throw new ConfigError(path, `要恰好两项 [最少, 最多]，拿到 ${arr.length} 项`)
  const lo = needNumber(arr[0], `${path}[0]`, { integer: true, min: 1 })
  const hi = needNumber(arr[1], `${path}[1]`, { integer: true, min: 1 })
  if (hi < lo) throw new ConfigError(`${path}[1]`, `不能小于 ${path}[0]（${lo}），拿到 ${hi}`)
  return [lo, hi]
}

// ---------------------------------------------------------------- 加载

/**
 * 从 `public/` 取一份 `rooms.json`。**只在开屏/换层调一次**（红线 1：
 * 游戏核心循环永远不 `await` 网络）。
 *
 * ⚠️ `base` 必须传（通常是 `import.meta.env.BASE_URL`）。别给它一个
 * `document.baseURI` 默认值 —— node 下求值即 `ReferenceError`，
 * 任何无参调用的单测会当场崩。
 *
 * 加载失败**直接抛**，绝不静默退回代码内默认值 —— 那会违反红线 2 的语义。
 */
export async function loadRoomsConfig(base: string): Promise<RoomsConfig> {
  const url = new URL(ROOMS_CONFIG_URL, base).href
  let res: Response
  try {
    res = await fetch(url)
  } catch (cause) {
    throw new ConfigError(ROOMS_CONFIG_URL, `网络请求失败（${url}）：${String(cause)}`)
  }
  if (!res.ok) throw new ConfigError(ROOMS_CONFIG_URL, `HTTP ${res.status}（${url}）`)

  let raw: unknown
  try {
    raw = await res.json()
  } catch (cause) {
    throw new ConfigError(ROOMS_CONFIG_URL, `不是合法 JSON：${String(cause)}`)
  }
  return parseRoomsConfig(raw)
}

/** 从 Phaser 的缓存里取一份已经用 `load.json` 载入的 `rooms.json`。 */
export function roomsConfigFromCache(cache: { get(key: string): unknown }): RoomsConfig {
  return parseRoomsConfig(cache.get(ROOMS_CONFIG_NAME))
}

/** 便利取数器：某个尺寸档位的世界矩形（`x` / `y` 是中心，见 `model/types.ts`）。 */
export function tierRect(tier: RoomSizeTier, x: number, y: number): Rect {
  return { x, y, width: tier.width, height: tier.height }
}