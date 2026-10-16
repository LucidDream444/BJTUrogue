import type Phaser from 'phaser'
import type { MapFurniture, StageCollisionConfig } from './StageGeometry'

/** Split the existing art into a floor and independent furniture; no generated replacement art. */
export function prepareFurnitureTextures(
  scene: Phaser.Scene,
  key: string,
  config: StageCollisionConfig,
  furniture: MapFurniture[],
  cacheTag = 'small_furniture_v1',
) {
  const floorKey = `${key}_floor_${cacheTag}`
  const objectKey = (id: string) => `${floorKey}_${id}`
  if (scene.textures.exists(floorKey)) return { floorKey, objectKey }
  const { width, height } = config.sourceSize
  const source = document.createElement('canvas')
  source.width = width
  source.height = height
  const original = scene.textures.get(key).getSourceImage() as HTMLImageElement
  source.getContext('2d')!.drawImage(original, 0, 0, width, height)
  const floor = scene.textures.createCanvas(floorKey, width, height)!
  const ctx = floor.context
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(source, 0, 0)
  for (const f of furniture) {
    const box = f.bounds
    // Include the old cast shadow in the repair, keeping board rows at their original Y.
    const pad = f.repair.margin
    const x0 = Math.max(0, box.x - pad),
      y0 = Math.max(0, box.y - pad)
    const repairWidth = Math.min(width - x0, box.width + pad * 2),
      repairHeight = Math.min(height - y0, box.height + pad * 2)
    const patch = document.createElement('canvas')
    patch.width = repairWidth
    patch.height = repairHeight
    const fill = patch.getContext('2d')!
    for (let x = 0; x < repairWidth; x += f.repair.width) {
      const strip = Math.min(f.repair.width, repairWidth - x)
      fill.drawImage(source, f.repair.x, y0, strip, repairHeight, x, 0, strip, repairHeight)
    }
    if (pad > 0) {
      const pixels = fill.getImageData(0, 0, repairWidth, repairHeight)
      for (let y = 0; y < repairHeight; y++)
        for (let x = 0; x < repairWidth; x++) {
          const alpha = Math.min(1, Math.min(x, y, repairWidth - 1 - x, repairHeight - 1 - y) / 8)
          pixels.data[(y * repairWidth + x) * 4 + 3] = Math.round(255 * alpha)
        }
      fill.putImageData(pixels, 0, 0)
    }
    ctx.drawImage(patch, x0, y0)
    const object = scene.textures.createCanvas(objectKey(f.id), box.width, box.height)!
    const cut = object.context
    cut.imageSmoothingEnabled = false
    cut.save()
    cut.beginPath()
    for (const polygon of f.polygons) {
      polygon.forEach(([x, y], i) =>
        i === 0 ? cut.moveTo(x - box.x, y - box.y) : cut.lineTo(x - box.x, y - box.y),
      )
      cut.closePath()
    }
    cut.clip()
    cut.drawImage(source, -box.x, -box.y)
    cut.restore()
    object.refresh()
  }
  floor.refresh()
  return { floorKey, objectKey }
}
