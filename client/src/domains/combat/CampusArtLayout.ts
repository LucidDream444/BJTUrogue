import type { MapRect, SolidRect } from './StageGeometry'

/**
 * Cropped furniture artwork uses a bottom-center image origin.
 * These are drawing coordinates only; the source solid stays unchanged.
 */
export interface FurnitureArtPlacement {
  x: number
  y: number
  width: number
  height: number
  depth: number
}

/**
 * Keep furniture feet and width aligned with the real collision rectangle.
 *
 * `bounds` describes the visible source pixels after transparent margins are
 * cropped. Its offset is handled by the texture frame, not the world position.
 * The modest northward allowance shows a chair's tall back without making it
 * cover an entire aisle. The ratio is a visual limit, not a collision change.
 */
export function furnitureArtPlacement(solid: SolidRect, bounds: MapRect): FurnitureArtPlacement {
  const bottom = solid.y + solid.height
  return {
    x: solid.x + solid.width / 2,
    y: bottom,
    width: solid.width,
    height: Math.min((solid.width * bounds.height) / bounds.width, solid.height * 1.65),
    depth: bottom,
  }
}
