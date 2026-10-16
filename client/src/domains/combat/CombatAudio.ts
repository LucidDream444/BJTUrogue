import Phaser from 'phaser'
import { GAME_AUDIO } from '@/core/assetManifest'
import type { TypedBus, Unsubscribe } from '@/core/events'
import type { CombatEvents } from './events'
import type { CombatConfig } from './config'

/**
 * A single looping track and a bounded voice pool shared by all player weapons.
 *
 * ## 音量：**档里那个值就是实际音量**，不乘配置
 *
 * 2026-10-16 改的。原来是 `配置基准 × 档里音量`，于是滑杆拉到顶也只有基准那么响
 * （BGM 基准 0.32 → 顶天三成）。**玩家拉满却放不满**没人看得懂，所以改成：
 *
 *   - `setVolumes(bgm, sfx)` 收到的数**直接**是 `sound.setVolume()` 的值 —— 100% = 1.0。
 *   - `cfg.bgmVolume` / `cfg.shotVolume` 退成**基准（兜底）**：只在没有档的宿主里生效
 *     （个别测试场直接 `new CombatSession`，没人调 `setVolumes`），产品里一定会被盖掉。
 *
 * 保留兜底而不是删掉：直接建 `CombatSession` 的测试场行为不变，且配置里仍留着
 * 「这一版的基准音量」这个数（红线 2：数值不写死在代码里）。
 */
export class CombatAudio {
  private readonly music: Phaser.Sound.BaseSound | null
  private readonly shots: Phaser.Sound.BaseSound[] = []
  private readonly unsubs: Unsubscribe[]
  private cursor = 0
  /** 基准起步，`setVolumes()` 之后就是玩家设置的那个值 */
  private sfxVolume: number
  private paused = false
  private disposed = false

  constructor(
    private readonly scene: Phaser.Scene,
    bus: TypedBus<CombatEvents>,
    // 只用来取**基准**（兜底）和枪声池容量 —— 实际音量由 `setVolumes()` 给。
    // 所以是普通参数，不再是参数属性（留个 `this.cfg` 只会让人以为它还参与算音量）。
    cfg: CombatConfig['audio'],
  ) {
    this.music = scene.cache.audio.exists(GAME_AUDIO.bgm)
      ? scene.sound.add(GAME_AUDIO.bgm, { loop: true, volume: cfg.bgmVolume })
      : null
    if (scene.cache.audio.exists(GAME_AUDIO.shot))
      for (let i = 0; i < cfg.shotVoices; i++) this.shots.push(scene.sound.add(GAME_AUDIO.shot))
    this.sfxVolume = cfg.shotVolume

    this.unsubs = [
      bus.on('app_paused', () => {
        this.paused = true
        // Pause combat effects while the BGM continues through menus and rewards.
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
    if (this.disposed || this.scene.sound.locked || !this.music) return
    if (this.music.isPaused) this.music.resume()
    else if (!this.music.isPlaying) this.music.play()
  }

  /** Called only after stamina, fire-rate, and projectile-pool checks accept a shot. */
  fire(): void {
    if (this.disposed || this.paused || this.scene.sound.locked || !this.shots.length) return
    this.shots[this.cursor]!.play({ volume: this.sfxVolume })
    this.cursor = (this.cursor + 1) % this.shots.length
  }

  /** 两个数**就是实际音量**（0—1），不是乘在配置上的系数。见类注释。 */
  setVolumes(bgm: number, sfx: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, sfx))
    if (this.music && 'setVolume' in this.music) {
      const music = this.music as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound
      music.setVolume(Math.max(0, Math.min(1, bgm)))
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
