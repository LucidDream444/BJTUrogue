import {describe,expect,it}from 'vitest'
import {GameClock}from '@/core/time'
import {PlayerModel}from './PlayerModel'
import {GoosePerformance,type PerformanceConfig}from './GoosePerformance'

describe('talent defense and skill compatibility',()=>{
 it('blocks only the overflow of the hit which actually breaks a shield',()=>{
  const clock=new GameClock(),player=new PlayerModel({maxHp:50,speed:200,radius:12},clock,100,5)
  player.iframeMs=100
  let breaks=0
  player.onShieldBreak=()=>{breaks++;player.protectedUntilMs=clock.nowMs+400;return 0}
  const hit=(amount:number,key:string)=>player.takeHit({sourceId:99,hitKey:key,mode:'instant',sourceKind:'bullet',amount,frameId:clock.frameId,nowMs:clock.nowMs})
  expect(hit(20,'first').applied).toBe(0)
  expect(player.hp).toBe(50);expect(player.shield).toBe(0);expect(breaks).toBe(1)
  clock.advance(200)
  expect(hit(20,'protected').applied).toBe(0)
  clock.advance(250)
  expect(hit(20,'no-shield').applied).toBe(20)
  expect(player.hp).toBe(30);expect(breaks).toBe(1)
 })
 it('does not block environmental liquid drain or invoke the shield talent for it',()=>{
  const clock=new GameClock(),player=new PlayerModel({maxHp:50,speed:200,radius:12},clock,100,5)
  let breaks=0;player.onShieldBreak=()=>{breaks++;return 0}
  player.takeLiquidDrain(3,99,0,0)
  expect(player.hp).toBe(47);expect(player.shield).toBe(5);expect(breaks).toBe(0)
 })
 it('shortens performer song cooldown without resetting beats or buff stacks',()=>{
  const config:PerformanceConfig={beatPeriodMs:1000,beatHitWindowMs:200,songCooldownMs:200,maxStacks:5,stackDurationMs:4000,redDamage:10,redDamagePerStackPct:20,redRadius:260,damageBonusPctPerStack:6,moveSpeedPctPerStack:4,shieldPerStack:5,blueShieldRestore:2}
  const performance=new GoosePerformance(config)
  performance.start(0);performance.press('red',900)
  expect(performance.snapshot(900).redStacks).toBe(1)
  performance.setCooldownScale(.8,900)
  expect(performance.canPress('red',1059)).toBe(false)
  expect(performance.canPress('red',1060)).toBe(true)
  expect(performance.snapshot(1060).redStacks).toBe(1)
 })
})
