/**
 * 音效池。**唯一 import Phaser 的表现文件之一。**
 *
 * ## 为什么是固定大小的池 + 轮转，而不是每次 `sound.play(key)`
 *
 * `[源码]` `sound/BaseSoundManager.js` L324：`SoundManager.play(key)` 每次
 * **`this.add(key)` 新建一个实例**，并且 `once(COMPLETE, destroy)` 让它播完自毁。
 * 于是：
 *
 * ① **每次一个音效 = 一次对象分配 + 一个 Web Audio 节点 + 一个事件订阅。**
 *    200 只怪的场面，一次连锁死亡就是 200 个。GC 会在最需要帧率的时刻插一脚。
 * ② 想给一个 key 加上限（「同一个音最多同时响 4 路」）也无处可加 ——
 *    `play(key)` 每次都是新对象，Pool 之外没有任何地方能拦住它。
 *
 * 所以每个 key 预建 `voices` 个实例、轮转复用。**并发叠音仍然成立**：
 * `[源码]` `sound/webaudio/WebAudioSound.js` 的 `play()` 是
 * `stopAndRemoveBufferSource()` + `createAndStartBufferSource()`，
 * 也就是「同一个实例重播 = 从头重启」，而**不同实例播同一个 key = 真正的叠音**。
 * 连锁击杀的听觉冲击全靠后者。
 *
 * ## 占位期：**必须静默返回，不能建对象**
 *
 * 清单里所有音频都是 `placeholder: true`（见 `core/assetManifest.ts`），
 * 也就是**从来没加载过**。对着一个不存在的 key 调 `sound.add()` 会建出一个
 * 播不出声的对象，每次 `play()` 再打一条警告 —— 几十条警告刷满控制台之后，
 * 真正重要的警告就没人看得见了。
 *
 * 所以先查 `cache.audio.exists(key)`，没有就整个 key 标记成「静音」，一个对象都不建。
 * **这就是 `placeholder: true` 承诺的「播放时静默返回」。**
 *
 * ## 音调是「连杀」的听觉线索，不是美化
 *
 * 同一个受击音连响 8 次听起来是同一个音；音调逐级升高才让玩家**听出自己在连杀**。
 * 这是 `JuicePolicy.pitchCentsFor()` 的输出，本文件只负责把它交给 Phaser。
 * `detune` 单位是音分（100 音分 = 半音），Phaser 直接透传给 Web Audio。
 */

import Phaser from 'phaser'

/** 每个 key 预建几路。见文件头 ② */
const DEFAULT_VOICES = 4

export interface SfxPoolOptions {
  scene: Phaser.Scene
  /** 池里一共有哪些 key（从资源清单里筛 `kind: 'audio'` 得到） */
  keys: readonly string[]
  voicesPerKey?: number
}

export class SfxPool {
  private readonly byKey = new Map<string, Phaser.Sound.BaseSound[]>()
  /** 轮转游标 */
  private readonly cursor = new Map<string, number>()
  /** 没加载过的 key。放音时直接跳过，不建对象、不警告 */
  private readonly silent = new Set<string>()
  private readonly scene: Phaser.Scene
  private readonly voices: number
  private readonly knownKeys: readonly string[]

  constructor(opts: SfxPoolOptions) {
    this.scene = opts.scene
    this.voices = opts.voicesPerKey ?? DEFAULT_VOICES
    this.knownKeys = opts.keys
  }

  /**
   * 建池。**在 `create()` 里调一次。**
   *
   * 不放在构造函数里，是因为 `scene.cache` 的音频在 `preload` 结束前是空的 ——
   * 构造期建池会把所有 key 全判成「静音」，然后**永久**不出声。
   * 这是个只在「占位换真资源」那天才会暴露的 bug，所以宁愿多一步显式调用。
   */
  create(): void {
    for (const key of this.knownKeys) {
      if (!this.scene.cache.audio.exists(key)) {
        this.silent.add(key)
        continue
      }
      const voices: Phaser.Sound.BaseSound[] = []
      for (let i = 0; i < this.voices; i++) {
        voices.push(this.scene.sound.add(key))
      }
      this.byKey.set(key, voices)
      this.cursor.set(key, 0)
    }
  }

  /** 这个 key 现在是不是真的能出声（调试 HUD 用） */
  isSilent(key: string): boolean {
    return this.silent.has(key) || !this.byKey.has(key)
  }

  /**
   * 放一次。
   *
   * @param pitchCents 音调偏移（音分）。0 = 原调
   * @param volume 0..1
   * @returns 真的播了吗（占位期返回 false，调用方可以据此跳过特效）
   */
  play(key: string, pitchCents = 0, volume = 1): boolean {
    const voices = this.byKey.get(key)
    if (!voices || voices.length === 0) return false

    const i = this.cursor.get(key) ?? 0
    const voice = voices[i]!
    this.cursor.set(key, (i + 1) % voices.length)

    // 不用先 `stop()`：`WebAudioSound.play()` 自己就是
    // `stopAndRemoveBufferSource()` + `createAndStartBufferSource()`，会从头重启。
    // 多余的 stop 只是白白发一次 STOP 事件（那是给 UI 用的，不是内部清理）。
    voice.play({ detune: pitchCents, volume })
    return true
  }

  /**
   * 停掉**所有**在播的，但保留池子（暂停菜单用）。
   *
   * 停而不毁：暂停菜单一开就 `destroy()` 的话，恢复时池子是空的，
   * 之后所有 `play()` 都静默返回 —— 表现是「暂停过一次之后就再也没音效了」。
   */
  stopAll(): void {
    for (const voices of this.byKey.values()) {
      for (const v of voices) {
        if (v.isPlaying) v.stop()
      }
    }
  }

  /** 场景 shutdown：停掉所有在播的，并释放实例。 */
  destroy(): void {
    for (const voices of this.byKey.values()) {
      for (const v of voices) {
        if (v.isPlaying) v.stop()
        v.destroy()
      }
    }
    this.byKey.clear()
    this.cursor.clear()
    this.silent.clear()
  }
}