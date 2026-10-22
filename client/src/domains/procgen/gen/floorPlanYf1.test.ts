/**
 * **逸夫楼 1F**（`public/config/floor-plan-yf1.json`）—— 用户 2026-10-22 给的两张 1F 照片。
 *
 * 这一层与 6F / 3F 的来源完全不同：那两份是照着一张照片量的（3F 还是「6F + 三处编辑」），
 * 这一份是**把楼的两部分并成一张图**。用户的要求逐条是：
 *
 * | 要求 | 落在这里的哪一条 |
 * |---|---|
 * | 「两部分分开，中间没有的地方空着就行」 | 两块之间 25 格全是墙，只有一条过道穿过 |
 * | 「两部分加起来和 YF6 大小一样」 | 包围盒与 6F **逐像素一样** |
 * | 「房间标号与图片一致即可」 | YF101—YF113 一间不缺 |
 *
 * ## ★ 2026-10-22 晚：用户第二次看图之后改了六件事
 *
 * 这一版守的是**改过之后**的图。六条都来自用户对着照片的一句话，每一条都在下面
 * 有对应用例 —— 因为六条**都是「不报错的错」**：图照样合法、照样走得通，
 * 只是长得不像那栋楼。
 *
 * | 用户的话 | 改了什么 | 用例 |
 * |---|---|---|
 * | 「应该保留的是 YF101/301/601 左边那个楼梯间（地图上面），三层的楼梯间都改」 | 楼梯间从下排（y51）挪到**北排** x38 y25 11×18 | 「楼梯间与 6F / 3F 逐格相同」 |
 * | 「应该与 YF3/6 一致，一行走廊，而你画了『工』字形」 | 7 段走廊收成**一条直走廊**（3 段首尾相接） | ⚠️ **这一条晚上被用户推翻了**，见下面那一行 |
 * | 「左侧 109 相比 101/102 要凸出去一点」 | YF109 的东墙比 YF102 更靠东 | 「YF109 凸出去」 |
 * | 「YF1 所有房间都是空房间，不生成任何东西」 | 13 间全部 `fixed: 'empty'` | 「13 间全是空房」 |
 * | 「YF1 教室太大了，和 YF3/6 同位置教室规格应该差不多」 | 北排从 y0..42（43 格）收进 6F 的那条带 y25..42（18 格），宽度逐间照同位置的 6F / 3F 房间取 | 「同位置的教室规格与 6F / 3F 差不多」 |
 * | 「YF1 不要直的，和 YF3/6 构造差不多，两部分中间不是走廊，随便走」+「左半部分最右侧两个安全通道标识位置做门 / 右半部分最左侧一个」 | 一行直走廊换成**一张网**（两段主横廊 + 两条北侧竖段 + 中间一个大**厅** `C_HALL`），两块与大厅之间只有 **3 扇竖门**，就在照片上那三处安全出口 | 「走廊是一张网」「三处安全出口就是三扇门」「大厅是唯一的空地」 |
 *
 * 用户那句「一行走廊」当天晚上被他自己推翻了（「不要直的」）—— 所以那个用例
 * **没有留下来**，换成了「走廊是一张网」。要往回改的人先读 `_source.one_corridor`。
 *
 * 另外还有一件事不在这份图里：用户「进去后先是 YF1，然后可以从楼梯间上一层，
 * 进入 YF3」—— 它落在 `floors.json`（见 `floors.test.ts`），但**前提在这一份**：
 * 没有首领房的那一层要能上楼（`BattleScene.bossDown()`）。
 *
 * ## 下面这些用例守的是什么
 *
 * 几何本身（叠不叠、门开得对不对、走不走得到）`parseFloorPlan` 已经全核过了 ——
 * 它没抛就说明**结构**是合法的。这个文件守的是结构合法**但画错了**的那些：
 * 两块摆反、楼梯间挪了位、房号串了、包围盒变了、有人手一抖给某间房写上关别。
 *
 * ⚠️ 这些坏法**没有一条会报错**：两块摆反了是一张完全合法的图，只是西边那栋
 * 变成了东边那栋；包围盒变了要到换层时才炸 —— 而这一层现在**真的在一局里**
 * （`floors.json` 的第 1 层），所以那一次爆炸从「将来」变成了「开局」。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { ConfigError } from '@/core/config'
import { parseRoomsConfig, type RoomsConfig } from '../config'
import {
  FLOOR_PLAN_NAME,
  FLOOR_PLAN_YF1_NAME,
  FLOOR_PLAN_YF3_NAME,
  parseFloorPlan,
  type FloorPlan,
  type FloorPlanSpace,
} from './floorPlan'

const CONFIG_DIR = fileURLToPath(new URL('../../../../public/config/', import.meta.url))
const readJson = (name: string): unknown => JSON.parse(readFileSync(CONFIG_DIR + name, 'utf8'))

/** `rooms.json` 结构上就是一份 `FloorPlanMetrics`（多出来的字段不影响）。 */
const cfg: RoomsConfig = parseRoomsConfig(readJson('rooms.json'))

const yf1Raw = readJson(FLOOR_PLAN_YF1_NAME)
const yf1: FloorPlan = parseFloorPlan(yf1Raw, cfg)
const six: FloorPlan = parseFloorPlan(readJson(FLOOR_PLAN_NAME), cfg)
const yf3: FloorPlan = parseFloorPlan(readJson(FLOOR_PLAN_YF3_NAME), cfg)

/** 两块之间那条空档占的列（闭区间），见 `_source.the_gap`。 */
const GAP_X0 = 119
const GAP_X1 = 143

/** 主横廊那一行（`C_W` / `C_E` 开在这一行上；`C_J` / `C_EH` / `C_HALL` 都顶到它的上沿）。 */
const row = yf1.corridors.find((c) => c.id === 'C_W')!.cells
const ROW_Y0 = row.y
const ROW_Y1 = row.y + row.height

/** 全部空间（楼梯间 + 房间 + 走廊），顺序与校验器里那份一致。 */
const allSpaces: FloorPlanSpace[] = [yf1.stairwell, ...yf1.rooms, ...yf1.corridors]

const idOf = (s: FloorPlanSpace): string => s.id
const sortedIds = (xs: readonly FloorPlanSpace[]): string[] => xs.map(idOf).sort()

/** 房号（`YF101` → `101`）。排序与比较都用它，免得掺进字符串序。 */
// ⚠️ `slice(2)` 不是 `slice(3)`：前缀是 `YF` 两个字母，第三位**已经是房号的十位**。
//    `slice(3)` 会把 `YF101` 读成 1（"01"），于是整排房号变成 1..13 —— 数值序
//    照样是升的，蛇形那条**照样绿**，只是测的已经是别的东西了。
const numOf = (id: string): number => Number(id.slice(2))

/** 房是一条蛇：上排（走廊以北）与下排（走廊以南）。 */
const topRow = (): FloorPlanSpace[] => yf1.rooms.filter((r) => r.cells.y + r.cells.height <= ROW_Y0)
const bottomRow = (): FloorPlanSpace[] => yf1.rooms.filter((r) => r.cells.y >= ROW_Y1)

describe('真的那份 floor-plan-yf1.json', () => {
  it('过得了全部校验 —— 几何、门、连通性都在 parseFloorPlan 里（它没抛就是过了）', () => {
    expect(yf1.rooms).toHaveLength(13)
    // ★ 改了（2026-10-22）：7 → **3**（一行直走廊）→ ★ 晚·二：**5**（一张网）
    // → ★ 晚·六：**6**（多了北厅 `C_N`，给上面那扇 ↑ 门做北边）。
    // 这一层的走廊段数从来不是产品旋钮，但它一变就说明「构造」变了，所以钉在这里。
    expect(yf1.corridors).toHaveLength(6)
    // ★ 改了（2026-10-22 晚·二）：14 → **17**。房间那 14 扇没动，多出来的是
    // 大厅与两块之间那三扇（安全出口的位置，见 `_source.exit_doors`）。
    expect(yf1.doors).toHaveLength(17)
    expect(yf1.stairwell.id).toBe('STAIR')
    expect(yf1.roomTotal).toBe(14)
    expect(yf1.rooms.length + 1).toBe(yf1.roomTotal)
  })

  it('房号与照片逐间对应：YF101—YF113 一个不缺，也不掺别的前缀', () => {
    const ids = sortedIds(yf1.rooms)
    expect(ids).toEqual(Array.from({ length: 13 }, (_, i) => `YF1${String(i + 1).padStart(2, '0')}`))
    // 这一层是三份平面图里唯一一份房号从 01 起、且**没有**额外空间的
    //（6F 是 15 间 YF601—YF615，3F 是 13 间 + 一间 SHOP）。
    expect(ids.filter((id) => !id.startsWith('YF1'))).toEqual([])
  })

  it('楼梯间与 6F / 3F **逐格相同** —— 「三层的楼梯间都改」', () => {
    // 出生点是它，去下一层也是它。位置随照片走的话，等于每层换个出生点。
    // ★ 改了（2026-10-22）：坐标从下排的 x28 y51 11×22 换成**北排**的
    // x38 y25 11×18 —— 用户「应该保留的是 YF101/301/601 左边那个楼梯间（地图上面）」。
    // 三层逐格相同这条**没变**（上一版也相同，只是相同的是另一处楼梯间）。
    expect(yf1.stairwell.cells).toEqual(six.stairwell.cells)
    expect(yf1.stairwell.cells).toEqual(yf3.stairwell.cells)
    expect(yf1.stairwell.cells).toEqual({ x: 38, y: 25, width: 11, height: 18 })
    // 它必须**贴在北排**（和 YF101 同一带、在主横廊以北），不是下排 —— 这一条
    // 才是「上面那个楼梯间」这句话的可验形式：光比坐标的话，三层一起挪到下排
    // 也照样三个相等。
    expect(yf1.stairwell.cells.y + yf1.stairwell.cells.height).toBeLessThanOrEqual(ROW_Y0)
    // 且它旁边就是 YF101（中间隔着 1 格墙，见 `_doors_gotcha_comment`）。
    const yf101 = yf1.rooms.find((r) => r.id === 'YF101')!
    const gap = yf101.cells.x - (yf1.stairwell.cells.x + yf1.stairwell.cells.width)
    expect(gap, '楼梯间↔YF101 之间那格墙').toBe(1)
  })

  it('外框与 6F **逐格一样**，而且它是**声明**的、不是由房间推出来的', () => {
    // 物理世界边界、`TerrainMap` 的宽高、寻路网格的行列数都在 `CombatSession`
    // 构造时定死，之后改不了。★ 这一层现在**真的在第 1 层**（floors.json），
    // 所以外框不同的话炸的就是开局那一下 —— `BattleScene.applyArena()`。
    expect(yf1.bounds).toEqual(six.bounds)
    expect(yf1.cols).toBe(six.cols)
    expect(yf1.rows).toBe(six.rows)
    // ★ 新增（2026-10-22 晚）：外框现在是配置表里的 `footprint` 字段，**声明**的
    //（上一版是 `boundsOf` 把所有空间框起来推出来的）。1F 正是逼出这次改动的那一层：
    // 它**最北的一间房在 y25**（楼的最北一条带 y0..24 在这一层没有房间 —— 6F 在那里
    // 放的是中段首领房与东块北排），按房间推出来的外框会矮 25 格，而外框三层必须一样。
    const roomSpaces = [yf1.stairwell, ...yf1.rooms]
    const minRoomY = Math.min(...roomSpaces.map((s) => s.cells.y))
    expect(minRoomY, '1F 最北的一间**房**在 y25').toBe(25)
    expect(yf1.rows - minRoomY, '按房间推出来的话就只有这么高').toBe(48)
    // ★ 晚·六补一句：最北那条带现在**有一小块是走廊**（大厅的北端 `C_HALL` 与
    // `C_N`，y0 起）—— 于是「空间并集」今天恰好又等于外框了。**这不是理由**：
    // 靠哪一边撑住 y0（房间 / 走廊）是**内容**，而外框是**楼**。哪天一版把大厅
    // 收回去，推出来的外框又会矮 25 格 —— 所以这一条断言的是**房间**，不是并集。
    expect(Math.min(...allSpaces.map((s) => s.cells.y)), '走廊伸到了 y0').toBe(0)
    // 但同时外框**要装得下**每一个空间（越界由 `checkFootprint` 抛，见
    // floorPlan.test.ts），且与另外两层逐格相同 —— 三条一起才成立。
    for (const s of allSpaces) {
      expect(s.cells.x + s.cells.width, `${s.id} 出东界`).toBeLessThanOrEqual(yf1.cols)
      expect(s.cells.y + s.cells.height, `${s.id} 出南界`).toBeLessThanOrEqual(yf1.rows)
    }
  })

  it('★ 同位置的教室规格与 6F / 3F 差不多 —— 「YF1 教室太大了」', () => {
    // ★ 新增（2026-10-22 晚）：上一版的北排是 y0..42（43 格高），YF104 一间就有
    // 55×43 格 —— 比 6F 最大的教室（YF606，39×17）大出三倍，用户一眼就看出来了。
    //
    // ⚠️ 「太大了」**不该**由校验器管：一间 55×43 的房完全合法、走得通、门也开得对。
    //    「大」本身不是错，所以只有这里钉得住它。
    const at = (plan: FloorPlan, id: string): FloorPlanSpace =>
      [plan.stairwell, ...plan.rooms].find((s) => s.id === id)!

    // ① 上下两条带**就是 6F 的那两条** —— 它决定「厚不厚」。
    for (const r of yf1.rooms) {
      const band = topRow().includes(r) ? [25, 18] : [51, 22]
      expect([r.cells.y, r.cells.height], `${r.id} 不在 ${band.join(' / ')} 那条带上`).toEqual(band)
    }

    // ② 同位置的那几间**逐格相同**（房号不同，位置是同一处）。
    expect(at(yf1, 'YF101').cells).toEqual(at(six, 'YF602').cells) // 楼梯间东边第一间
    expect(at(yf1, 'YF102').cells).toEqual(at(six, 'YF603').cells)
    expect(at(yf1, 'YF113').cells).toEqual(at(six, 'YF615').cells) // 西块南排最西一间
    // 东块北排那两间：6F 把它们放在 y5..21 那条带上（东翼是另一套分带），而 1F
    // 只有一行走廊，东块北排也只能落在北排带上 —— 所以比的是 **x 与宽**（房宽是
    // 「规格」里更硬的那一半），高差 1 格。
    for (const [mine, theirs] of [
      ['YF103', 'YF605'],
      ['YF104', 'YF606'],
    ] as const) {
      expect(at(yf1, mine).cells.x, `${mine} 的 x`).toBe(at(six, theirs).cells.x)
      expect(at(yf1, mine).cells.width, `${mine} 的宽`).toBe(at(six, theirs).cells.width)
    }
    // 3F 也照这份走（`_edits_comment`：3F 与 6F 的差别只有 SHOP / C_W / 那两扇门）。
    expect(at(yf3, 'YF302').cells).toEqual(at(yf1, 'YF101').cells)
    expect(at(yf3, 'YF303').cells).toEqual(at(yf1, 'YF102').cells)

    // ③ 剩下那几间：宽度落在 6F 编号教室的区间里（今天 17..39）。
    const classroomWidths = six.rooms
      .filter((r) => r.fixed !== 'boss' && r.fixed !== 'reward')
      .map((r) => r.cells.width)
    const minW = Math.min(...classroomWidths)
    const maxW = Math.max(...classroomWidths)
    for (const r of yf1.rooms) {
      expect(r.cells.width, `${r.id} 比 6F 最宽的教室还宽`).toBeLessThanOrEqual(maxW)
      expect(r.cells.width, `${r.id} 比 6F 最窄的教室还窄`).toBeGreaterThanOrEqual(minW)
    }
    // ⚠️ 这条用例是照着上一版那间 55×43 的 YF104 写的：它**两条都过不了**
    //    （55 > 39；而 43 既不是 18 也不是 22）。别把上界放宽成「多宽都行」。
  })

  it('**两块确实分开了**：那条空档里只有大厅，没有别的东西', () => {
    // ⚠️ 「分开」不是靠眼睛看：两块要是挨上或叠上，`checkSpacesSeparated`
    //    会抛，但它抛的是「贴死了没有墙」—— 它管的是那 1 格墙，不管「两块之间
    //    该隔多远」。这一条钉的是**那个宽度**：空档 x119..143 里只许有大厅。
    // ★ 改了（2026-10-22 晚·二）：上一版这里是 `C_LINK`（一条 25 格的过道 +
    //    其余全是墙）。用户「两部分中间不是走廊，随便走」之后，过道换成了大厅，
    //    但「空档里只有它一个空间」这条**判据没变** —— 两块之间不许冒出第三样东西。
    const inGap = (s: FloorPlanSpace): boolean =>
      s.cells.x >= GAP_X0 && s.cells.x + s.cells.width <= GAP_X1 + 1
    expect(allSpaces.filter(inGap).map(idOf)).toEqual(['C_HALL'])
    // 大厅把整条空档占满（西边让出 x119、东边让出 x144 两列墙 —— 各 1 格宽）。
    const hall = yf1.corridors.find((c) => c.id === 'C_HALL')!.cells
    expect([hall.x, hall.x + hall.width]).toEqual([GAP_X0 + 1, GAP_X1 + 1])
    // 并且没有任何空间**跨**在空档上，除了大厅那两块（`C_HALL` 本体 + 它的北臂
    // `C_N`）—— 那是一个「厅」，不是两样东西。★ 晚·六：`C_N` 从 x110 起，
    // 它的东边界正好压在空档的西沿 `x119` 上，所以它也算「跨」的那一类。
    const overGap = (s: FloorPlanSpace): boolean =>
      s.cells.x <= GAP_X1 && s.cells.x + s.cells.width > GAP_X0
    expect(allSpaces.filter(overGap).map(idOf).sort()).toEqual(['C_HALL', 'C_N'])
  })

  it('房号是一条**蛇形** —— 上排由西向东升、下排由东向西降', () => {
    // ★ 这条是「长条那块在西、紧凑那块在东」的**唯一依据**，也是它唯一能被验的地方。
    //   反过来摆的话上排是 101 102 | 103 104（恰好也读得通），但下排会变成两块
    //   各自降序、整条蛇断掉 —— 而两张图各自看都完全合法，没有任何报错。
    const byX = (a: FloorPlanSpace, b: FloorPlanSpace): number => a.cells.x - b.cells.x
    const top = topRow().sort(byX).map(idOf)
    const bottom = bottomRow().sort(byX).map(idOf)
    expect(top).toEqual(['YF101', 'YF102', 'YF103', 'YF104'])
    expect(bottom.map(numOf)).toEqual([...bottom.map(numOf)].sort((a, b) => b - a))
    expect(bottom).toHaveLength(9)
    // 两排合起来正好是 101—113，一个不多一个不少 —— 蛇形是**覆盖全层**的一条路。
    expect([...top, ...bottom].map(numOf).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 13 }, (_, i) => i + 101),
    )
    // ⚠️ ★ 改了（2026-10-22）：上一条筛选条件是「y 等于楼梯间的 y」—— 那时楼梯间
    // 在下排，正好当基准。现在楼梯间搬到了上排，那个条件会**恒假**（`bottom` 变成
    // 空数组，于是「9 间」那条红）。换成按**走廊那一行**切：上排 = 走廊以北、
    // 下排 = 走廊以南。基准从「楼梯间在哪儿」换成「走廊在哪儿」—— 走廊是这一层
    // 唯一不会跟着楼梯间跑的参照物。
  })

  it('★ 走廊是一张**网**、不是一行直的 —— 「YF1 不要直的，和 YF3/6 构造差不多」', () => {
    // ★ 新增（2026-10-22 晚·二）：白天那版是「一行直的」（C_W / C_LINK / C_E
    // 三段首尾相接，一条 x0..x262 的线），用户晚上推翻了它。6F 的走廊是 6 段拼的
    // 网：两条主横廊 + 两条竖段 + 中段一个 40×17 的厅。这一条钉的就是那个「网」。
    // ⚠️ **不**由 `parseFloorPlan` 守：走廊各摆各的也完全合法（连通性由
    //    `connectsTo` 给），只是长得不像那栋楼 —— 而那正是用户两次挑出来的毛病。
    expect(yf1.corridors.map((c) => c.id).sort()).toEqual([
      'C_E',
      'C_EH',
      'C_HALL',
      'C_J',
      'C_N',
      'C_W',
    ])

    // ① 两块各有一条主横廊，而且仍开在 6F 那一行上（房间带才不会跟着挪）。
    for (const id of ['C_W', 'C_E']) {
      const c = yf1.corridors.find((x) => x.id === id)!
      expect([c.cells.y, c.cells.height], `${id} 不在主横廊那一行上`).toEqual([ROW_Y0, row.height])
    }
    // ② 两块各有一条**挂在主横廊北边的支**（整段都在走廊那一行以北、且比走廊高），
    //    并与自己的主横廊直接相接 —— 这就是「不是一行直的」那句话的可验形式。
    //    ⚠️ 不要求「竖长」：西块那条 `C_J` 是 9×19 的竖段，东块那条 `C_EH` 是
    //    19×19 的**厅**（照片 1 里那个带「您的位置」的大厅）。形状可以不同，
    //    「挂在走廊北边、通向它」这件事必须一样。
    for (const [leg, main] of [
      ['C_J', 'C_W'],
      ['C_EH', 'C_E'],
    ] as const) {
      const c = yf1.corridors.find((x) => x.id === leg)!
      expect(c.cells.y + c.cells.height, `${leg} 没顶到主横廊`).toBe(ROW_Y0)
      expect(c.cells.height, `${leg} 不比主横廊高`).toBeGreaterThan(row.height)
      // 相接处不隔墙（走廊↔走廊是 `_gap_comment` 里那个唯一例外），所以两段
      // 必须**互认** —— 光坐标接上而 `connectsTo` 没写，连通性校验会抛。
      expect([...c.connectsTo], `${leg} 没接上 ${main}`).toContain(main)
      expect([...yf1.corridors.find((x) => x.id === main)!.connectsTo]).toContain(leg)
    }
    // 而且西块那条支确实是**竖**的（高 > 宽）—— 「网」里至少要有一段不是横的。
    const cj = yf1.corridors.find((c) => c.id === 'C_J')!
    expect(cj.cells.height).toBeGreaterThan(cj.cells.width)
    // ③ 走廊**不只活在 y44..49 那一行**：北排里也有走廊（否则又变回一行直的）。
    expect(yf1.corridors.filter((c) => c.cells.y < ROW_Y0).map((c) => c.id).sort()).toEqual([
      'C_EH',
      'C_HALL',
      'C_J',
      'C_N',
    ])
    // ④ 大厅与它的北臂 `C_N` 是**同一个厅**：两者直接相接（走廊↔走廊，不隔墙）。
    expect([...yf1.corridors.find((c) => c.id === 'C_HALL')!.connectsTo]).toEqual(['C_N'])
    expect([...yf1.corridors.find((c) => c.id === 'C_N')!.connectsTo]).toEqual(['C_HALL'])
    // ⑤ 两条主横廊仍然各铺满自己那一块的整宽（西块 0..118、东块 145..262）。
    const main = (id: string): FloorPlanSpace => yf1.corridors.find((c) => c.id === id)!
    expect(main('C_W').cells.x).toBe(0)
    expect(main('C_E').cells.x + main('C_E').cells.width).toBe(yf1.cols)
  })

  it('★ 三处**安全出口**的位置就是那三扇门，且上面那扇**朝上下** —— 「左边部分的右边的上面那个门的朝向是上下的，不是左右」', () => {
    // ★ 新增（2026-10-22 晚·二）：用户点名要在照片上那三处绿色安全出口的位置开门。
    // 照片上是三处：西块（照片 2）东端上/下各一处、东块（照片 1）西墙上一处。
    //
    // ★ 改了（2026-10-22 晚·六，用户指正）：**上面那扇是朝上下的**（↑ 那个箭头 =
    // 人往**北**走），所以它开在横墙（`y24`）上、是 3×1 的横门；上一版把它也画成了
    // 穿过竖墙的 1×3，方向就错了。为此北排多了一段 `C_N` 当它的北边。
    //
    // ⚠️ 门开错方向/位置时**两边都不报错**：换个方向照样合法、照样连通，
    //    只是玩家得绕另外半层楼 —— 屏幕上只是「怎么这么远」。
    const at = (x: number, y: number) => yf1.doors.find((d) => d.cells.x === x && d.cells.y === y)
    for (const [x, y, w, h, axis, pair, what] of [
      [113, 24, 3, 1, 'h', ['C_J', 'C_N'], '西块上面那扇（↑ = 往北走，横门）'],
      [119, 45, 1, 3, 'v', ['C_HALL', 'C_W'], '西块下面那扇（→ = 往东走，竖门）'],
      [144, 45, 1, 3, 'v', ['C_E', 'C_HALL'], '东块那扇（← = 往西走，竖门）'],
    ] as const) {
      const d = at(x, y)
      expect(d, `${what}：x${x} y${y} 上没有门`).toBeDefined()
      expect([d!.cells.width, d!.cells.height], `${what}：${w}×${h}`).toEqual([w, h])
      // ⚠️ `axis` 是「人沿哪个轴穿过」：`h` = 门开在**横**墙上、人沿 y 走（上下）。
      //    上面那扇正是这一档 —— 它要是 `v`，就说明这扇门又被画成左右的了。
      expect(d!.axis, `${what}：axis 不是 ${axis}`).toBe(axis)
      expect([d!.a, d!.b].sort(), `${what}：两端`).toEqual([...pair].sort())
    }
    // 大厅（含它的北臂 `C_N`）与两块之间**只有**这三条路，没有第四扇门。
    const hallComplex = ['C_HALL', 'C_N']
    expect(yf1.doors.filter((d) => [d.a, d.b].some((id) => hallComplex.includes(id)))).toHaveLength(3)
    // 而且这三扇**一头房间都没有** —— 它们是走廊↔走廊，清房不会关它们
    // （`layout.ts` 只把门挂到房间那一侧）。少了这条，大厅哪天被挂上一间房，
    // 「永远通」这件事就悄悄变成「打完才通」。
    for (const d of yf1.doors.filter((x) => [x.a, x.b].some((id) => hallComplex.includes(id)))) {
      expect([d.a, d.b].some((id) => id === 'STAIR' || id.startsWith('YF1'))).toBe(false)
    }
  })

  it('★ YF109 **凸出去** —— 「左侧 109 相比 101/102 要凸出去一点」', () => {
    // 照片上：上排东端那一片（YF102 以东到 x118）是配电室 / 楼梯间 / 电梯间
    // （省略成墙），而下排一直铺到 x118。所以 109 的东墙比 102 的东墙更靠东。
    // ★ 改了（2026-10-22 晚）：尺寸重画之后差 24 格（109 的 x118 对 102 的 x94）。
    // ⚠️ 上一版把 YF101 拉宽到顶住 x118，凸出就没了 —— 而「没凸出去」是一张
    //    完全合法的图，没有任何校验器会说话。
    const at = (id: string): FloorPlanSpace => yf1.rooms.find((r) => r.id === id)!
    const east = (s: FloorPlanSpace): number => s.cells.x + s.cells.width
    expect(east(at('YF109'))).toBeGreaterThan(east(at('YF102')))
    // 「相比 101/102」—— 两个都要比，不能只比窄的那个。
    expect(east(at('YF109'))).toBeGreaterThan(east(at('YF101')))
    // 但只许**凸出一点**：西块上排那一带是省略掉的电梯间 / 楼梯间 / 配电室
    // （变墙），109 要是顶到过道（x119）就没地方放它们了。
    expect(east(at('YF109'))).toBeLessThanOrEqual(GAP_X0)
  })

  it('每间房恰好一扇门，楼梯间也恰好一扇', () => {
    const count = new Map<string, number>()
    for (const d of yf1.doors) for (const id of [d.a, d.b]) count.set(id, (count.get(id) ?? 0) + 1)
    for (const r of [...yf1.rooms, yf1.stairwell]) {
      expect(count.get(r.id) ?? 0, `${r.id} 的门数`).toBe(1)
    }
    // 走廊不在此列：一条走廊接好几间房是常态（C_W 就接了 8 间：北排 3 + 南排 5）。
    expect(yf1.doors.every((d) => [d.a, d.b].some((id) => id.startsWith('C_')))).toBe(true)
  })

  it('★ 房间那 14 扇门：上排 5 扇开在**北墙那一行**（y43），下排 9 扇在 y50', () => {
    // 房间都开在走廊上下那两格墙上：y43（走廊 y44 上面那一格）与 y50。
    // ⚠️ 门开在哪一行**不影响任何校验**：只要它还落在那两个空间之间的墙上、
    //    位置大致对，`checkDoors` 就过。开错行的话上排每间房都要绕半层楼，
    //    而屏幕上只是「怎么这么远」。
    // ★ 改了（2026-10-22 晚·二）：**只看房间的门**。大厅那三扇竖门在 x119 / x144
    //    那一列上、y 分别是 30 与 45，拿它们去套「y < ROW_Y0 就是上排」会当场红。
    const isRoomDoor = (d: (typeof yf1.doors)[number]): boolean =>
      [d.a, d.b].some((id) => id === 'STAIR' || id.startsWith('YF1'))
    const north = yf1.doors.filter((d) => isRoomDoor(d) && d.cells.y < ROW_Y0).map((d) => d.b).sort()
    expect(north).toEqual(['STAIR', 'YF101', 'YF102', 'YF103', 'YF104'].sort())
    for (const d of yf1.doors.filter((x) => isRoomDoor(x) && x.cells.y < ROW_Y0)) {
      expect(d.cells.y, `${d.b} 的门不在北墙那一行上`).toBe(ROW_Y0 - 1)
    }
    // 下排 9 扇照旧在走廊下面那一格墙（y50）上。
    const south = yf1.doors.filter((d) => isRoomDoor(d) && d.cells.y >= ROW_Y1).map((d) => d.b).sort()
    expect(south).toEqual(
      ['YF105', 'YF106', 'YF107', 'YF108', 'YF109', 'YF110', 'YF111', 'YF112', 'YF113'].sort(),
    )
    for (const d of yf1.doors.filter((x) => isRoomDoor(x) && x.cells.y >= ROW_Y1)) {
      expect(d.cells.y, `${d.b} 的门不在南墙那一行上`).toBe(ROW_Y1)
    }
  })

  it("★ 13 间全是**空房**（fixed = 'empty'）—— 用户「所有房间都是空房间，不生成任何东西」", () => {
    // ★ 改了（2026-10-22）：上一版是**一间 fixed 都不写**（= 全部进发牌池，
    // 按 `roomKindWeights` 抽成普通战 / 精英 / 道具关 / 宝箱关，抽到战斗关的
    // 还摆桌椅、刷怪）。用户要的是字面意义的空房间，所以逐间钉 `empty`。
    expect(yf1.rooms.filter((r) => r.fixed !== 'empty')).toEqual([])
    // `empty` 是**平面图钉得出来、发牌池抽不到**的关别（与 `shop` 同一类）：
    // 它在 `ROOM_KINDS` 里、不在 `ROOM_KINDS_EMITTED` 里，写进
    // `rooms.json` 的 `roomKindWeights` 会在加载配置时被拒。
    expect(yf1.rooms.every((r) => r.fixed === 'empty')).toBe(true)
  })

  it('★ 因此这一层**没有首领房** —— 而它现在真的排在一局里，所以门槛必须不生效', () => {
    // ⚠️ 上一版这条是个**提醒**：「要把它排进 floors.json，必须先在这里钉一间
    //    `fixed: 'boss'`，否则那一层打完没有出口」。用户后来给的方案不是补一间
    //    假首领，而是**改门槛**：第 1 层是过渡层，进来就能上楼 —— 见
    //    `BattleScene.bossDown()`（找不到首领房 = 当作已打倒）。
    //    校验器那一侧跟着从「恰好 1 间」放宽成「至多 1 间」（`validate/contract.ts`）。
    expect(yf1.rooms.filter((r) => r.fixed === 'boss')).toEqual([])
    // 对照：另外两层的首领照旧各一间 —— 上界没被顺手放宽掉。
    expect(six.rooms.filter((r) => r.fixed === 'boss').map(idOf)).toEqual(['YF604'])
    expect(yf3.rooms.filter((r) => r.fixed === 'boss').map(idOf)).toEqual(['YF304'])
  })

  it('把 `roomTotal` 改坏 → 当场抛（它是这一层自己的字段，别处没有第二份可对）', () => {
    const broken = { ...(yf1Raw as Record<string, unknown>), roomTotal: 13 }
    expect(() => parseFloorPlan(broken, cfg)).toThrow(ConfigError)
    expect(() => parseFloorPlan(broken, cfg)).toThrow(/楼梯间/)
  })
})