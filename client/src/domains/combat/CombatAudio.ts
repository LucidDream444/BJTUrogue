import Phaser from 'phaser'
import { GAME_AUDIO } from '@/core/assetManifest'
import type { TypedBus, Unsubscribe } from '@/core/events'
import type { CombatEvents } from './events'
import type { CombatConfig } from './config'

/** A single looping track and a bounded voice pool shared by all player weapons. */
export class CombatAudio {
  private readonly music: Phaser.Sound.BaseSound | null
  private readonly shots: Phaser.Sound.BaseSound[] = []
  private readonly unsubs: Unsubscribe[]
  private cursor = 0
  private sfxVolume = 1
  private paused = false
  private disposed = false

  constructor(
    private readonly scene: Phaser.Scene,
    bus: TypedBus<CombatEvents>,
    private readonly cfg: CombatConfig['audio'],
  ) {
    this.music = scene.cache.audio.exists(GAME_AUDIO.bgm)
      ? scene.sound.add(GAME_AUDIO.bgm, { loop: true, volume: cfg.bgmVolume })
      : null
    if (scene.cache.audio.exists(GAME_AUDIO.shot))
      for (let i = 0; i < cfg.shotVoices; i++) this.shots.push(scene.sound.add(GAME_AUDIO.shot))

    this.unsubs = [
      bus.on('app_paused', () => {
        this.paused = true
        this.music?.pause()
        for (const shot of this.shots) shot.stop()
      }),
      bus.on('app_resumed', () => {
        this.paused = false
        this.startMusic()
      }),
    ]
    scene.sound.on(Phaser.Sound.Events.UNLOCKED, this.startMusic, this)
    this.startMusic()
  }

  private startMusic(): void {
    if (this.disposed || this.paused || this.scene.sound.locked || !this.music) return
    if (this.music.isPaused) this.music.resume()
    else if (!this.music.isPlaying) this.music.play()
  }

  /** Called only after stamina, fire-rate, and projectile-pool checks accept a shot. */
  fire(): void {
    if (this.disposed || this.paused || this.scene.sound.locked || !this.shots.length) return
    this.shots[this.cursor]!.play({ volume: this.cfg.shotVolume * this.sfxVolume })
    this.cursor = (this.cursor + 1) % this.shots.length
  }

  setVolumes(bgm: number, sfx: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, sfx))
    if (this.music && 'setVolume' in this.music) {
      const music = this.music as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound
      music.setVolume(this.cfg.bgmVolume * Math.max(0, Math.min(1, bgm)))
    }
  }

  destroy(): void {
    if (this.disposed) return
    this.disposed = true
    this.scene.sound.off(Phaser.Sound.Events.UNLOCKED, this.startMusic, this)
    for (const unsub of this.unsubs) unsub()
    this.music?.destroy()
    for (const shot of this.shots) shot.destroy()
    this.shots.length = 0
  }
}
