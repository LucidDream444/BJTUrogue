import Phaser from 'phaser'
import { allocActorId } from '@/core/actor/ActorModel'
import type { GameClock } from '@/core/time'
import type { EnemyBridge } from './EnemyBridge'
import type { Player } from './Player'
import type { TerrainMap } from './TerrainMap'
import type { RecoveryDrops } from './RecoveryDrops'
import { TalentRun, type TalentAttack, type TalentHit } from './TalentRun'
import type { WeaponTarget } from './WeaponMechanics'

interface Point { x: number; y: number }
interface SpellVisual extends Point { kind: 'bolt' | 'ring' | 'hit'; until: number; born: number; radius: number; color: number; points?: Point[] }
interface Field extends Point { until: number; born: number; nextPull: number; radius: number; damage: number }
interface Orbit { angle: number; until: number; born: number; damage: number; hits: Set<number> }
interface Status { until: number; nextTick: number; tickMs: number; damage: number; slow: number; spread: boolean; inheritedDamage?: number }
export interface TalentCombatDeps {
  scene: Phaser.Scene; clock: GameClock; run: TalentRun; player: Player; enemies: EnemyBridge
  terrain: TerrainMap; drops: RecoveryDrops
  spawn(attack: TalentAttack, options: { angle: number; damage: number; speed: number; lifeMs: number; noProcs?: boolean; color?: number }): void
}

/** Queues proc work out of physics callbacks. Damage, visuals and pool budgets are independent. */
export class TalentCombat {
  private hits: TalentHit[] = []
  private attacks: TalentAttack[] = []
  private kills: { id: number; x: number; y: number }[] = []
  private readonly statuses = new Map<number, Status>()
  private readonly visuals: SpellVisual[] = []
  private readonly fields: Field[] = []
  private readonly orbits: Orbit[] = []
  private readonly graphic: Phaser.GameObjects.Graphics
  private killCount = 0
  private lunchCount = 0
  private waveCount = 0
  private chainCount = 0
  private shieldBreakQueued = false
  private lastFeet: Point
  private lastStep = 0

  constructor(private readonly deps: TalentCombatDeps) {
    this.graphic = deps.scene.add.graphics().setDepth(5004)
    this.lastFeet = {x:deps.player.x,y:deps.player.feetY}
  }
  hit(event: TalentHit): void {
    if (this.hits.length < (this.deps.run.rules?.maxQueuedHits ?? 0)) this.hits.push({...event})
  }
  attack(event: TalentAttack): void { if (this.attacks.length < (this.deps.run.rules?.maxQueuedHits ?? 0)) this.attacks.push({...event}) }
  killed(id: number,x: number,y: number): void { this.kills.push({id,x,y}) }
  beginRoom(key: string): void {
    this.clear()
    const {run,clock,player}=this.deps
    run.beginRoom(key,clock.nowMs)
    this.lastFeet={x:player.x,y:player.feetY}
    this.killCount=this.lunchCount=this.waveCount=0
  }
  finishRoom(): void {
    const {run,player}=this.deps
    if (run.finishRoom()) {
      player.model.restoreFromPickup('health',run.p('room_recovery','heal'))
      player.restoreStamina(run.p('room_recovery','energy'))
      player.model.restoreFromPickup('shield',run.p('opening','shield'))
    }
    this.clear()
  }
  acquired(): void {
    const {run,player}=this.deps
    // Apply one-time healing only when this card is actually selected.
    if (run.has('last_stand') && run.ready('last-stand-acquired',this.deps.clock.nowMs,Infinity)) player.model.hp=Math.min(player.model.maxHp,player.model.hp+run.p('last_stand','heal'))
  }
  skill(aim: Point): void {
    const {run,clock}=this.deps
    run.skill(clock.nowMs)
    if (run.has('lightning') && run.ready('skill-lightning',clock.nowMs,run.p('lightning','skillCooldownMs'))) {
      const target=this.nearest(aim,run.rules!.defaultRange)
      if(target)this.bolt(target,run.p('lightning','damage'))
    }
  }
  shieldBreak(overflow: number): number {
    const {run,clock,player}=this.deps
    if ((!run.has('shield_gate')&&!run.has('shield_battery')) || !run.ready('shield-break',clock.nowMs,Math.max(run.p('shield_gate','cooldownMs'),run.p('shield_battery','cooldownMs')))) return overflow
    this.shieldBreakQueued=true
    if(run.has('shield_gate')) {
      player.model.protectedUntilMs=Math.max(player.model.protectedUntilMs,clock.nowMs+run.p('shield_gate','protectionMs'))
      return 0
    }
    return overflow
  }
  update(): void {
    const {clock,run,player,enemies,terrain}=this.deps
    if(clock.paused||clock.frozen||!player.model.alive||!run.rules)return
    const now=clock.nowMs,elapsed=Math.min(run.rules.blackholeStepMs,Math.max(0,now-this.lastStep))
    this.lastStep=now
    const feet={x:player.x,y:player.feetY}
    const distance=Math.hypot(feet.x-this.lastFeet.x,feet.y-this.lastFeet.y)
    if(player.model.shield<player.model.maxShield&&distance<=player.model.stats.speed*elapsed/1000*2)player.model.restoreFromPickup('shield',run.moving(distance,now))
    this.lastFeet=feet
    const attacks=this.attacks;this.attacks=[]
    for(const event of attacks)this.processAttack(event)
    const hits=this.hits;this.hits=[]
    for(const event of hits)this.processHit(event)
    const kills=this.kills;this.kills=[]
    for(const killed of kills)this.processKill(killed)
    if(this.shieldBreakQueued){
      this.shieldBreakQueued=false
      player.restoreStamina(run.p('shield_battery','energy'))
      this.ring(feet,run.p('shield_battery','radius'),0x8be9ed)
      for(const target of enemies.targets()){
        const d=Math.hypot(target.x-feet.x,target.y-feet.y)
        if(d>0&&d<run.p('shield_battery','radius')&&!terrain.crossesSolid(feet,target))enemies.knockback(target.id,(target.x-feet.x)/d*run.p('shield_battery','strength'),(target.y-feet.y)/d*run.p('shield_battery','strength'),run.p('shield_battery','durationMs'))
      }
    }
    for(const [id,status]of this.statuses){
      const target=enemies.target(id)
      if(!target){if(now>=status.until)this.statuses.delete(id);continue}
      if(now>=status.until){this.statuses.delete(id);continue}
      if(status.damage>0&&now>=status.nextTick){this.damage(id,status.damage);status.nextTick=now+status.tickMs}
    }
    const bosses=new Set(enemies.skills.skillUnits().filter((unit)=>unit.bossStage!==undefined).map((unit)=>unit.id))
    for(let i=this.fields.length-1;i>=0;i--){
      const field=this.fields[i]!
      if(now>=field.until){this.area(field,field.radius,field.damage);this.ring(field,field.radius,0xff91b8);this.fields.splice(i,1);continue}
      if(now<field.nextPull)continue
      field.nextPull=now+run.rules.blackholeStepMs
      for(const target of enemies.targets()){
        const distance=Math.hypot(field.x-target.x,field.y-target.y)
        if(distance>target.radius&&distance<field.radius&&!bosses.has(target.id)&&!terrain.crossesSolid(field,target))enemies.knockback(target.id,(field.x-target.x)/distance*run.p('blackhole','pull'),(field.y-target.y)/distance*run.p('blackhole','pull'),run.rules.blackholeStepMs)
      }
    }
    for(let i=this.orbits.length-1;i>=0;i--){
      const orbit=this.orbits[i]!
      if(now>=orbit.until){this.orbits.splice(i,1);continue}
      const point=this.orbitPoint(orbit,now)
      for(const target of enemies.targets())if(!orbit.hits.has(target.id)&&Math.hypot(target.x-point.x,target.y-point.y)<target.radius+player.model.stats.radius&&!terrain.crossesSolid(feet,point)&&!terrain.crossesSolid(point,target)){
        orbit.hits.add(target.id);this.damage(target.id,orbit.damage);this.ring(target,24,0x9bf0cb)
      }
    }
  }
  private processAttack(event: TalentAttack): void {
    const {run,clock}=this.deps
    if(event.secondary||!run.rules)return
    if(event.weapon.mode==='melee'&&run.has('sword_wave'))this.deps.spawn(event,{angle:event.angle,damage:event.damage*run.p('sword_wave','ratio'),speed:run.p('sword_wave','speed'),lifeMs:run.p('sword_wave','range')/run.p('sword_wave','speed')*1000,color:0x9bf0cb})
    if(run.has('echo')&&run.attackCount()%run.p('echo','every')===0)this.deps.spawn(event,{angle:event.angle,damage:event.damage*run.p('echo','ratio'),speed:run.p('echo','speed'),lifeMs:run.p('echo','range')/run.p('echo','speed')*1000,color:0xffd17b})
    if(run.has('orbit')&&run.attackCount()%run.p('orbit','every')===0&&this.orbits.length<Math.min(run.p('orbit','maxAlive'),run.rules.maxOrbit)){
      this.orbits.push({angle:event.angle,born:clock.nowMs,until:clock.nowMs+run.p('orbit','durationMs'),damage:event.damage*run.p('orbit','ratio'),hits:new Set()});run.diagnostics.orbits++
    }
  }
  private processHit(event: TalentHit): void {
    const {run,clock,enemies,player}=this.deps,now=clock.nowMs
    if(!run.rules)return
    run.diagnostics.hits++
    const point={x:event.x,y:event.y}
    if(event.critical){
      run.critical(now)
      this.ring(point,22,0xffd679)
      if(run.has('lightning')&&run.ready('critical-lightning',now,run.p('lightning','cooldownMs')))this.bolt({...point,id:event.targetId,radius:0},run.p('lightning','damage'))
    }
    if(event.secondary)return
    if(event.weapon.mode==='melee'&&run.has('efficiency')&&run.ready('melee-energy',now,run.p('efficiency','cooldownMs')))player.restoreStamina(run.p('efficiency','energy'))
    const previous=this.statuses.get(event.targetId)
    const originalPoison=event.weapon.status?.kind==='poison'?event.weapon.status:undefined
    const originalSlow=event.weapon.status?.kind==='slow'?event.weapon.status.slowMultiplier:event.weapon.slowMultiplier
    const poisoned=run.has('poison')
    if(poisoned||originalPoison||event.weapon.poisonTickDamage||originalSlow){
      const duration=poisoned?run.p('poison','durationMs'):event.weapon.status?.durationMs??event.weapon.poisonDurationMs??event.weapon.slowDurationMs??0
      this.statuses.set(event.targetId,{until:now+duration,nextTick:previous?.nextTick??now+(poisoned?run.p('poison','tickMs'):originalPoison?.tickMs??event.weapon.poisonTickMs??0),tickMs:poisoned?run.p('poison','tickMs'):originalPoison?.tickMs??event.weapon.poisonTickMs??0,damage:poisoned?run.p('poison','damage'):0,inheritedDamage:originalPoison?.tickDamage??event.weapon.poisonTickDamage??0,slow:originalSlow??1,spread:false})
    }
    if(run.has('ice')){
      const chilled=(previous?.slow??1)<1&&now<(previous?.until??0)||!!originalSlow
      const status=this.statuses.get(event.targetId)??{until:0,nextTick:Infinity,tickMs:0,damage:0,slow:1,spread:false}
      status.until=Math.max(status.until,now+run.p('ice','durationMs'));status.slow=Math.min(status.slow,run.p('ice','slow'));this.statuses.set(event.targetId,status)
      enemies.slow(event.targetId,status.slow,status.until)
      if(chilled&&run.ready('ice',now,run.p('ice','cooldownMs'))){
        for(let i=0;i<run.p('ice','count');i++)this.deps.spawn(event,{angle:event.angle+(i-(run.p('ice','count')-1)/2)*Math.PI/run.p('ice','count'),damage:run.p('ice','damage'),speed:run.rules.secondarySpeed,lifeMs:run.p('ice','range')/run.rules.secondarySpeed*1000,noProcs:true,color:0x9be5ff})
      }
    }
    if(run.has('chain')){
      this.chainCount++
      if(this.chainCount%run.p('chain','every')===0&&run.ready('chain',now,run.p('chain','cooldownMs')))this.bolt({...point,id:event.targetId,radius:0},run.p('chain','damage'))
    }
    if(run.has('splash')&&event.weapon.mode==='projectile'&&!event.weapon.splashRadius&&!event.weapon.traits?.some((trait)=>trait.kind==='splash')&&run.ready('splash',now,run.p('splash','cooldownMs'))){this.area(point,run.p('splash','radius'),event.damage*run.p('splash','ratio'),event.targetId);this.ring(point,run.p('splash','radius'),0xffb77d)}
    if(run.has('blackhole')&&this.fields.length<run.rules.maxFields&&run.ready('blackhole',now,run.p('blackhole','cooldownMs'))){this.fields.push({...point,born:now,until:now+run.p('blackhole','durationMs'),nextPull:now,radius:run.p('blackhole','radius'),damage:run.p('blackhole','damage')});run.diagnostics.fields++}
  }
  private processKill(killed:{id:number;x:number;y:number}):void{
    const {run,player,clock,drops,enemies}=this.deps,now=clock.nowMs
    if(!run.inCombat)return
    run.kill(now);this.killCount++
    if(run.has('lunch_drop')&&this.lunchCount<run.p('lunch_drop','maxPerRoom')&&run.roll(run.p('lunch_drop','chance'))){drops.spawn('health',run.p('lunch_drop','heal'),killed.x,killed.y);this.lunchCount++}
    if(run.has('kill_wave')&&this.killCount%run.p('kill_wave','kills')===0&&this.waveCount<run.p('kill_wave','maxPerRoom')){this.waveCount++;player.restoreStamina(run.p('kill_wave','energy'));this.area({x:player.x,y:player.feetY},run.p('kill_wave','radius'),run.p('kill_wave','damage'));this.ring({x:player.x,y:player.feetY},run.p('kill_wave','radius'),0xffcf88)}
    if(run.has('spread')){
      const previous=this.statuses.get(killed.id)
      if(previous?.spread)return
      const near=enemies.targets().filter((target)=>Math.hypot(target.x-killed.x,target.y-killed.y)<run.p('spread','radius')&&!this.deps.terrain.crossesSolid(killed,target)).sort((a,b)=>Math.hypot(a.x-killed.x,a.y-killed.y)-Math.hypot(b.x-killed.x,b.y-killed.y)).slice(0,run.p('spread','targets'))
      for(const target of near){
        const until=now+run.p('spread','durationMs'),slow=previous?.slow&&previous.slow<1?previous.slow:run.p('spread','slow')
        this.statuses.set(target.id,{until,nextTick:now+(previous?.tickMs||run.p('poison','tickMs')),tickMs:previous?.tickMs||run.p('poison','tickMs'),damage:previous?.damage||previous?.inheritedDamage||0,slow,spread:true});enemies.slow(target.id,slow,until);this.ring(target,24,0xa1d77a)
      }
    }
  }
  private nearest(point:Point,range:number,except=new Set<number>()):WeaponTarget|undefined{
    let nearest:WeaponTarget|undefined,best=range
    for(const target of this.deps.enemies.targets()){
      const distance=Math.hypot(target.x-point.x,target.y-point.y)
      if(distance<best&&!except.has(target.id)&&!this.deps.terrain.crossesSolid(point,target)){nearest=target;best=distance}
    }
    return nearest
  }
  private damage(id:number,amount:number):void{
    if(amount<=0)return
    const result=this.deps.enemies.hit(id,allocActorId(),amount,null)
    this.deps.run.diagnostics.damage+=result.applied
  }
  private area(point:Point,radius:number,amount:number,except?:number):void{
    for(const target of this.deps.enemies.targets())if(target.id!==except&&Math.hypot(target.x-point.x,target.y-point.y)<=radius&&!this.deps.terrain.crossesSolid(point,target))this.damage(target.id,amount)
  }
  private bolt(target:WeaponTarget,damage:number):void{
    const {run,clock}=this.deps
    this.damage(target.id,damage)
    const points:Point[]=[{x:target.x-20,y:target.y-170},{x:target.x,y:target.y}],seen=new Set([target.id])
    let previous:Point=target
    if(run.has('chain'))for(let i=0;i<run.p('chain','targets');i++){
      const next=this.nearest(previous,run.p('chain','radius'),seen)
      if(!next)break
      seen.add(next.id);this.damage(next.id,damage*run.p('chain','ratio'));points.push({x:next.x,y:next.y});previous=next
    }
    this.addVisual({kind:'bolt',x:target.x,y:target.y,born:clock.nowMs,until:clock.nowMs+run.rules!.visualLifeMs,radius:0,color:0xc6a8ff,points})
    run.diagnostics.lightning++
  }
  private ring(point:Point,radius:number,color:number):void{if(radius>0)this.addVisual({kind:'ring',...point,radius,color,born:this.deps.clock.nowMs,until:this.deps.clock.nowMs+(this.deps.run.rules?.visualLifeMs??0)})}
  private addVisual(visual:SpellVisual):void{if(this.visuals.length<(this.deps.run.rules?.maxVisuals??0))this.visuals.push(visual)}
  private orbitPoint(orbit:Orbit,now:number):Point{const {run,player}=this.deps,angle=orbit.angle+(now-orbit.born)/1000*run.p('orbit','speed');return{x:player.x+Math.cos(angle)*run.p('orbit','radius'),y:player.feetY+Math.sin(angle)*run.p('orbit','radius')}}
  draw():void{
    const g=this.graphic,{clock,run}=this.deps,now=clock.nowMs
    g.clear()
    for(let i=this.visuals.length-1;i>=0;i--){
      const visual=this.visuals[i]!,progress=(now-visual.born)/(visual.until-visual.born),fade=1-progress
      if(now>=visual.until){this.visuals.splice(i,1);continue}
      if(visual.kind==='bolt'&&visual.points){
        for(let j=1;j<visual.points.length;j++){
          const from=visual.points[j-1]!,to=visual.points[j]!
          for(const [width,alpha]of [[12,.09],[5,.4],[2,1]]){
            g.lineStyle(width!,visual.color,alpha!*fade).beginPath().moveTo(from.x,from.y)
            for(let k=1;k<=8;k++){const wave=k===8?0:Math.sin(k*17+now/25)*10;g.lineTo(from.x+(to.x-from.x)*k/8+wave,from.y+(to.y-from.y)*k/8-wave)}g.strokePath()
          }
        }
      }else{g.fillStyle(visual.color,.09*fade).fillCircle(visual.x,visual.y,visual.radius*progress);g.lineStyle(3*fade,visual.color,.8*fade).strokeCircle(visual.x,visual.y,visual.radius*(.2+.8*progress))}
    }
    for(const field of this.fields){
      const progress=(now-field.born)/(field.until-field.born)
      g.fillStyle(0xc37aff,.06).fillCircle(field.x,field.y,field.radius)
      g.fillStyle(0x100d24,.9).fillCircle(field.x,field.y,17)
      g.lineStyle(2,0xf3a3ff,.9).strokeCircle(field.x,field.y,23)
      for(let i=0;i<7;i++){const angle=now/350+i*Math.PI*2/7,radius=30+(i*17+(1-progress)*110)%100;g.lineStyle(1.5,0xd39cff,.5).lineBetween(field.x+Math.cos(angle)*radius,field.y+Math.sin(angle)*radius,field.x+Math.cos(angle+.25)*(radius-12),field.y+Math.sin(angle+.25)*(radius-12))}
    }
    for(const orbit of this.orbits){const point=this.orbitPoint(orbit,now);if(this.deps.terrain.crossesSolid({x:this.deps.player.x,y:this.deps.player.feetY},point))continue;g.fillStyle(0xa4f6d0,.1).fillCircle(point.x,point.y,14);g.fillStyle(0xa4f6d0,.9).fillCircle(point.x,point.y,5);g.fillStyle(0xffffff).fillCircle(point.x,point.y,2)}
    if(run.has('moving_shield')&&this.deps.player.model.shield>0){const p=this.deps.player;g.lineStyle(1.5,0x9bedef,.4).strokeCircle(p.x,p.feetY-10,p.model.stats.radius+8)}
  }
  clear():void{this.hits=[];this.attacks=[];this.kills=[];this.fields.length=this.orbits.length=this.visuals.length=0;this.statuses.clear();this.graphic.clear();this.shieldBreakQueued=false;this.lastStep=this.deps.clock.nowMs;this.lastFeet={x:this.deps.player.x,y:this.deps.player.feetY}}
  destroy():void{this.clear();this.graphic.destroy()}
}
