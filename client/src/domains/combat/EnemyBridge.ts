import type { BossPresentationConfig } from '@/domains/enemies/presentation/BossFootprint'
import type Phaser from 'phaser'
import { EnemySystem, type EnemySystemNavOptions, type LightPort } from '@/domains/enemies/EnemySystem'
import { JuiceDirector } from '@/domains/enemies/presentation/JuiceDirector'
import type { GameClock } from '@/core/time'
import type { TypedBus, Unsubscribe, EnemyKind, GameEvents } from '@/core/events'
import type { ConfigBundle, Difficulty } from '@/core/config'
import type { HitResult, TickTarget } from '@/core/actor/damage'
import type { CombatConfig } from './config'
import type { CombatEvents } from './events'
import type { EffectTargetPort, WeaponTarget } from './WeaponMechanics'
export interface PlayerPort {
  model: TickTarget
  /**
   * 抓取怪的咬击入口。**D3 不能走 `model.takeHit`** —— 那个入口在 `clock.paused`
   * 时直接返回，而抓取期间世界正是冻结的（见 `PlayerModel.takeGrabBite`）。
   * 可选：测试场里的假玩家没有它，抓取照样能跑（只是咬不掉血）。
   */
  bite?: (amount: number, sourceId: number, nowMs: number) => void
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  alive: boolean
}
export interface BulletContactPort extends EffectTargetPort {
  /**
   * 穿透期间的**帧伤节拍**（毫秒）。D1 的穿透特殊效果按它触发，不要每帧都触发 ——
   * 每帧就是 60 倍伤害。数值来自 `enemies.json` 的 `tank.frameDamage.tickMs`。
   */
  readonly pierceTickMs: number
  targets(): WeaponTarget[]
  group: Phaser.Physics.Arcade.Group
  contact(id: number, target: Phaser.GameObjects.GameObject, damage: number): HitResult
  /**
   * 扫掠射线命中的一发（特殊弹）。**和 `contact` 是同一套结算** ——
   * 冲击每个源只算一次、帧伤按 `tickMs` 走账本，区别只在于按 id 找怪而不是按碰撞对象。
   * 见 `EnemySystem.bulletRayContact` 上那段 ⚠️（改回 `hit()` 会每帧兑现一次全额冲击）。
   */
  bulletRayContact(shotId: number, enemyId: number, damage: number): HitResult
  meleeContact(id: number, target: Phaser.GameObjects.GameObject, damage: number): HitResult
  pulseContact(id: number, target: Phaser.GameObjects.GameObject, damage: number): HitResult
  /** 玩家武器击退：走 D3 的速度意图，不直接写 body。 */
  knockback(id: number, vx: number, vy: number, durationMs: number): void
  /** 近战消弹：扇形内关闭敌方弹丸，返回销毁数量。 */
  destroyShotsInArc(x: number, y: number, range: number, angle: number, arcRad: number): number
  release(id: number): void
}
/** Composition adapter: only the existing D3 public contract, never EnemyModel state. */
export class EnemyBridge implements BulletContactPort {
  private readonly system: EnemySystem
  private readonly juice: JuiceDirector
  private readonly unsub: Unsubscribe
  readonly group: Phaser.Physics.Arcade.Group
  private damagedAtFrame = -1
  constructor(
    scene: Phaser.Scene,
    bus: TypedBus<CombatEvents>,
    clock: GameClock,
    private readonly bundle: ConfigBundle,
    private readonly cfg: CombatConfig,
    private readonly difficulty: Difficulty,
    player: () => PlayerPort,
    seed: number,
    nav?: EnemySystemNavOptions,
    bossPresentation?: BossPresentationConfig,
    private floor = 1,
    light?: LightPort,
    applyLightMask?: (obj: Phaser.GameObjects.GameObject) => void,
  ) {
    this.unsub = bus.on('player_hurt', (e) => {
      if (e.sourceKind === 'aoe' && e.hpDamage + e.shieldDamage > 0) this.damagedAtFrame = e.frameId
    })
    // Narrow the common event surface for D3. Same bus instance; no forwarding or duplicate notifications.
    const commonBus = bus as unknown as TypedBus<GameEvents>
    this.system = new EnemySystem({
      scene,
      bus: commonBus,
      clock,
      bundle,
      difficulty,
      player,
      rngSeed: seed,
      nav,
      bossPresentation,
      bossContactDamagePerTick: this.cfg.encounter.bossContactDamagePerTick,
      light,
      applyLightMask,
      hooks: {
        // 咬击打到玩家身上：D3 算规则，D1 落到自己的模型上（见 PlayerPort.bite）
        onGrabBite: (amount, sourceId, nowMs) => player().bite?.(amount, sourceId, nowMs),
        onGrabBlast: (x, y, radius) => this.juice.onGrabBlast(x, y, radius),
        onSlam: (x, y, r, ms) => {
          // Existing hook fires even if PlayerModel rejected the hit. Only valid damage earns juice.
          if (this.damagedAtFrame === clock.frameId) {
            this.juice.onSlam(x, y, r, ms)
            this.damagedAtFrame = -1
          }
        },
      },
    })
    this.group = this.system.group
    this.system.create()
    this.juice = new JuiceDirector({ scene, bus: commonBus, clock, bundle, enemies: this.system })
    this.juice.create()
  }
  /**
   * 穿透期间的**帧伤节拍**（毫秒）。D1 的穿透特殊效果按它触发，不要每帧都触发 ——
   * 每帧就是 60 倍伤害。数值来自 `enemies.json` 的 `tank.frameDamage.tickMs`。
   */
  get pierceTickMs(): number {
    return this.bundle.enemies.enemies.tank.frameDamage.tickMs
  }

  /**
   * 换层：把当前层号带进敌人系统，并刷新难度派生缓存。
   *
   * 3 层流程里每层的怪是重新生成的，`EnemySystem` 里有派生缓存（分裂/肉盾/抓取），
   * 不刷新的话同一只怪会继续用上一层算出来的血量。这里先按难度基准重算；
   * 如果以后 `combat.json` 增加逐层倍率，只改这里即可。
   */
  setFloor(floor: number): void {
    const next = Math.max(1, Math.min(this.cfg.arena.maxStages, Math.floor(floor)))
    if (next === this.floor) return
    this.floor = next
    const base = this.bundle.difficulty.difficulties[this.difficulty]
    this.system.setDifficultyModifiers({ ...base })
  }
  contact(id: number, target: Phaser.GameObjects.GameObject, damage: number): HitResult {
    const cfg = this.bundle.enemies.enemies.tank.frameDamage.bullet
    return this.system.bulletContact(
      id,
      target,
      damage,
      Math.floor(damage * cfg.tickDamageRatio + 0.5),
      cfg.maxTicksPerSource,
    )
  }
  bulletRayContact(shotId: number, enemyId: number, damage: number): HitResult {
    const cfg = this.bundle.enemies.enemies.tank.frameDamage.bullet
    return this.system.bulletRayContact(
      shotId,
      enemyId,
      damage,
      Math.floor(damage * cfg.tickDamageRatio + 0.5),
      cfg.maxTicksPerSource,
    )
  }
  meleeContact(id: number, target: Phaser.GameObjects.GameObject, damage: number): HitResult {
    const cfg = this.bundle.enemies.enemies.tank.frameDamage.melee
    return this.system.meleeContact(
      id,
      target,
      damage,
      Math.floor(damage * cfg.tickDamageRatio + 0.5),
      cfg.maxTicksPerSource,
    )
  }
  pulseContact(id: number, target: Phaser.GameObjects.GameObject, damage: number): HitResult {
    return this.system.pulseContact(id, target, damage)
  }
  knockback(id: number, vx: number, vy: number, durationMs: number): void {
    this.system.applyKnockback(id, vx, vy, durationMs)
  }
  destroyShotsInArc(x: number, y: number, range: number, angle: number, arcRad: number): number {
    return this.system.destroyShotsInArc(x, y, range, angle, arcRad)
  }
  target(id: number): WeaponTarget | null {
    return this.system.weaponTarget(id)
  }
  targets(): WeaponTarget[] {
    return this.system.weaponTargets()
  }
  /**
   * **一次性的固定伤害**：连锁、爆炸溅射、毒伤的一跳。
   * `sourceId` 是「用完就扔」的源（每次事件新分配一个），
   * 所以它不进账本、也没有跨帧去重 —— 同一个源**只该命中同一个目标一次**。
   *
   * ⚠️ **持续存在的源（子弹、挥砍）不要用它。** 那种源的 `sourceId` 会在
   * 几帧内反复落到同一只怪身上（子弹穿过可穿透的肉盾、挥砍贴着砍），
   * 而这条路的 `hitKey` 里带 `frameId`，**跨帧去重不了** ——
   * 结果是「每一帧兑现一次全额伤害」。要走 `contact` / `bulletRayContact`。
   */
  hit(id: number, sourceId: number, amount: number, tick: number | null): HitResult {
    return this.system.weaponHit(id, sourceId, amount, tick)
  }
  slow(id: number, multiplier: number, untilMs: number): void {
    this.system.weaponSlow(id, multiplier, untilMs)
  }
  /**
   * 抓取状态快照。`null` = 没有抓取在跑。**D1 每帧读它**决定冻结 / 镜头 / 表现。
   *
   * 走桥而不是总线：这条交互只有 D1 与 D3 两个当事方，加进 `GameEvents` 要全员同意。
   */
  /** Explicit public enemy commands used by configured boss skills. */
  get skills(): Pick<EnemySystem,
    'skillUnits' | 'setUnitPosition' | 'setUnitHp' | 'setUnitSpeedBoost' |
    'setBossInvulnerable' | 'setBossControlled' | 'setBossManualAttacks' | 'setUnitStunned' | 'setBossAppearance' |
    'fireBossVolley' | 'clearBossShots' | 'skillDamage' | 'summonSkillEnemy' | 'spawnBossClone' | 'despawnSkillUnit' | 'transformMinions' | 'setUnitRally' | 'setUnitLaugh' | 'setBossSkillAnimation' | 'setUnitAnimationPaused'> {
    return this.system
  }
  grabStatus() {
    return this.system.grabStatus()
  }
  /** 玩家按下一次攻击键（挣脱连点）。只在吸附阶段有效。 */
  grabPress(): void {
    this.system.grabPress()
  }
  /**
   * 喂一帧的**渲染 delta** —— 抓取期间的「电影时间」。
   *
   * ⚠️ 不能用 `clock.nowMs`：抓取期间世界冻结，逻辑时钟停在那一刻（咬人永远到不了点）。
   * 渲染 delta 在切走标签页时也会停（rAF 停），所以玩家不会在看不见的时候被咬。
   */
  tickGrab(deltaMs: number): void {
    this.system.tickGrab(deltaMs)
  }
  /** D1 的兜底：把解不开的抓取强制拆掉（见 `EnemySystem.abortGrab`）。 */
  abortGrab(): void {
    this.system.abortGrab()
  }
  spawnBoss(
    stage: number, layer: number, bossId: string, x: number, y: number, maxHp: number,
    finalBoss = false, damageMultiplier = 1, eliteBoss = false, speedMultiplier = 1,
  ): void {
    this.system.requestBoss(
      stage, layer, bossId, x, y, maxHp, finalBoss, damageMultiplier,
      eliteBoss, this.cfg.encounter.eliteBossRadius, this.cfg.encounter.eliteBossVisualScale,
      speedMultiplier,
    )
  }
  bossStatus(stage: number) {
    return this.system.bossStatus(stage)
  }
  isEliteBoss(id: number): boolean {
    return this.system.isEliteBoss(id)
  }
  eliteBossProfile(): number | null {
    return this.system.eliteBossProfile()
  }
  setMinionCap(maxAlive: number | null): void {
    this.system.setMinionCap(maxAlive)
  }
  get minionPopulation(): number {
    return this.system.minionPopulation
  }
  touchPlayer(enemy: Phaser.GameObjects.GameObject): void {
    this.system.playerContact(enemy)
  }
  release(id: number): void {
    this.system.releaseBullet(id)
  }
  position(id: number): { x: number; y: number } | null {
    const view = this.system.entryOf(id)?.view
    return view ? { x: view.body.center.x, y: view.body.center.y } : null
  }
  spawn(kind: EnemyKind, gen: number, x: number, y: number, delayMs = 0): void {
    this.system.requestSpawn(kind, gen, x, y, 'debug', delayMs)
  }
  simulateClear(): void {
    this.system.killAll()
  }
  clearLiquid(): void {
    this.system.clearLiquid()
  }
  clearVortices(): void { this.system.clearVortices() }
  despawnAll(): void { this.system.despawnAll() }
  /** BOSS 死亡时清掉剩余小怪（召唤物 / 分裂子代 / 影分身），保留首领自己的死亡动画。 */
  despawnMinions(): void { this.system.despawnMinions() }
  collidesWithUnits(enemy: Phaser.GameObjects.GameObject): boolean {
    const model = (enemy as { model?: { id: number } }).model
    return model ? this.system.collidesWithUnits(model.id) : true
  }
  get remaining(): number {
    return this.system.pool.live + this.system.spawns.length
  }
  get trackedSources(): number {
    return this.system.contactsTracked
  }
  get ledgerPairs(): number {
    return this.system.ledger.entryCount
  }
  /** 每渲染帧同步敌人本体的黑暗可见性；技能绘图面共用同一张光罩。 */
  applyLightVisibility(light: LightPort | null): void {
    this.system.applyLightVisibility(light)
  }

  update(dt: number): void {
    this.juice.update(dt)
  }
  destroy(): void {
    this.unsub()
    this.juice.shutdown()
    this.system.shutdown()
  }
}
