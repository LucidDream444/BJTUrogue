import type { Brain, BrainOutput } from '@/core/actor/types'
import type { MuscovyDef } from '@/core/config'
import type { EnemyModel } from '../model/EnemyModel'
import { scratchIntent, steer } from './steering'

/** End/cancel starts the full cooldown; recovery is part of that cooldown. */
export function finishMuscovyAttack(model: EnemyModel, cfg: MuscovyDef['charge'], nowMs: number): void {
  model.attackReadyAtMs = nowMs + cfg.cooldownMs
  model.setState('recover', nowMs)
  model.velIntent.x = model.velIntent.y = 0
}

/** The system measures real body travel and obstacle hits; the brain never integrates positions. */
export function makeMuscovyBrain(model: EnemyModel, cfg: MuscovyDef): Brain {
  const out: BrainOutput = { vx: 0, vy: 0 }
  return (ctx) => {
    const { nowMs, self, target } = ctx
    out.vx = out.vy = 0
    out.attack = undefined
    out.nextState = model.state
    if (!self.alive) return out
    const charge = cfg.charge
    if (model.state === 'dash') {
      if (model.dashTravelled >= charge.dashDistance) {
        model.attackReadyAtMs = nowMs + charge.cooldownMs
        out.nextState = 'recover'
      } else {
        out.vx = model.lockedDirX * charge.dashSpeed
        out.vy = model.lockedDirY * charge.dashSpeed
      }
      return out
    }
    if (model.state === 'windup') {
      if (model.stateAgeMs(nowMs) >= charge.windupMs) {
        model.dashTravelled = 0
        model.dashLastX = self.x
        model.dashLastY = self.y
        out.nextState = 'dash'
        out.vx = model.lockedDirX * charge.dashSpeed
        out.vy = model.lockedDirY * charge.dashSpeed
      }
      return out
    }
    if (model.state === 'recover' && model.stateAgeMs(nowMs) < charge.recoverMs) return out
    const cooling = nowMs < model.attackReadyAtMs
    const distance = target ? Math.hypot(target.x - self.x, target.y - self.y) : Infinity
    const visible = !ctx.nav || !target || ctx.nav.hasLineOfSight(self.x, self.y, target.x, target.y)
    if (!cooling && target?.alive && distance <= charge.range && visible) {
      if (distance > 0) {
        model.lockedDirX = (target.x - self.x) / distance
        model.lockedDirY = (target.y - self.y) / distance
      }
      out.nextState = 'windup'
      return out
    }
    const velocity = steer(self, target, ctx, model.speedNow(nowMs), cfg.ai.separationPad, cfg.ai.separationStrength, scratchIntent)
    out.vx = velocity.x
    out.vy = velocity.y
    out.nextState = cooling ? 'cooldown' : 'chase'
    return out
  }
}
