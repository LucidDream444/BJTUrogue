import type { Brain, BrainOutput } from '@/core/actor/types'
import type { Stage2BossDef } from '@/core/config'
import type { EnemyModel } from '../model/EnemyModel'
import { desiredDir } from './steering'

/** The spell uses the same logical clock/state transitions as the other enemy brains. */
export function makeRadialBossBrain(
  model: EnemyModel,
  cfg: Stage2BossDef,
  damage = cfg.projectile.damage,
): Brain {
  const out: BrainOutput = { vx: 0, vy: 0 }
  const direction = { x: 0, y: 0 }
  const attack = { kind: 'radial', radius: cfg.projectile.radius, damage }
  let strafeDirection = 1
  let turnAtMs = 0

  return (ctx) => {
    const { self, target, nowMs } = ctx
    out.vx = 0
    out.vy = 0
    out.attack = undefined
    out.nextState = model.state
    if (!self.alive) return out
    if (!target?.alive) {
      out.nextState = 'chase'
      return out
    }
    if (model.state === 'windup') {
      if (model.stateAgeMs(nowMs) >= cfg.windupMs) {
        out.attack = attack
        out.nextState = 'recover'
      }
      return out
    }
    if (model.state === 'recover' && model.stateAgeMs(nowMs) < cfg.recoverMs) return out

    const distance = Math.hypot(target.x - self.x, target.y - self.y)
    const visible = !ctx.nav || ctx.nav.hasLineOfSight(self.x, self.y, target.x, target.y)
    if (distance <= cfg.aggroRadius && visible && nowMs >= model.slamReadyAtMs) {
      model.slamReadyAtMs = nowMs + cfg.cooldownMs
      out.nextState = 'windup'
      return out
    }

    out.nextState = 'chase'
    if (distance > cfg.keepDistance || !visible) {
      desiredDir(self.x, self.y, target.x, target.y, ctx.nav, direction)
      out.vx = direction.x * model.speedNow(nowMs)
      out.vy = direction.y * model.speedNow(nowMs)
    } else {
      if (turnAtMs === 0) turnAtMs = nowMs + cfg.strafeTurnMs
      if (nowMs >= turnAtMs) {
        strafeDirection *= -1
        turnAtMs = nowMs + cfg.strafeTurnMs
      }
      const speed = model.speedNow(nowMs) * cfg.strafeSpeedMult
      // Probe one body diameter ahead and turn before walking into furniture or the room edge.
      const clear = (sign: number): boolean =>
        !ctx.nav || ctx.nav.hasLineOfSight(self.x, self.y, self.x + sign * self.radius * 2, self.y)
      if (!clear(strafeDirection)) {
        strafeDirection *= -1
        turnAtMs = nowMs + cfg.strafeTurnMs
      }
      if (clear(strafeDirection)) out.vx = strafeDirection * speed
    }
    return out
  }
}
