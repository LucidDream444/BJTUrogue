import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ASSETS,
  BOSS_ROSTER_ART,
  CHARACTER_VOICE_CHARACTER_IDS,
  CHARACTER_VOICE_CUES,
  CHARACTER_VOICE_PROFILES,
  PERFORMANCE_LOOP,
  audioUrls,
  characterVoiceKey,
  findAsset,
} from './assetManifest'

function pcmWavInfo(buffer: Buffer): {
  sampleRate: number
  channels: number
  bitsPerSample: number
  frames: number
} {
  let offset = 12
  let sampleRate = 0
  let channels = 0
  let bitsPerSample = 0
  let dataBytes = 0
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      channels = buffer.readUInt16LE(body + 2)
      sampleRate = buffer.readUInt32LE(body + 4)
      bitsPerSample = buffer.readUInt16LE(body + 14)
    } else if (id === 'data') {
      dataBytes = size
      break
    }
    offset = body + size + (size & 1)
  }
  return {
    sampleRate,
    channels,
    bitsPerSample,
    frames: dataBytes / Math.max(1, channels * bitsPerSample / 8),
  }
}

describe('character voice manifest', () => {
  const readyKeys = new Set([
    'voice_player_student_hurt',
    'voice_player_student_death',
    'voice_player_student_skill',
    'voice_player_student_reward',
    'voice_player_athlete_hurt',
    'voice_player_athlete_death',
    'voice_player_athlete_skill',
    'voice_player_athlete_reward',
    'voice_player_all_boss_kill',
  ])

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
          placeholder: !readyKeys.has(key),
          kind: 'audio',
          codecs: ['ogg', 'mp3'],
        })
      }
    }
  })

  it('shares one boss-kill clip while keeping the remaining voice keys unique', () => {
    const keys = CHARACTER_VOICE_CHARACTER_IDS.flatMap((characterId) =>
      CHARACTER_VOICE_CUES.map((cue) => characterVoiceKey(characterId, cue)),
    )
    expect(new Set(keys).size).toBe(keys.length - (CHARACTER_VOICE_CHARACTER_IDS.length - 1))
    for (const characterId of CHARACTER_VOICE_CHARACTER_IDS) {
      expect(characterVoiceKey(characterId, 'boss_kill')).toBe(
        'voice_player_all_boss_kill',
      )
    }
  })
})

describe('演奏家大鹅音乐循环', () => {
  it('音频是 60 BPM 的四小节循环，总长正好 16 秒', () => {
    const path = fileURLToPath(
      new URL('../../public/assets/audio/bgm/bgm_performer_stage_loop_4bar_60bpm.wav', import.meta.url),
    )
    const info = pcmWavInfo(readFileSync(path))
    expect(info).toMatchObject({ channels: 1, sampleRate: 22_050, bitsPerSample: 16 })
    expect(PERFORMANCE_LOOP).toMatchObject({ bpm: 60, beatMs: 1000, beats: 16 })
    expect((info.frames / info.sampleRate) * 1000).toBe(PERFORMANCE_LOOP.durationMs)
  })
})


describe('首领施法音频清单', () => {
  it('音频路径是不带扩展名的基名，URL 只补一次扩展名', () => {
    for (const entry of ASSETS.filter((asset) => asset.kind === 'audio')) {
      expect(entry.path, entry.key).not.toMatch(/\.(mp3|ogg|wav)$/)
      for (const url of audioUrls(entry)) {
        expect(url, entry.key).toMatch(/\.(mp3|ogg|wav)$/)
        expect(url, entry.key).not.toMatch(/\.(mp3|ogg|wav)\.(mp3|ogg|wav)$/)
      }
    }
  })

  it('七位常规首领都指向实际存在的施法音频', () => {
    for (const art of Object.values(BOSS_ROSTER_ART)) {
      const entry = findAsset(art.audio)
      expect(entry, art.audio).toBeDefined()
      expect(audioUrls(entry!)).toEqual([`assets/audio/sfx/boss/${art.audio}.mp3`])
      expect(() => readFileSync(fileURLToPath(new URL(`../../public/${audioUrls(entry!)[0]}`, import.meta.url)))).not.toThrow()
    }
  })
})
