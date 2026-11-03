import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CHARACTERS } from '../catalog'
import { parseMetaConfig } from '../metaConfig'
import { effectiveStats, skillLevelOf } from '../progress/progress'
import { createDefaultProfile } from './defaults'
import { ProfileStore } from './ProfileStore'
import { MemoryProfileStorage } from './storage'
import { PROFILE_SCHEMA_VERSION, PROFILE_STORAGE_KEY } from './types'

const meta = parseMetaConfig(JSON.parse(readFileSync(new URL('../../../../public/config/meta.json', import.meta.url), 'utf8')))

describe('图书委员旧档继续作为小红果使用', () => {
  for (const unlocked of [false, true]) {
    it(`${unlocked ? '已解锁且升级' : '未解锁'}scholar保存重载不改变身份、费用和其他角色进度`, () => {
      const original = createDefaultProfile()
      original.currency.coins = 777
      original.upgrades['student:skill'] = 1
      original.selected.difficulty = 'hard'
      if (unlocked) {
        original.unlocks.characters.push('athlete', 'scholar')
        original.upgrades['scholar:skill'] = 2
        original.upgrades['athlete:skill'] = 1
        original.selected.characterId = 'scholar'
      }
      const storage = new MemoryProfileStorage({ [PROFILE_STORAGE_KEY]: JSON.stringify(original) })
      const first = new ProfileStore({ storage })
      expect(first.load().status).toBe('loaded')
      expect(first.profile.unlocks).toEqual(original.unlocks)
      expect(first.profile.upgrades).toEqual(original.upgrades)
      expect(first.profile.selected).toEqual(original.selected)
      expect(skillLevelOf(first.profile, meta, 'scholar')).toBe(unlocked ? 3 : 0)
      expect(effectiveStats(first.profile, meta, 'scholar').energyRegenPct).toBe(50)
      expect(meta.characters.scholar).toMatchObject({ unlockCost: 400, skill: { id: 'library_loan', kind: 'summon', upgradeCosts: [140, 300, 540] } })
      expect(first.save()).toBe(true)
      const second = new ProfileStore({ storage }); second.load()
      expect(second.profile).toEqual(first.profile)
      expect(second.profile.schemaVersion).toBe(PROFILE_SCHEMA_VERSION)
      expect(second.profile.currency.coins).toBe(777)
      expect(CHARACTERS.find((value) => value.id === 'scholar')?.name).toBe('小红果')
    })
  }
})
