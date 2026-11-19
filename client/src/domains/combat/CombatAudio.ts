import Phaser from 'phaser'
import { GAME_AUDIO } from '@/core/assetManifest'
import type { TypedBus, Unsubscribe } from '@/core/events'
import type { CombatEvents } from './events'
import type { CombatConfig, WeaponDef } from './config'
import { WeaponSynth } from './WeaponSynth'
import { sfxProfileFor } from './WeaponSfxProfiles'

/**
 * 一首循环 BGM + **逐武器程序化 8-bit 音效**。
 *
 * - WebAudio 下由 `WeaponSynth` 现场合成（每把武器在 `WeaponSfxProfiles` 里有一条配方），
 *   不加载任何枪声音频文件；
 * - HTML5 回退时退回旧的 `sfx_player_shot.mp3` 池，保证老浏览器仍有声音。
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
  private readonly baseMusic: Phaser.Sound.BaseSound | null
  private readonly performanceMusic: Phaser.Sound.BaseSound | null
  /** HTML5 回退用的旧 mp3 枪声池；WebAudio 下走 `synth`，不再播它。 */
  private readonly shots: Phaser.Sound.BaseSound[] = []
  private readonly synth: WeaponSynth
  private readonly unsubs: Unsubscribe[]
  private cursor = 0
  /** 基准起步，`setVolumes()` 之后就是玩家设置的那个值 */
  private sfxVolume: number
  private bgmVolume: number
  private paused = false
  private disposed = false
  private performanceActive = false

  constructor(
    private readonly scene: Phaser.Scene,
    bus: TypedBus<CombatEvents>,
    // 只用来取**基准**（兜底）和枪声池容量 —— 实际音量由 `setVolumes()` 给。
    // 所以是普通参数，不再是参数属性（留个 `this.cfg` 只会让人以为它还参与算音量）。
    cfg: CombatConfig['audio'],
  ) {
    this.baseMusic = scene.cache.audio.exists(GAME_AUDIO.bgm)
      ? scene.sound.add(GAME_AUDIO.bgm, { loop: true, volume: cfg.bgmVolume })
      : null
    this.performanceMusic = scene.cache.audio.exists(GAME_AUDIO.performer)
      ? scene.sound.add(GAME_AUDIO.performer, { loop: true, volume: cfg.bgmVolume })
      : null
    if (scene.cache.audio.exists(GAME_AUDIO.shot))
      for (let i = 0; i < cfg.shotVoices; i++) this.shots.push(scene.sound.add(GAME_AUDIO.shot))
    this.sfxVolume = cfg.shotVolume
    this.synth = new WeaponSynth(scene)
    this.synth.setVolume(cfg.shotVolume)
    this.bgmVolume = cfg.bgmVolume

    this.unsubs = [
      bus.on('app_paused', () => {
        this.paused = true
        if (this.performanceActive) this.performanceMusic?.pause()
        // Pause combat effects while the BGM continues through menus and rewards.
        for (const shot of this.shots) shot.stop()
        this.synth.pause()
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
    if (this.disposed || this.scene.sound.locked) return
    if (this.performanceActive) {
      if (this.baseMusic?.isPlaying) this.baseMusic.pause()
      if (this.performanceMusic?.isPaused) this.performanceMusic.resume()
      else if (this.performanceMusic && !this.performanceMusic.isPlaying) {
        this.performanceMusic.play()
      }
      return
    }

    if (this.performanceMusic?.isPlaying || this.performanceMusic?.isPaused) {
      this.performanceMusic.stop()
    }
    if (!this.baseMusic) return
    if (this.baseMusic.isPaused) this.baseMusic.resume()
    else if (!this.baseMusic.isPlaying) this.baseMusic.play()
  }

  /** 演奏开始时用 60 BPM 曲替换普通 BGM；停止后回到原 BGM。 */
  setPerformanceActive(active: boolean): void {
    if (this.performanceActive === active) return
    this.performanceActive = active
    this.startMusic()
  }

  /** Called only after stamina, fire-rate, and projectile-pool checks accept a shot. */
  fire(weapon: WeaponDef): void {
    if (this.disposed || this.paused || this.scene.sound.locked) return
    if (this.synth.available) {
      this.synth.play(sfxProfileFor(weapon.id))
      return
    }
    if (!this.shots.length) return
    this.shots[this.cursor]!.play({ volume: this.sfxVolume })
    this.cursor = (this.cursor + 1) % this.shots.length
  }

  /** 两个数**就是实际音量**（0—1），不是乘在配置上的系数。见类注释。 */
  setVolumes(bgm: number, sfx: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, sfx))
    this.synth.setVolume(this.sfxVolume)
    this.bgmVolume = Math.max(0, Math.min(1, bgm))
    for (const music of [this.baseMusic, this.performanceMusic]) {
      if (!music || !('setVolume' in music)) continue
      const sound = music as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound
      sound.setVolume(this.bgmVolume)
    }
  }

  destroy(): void {
    if (this.disposed) return
    this.disposed = true
    this.scene.sound.off(Phaser.Sound.Events.UNLOCKED, this.startMusic, this)
    for (const unsub of this.unsubs) unsub()
    this.baseMusic?.destroy()
    this.performanceMusic?.destroy()
    for (const shot of this.shots) shot.destroy()
    this.shots.length = 0
    this.synth.destroy()
  }
}
