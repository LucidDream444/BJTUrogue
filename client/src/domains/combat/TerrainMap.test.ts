import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TerrainMap } from './TerrainMap'
import { parseCombatConfig } from './config'
import { PlayerModel } from './PlayerModel'
import { GameClock } from '@/core/time'

const raw = JSON.parse(
  readFileSync(new URL('../../../public/config/combat.json', import.meta.url), 'utf8'),
) as Record<string, unknown>
const cfg = parseCombatConfig(raw)
const terrain = new TerrainMap(cfg)

/**
 * 一击就能造出来的「一间房 + 一条走廊，中间只开一个**比摆放净空窄**的门洞」。
 *
 * ```
 *   y=0   ┌───────────── 走廊 ─────────────┐   ← 出生点 (300,60)
 *   y=120 ┌── 墙 ──┐ 40px 门洞 ┌── 墙 ──┐
 *   y=160 │            房间            │      ← 地中央一张 80×80 的书桌
 *   y=480 └──────────── 墙 ────────────┘
 *         x=0          64      400     600
 * ```
 *
 * 门洞 40px：**玩家（半径 12）挤得过去，半径 40 的东西挤不过去** —— 这就是
 * `safeSpawn()` 那两件事（摆放净空 / 通行半径）分家的最小复现。
 */
function narrowDoorTerrain(): TerrainMap {
  const map = new TerrainMap(
    parseCombatConfig({
      ...raw,
      arena: { ...(raw.arena as object), width: 600, height: 600 },
      terrain: { ...(raw.terrain as object), playerSpawn: { x: 300, y: 60 } },
    }),
    32,
  )
  map.setStage({
    stage: 1,
    playerSpawn: { x: 300, y: 60 },
    // `id` 必填（`SolidRect`），而且**前缀有意义**：`StageBackground` 靠 `wall` 前缀
    // 决定画不画描边，所以墙叫 `wall-n`、家具叫自己的种类名 —— 照 `DungeonStages` 的造法抄。
    solids: [
      { id: 'wall-1', x: 0, y: 120, width: 280, height: 40 }, // 门洞左边的墙
      { id: 'wall-2', x: 320, y: 120, width: 280, height: 40 }, // 门洞右边的墙
      { id: 'wall-3', x: 0, y: 160, width: 64, height: 320 }, // 房间左墙
      { id: 'wall-4', x: 400, y: 160, width: 200, height: 320 }, // 房间右墙
      { id: 'wall-5', x: 0, y: 480, width: 600, height: 40 }, // 房间下墙
      { id: 'desk-1', x: 200, y: 280, width: 80, height: 80 }, // 地中央那张书桌
    ],
  })
  return map
}
const inRoom = (p: { x: number; y: number }) =>
  p.x > 64 && p.x < 400 && p.y > 160 && p.y < 480

describe('neon arena terrain', () => {
  it('uses the new neon arena bounds without the old grass pond map', () => {
    expect([terrain.width, terrain.height]).toEqual([1344, 832])
    expect(terrain.water).toEqual([])
    expect(terrain.isWater(672, 416)).toBe(false)
    expect(terrain.isWalkable(cfg.terrain.playerSpawn.x, cfg.terrain.playerSpawn.y, 40)).toBe(true)
  })

  it('keeps player and enemy spawn requests inside the arena', () => {
    for (const radius of [8, 12, 18, 40])
      for (const point of [
        { x: -20, y: -10 },
        { x: 672, y: 416 },
        { x: 2000, y: 2000 },
      ]) {
        const safe = terrain.safeSpawn(point.x, point.y, radius)
        expect(terrain.isWalkable(safe.x, safe.y, radius)).toBe(true)
      }
  })

  it('does not report water entry on the neon arena', () => {
    expect(terrain.crossesWater({ x: 10, y: 10 }, { x: 1300, y: 800 })).toBe(false)
  })

  /**
   * ★ 新增（2026-10-21）：**摆放净空**与**通行半径**是两件事。
   *
   * 这一条钉的是用户报的「宝箱和怪物会刷在走廊和其他房间」那个 bug 的**根**：
   * 泛洪判定连通性时用的是**摆放净空**，于是任何比门洞粗的东西（宝箱按 56 算、
   * 门洞窄于两倍怪半径的房间）都会让**整间房被判成不可达**，兜底只能落到
   * 出生点那一片走廊上 —— 实测把宝箱扔出房外 200—540px、刷怪点 673—817px。
   *
   * 判据：**同一个点、同一个净空，只有通行半径不同**，落点一个在房外一个在房内。
   */
  it('keeps a spawn in the room when the doorway is narrower than its clearance', () => {
    const map = narrowDoorTerrain()
    const want = { x: 240, y: 320 } // 书桌正中央：想放这儿，但 40 的净空放不下
    expect(map.isWalkable(want.x, want.y, 40), '书桌正中央本来是放不下的（这道题的前提）').toBe(
      false,
    )

    // 老口径（通行半径 = 净空 40）：泛洪挤不过 40px 的门洞 → 整间房不可达 →
    // 最近的合格格子在**走廊**里（y < 160）。
    const blind = map.safeSpawn(want.x, want.y, 40)
    expect(map.isWalkable(blind.x, blind.y, 40)).toBe(true)
    expect(inRoom(blind), `老口径竟然落在房里了（探针的前提变了）：${JSON.stringify(blind)}`).toBe(
      false,
    )

    // 新口径（通行半径 = 玩家 12）：泛洪进得来 → 落点是房内最近的、净空 40 的格子。
    const sane = map.safeSpawn(want.x, want.y, 40, 12)
    expect(map.isWalkable(sane.x, sane.y, 40)).toBe(true)
    expect(inRoom(sane), `通行半径 12 时仍落在房外：${JSON.stringify(sane)}`).toBe(true)
  })

  it('still returns the requested point untouched when it is already fine', () => {
    const map = narrowDoorTerrain()
    const p = { x: 112, y: 48 } // 走廊里：净空 40 够、也从出生点泛洪得到
    expect(map.isWalkable(p.x, p.y, 40)).toBe(true)
    expect(map.safeSpawn(p.x, p.y, 40, 12)).toEqual(p)
    expect(map.safeSpawn(p.x, p.y, 40)).toEqual(p)
    // 房内同样的空地则**只有**新口径留着不动 —— 老口径连它都不认（整间房不可达），
    // 这正是那个 bug 的形状：房内明明有地方，落点却在走廊。
    const inside = { x: 120, y: 208 }
    expect(map.isWalkable(inside.x, inside.y, 40)).toBe(true)
    expect(map.safeSpawn(inside.x, inside.y, 40, 12)).toEqual(inside)
    expect(map.safeSpawn(inside.x, inside.y, 40)).not.toEqual(inside)
  })

  it('kills a player only through the explicit water API when a water map is configured', () => {
    const waterConfig = parseCombatConfig({
      ...JSON.parse(
        readFileSync(new URL('../../../public/config/combat.json', import.meta.url), 'utf8'),
      ),
      terrain: {
        ...cfg.terrain,
        water: [{ x: 100, y: 100, width: 100, height: 100 }],
      },
    })
    const waterTerrain = new TerrainMap(waterConfig)
    const clock = new GameClock()
    const player = new PlayerModel({ maxHp: 50, speed: 200, radius: 12 }, clock, 450, 5)
    player.protectedUntilMs = Infinity
    let deaths = 0
    player.sink = { onDamaged: () => {}, onKilled: () => deaths++ }
    expect(waterTerrain.crossesWater({ x: 80, y: 150 }, { x: 150, y: 150 })).toBe(true)
    player.fallIntoWater()
    expect([player.hp, player.shield, player.alive, player.deathCause, deaths]).toEqual([
      0,
      0,
      false,
      'water',
      1,
    ])
  })
})
