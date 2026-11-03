import { describe, expect, it } from 'vitest'
import {
  CHARACTER_VOICE_CHARACTER_IDS,
  CHARACTER_VOICE_CUES,
  CHARACTER_VOICE_PROFILES,
  characterVoiceKey,
  findAsset,
} from './assetManifest'

describe('character voice manifest', () => {
  it('gives every playable character a distinct voice identity', () => {
    const characterIds = CHARACTER_VOICE_PROFILES.map((profile) => profile.characterId)
    const voiceIds = CHARACTER_VOICE_PROFILES.map((profile) => profile.voiceId)
    expect(new Set(characterIds).size).toBe(characterIds.length)
    expect(new Set(voiceIds).size).toBe(voiceIds.length)
    expect(characterVoiceKey('scholar', 'hurt')).toBe('voice_player_red_berry_hurt')
  })

  it('registers a silent placeholder for every current character and cue', () => {
    for (const characterId of CHARACTER_VOICE_CHARACTER_IDS) {
      for (const cue of CHARACTER_VOICE_CUES) {
        const key = characterVoiceKey(characterId, cue)
        expect(findAsset(key)).toEqual({
          key,
          path: `audio/voice/player/${key}`,
          placeholder: true,
          kind: 'audio',
          codecs: ['ogg', 'mp3'],
        })
      }
    }
  })

  it('keeps every generated voice key unique', () => {
    const keys = CHARACTER_VOICE_CHARACTER_IDS.flatMap((characterId) =>
      CHARACTER_VOICE_CUES.map((cue) => characterVoiceKey(characterId, cue)),
    )
    expect(new Set(keys).size).toBe(keys.length)
  })
})
