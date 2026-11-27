import type { RngLike } from '@/core/rng'
import type { RewardDef, WeaponId } from './config'
import type { TalentRules } from './TalentRun'

/** Persistent ownership, seeded offers and a frozen pending choice. No UI/Phaser dependency. */
export class RewardRun {
  private linkedThisFloor = false
  private floorPicksLeft = Infinity

  private linked(a: RewardDef, b: RewardDef): boolean {
    return !!(a.talent && b.talent && (a.talent.synergy.includes(b.talent.kind) || b.talent.synergy.includes(a.talent.kind)))
  }
  readonly stacks = new Map<string, number>()
  readonly completedRooms = new Set<string>()
  offered: readonly RewardDef[] = []
  roomId: string | null = null
  rerollsLeft: number
  private context: {roomId:string;weapon:WeaponId;hp:number;maxHp:number;benefit:(reward:RewardDef)=>boolean}|null=null
  constructor(readonly defs: readonly RewardDef[], readonly rng: RngLike, private readonly rules?: TalentRules) { this.rerollsLeft=rules?.rerolls??0 }
  /** Production uses `talents.offerCount`; legacy fixtures without rules keep the old 3-card shape. */
  private get offerCount(): number { return Math.max(2, Math.min(5, this.rules?.offerCount ?? 3)) }
  legal(weapon:WeaponId,hp:number,maxHp:number):RewardDef[]{
    const owned=this.defs.filter((r)=>r.talent&&(this.stacks.get(r.id)??0)>0).length
    return this.defs.filter((r)=>(r.maxStacks===0||(this.stacks.get(r.id)??0)<r.maxStacks)&&(!r.talent||owned<(this.rules?.maxOwned??Infinity))&&(!r.weapons.length||r.weapons.includes(weapon))&&r.requires.every((id)=>(this.stacks.get(id)??0)>0)&&!r.excludes.some((id)=>(this.stacks.get(id)??0)>0)&&!this.defs.some((other)=>(this.stacks.get(other.id)??0)>0&&other.excludes.includes(r.id))&&(!r.effects.length||!r.effects.every((e)=>e.stat==='heal')||hp<maxHp))
  }
  private draw(candidates:RewardDef[],avoid:ReadonlySet<string>=new Set()):RewardDef[]{
    const result:RewardDef[]=[]
    const owned = this.defs.filter((r) => this.stacks.has(r.id))
    const available = [...candidates]
    while (result.length < this.offerCount && candidates.length) {
      const fresh = candidates.filter((r) => !avoid.has(r.id))
      const pool = fresh.length ? fresh : candidates
      const weight = (r: RewardDef) => this.rules && r.talent ? 1 : r.weight
      let draw = this.rng.next() * pool.reduce((sum, r) => sum + weight(r), 0)
      const chosen = pool.find((r) => (draw -= weight(r)) < 0) ?? pool[pool.length - 1]!
      result.push(chosen)
      candidates.splice(candidates.indexOf(chosen), 1)
    }
    if (!this.linkedThisFloor && this.floorPicksLeft <= 2 && result.length) {
      const completes = (r: RewardDef) => owned.some((other) => this.linked(r, other))
      let options = available.filter(completes)
      // If none of the owned cards has a legal partner, the penultimate pick can start a pair.
      if (!options.length && this.floorPicksLeft === 2) {
        options = available.filter((r) => available.some((other) => r !== other && this.linked(r, other)))
      }
      if (options.length && !result.some((r) => options.includes(r))) {
        const fresh = options.filter((r) => !avoid.has(r.id))
        const pool = fresh.length ? fresh : options
        result[this.rng.between(0, result.length - 1)] = pool[this.rng.between(0, pool.length - 1)]!
      }
    }
    return result
  }
  offer(roomId:string,weapon:WeaponId,hp:number,maxHp:number,hasBenefit:(reward:RewardDef)=>boolean=()=>true, floorPicksLeft=Infinity):readonly RewardDef[]|null{
    if(this.roomId!==null||this.completedRooms.has(roomId))return null
    this.floorPicksLeft = floorPicksLeft
    this.roomId=roomId
    this.context={roomId,weapon,hp,maxHp,benefit:hasBenefit}
    this.offered=this.draw(this.legal(weapon,hp,maxHp).filter(hasBenefit))
    if(!this.offered.length)this.finish()
    return this.offered
  }
  reroll():readonly RewardDef[]|null{
    if(!this.context||this.roomId===null||this.rerollsLeft<=0)return null
    const {weapon,hp,maxHp,benefit}=this.context
    const candidates=this.legal(weapon,hp,maxHp).filter(benefit)
    const previous=new Set(this.offered.map((r)=>r.id))
    if(!candidates.some((r)=>!previous.has(r.id)))return null
    this.offered=this.draw(candidates,previous);this.rerollsLeft--
    return this.offered
  }
  /** Only floor-local offers are forgotten. Owned talents/rerolls survive every floor change. */
  forgetFloor():void{this.linkedThisFloor=false;this.completedRooms.clear();this.roomId=null;this.offered=[];this.context=null}
  choose(id:string):RewardDef|null{
    const reward=this.offered.find((r)=>r.id===id)
    if(!reward||this.roomId===null)return null
    if (Number.isFinite(this.floorPicksLeft) && this.defs.some((r) => this.stacks.has(r.id) && this.linked(reward, r))) this.linkedThisFloor = true
    this.stacks.set(id,(this.stacks.get(id)??0)+1);this.finish();return reward
  }
  private finish():void{if(this.roomId!==null)this.completedRooms.add(this.roomId);this.roomId=null;this.offered=[];this.context=null}
}
