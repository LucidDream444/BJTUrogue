import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { validateEnemies } from '@/core/config'
import { RadialProjectiles } from './RadialProjectiles'

const raw = () => JSON.parse(readFileSync('public/config/enemies.json', 'utf8'))
const cfg = validateEnemies(raw()).stage2Boss.projectile
const always = () => true

function ring() {
  const pool = new RadialProjectiles(cfg)
  pool.emit(1, 0, 0, 0, cfg.damage)
  return pool
}

describe('360-degree radial projectiles', () => {
  it('covers a whole circle uniformly and rotates the next volley into the gaps', () => {
    const pool = ring()
    const shots = pool.shots.filter((shot) => shot.active)
    expect(shots).toHaveLength(cfg.count)
    for (let i = 0; i < shots.length; i++) {
      expect(shots[i]!.vx).toBeCloseTo(Math.cos((i / cfg.count) * Math.PI * 2) * cfg.speed)
      expect(shots[i]!.vy).toBeCloseTo(Math.sin((i / cfg.count) * Math.PI * 2) * cfg.speed)
    }
    pool.emit(1, 0, 0, 0, cfg.damage)
    expect(pool.shots[cfg.count]!.vy).toBeGreaterThan(0)
  })

  it('uses swept collision and consumes a shot after a single damaging hit', () => {
    const pool = ring(),
      hit = vi.fn()
    const target = { x: 100, y: 0, radius: 4, alive: true }
    pool.step(1000, target, always, always, hit)
    expect(hit).toHaveBeenCalledTimes(1)
    expect(hit.mock.calls[0]![0].damage).toBe(cfg.damage)
    pool.step(1100, target, always, always, hit)
    expect(hit).toHaveBeenCalledTimes(1)
  })

  it('allows dodging through gaps and never hurts a dead player', () => {
    const angle = Math.PI / cfg.count
    const target = { x: Math.cos(angle) * 200, y: Math.sin(angle) * 200, radius: 4, alive: true }
    const hit = vi.fn()
    ring().step(1500, target, always, always, hit)
    ring().step(1000, { x: 100, y: 0, radius: 4, alive: false }, always, always, hit)
    expect(hit).not.toHaveBeenCalled()
  })

  it('is blocked by scenery before applying damage', () => {
    const pool = ring(),
      hit = vi.fn()
    pool.step(1000, { x: 100, y: 0, radius: 10, alive: true }, always, () => false, hit)
    expect(hit).not.toHaveBeenCalled()
    expect(pool.shots.some((shot) => shot.active)).toBe(false)
  })

  it('freezes when logical time is unchanged and does not repeat a hit on catch-up steps', () => {
    const pool = ring(),
      hit = vi.fn()
    const before = pool.shots.map((shot) => ({ ...shot }))
    pool.step(0, { x: 100, y: 0, radius: 4, alive: true }, always, always, hit)
    expect(pool.shots).toEqual(before)
    pool.step(1000, { x: 100, y: 0, radius: 4, alive: true }, always, always, hit)
    pool.step(1000, { x: 100, y: 0, radius: 4, alive: true }, always, always, hit)
    expect(hit).toHaveBeenCalledTimes(1)
  })

  it('expires and cannot hit a target beyond its lifetime even after a long frame', () => {
    const pool = ring(),
      hit = vi.fn()
    pool.step(cfg.lifetimeMs * 10, { x: 1500, y: 0, radius: 4, alive: true }, always, always, hit)
    expect(hit).not.toHaveBeenCalled()
    expect(pool.shots.some((shot) => shot.active)).toBe(false)
  })

  it('clears shots on owner death, explicit removal, and scene cleanup', () => {
    const pool = ring(),
      hit = vi.fn()
    pool.step(1000, { x: 100, y: 0, radius: 4, alive: true }, () => false, always, hit)
    expect(hit).not.toHaveBeenCalled()
    expect(pool.shots.some((shot) => shot.active)).toBe(false)
    pool.emit(2, 0, 0, 1000, cfg.damage)
    pool.removeOwner(2)
    expect(pool.shots.some((shot) => shot.active)).toBe(false)
    pool.emit(3, 0, 0, 1000, cfg.damage)
    pool.clear()
    expect(pool.shots.some((shot) => shot.active)).toBe(false)
  })

  it('bounds allocations and drops whole volleys when the pool is full', () => {
    const pool = new RadialProjectiles({ ...cfg, maxActive: cfg.count })
    const slot = pool.shots[0]
    expect(pool.emit(1, 0, 0, 0, cfg.damage)).toBe(cfg.count)
    expect(pool.emit(1, 0, 0, 0, cfg.damage)).toBe(0)
    pool.clear()
    expect(pool.emit(2, 0, 0, 0, cfg.damage)).toBe(cfg.count)
    expect(pool.shots[0]).toBe(slot)
  })

  it('rejects invalid projectile counts, pool capacity, and attack timing in the config', () => {
    for (const change of [
      (r: ReturnType<typeof raw>) => {
        r.stage2Boss.projectile.count = 12.5
      },
      (r: ReturnType<typeof raw>) => {
        r.stage2Boss.projectile.maxActive = 1
      },
      (r: ReturnType<typeof raw>) => {
        r.stage2Boss.cooldownMs = 1
      },
    ]) {
      const r = raw()
      change(r)
      expect(() => validateEnemies(r)).toThrow()
    }
  })
})
