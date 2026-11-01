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
