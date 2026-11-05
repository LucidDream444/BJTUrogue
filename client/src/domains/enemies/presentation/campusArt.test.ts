import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ANIMS,
  ASSETS,
  PAPER_DEATH_ANIMS,
  findAsset,
  resolveTextureKey,
  BOSS_FIRST_ART,
  NAILONG_ART,
  STAGE2_BOSS_ART,
} from '@/core/assetManifest'
import { bossArt, bossDisplayName } from './bossArt'

const assetRoot = new URL('../../../../public/assets/', import.meta.url)

describe('校园敌人资源交付', () => {
  it('所有真实敌人图像存在、带透明通道，图集动画帧没有越界', () => {
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
      expect(width, entry.path).toBeGreaterThan(0)
      expect(height, entry.path).toBeGreaterThan(0)
      if (entry.kind === 'image') continue
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

  it('第二至八层七位首领分别使用真实资源与独立名称', () => {
    const variants = Array.from({ length: 7 }, (_, i) => bossArt(i + 2, i === 6))
    expect(new Set(variants.map((variant) => variant.key)).size).toBe(7)
    expect(variants[0]?.key).toBe(BOSS_FIRST_ART.texture)
    expect(variants[1]?.key).toBe(STAGE2_BOSS_ART.idle)
    expect(variants[5]?.key).toBe(NAILONG_ART.texture)
    expect(variants.every((variant) => variant.tint === 0xffffff)).toBe(true)
    expect(variants.every((variant) => findAsset(variant.key)?.placeholder === false)).toBe(true)
    expect(Array.from({ length: 7 }, (_, i) => bossDisplayName(i + 2))).toEqual([
      '课业重压', '考卷纸鸢', '酸蚀喷灌设备', '失控体育器材', '分身点名册', '奶龙', '心魔',
    ])
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
