import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  ASSETS,
  CAMPUS_PIXEL_ART,
  CAMPUS_PIXEL_SPRITES,
  findAsset,
  resolveTextureKey,
} from './assetManifest'

const assetRoot = new URL('../../public/assets/', import.meta.url)

/** Read real exported alpha so a stale trim rectangle cannot silently cut art. */
function pngPixels(path: string): { width: number; height: number; pixels: Buffer } {
  const png = readFileSync(new URL(path, assetRoot))
  expect(png.subarray(1, 4).toString(), path).toBe('PNG')
  expect(png[24], path).toBe(8)
  expect(png[25], path).toBe(6)
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  const chunks: Buffer[] = []
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset)
    if (png.subarray(offset + 4, offset + 8).toString() === 'IDAT')
      chunks.push(png.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
  }
  const filtered = inflateSync(Buffer.concat(chunks))
  const stride = width * 4
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const method = filtered[y * (stride + 1)]!
    expect(method, path).toBeLessThanOrEqual(4)
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x
      const left = x >= 4 ? pixels[index - 4]! : 0
      const above = y > 0 ? pixels[index - stride]! : 0
      const upperLeft = x >= 4 && y > 0 ? pixels[index - stride - 4]! : 0
      const estimate = left + above - upperLeft
      const dl = Math.abs(estimate - left)
      const da = Math.abs(estimate - above)
      const du = Math.abs(estimate - upperLeft)
      const paeth = dl <= da && dl <= du ? left : da <= du ? above : upperLeft
      const prediction = [0, left, above, Math.floor((left + above) / 2), paeth][method]!
      pixels[index] = (filtered[y * (stride + 1) + x + 1]! + prediction) & 255
    }
  }
  return { width, height, pixels }
}

describe('校园实拍像素资源接入', () => {
  it('地图使用的资源登记一次、实图尺寸与清单一致，未把预览整景重复预加载', () => {
    const keys = Object.values(CAMPUS_PIXEL_ART).flatMap((group) => Object.values(group))
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys) {
      const matches = ASSETS.filter((entry) => entry.key === key)
      expect(matches, key).toHaveLength(1)
      const entry = matches[0]!
      expect(entry.placeholder, key).toBe(false)
      expect(entry.kind, key).toBe('image')
      expect(resolveTextureKey(key), key).toBe(key)
      const png = readFileSync(new URL(entry.path, assetRoot))
      expect(png.readUInt32BE(16), key).toBe(entry.width)
      expect(png.readUInt32BE(20), key).toBe(entry.height)
    }
    const registered = ASSETS.filter((entry) => entry.path.includes('/campus_20261023/'))
    expect(registered.map((entry) => entry.key).sort()).toEqual([...keys].sort())
  })

  it('裁切边界精确包住原图不透明像素，避免透明留白令家具与碰撞尺寸失配', () => {
    for (const [key, geometry] of Object.entries(CAMPUS_PIXEL_SPRITES)) {
      const { width, height, pixels } = pngPixels(findAsset(key)!.path)
      expect([width, height], key).toEqual([128, 128])
      let left = width
      let top = height
      let right = 0
      let bottom = 0
      const alphaValues = new Set<number>()
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const alpha = pixels[(y * width + x) * 4 + 3]!
          alphaValues.add(alpha)
          if (!alpha) continue
          left = Math.min(left, x)
          top = Math.min(top, y)
          right = Math.max(right, x + 1)
          bottom = Math.max(bottom, y + 1)
        }
      }
      expect(
        [...alphaValues].sort((a, b) => a - b),
        key,
      ).toEqual([0, 255])
      expect(geometry.bounds, key).toEqual({
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      })
      expect(left, key).toBeGreaterThanOrEqual(16)
      expect(top, key).toBeGreaterThanOrEqual(16)
      expect(right, key).toBeLessThanOrEqual(112)
      expect(bottom, key).toBeLessThanOrEqual(112)
      expect(geometry.anchor.x, key).toBeGreaterThanOrEqual(left)
      expect(geometry.anchor.x, key).toBeLessThanOrEqual(right)
      expect(geometry.anchor.y, key).toBeGreaterThanOrEqual(top)
      expect(geometry.anchor.y, key).toBeLessThanOrEqual(bottom)
    }
  })

  it('墙地砖是完整不透明的 64² 图片，椅子使用朝北的翻板状态', () => {
    for (const key of Object.values(CAMPUS_PIXEL_ART.tiles)) {
      const { width, height, pixels } = pngPixels(findAsset(key)!.path)
      expect([width, height], key).toEqual([64, 64])
      const alphaValues = new Set<number>()
      for (let i = 3; i < pixels.length; i += 4) alphaValues.add(pixels[i]!)
      expect([...alphaValues], key).toEqual([255])
    }
    expect(CAMPUS_PIXEL_ART.furniture.chairDown).toContain('_down_back')
    expect(CAMPUS_PIXEL_ART.furniture.chairFolded).toContain('_folded_back')
  })
})
