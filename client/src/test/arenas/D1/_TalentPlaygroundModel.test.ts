import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  TalentPlayground,
  segmentCircleFraction,
  type PlaygroundConfig,
} from './_TalentPlaygroundModel'

const source = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../public/config/talent-playground.json', import.meta.url)),
    'utf8',
  ).replace(/^\uFEFF/, ''),
) as PlaygroundConfig
function config(): PlaygroundConfig {
  return structuredClone(source)
}
function advance(lab: TalentPlayground, frames: number, fire = true): void {
  for (let i = 0; i < frames; i++) {
    const target = lab.aimTarget()
    lab.step(1000 / 60, { moveX: 0, moveY: 0, aimX: target.x, aimY: target.y, fire })
  }
}

describe('talent shooting playground', () => {
  it('sweeps a fast projectile through a target instead of only testing endpoints', () => {
    expect(
      segmentCircleFraction({ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 500, y: 0 }, 10),
    ).toBeCloseTo(0.49)
    expect(
      segmentCircleFraction({ x: 0, y: 30 }, { x: 1000, y: 30 }, { x: 500, y: 0 }, 10),
    ).toBeNull()
  })
  it('uses the same seed when resetting and makes actual hits and kills', () => {
    const lab = new TalentPlayground(config())
    advance(lab, 600)
    const before = structuredClone(lab.stats)
    expect(before.hits).toBeGreaterThan(0)
    expect(before.kills).toBeGreaterThan(0)
    expect(before.splits).toBeGreaterThan(0)
    lab.reset()
    advance(lab, 600)
    expect(lab.stats).toEqual(before)
  })
  it('baseline has no secondary effects', () => {
    const lab = new TalentPlayground(config())
    lab.select('baseline')
    advance(lab, 400)
    expect(lab.enabled.size).toBe(0)
    expect(lab.stats.hits).toBeGreaterThan(0)
    expect(lab.stats.splits + lab.stats.bounces + lab.stats.lightning + lab.stats.fields).toBe(0)
  })
  it('split children do not recursively split and bounded pools survive sustained fire', () => {
    const cfg = config()
    cfg.tuning.splitChance = 1
    const lab = new TalentPlayground(cfg)
    advance(lab, 1800)
    expect(lab.stats.splits).toBeLessThanOrEqual(lab.stats.shots)
    expect(lab.bullets.length).toBeLessThanOrEqual(cfg.tuning.maxBullets)
    expect(lab.effects.length).toBeLessThanOrEqual(cfg.tuning.maxEffects)
    expect(lab.bullets.every((b) => Number.isFinite(b.x) && Number.isFinite(b.y))).toBe(true)
  })
  it('can independently disable a card and flushes in-flight state', () => {
    const lab = new TalentPlayground(config())
    advance(lab, 80)
    lab.toggle('split')
    expect(lab.enabled.has('split')).toBe(false)
    expect(lab.bullets).toHaveLength(0)
    const prior = lab.stats.splits
    advance(lab, 300)
    expect(lab.stats.splits).toBe(prior)
    expect(lab.enabled.has('homing')).toBe(true)
  })
  it('lightning chains damage and skill requests cannot be spammed', () => {
    const cfg = config()
    cfg.tuning.critChance = 1
    const lab = new TalentPlayground(cfg)
    lab.select('thunder')
    expect(lab.skill(lab.aimTarget())).toBe(true)
    expect(lab.skill(lab.aimTarget())).toBe(false)
    advance(lab, 300)
    expect(lab.stats.lightning).toBeGreaterThan(1)
    expect(lab.stats.damage).toBeGreaterThan(0)
  })
  it('return preset creates orbit projectiles and marks outward and return phases', () => {
    const lab = new TalentPlayground(config())
    lab.select('return')
    advance(lab, 70)
    expect(lab.bullets.some((b) => b.orbit)).toBe(true)
    expect(lab.bullets.some((b) => b.returning)).toBe(true)
  })
  it('blackholes actually pull targets and detonate without waiting for visual objects', () => {
    const lab = new TalentPlayground(config())
    lab.select('singularity')
    advance(lab, 400)
    expect(lab.stats.fields).toBeGreaterThan(0)
    expect(lab.stats.kills).toBeGreaterThan(0)
    expect(lab.effects.some((e) => e.kind === 'explosion' || e.kind === 'field')).toBe(true)
  })
  it('clamps long frames and movement, never catches up an entire hidden tab', () => {
    const lab = new TalentPlayground(config())
    lab.step(60000, { moveX: 1, moveY: 0, aimX: 800, aimY: 360, fire: true })
    expect(lab.now).toBeCloseTo(lab.config.tuning.maxDeltaMs)
    expect(lab.stats.shots).toBe(1)
    expect(lab.player.x).toBeLessThan(300)
  })
})
