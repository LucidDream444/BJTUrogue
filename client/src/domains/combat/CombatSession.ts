import Phaser from 'phaser'
import { GameClock } from '@/core/time'
import { Rng } from '@/core/rng'
import { TypedBus, type Unsubscribe } from '@/core/events'
import { allocActorId } from '@/core/actor/ActorModel'
import type { ConfigBundle, Difficulty } from '@/core/config'
import { Player } from './Player'
import { planReplacement } from './WeaponInventory'
import { TerrainMap } from './TerrainMap'
import { StageColliders } from './StageColliders'
import { stageGeometry, type StageCollisionConfig } from './StageGeometry'
import { EnemyBridge } from './EnemyBridge'
import { Weapons } from './Weapons'
import { CombatFeedback } from './CombatFeedback'
import { CombatAudio } from './CombatAudio'
import { RewardRun } from './RewardRun'
import { RecoveryDrops } from './RecoveryDrops'
import {
  deriveStats,
  type CombatConfig,
  type RewardDef,
  type WeaponDef,
  type WeaponId,
  type EffectiveStats,
} from './config'
import type { CombatEvents } from './events'
export type PauseReason =
  'user' | 'hidden' | 'reward' | 'preview' | 'death' | 'intermission' | 'victory'
/** Gameplay component: no imports from the arena/test harness. */
export class CombatSession {
  readonly clock = new GameClock()
  readonly bus = new TypedBus<CombatEvents>()
  readonly runId = `run-${allocActorId()}`
  readonly terrain: TerrainMap
  private readonly stageColliders: StageColliders
  readonly player: Player
  readonly enemies: EnemyBridge
  readonly weapons: Weapons
  readonly drops: RecoveryDrops
  readonly rewards: RewardRun
  readonly feedback: CombatFeedback
  private readonly audio: CombatAudio
  readonly reasons = new Set<PauseReason>()
  private readonly unsubs: Unsubscribe[] = []
  private readonly waterZones: Phaser.GameObjects.Zone[] = []
  private readonly waterColliders: Phaser.Physics.Arcade.Collider[] = []
  private previousFeet!: { x: number; y: number }
  private readonly playerCollider: Phaser.Physics.Arcade.Collider
  private readonly aim = new Phaser.Math.Vector2()
  readonly inventory: WeaponId[] = ['pencil']
  private readonly weaponRng = new Rng((20261014 ^ (Date.now() >>> 0)) >>> 0)
  weapon: WeaponDef
  stats: EffectiveStats
  kills = 0
  private dead = false
  private disposed = false
  constructor(
    private readonly scene: Phaser.Scene,
    readonly bundle: ConfigBundle,
    readonly cfg: CombatConfig,
    readonly rewardDefs: RewardDef[],
    readonly difficulty: Difficulty,
    private readonly stageConfig: StageCollisionConfig,
  ) {
    this.terrain = new TerrainMap(cfg, stageConfig.navigationCellSize)
    const firstRoom = stageGeometry(stageConfig, 1, cfg.arena.width, cfg.arena.height)
    this.terrain.setStage(firstRoom)
    const spawn = this.terrain.safeSpawn(
      firstRoom.playerSpawn.x,
      firstRoom.playerSpawn.y,
      bundle.balance.baseline.player.radius,
    )
    this.weapon = cfg.weapons[0]!
    this.rewards = new RewardRun(rewardDefs, new Rng(cfg.arena.seed))
    this.stats = deriveStats(bundle.balance, cfg, this.weapon, rewardDefs, this.rewards.stacks)
    scene.physics.world.resume()
    scene.physics.world.setBounds(0, 0, cfg.arena.width, cfg.arena.height)
    this.player = new Player(scene, this.clock, cfg, bundle.balance, this.bus, spawn.x, spawn.y)
    this.previousFeet = { x: this.player.x, y: this.player.feetY }
    const largestEnemyRadius = Math.max(
      bundle.enemies.enemies.tank.radius,
      bundle.enemies.stage2Boss.radius,
      ...bundle.enemies.enemies.splitter.generations.map((g) => g.radius),
    )
    this.player.setWeapon(this.weapon)
    this.enemies = new EnemyBridge(
      scene,
      this.bus,
      this.clock,
      bundle,
      difficulty,
      () => this.player.view(),
      cfg.arena.seed,
      {
        originX: 0,
        originY: 0,
        cellSize: this.terrain.cellSize,
        cols: Math.ceil(cfg.arena.width / this.terrain.cellSize),
        rows: Math.ceil(cfg.arena.height / this.terrain.cellSize),
        isWalkable: (x, y) => this.terrain.isWalkable(x, y, largestEnemyRadius),
        safeSpawn: (x, y, radius) => this.terrain.safeSpawn(x, y, radius),
        projectileBlocked: (x0, y0, x1, y1, radius) =>
          x1 < radius ||
          y1 < radius ||
          x1 > this.terrain.width - radius ||
          y1 > this.terrain.height - radius ||
          this.terrain.crossesSolid({ x: x0, y: y0 }, { x: x1, y: y1 }, radius),
      },
    )
    for (const rect of this.terrain.water) {
      const zone = scene.add.zone(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
        rect.width,
        rect.height,
      )
      scene.physics.add.existing(zone, true)
      this.waterZones.push(zone)
      this.waterColliders.push(scene.physics.add.collider(this.enemies.group, zone))
    }
    // Non-pushable by enemies, but still separable from static desks and walls.
    this.player.body.setImmovable(false)
    this.player.body.pushable = false
    this.stageColliders = new StageColliders(
      scene,
      this.player.anchor,
      this.enemies.group,
      Math.max(...stageConfig.stages.map((s) => s.solids.length)) + 4,
    )
    this.stageColliders.rebuild(this.terrain)
    this.playerCollider = scene.physics.add.collider(
      this.player.anchor,
      this.enemies.group,
      (_player, enemy) => this.enemies.touchPlayer(enemy as Phaser.GameObjects.GameObject),
    )
    this.audio = new CombatAudio(scene, this.bus, cfg.audio)
    this.weapons = new Weapons(
      scene,
      this.clock,
      cfg,
      new Rng(cfg.arena.seed + 1),
      this.enemies,
      this.player,
      this.terrain,
      () => this.audio.fire(),
    )
    this.feedback = new CombatFeedback(scene, this.bus, this.clock, cfg, (id) =>
      id === this.player.model.id
        ? { x: this.player.x, y: this.player.y }
        : this.enemies.position(id),
    )
    this.drops = new RecoveryDrops(
      scene,
      this.clock,
      cfg.drops,
      this.player,
      new Rng(cfg.arena.seed + 2),
    )
    this.unsubs.push(
      this.bus.on('room_cleared', (e) => {
        if (e.runId !== this.runId || !this.player.model.alive) return
        const options = this.rewards.offer(
          e.roomId,
          this.weapon.id,
          this.player.model.hp,
          this.player.model.maxHp,
          (reward) => this.rewardChanges(reward).length > 0,
        )
        if (options === null) return
        if (options.length) this.pause('reward')
        this.bus.emit('reward_offered', { ...e, ids: options.map((r) => r.id) })
        if (!options.length) this.bus.emit('reward_finished', { ...e, reason: 'empty' })
      }),
      this.bus.on('entity_killed', (e) => {
        if (e.kind === 'enemy') {
          this.kills++
          this.drops.enemyDefeated(e.id, e.x, e.y)
        } else this.dead = true
      }),
    )
    scene.events.on(Phaser.Scenes.Events.PRE_UPDATE, this.beforePhysics, this)
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this)
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this)
    window.addEventListener('blur', this.onBlur)
    document.addEventListener('visibilitychange', this.onVisibility)
  }
  enterStage(stage: number): void {
    const layout = stageGeometry(
      this.stageConfig,
      stage,
      this.cfg.arena.width,
      this.cfg.arena.height,
    )
    this.weapons.clear()
    this.drops.clear()
    this.terrain.setStage(layout)
    this.stageColliders.rebuild(this.terrain)
    const spawn = this.terrain.safeSpawn(
      layout.playerSpawn.x,
      layout.playerSpawn.y,
      this.player.model.stats.radius,
    )
    this.player.clearInput()
    this.player.body.reset(spawn.x, spawn.y)
    this.player.draw()
    this.previousFeet = { x: this.player.x, y: this.player.feetY }
  }

  private onDown(pointer: Phaser.Input.Pointer): void {
    if (pointer.leftButtonDown() && !this.clock.paused && this.player.model.alive)
      this.weapons.firing = true
  }
  private onUp(): void {
    this.weapons.stopFiring()
  }
  private readonly onBlur = (): void => this.pause('hidden')
  private readonly onVisibility = (): void => {
    if (document.hidden) this.pause('hidden')
  }
  private beforePhysics(_time: number, delta: number): void {
    if (!this.clock.paused) this.checkWater()
    const before = this.clock.nowMs
    this.clock.advance(delta)
    if (this.dead) this.pause('death')
    if (this.clock.paused || this.clock.frozen) {
      this.scene.physics.world.pause()
      return
    }
    this.scene.physics.world.resume()
    const pointer = this.scene.input.activePointer
    this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y, this.aim)
    this.player.move(this.clock.nowMs - before, true)
    this.player.aim(this.aim.x, this.aim.y, this.weapons.firing)
    this.player.advanceStamina(this.clock.nowMs - before, this.weapons.firing)
    this.weapons.update(this.stats, this.weapon)
  }
  update(delta: number): void {
    if (!this.clock.paused) this.checkWater()
    if (this.dead) {
      this.pause('death')
      this.weapons.clear()
    }
    this.enemies.update(delta)
    this.drops.update()
    this.player.draw()
    this.weapons.resolveTerrain()
    this.weapons.draw()
    this.feedback.update()
  }
  private checkWater(): void {
    const feet = { x: this.player.x, y: this.player.feetY }
    if (this.player.model.alive && this.terrain.crossesWater(this.previousFeet, feet)) {
      this.player.model.fallIntoWater()
      this.weapons.clear()
      this.pause('death')
    }
    this.previousFeet = feet
  }

  setAudioVolumes(bgm: number, sfx: number): void {
    this.audio.setVolumes(bgm, sfx)
  }

  pause(reason: PauseReason): void {
    if (this.reasons.has(reason)) return
    const already = this.reasons.size > 0
    this.reasons.add(reason)
    this.clock.pause()
    this.scene.physics.world.pause()
    this.player.clearInput()
    this.weapons.stopFiring()
    if (!already) this.bus.emit('app_paused', { reason: reason === 'hidden' ? 'hidden' : 'user' })
  }
  resume(reason: PauseReason): void {
    if (!this.reasons.delete(reason) || this.reasons.size) return
    this.player.clearInput()
    this.weapons.stopFiring()
    this.clock.resume()
    this.scene.physics.world.resume()
    this.bus.emit('app_resumed', {})
  }
  togglePause(): void {
    if (this.reasons.has('hidden')) {
      this.resume('hidden')
      return
    }
    if (this.reasons.has('user')) this.resume('user')
    else this.pause('user')
  }
  equip(id: WeaponId, allowDuringReward = false): boolean {
    if (
      !this.inventory.includes(id) ||
      (!allowDuringReward && this.rewards.roomId) ||
      !this.player.model.alive
    )
      return false
    const weapon = this.cfg.weapons.find((w) => w.id === id)
    if (!weapon) return false
    this.weapons.stopFiring()
    this.weapon = weapon
    this.player.setWeapon(weapon)
    this.recompute()
    return true
  }
  chooseRandomWeaponId(): WeaponId | null {
    const available = this.cfg.weapons.filter((w) => !this.inventory.includes(w.id))
    return available.length ? available[this.weaponRng.between(0, available.length - 1)]!.id : null
  }
  replaceWeapon(slot: number, id: WeaponId): boolean {
    if (!this.player.model.alive || this.clock.paused || this.clock.frozen) return false
    const plan = planReplacement(
      this.inventory,
      slot,
      id,
      this.cfg.weapons.map((w) => w.id),
    )
    if (!plan) return false
    this.weapons.stopFiring()
    this.inventory[slot] = id
    if (!this.equip(id, true)) {
      this.inventory[slot] = plan.dropped
      return false
    }
    this.bus.emit('weapon_replaced', {
      dropped: plan.dropped,
      equipped: id,
      slot,
      x: this.player.x,
      y: this.player.y,
    })
    return true
  }
  equipSlot(slot: number): boolean {
    return this.equip(this.inventory[slot]!)
  }
  cycleWeapon(): boolean {
    if (this.inventory.length < 2) return false
    const next = (this.inventory.indexOf(this.weapon.id) + 1) % this.inventory.length
    return this.equip(this.inventory[next]!)
  }

  pickupWeapon(id: WeaponId): boolean {
    return this.grantWeapon(id)
  }
  pickupPulse(): boolean {
    return this.grantWeapon('pulse')
  }
  grantRandomWeapon(): WeaponDef | null {
    const available = this.cfg.weapons.filter((w) => !this.inventory.includes(w.id))
    if (this.inventory.length >= 2 || !available.length) return null
    const weapon = available[this.weaponRng.between(0, available.length - 1)]!
    this.grantWeapon(weapon.id)
    return weapon
  }
  private grantWeapon(id: WeaponId): boolean {
    if (!this.player.model.alive || this.inventory.length >= 2 || this.inventory.includes(id))
      return false
    const weapon = this.cfg.weapons.find((w) => w.id === id)
    if (!weapon) return false
    this.inventory.push(id)
    this.equip(id, true)
    return true
  }
  private recompute(): void {
    this.stats = deriveStats(
      this.bundle.balance,
      this.cfg,
      this.weapon,
      this.rewardDefs,
      this.rewards.stacks,
    )
    this.player.model.applyStats(this.stats.maxHp, this.stats.moveSpeed, this.stats.iframeMs)
    this.player.applyStaminaLimit(this.stats.maxStamina)
  }
  choose(id: string): boolean {
    if (!this.player.model.alive || !this.reasons.has('reward')) return false
    const roomId = this.rewards.roomId,
      r = this.rewards.choose(id)
    if (!r || roomId === null) return false
    this.recompute()
    this.bus.emit('reward_selected', {
      runId: this.runId,
      roomId,
      rewardId: id,
      stacks: this.rewards.stacks.get(id)!,
    })
    this.resume('reward')
    this.bus.emit('reward_finished', { runId: this.runId, roomId, reason: 'selected' })
    return true
  }
  rewardChanges(r: RewardDef): { label: string; before: string; after: string }[] {
    const next = new Map(this.rewards.stacks)
    next.set(r.id, (next.get(r.id) ?? 0) + 1)
    const after = deriveStats(this.bundle.balance, this.cfg, this.weapon, this.rewardDefs, next)
    const display = (value: number) => Number(value.toFixed(2)).toString()
    const metrics: {
      key: keyof EffectiveStats
      label: string
      format: (value: number) => string
    }[] = [
      { key: 'maxHp', label: '生命上限', format: display },
      { key: 'damage', label: '单颗伤害', format: display },
      { key: 'cooldownMs', label: '每秒攻击次数', format: (v) => display(1000 / v) + ' 次/秒' },
      { key: 'pellets', label: '每次射击弹丸', format: (v) => display(v) + ' 颗' },
      { key: 'maxStamina', label: '能量上限', format: display },
      { key: 'moveSpeed', label: '移动速度', format: (v) => display(v) + ' px/s' },
      { key: 'iframeMs', label: '受击保护', format: (v) => display(v / 1000) + ' 秒' },
      { key: 'bulletSpeed', label: '弹丸速度', format: display },
      { key: 'spreadDeg', label: '散布', format: (v) => display(v) + '°' },
    ]
    return metrics
      .filter((m) => after[m.key] !== this.stats[m.key])
      .map((m) => ({
        label: m.label,
        before: m.format(this.stats[m.key]),
        after: m.format(after[m.key]),
      }))
  }
  rewardDescription(r: RewardDef): string {
    const changes = this.rewardChanges(r).map((c) => c.label + ' ' + c.before + ' → ' + c.after)
    return r.description + '\n' + changes.join('；')
  }
  destroy(): void {
    if (this.disposed) return
    this.disposed = true
    this.scene.events.off(Phaser.Scenes.Events.PRE_UPDATE, this.beforePhysics, this)
    this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this)
    this.scene.input.off(Phaser.Input.Events.POINTER_UP, this.onUp, this)
    window.removeEventListener('blur', this.onBlur)
    document.removeEventListener('visibilitychange', this.onVisibility)
    for (const off of this.unsubs) off()
    this.playerCollider.destroy()
    this.stageColliders.destroy()
    for (const collider of this.waterColliders) collider.destroy()
    for (const zone of this.waterZones) zone.destroy()
    this.audio.destroy()
    this.weapons.destroy()
    this.drops.destroy()
    this.feedback.destroy()
    this.enemies.destroy()
    this.player.destroy()
    this.bus.clear()
  }
}
