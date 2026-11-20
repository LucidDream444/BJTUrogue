import type { RngLike } from '@/core/rng'
import type { EffectiveStats, RewardDef, WeaponDef, WeaponTrait } from './config'

export const TALENT_KINDS = ['split','bounce','pierce','homing','critical','scatter','sword_wave','splash','charged','ramp','lightning','bravery','cooldown','skill_haste','poison','spread','ice','kill_wave','moving_shield','shield_gate','full_shield','shield_battery','kill_rush','lunch_drop','efficiency','room_recovery','glass','last_stand','echo','opening','return','orbit','blackhole','chain'] as const
export type TalentKind = typeof TALENT_KINDS[number]
export type TalentCapability = 'any' | 'projectile' | 'ballistic' | 'melee' | 'shield' | 'skill'
export interface TalentDef { kind: TalentKind; capability: TalentCapability; params: Record<string, number>; synergy: TalentKind[] }
export interface TalentRules {
  maxOwned: number; rerolls: number; synergyWeightScale: number; floorChoices: number[]
  baseCritChance: number; baseCritMultiplier: number; maxCritChance: number
  maxRateScale: number; maxCostReduction: number; maxCooldownReduction: number
  maxQueuedHits: number; maxVisuals: number; maxFields: number; maxOrbit: number
  maxChildrenPerAttack: number; secondaryLifeMs: number; secondarySpeed: number; defaultRange: number
  visualLifeMs: number; numberLifeMs: number; stoppedRegenDelayMs: number; stoppedRegenScale: number
  commonProcCooldownMs: number; blackholeStepMs: number
}
export interface TalentPlayerState { hp: number; maxHp: number; shield: number; maxShield: number }
export interface TalentAttack { sourceId: number; weapon: WeaponDef; damage: number; x: number; y: number; angle: number; critical: boolean; secondary: boolean }
export interface TalentHit extends TalentAttack { targetId: number }
export interface TalentWeaponHooks { state: TalentRun; attack(event: TalentAttack): void; hit(event: TalentHit): void }

export function talentApplicable(reward: RewardDef, weapons: readonly WeaponDef[], shield: number, hasSkill: boolean): boolean {
  const capability = reward.talent?.capability
  if (!capability || capability === 'any') return true
  if (capability === 'shield') return shield > 0
  if (capability === 'skill') return hasSkill
  if (capability === 'melee') return weapons.some((w) => w.mode === 'melee')
  return weapons.some((w) => w.mode === 'projectile' && (capability !== 'ballistic' || (w.effect !== 'explosion' && w.effect !== 'energy')))
}

/** All time comes from GameClock. Pure state is testable without a browser or Phaser. */
export class TalentRun {
  private readonly definitions = new Map<TalentKind, RewardDef>()
  private readonly cooldowns = new Map<string, number>()
  private readonly weaponCache = new Map<string, WeaponDef>()
  private cachedSignature = ''
  private attackStarted = -Infinity
  private lastAttack = -Infinity
  private skillAt = -Infinity
  private criticalAt = -Infinity
  private lastKill = -Infinity
  private killDecayAt = Infinity
  private killStacks = 0
  private braveryStacks = 0
  private attacks = 0
  private movement = 0
  private roomShield = 0
  private readonly roomClaims = new Set<string>()
  private readonly floorClaims = new Map<string, number>()
  roomKey = ''
  roomStarted = -Infinity
  inCombat = false
  diagnostics = { bounces: 0, returns: 0, criticals: 0, hits: 0, lightning: 0, splits: 0, fields: 0, orbits: 0, damage: 0 }

  constructor(readonly defs: readonly RewardDef[], readonly stacks: ReadonlyMap<string, number>, readonly rules: TalentRules | undefined, readonly rng: RngLike) {
    for (const def of defs) if (def.talent) this.definitions.set(def.talent.kind, def)
  }
  get owned(): RewardDef[] { return this.defs.filter((r) => r.talent && (this.stacks.get(r.id) ?? 0) > 0) }
  has(kind: TalentKind): boolean { const r = this.definitions.get(kind); return !!r && (this.stacks.get(r.id) ?? 0) > 0 }
  p(kind: TalentKind, key: string): number { return this.has(kind) ? this.definitions.get(kind)!.talent!.params[key] ?? 0 : 0 }
  roll(probability: number): boolean { return probability > 0 && this.rng.next() < probability }
  ready(key: string, now: number, cooldownMs: number): boolean {
    if (now < (this.cooldowns.get(key) ?? -Infinity)) return false
    this.cooldowns.set(key, now + cooldownMs)
    return true
  }
  beginRoom(key: string, now: number): void {
    if (this.roomKey === key && this.inCombat) return
    this.roomKey = key
    this.inCombat = true
    this.roomStarted = now
    this.roomShield = this.movement = 0
    this.attackStarted = this.lastAttack = -Infinity
    this.attacks = this.killStacks = 0
    this.lastKill = -Infinity
  }
  finishRoom(): boolean {
    this.inCombat = false
    this.braveryStacks = Math.min(this.braveryStacks, this.p('bravery', 'retain'))
    this.killStacks = 0
    if (this.roomClaims.has(this.roomKey)) return false
    this.roomClaims.add(this.roomKey)
    return true
  }
  claimed(floor: string): number { return this.floorClaims.get(floor) ?? 0 }
  claim(floor: string): void { this.floorClaims.set(floor, this.claimed(floor) + 1) }
  attack(now: number): number {
    const delay = this.p('charged','delayMs')
    const charged = this.has('charged') && now - this.lastAttack >= delay
    if (now - this.lastAttack >= this.p('ramp', 'resetMs')) this.attackStarted = now
    this.lastAttack = now
    this.attacks++
    return charged ? 1 + this.p('charged','ratio') : 1
  }
  attackCount(): number { return this.attacks }
  skill(now: number): void { this.skillAt = now; this.braveryStacks = Math.min(this.p('bravery',this.inCombat?'maxStacks':'retain'), this.braveryStacks + 1) }
  critical(now: number): void { this.criticalAt = now; this.diagnostics.criticals++ }
  kill(now: number): void { this.lastKill = now; this.killDecayAt = now + this.p('kill_rush','delayMs'); this.killStacks = Math.min(this.p('kill_rush','maxStacks'), this.killStacks + 1) }
  crit(player: TalentPlayerState): { ratio: number; critical: boolean } {
    const chance = Math.min(this.rules?.maxCritChance ?? 0, (this.rules?.baseCritChance ?? 0) + this.p('critical','chance') + this.p('lightning','chance') + (player.hp / player.maxHp < this.p('last_stand','threshold') ? this.p('last_stand','chance') : 0))
    const critical = this.roll(chance)
    return { critical, ratio: critical ? Math.max(this.rules?.baseCritMultiplier ?? 1, this.p('critical','multiplier')) : 1 }
  }
  skillScale(): number { return 1 - Math.min(this.rules?.maxCooldownReduction ?? 0, this.p('cooldown','ratio')) }
  costScale(now: number): number {
    const opening = this.inCombat && now - this.roomStarted < this.p('opening','durationMs')
    const haste = now - this.skillAt < this.p('skill_haste','durationMs')
    return 1 - Math.min(this.rules?.maxCostReduction ?? 0, this.p('efficiency','ratio') + (opening ? this.p('opening','costReduction') : 0) + (haste ? this.p('skill_haste','costReduction') : 0))
  }
  moving(distance: number, now: number): number {
    if (!this.inCombat || !this.has('moving_shield')) return 0
    this.movement += Math.max(0, distance)
    if (this.movement < this.p('moving_shield','distance') || this.roomShield >= this.p('moving_shield','maxPerRoom') || !this.ready('moving_shield',now,this.p('moving_shield','cooldownMs'))) return 0
    this.movement -= this.p('moving_shield','distance')
    this.roomShield += this.p('moving_shield','shield')
    return this.p('moving_shield','shield')
  }
  stats(base: EffectiveStats, player: TalentPlayerState, now: number): EffectiveStats {
    if (!this.rules) return base
    if (now >= this.killDecayAt && now - this.lastKill >= this.p('kill_rush','delayMs')) { this.killStacks = Math.max(0,this.killStacks - 1); this.killDecayAt = now + this.p('kill_rush','decayMs') }
    const opening = this.inCombat && now - this.roomStarted < this.p('opening','durationMs')
    const haste = now - this.skillAt < this.p('skill_haste','durationMs')
    const ramp = now - this.lastAttack < this.p('ramp','resetMs') ? Math.min(this.p('ramp','max'), Math.max(0,now - this.attackStarted) / 1000 * this.p('ramp','perSecond')) : 0
    const bravery = this.inCombat && player.hp / player.maxHp < this.p('bravery','hpThreshold') ? this.p('bravery','maxStacks') : this.braveryStacks
    const full = player.maxShield > 0 && player.shield >= player.maxShield
    const low = player.hp / player.maxHp < this.p('last_stand','threshold')
    const damage = 1 + this.p('glass','damage') + bravery * this.p('bravery','perStack') + (full ? this.p('full_shield','ratio') : 0)
    const rate = 1 + ramp + this.killStacks * this.p('kill_rush','perStack') + (opening ? this.p('opening','rate') : 0) + (haste ? this.p('skill_haste','rate') : 0)
    const move = 1 + this.killStacks * this.p('kill_rush','perStack') + (low ? this.p('last_stand','speed') : 0) + (now - this.criticalAt < this.p('moving_shield','durationMs') ? this.p('moving_shield','speed') : 0)
    return { ...base, damage: base.damage * damage, cooldownMs: base.cooldownMs / Math.min(this.rules.maxRateScale,rate), moveSpeed: base.moveSpeed * move, maxHp: Math.max(1,Math.round(base.maxHp * (1 - this.p('glass','hpReduction')))) }
  }
  weapon(base: WeaponDef): WeaponDef {
    const signature = this.owned.map((r) => r.id).join(',')
    if (signature !== this.cachedSignature) { this.cachedSignature = signature; this.weaponCache.clear() }
    const cached = this.weaponCache.get(base.id)
    if (cached) return cached
    if (!signature) return this.rules ? {...base,talentModified:true} : base
    const traits = (base.traits ?? []).map((trait) => ({ ...trait })) as WeaponTrait[]
    const change = <K extends WeaponTrait['kind']>(kind: K, create: (old: Extract<WeaponTrait,{kind:K}> | undefined) => Extract<WeaponTrait,{kind:K}>): void => {
      const index = traits.findIndex((trait) => trait.kind === kind)
      const next = create(traits[index] as Extract<WeaponTrait,{kind:K}> | undefined)
      if (index >= 0) traits[index] = next
      else traits.push(next)
    }
    if (base.mode === 'projectile') {
      if (this.has('bounce')) change('bounce',(old) => ({kind:'bounce',maxBounces:Math.min(this.p('bounce','max'),(old?.maxBounces ?? 0) + this.p('bounce','extra')),speedRetain:old?.speedRetain ?? 1}))
      if (this.has('pierce')) change('pierce',(old) => ({kind:'pierce',targets:Math.min(this.p('pierce','max'),(old?.targets ?? base.pierceTargets ?? 1) + this.p('pierce','extra'))}))
      if (this.has('homing')) change('homing',(old) => ({kind:'homing',range:Math.max(old?.range ?? 0,this.p('homing','range')),turnRateRadPerSec:Math.max(old?.turnRateRadPerSec ?? 0,this.p('homing','turnRate'))}))
      if (this.has('split')) change('split',(old) => ({kind:'split',count:Math.min(this.rules?.maxChildrenPerAttack ?? 1,(old?.count ?? 0) + this.p('split','count')),damageRatio:Math.max(old?.damageRatio ?? 0,this.p('split','ratio')),spreadDeg:old?.spreadDeg ?? this.p('split','spreadDeg'),maxDepth:1,on:old?.on ?? 'hit',chance:old ? 1 : this.p('split','chance')}))
      if (this.has('return')) change('boomerang',(old) => ({kind:'boomerang',outMs:old?.outMs ?? this.p('return','outMs'),returnSpeedScale:old?.returnSpeedScale ?? this.p('return','speedScale')}))
      if (this.has('splash') && traits.some((trait) => trait.kind === 'splash')) change('splash',(old) => ({kind:'splash',radius:old!.radius * this.p('splash','nativeScale'),damageRatio:old!.damageRatio}))
    }
    const weapon = {...base,traits,talentModified:true,talentSplit:this.has('split')}
    this.weaponCache.set(base.id,weapon)
    return weapon
  }
}
