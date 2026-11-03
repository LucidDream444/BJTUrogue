import type { Brain, BrainAttack, BrainOutput } from '@/core/actor/types'
import type { SprayerDef } from '@/core/config'
import type { EnemyModel } from '../model/EnemyModel'
import { steer, scratchIntent } from './steering'

export interface SprayAttack extends BrainAttack {
  x: number
  y: number
}

export function makeSprayerBrain(model: EnemyModel, cfg: SprayerDef): Brain {
  const out: BrainOutput = { vx: 0, vy: 0 }
  return (ctx) => {
    out.attack = undefined
    out.vx = out.vy = 0
    out.nextState = 'chase'
    const { target, self, nowMs } = ctx
    if (!self.alive || !target?.alive) return out
    if (model.state === 'windup') {
      if (model.stateAgeMs(nowMs) < cfg.spray.windupMs) out.nextState = 'windup'
      else {
        const attack: SprayAttack = {
          kind: 'spray',
          x: model.sprayX,
          y: model.sprayY,
          radius: cfg.spray.puddleRadius,
          damage: 0,
        }
        out.attack = attack
        out.nextState = 'recover'
      }
      return out
    }
    if (model.state === 'recover' && model.stateAgeMs(nowMs) < cfg.spray.recoverMs) {
      out.nextState = 'recover'
      return out
    }
    const distance = Math.hypot(target.x - self.x, target.y - self.y)
    const visible = !ctx.nav || ctx.nav.hasLineOfSight(self.x, self.y, target.x, target.y)
    if (distance <= cfg.spray.range && visible && nowMs >= model.slamReadyAtMs) {
      model.sprayX = target.x
      model.sprayY = target.y
      model.slamReadyAtMs = nowMs + cfg.spray.cooldownMs
      out.nextState = 'windup'
      return out
    }
    if (distance > cfg.spray.keepDistance || !visible) {
      const v = steer(
        self,
        target,
        ctx,
        model.speedNow(nowMs),
        cfg.ai.separationPad,
        cfg.ai.separationStrength,
        scratchIntent,
      )
      out.vx = v.x
      out.vy = v.y
    }
    return out
  }
}
