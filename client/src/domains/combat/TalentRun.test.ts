import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { Rng, FixedRng } from '@/core/rng'
import { parseCombatConfig, parseRewards, deriveStats, type EffectiveStats } from './config'
import { TalentRun, TALENT_KINDS, talentApplicable, type TalentRules } from './TalentRun'
import { RewardRun } from './RewardRun'

const read=(file:string):unknown=>JSON.parse(readFileSync(new URL('../../../public/config/'+file,import.meta.url),'utf8'))
const cfg=parseCombatConfig(read('combat.json'))
const defs=parseRewards(read('rewards.json'))
const rules=cfg.talents!
const player={hp:50,maxHp:50,shield:5,maxShield:5}
const base:EffectiveStats={damage:10,cooldownMs:250,bulletSpeed:520,spreadDeg:2,pellets:1,lifeMs:900,moveSpeed:260,maxHp:50,maxStamina:500,iframeMs:500}
const gun=cfg.weapons.find((weapon)=>weapon.id==='pencil')!
function run(ids:string[],random=.1):TalentRun{return new TalentRun(defs,new Map(ids.map((id)=>[id,1])),rules,new FixedRng(random))}

describe('production independent talent catalog',()=>{
  it('replaces all seven old cards and supplies 34 complete independent abilities',()=>{
    expect(defs).toHaveLength(34)
    expect(new Set(defs.map((def)=>def.id)).size).toBe(34)
    expect(defs.every((def)=>def.talent&&def.maxStacks===1&&def.effects.length===0)).toBe(true)
    expect(new Set(defs.map((def)=>def.talent!.kind))).toEqual(new Set(TALENT_KINDS))
    expect(defs.some((def)=>['sharp','lunch','tempo','reserves','grace','double_shot','sneakers'].includes(def.id))).toBe(false)
  })
  it('validates malformed talents instead of accepting a dead card',()=>{
    const bad={...defs[0]!,talent:{...defs[0]!.talent!,kind:'fake'}}
    expect(()=>parseRewards({schemaVersion:2,rewards:[bad]})).toThrow()
    expect(()=>parseRewards({schemaVersion:2,rewards:[{...defs[0]!,maxStacks:0}]})).toThrow()
    expect(()=>parseRewards({schemaVersion:2,rewards:[{...defs[0]!,talent:undefined}]})).toThrow()
  })
  it('offers mechanics at full health, never duplicates owned talents, and preserves them across floors',()=>{
    const rewards=new RewardRun(defs,new Rng(123),rules)
    for(let i=0;i<8;i++){
      const offered=rewards.offer('room-'+i,'pencil',50,50)!
      expect(offered.length).toBe(3)
      expect(new Set(offered.map((def)=>def.id)).size).toBe(3)
      expect(offered.every((def)=>!rewards.stacks.has(def.id))).toBe(true)
      rewards.choose(offered[0]!.id)
      rewards.forgetFloor()
    }
    expect(rewards.stacks.size).toBe(8)
    expect(rewards.offer('full','pencil',50,50)).toEqual([])
    expect(rewards.roomId).toBeNull()
  })
  it('rerolls a frozen choice using its own budget and finishes only after selection',()=>{
    const rewards=new RewardRun(defs,new Rng(44),rules)
    const first=rewards.offer('same-room','pencil',50,50)!.map((r)=>r.id)
    const next=rewards.reroll()!
    expect(next.every((r)=>!first.includes(r.id))).toBe(true)
    expect(rewards.rerollsLeft).toBe(1)
    expect(rewards.roomId).toBe('same-room')
    expect(rewards.reroll()).not.toBeNull()
    expect(rewards.reroll()).toBeNull()
    expect(rewards.choose(rewards.offered[0]!.id)).not.toBeNull()
    expect(rewards.offer('same-room','pencil',50,50)).toBeNull()
  })
  it('checks both weapon slots and excludes projectile mechanics from pure melee/beam',()=>{
    const split=defs.find((def)=>def.id==='split')!,sword=defs.find((def)=>def.id==='sword_wave')!,shield=defs.find((def)=>def.id==='shield_gate')!
    const melee=cfg.weapons.find((weapon)=>weapon.mode==='melee')!,beam=cfg.weapons.find((weapon)=>weapon.mode==='beam')!
    expect(talentApplicable(split,[melee,beam],5,true)).toBe(false)
    expect(talentApplicable(split,[melee,gun],5,true)).toBe(true)
    expect(talentApplicable(sword,[melee,gun],5,true)).toBe(true)
    expect(talentApplicable(shield,[gun],0,true)).toBe(false)
  })
  it('builds a real combined gun without mutating configuration or replacing native traits',()=>{
    const state=run(['split','homing','bounce','pierce','return'])
    const weapon=state.weapon(gun)
    expect(weapon.talentModified).toBe(true)
    expect(weapon.traits!.map((trait)=>trait.kind).sort()).toEqual(['boomerang','bounce','homing','pierce','split'])
    expect(gun.traits).toBeUndefined()
    const native=cfg.weapons.find((weapon)=>weapon.id==='magnetic_frisbee')!
    const modified=state.weapon(native)
    expect(modified.traits!.find((trait)=>trait.kind==='bounce')).toMatchObject({maxBounces:5})
    expect(native.traits!.find((trait)=>trait.kind==='bounce')).toMatchObject({maxBounces:3})
  })
  it('rolls independent criticals from talent RNG with bounded combined chance',()=>{
    const crit=run(['critical','lightning'],.39)
    expect(crit.crit(player)).toEqual({critical:true,ratio:1.75})
    expect(run(['critical','lightning'],.41).crit(player).critical).toBe(false)
    expect(run(['critical','lightning','last_stand'],.71).crit({...player,hp:1}).critical).toBe(false)
  })
  it('turns movement and shield into a bounded combat-only recovery loop',()=>{
    const state=run(['moving_shield','full_shield'])
    expect(state.moving(5000,0)).toBe(0)
    state.beginRoom('one',0)
    expect(state.moving(180,0)).toBe(1)
    expect(state.moving(180,100)).toBe(0)
    expect(state.stats(base,player,100).damage).toBe(12.5)
    expect(state.stats(base,{...player,shield:4},100).damage).toBe(10)
    for(let i=1;i<=10;i++)state.moving(180,i*1000)
    expect(state.moving(180,20000)).toBe(0)
    state.finishRoom()
    expect(state.moving(5000,30000)).toBe(0)
  })
  it('applies skill haste/cost reduction/cooldown together, with limits',()=>{
    const state=run(['skill_haste','cooldown','efficiency','opening'])
    state.beginRoom('room',1000);state.skill(1000)
    expect(state.skillScale()).toBe(.8)
    expect(state.costScale(1000)).toBeCloseTo(1-rules.maxCostReduction)
    expect(state.stats(base,player,1000).cooldownMs).toBeLessThan(250)
    expect(state.costScale(10000)).toBe(.75)
  })
  it('charges the entire next root attack once and tracks floor quotas independently',()=>{
    const state=run(['charged'])
    expect(state.attack(0)).toBe(1.6)
    expect(state.attack(100)).toBe(1)
    expect(state.attack(1000)).toBe(1.6)
    state.claim('1');state.claim('2');state.claim('1')
    expect(state.claimed('1')).toBe(2)
    expect(state.claimed('2')).toBe(1)
    expect(state.claimed('3')).toBe(0)
    expect(rules.floorChoices.reduce((sum,n)=>sum+n,1)).toBe(rules.maxOwned)
  })
  it('retains one-time ownership and does not raise legacy numeric stats by itself',()=>{
    const state=run(['split','homing'])
    expect(state.stats(base,player,0)).toMatchObject(base)
    expect(state.rules).toBeDefined()
    expect(deriveStats).toBeTypeOf('function')
    expect((rules as TalentRules).maxOwned).toBe(8)
  })
})
