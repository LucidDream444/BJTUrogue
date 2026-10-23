import { GOOSE_ART } from '@/core/assetManifest'

export type GooseDirection = keyof typeof GOOSE_ART.directions
export type GooseAction = keyof typeof GOOSE_ART.states
export interface Point { x: number; y: number }

/** 躯干跟移动走，停止时保留四向朝向；鼠标独立控制脖子。 */
export function gooseDirection(dx: number, dy: number, previous: GooseDirection): GooseDirection {
  if (dx === 0 && dy === 0) return previous
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right'
  return dy < 0 ? 'up' : 'down'
}

export function gooseFrame(action: GooseAction, elapsedMs: number, durationMs?: number): number {
  const a = GOOSE_ART.states[action]
  const step = Math.floor(Math.max(0, elapsedMs) *
    (durationMs && !a.loop ? a.count / durationMs : a.frameRate / 1000))
  return a.start + (a.loop ? step % a.count : Math.min(a.count - 1, step))
}

/** 同一个变换同时喂给脖子、嘴巴插槽、枪图与子弹，360° 无朝向夹取。 */
export function goosePose(feet: Point, direction: GooseDirection, scale: number, aim: Point) {
  const d = GOOSE_ART.directions[direction]
  const neck = GOOSE_ART.neck
  const pivot = {
    x: feet.x + (d.socket[0] - GOOSE_ART.foot[0]) * scale,
    y: feet.y + (d.socket[1] - GOOSE_ART.foot[1]) * scale,
  }
  const localX = (neck.mouth[0] - neck.pivot[0]) * scale
  const localY = (neck.mouth[1] - neck.pivot[1]) * scale
  const dx = aim.x - pivot.x, dy = aim.y - pivot.y
  const distance = Math.hypot(dx, dy)
  // 补偿嘴相对颈根的垂直偏移；当前直颈共线时偏移为零，枪管直接指向鼠标。
  // 鼠标贴近颈根时可能无解；夹取正弦值，避免除零或反三角函数越界。
  const angle = Math.atan2(dy, dx) - Math.asin(Math.max(-1, Math.min(1,
    localY / Math.max(distance, Number.EPSILON))))
  const rotation = angle - neck.axis
  const mouth = {
    x: pivot.x + Math.cos(rotation) * localX - Math.sin(rotation) * localY,
    y: pivot.y + Math.sin(rotation) * localX + Math.cos(rotation) * localY,
  }
  const barrel = (GOOSE_ART.muzzle[0] - GOOSE_ART.grip[0]) * scale
  const muzzle = {
    x: mouth.x + Math.cos(angle) * barrel,
    y: mouth.y + Math.sin(angle) * barrel,
  }
  return { pivot, angle, rotation, mouth, muzzle }
}
