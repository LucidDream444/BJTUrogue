import type Phaser from 'phaser'
import { EnemySystem, type EnemySystemNavOptions } from '@/domains/enemies/EnemySystem'
import { JuiceDirector } from '@/domains/enemies/presentation/JuiceDirector'
import type { GameClock } from '@/core/time'
import type { TypedBus, Unsubscribe, EnemyKind, GameEvents } from '@/core/events'
import type { ConfigBundle, Difficulty } from '@/core/config'
import type { HitResult, TickTarget } from '@/core/actor/damage'
import type { CombatEvents } from './events'
export interface PlayerPort {
  model: TickTarget
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  alive: boolean
}
export interface BulletContactPort {
  group: Phaser.Physics.Arcade.Group
  contact(id: number, target: Phaser.GameObjects.GameObject, damage: number): HitResult
  meleeContact(id: number, target: Phaser.GameObjects.GameObject, damage: number): HitResult
  pulseContact(id: number, target: Phaser.GameObjects.GameObject, damage: number): HitResult
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
    difficulty: Difficulty,
    player: () => PlayerPort,
    seed: number,
    nav?: EnemySystemNavOptions,
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
      hooks: {
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
  spawnBoss(stage: number, x: number, y: number, maxHp: number, finalBoss = false): void {
    this.system.requestBoss(stage, x, y, maxHp, finalBoss)
  }
  bossStatus(stage: number) {
    return this.system.bossStatus(stage)
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
  get remaining(): number {
    return this.system.pool.live + this.system.spawns.length
  }
  get trackedSources(): number {
    return this.system.contactsTracked
  }
  get ledgerPairs(): number {
    return this.system.ledger.entryCount
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
