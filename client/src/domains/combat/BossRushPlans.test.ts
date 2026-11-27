/**
 * BOSSRUSH 的两张专用图：首领房一张、商店一张。
 *
 * 它们不在 `floors.json` 里（不参与常规闯关抽取），所以 `floors.test.ts`
 * 不会顺带覆盖到；这里单独把「解析 → 生成 → 契约 → 可达」走一遍。
 * 更重要的是钉住用户的 2026-11-28 反馈：首领房宽度与闯关模式的 8F 首领房一致，
 * 但**竖向拉长成正方形**；而且商店图里不能再出现首领房。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseRoomsConfig } from '@/domains/procgen/config'
import {
  FLOOR_PLAN_BOSSRUSH_BOSS_NAME,
  FLOOR_PLAN_BOSSRUSH_SHOP_NAME,
  FLOOR_PLAN_YF8_NAME,
  parseFloorPlan,
} from '@/domains/procgen/gen/floorPlan'
import { generateDungeon } from '@/domains/procgen/gen/generate'
import { validateContract } from '@/domains/procgen/validate/contract'
import { assertReachable } from '@/domains/procgen/validate/reachability'

const CONFIG_DIR = fileURLToPath(new URL('../../../public/config/', import.meta.url))
const readJson = (name: string): unknown =>
  JSON.parse(readFileSync(CONFIG_DIR + name, 'utf8')) as unknown
const rooms = parseRoomsConfig(readJson('rooms.json'))

const bossPlan = parseFloorPlan(readJson(FLOOR_PLAN_BOSSRUSH_BOSS_NAME), rooms)
const shopPlan = parseFloorPlan(readJson(FLOOR_PLAN_BOSSRUSH_SHOP_NAME), rooms)
const campaignFinale = parseFloorPlan(readJson(FLOOR_PLAN_YF8_NAME), rooms)

describe('BOSSRUSH 首领房平面图', () => {
  it('只有一间首领房；宽度与 8F 首领房相同，高度拉成正方形', () => {
    const bosses = bossPlan.rooms.filter((room) => room.fixed === 'boss')
    expect(bosses).toHaveLength(1)
    const campaignBoss = campaignFinale.rooms.find((room) => room.fixed === 'boss')!
    expect(bosses[0]!.cells.width).toBe(campaignBoss.cells.width)
    // 用户 2026-11-28：横向够了，竖向拉长成正方形 → 47×47 格 = 1880×1880px
    expect(bosses[0]!.cells.height).toBe(bosses[0]!.cells.width)
    expect(bosses[0]!.cells.width).toBe(47)
    expect(bossPlan.rooms.some((room) => room.fixed === 'shop')).toBe(false)
  })

  it('外框与常规层一致（换图不改物理世界大小）', () => {
    expect(bossPlan.bounds.width).toBe(7600)
    expect(bossPlan.bounds.height).toBe(2400)
    expect(shopPlan.bounds.width).toBe(7600)
    expect(shopPlan.bounds.height).toBe(2400)
  })
})

describe('BOSSRUSH 商店平面图', () => {
  it('只有一间商店，没有首领房', () => {
    const shops = shopPlan.rooms.filter((room) => room.fixed === 'shop')
    expect(shops).toHaveLength(1)
    expect(shops[0]!.cells.width).toBeGreaterThanOrEqual(40)
    expect(shopPlan.rooms.some((room) => room.fixed === 'boss')).toBe(false)
  })
})

describe('BOSSRUSH 两张图都能生成、过契约、可达', () => {
  for (const [name, plan] of [
    ['首领图', bossPlan],
    ['商店图', shopPlan],
  ] as const) {
    it(`${name}：20 个种子逐项校验`, () => {
      for (let seed = 1; seed <= 20; seed++) {
        const map = generateDungeon(seed, rooms, plan)
        expect(map.rooms).toHaveLength(plan.roomTotal)
        expect(() => validateContract(map, rooms, plan.roomTotal), `${name} seed ${seed}`).not.toThrow()
        expect(() => assertReachable(map, rooms), `${name} seed ${seed}`).not.toThrow()
      }
    })
  }
})
