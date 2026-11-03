import { moveVelocity } from './PlayerModel'

export interface MovementVector { x: number; y: number }

/** 控制惯性只由控制输入推进，外力是本帧输出分量，永不反馈到下帧惯性。 */
export function advancePlayerMovement(
  control: MovementVector,
  input: MovementVector,
  speed: number,
  acceleration: number,
  deceleration: number,
  dtSec: number,
  external: MovementVector,
) {
  const nextControl = moveVelocity(control.x, control.y, input.x, input.y, speed, acceleration, deceleration, dtSec)
  return { control: nextControl, body: { x: nextControl.x + external.x, y: nextControl.y + external.y } }
}

/** 冲刺的主动位移与外力合成后一起扫掠，吸力不能被路径重算抹去或穿过墙。 */
export function advanceDashMovement(
  from: MovementVector,
  displacement: MovementVector,
  external: MovementVector,
  dtSec: number,
  crossesSolid: (from: MovementVector, to: MovementVector) => boolean,
) {
  const dx = displacement.x + external.x * dtSec
  const dy = displacement.y + external.y * dtSec
  const at = (fraction: number) => ({ x: from.x + dx * fraction, y: from.y + dy * fraction })
  const position = at(1)
  if (!crossesSolid(from, position)) return { position, blocked: false }
  let low = 0, high = 1
  // Numerical refinement of the existing swept terrain query, not a balance value.
  for (let i = 0; i < 16; i++) {
    const middle = (low + high) / 2
    if (crossesSolid(from, at(middle))) high = middle
    else low = middle
  }
  return { position: at(low), blocked: true }
}
