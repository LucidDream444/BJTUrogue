import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TerrainMap } from './TerrainMap'
import { parseCombatConfig } from './config'
import { PlayerModel } from './PlayerModel'
import { GameClock } from '@/core/time'

const cfg = parseCombatConfig(
  JSON.parse(readFileSync(new URL('../../../public/config/combat.json', import.meta.url), 'utf8')),
)
const terrain = new TerrainMap(cfg)

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
