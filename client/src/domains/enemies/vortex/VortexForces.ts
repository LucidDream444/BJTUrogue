import { vortexPullVelocity, type FieldVector, type VortexSnapshot } from '@/core/vortex'

/** 外力不取决于 AI 状态或主动速度；同一只猫仅免疫自己释放的场。 */
export function enemyVortexPull(
  unitId: number,
  point: FieldVector,
  fields: readonly VortexSnapshot[],
): FieldVector {
  return vortexPullVelocity(point, fields.filter((field) => field.ownerId !== unitId))
}
