import Phaser from 'phaser'
import {
  CHARACTER_VOICE_CUES,
  characterVoiceKey,
  type CharacterVoiceCue,
} from '@/core/assetManifest'

export interface CharacterVoiceOptions {
  volume: number
  hurtCooldownMs: number
}

/**
 * 角色短语音播放器。
 *
 * 五个 cue 是稳定的业务接口；文件没有接入时，`cache.audio.exists()` 为 false，
 * 对应 cue 不会创建 Sound 对象，`play()` 静默返回 false。这样占位期和缺资源期
 * 都遵守“没有语音就不出声”，也不会让控制台被 `sound.add()` 警告刷满。
 *
 * 同一角色同时只播一句：新的台词会停掉上一句，避免受击痛呼、技能喊话和死亡语音叠在一起。
 */
export class CharacterVoice {
  private readonly sounds = new Map<CharacterVoiceCue, Phaser.Sound.BaseSound>()
  private characterId: string | null = null
  private volume: number
  private hurtReadyAt = 0
  private disposed = false

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly options: CharacterVoiceOptions,
  ) {
    this.volume = Phaser.Math.Clamp(options.volume, 0, 1)
  }

  /** 切换当前出战角色；没有对应资源的 cue 继续静默。 */
  setCharacter(characterId: string): void {
    if (this.disposed || characterId === this.characterId) return
    this.stopAll()
    this.destroySounds()
    this.characterId = characterId

    for (const cue of CHARACTER_VOICE_CUES) {
      const key = characterVoiceKey(characterId, cue)
      if (!this.scene.cache.audio.exists(key)) continue
      this.sounds.set(cue, this.scene.sound.add(key))
    }
  }

  play(cue: CharacterVoiceCue): boolean {
    if (this.disposed || this.characterId === null || this.scene.sound.locked) return false
    const sound = this.sounds.get(cue)
    if (!sound) return false

    if (cue === 'hurt') {
      const now = this.scene.time.now
      if (now < this.hurtReadyAt) return false
      this.hurtReadyAt = now + this.options.hurtCooldownMs
    }

    for (const [otherCue, other] of this.sounds) {
      if (otherCue !== cue && other.isPlaying) other.stop()
    }
    if (sound.isPlaying) sound.stop()
    sound.play({ volume: this.volume })
    return true
  }

  /** 与现有“音效”音量滑杆共用同一档值。 */
  setVolume(volume: number): void {
    this.volume = Phaser.Math.Clamp(volume, 0, 1)
    for (const sound of this.sounds.values()) {
      const adjustable = sound as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound
      adjustable.setVolume(this.volume)
    }
  }

  stopAll(): void {
    for (const sound of this.sounds.values()) {
      if (sound.isPlaying) sound.stop()
    }
  }

  destroy(): void {
    if (this.disposed) return
    this.disposed = true
    this.stopAll()
    this.destroySounds()
  }

  private destroySounds(): void {
    for (const sound of this.sounds.values()) sound.destroy()
    this.sounds.clear()
  }
}
