import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ANIMS, BOSS_FIRST_ART, FINAL_BOSS_ART, MUSCOVY_ART, NIGHTMARE_CAT_ART,
  PUBLIC_WEAPON_ART, RED_BERRY_ART, STAGE2_BOSS_ART, findAsset,
} from '@/core/assetManifest'

const file = (path: string) => readFileSync(new URL('../../../public/assets/' + path, import.meta.url))
const sheets = [RED_BERRY_ART.texture, MUSCOVY_ART.texture, NIGHTMARE_CAT_ART.texture,
  NIGHTMARE_CAT_ART.vortex, NIGHTMARE_CAT_ART.void, BOSS_FIRST_ART.texture,
  ...Object.values(STAGE2_BOSS_ART), ...Object.values(FINAL_BOSS_ART)]

describe('校园梦境正式资源交付', () => {
  it('新怪、红果与三首领全部是真实透明PNG，帧范围合法且单纹理不超过2048', () => {
    for (const key of sheets) {
      const asset = findAsset(key)!
      expect(asset, key).toBeDefined()
      expect(asset.placeholder, key).toBe(false)
      expect(asset.kind, key).toBe('spritesheet')
      const png = file(asset.path)
      expect(png.subarray(1, 4).toString(), key).toBe('PNG')
      expect(png[25], `${key} RGBA`).toBe(6)
      const width = png.readUInt32BE(16), height = png.readUInt32BE(20)
      expect(Math.max(width, height), key).toBeLessThanOrEqual(2048)
      expect(width % asset.frameWidth!, key).toBe(0)
      expect(height % asset.frameHeight!, key).toBe(0)
      const frameCount = width / asset.frameWidth! * (height / asset.frameHeight!)
      for (const anim of ANIMS.filter((anim) => anim.textureKey === key)) {
        expect(anim.frames.every((frame) => frame >= 0 && frame < frameCount), anim.animKey).toBe(true)
      }
    }
  })

  it('六把公共枪保持既有单图像素与握点/枪口，不产生按红果复制的武器变体', () => {
    for (const [weaponId, geometry] of Object.entries(PUBLIC_WEAPON_ART)) {
      const asset = findAsset(geometry.texture)!
      const common = file(asset.path)
      const existing = file(`sprites/player/goose/player_goose_gun_${weaponId}.png`)
      expect(common.equals(existing), weaponId).toBe(true)
      expect([common.readUInt32BE(16), common.readUInt32BE(20)], weaponId).toEqual(geometry.size)
      expect(geometry.muzzle[0]).toBeGreaterThan(geometry.grip[0])
    }
  })
})
