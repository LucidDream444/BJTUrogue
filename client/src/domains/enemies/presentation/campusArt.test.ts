import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ANIMS,
  ASSETS,
  PAPER_DEATH_ANIMS,
  findAsset,
  resolveTextureKey,
  BOSS_ROSTER_ART,
  NAILONG_ART,
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

  it('七位常规首领与最终奶龙分别使用真实资源与独立名称', () => {
    const variants = Array.from({ length: 8 }, (_, i) => bossArt(i + 2))
    expect(new Set(variants.map((variant) => variant.key)).size).toBe(8)
    for (const profile of [2, 3, 4, 5, 6, 7, 8]) {
      expect(variants[profile - 2]?.key, String(profile)).toBe(BOSS_ROSTER_ART[profile]!.idle)
      expect(findAsset(variants[profile - 2]!.key)?.placeholder).toBe(false)
    }
    expect(variants[7]?.key).toBe(NAILONG_ART.texture)
    expect(variants.every((variant) => variant.tint === 0xffffff)).toBe(true)
    expect(Array.from({ length: 8 }, (_, i) => bossDisplayName(i + 2))).toEqual([
      '课业重压', '考卷纸鸢', '酸蚀喷灌设备', '失控体育器材', '分身点名册', '香蕉猫', '肥嘟嘟', '奶龙',
    ])
    const delivered = ASSETS.filter((entry) => entry.path.startsWith('sprites/enemies/bosses/'))
    expect(delivered.length).toBeGreaterThanOrEqual(14)
    for (const entry of delivered) {
      expect(findAsset(entry.key)?.placeholder).toBe(false)
      expect(resolveTextureKey(entry.key)).toBe(entry.key)
      const png = readFileSync(new URL(entry.path, assetRoot))
      expect(png.readUInt32BE(16) % entry.frameWidth!).toBe(0)
      expect(png.readUInt32BE(20)).toBe(entry.frameHeight!)
    }
  })
})
