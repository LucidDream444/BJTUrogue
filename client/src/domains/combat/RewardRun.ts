import type { RngLike } from '@/core/rng'
import type { RewardDef, WeaponId } from './config'
import type { TalentRules } from './TalentRun'

/** Persistent ownership, seeded offers and a frozen pending choice. No UI/Phaser dependency. */
export class RewardRun {
  readonly stacks = new Map<string, number>()
  readonly completedRooms = new Set<string>()
  offered: readonly RewardDef[] = []
  roomId: string | null = null
  rerollsLeft: number
  private context: {roomId:string;weapon:WeaponId;hp:number;maxHp:number;benefit:(reward:RewardDef)=>boolean}|null=null
  constructor(readonly defs: readonly RewardDef[], readonly rng: RngLike, private readonly rules?: TalentRules) { this.rerollsLeft=rules?.rerolls??0 }
  legal(weapon:WeaponId,hp:number,maxHp:number):RewardDef[]{
    const owned=this.defs.filter((r)=>r.talent&&(this.stacks.get(r.id)??0)>0).length
    return this.defs.filter((r)=>(r.maxStacks===0||(this.stacks.get(r.id)??0)<r.maxStacks)&&(!r.talent||owned<(this.rules?.maxOwned??Infinity))&&(!r.weapons.length||r.weapons.includes(weapon))&&r.requires.every((id)=>(this.stacks.get(id)??0)>0)&&!r.excludes.some((id)=>(this.stacks.get(id)??0)>0)&&!this.defs.some((other)=>(this.stacks.get(other.id)??0)>0&&other.excludes.includes(r.id))&&(!r.effects.length||!r.effects.every((e)=>e.stat==='heal')||hp<maxHp))
  }
  private draw(candidates:RewardDef[],avoid:ReadonlySet<string>=new Set()):RewardDef[]{
    const result:RewardDef[]=[]
    const owned=new Set(this.defs.filter((r)=>(this.stacks.get(r.id)??0)>0).map((r)=>r.talent?.kind))
    while(result.length<3&&candidates.length){
      const fresh=candidates.filter((r)=>!avoid.has(r.id))
      let pool=fresh.length?fresh:candidates
      // New pools offer attack and another use whenever both exist; legacy fixtures keep old draws.
      if(this.rules&&result.length===0&&pool.some((r)=>r.category==='firepower'))pool=pool.filter((r)=>r.category==='firepower')
      else if(this.rules&&result.length===1&&pool.some((r)=>r.category!==result[0]!.category))pool=pool.filter((r)=>r.category!==result[0]!.category)
      const weight=(r:RewardDef):number=>r.weight*(r.talent?.synergy.some((kind)=>owned.has(kind))?(this.rules?.synergyWeightScale??1):1)
      let draw=this.rng.next()*pool.reduce((sum,r)=>sum+weight(r),0)
      let chosen=pool[pool.length-1]!
      for(const candidate of pool){draw-=weight(candidate);if(draw<0){chosen=candidate;break}}
      result.push(chosen);candidates.splice(candidates.indexOf(chosen),1)
    }
    return result
  }
  offer(roomId:string,weapon:WeaponId,hp:number,maxHp:number,hasBenefit:(reward:RewardDef)=>boolean=()=>true):readonly RewardDef[]|null{
    if(this.roomId!==null||this.completedRooms.has(roomId))return null
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
  forgetFloor():void{this.completedRooms.clear();this.roomId=null;this.offered=[];this.context=null}
  choose(id:string):RewardDef|null{
    const reward=this.offered.find((r)=>r.id===id)
    if(!reward||this.roomId===null)return null
    this.stacks.set(id,(this.stacks.get(id)??0)+1);this.finish();return reward
  }
  private finish():void{if(this.roomId!==null)this.completedRooms.add(this.roomId);this.roomId=null;this.offered=[];this.context=null}
}
