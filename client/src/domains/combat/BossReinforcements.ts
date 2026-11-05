/** 首领房补怪的纯时间调度。只读游戏时钟，不接触实体、随机数或墙钟。 */
export interface BossReinforcementsConfig {
  cooldownMs: number
  spawnCount: number
  maxAlive: number
}

export class BossReinforcements {
  private nextAtMs: number | null = null

  constructor(private readonly config: BossReinforcementsConfig) {}

  /** 离开、重建或切换房间时调用；新一场首领战从完整冷却重新开始。 */
  reset(): void {
    this.nextAtMs = null
  }

  /**
   * 返回本次最多可以新排队的小怪数量。
   * remainingMinions 必须包含当前房间活着和排队等待生成的小怪，且不包括首领。
   * 宿主实际排队前应先把该数量计入等待数，避免同一批名额重复使用。
   */
  update(nowMs: number, bossAlive: boolean, remainingMinions: number): number {
    if (!bossAlive) {
      this.reset()
      return 0
    }
    if (this.nextAtMs === null) {
      this.nextAtMs = nowMs + this.config.cooldownMs
      return 0
    }
    if (nowMs < this.nextAtMs) return 0

    // 卡帧、满槽或稍后恢复都不补发错过的波次；下一次只从当前游戏时间计时。
    this.nextAtMs = nowMs + this.config.cooldownMs
    const occupied = Math.max(0, Math.floor(remainingMinions))
    return Math.max(0, Math.min(this.config.spawnCount, this.config.maxAlive - occupied))
  }
}
