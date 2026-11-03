import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { furnitureArtPlacement } from './CampusArtLayout'
import type { MapRect, SolidRect } from './StageGeometry'

interface DeliveredAsset {
  id: string
  visualBounds?: [number, number, number, number]
}

const delivery = JSON.parse(
  readFileSync(
    new URL('../../../../docs/art/campus_20261023/delivery.json', import.meta.url),
    'utf8',
  ),
) as { assets: DeliveredAsset[] }

/** Read actual PNG bounds, so an art export change exercises the adapter. */
function boundsOf(id: string): MapRect {
  const asset = delivery.assets.find((entry) => entry.id === id)
  if (!asset?.visualBounds) throw new Error(`Missing delivered art bounds: ${id}`)
  const [x, y, right, bottom] = asset.visualBounds
  return { x, y, width: right - x, height: bottom - y }
}

describe('campus furniture artwork follows the existing collision geometry', () => {
  it('places the actual long yellow desk at nonzero world coordinates without its 128px padding', () => {
    const solid: SolidRect = { id: 'desk-12', x: 3240, y: 1480, width: 120, height: 40 }
    const bounds = boundsOf('furniture_classroom_desk_yellow_triple')
    expect(bounds.width).toBe(96)
    const placement = furnitureArtPlacement(solid, bounds)

    // At bottom-center origin the visible image fills the true desk's width.
    expect(placement.x - placement.width / 2).toBe(solid.x)
    expect(placement.x + placement.width / 2).toBe(solid.x + solid.width)
    expect(placement.y).toBe(1520)
    expect(placement.depth).toBe(1520)
    expect(placement.height / placement.width).toBeCloseTo(bounds.height / bounds.width)
    // Fitting the padded 128px canvas would leave most of the desk invisible.
    expect(placement.height).toBeCloseTo(57.5)
  })

  it('keeps actual blue-chair feet on the solid south edge while showing the taller back', () => {
    const solid: SolidRect = { id: 'chair-12', x: 3280, y: 1520, width: 40, height: 40 }
    const bounds = boundsOf('furniture_lecture_chair_blue_folded_back')
    expect(bounds.width).toBe(32)
    const placement = furnitureArtPlacement(solid, bounds)

    expect(placement).toMatchObject({ x: 3300, y: 1560, width: 40, depth: 1560 })
    expect(placement.height).toBeCloseTo(62.5)
    expect(placement.y - placement.height).toBeLessThan(solid.y)
    expect(placement.y - placement.height).toBeGreaterThanOrEqual(solid.y - solid.height * 0.65)
  })

  it.each(['desk-5', 'chair-5'])(
    'limits tall artwork on %s rather than painting across the aisle',
    (id) => {
      const solid: SolidRect = { id, x: 760, y: 920, width: 160, height: 40 }
      const placement = furnitureArtPlacement(solid, { x: 48, y: 59, width: 32, height: 50 })
      expect(placement.height).toBe(66)
      expect(placement.y - placement.height).toBe(894)
      expect(placement.y).toBe(960)
      expect(placement.width).toBe(160)
    },
  )

  it('uses only visible dimensions when a texture crop moves inside its source canvas', () => {
    const solid: SolidRect = { id: 'desk-1', x: 120, y: 240, width: 80, height: 40 }
    const cropped = furnitureArtPlacement(solid, { x: 16, y: 63, width: 96, height: 46 })
    const repacked = furnitureArtPlacement(solid, { x: 400, y: 200, width: 96, height: 46 })
    expect(repacked).toEqual(cropped)
  })

  it('preserves desk/chair contact and does not mutate physics rectangles or art metadata', () => {
    const desk = Object.freeze({ id: 'desk-2', x: 2000, y: 1200, width: 80, height: 40 })
    const chair = Object.freeze({ id: 'chair-2', x: 2040, y: 1240, width: 40, height: 40 })
    const bounds = Object.freeze(boundsOf('furniture_classroom_desk_yellow_double'))
    const before = JSON.stringify({ desk, chair, bounds })
    const deskArt = furnitureArtPlacement(desk, bounds)
    const chairArt = furnitureArtPlacement(
      chair,
      boundsOf('furniture_lecture_chair_blue_down_back'),
    )

    expect(deskArt.y).toBe(chair.y)
    expect(chairArt.depth).toBeGreaterThan(deskArt.depth)
    expect(JSON.stringify({ desk, chair, bounds })).toBe(before)
  })
})
