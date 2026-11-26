/**
 * **一局的地图计划**：`floors.json` v2（1F 出发层 + 第 1/2/3 层候选 + 8F 最终战 + 7F 排除）。
 *
 * 这个文件守的是新结构所依赖的几件事：
 * 1. 层数 = `combat.json` 的 `arena.maxStages`（3）；
 * 2. 第 1/2/3 层都从 2F/4F/5F/6F 随机，**允许重复**（第 3 层可与第 1 层相同）；3F/7F 不进产品；
 * 3. 每个候选（不只抽中的）都有楼梯间和恰好一间首领房；
 * 5. 8F 是最终战，不是一个可抽取的层；
 * 6. 同一 `runSeed` 复现同一组地图。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { ConfigError } from '@/core/config'
import { parseCombatConfig } from '@/domains/combat/config'
import { FLOORS_CONFIG_NAME, parseFloorsConfig, parseRoomsConfig, type RoomsConfig } from '../config'
import {
  FLOOR_PLAN_FILES,
  FLOOR_PLAN_NAME,
  FLOOR_PLAN_YF1_NAME,
  FLOOR_PLAN_YF2_NAME,
  FLOOR_PLAN_YF3_NAME,
  FLOOR_PLAN_YF4_NAME,
  FLOOR_PLAN_YF5_NAME,
  FLOOR_PLAN_YF7_NAME,
  FLOOR_PLAN_YF8_NAME,
  floorPlanFromCache,
  floorPlansForRun,
} from './floorPlan'
import { generateDungeon } from './generate'
import { validateContract } from '../validate/contract'
import { assertReachable } from '../validate/reachability'

const CONFIG_DIR = fileURLToPath(new URL('../../../../public/config/', import.meta.url))
const RAW: Record<string, unknown> = {}
const readJson = (name: string): unknown => {
  const hit = RAW[name]
  if (hit !== undefined) return hit
  const parsed: unknown = JSON.parse(readFileSync(CONFIG_DIR + name, 'utf8'))
  RAW[name] = parsed
  return parsed
}

const cfg: RoomsConfig = parseRoomsConfig(readJson('rooms.json'))
const d1 = parseCombatConfig(readJson('combat.json'))
const MAX_STAGES = d1.arena.maxStages
const cache = { get: (key: string): unknown => readJson(key) }
const floors = parseFloorsConfig(readJson(FLOORS_CONFIG_NAME), MAX_STAGES)

const LAYER_MAPS = [
  FLOOR_PLAN_YF2_NAME,
  FLOOR_PLAN_YF4_NAME,
  FLOOR_PLAN_YF5_NAME,
  FLOOR_PLAN_NAME,
]

describe('一局的地图计划（floors.json v2）', () => {
  it('层数 = arena.maxStages（3）；三层都是 2F/4F/5F/6F 候选', () => {
    expect(MAX_STAGES).toBe(3)
    expect(floors.layers).toHaveLength(MAX_STAGES)
    for (const layer of floors.layers) expect(layer.candidates).toEqual(LAYER_MAPS)
    expect(floors.layers.some((layer) => layer.requireShop)).toBe(false)
    expect(floors.prologue.file).toBe(FLOOR_PLAN_YF1_NAME)
    expect(floors.finale.file).toBe(FLOOR_PLAN_YF8_NAME)
  })

  it('3F/7F 只在排除表里，8F 只作最终战', () => {
    expect(floors.excluded.map((entry) => entry.file)).toEqual([FLOOR_PLAN_YF3_NAME, FLOOR_PLAN_YF7_NAME])
    const used = new Set([
      floors.prologue.file,
      ...floors.pool.map((entry) => entry.file),
      floors.finale.file,
    ])
    expect(used.has(FLOOR_PLAN_YF7_NAME)).toBe(false)
    for (const layer of floors.layers) expect(layer.candidates).not.toContain(FLOOR_PLAN_YF7_NAME)
    expect(floors.layers.flatMap((layer) => layer.candidates)).not.toContain(FLOOR_PLAN_YF8_NAME)
  })

  it('所有引用的文件都被 preload 加载过', () => {
    for (const file of [
      floors.prologue.file,
      ...floors.pool.map((entry) => entry.file),
      floors.finale.file,
      ...floors.excluded.map((entry) => entry.file),
    ])
      expect(FLOOR_PLAN_FILES, `${file} 不在 FLOOR_PLAN_FILES 里`).toContain(file)
  })

  it('候选必须有楼梯间 + 恰好 1 间首领房；层候选不能有商店', () => {
    floors.layers.forEach((layer) => {
      for (const file of layer.candidates) {
        const plan = floorPlanFromCache(cache, cfg, file)
        expect(plan.stairwell, `${file} 缺楼梯间`).toBeDefined()
        expect(
          plan.rooms.filter((room) => room.fixed === 'boss'),
          `${file} 的首领房数量`,
        ).toHaveLength(1)
        expect(plan.rooms.filter((room) => room.fixed === 'shop'), `${file} 不能带商店`).toHaveLength(0)
      }
    })
    const finale = floorPlanFromCache(cache, cfg, floors.finale.file)
    expect(finale.rooms.filter((room) => room.fixed === 'boss')).toHaveLength(1)
  })

  it('同一 runSeed 复现同一组地图；三层允许重复；3F/7F 不被抽中', () => {
    const first = floorPlansForRun(cache, cfg, MAX_STAGES, 20261119)
    const second = floorPlansForRun(cache, cfg, MAX_STAGES, 20261119)
    expect(first.layers.map((layer) => layer.file)).toEqual(second.layers.map((layer) => layer.file))
    expect(first.prologue.file).toBe(FLOOR_PLAN_YF1_NAME)
    expect(first.finale.file).toBe(FLOOR_PLAN_YF8_NAME)
    expect(first.layers).toHaveLength(MAX_STAGES)
    for (const layer of first.layers) expect(LAYER_MAPS).toContain(layer.file)
    expect(first.layers.map((layer) => layer.file)).not.toContain(FLOOR_PLAN_YF3_NAME)
    expect(first.layers.map((layer) => layer.file)).not.toContain(FLOOR_PLAN_YF7_NAME)
    let repeated = false
    for (let seed = 1; seed <= 200; seed++) {
      const files = floorPlansForRun(cache, cfg, MAX_STAGES, seed).layers.map((layer) => layer.file)
      if (new Set(files).size < MAX_STAGES) repeated = true
    }
    expect(repeated, '三层允许重复，但 200 个种子里一次重复都没有').toBe(true)
  })

  it('第 1 层会抽到 2F / 4F / 5F / 6F 四张图', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 200; seed++) {
      const run = floorPlansForRun(cache, cfg, MAX_STAGES, seed)
      seen.add(run.layers[0]!.file)
    }
    expect(seen).toEqual(new Set(LAYER_MAPS))
  })

  it('所有候选/最终战都能生成、过契约校验且可达', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 50; seed++) {
      const run = floorPlansForRun(cache, cfg, MAX_STAGES, seed)
      for (const layer of [...run.layers, run.finale]) {
        if (seen.has(layer.file)) continue
        seen.add(layer.file)
        const map = generateDungeon(seed, cfg, layer.plan)
        expect(map.rooms).toHaveLength(layer.plan.roomTotal)
        expect(() => validateContract(map, cfg, layer.plan.roomTotal), `${layer.file} seed ${seed}`).not.toThrow()
        expect(() => assertReachable(map, cfg), `${layer.file} seed ${seed}`).not.toThrow()
      }
    }
    // 覆盖到全部层候选 + 8F（1F 单独生成；它是空房教学层）。
    expect(seen).toEqual(new Set([...LAYER_MAPS, FLOOR_PLAN_YF8_NAME]))
  })

  it('8F 最终战只有 YF804 一间首领房', () => {
    const eight = floorPlansForRun(cache, cfg, MAX_STAGES, 1).finale.plan
    expect(eight.rooms.map((room) => room.id)).toEqual(['YF804'])
    expect(eight.rooms[0]!.fixed).toBe('boss')
    expect(eight.stairwell.id).toBe('STAIR')
    expect(eight.rooms.some((room) => room.fixed === 'elevator')).toBe(false)
  })

  it('缺少加载的平面图时报错指回 FLOOR_PLAN_FILES', () => {
    const GHOST = 'floor-plan-4f.json'
    const ghost = {
      ...(readJson(FLOORS_CONFIG_NAME) as Record<string, unknown>),
      pool: [
        ...(readJson(FLOORS_CONFIG_NAME) as { pool: unknown[] }).pool,
        { file: GHOST, label: '幽灵' },
      ],
      layers: [
        { candidates: LAYER_MAPS },
        { candidates: [GHOST] },
        { candidates: LAYER_MAPS },
      ],
    }
    const ghostCache = {
      get: (k: string): unknown => (k === FLOORS_CONFIG_NAME ? ghost : k === GHOST ? undefined : readJson(k)),
    }
    expect(() => floorPlansForRun(ghostCache, cfg, MAX_STAGES, 1)).toThrow(/FLOOR_PLAN_FILES/)
  })

  it('层数对不上时当场抛', () => {
    expect(() => parseFloorsConfig(readJson(FLOORS_CONFIG_NAME), MAX_STAGES + 1)).toThrow(ConfigError)
    expect(() => parseFloorsConfig(readJson(FLOORS_CONFIG_NAME), MAX_STAGES - 1)).toThrow(ConfigError)
  })
})
