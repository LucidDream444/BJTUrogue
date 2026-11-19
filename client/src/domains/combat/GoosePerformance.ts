/**
 * “演奏”的纯逻辑。零 Phaser、零 DOM，node 下可直接测试。
 *
 * 节拍条每个周期从左走到右。最后 `beatHitWindowMs` 是本拍的命中窗口，
 * 实心圆停在与右侧空心圆重合的位置；这样视觉判定与实际判定始终是同一个时间轴。
 * 长帧不会补发多次演奏，所有输入都由显式调用推进。
 */

export type SongColor = 'red' | 'blue'

/** 本次歌曲实际扣除的魔力；不足一首时扣掉剩余魔力，让最后一首歌把资源用尽。 */
export function songManaSpend(current: number, cost: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(cost)) return 0
  return Math.min(Math.max(0, current), Math.max(0, cost))
}

export interface PerformanceConfig {
  beatPeriodMs: number
  beatHitWindowMs: number
  songCooldownMs: number
  maxStacks: number
  stackDurationMs: number
  redDamage: number
  redDamagePerStackPct: number
  redRadius: number
  damageBonusPctPerStack: number
  moveSpeedPctPerStack: number
  shieldPerStack: number
  blueShieldRestore: number
}

export interface SongEffect {
  color: SongColor
  onBeat: boolean
  stacks: number
  damage: number
  radius: number
  shieldRestore: number
}

export interface PerformanceSnapshot {
  active: boolean
  beatProgress: number
  onBeat: boolean
  redStacks: number
  blueStacks: number
  maxStacks: number
  redRemainingMs: number
  blueRemainingMs: number
  redCooldownMs: number
  blueCooldownMs: number
}

export class GoosePerformance {
  private active = false
  private startedAtMs = 0
  private redStacksValue = 0
  private blueStacksValue = 0
  private redExpiresAtMs = 0
  private blueExpiresAtMs = 0
  private readonly nextInput = { red: 0, blue: 0 }

  constructor(private readonly cfg: PerformanceConfig) {}

  get isActive(): boolean {
    return this.active
  }

  get redStacks(): number {
    return this.redStacksValue
  }

  get blueStacks(): number {
    return this.blueStacksValue
  }

  start(nowMs: number): boolean {
    if (this.active || !Number.isFinite(nowMs)) return false
    this.active = true
    this.startedAtMs = nowMs
    return true
  }

  /**
   * 结束演奏但保留已经获得的歌曲效果，让它们继续按自己的计时过期。
   * 清房、死亡和场景销毁也走这里，避免一个“演奏中”状态跨房间残留。
   */
  stop(): void {
    this.active = false
    this.startedAtMs = 0
  }

  reset(): void {
    this.stop()
    this.redStacksValue = 0
    this.blueStacksValue = 0
    this.redExpiresAtMs = 0
    this.blueExpiresAtMs = 0
    this.nextInput.red = 0
    this.nextInput.blue = 0
  }

  update(nowMs: number): void {
    if (!Number.isFinite(nowMs)) return
    this.expireStacks(nowMs)
  }

  /** 冷却是否已经结束；真正触发前先问一次，避免被冷却挡掉的按键扣魔力。 */
  canPress(color: SongColor, nowMs: number): boolean {
    this.update(nowMs)
    return this.active && nowMs >= this.nextInput[color]
  }

  press(
    color: SongColor,
    nowMs: number,
  ): SongEffect | null {
    this.update(nowMs)
    if (!this.canPress(color, nowMs)) return null
    this.nextInput[color] = nowMs + this.cfg.songCooldownMs

    const onBeat = this.isOnBeat(nowMs)
    if (onBeat) {
      if (color === 'red') {
        this.redStacksValue = Math.min(this.cfg.maxStacks, this.redStacksValue + 1)
        this.redExpiresAtMs = nowMs + this.cfg.stackDurationMs
      } else {
        this.blueStacksValue = Math.min(this.cfg.maxStacks, this.blueStacksValue + 1)
        this.blueExpiresAtMs = nowMs + this.cfg.stackDurationMs
      }
    }

    if (color === 'red') {
      const stacks = onBeat ? this.redStacksValue : 1
      const stackScale = 1 + Math.max(0, stacks - 1) * this.cfg.redDamagePerStackPct / 100
      const damage = onBeat ? this.cfg.redDamage * stackScale : this.cfg.redDamage
      return {
        color,
        onBeat,
        stacks: this.redStacksValue,
        damage,
        radius: this.cfg.redRadius,
        shieldRestore: 0,
      }
    }

    return {
      color,
      onBeat,
      stacks: this.blueStacksValue,
      damage: 0,
      radius: 0,
      shieldRestore: onBeat
        ? this.cfg.blueShieldRestore * Math.max(1, this.blueStacksValue)
        : this.cfg.blueShieldRestore,
    }
  }

  snapshot(nowMs: number): PerformanceSnapshot {
    this.update(nowMs)
    return {
      active: this.active,
      beatProgress: this.beatProgress(nowMs),
      onBeat: this.active && this.isOnBeat(nowMs),
      redStacks: this.redStacksValue,
      blueStacks: this.blueStacksValue,
      maxStacks: this.cfg.maxStacks,
      redRemainingMs: Math.max(0, this.redExpiresAtMs - nowMs),
      blueRemainingMs: Math.max(0, this.blueExpiresAtMs - nowMs),
      redCooldownMs: Math.max(0, this.nextInput.red - nowMs),
      blueCooldownMs: Math.max(0, this.nextInput.blue - nowMs),
    }
  }

  /** 当前节拍条的位置，0 = 最左，1 = 与右侧目标圆重合。 */
  private beatProgress(nowMs: number): number {
    if (!this.active) return 0
    const phase = this.phase(nowMs)
    const travelMs = Math.max(1, this.cfg.beatPeriodMs - this.cfg.beatHitWindowMs)
    return Math.min(1, phase / travelMs)
  }

  private isOnBeat(nowMs: number): boolean {
    if (!this.active) return false
    const phase = this.phase(nowMs)
    return phase >= this.cfg.beatPeriodMs - this.cfg.beatHitWindowMs
  }

  private phase(nowMs: number): number {
    const elapsed = Math.max(0, nowMs - this.startedAtMs)
    return elapsed % this.cfg.beatPeriodMs
  }

  private expireStacks(nowMs: number): void {
    if (this.redStacksValue > 0 && nowMs >= this.redExpiresAtMs) {
      this.redStacksValue = 0
      this.redExpiresAtMs = 0
    }
    if (this.blueStacksValue > 0 && nowMs >= this.blueExpiresAtMs) {
      this.blueStacksValue = 0
      this.blueExpiresAtMs = 0
    }
  }
}
