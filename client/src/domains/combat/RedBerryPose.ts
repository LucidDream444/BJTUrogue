import { PUBLIC_WEAPON_ART, RED_BERRY_ART } from '@/core/assetManifest'

export type RedBerryAction = keyof typeof RED_BERRY_ART.states
export type RedBerryWeapon = keyof typeof PUBLIC_WEAPON_ART
export interface BerryPoint { x: number; y: number }

export interface RedBerryPoseInput {
  feet: BerryPoint
  aim: BerryPoint
  scale: number
  weapon: RedBerryWeapon
  moving: boolean
  runElapsedMs: number
  attackElapsedMs: number | null
  attackDurationMs: number
  previousAngle?: number
}

/** Frame progression uses the same logical elapsed time as the body and gun pose. */
export function redBerryFrame(action: RedBerryAction, elapsedMs: number, durationMs?: number): number {
  const state = RED_BERRY_ART.states[action]
  const elapsed = Math.max(0, elapsedMs)
  const index = Math.floor(elapsed *
    (durationMs && !state.loop ? state.count / durationMs : state.frameRate / 1000))
  return state.start + (state.loop ? index % state.count : Math.min(state.count - 1, index))
}

/** Only presentation leaves the floor. No physical position or collision geometry is changed. */
export function redBerryPose(input: RedBerryPoseInput) {
  const art = RED_BERRY_ART
  const weapon = PUBLIC_WEAPON_ART[input.weapon]
  const cycleMs = art.states.run.count * 1000 / art.states.run.frameRate
  const phase = Math.max(0, input.runElapsedMs) % cycleMs / cycleMs
  const lift = input.moving ? Math.sin(phase * Math.PI) * art.hopHeight * input.scale : 0
  const body = { x: input.feet.x, y: input.feet.y - lift }
  const center = {
    x: body.x + (art.center[0] - art.foot[0]) * input.scale,
    y: body.y + (art.center[1] - art.foot[1]) * input.scale,
  }
  const dx = input.aim.x - center.x, dy = input.aim.y - center.y
  const angle = dx === 0 && dy === 0 ? input.previousAngle ?? 0 : Math.atan2(dy, dx)
  const elapsed = input.attackElapsedMs
  const recoil = elapsed === null || input.attackDurationMs <= 0 ? 0 :
    Math.sin(Math.PI * Math.max(0, Math.min(1, elapsed / input.attackDurationMs))) *
    art.recoilDistance * input.scale
  const socketDistance = art.socketRadius * input.scale - recoil
  const grip = {
    x: center.x + Math.cos(angle) * socketDistance,
    y: center.y + Math.sin(angle) * socketDistance,
  }
  const gunScale = input.scale * weapon.visualScale
  const flipY = Math.cos(angle) < 0
  const localX = (weapon.muzzle[0] - weapon.grip[0]) * gunScale
  const localY = (weapon.muzzle[1] - weapon.grip[1]) * gunScale * (flipY ? -1 : 1)
  const rotation = angle - Math.atan2(localY, localX)
  const muzzle = {
    x: grip.x + Math.cos(rotation) * localX - Math.sin(rotation) * localY,
    y: grip.y + Math.sin(rotation) * localX + Math.cos(rotation) * localY,
  }
  return { feet: { ...input.feet }, body, center, lift, grip, muzzle, angle, rotation, flipY,
    gunScale, gunBehind: Math.sin(angle) < 0 }
}

export type RedBerryPose = ReturnType<typeof redBerryPose>
