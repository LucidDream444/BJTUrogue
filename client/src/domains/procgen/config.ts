/**
 * `rooms.json` 的加载与校验。**零 Phaser 依赖**，node 下可直接单测。
 *
 * 风格照 `core/config.ts`：错误一律抛 `ConfigError` 并**带字段路径**
 * （形如 `rooms.roomKindWeights.main`）。理由在那个文件里写着 ——
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
import { ROOM_KINDS, ROOM_KINDS_EMITTED, ROOM_KIND_LABELS } from './model/types'
import type { RoomKind } from './model/types'

// ---------------------------------------------------------------- 形状

/**
 * `rooms.json` 的落地形状。
 *
 * 名字里的 `Min` / `Max` 一律**含两端**（和 `Rng.between` 的语义一致）。
 *
 * ⚠️ **这一份里已经没有几何了。** 房间数、尺寸、间距、走廊宽度在 v5 全部搬去了
 * `floor-plan.json`（那边是照 6F 平面图照片量出来的格坐标）。留在这一份里的是
 * 与种子有关的东西：关别权重、桌椅、刷怪点、预算曲线。
 * 看见 `rooms.json` 里想加一个 `mainWidthTiers` 的时候，先问一句
 * 「改这个数会不会让房间挪位置」—— 会的话它属于平面图那张表。
 */
export interface RoomsConfig {
  schemaVersion: number

  /**
   * 这一层有几间**编号教室**（今天 15）。
   *
   * ⚠️ **不是「这一层有几间房」** —— 那个数是 `FLOOR_ROOM_TOTAL`（16，多一间楼梯间）。
   * 楼梯间不按种子抽关别（`kind` 恒为 `start`），所以它不在这个数里。
   * 名字从 `totalRooms` 改过来就是因为这一点：叫 `totalRooms` 时，
   * 读的人会照着它去生成「15 间房」，而出生点就没有一间属于它的房 ——
   * 且校验器也照着 15 查、全绿。
   *
   * 它的作用只剩**与平面图对账**：`floorPlan.ts` 的 `checkRoomCount` 拿
   * 平面图上的条数核这个数，对不上就当场炸。
   */
  classroomCount: number

  /**
   * **按种子抽关别的那 12 间教室，各是普通 / 精英 / 道具 / 宝箱里的哪一类。**
   *
   * 内部按总和归一化（不必配成和为 1）。**这一张表是发牌的依据，不是 12 次独立抽签**
   * —— `layout.ts` 的 `kindBag()` 先按最大余数法把它折成一副正好 12 张的牌再洗牌发下去。
   * 独立抽的问题不是概率算错，而是**某些种子会抽出一层 10 间道具房**：
   * 那一局没有仗可打，且不报错、不抛异常。
   *
   * 键 MUST NOT 出现 `start` / `boss`，也 MUST NOT 出现本期不产出的
   * `shop` / `hidden`：前两个由**位置**决定（出生点恒在楼梯间、首领恒在 YF604），
   * 不是能抽出来的内容；后两个抽出来会让 `ROOM_KINDS_EMITTED` 对不上。
   * 校验器在**加载配置时**就拒绝，而不是生成出一局有两个首领的图。
   *
   * **权重必须为正：写 `0` 在加载期就会被拒**（`needRoomKindWeights`）——
   * 「这一类不要」在这张表里的写法是**把这个键删掉**。留一个恒为 0 的名字，
   * 下一个人会以为把它改大就能出这一类。
   *
   * ⚠️ 这里原写的是「写 `0` 有权重表里的语义……`kindBag()` 补余数时会跳过它」
   * —— 那是**读 kindBag 的实现倒推**出来的说法，而正常路径根本到不了那儿：
   * 配置表在 `parseRoomsConfig` 就被拦下了。`kindBag()` 里那条「权重 ≤ 0 不补名额」
   * 是给**手写权重表**兜底的第二道（测试会直接喂它），不是可用的配置写法。
   */
  roomKindWeights: Partial<Record<RoomKind, number>>

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
   * `main`（普通战）是**必须**在里面的一项。`boss` 也是 —— 首领关不打怪的话，
   * 那一局没有出口（打完首领才能下楼）。
   *
   * ⚠️ **`start` MUST NOT 在里面**，这条是 v5 加的硬要求：
   * `start` 是**楼梯间**，也就是玩家的出生点。它在里面意味着出生点摆课桌、
   * 刷一屋子怪 —— 怪直接围在玩家脸上，而那是这一层的第一帧。
   * 首版的 `start` 在集合里，因为那时「起点房」是一间真的教室（主干第一间）；
   * 现在起点恒为楼梯间，语义完全不同了，所以校验器会当场拒绝。
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

  // 几何（px）。**只剩三个数** —— 房间在哪、多大、间距多少全在 floor-plan.json 里
  /**
   * 全层最窄的可走净宽下限（px）。
   *
   * v4 它的窄口是「连廊净宽与门宽」两个；v5 里连廊的净宽由平面图决定，
   * 所以它今天只剩一个窄口：**门洞**。`floorPlan.ts` 的 `checkDoors` 拿它判
   * 「这门玩家挤不挤得过」—— 门太窄时地图上看着只是一条正常的缝。
   */
  minPassageWidth: number
  /**
   * 墙厚（px）。**门的短边恒为「一格」** —— 平面图上的门是整格挖出来的
   * （今天一律 3 格长：3×1 / 1×3，见 `floor-plan.json`），短边那一格 = `navCellSize`。
   *
   * ⚠️ 这里原写「门的短边**恒等于它**，`checkDoors` 也拿它核门矩形的短边」——
   * **`checkDoors` 不核这个**（2026-10-21 查：它只核三件事 —— 净宽 ≥ `minPassageWidth`、
   * 门的每一格都落在墙上、两侧正好是它声称的那两个空间）。而「短边 = 墙厚」今天
   * 只是因为 `wallThickness` 与 `navCellSize` 恰好都等于 40（校验只要求
   * `wallThickness ≥ navCellSize`，不是等号）。**要动这两个数中的一个时先看这一条。**
   *
   * ⚠️ v5 里墙是「空间之间空出来的那一格」（`layout.ts` 的 `buildWallRects`），
   * 所以这个数**不再是墙上的一块厚度**，而是「一堵墙默认占几格」的声明 ——
   * 平面图的 `_gap_comment` 要求相邻空间空出整整 1 格，那个 1 格 = 它。
   * 平面图上的格距与它不等时，墙仍然按**空出来的格子**长，不按这个数长。
   */
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
  /**
   * **两组桌椅之间**至少留几格走道。
   *
   * ⚠️ 这里原写「同一排相邻两张桌」—— v4 是成排摆的，这个数就只管「排内」。
   * 2026-10-16 改成散着摆之后它是**组间**的净距（哪个方向都算），见
   * `gen/obstacles.ts`：挨着摆的两组会连成一张更长的桌，也就是一堵过不去的墙。
   */
  deskGapCells: number
  /**
   * ⚠️ **今天没有任何生成代码读它**（只有本文件的解析与 `rooms.json` 的键）。
   *
   * 「排」的概念随 2026-10-16 的「摆几组、散着摆」一起不用了 ——
   * 组间净距统一由 `deskGapCells` 管。留着键是因为删配置字段要走 C2 契约流程，
   * **不是因为它还有用**；要拿它做点什么之前先读 `gen/obstacles.ts` 的文件头。
   */
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
//
// 这四个**导出**给 `gen/floorPlan.ts` 用（`floor-plan.json` 的解析）。
// 另起一份的代价不是几行重复，是**报错形状会分岔**：一边写「缺这个字段」、
// 一边写「缺少字段」，于是「配置表写错了」在不同文件里读起来像两种毛病，
// 而它们本来就是同一种。错误信息是这个项目里区分「配置错」与「代码错」的唯一凭据，
// 凭据分岔比代码分岔贵得多。

export function need<T>(value: T | undefined | null, path: string): T {
  if (value === undefined || value === null) throw new ConfigError(path, '缺这个字段')
  return value
}

export function needNumber(
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

export function needObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigError(path, `要一个对象，拿到 ${JSON.stringify(value)}`)
  }
  return value as Record<string, unknown>
}

export function needArray(value: unknown, path: string, minLen = 1): unknown[] {
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

  const classroomCount = needNumber(
    need(root.classroomCount, 'rooms.classroomCount'),
    'rooms.classroomCount',
    { integer: true, min: 2 },
  )

  // 格的边长。**全部几何换算的分母** —— 平面图里的格坐标靠它换成 px，
  // 而 `floor-plan.json` 与这一份的对账（`checkRoomCount`）也要它。
  const navCellSizeRaw = need(root.navCellSize, 'rooms.navCellSize')
  const navCellSize = needNumber(navCellSizeRaw, 'rooms.navCellSize', {
    integer: true,
    min: 8,
    max: 96,
  })

  // 关别：12 间泛型教室抽哪几类、哪几类要打。**这两张表在几何校验之前读** ——
  // 它们不影响几何，但错了的话后面所有关于房间内容的判定都建立在错的集合上。
  const roomKindWeights = needRoomKindWeights(
    need(root.roomKindWeights, 'rooms.roomKindWeights'),
    'rooms.roomKindWeights',
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
      `必须是 navCellSize（${navCellSize}）的整数倍（门洞要整格），拿到 ${doorWidth}。` +
        `这一条与下面的奇偶规则今天只约束 doorWidth 自己 —— 平面图里的门是另写的`,
    )
  }

  // ⚠️ **门宽还必须是奇数格**（`≡ navCellSize (mod 2 × navCellSize)`）。
  //
  // ★ 改了（v5）：**下面这套推导是 v4 的，今天它已经不成立了。**
  // 那时门洞由 `doorWidth` 算出来、墙以门心为中心，于是门心必须落在格中心
  // （`20 + 40n`）上：整数格只保证「门洞长度是整格」，保证不了「中心落在格中心上」，
  // 偶数格的门（80 / 160）中心落在格**边界**上、两侧的墙各差半格，实际能过的格子
  // 比设计的多一个（120px 的门过 4 格）。
  //
  // **v5 里门是平面图上整格挖出来的几格**（`floor-plan.json`，今天一律 3 格长：
  // 3×1 / 1×3），**偶数格的门几何上完全成立** —— `validate/contract.ts:334-336`
  // 写着同一件事（「奇偶那一条也作废了……留着这条会把对的门判成错的」），
  // 2026-10-21 实测把那扇门改成 4×1 之后 parse + generate + validateContract 全过。
  // 所以这条规则今天**只剩「约束 `doorWidth` 这一个值自己」**，与那 16 扇门无关。
  //
  // ⚠️ **下一句以前是错的，2026-10-20 改掉了**。原文写的是
  // 「`floorPlan.ts` 的 `checkDoors` 会核『每扇门的净宽 = doorWidth』」——
  // **它不核这个**。`checkDoors` 只核 `clearPx >= minPassageWidth`（净宽够不够过），
  // 宽一点的门是合法的，不是错。
  //
  // 于是跨文件约定的真实样子是：平面图里每扇门写的是**格矩形**（今天一律 3×1），
  // `parseFloorPlan` 换算成 px 之后**只跟 `minPassageWidth` 比**。
  // `doorWidth` 与本层的 16 扇门之间**没有任何代码在核**，只有这个奇数格规则
  // 在核 `doorWidth` 自己。所以：
  //
  // - 把 `doorWidth` 改成别的奇数格 → **16 扇门一个数都不用动**，只是
  //   `doorWidth` 变成只被 `colliders.test.ts` 读的**测试口径**（挡板该盖住几格）；
  // - 真要「每扇门都一样宽」，得**另加**一条判定，而那是收紧约束：
  //   比 `minPassageWidth` 宽的门本来是对的（双开门、走廊接口都会比它宽）。
  //   **没加**，因为「统一」这件事没人要求，而多加一条会挡掉合法的宽门。
  if (doorWidth % (navCellSize * 2) !== navCellSize) {
    throw new ConfigError(
      'rooms.doorWidth',
      `必须是奇数格（≡ ${navCellSize} mod ${navCellSize * 2}），拿到 ${doorWidth}。` +
        `⚠️ 理由（门心要落在格中心上）是 v4 的，v5 的门是平面图上整格挖出来的、` +
        `偶数格也成立 —— 这条规则今天只剩「管住 doorWidth 自己」，见上面那段 ★`,
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

  // 门洞不能比窄口下限还窄。**v5 里窄口只剩门这一个** —— 连廊的净宽由
  // 平面图决定，而平面图上的走廊是 6 格（240px），比门宽得多。
  // 「最宽的东西过得去」量的是肉盾直径 80 + 余量，门是它唯一可能的卡点。
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
    classroomCount,
    roomKindWeights,
    combatKinds,
    settleMs,
    minPassageWidth,
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
 * `roomKindWeights`：非空、键是合法关别、权重为正、**只许出现「能抽的」那几类**。
 *
 * 最后一条是这个函数存在的主要理由，而且它拦的是三类不同的错：
 *
 * - **`start` / `boss` 是位置，不是内容。** 起点恒为楼梯间（`STAIR`）、
 *   首领恒为 `YF604` —— 都在平面图里写死了。放进这张表，抽签就会产出
 *   「一层两个首领」或者「首领房被抽成了宝箱房」的地图，而它在几何上完全合法、
 *   校验器不说一句话，只是在游戏里没有出口。
 * - **`shop` / `hidden` 本期不产出**（不在 `ROOM_KINDS_EMITTED` 里）。
 *   抽出来会让 `validate/contract.ts` 的「关别必须是本期产出集合的一员」当场炸 ——
 *   但那时报的是**地图**错，真正的原因在配置表里，报错位置指错了地方。
 * - **写 0**：语义上「这一类不要」，但 `kindBag()` 补余数时会跳过它，
 *   所以它和「不在表里」等价。**留一个恒为 0 的名字不如删掉** ——
 *   留着的话，下一个人会以为改大一点就能出这一类，而它连名额都拿不到。
 */
function needRoomKindWeights(value: unknown, path: string): Partial<Record<RoomKind, number>> {
  const obj = needObject(value, path)
  const keys = Object.keys(obj)
  if (keys.length === 0) {
    throw new ConfigError(path, '至少要有一类关别 —— 那 12 间教室的关别就是从这张表里抽的')
  }
  const out: Partial<Record<RoomKind, number>> = {}
  for (const key of keys) {
    const kind = needRoomKind(key, `${path}.${key}`)
    if (kind === 'start' || kind === 'boss') {
      throw new ConfigError(
        `${path}.${key}`,
        `「${ROOM_KIND_LABELS[kind]}」由**位置**决定（出生点恒在楼梯间、首领恒在 YF604，` +
          `两者都写在 floor-plan.json 里），不是能抽出来的内容 —— ` +
          `放进来的话会生成出两个首领、或者一层没有首领的地图，` +
          `而它在几何上完全合法`,
      )
    }
    if (!ROOM_KINDS_EMITTED.includes(kind)) {
      throw new ConfigError(
        `${path}.${key}`,
        `「${ROOM_KIND_LABELS[kind]}」本期不产出（生成器只出 ` +
          `${ROOM_KINDS_EMITTED.join(' / ')}）—— 抽到它会让地图校验的「关别必须是产出集合的一员」` +
          `当场炸，而真正的原因在配置表里`,
      )
    }
    const w = needNumber(obj[key], `${path}.${key}`)
    if (w <= 0) {
      throw new ConfigError(
        `${path}.${key}`,
        `权重要大于 0，拿到 ${w} —— 写 0 等于「这一类拿不到名额」，` +
          `那就该把它从表里删掉，而不是留一个抽不到的名字`,
      )
    }
    out[kind] = w
  }
  return out
}

/**
 * `combatKinds`：非空、无重复、每个都是合法关别、**必须含 `main` 与 `boss`**、
 * **不许含 `start`**。
 *
 * 三条各有各的具体理由：
 *
 * - **含 `main`**：普通战是整层的默认量，排除掉就等于一层楼没有可打的屋子。
 * - **含 `boss`**：打完首领才能下楼。首领房不打怪 = 那一局没有出口。
 * - **不含 `start`**：⚠️ **这条是 v5 加的。** `start` 是**楼梯间**，
 *   也就是玩家的出生点（首版它在集合里，因为那时起点房是一间真的教室）。
 *   把它留在集合里意味着出生点摆满课桌椅、还刷一屋子怪 ——
 *   怪直接围在玩家脸上，而那是这一层的第一帧。
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
      `必须含 main（${ROOM_KIND_LABELS.main}）：一层楼总要有要打的屋子，` +
        `否则整层没有威胁预算、也没有一处会刷怪。拿到 [${out.join(', ')}]`,
    )
  }
  if (!out.includes('boss')) {
    throw new ConfigError(
      path,
      `必须含 boss（${ROOM_KIND_LABELS.boss}）：打完首领才能下楼，` +
        `首领房不打怪那一局就没有出口。拿到 [${out.join(', ')}]`,
    )
  }
  if (out.includes('start')) {
    throw new ConfigError(
      `${path}`,
      `不许含 start（${ROOM_KIND_LABELS.start}）：start 是**楼梯间**，也就是玩家的出生点 —— ` +
        `在里面意味着出生点摆课桌、刷一屋子怪，而那是这一层的第一帧。拿到 [${out.join(', ')}]`,
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
 * 这一类关别**要不要打** —— 摆桌椅、刷怪、威胁预算三件事的唯一判据。
 *
 * 抽成函数而不是各处写 `cfg.combatKinds.includes(...)`：那行代码抄三遍之后，
 * 改判据时漏掉一处不会报错，只会让那个文件按老规矩走 ——
 * 症状是「同一间房，生成器摆了桌椅、校验器说它不该有桌椅」。
 */
export function isCombatKind(cfg: RoomsConfig, kind: RoomKind): boolean {
  return cfg.combatKinds.includes(kind)
}

/**
 * 这一间**进门就该摆一个宝箱**吗。
 *
 * 判据是关别：`reward`（道具关）与 `chest`（宝箱关）—— 这两类**存在的意义就是进来拿东西**：
 * 不刷怪、门不封，宝箱就是它们的全部内容（见 `roomNeedsFight()`）。
 *
 * ⚠️ **判据不是「非战斗房」**，这一条是 2026-10-21 用户报的
 * 「进入楼梯间会生成一个宝箱，这不对」：楼梯间（`start`）也不打架，
 * 但它是**上下楼的中转站**（见 `ROOM_KIND_LABELS.start`），不是一间内容房 ——
 * 在里面摆宝箱等于给过道发奖励，而且它**每层都会再生成一个**（换层时
 * `lootedRooms` 会清空），三层的楼就白送三个。
 *
 * ⚠️ 加新的**非战斗**关别时要回来看这一行、明确表态（进名单还是不进）。
 * 写成 `!isCombatKind(cfg, kind)` 那种反判的话，新关别会**默认**捞到一个宝箱，
 * 而那种错只在有人真的走进那一间时才看得到。
 */
export function roomHasChest(kind: RoomKind): boolean {
  return kind === 'reward' || kind === 'chest'
}