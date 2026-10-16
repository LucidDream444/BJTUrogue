/**
 * `rooms.json` 的加载与校验。**零 Phaser 依赖**，node 下可直接单测。
 *
 * 风格照 `core/config.ts`：错误一律抛 `ConfigError` 并**带字段路径**
 * （形如 `rooms.sideRoomTiers[1].width`）。理由在那个文件里写着 ——
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
import { ROOM_KINDS, ROOM_KIND_LABELS } from './model/types'
import type { Rect, RoomKind } from './model/types'

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

  /**
   * 主干教室的宽度档位（px）。每一档取一次 `Rng`，同一排里可以混着出现
   * ——「随机刷新」在这排房子上的表现就是宽度不一。
   */
  mainWidthTiers: number[]

  /**
   * **主干教室与连廊的统一高度**（px）。含两端的墙。
   *
   * 为什么高度不像宽度那样分档：侧室朝主干的那面墙要**同时**贴住宿主教室和
   * 它东边那段连廊。两者高度不一，这两条线就不重合 —— 连廊的墙得在每两间房
   * 之间跳一次台阶，而侧室的那面墙只能贴住其中一个，另一个露出缝。
   * 缝在数据里看不出来，在游戏里是「怪从这个洞里走进教室」。
   *
   * ⚠️ 必须是**奇数格**（`≡ navCellSize (mod 2 × navCellSize)`），
   * 校验会当场拒绝偶数格的值，理由见那里。
   */
  mainRoomHeight: number

  // 侧室按**宽高两维**取档：它只有一面墙与主干相邻，没有对齐的束缚。
  sideRoomTiers: RoomSizeTier[]

  /**
   * **侧室的关别权重** —— 一间侧室抽一次，内部按总和归一化（所以不必配成和为 1）。
   *
   * 用权重而不是概率（要凑成 1，改一个就得动另一个）也不是固定配比
   * （房间数随种子在 8—11 间主干之间浮动，固定数量会在边界上要特判）。
   *
   * 键 MUST NOT 出现 `start` / `boss` —— 那两个由**位置**决定
   * （起点恒为第一间、首领恒为最后一间），不是能抽出来的内容。
   * 校验器在**加载配置时**就拒绝，而不是生成出一局「首领房挂在教室上面」的地图。
   */
  sideKindWeights: Partial<Record<RoomKind, number>>

  /**
   * **哪几类关别要打。** 这一个集合同时决定三件事，而且是**唯一**的判据：
   *
   * | 集合内 | 集合外 |
   * |---|---|
   * | 摆课桌椅（掩体） | 一间桌椅都没有 |
   * | 有刷怪点 | `spawnPoints` 是空数组 |
   * | 有威胁预算 | `budget` 为 `0` |
   *
   * 拆成两个字段（`furnishedKinds` + `spawnKinds`）会更灵活，但会让
   * 「摆了桌椅但不刷怪」「不刷怪但预算写着 8」变成**合法数据** ——
   * 它们在数据里不报错、在画面上看不出来，而它们都是错的。
   * 等真的出现「商店想要课桌」这种需求时再拆，那时拆的理由是具体的。
   *
   * `main`（普通战）是**必须**在里面的一项：一排主干教室里总得有要打的屋子。
   */
  combatKinds: RoomKind[]

  /**
   * **清房宽限窗口（毫秒）**：房间静下来之后，再等这么久才宣告「已清」、开门。
   *
   * ## 为什么不能一空就开门
   *
   * 「房间空了」和「清完了」不是同一件事。最后一只**分裂怪**死掉时，
   * 它的人际上还有一段延迟：`enemies.json` 的 `splitDelayMs` 走完之后，
   * 子代才会进入刷怪队列（`EnemySystem.reapDead` → `requestSpawn`）。
   * 在那之前 `存活 = 0`、`队列 = 0` 都是**真的**，房间看起来就是空的。
   *
   * 所以判据要**等一小段安静**再说：连续 `settleMs` 毫秒没有新的击杀，
   * 才认定「不会再有东西冒出来了」。
   *
   * ## 取值来自哪
   *
   * MUST **大于** `enemies.json` 里最大的 `splitDelayMs`（今天是 180ms，第一代分裂怪）。
   * 这条跨文件的约束由 `roomFlow.test.ts` 盯着：D3 要是把分裂延迟调大到越过它，
   * 那里会当场炸，而不是等玩家发现「门提前开了、身后冒出一只怪」。
   *
   * ⚠️ 这是**用时间换正确性**。真正的解法是问 D3 要一个「本房还有几只没出来」的查询
   * （见 `openspec/changes/room-transitions` 的 Open Questions），那时这个窗口可以退成 0。
   */
  settleMs: number

  // 几何（px）
  /**
   * **连廊沿 x 的长度** —— 精确地说，是相邻两间主干教室**面向彼此的两条边界
   * 之间的距离**（隔墙就骑在这两条线上，所以连廊矩形两端**各含半堵墙**）。
   * 不是「房间之间让出来的空隙」。
   *
   * 首版它是后者（`roomGap` 是挂在走廊上的房间之间的让位），语义在这里换了、
   * 名字没换，所以 `rooms.json` 里必须写清 —— 沿用旧名字是**刻意**的：
   * 换名字会让 D1/D3 那边「搜 `roomGap` 没有结果」变成一次静默的语义漂移，
   * 而在配置表顶部写清楚，代价只是一行注释。
   */
  roomGap: number
  /** 全层最窄的可走净宽下限。**窄口 = 连廊净宽与门宽**（首版是「走廊宽度」）。 */
  minPassageWidth: number
  wallThickness: number

  // 门
  doorWidth: number
  doorClearance: number

  // 障碍物（**桌椅组**：一张桌 + 正下方紧贴的一把椅子，见 `gen/obstacles.ts`）
  deskWidthCells: number
  /**
   * 桌长的**上限**，格。每组桌椅抽一次 `[deskWidthCells, deskWidthCellsMax]` 的宽度 ——
   * 于是同一间房里既有两格的桌、也有三四格的，形状不至于千篇一律。
   * 等于 `deskWidthCells` 时退化成「每张桌一样长」。
   */
  deskWidthCellsMax: number
  deskHeightCells: number
  /** 同一排相邻两张桌之间留几格走道 */
  deskGapCells: number
  /** 两排桌椅之间留几格走道 */
  deskRowGapCells: number
  deskRowsMin: number
  deskRowsMax: number
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

  // 主干教室的**宽度**档位。宽必须是寻路格的整数倍 —— 按格对齐是「可视 = 可走性」
  // 的前提，而它必须从档位这一层就成立，否则后面每一处都得各自取整，迟早有一处忘了。
  const mainWidthTiers = needArray(
    need(root.mainWidthTiers, 'rooms.mainWidthTiers'),
    'rooms.mainWidthTiers',
  ).map((w, i) => {
    const width = needNumber(w, `rooms.mainWidthTiers[${i}]`, { integer: true, min: 1 })
    if (width % navCellSize !== 0) {
      throw new ConfigError(
        `rooms.mainWidthTiers[${i}]`,
        `必须是 navCellSize（${navCellSize}）的整数倍，拿到 ${width}`,
      )
    }
    return width
  })

  const mainRoomHeight = needNumber(
    need(root.mainRoomHeight, 'rooms.mainRoomHeight'),
    'rooms.mainRoomHeight',
    { integer: true, min: 1 },
  )

  // 侧室的档位是**宽高两维**：它只有一面墙与主干相邻，没有「上下墙要对齐」的束缚。
  // 主干教室不行，所以它只按宽度分档（见 mainRoomHeight）。
  const sideRoomTiers = needArray(
    need(root.sideRoomTiers, 'rooms.sideRoomTiers'),
    'rooms.sideRoomTiers',
  ).map((t, i): RoomSizeTier => {
    const o = needObject(t, `rooms.sideRoomTiers[${i}]`)
    const width = needNumber(o.width, `rooms.sideRoomTiers[${i}].width`, { integer: true, min: 1 })
    const height = needNumber(o.height, `rooms.sideRoomTiers[${i}].height`, {
      integer: true,
      min: 1,
    })
    if (width % navCellSize !== 0) {
      throw new ConfigError(
        `rooms.sideRoomTiers[${i}].width`,
        `必须是 navCellSize（${navCellSize}）的整数倍，拿到 ${width}`,
      )
    }
    if (height % navCellSize !== 0) {
      throw new ConfigError(
        `rooms.sideRoomTiers[${i}].height`,
        `必须是 navCellSize（${navCellSize}）的整数倍，拿到 ${height}`,
      )
    }
    return { width, height }
  })

  // 关别：侧室抽哪几类、哪几类要打。**这两张表在几何校验之前读** ——
  // 它们不影响几何，但错了的话后面所有关于房间内容的判定都建立在错的集合上。
  const sideKindWeights = needSideKindWeights(
    need(root.sideKindWeights, 'rooms.sideKindWeights'),
    'rooms.sideKindWeights',
  )
  const combatKinds = needCombatKinds(
    need(root.combatKinds, 'rooms.combatKinds'),
    'rooms.combatKinds',
  )

  const minPassageWidth = needNumber(
    need(root.minPassageWidth, 'rooms.minPassageWidth'),
    'rooms.minPassageWidth',
    { min: 1 },
  )
  const roomGap = needNumber(need(root.roomGap, 'rooms.roomGap'), 'rooms.roomGap', { min: 1 })
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

  // ⚠️ **主干高度必须是奇数格**（`h ≡ navCellSize (mod 2 × navCellSize)`）。
  // 这一条是给一个**绕不过去**的半格偏移守门的，推导如下：
  //
  //   带的上墙中心线在 ±h/2，而它必须落在**格中心**上（`20 + 40n`）：
  //       h/2 ≡ navCellSize/2 (mod navCellSize)   →   h ≡ navCellSize (mod 2 × navCellSize)
  //
  // 于是带高**永远是奇数格**，带的中线（y = 0）就永远落在一条**格边界**上。
  // 而门洞两端必须落在格边界上（否则 120px 的门会放过去 4 格，见 `layout.ts` 文件头 ③），
  // 所以竖直墙上那两扇门（主干 ↔ 连廊）的门心只能取 `y ≡ navCellSize/2 (mod navCellSize)`
  // —— **取不到 0**。
  //
  // 谁把 h 调成偶数格（240 / 320），中线就变回格中心、门心本可以放回 0，
  // 而 `layout.ts` 里那个偏移会**悄悄变成错的**（门洞两端落到格中心上，实际能过 4 格）。
  // 与其让下一个人对着 `y = 20` 推一遍，不如在这里当场拒绝偶数格的高度。
  if (mainRoomHeight % (navCellSize * 2) !== navCellSize) {
    throw new ConfigError(
      'rooms.mainRoomHeight',
      `必须是奇数格（≡ ${navCellSize} mod ${navCellSize * 2}），否则带的中线会落在格中心上、` +
        `而竖直墙上的门心偏移 ${navCellSize / 2}px 会变成错的（门洞两端落到格中心，` +
        `实际能过的格子数多一个）。拿到 ${mainRoomHeight}`,
    )
  }

  // 连廊净宽 = 带高减去**一层**墙厚（墙骑在带的上下两条边上，各往里吃半个墙厚，
  // 所以减的是 1×wt 而不是 2×wt —— 首版的 corridorRect 有同一个陷阱）。
  // 它也得守住「最宽的东西过得去」：门够宽而连廊本身挤，玩家一样过不去。
  const passageClear = mainRoomHeight - wallThickness
  if (passageClear < minPassageWidth) {
    throw new ConfigError(
      'rooms.mainRoomHeight',
      `连廊净宽（mainRoomHeight − wallThickness = ${passageClear}）` +
        `不能小于 minPassageWidth（${minPassageWidth}）`,
    )
  }

  // ⚠️ **连廊长度必须是整格。** 一排里每间主干教室的东边界都是「格中心线」
  // （首版就有的相位不变量：房间边界落在格中心上，墙才正好封掉一格）。
  // `roomGap` 是相邻两条这种线之间的距离，所以它只能是格长的整数倍 ——
  // 写 170 的话下一间教室的西边界整体偏了 10px，**一排里所有后续的房间与墙**
  // 都跟着偏，寻路格子与几何错开半格，而生成器自己一声不吭。
  if (roomGap % navCellSize !== 0) {
    throw new ConfigError(
      'rooms.roomGap',
      `必须是 navCellSize（${navCellSize}）的整数倍，否则相邻两间主干教室的边界` +
        `相差半格，整排房间与寻路格错开。拿到 ${roomGap}`,
    )
  }

  // 连廊内部沿 x 的长度也得留出来。这一条守的**不是**「最宽的东西过得去」
  // （沿 x 走的时候，横截面是那条 240px 高的净宽，不是长度），而是
  // **它得真的是个空间**：`roomGap` 收到 40 以下，两端的隔墙就会重叠成一块实心
  // 厚墙，「主干 ↔ 连廊」那两扇门就会开在一块实心墙里 —— 门在数据里存在，
  // 几何上却没地方可开。校验器看得见这个矛盾，生成器看不见。
  const passageInterior = roomGap - wallThickness
  if (passageInterior < minPassageWidth) {
    throw new ConfigError(
      'rooms.roomGap',
      `连廊内部沿 x 的长度（roomGap − wallThickness = ${passageInterior}）` +
        `不能小于 minPassageWidth（${minPassageWidth}）—— 再短它就不是连廊，` +
        `而是两间教室之间的一堵厚墙`,
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

  // ⚠️ **门宽还必须是奇数格**（`≡ navCellSize (mod 2 × navCellSize)`）。
  // 整数格只保证「门洞长度是整格」，保证不了「两端落在格**边界**上」：
  //
  //   门心落在格**中心**上（`20 + 40n`，见 `layout.ts` 文件头 ②），
  //   两端 = 门心 ± 门宽/2 —— 要落回格边界（`40n`），门宽/2 就得是**半格**
  //   （`≡ 20 mod 40`），于是门宽 ≡ 40 (mod 80)：**奇数格**。
  //
  // 偶数格的门（80 / 160）两端落在格**中心**上，实际能过的格子数比设计的多一个
  // —— 120px 的门过 4 格。这正是「窄口净宽」那条约束想守的东西，而它
  // 在数据里看不出来（门宽写的还是 120），只在游戏里表现为「这扇门特别宽」。
  if (doorWidth % (navCellSize * 2) !== navCellSize) {
    throw new ConfigError(
      'rooms.doorWidth',
      `必须是奇数格（≡ ${navCellSize} mod ${navCellSize * 2}），否则门洞两端会落在` +
        `格中心而不是格边界上，实际能过的格子数比设计的多一个。拿到 ${doorWidth}`,
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

  // 门洞不能比窄口下限还窄。**窄口 = 连廊净宽与门宽**，两者守的是同一条
  // 「最宽的东西过得去」（肉盾直径 80 + 余量）。
  // 反过来的配置（连廊 200、门 40）会长成「能并排走两个人的连廊，
  // 尽头是一扇要侧身过的门」——那种地方会变成玩家的卡点。
  //
  // 注意这一条与上面那条连廊净宽的检查**不重复**：上面守的是连廊本身，
  // 这一条守的是门；两处都要单独过闸，因为它们各自可以单独被调窄。
  if (doorWidth < minPassageWidth) {
    throw new ConfigError(
      'rooms.doorWidth',
      `不能比 minPassageWidth（${minPassageWidth}）还窄 —— 两者守的是同一条 ` +
        `「最宽的东西过得去」。拿到 ${doorWidth}`,
    )
  }

  // 门洞必须比最宽的障碍物宽，否则「门被课桌堵住」会变成几何上不可避免的事。
  // ⚠️ 量的是课桌的**短边**（`min(宽, 高)`），不是宽 —— 门是给人过的一道口子，
  // 挡住它的是桌子的任意一维。课桌从「1 格宽的长条」改成「一张桌 + 一把椅子」之后
  // 宽的那一维大于短边，照宽去要求门洞会凭空把下限抬高。
  const deskWidthCells = needNumber(
    need(root.deskWidthCells, 'rooms.deskWidthCells'),
    'rooms.deskWidthCells',
    { integer: true, min: 1 },
  )
  const deskWidthCellsMax = needNumber(
    need(root.deskWidthCellsMax, 'rooms.deskWidthCellsMax'),
    'rooms.deskWidthCellsMax',
    { integer: true, min: 1 },
  )
  if (deskWidthCellsMax < deskWidthCells) {
    throw new ConfigError(
      'rooms.deskWidthCellsMax',
      `桌长上限（${deskWidthCellsMax}）小于下限（${deskWidthCells}）—— 抽不出宽度`,
    )
  }
  const deskHeightCells = needNumber(
    need(root.deskHeightCells, 'rooms.deskHeightCells'),
    'rooms.deskHeightCells',
    { integer: true, min: 1 },
  )
  const deskShortCells = Math.min(deskWidthCells, deskHeightCells)
  if (doorWidth < deskShortCells * navCellSize * 2) {
    throw new ConfigError(
      'rooms.doorWidth',
      `门洞（${doorWidth}）太窄了：课桌短边 ${deskShortCells} 格 = ${deskShortCells * navCellSize}px，` +
        `门至少要有两张桌子宽（${deskShortCells * navCellSize * 2}px），否则门必然堵`,
    )
  }

  const deskGapCells = needNumber(need(root.deskGapCells, 'rooms.deskGapCells'), 'rooms.deskGapCells', {
    integer: true,
    min: 0,
  })
  const deskRowGapCells = needNumber(
    need(root.deskRowGapCells, 'rooms.deskRowGapCells'),
    'rooms.deskRowGapCells',
    { integer: true, min: 0 },
  )
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

  // 清房宽限窗口。上界不是随口定的：2 秒的「安静」在画面上已经是「门卡住了」，
  // 而不是「它还在等最后一只」。配到那个量级一定是写错了，所以定为硬上限，
  // 让它在这里炸，而不是变成一条「打完了门不开」的玄学反馈。
  const settleMs = needNumber(need(root.settleMs, 'rooms.settleMs'), 'rooms.settleMs', {
    integer: true,
    min: 1,
    max: 2000,
  })

  return {
    schemaVersion,
    totalRooms,
    mainRoomMin,
    mainRoomMax,
    mainWidthTiers,
    mainRoomHeight,
    sideRoomTiers,
    sideKindWeights,
    combatKinds,
    settleMs,
    minPassageWidth,
    roomGap,
    wallThickness,
    doorWidth,
    doorClearance,
    deskWidthCells,
    deskWidthCellsMax,
    deskHeightCells,
    deskGapCells,
    deskRowGapCells,
    deskRowsMin,
    deskRowsMax,
    obstacleDensityMax,
    spawnPointsMin,
    spawnPointsMax,
    spawnPointMinGap,
    budgetBase,
    budgetGrowth,
    navCellSize,
  }
}

/**
 * 一个关别值。不在 `ROOM_KINDS` 里就报错，并**列出合法取值** ——
 * 只写「不合法」的话，读的人得自己去翻枚举，而翻到的那份可能已经过时了。
 */
function needRoomKind(value: unknown, path: string): RoomKind {
  if (typeof value !== 'string' || !(ROOM_KINDS as readonly string[]).includes(value)) {
    throw new ConfigError(
      path,
      `要一个关别（${ROOM_KINDS.join(' / ')}），拿到 ${JSON.stringify(value)}`,
    )
  }
  return value as RoomKind
}

/**
 * `sideKindWeights`：非空、键是合法关别、权重为正、**不许出现由位置决定的关别**。
 *
 * 最后一条是这个函数存在的主要理由。`start` / `boss` 不是「内容」而是「位置」：
 * 起点恒为第一间、首领恒为最后一间。让它们进这张表，抽签就会产出
 * 「首领房挂在普通教室上方」这种地图 —— 而它在几何上完全合法、校验器一句话都不会说。
 */
function needSideKindWeights(value: unknown, path: string): Partial<Record<RoomKind, number>> {
  const obj = needObject(value, path)
  const keys = Object.keys(obj)
  if (keys.length === 0) {
    throw new ConfigError(path, '至少要有一类关别 —— 侧室的关别就是从这张表里抽的')
  }
  const out: Partial<Record<RoomKind, number>> = {}
  for (const key of keys) {
    const kind = needRoomKind(key, `${path}.${key}`)
    if (kind === 'start' || kind === 'boss') {
      throw new ConfigError(
        `${path}.${key}`,
        `「${ROOM_KIND_LABELS[kind]}」由**位置**决定（起点恒为第一间、首领恒为最后一间），` +
          `不是能抽出来的内容 —— 放进来的话会生成出「首领房挂在普通教室上方」的地图，` +
          `而它在几何上完全合法`,
      )
    }
    const w = needNumber(obj[key], `${path}.${key}`)
    if (w <= 0) {
      throw new ConfigError(
        `${path}.${key}`,
        `权重要大于 0，拿到 ${w} —— 写 0 等于「这一类永远抽不到」，` +
          `那就该把它从表里删掉，而不是留一个抽不到的名字`,
      )
    }
    out[kind] = w
  }
  return out
}

/**
 * `combatKinds`：非空、无重复、每个都是合法关别、**必须含 `main`**。
 *
 * 必须含 `main` 的理由很具体：一排主干教室里「普通战」是默认量，
 * 把它排除掉就等于整层楼没有可打的屋子。`start` / `boss` 反而是可以排除的
 * （起点房空着、首领房留出闪避空间，都是合理的配置）—— 所以只钉 `main` 这一条。
 */
function needCombatKinds(value: unknown, path: string): RoomKind[] {
  const arr = needArray(value, path)
  const out: RoomKind[] = []
  for (let i = 0; i < arr.length; i++) {
    const kind = needRoomKind(arr[i], `${path}[${i}]`)
    if (out.includes(kind)) {
      throw new ConfigError(`${path}[${i}]`, `「${ROOM_KIND_LABELS[kind]}」重复了`)
    }
    out.push(kind)
  }
  if (!out.includes('main')) {
    throw new ConfigError(
      path,
      `必须含 main（${ROOM_KIND_LABELS.main}）：一排主干教室里总要有要打的屋子，` +
        `否则整层没有威胁预算、也没有一处会刷怪。拿到 [${out.join(', ')}]`,
    )
  }
  return out
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

/**
 * 同上一份，但先把配置改成「整层只要 `roomCount` 间」的版本，**再走一遍校验器**。
 *
 * 用途是测试场要的**短层**：`joint/d1d2_rooms` 要三间（= 起点 / 普通战 / 首领）。
 * 侧室数 = `totalRooms − 主干数`，所以三个数一起钉成 N，侧室自然是 0 间
 * —— 想要的那三间就都在主干上，生成器一行都不用动。
 *
 * ## ⚠️ 改的是**原始 JSON**，不是展开已经解析好的 `RoomsConfig`
 *
 * `{ ...cfg, totalRooms: 3 }` 看着更短，但它**绕过了 `parseRoomsConfig`** ——
 * 字段类型、`mainRoomMax ≤ totalRooms`、档位与寻路格对齐那些守护全在那个函数里。
 * 展开之后拿到的是一个**没人校验过**的对象，下一步就进生成器了；
 * 它错了不会报错，只会生成出一层「看着像那么回事」的怪地图。
 *
 * 三个数也必须**一起**改：只改 `totalRooms` 会被校验器当场挡下
 * （`mainRoomMax` 还是 15 > 3）；只改主干那两条则还剩 12 间侧室，不是要的三间。
 * 三种改法只有一种自洽 —— 所以这里替调用方把它定下来，并让校验器照常说话。
 */
export function roomsConfigWithRoomCount(
  cache: { get(key: string): unknown },
  roomCount: number,
): RoomsConfig {
  const raw = needObject(cache.get(ROOMS_CONFIG_NAME), 'rooms')
  return parseRoomsConfig({
    ...raw,
    totalRooms: roomCount,
    mainRoomMin: roomCount,
    mainRoomMax: roomCount,
  })
}

/** 便利取数器：某个尺寸档位的世界矩形（`x` / `y` 是中心，见 `model/types.ts`）。 */
export function tierRect(tier: RoomSizeTier, x: number, y: number): Rect {
  return { x, y, width: tier.width, height: tier.height }
}

/**
 * 连廊的**净宽**（可走的那一条，不含墙），也就是全层「窄口」的候选之一。
 *
 * **为什么要有这个函数，而不是各写各的 `h − wt`：** 这里最容易算错的就是减几层墙。
 * 墙骑在带的上下两条边上、各往里吃半个墙厚，所以是 `− 1 × wallThickness`，
 * 不是 `− 2 × wallThickness`。首版的 `corridorRect`（同样是含墙的矩形）
 * 在缩略图里就被当成可走区域读过一次，两个场子对同一个种子报出 200 / 160 两个数
 * —— 差的那 40 正好是一层墙厚。
 *
 * 生成器、校验器、测试场都走这一个函数，那条坑就只存在一处。
 */
export function passageClearWidth(cfg: RoomsConfig): number {
  return cfg.mainRoomHeight - cfg.wallThickness
}

/**
 * 这一类关别**要不要打** —— 摆桌椅、刷怪、威胁预算三件事的唯一判据。
 *
 * 抽成函数而不是各处写 `cfg.combatKinds.includes(...)`：那行代码抄三遍之后，
 * 改判据时漏掉一处不会报错，只会让那个文件按老规矩走 ——
 * 症状是「同一间房，生成器摆了桌椅、校验器说它不该有桌椅」。
 */
export function isCombatKind(cfg: RoomsConfig, kind: RoomKind): boolean {
  return cfg.combatKinds.includes(kind)
}