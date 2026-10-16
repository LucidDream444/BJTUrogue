import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ANIMS,
  ASSETS,
  PAPER_DEATH_ANIMS,
  findAsset,
  resolveTextureKey,
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

  it('首领身份与攻击资源 key 保留，占位不再要求旧图片存在', () => {
    const variants = [bossArt(1, false), bossArt(2, false), bossArt(3, true)]
    expect(new Set(variants.map((variant) => variant.key)).size).toBe(3)
    expect(variants.map((variant) => variant.tint)).toEqual([0xffffff, 0x4da6ff, 0xa855f7])
    const retired = ASSETS.filter((entry) =>
      /sprites\/enemies\/(stage2_boss|final_boss)\//.test(entry.path),
    )
    expect(retired).toHaveLength(6)
    for (const entry of retired) {
      expect(findAsset(entry.key)?.placeholder).toBe(true)
      expect(resolveTextureKey(entry.key)).not.toBe(entry.key)
      expect(entry.width).not.toBe(entry.height)
      expect(existsSync(fileURLToPath(new URL(entry.path, assetRoot)))).toBe(false)
    }
  })
})
