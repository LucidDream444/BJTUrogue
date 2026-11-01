import type { Brain, BrainOutput } from '@/core/actor/types'
import type { NightmareCatDef } from '@/core/config'
import type { EnemyModel } from '../model/EnemyModel'
import { scratchIntent, steer } from './steering'

export function makeVortexCatBrain(model: EnemyModel, cfg: NightmareCatDef): Brain {
  const out: BrainOutput = { vx: 0, vy: 0 }
  return (ctx) => {
    const { nowMs, self, target } = ctx
    const vortex = cfg.vortex
    out.vx = out.vy = 0
    out.attack = undefined
    out.nextState = model.state
    if (!self.alive) return out
    if (model.state === 'spin') {
      if (model.stateAgeMs(nowMs) >= vortex.durationMs) {
        model.attackReadyAtMs = nowMs + vortex.cooldownMs
        out.nextState = 'recover'
      }
      return out
    }
    if (model.state === 'windup') {
      if (model.stateAgeMs(nowMs) >= vortex.windupMs) {
        model.spinX = self.x
        model.spinY = self.y
        out.nextState = 'spin'
      }
      return out
    }
    if (model.state === 'recover' && model.stateAgeMs(nowMs) < vortex.recoverMs) return out
    const cooling = nowMs < model.attackReadyAtMs
    if (!cooling && target?.alive && Math.hypot(target.x - self.x, target.y - self.y) <= vortex.range) {
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
