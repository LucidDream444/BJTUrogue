import Phaser from 'phaser'
import type { SfxProfile } from './WeaponSfxProfiles'

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/**
 * 程序化 8-bit 枪声。**不加载任何音频文件**，全部用 Web Audio 现场合成：
 * 振荡器 + 噪声 + 包络 + 滤波 + 波形量化（`WaveShaper` 阶梯曲线）。
 *
 * - 只走 `WebAudioSoundManager`；HTML5 回退时 `available` 为 false，由 `CombatAudio`
 *   退回旧的 mp3 枪声（外放/老浏览器仍有声音）。
 * - 所有节点接在 `scene.sound.destination` 上，所以 Phaser 的全局静音/总音量仍然生效；
 *   `setVolume()` 收到的就是玩家设置里的音效音量。
 * - 每个音效时长都 ≤ 0.35s，结束后断开节点；暂停时 `pause()` 立即停掉所有活跃源。
 */
export class WeaponSynth {
  private readonly ctx: AudioContext | null = null
  private readonly sfxGain: GainNode | null = null
  private readonly limiter: DynamicsCompressorNode | null = null
  private readonly noiseBuffer: AudioBuffer | null = null
  private readonly active = new Set<AudioScheduledSourceNode>()
  private volume = 1
  private disposed = false

  constructor(scene: Phaser.Scene) {
    const manager = scene.sound
    if (!(manager instanceof Phaser.Sound.WebAudioSoundManager)) return
    const ctx = manager.context
    const destination = manager.destination
    if (!ctx || !destination) return
    this.ctx = ctx
    const sfxGain = ctx.createGain()
    sfxGain.gain.value = 1
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -12
    limiter.knee.value = 8
    limiter.ratio.value = 8
    limiter.attack.value = 0.003
    limiter.release.value = 0.12
    sfxGain.connect(limiter).connect(destination)
    this.sfxGain = sfxGain
    this.limiter = limiter
    this.noiseBuffer = this.makeNoise(ctx)
  }

  get available(): boolean {
    return this.ctx !== null && this.sfxGain !== null && !this.disposed
  }

  /** 玩家设置里的音效音量（0—1）。 */
  setVolume(value: number): void {
    this.volume = clamp(value, 0, 1)
    if (this.ctx && this.sfxGain)
      this.sfxGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.01)
  }

  play(profile: SfxProfile): void {
    if (!this.ctx || !this.sfxGain || this.disposed || this.ctx.state !== 'running') return
    const ctx = this.ctx
    const now = ctx.currentTime
    const duration = Math.max(0.02, profile.duration)
    const attack = Math.max(0.002, profile.attack ?? 0.004)
    const pulses = Math.max(1, Math.floor(profile.pulses ?? 1))
    const gap = Math.max(0, profile.pulseGap ?? 0.05)
    const segment = Math.max(0.012, (duration - gap * (pulses - 1)) / pulses)

    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, now)
    for (let i = 0; i < pulses; i++) {
      const t = now + i * (segment + gap)
      env.gain.setValueAtTime(0.0001, t)
      env.gain.exponentialRampToValueAtTime(Math.max(0.001, profile.volume), t + attack)
      env.gain.exponentialRampToValueAtTime(0.0001, t + segment)
    }

    const shaper = ctx.createWaveShaper()
    shaper.curve = bitCurve(profile.bitDepth ?? 12)
    let tail: AudioNode = env
    let filter: BiquadFilterNode | null = null
    if (profile.filter) {
      filter = ctx.createBiquadFilter()
      filter.type = profile.filter.type
      filter.frequency.value = profile.filter.frequency
      filter.Q.value = profile.filter.q ?? 1
      env.connect(filter)
      tail = filter
    }
    tail.connect(shaper).connect(this.sfxGain)

    const cleanup: AudioNode[] = [env, shaper, ...(filter ? [filter] : [])]
    const sources: AudioScheduledSourceNode[] = []

    if (profile.wave !== 'noise') {
      const osc = ctx.createOscillator()
      osc.type = profile.wave
      osc.frequency.setValueAtTime(Math.max(20, profile.freq), now)
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, profile.freqEnd),
        now + duration,
      )
      const mix = ctx.createGain()
      mix.gain.value = profile.noise && profile.noise > 0 ? 1 - profile.noise : 1
      osc.connect(mix).connect(env)
      cleanup.push(mix)
      if (profile.vibrato) {
        const lfo = ctx.createOscillator()
        const lfoGain = ctx.createGain()
        lfo.frequency.value = profile.vibrato.rate
        lfoGain.gain.value = profile.vibrato.depth
        lfo.connect(lfoGain).connect(osc.frequency)
        lfo.start(now)
        lfo.stop(now + duration + 0.02)
        this.track(lfo)
        cleanup.push(lfoGain)
      }
      osc.start(now)
      osc.stop(now + duration + 0.02)
      sources.push(osc)
    }

    if ((profile.noise ?? 0) > 0 && this.noiseBuffer) {
      const noise = ctx.createBufferSource()
      noise.buffer = this.noiseBuffer
      const noiseGain = ctx.createGain()
      noiseGain.gain.value = profile.wave === 'noise' ? 1 : profile.noise!
      noise.connect(noiseGain).connect(env)
      noise.start(now, Math.random() * 0.4)
      noise.stop(now + duration + 0.02)
      cleanup.push(noiseGain)
      sources.push(noise)
    }

    for (const source of sources) this.track(source)
    const primary = sources[0]
    if (primary) {
      primary.addEventListener(
        'ended',
        () => {
          for (const node of cleanup) {
            try {
              node.disconnect()
            } catch {
              // 已经断开：无需处理
            }
          }
        },
        { once: true },
      )
    }
  }

  /** 暂停/离开战斗：立即停掉还在响的短音。 */
  pause(): void {
    for (const source of this.active) {
      try {
        source.stop()
      } catch {
        // 已经自然结束
      }
    }
    this.active.clear()
  }

  destroy(): void {
    if (this.disposed) return
    this.disposed = true
    this.pause()
    try {
      this.sfxGain?.disconnect()
      this.limiter?.disconnect()
    } catch {
      // 已断开
    }
  }

  private track(source: AudioScheduledSourceNode): void {
    this.active.add(source)
    source.onended = () => this.active.delete(source)
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1), ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    return buffer
  }
}

/** 把 [-1,1] 的波形量化成 `steps` 级阶梯，得到 8-bit 的颗粒感。 */
function bitCurve(steps: number): Float32Array<ArrayBuffer> {
  const size = 1024
  const curve = new Float32Array(new ArrayBuffer(size * Float32Array.BYTES_PER_ELEMENT))
  const levels = Math.max(2, Math.floor(steps))
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1
    curve[i] = Math.round(x * levels) / levels
  }
  return curve
}
