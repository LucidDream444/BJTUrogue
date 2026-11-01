import { describe, expect, it } from 'vitest'
import { PUBLIC_WEAPON_ART, RED_BERRY_ART } from '@/core/assetManifest'
import { GameClock } from '@/core/time'
import { redBerryFrame, redBerryPose, type RedBerryPoseInput, type RedBerryWeapon } from './RedBerryPose'

const input = (overrides: Partial<RedBerryPoseInput> = {}): RedBerryPoseInput => ({
  feet: { x: 120, y: 240 }, aim: { x: 500, y: 240 }, scale: 0.8,
  weapon: 'pencil', moving: false, runElapsedMs: 0,
  attackElapsedMs: null, attackDurationMs: 240, ...overrides,
})

describe('小红果地面锚点与独立公共武器', () => {
  it('同一身体插槽支持六种公共武器完整旋转，枪口与枪管方向一致', () => {
    for (const weapon of Object.keys(PUBLIC_WEAPON_ART) as RedBerryWeapon[]) {
      for (let i = 0; i < 64; i++) {
        const angle = i * Math.PI / 32
        const p = redBerryPose(input({ weapon,
          aim: { x: 120 + Math.cos(angle) * 500, y: 223.2 + Math.sin(angle) * 500 } }))
        const barrel = Math.hypot(
          PUBLIC_WEAPON_ART[weapon].muzzle[0] - PUBLIC_WEAPON_ART[weapon].grip[0],
          PUBLIC_WEAPON_ART[weapon].muzzle[1] - PUBLIC_WEAPON_ART[weapon].grip[1],
        ) * p.gunScale
        expect(p.muzzle.x - p.grip.x).toBeCloseTo(Math.cos(p.angle) * barrel, 8)
        expect(p.muzzle.y - p.grip.y).toBeCloseTo(Math.sin(p.angle) * barrel, 8)
        expect(Math.hypot(p.grip.x - p.center.x, p.grip.y - p.center.y))
          .toBeCloseTo(RED_BERRY_ART.socketRadius * 0.8, 8)
        expect(p.flipY).toBe(Math.cos(p.angle) < 0)
        expect(p.gunBehind).toBe(Math.sin(p.angle) < 0)
      }
    }
  })

  it('跳起时身体和枪共用抬升，地面锚点与输入坐标保持原样', () => {
    const cycle = RED_BERRY_ART.states.run.count * 1000 / RED_BERRY_ART.states.run.frameRate
    const atFloor = redBerryPose(input({ moving: true, runElapsedMs: 0 }))
    const original = input({ moving: true, runElapsedMs: cycle / 2 })
    const before = structuredClone(original)
    const atTop = redBerryPose(original)
    expect(atTop.feet).toEqual(atFloor.feet)
    expect(atTop.lift).toBeCloseTo(RED_BERRY_ART.hopHeight * original.scale)
    expect(atFloor.body.y - atTop.body.y).toBeCloseTo(atTop.lift)
    expect(original).toEqual(before)
    // Keep the same target direction relative to the lifted body to compare transforms.
    const shiftedAim = redBerryPose(input({ moving: true, runElapsedMs: cycle / 2,
      aim: { x: original.aim.x, y: original.aim.y - atTop.lift } }))
    expect(atFloor.grip.y - shiftedAim.grip.y).toBeCloseTo(atTop.lift)
    expect(atFloor.muzzle.y - shiftedAim.muzzle.y).toBeCloseTo(atTop.lift)
  })

  it('静止不跳跃，逻辑时钟不前进时每一层姿态保持一致', () => {
    expect(redBerryPose(input({ runElapsedMs: 120 })).lift).toBe(0)
    const clock = new GameClock()
    clock.advance(80)
    const rendered = () => ({ pose: redBerryPose(input({ moving: true,
      runElapsedMs: clock.nowMs, attackElapsedMs: clock.nowMs })),
      frame: redBerryFrame('run', clock.nowMs) })
    const before = rendered()
    clock.pause()
    clock.advance(1000)
    expect(rendered()).toEqual(before)
    clock.resume()
    clock.freeze(100)
    clock.advance(50)
    expect(rendered()).toEqual(before)
    clock.advance(100)
    expect(rendered()).not.toEqual(before)
  })

  it('后坐力沿枪管回退，枪口同时回退而不改变物理锚点', () => {
    const still = redBerryPose(input())
    const recoil = redBerryPose(input({ attackElapsedMs: 120 }))
    expect(still.feet).toEqual(recoil.feet)
    expect(still.angle).toBe(recoil.angle)
    expect(still.grip.x - recoil.grip.x)
      .toBeCloseTo(Math.cos(still.angle) * RED_BERRY_ART.recoilDistance * 0.8)
    expect(still.muzzle.x - recoil.muzzle.x).toBeCloseTo(still.grip.x - recoil.grip.x)
    expect(still.muzzle.y - recoil.muzzle.y).toBeCloseTo(still.grip.y - recoil.grip.y)
  })

  it('瞄准点重合及贴近中心或枪口时保持有限坐标和既有方向', () => {
    const seed = redBerryPose(input())
    const exact = redBerryPose(input({ aim: seed.center, previousAngle: 2.1 }))
    expect(exact.angle).toBe(2.1)
    for (const aim of [seed.center, seed.muzzle, seed.grip,
      { x: seed.center.x + 0.000001, y: seed.center.y - 0.000001 }]) {
      const p = redBerryPose(input({ aim }))
      expect([p.angle, p.rotation, p.grip.x, p.grip.y, p.muzzle.x, p.muzzle.y]
        .every(Number.isFinite)).toBe(true)
    }
  })

  it('移动循环，受击和退场按时间推进且停在最终帧', () => {
    const states = RED_BERRY_ART.states
    const cycle = states.run.count * 1000 / states.run.frameRate
    expect(redBerryFrame('run', 0)).toBe(states.run.start)
    expect(redBerryFrame('run', cycle)).toBe(states.run.start)
    expect(redBerryFrame('hurt', 225, 450)).toBe(states.hurt.start + 2)
    expect(redBerryFrame('death', 99999)).toBe(states.death.start + states.death.count - 1)
  })
})
