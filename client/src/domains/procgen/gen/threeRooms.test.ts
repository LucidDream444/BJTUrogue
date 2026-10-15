/**
 * **三间小图** —— 三间那一档测试场（今天跑的是 `joint/d1d2_rooms`）依赖的那几条，
 * 在这里钉住。（先前跑它的是 `d2_three_rooms`，2026-10-15 退役。）
 *
 * 为什么值得单开一份：那一场要的是「整层三间、三间都能打」，
 * 而这两件事**都不是生成器保证过的**：
 *
 * | 以为的保证 | 实际 |
 * |---|---|
 * | 「三间」 | 要靠 `roomsConfigWithRoomCount` 把三个数一起改对，写歪一个就变成 15 间或 12 间侧室 |
 * | 「三间都能打」 | 关别是位置推出来的（起点 / 普通 / 首领，都是战斗关别），但**刷怪点是生成器挑的**：小图上挑不出格子就静默给空数组 |
 *
 * 后一条尤其要紧：一间的刷怪点为空的后果不是报错，是**那一间进门就放行** ——
 * 在现场看起来像「门的判定写坏了」，而查门的判定永远查不出来。
 * 所以这里**按种子批量扫**，不是只看随手挑的那一颗。
 *
 * 配置**读真文件**（`public/config/rooms.json`），理由同 `generate.test.ts`：
 * 另捏一份的话，真配置可以错得离谱而这里全绿。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { generateDungeon } from './generate'
import { roomsConfigWithRoomCount, type RoomsConfig } from '../config'
import { isCombatKind } from '../config'
import { roomNeedsFight } from '../roomFlow'
import { validateContract } from '../validate/contract'
import { assertReachable } from '../validate/reachability'
import { ROOM_KIND_LABELS, mainRooms } from '../model/types'

const CONFIG_DIR = fileURLToPath(new URL('../../../../public/config/', import.meta.url))

/** 与 `generate.test.ts` 同一套种子：**写死**，失败要能复跑。 */
const SEEDS = Array.from({ length: 500 }, (_, i) => i * 7919 + 13)

/** 这一场要的三间。真配置 + 真校验器，只改房间数那三个字段。 */
const cfg: RoomsConfig = roomsConfigWithRoomCount(
  { get: () => JSON.parse(readFileSync(CONFIG_DIR + 'rooms.json', 'utf8')) },
  3,
)

describe('D2 三间小图（三间那一档测试场依赖的）', () => {
  it('就是三间，且三间都在主干上（侧室 0 间）', () => {
    for (const seed of SEEDS.slice(0, 200)) {
      const map = generateDungeon(seed, cfg)
      expect(map.rooms.length, `种子 ${seed}`).toBe(3)
      expect(mainRooms(map).length, `种子 ${seed}`).toBe(3)
    }
  })

  it('关别是位置推出来的那三个：起点 / 普通战 / 首领', () => {
    for (const seed of SEEDS.slice(0, 200)) {
      const map = generateDungeon(seed, cfg)
      expect(map.rooms.map((r) => r.kind), `种子 ${seed}`).toEqual(['start', 'main', 'boss'])
    }
  })

  it('三间**都打得起来** —— 500 个种子逐间查刷怪点', () => {
    const empty: string[] = []
    let rooms = 0
    for (const seed of SEEDS) {
      const map = generateDungeon(seed, cfg)
      for (const room of map.rooms) {
        rooms++
        expect(isCombatKind(cfg, room.kind), `种子 ${seed} #${room.order}`).toBe(true)
        if (!roomNeedsFight(room, cfg)) empty.push(`种子 ${seed} #${room.order} ${ROOM_KIND_LABELS[room.kind]}`)
      }
    }
    // 一条都不能有：空房 = 这一间进门就放行，看起来像门判定坏了。
    expect(empty.slice(0, 10)).toEqual([])
    expect(rooms).toBe(1500) // 反向证据：扫过的房间数对得上，不是空转
  })

  it('三间都摆得出家具 —— 空教室看不出「桌椅挡不挡路」', () => {
    const bare: string[] = []
    let withDesk = 0
    let total = 0
    for (const seed of SEEDS) {
      const map = generateDungeon(seed, cfg)
      for (const room of map.rooms) {
        total++
        if (room.obstacles.some((o) => o.kind === 'desk')) withDesk++
        else bare.push(`种子 ${seed} #${room.order} ${room.rect.width}×${room.rect.height}`)
      }
    }
    // ★ 桌椅改版（schemaVersion 4）之后这里是 **100%**，所以钉成"一间空的都不许有"。
    //   改版前 400 宽那一档的普通战教室约 45% 摆不下一张桌（桌椅从左上角一格一格试，
    //   "跳过一张就步进一格"会走不到那个恰好放得下的位置）；现在排布是**先算出
    //   几排几张、再整块居中**，位置不再依赖步进顺序。三间小图的三间都是主干档，
    //   而主干三档在 1000 个种子下一间都不空（实测见 `generate.test.ts` 里那条的 `[读]`）。
    console.log(
      `[读] 三间小图 ${total} 间：有桌椅 ${withDesk} 间（${((withDesk / total) * 100).toFixed(1)}%），没桌椅的样例 ${bare.slice(0, 5).join(' / ') || '（一间都没有）'}`,
    )
    expect(bare.slice(0, 10)).toEqual([])
  })

  it('三间小图照样过契约校验与可达性（改的是房间数，几何不是另一套）', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const map = generateDungeon(seed, cfg)
      expect(() => validateContract(map, cfg), `种子 ${seed}`).not.toThrow()
      expect(() => assertReachable(map, cfg), `种子 ${seed}`).not.toThrow()
    }
  })

  it('房间数不合法时**当场抛**，报的还是配置校验器那一句（没被绕过）', () => {
    const cache = { get: () => JSON.parse(readFileSync(CONFIG_DIR + 'rooms.json', 'utf8')) }
    // 报错里认得出是**哪个字段**不对，就证明 `parseRoomsConfig` 真的跑了 ——
    // 展开已解析对象的那种写法会静默通过（见 `roomsConfigWithRoomCount` 的 ⚠️）。
    expect(() => roomsConfigWithRoomCount(cache, 1)).toThrow(/totalRooms/)
  })
})