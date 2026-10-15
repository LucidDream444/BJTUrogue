/**
 * **几何契约**校验。纯函数，零 Phaser 依赖，node 下可直跑。
 *
 * ---
 *
 * ## 这个文件是「尺寸契约」的可执行版本
 *
 * spec `procgen-config-contract` 用一张表写了尺寸契约（40px 格 / 窄口净宽 ≥ 120 /
 * 主干教室与连廊等高 / 门洞两端落在格边界 / 课桌短边 1 格 / 按格对齐 / 只横竖 /
 * 椅子 1 格）。**一张写在文档里的表会被忘掉；一个会抛异常的断言不会。**
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
 * ## 关别那一层（schemaVersion 3 起）
 *
 * 尺寸契约之外，这里还守三条「数据合法、但说不通」的：
 *
 * - `start` / `boss` 只能出现在进度轴的两端（它们是**位置**，不是内容）
 * - 侧室的关别必须来自配置的 `sideKindWeights`（生成器的抽取范围就是它）
 * - 非战斗关别三空（桌椅 / 刷怪点 / 预算）
 *
 * 第三条的判据是 `isCombatKind()` —— 与生成器**同一个函数**。各写一份关别名册的
 * 失败形态是「摆了桌椅但不刷怪」，而且两边都不报错。
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
  ROOM_KIND_LABELS,
  sideRooms,
} from '../model/types'
import type { RoomsConfig } from '../config'
import { isCombatKind } from '../config'
import { doorRect, left, rectContains, rectsIntersect, right, top, bottom } from '../model/rect'
import { chairBelongsTo } from '../model/furniture'
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

    // spec `procgen-config-contract`「关别与位置一致」+「非战斗房三空」
    //
    // 关别表这一层要守三件事，三件都是「数据合法但说不通」：
    //
    // ① `start` / `boss` 是**位置**，不是内容 —— 它们只能出现在进度轴的两端
    //    （`start` ↔ order 0、`boss` ↔ 最大 order）。写成别的样子几何上完全合法，
    //    症状是「起点房在中间」或者「首领藏在侧室里」，而两者都不会抛。
    // ② 侧室的关别必须来自 `sideKindWeights` 的键集合 —— 生成器的抽取范围就是它。
    //    校验器挡的是**手工数据 / 存档迁移**里冒出来的、配置里根本没有的关别。
    // ③ 非战斗关别三空。判据只有 `combatKinds`（`isCombatKind`），
    //    与生成器读的是同一处 —— 分开写一份关别名册的话，改一处忘一处
    //    就会生成出「摆了桌椅但一个怪都没有」的房，两边都不报错。
    const label = ROOM_KIND_LABELS[room.kind]
    if (room.kind === 'start' && room.order !== 0) {
      fail(at('kind'), `「${label}」只能是第一间（order 0），这里 order = ${room.order}`, ctx)
    }
    if (room.kind === 'boss' && room.order !== n - 1) {
      fail(
        at('kind'),
        `「${label}」只能是最后一间（order ${n - 1}），这里 order = ${room.order} —— ` +
          `它是单局的终点，藏在中间就等于这局没有终点`,
        ctx,
      )
    }
    if (room.branch === 'side' && !(room.kind in cfg.sideKindWeights)) {
      const allowed = Object.keys(cfg.sideKindWeights).join(' / ')
      fail(
        at('kind'),
        `侧室的关别「${label}」不在 sideKindWeights 里（允许：${allowed}）—— ` +
          `侧室的关别就是从那张表里抽的，表外的一律是手工数据或迁移漏改`,
        ctx,
      )
    }
    if (!isCombatKind(cfg, room.kind)) {
      const why = `「${label}」不在 combatKinds（${cfg.combatKinds.join(' / ')}）里，是不打架的关别`
      if (room.obstacles.length > 0) {
        fail(at('obstacles'), `${why}，却摆着 ${room.obstacles.length} 件桌椅`, ctx)
      }
      if (room.spawnPoints.length > 0) {
        fail(
          at('spawnPoints'),
          `${why}，却有 ${room.spawnPoints.length} 个刷怪点 —— ` +
            `D1 的「进房关门、清完开门」在这里会永远等不到清空`,
          ctx,
        )
      }
      if (room.budget !== 0) {
        fail(at('budget'), `${why}，威胁预算却写着 ${room.budget} —— 一个没有敌人的场地没有威胁`, ctx)
      }
    }

    // ---- 尺寸契约
    //
    // 主干与侧室的档位**不是同一张表**，因为约束不同：
    // 主干教室的高度是**统一值**（`mainRoomHeight`，见 `layout.ts` 文件头 ① ——
    // 侧室朝主干那面墙要同时贴住宿主与连廊，高度不一就贴不住），只有宽度分档；
    // 侧室只有一面墙与主干相邻，宽高两维都可以取档。
    if (room.branch === 'main') {
      if (room.rect.height !== cfg.mainRoomHeight) {
        fail(
          at('rect'),
          `${where(at('rect'), room.rect)} 的高度不是 mainRoomHeight（${cfg.mainRoomHeight}）—— ` +
            `主干教室与连廊必须等高，否则侧室朝主干那面墙贴不住两条线，` +
            `连廊的墙得逐段跳台阶`,
          ctx,
        )
      }
      const tier = cfg.mainWidthTiers.indexOf(room.rect.width)
      if (tier < 0) {
        const list = cfg.mainWidthTiers.join(' / ')
        fail(
          at('rect'),
          `${where(at('rect'), room.rect)} 的宽度不匹配任何主干宽度档（${list}）`,
          ctx,
        )
      }
      if (room.sizeTier !== tier) {
        fail(at('sizeTier'), `记的是 ${room.sizeTier}，宽度反查出来是 ${tier} —— 两处不一致`, ctx)
      }
    } else {
      const tier = cfg.sideRoomTiers.findIndex(
        (t) => t.width === room.rect.width && t.height === room.rect.height,
      )
      if (tier < 0) {
        const list = cfg.sideRoomTiers.map((t) => `${t.width}×${t.height}`).join(' / ')
        fail(at('rect'), `${where(at('rect'), room.rect)} 不匹配任何侧室档位（${list}）`, ctx)
      }
      if (room.sizeTier !== tier) {
        fail(at('sizeTier'), `记的是 ${room.sizeTier}，尺寸反查出来是 ${tier} —— 两处不一致`, ctx)
      }
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
      // 门洞宽必须是**奇数格**（`≡ cell (mod 2×cell)`）。
      //
      // 整数格只保证「长度是整格」，保证不了「两端落在格**边界**上」：
      // 门心落在格中心上（`layout.ts` 文件头 ②），两端 = 门心 ± 门宽/2 ——
      // 门宽/2 得是**半格**，两端才落回格边界。120px（3 格）✓，80px / 160px（偶数格）✗，
      // 后者实际能过 4 格。而"多一个"不会有人发现，直到有人量碰撞箱。
      if (d.width % (cell * 2) !== cell) {
        fail(
          `${dp}.width`,
          `门洞宽 ${d.width} 不是奇数格（应 ≡ ${cell} mod ${cell * 2}）—— ` +
            `偶数格的门两端落在格中心上，实际可过的格子数会比设计多一个`,
          ctx,
        )
      }
      // 门洞两端落在格**边界**上，且覆盖整数格。上面那条只管宽度，
      // 管不了**位置**：整格宽的门摆在半个格子的偏移上，两端一样是格中心。
      const doorAlong0 = (d.axis === 'h' ? d.x : d.y) - d.width / 2
      const doorAlong1 = doorAlong0 + d.width
      const doorOrigin = d.axis === 'h' ? ox : oy
      if (!onCellBoundary(doorAlong0, doorOrigin) || !onCellBoundary(doorAlong1, doorOrigin)) {
        fail(
          `${dp}`,
          `门洞的两端 (${doorAlong0}, ${doorAlong1}) 没落在格边界上` +
            `（球心在 ${doorOrigin} + ${cell}k 处）—— 两端落在格中心上时，` +
            `实际可过的格子数会比设计多一个`,
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
    //
    // 走廊没有了，「开在主干道上」现在的意思是**开在某一扇竖直隔墙上、
    // 直接通进一段连廊**。少了它就说明这间房只能从侧室绕进来 ——
    // 而"主干"这个名字就没意义了。
    if (room.branch === 'main') {
      const toPassage = room.doors.filter((d) =>
        map.passages.some((p) => rectsIntersect(doorRect(d, wt), p.rect)),
      )
      if (toPassage.length === 0) {
        const kinds = room.doors.map((d) => `${d.kind}/${d.axis}`).join(', ') || '一扇都没有'
        fail(
          at('doors'),
          `主干教室没有一扇门直接通进连廊（现有的门：${kinds}）—— ` +
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
      // spec `procgen-config-contract`「侧室不超出宿主的西边界」：
      // 侧室横跨「宿主的一部分 + 一整段连廊」（`layout.ts` 文件头 ③），
      // 搭接长度 = 宿主东边界 − 侧室西边界。大于宿主宽度就意味着侧室伸到了
      // 宿主的西墙外面 —— 那在缩略图上只是「侧室比教室宽一点」，看不出错了。
      const host = mains[hostIdx]!
      const overlap = right(host.rect) - left(room.rect)
      if (overlap > host.rect.width) {
        fail(
          at('rect'),
          `侧室与宿主（order ${host.order}）的搭接长度 ${overlap} 超过了宿主宽度 ` +
            `${host.rect.width} —— 侧室伸到宿主的西墙外面去了`,
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
      if (o.kind === 'chair') {
        if (wc !== 1 || hc !== 1) {
          fail(op, `椅子恒为 1 格，拿到 ${wc}×${hc} 格`, ctx)
        }
      } else if (wc !== cfg.deskWidthCells || hc !== cfg.deskHeightCells) {
        fail(
          op,
          `课桌恒为 ${cfg.deskWidthCells}×${cfg.deskHeightCells} 格` +
            `（deskWidthCells × deskHeightCells），拿到 ${wc}×${hc} 格 —— ` +
            `尺寸不统一，桌椅就是横七竖八的`,
          ctx,
        )
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

    // 桌椅**成组**：每张桌正下方紧贴一把椅子，每把椅子恰好属于一张桌。
    //
    // 这不是风格建议 —— 画法（`model/furniture.ts`）与 D1 那张「桌 + 椅」贴图
    // 都建立在这条上：一张没有椅子的桌，画出来是**半件**家具；一把没有桌子的椅子，
    // 根本没有贴图可贴。生成侧构造上满足它（`gen/obstacles.ts` 一次推两件），
    // 这一条守的是**别处塞进来的**障碍物（D1 的宝箱落点、将来的新家具）。
    {
      const desks = room.obstacles.filter((o) => o.kind === 'desk')
      const chairs = room.obstacles.filter((o) => o.kind === 'chair')
      for (let j = 0; j < room.obstacles.length; j++) {
        const o = room.obstacles[j]!
        const op = `rooms[${i}].obstacles[${j}]`
        if (o.kind === 'chair') {
          if (!desks.some((d) => chairBelongsTo(o.rect, d.rect))) {
            fail(
              op,
              `${where(op, o.rect)} 是一把**孤零零**的椅子 —— 桌椅成组（一张桌 + ` +
                `正下方紧贴的一把椅子），它上面没有桌子`,
              ctx,
            )
          }
        } else if (!chairs.some((c) => chairBelongsTo(c.rect, o.rect))) {
          fail(
            op,
            `${where(op, o.rect)} 这张课桌底下没有椅子 —— 桌椅成组，` +
              `少了椅子画出来是半件家具（椅子贴在桌子正下方，横向落在桌子的跨度里）`,
            ctx,
          )
        }
      }
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

  // ------------------------------------------------------------ 3. 连廊

  // spec `procgen-config-contract`「地图用连廊表达连接，而不是一条贯穿的走廊」
  //
  // 数目与形状一起钉死：`N − 1` 段、每段只夹在两间**相邻**主干教室之间。
  // 「贯穿全层的一条走廊」也能凑出 `N − 1` 段来（只要有人手工切一刀），
  // 所以数目对不算通过 —— 还要每一段的 `between` 报出的确实是相邻的两间。
  if (map.passages.length !== mainCount - 1) {
    fail(
      'passages',
      `连廊段数应为「主干教室数 − 1」= ${mainCount - 1}，实际 ${map.passages.length} —— ` +
        `连廊是**教室之间**的连接，不是与教室并列、贯穿全层的空间`,
    )
  }
  for (let i = 0; i < map.passages.length; i++) {
    const p = map.passages[i]!
    const pp = `passages[${i}]`
    // 与主干教室**等高**：同一条带里交替排开，上下两条墙线才是同两条直线
    if (p.rect.height !== cfg.mainRoomHeight) {
      fail(
        pp,
        `${where(pp, p.rect)} 的高度不是 mainRoomHeight（${cfg.mainRoomHeight}）—— ` +
          `连廊与主干教室必须等高，否则连廊的墙要在每两间房之间跳一次台阶`,
      )
    }
    // 沿 x 的长度 = roomGap（含两端各半堵墙，见 `model/types.ts` 的 `Passage`）
    if (p.rect.width !== cfg.roomGap) {
      fail(pp, `${where(pp, p.rect)} 的长度不是配置的 roomGap（${cfg.roomGap}）`)
    }
    // 两端落在格中心上（它们同时也是相邻两间教室的边界）
    if (!onCellCenter(left(p.rect), ox) || !onCellCenter(right(p.rect), ox)) {
      fail(pp, `${where(pp, p.rect)} 的左右边界没落在格中心上`)
    }
    if (!onCellCenter(top(p.rect), oy) || !onCellCenter(bottom(p.rect), oy)) {
      fail(pp, `${where(pp, p.rect)} 的上下边界没落在格中心上`)
    }
    // `between` 报出的必须是主干轴上**相邻**的两间，且升序
    const [a, b] = p.between
    const ai = mains.findIndex((m) => m.order === a)
    const bi = mains.findIndex((m) => m.order === b)
    if (ai < 0 || bi < 0 || bi !== ai + 1) {
      fail(
        `${pp}.between`,
        `报的是 order ${a} 与 ${b}，但它们不是主干轴上相邻的两间 —— ` +
          `D1 的封门逻辑靠这个字段，报错了就是"锁了，但不是该锁的那扇"`,
      )
    }
  }

  // ------------------------------------------------------------ 4. 全局

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