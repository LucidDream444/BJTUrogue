import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { WeaponDef, WeaponTrait } from './config'
import { parseCombatConfig } from './config'

const config = parseCombatConfig(
  JSON.parse(
    readFileSync(new URL('../../../public/config/combat.json', import.meta.url), 'utf8'),
  ),
)
const damage = (weapon: WeaponDef) => 10 * weapon.damageScale
const trait = <K extends WeaponTrait['kind']>(weapon: WeaponDef, kind: K) =>
  weapon.traits?.find(
    (entry): entry is Extract<WeaponTrait, { kind: K }> => entry.kind === kind,
  )
const cycleMs = (weapon: WeaponDef) => 250 * weapon.cooldownScale

/** 单目标裸循环；范围、连锁、分裂等额外命中另算，不让多目标武器在单体表里虚高。 */
function singleTargetDps(weapon: WeaponDef): number {
  const burst = trait(weapon, 'burst')
  const multi = trait(weapon, 'multiHit')
  const boomerang = trait(weapon, 'boomerang')
  const shots = burst?.count ?? 1
  const returnHits = boomerang ? 2 : 1
  const multiRatio =
    multi && multi.count > 1
      ? 1 + (multi.count - 1) * (multi.damageRatio ?? 1)
      : 1
  return (
    (damage(weapon) * weapon.pellets * shots * returnHits * multiRatio * 1000) /
    cycleMs(weapon)
  )
}

describe('36 把武器的统一数值基线', () => {
  it('全部武器都有可比较的单目标直伤，最高不超过 58 DPS', () => {
    for (const weapon of config.weapons)
      expect(singleTargetDps(weapon), weapon.id).toBeGreaterThanOrEqual(24)
    expect(Math.max(...config.weapons.map(singleTargetDps))).toBeLessThanOrEqual(58)
  })

  it('近战依靠零消耗与范围换取 40—58 DPS', () => {
    for (const weapon of config.weapons.filter((entry) => entry.mode === 'melee')) {
      expect(weapon.staminaCost, weapon.id).toBe(0)
      expect(singleTargetDps(weapon), weapon.id).toBeGreaterThanOrEqual(40)
      expect(singleTargetDps(weapon), weapon.id).toBeLessThanOrEqual(58)
    }
  })

  it('远程武器不会同时拥有过高直伤和过高持续耗能', () => {
    for (const weapon of config.weapons.filter((entry) => entry.mode !== 'melee')) {
      const burst = trait(weapon, 'burst')
      const shots = burst?.count ?? 1
      const energyPerSecond = (weapon.staminaCost * shots * 1000) / cycleMs(weapon)
      expect(energyPerSecond, weapon.id).toBeLessThanOrEqual(18)
    }
  })

  it('特殊效果武器用直伤换范围、控制或续航，但不会掉到无效区间', () => {
    const special = [
      'pulse',
      'model_rocket',
      'grenade_launcher',
      'arc_emitter',
      'split_dart',
      'lifesteal_syringe',
      'sonic_horn',
      'firework_launcher',
    ]
    for (const id of special) {
      const weapon = config.weapons.find((entry) => entry.id === id)!
      expect(singleTargetDps(weapon), id).toBeGreaterThanOrEqual(24)
      expect(singleTargetDps(weapon), id).toBeLessThanOrEqual(45)
    }
  })

  it('所有开火循环不短于 150ms，避免攻速加成后小于两帧', () => {
    for (const weapon of config.weapons)
      expect(cycleMs(weapon), weapon.id).toBeGreaterThanOrEqual(150)
  })
})
