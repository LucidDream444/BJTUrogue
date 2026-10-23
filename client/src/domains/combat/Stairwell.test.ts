/**
 * `Stairwell.ts` 的自动化验收 —— **上下两个入口摆在哪儿**，以及
 * **回上一层之后那一层还记得什么**。跑在 node 环境：不加载 Phaser、不碰 DOM。
 *
 * 用户 2026-10-21 的原话是这三句：
 *
 * > 进入楼梯间会生成一个宝箱，这不对 ·
 * > 楼梯间不算起点，应该是每层之间的中转站，打完该层首领后去下一层的路应该出现在
 * > 楼梯间里，而不是楼梯间门口 · 如果有上一层，在楼梯间里可以回去
 *
 * 中间那句与最后那句在这里被钉住。第一句（不摆宝箱）是关别的判据，
 * 钉在 `procgen/config.ts` 的 `roomHasChest()` 上。
 *
 * 这一份挡的是三类**不报错、只看画面**才发现的错：
 *
 * 1. **两个方框叠在一起** —— 站在楼梯间正中按一下 `F`，上下楼谁都说不清；
 *    而「够得着」是按到方框边缘的距离量的（`FloorExit.near()`），
 *    两个框只要挨得够近，一次按键**同时**满足两条判据，走哪条看代码顺序
 * 2. **方框摆到墙外** —— 玩家够不着，而画面上那个框照样在呼吸（它在墙的另一侧）
 * 3. **快照存了引用** —— 重开一局时 `init()` 里的 `clear()`（原地改）会把
 *    上一局的记忆一起抹掉；只在**第二局**才表现出来，而第一局永远是对的
 *
 * 配置读真文件、判据用真数：与 `DungeonStages.test.ts` 同一个手法、同一个理由
 * （失败要能复跑）。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { parseRoomsConfig, type RoomsConfig } from '@/domains/procgen/config'
import { parseFloorPlan, type FloorPlan } from '@/domains/procgen/gen/floorPlan'
import { containsPoint } from '@/domains/procgen/model/rect'
import {
  FloorProgress,
  STAIR_PAD_OFFSET,
  padsFitInside,
  stairPadSpots,
  type FloorSnapshot,
} from './Stairwell'

const CONFIG_DIR = fileURLToPath(new URL('../../../public/config/', import.meta.url))
const readJson = (name: string): unknown => JSON.parse(readFileSync(CONFIG_DIR + name, 'utf8'))

const cfg: RoomsConfig = parseRoomsConfig(readJson('rooms.json'))
const plan: FloorPlan = parseFloorPlan(readJson('floor-plan.json'), cfg)

/**
 * `FloorExit.SIZE` —— 那个方框的边长。**必须是同一个数**。
 *
 * 它在 `FloorExit.ts` 里，而那个文件第一行就是 `import Phaser`（node 里 import 不进来），
 * 所以只能读源码对账 —— 与 `DungeonStages.test.ts` 里 `ENEMY_CLEARANCE` 那条同一个手法。
 * 读不到时**当场炸**（不是跳过）：正则漂了的话，下面几条断言会拿一个 0 去量，
 * 那它们就全成了永远绿的用例。
 */
const FLOOR_EXIT_SIZE = ((): number => {
  const src = readFileSync(fileURLToPath(new URL('./FloorExit.ts', import.meta.url)), 'utf8')
  const m = /static readonly SIZE = (\d+)/.exec(src)
  if (m === null)
    throw new Error(
      'FloorExit.ts 里读不到 `static readonly SIZE = <数>` —— 这份测试量不了方框的宽窄了',
    )
  return Number(m[1])
})()

/** 「够得着」的门槛（世界像素）。与 `BattleScene.EXIT_REACH` 同步，同上一段的理由。 */
const EXIT_REACH = ((): number => {
  const src = readFileSync(fileURLToPath(new URL('./BattleScene.ts', import.meta.url)), 'utf8')
  const m = /const EXIT_REACH = (\d+)/.exec(src)
  if (m === null) throw new Error('BattleScene.ts 里读不到 `const EXIT_REACH = <数>`')
  return Number(m[1])
})()

describe('楼梯间的两个入口摆在哪儿（2026-10-21：上下楼都在楼梯间里）', () => {
  const stairwell = plan.stairwell.rect
  const pads = stairPadSpots(stairwell, FLOOR_EXIT_SIZE)

  it('平面图上这一间是竖长的 —— 两个入口就是靠它分开的', () => {
    // `stairPadSpots()` 竖着分（沿 y 轴）：「上下」两个字本来就是竖的。
    // 哪一天平面图把它改成一间横长的房子，这条会红 —— 那时该改的是摆法，不是这条断言。
    expect(
      stairwell.height,
      `楼梯间 ${JSON.stringify(stairwell)} 不再是竖长的了：两个入口竖着分就分不开`,
    ).toBeGreaterThan(stairwell.width)
  })

  it('**上一层在上面、下一层在下面**，而且两个方框离得开', () => {
    expect(pads.up.y, '上一层那个入口跑到中心下面去了 —— 画面上会和「下一层」反过来').toBeLessThan(
      pads.down.y,
    )
    expect(pads.up.x).toBe(stairwell.x)
    expect(pads.down.x).toBe(stairwell.x)
    const gap = pads.down.y - pads.up.y
    expect(
      gap,
      `两个方框只隔 ${gap}px，比一个方框（${FLOOR_EXIT_SIZE}）还近 —— 它们会盖在一起`,
    ).toBeGreaterThanOrEqual(FLOOR_EXIT_SIZE)
    // ⚠️ **这一条才是「不会一次按键上下楼都成立」**：够得着量的是到方框**边缘**的距离
    //    （`FloorExit.near()`），站在正中间时离两边各 gap/2 − 半个方框 —— 它必须大于门槛。
    const fromMiddle = gap / 2 - FLOOR_EXIT_SIZE / 2
    expect(
      fromMiddle,
      `站在两个入口正中间时离两边都只有 ${fromMiddle}px，而够得着的门槛是 ${EXIT_REACH}px —— ` +
        `按一下 F 会同时够到上楼和下楼两条判据，走哪条看代码顺序`,
    ).toBeGreaterThan(EXIT_REACH)
  })

  it('**两个方框都整个落在楼梯间里** —— 摆到墙外的入口玩家够不着', () => {
    expect(
      padsFitInside(stairwell, pads, FLOOR_EXIT_SIZE),
      `入口出墙了：楼梯间 ${JSON.stringify(stairwell)}、两个入口 ${JSON.stringify(pads)}（方框边长 ${FLOOR_EXIT_SIZE}）`,
    ).toBe(true)
    // 半个方框 + 偏移，就是它离中心最远的那条边 —— 顺着 room 的半高看，余量应该还不少。
    expect(stairwell.height / 2).toBeGreaterThan(STAIR_PAD_OFFSET + FLOOR_EXIT_SIZE / 2)
  })

  it('**偏移量的钳制**：方框往外挪、挪到房间放不下为止，绝不出去', () => {
    // 真平面图那一间是够大的（最上面那条已经量过），这里量的是**兜底**。
    // 一间恰好放得下两个方框的房子：往两头挪满，整个框仍贴着上下两条边、在房里。
    const snug = { x: 300, y: 300, width: FLOOR_EXIT_SIZE, height: FLOOR_EXIT_SIZE * 2 }
    const snugPads = stairPadSpots(snug, FLOOR_EXIT_SIZE)
    expect(snugPads.up.y, '贴边的这一间里，上一层那个入口应该确实往上挪了').toBeLessThan(snug.y)
    expect(
      padsFitInside(snug, snugPads, FLOOR_EXIT_SIZE),
      `贴边的这一间摆出墙了：${JSON.stringify(snugPads)}`,
    ).toBe(true)
    // 再小下去 —— 连一个方框都放不下 —— 两个点退回中心，**不是**跑到墙外去。
    const tiny = { x: 100, y: 100, width: 60, height: 60 }
    const spots = stairPadSpots(tiny, FLOOR_EXIT_SIZE)
    expect(spots.up).toEqual({ x: tiny.x, y: tiny.y })
    expect(spots.down).toEqual({ x: tiny.x, y: tiny.y })
    expect(containsPoint(tiny, spots.up.x, spots.up.y)).toBe(true)
  })
})

describe('每层各记各的进度（回上一层不重刷怪、不重发宝箱）', () => {
  const snapshot = (
    visited: number[],
    cleared: number[],
    lootedRooms: number[],
  ): FloorSnapshot => ({
    visited: new Set(visited),
    cleared: new Set(cleared),
    lootedRooms: new Set(lootedRooms),
  })

  it('没去过的那一层给 `null`（= 全新的一层）', () => {
    const p = new FloorProgress()
    expect(p.restore(1)).toBeNull()
    expect(p.restore(2)).toBeNull()
    expect(p.remembered()).toEqual([])
  })

  it('存一层、取一层，取回来的和存进去的一样', () => {
    const p = new FloorProgress()
    p.save(1, snapshot([0, 1, 4], [4], [1]))
    const back = p.restore(1)!
    expect([...back.visited].sort()).toEqual([0, 1, 4])
    expect([...back.cleared]).toEqual([4])
    expect([...back.lootedRooms]).toEqual([1])
    // 每层各记各的：第 2 层没存过，仍然是 null。
    expect(p.restore(2)).toBeNull()
    expect(p.remembered()).toEqual([1])
  })

  it('**存的是副本**：调用方之后原地 `clear()` 不会把快照抹掉', () => {
    // 这一条钉的是 `BattleScene.init()`：它对 `this.visited` 调的是 `clear()`
    // （原地改，不是换一个集合）。存引用的话，重开一局会把上一局的记忆一起清掉 ——
    // 而那只在**第二局**才表现出来。
    const p = new FloorProgress()
    const live = snapshot([0, 2], [2], [])
    p.save(1, live)
    ;(live.visited as Set<number>).clear()
    ;(live.cleared as Set<number>).clear()
    expect([...p.restore(1)!.visited].sort()).toEqual([0, 2])
    expect([...p.restore(1)!.cleared]).toEqual([2])
  })

  it('**取的也是副本**：改坏了第一次取回来的那份，不影响存着的', () => {
    const p = new FloorProgress()
    p.save(1, snapshot([3], [3], []))
    const first = p.restore(1)!
    ;(first.cleared as Set<number>).clear()
    expect([...p.restore(1)!.cleared]).toEqual([3])
  })

  it('重开一局 `forget()` 之后，一切都回到「没去过」', () => {
    const p = new FloorProgress()
    p.save(1, snapshot([0], [0], []))
    p.save(2, snapshot([0, 1], [0], []))
    expect(p.remembered()).toEqual([1, 2])
    p.forget()
    expect(p.remembered()).toEqual([])
    expect(p.restore(1)).toBeNull()
  })

  it('两层可以同时记着 —— 上楼、下楼来回走都对得上', () => {
    const p = new FloorProgress()
    p.save(1, snapshot([0, 4], [4], [1]))
    p.save(2, snapshot([0, 6], [6], [0]))
    expect([...p.restore(1)!.cleared]).toEqual([4])
    expect([...p.restore(2)!.cleared]).toEqual([6])
    expect([...p.restore(2)!.lootedRooms]).toEqual([0])
  })
})