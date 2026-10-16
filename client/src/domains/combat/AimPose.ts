import { gunMuzzlePosition } from './gunPose'
export type AimSheet = 'up' | 'down'
type Pair = [number, number]
export interface AimArtConfig {
  sources: string[]
  render: { frameWidth: number; frameHeight: number; offset: Pair }
  weaponGrip: Pair
  standWaistY: number
  grips: Record<AimSheet, Pair[]>
  angles: Record<AimSheet, number[]>
  waistY: Record<AimSheet, number[]>
  frameWidth: number
  frameHeight: number
  frameRate: number
  aimOriginOffsetY: number
  bandHysteresisDeg: number
  anchor: Pair
  kickPixels: number
  settlePixels: number
  bands: { maxElevationDeg: number; sheet: AimSheet; frames: number[]; restFrame: number }[]
  muzzles: Record<AimSheet, Pair[]>
}
export function validateAimArt(c: AimArtConfig): void {
  const point = (p: unknown): p is Pair =>
    Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)
  if (
    !c ||
    c.frameWidth !== 71 ||
    c.frameHeight !== 71 ||
    !Number.isFinite(c.frameRate) ||
    c.frameRate <= 0 ||
    !point(c.anchor) ||
    c.anchor.some((v) => v < 0 || v > 1) ||
    ![c.aimOriginOffsetY, c.bandHysteresisDeg, c.kickPixels, c.settlePixels].every(
      (v) => Number.isFinite(v) && v >= 0,
    ) ||
    !Array.isArray(c.bands) ||
    !c.bands.length
  )
    throw new Error('aimArt: 持枪姿态配置无效')
  if (
    !c.render ||
    c.render.frameWidth !== 112 ||
    c.render.frameHeight !== 96 ||
    !point(c.render.offset) ||
    !point(c.weaponGrip) ||
    !Number.isFinite(c.standWaistY)
  )
    throw new Error('aimArt: 合成图集尺寸无效')
  for (const sheet of ['up', 'down'] as const) {
    if (
      !Array.isArray(c.grips?.[sheet]) ||
      c.grips[sheet].length !== 16 ||
      c.grips[sheet].some((p) => !point(p)) ||
      ![c.angles?.[sheet], c.waistY?.[sheet]].every(
        (v) => Array.isArray(v) && v.length === 16 && v.every(Number.isFinite),
      )
    )
      throw new Error('aimArt: 装备图集锚点无效')
    if (
      !Array.isArray(c.muzzles?.[sheet]) ||
      c.muzzles[sheet].length !== 16 ||
      c.muzzles[sheet].some(
        (p) => !point(p) || p[0] < 0 || p[0] > c.frameWidth || p[1] < 0 || p[1] > c.frameHeight,
      )
    )
      throw new Error('aimArt: 枪口坐标无效')
  }
  let previous = -91
  for (const band of c.bands) {
    if (
      !['up', 'down'].includes(band.sheet) ||
      !Number.isFinite(band.maxElevationDeg) ||
      band.maxElevationDeg <= previous ||
      !Array.isArray(band.frames) ||
      !band.frames.length ||
      band.frames.some((f) => !Number.isInteger(f) || f < 0 || f >= 16) ||
      !band.frames.includes(band.restFrame)
    )
      throw new Error('aimArt: 朝向帧范围无效')
    previous = band.maxElevationDeg
  }
  if (previous !== 90) throw new Error('aimArt: 朝向必须覆盖到正上方')
}
/** Each supplied frame is a complete character. Elevation selects authored up/down poses. */
export function aimBand(c: AimArtConfig, dx: number, dy: number, previous = 1): number {
  const elevation = (Math.atan2(-dy, Math.abs(dx)) * 180) / Math.PI
  const last = Math.max(0, Math.min(c.bands.length - 1, previous))
  const low = last === 0 ? -90 : c.bands[last - 1]!.maxElevationDeg
  if (
    elevation >= low - c.bandHysteresisDeg &&
    elevation <= c.bands[last]!.maxElevationDeg + c.bandHysteresisDeg
  )
    return last
  return Math.max(
    0,
    c.bands.findIndex((b) => elevation <= b.maxElevationDeg),
  )
}
export function aimFrame(c: AimArtConfig, band: number, moving: boolean, elapsedMs: number) {
  const poses = c.bands[band] ?? c.bands[1]!
  const phase = Math.floor((Math.max(0, elapsedMs) * c.frameRate) / 1000)
  return {
    sheet: poses.sheet,
    state: moving ? ('run' as const) : ('stand' as const),
    frame: moving ? poses.frames[phase % poses.frames.length]! : poses.restFrame,
  }
}

/** Same rigid weapon transform used by build_equipped_poses.py; no second muzzle approximation. */
export function equippedMuzzle(
  c: AimArtConfig,
  pose: ReturnType<typeof aimFrame>,
  feet: { x: number; y: number },
  scale: number,
  flip: boolean,
  weaponMuzzle?: Pair,
) {
  const { sheet, frame, state } = pose
  const dy = state === 'stand' ? c.standWaistY - c.waistY[sheet][frame]! : 0
  let point = c.muzzles[sheet][frame]!
  if (weaponMuzzle) {
    const grip = c.grips[sheet][frame]!
    const angle = (c.angles[sheet][frame]! * Math.PI) / 180
    const dx = weaponMuzzle[0] - c.weaponGrip[0],
      vy = weaponMuzzle[1] - c.weaponGrip[1]
    point = [
      grip[0] + Math.cos(angle) * dx - Math.sin(angle) * vy,
      grip[1] + Math.sin(angle) * dx + Math.cos(angle) * vy,
    ]
  }
  const [ox, oy] = c.render.offset
  return gunMuzzlePosition(
    feet,
    c.render,
    [
      (c.anchor[0] * c.frameWidth + ox) / c.render.frameWidth,
      (c.anchor[1] * c.frameHeight + oy) / c.render.frameHeight,
    ],
    [point[0] + ox, point[1] + oy + dy],
    scale,
    flip,
  )
}
/** Tiny whole-body kick and downward settling: hands can never detach from the torso. */
export function shotRecoil(
  c: AimArtConfig,
  elapsedMs: number | null,
  durationMs: number,
  flip: boolean,
) {
  if (elapsedMs === null || elapsedMs < 0 || elapsedMs >= durationMs) return { x: 0, y: 0 }
  const phase = elapsedMs / durationMs
  return {
    x: (flip ? 1 : -1) * c.kickPixels * (1 - phase) ** 2,
    y: c.settlePixels * Math.sin(phase * Math.PI),
  }
}
