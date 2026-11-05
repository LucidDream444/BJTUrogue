import { describe, expect, it } from 'vitest'
import { skillHealth, transformedHealth } from './SkillUnitState'

describe('boss skill unit state', () => {
  it('clamps healing and permits a living unit to die', () => {
    expect(skillHealth(20, 100, true, 150)).toBe(100)
    expect(skillHealth(20, 100, true, -10)).toBe(0)
  })
  it('never revives a dead unit or a zero-health snapshot', () => {
    expect(skillHealth(0, 100, false, 80)).toBeNull()
    expect(skillHealth(0, 100, true, 80)).toBeNull()
    expect(skillHealth(10, 100, false, 80)).toBeNull()
    expect(skillHealth(10, 100, true, NaN)).toBeNull()
  })
  it('preserves HP percentage through transformations without rounding to zero', () => {
    expect(transformedHealth(25, 100, 80)).toBe(20)
    expect(transformedHealth(1, 100, 7)).toBeCloseTo(0.07)
  })
})
