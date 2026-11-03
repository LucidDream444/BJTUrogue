import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ANIMS,
  ASSETS,
  PAPER_DEATH_ANIMS,
  findAsset,
  resolveTextureKey,
  BOSS_FIRST_ART,
} from '@/core/assetManifest'
import { bossArt } from './bossArt'

const assetRoot = new URL('../../../../public/assets/', import.meta.url)

describe('校园敌人资源交付', () => {
  it('所有真实敌人图集存在、带透明通道，清单中的动画帧没有越界', () => {
    const sheets = ASSETS.filter(
      (entry) => entry.path.startsWith('sprites/enemies/') && !entry.placeholder,
    )
    expect(sheets.length).toBeGreaterThan(0)
    for (const entry of sheets) {
      const png = readFileSync(new URL(entry.path, assetRoot))
      expect(png.subarray(1, 4).toString(), entry.path).toBe('PNG')
      expect(png[25], entry.path).toBe(6) // PNG RGBA
      const width = png.readUInt32BE(16)
      const height = png.readUInt32BE(20)
      expect(width % entry.frameWidth!, entry.path).toBe(0)
      expect(height % entry.frameHeight!, entry.path).toBe(0)
      const count = (width / entry.frameWidth!) * (height / entry.frameHeight!)
      for (const anim of ANIMS.filter((item) => item.textureKey === entry.key)) {
        expect(
          anim.frames.every((frame) => frame >= 0 && frame < count),
          anim.animKey,
        ).toBe(true)
      }
    }
    expect(PAPER_DEATH_ANIMS).toHaveLength(3)
  })

  it('首领身份独立并使用真实资源，第一首领不再借用最终毒场槽位', () => {
    const variants = [bossArt(1, false), bossArt(2, false), bossArt(3, true)]
    expect(new Set(variants.map((variant) => variant.key)).size).toBe(3)
    expect(variants[0]?.key).toBe(BOSS_FIRST_ART.texture)
    expect(variants.map((variant) => variant.tint)).toEqual([0xffffff, 0xffffff, 0xffffff])
    const delivered = ASSETS.filter((entry) =>
      /sprites\/enemies\/(stage2_boss|final_boss)\//.test(entry.path),
    )
    expect(delivered).toHaveLength(6)
    for (const entry of delivered) {
      expect(findAsset(entry.key)?.placeholder).toBe(false)
      expect(resolveTextureKey(entry.key)).toBe(entry.key)
      const png = readFileSync(new URL(entry.path, assetRoot))
      expect(png.readUInt32BE(16)).toBe(entry.frameWidth! * 4)
      expect(png.readUInt32BE(20)).toBe(entry.frameHeight! * 4)
    }
  })
})
