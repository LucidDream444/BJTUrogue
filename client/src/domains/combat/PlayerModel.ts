import { ActorModel } from '@/core/actor/ActorModel'
import type { ActorStats } from '@/core/actor/ActorModel'
import type { HitRequest, HitResult } from '@/core/actor/damage'
import type { GameClock } from '@/core/time'
export type PlayerState = 'idle' | 'move' | 'attack' | 'hurt' | 'dead'
export class PlayerModel extends ActorModel<PlayerState> {
  protectedUntilMs = 0
  hurtUntilMs = 0
  attackUntilMs = 0
  iframeMs = 0
  readonly maxShield: number
  shield: number
  deathCause: 'water' | 'damage' | null = null
  hurtAtMs = -Infinity
  private absorbedDamage = 0
  onHurt: ((req: HitRequest, hpDamage: number, shieldDamage: number) => void) | null = null
  constructor(
    stats: ActorStats,
    readonly clock: GameClock,
    readonly hurtMs: number,
    maxShield: number,
  ) {
    super('player', stats, 'idle')
    this.maxShield = maxShield
    this.shield = maxShield
    this.spawn(stats, 'idle')
  }
  override takeHit(req: HitRequest): HitResult {
    this.absorbedDamage = 0
    if (
      this.clock.paused ||
      this.clock.frozen ||
      this.clock.nowMs < this.protectedUntilMs ||
      req.amount <= 0
    )
      return { applied: 0, killed: false, consumed: false }
    return super.takeHit(req)
  }

  /**
   * **抓取怪的咬击：剧本站定伤害。**
   *
   * ⚠️ 它和 `takeHit` 只差一件事：**不看 `clock.paused`**。
   * 抓取期间世界正是冻结的（那正是这个机制的设计），走 `takeHit` 会被那道
   * 「暂停时什么都不该发生」的守卫**静默吞掉** —— 表现是玩家永远咬不死，
   * 而机制整个失效、且不报错。
   *
   * 其余一律照旧：无敌帧、护盾、受击表现、死亡流程都走同一条路。
   * 硬直的顿帧（`frozen`）仍然尊重 —— 那是引擎级的「这一帧谁都别动」。
   */
  takeGrabBite(amount: number, sourceId: number, nowMs: number): HitResult {
    if (
      !this.alive ||
      this.clock.frozen ||
      this.clock.nowMs < this.protectedUntilMs ||
      amount <= 0
    )
      return { applied: 0, killed: false, consumed: false }
    return super.takeHit({
      sourceId,
      hitKey: `grab-bite:${sourceId}:${Math.round(nowMs)}`,
      mode: 'instant',
      amount,
      frameId: this.clock.frameId,
      nowMs,
      sourceKind: 'melee',
    })
  }

  /** Environmental death bypasses shield and hit protection, and emits the normal death event once. */
  fallIntoWater(): void {
    if (!this.alive) return
    this.deathCause = 'water'
    this.hp = 0
    this.shield = 0
    this.attackUntilMs = 0
    this.onKilled({
      sourceId: -3,
      hitKey: 'water',
      mode: 'instant',
      sourceKind: 'aoe',
      amount: this.maxHp,
      frameId: this.clock.frameId,
      nowMs: this.clock.nowMs,
    })
    this.state = 'dead'
  }
  protected override onKilled(req: HitRequest): void {
    this.deathCause ??= 'damage'
    super.onKilled(req)
  }

  protected override blocksSource(): boolean {
    return false
  }
  protected override absorbIncomingDamage(amount: number, _req: HitRequest): number {
    const absorbed = Math.min(this.shield, amount)
    if (absorbed <= 0) return amount
    this.shield -= absorbed
    this.absorbedDamage = absorbed
    this.hurtUntilMs = this.clock.nowMs + this.hurtMs
    this.protectedUntilMs = this.clock.nowMs + this.iframeMs
    return amount - absorbed
  }

  protected override onDamageApplied(req: HitRequest, applied: number): void {
    if (applied + this.absorbedDamage <= 0) return
    this.hurtAtMs = this.clock.nowMs
    this.attackUntilMs = 0
    this.onHurt?.(req, applied, this.absorbedDamage)
    this.hurtUntilMs = this.clock.nowMs + this.hurtMs
    this.protectedUntilMs = this.clock.nowMs + this.iframeMs
  }
  syncState(moving: boolean): void {
    this.state = !this.alive
      ? 'dead'
      : this.clock.nowMs < this.hurtUntilMs
        ? 'hurt'
        : this.clock.nowMs < this.attackUntilMs
          ? 'attack'
          : moving
            ? 'move'
            : 'idle'
  }
  applyStats(maxHp: number, speed: number, iframeMs: number): void {
    this.stats = { ...this.stats, maxHp, speed }
    this.hp = Math.min(maxHp, this.hp)
    this.iframeMs = iframeMs
  }
  /** Recovery is applied only after consuming an enemy drop. Returns the actual amount restored. */
  restoreFromPickup(kind: 'health' | 'shield', amount: number): number {
    if (
      !this.alive ||
      this.clock.paused ||
      this.clock.frozen ||
      !Number.isFinite(amount) ||
      amount <= 0
    )
      return 0
    if (kind === 'health') {
      const restored = Math.min(amount, this.maxHp - this.hp)
      this.hp += restored
      return restored
    }
    const restored = Math.min(amount, this.maxShield - this.shield)
    this.shield += restored
    return restored
  }
}
export function moveVelocity(
  vx: number,
  vy: number,
  x: number,
  y: number,
  speed: number,
  acceleration: number,
  deceleration: number,
  dtSec: number,
): { x: number; y: number } {
  const n = Math.hypot(x, y),
    tx = n ? (x / n) * speed : 0,
    ty = n ? (y / n) * speed : 0
  const dx = tx - vx,
    dy = ty - vy,
    distance = Math.hypot(dx, dy),
    step = (n ? acceleration : deceleration) * Math.max(0, dtSec)
  if (distance <= step || !distance) return { x: tx, y: ty }
  return { x: vx + (dx / distance) * step, y: vy + (dy / distance) * step }
}
export class FireGate {
  nextAtMs = 0
  ready(nowMs: number): boolean {
    return nowMs >= this.nextAtMs
  }
  fired(nowMs: number, cooldownMs: number): void {
    this.nextAtMs = nowMs + cooldownMs
  }
  /** No catch-up loop: one emission maximum per simulation frame. */
  reset(): void {
    this.nextAtMs = 0
  }
}
