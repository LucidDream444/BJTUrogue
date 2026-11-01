/** C1场快照与双方共享的纯数学；不依赖Phaser或任何设计域。 */
export interface VortexSnapshot {
  readonly fieldId: number
  readonly sourceId: number
  readonly ownerId: number
  readonly x: number
  readonly y: number
  readonly startedAtMs: number
  readonly endsAtMs: number
  readonly damageRadius: number
  readonly pullRadius: number
  readonly pullSpeed: number
  readonly maxPullSpeed: number
  readonly projectileRadius: number
  readonly turnRateRadPerSec: number
  readonly maxTurnRateRadPerSec: number
  readonly rotationSign: 1 | -1
}

export type VortexFieldSnapshot = VortexSnapshot
export interface FieldVector { x: number; y: number }

/** 靠近圆心的拉力较强；合成后限幅，不把控制速度也钳到吸力上限。 */
export function vortexPullVelocity(
  point: FieldVector,
  fields: readonly VortexSnapshot[],
): FieldVector {
  let x = 0, y = 0, ceiling = 0
  for (const field of [...fields].sort((a, b) => a.fieldId - b.fieldId)) {
    const dx = field.x - point.x, dy = field.y - point.y
    const distance = Math.hypot(dx, dy)
    if (distance <= Number.EPSILON || distance >= field.pullRadius) continue
    const speed = field.pullSpeed * (1 - distance / field.pullRadius)
    x += dx / distance * speed
    y += dy / distance * speed
    ceiling = Math.max(ceiling, field.maxPullSpeed)
  }
  const magnitude = Math.hypot(x, y)
  if (magnitude > ceiling && magnitude > 0) {
    x *= ceiling / magnitude
    y *= ceiling / magnitude
  }
  return { x, y }
}

/** 偏向局部旋转切线，只改变方向；先稳定排序，最后限制总转角。 */
export function deflectVortexVelocity(
  point: FieldVector,
  velocity: FieldVector,
  fields: readonly VortexSnapshot[],
  dtSec: number,
): FieldVector {
  const speed = Math.hypot(velocity.x, velocity.y)
  if (speed <= Number.EPSILON || !Number.isFinite(dtSec) || dtSec <= 0)
    return { ...velocity }
  const initialAngle = Math.atan2(velocity.y, velocity.x)
  let angle = initialAngle, totalLimit = 0
  for (const field of [...fields].sort((a, b) => a.fieldId - b.fieldId)) {
    const dx = point.x - field.x, dy = point.y - field.y
    const distance = Math.hypot(dx, dy)
    if (distance <= Number.EPSILON || distance >= field.projectileRadius) continue
    const tangent = Math.atan2(dy, dx) + field.rotationSign * Math.PI / 2
    const difference = Math.atan2(Math.sin(tangent - angle), Math.cos(tangent - angle))
    const turnLimit = field.turnRateRadPerSec * dtSec
    angle += Math.max(-turnLimit, Math.min(turnLimit, difference))
    totalLimit = Math.max(totalLimit, field.maxTurnRateRadPerSec * dtSec)
  }
  const turn = Math.max(-totalLimit, Math.min(totalLimit, angle - initialAngle))
  return { x: Math.cos(initialAngle + turn) * speed, y: Math.sin(initialAngle + turn) * speed }
}
