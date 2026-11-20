import Phaser from 'phaser'
import { allocActorId } from '@/core/actor/ActorModel'
import { SKILL_ART } from '@/core/assetManifest'
import { textureKeyFor } from '@/core/assets'
import type { GameClock } from '@/core/time'
import type { CharacterSkillConfig } from './config'
import type { EnemyBridge } from './EnemyBridge'
import type { Player } from './Player'
import { segmentHit, type WeaponTarget } from './WeaponMechanics'
import { advanceDashMovement, type MovementVector } from './MovementForces'
import {
  GoosePerformance,
  type PerformanceSnapshot,
  type SongColor,
  type SongEffect,
  songManaSpend,
} from './GoosePerformance'

export interface SkillStatus {
  name: string
  level: number
  state: string
  detail: string
  ready: boolean
  performance?: PerformanceSnapshot
  performanceMana?: {
    current: number
    maximum: number
    songCost: number
  }
}

interface SkillBook {
  image: Phaser.GameObjects.Image
  halo: Phaser.GameObjects.Arc
  expiresAt: number
  nextFireAt: number
}

interface DashState {
  dirX: number
  dirY: number
  distance: number
  startedAt: number
  hitIds: Set<number>
  lastX: number
  lastY: number
  travelled: number
  updatedAt: number
}

interface SkillDeps {
  scene: Phaser.Scene
  clock: GameClock
  player: Player
  enemies: EnemyBridge
  crossesSolid: (from: MovementVector, to: MovementVector, radius: number) => boolean
  setTemporaryAttackSpeed: (pct: number) => void
  setTemporaryMoveSpeed: (pct: number) => void
  setTemporaryDamage: (pct: number) => void
  setSkillShieldCapacity: (amount: number) => void
  restoreSkillShield: (amount: number) => void
}

/**
 * 所有角色共用的主动技能运行时。
 *
 * 技能等级只决定当前传入的数值和是否拥有最终机制；这里不认识 D4 的存档结构。
 */
export class CharacterSkill {
  private cooldownScale = 1
  setCooldownScale(scale:number):void {
    if(scale===this.cooldownScale)return
    const now=this.deps.clock.nowMs,ratio=scale/this.cooldownScale
    if(this.nextReadyAt>now)this.nextReadyAt=now+(this.nextReadyAt-now)*ratio
    if(Number.isFinite(this.rechargeAt)&&this.rechargeAt>now)this.rechargeAt=now+(this.rechargeAt-now)*ratio
    this.performance?.setCooldownScale(scale,now)
    this.cooldownScale=scale
  }
  private nextReadyAt = 0
  private buffUntil = 0
  private buffAttackSpeedPct = 0
  private charges = 1
  private rechargeAt = Infinity
  private readonly books: SkillBook[] = []
  private dash: DashState | null = null
  private externalVelocity: MovementVector = { x: 0, y: 0 }
  private performance: GoosePerformance | null = null
  private performanceMoveSpeedPct = 0
  private performanceDamagePct = 0
  private performanceShieldCapacity = 0

  setExternalVelocity(velocity: MovementVector): void {
    this.externalVelocity = velocity
  }

  constructor(
    private readonly deps: SkillDeps,
    private readonly cfg: CharacterSkillConfig,
  ) {
    if (cfg.kind === 'summon') this.charges = Math.max(1, cfg.maxCharges)
    if (cfg.kind === 'performance') {
      this.performance = new GoosePerformance({
        beatPeriodMs: cfg.beatPeriodMs,
        beatHitWindowMs: cfg.beatHitWindowMs,
        songCooldownMs: cfg.songCooldownMs,
        maxStacks: cfg.maxStacks,
        stackDurationMs: cfg.stackDurationMs,
        redDamage: cfg.redDamage,
        redDamagePerStackPct: cfg.redDamagePerStackPct,
        redRadius: cfg.redRadius,
        damageBonusPctPerStack: cfg.damageBonusPctPerStack,
        moveSpeedPctPerStack: cfg.moveSpeedPctPerStack,
        shieldPerStack: cfg.shieldPerStack,
        blueShieldRestore: cfg.blueShieldRestore,
      })
    }
  }

  activate(aim: { x: number; y: number }): boolean {
    const now = this.deps.clock.nowMs
    if (
      this.deps.clock.paused ||
      this.deps.clock.frozen ||
      !this.deps.player.model.alive
    ) {
      return false
    }
    if (this.cfg.kind === 'performance') {
      if (this.deps.player.stamina <= 0) return false
      const started = this.performance?.start(now) ?? false
      if (started) this.syncPerformanceSupport()
      return started
    }
    if (this.cfg.kind === 'summon') return this.activateSummon(aim, now)
    if (now < this.nextReadyAt) return false
    if (this.cfg.kind === 'haste') return this.activateHaste(now)
    return this.activateDash(aim, now)
  }

  update(nowMs: number): void {
    if (this.deps.clock.paused || this.deps.clock.frozen) return
    if (this.performance) {
      this.performance.update(nowMs)
      if (
        this.performance.isActive &&
        (!this.deps.player.model.alive || this.deps.player.stamina <= 0)
      ) {
        this.performance.stop()
      }
      this.syncPerformanceSupport()
    }
    if (this.dash) this.updateDash(nowMs)
    if (this.buffUntil > 0 && nowMs >= this.buffUntil) {
      this.buffUntil = 0
      this.buffAttackSpeedPct = 0
      this.deps.setTemporaryAttackSpeed(0)
    }
    if (this.cfg.kind !== 'summon') return
    this.updateCharges(nowMs)
    for (let i = this.books.length - 1; i >= 0; i--) {
      const book = this.books[i]!
      if (nowMs >= book.expiresAt) {
        this.destroyBook(i)
        continue
      }
      if (nowMs < book.nextFireAt) continue
      const target = this.nearestTarget(book.image.x, book.image.y)
      if (!target) continue
      book.nextFireAt = nowMs + this.cfg.fireIntervalMs
      this.deps.enemies.hit(target.id, allocActorId(), this.cfg.pageDamage, null)
      this.flashPage(book.image.x, book.image.y, target.x, target.y)
    }
  }

  clearRoom(): void {
    this.performance?.stop()
    this.syncPerformanceSupport()
    while (this.books.length > 0) this.destroyBook(this.books.length - 1)
  }

  status(): SkillStatus {
    const now = this.deps.clock.nowMs
    if (this.cfg.kind === 'performance' && this.performance) {
      const performance = this.performance.snapshot(now)
      const active = performance.active
      const songState = active
        ? 'Space 红歌 · 左键蓝歌 · F1 停止'
        : this.deps.player.stamina > 0
          ? 'Space 开始演奏'
          : '魔力不足'
      return {
        name: this.cfg.name,
        level: this.cfg.level,
        state: active ? `演奏中 · ${songState}` : songState,
        detail: this.cfg.beatHitWindowMs > 0
          ? `红 ${performance.redStacks}/${this.cfg.maxStacks} · 蓝 ${performance.blueStacks}/${this.cfg.maxStacks} · ${this.cfg.beatHitWindowMs}ms 节拍窗`
          : '',
        ready: active || this.deps.player.stamina > 0,
        performance,
        performanceMana: {
          current: this.deps.player.stamina,
          maximum: this.deps.player.maxStamina,
          songCost: this.cfg.manaCost,
        },
      }
    }
    if (this.cfg.kind === 'summon') {
      const charges = `${this.charges} / ${this.cfg.maxCharges}`
      const ready = this.charges > 0
      const recharging =
        this.charges < this.cfg.maxCharges && this.rechargeAt !== Infinity
          ? ` · 下一充能 ${Math.max(0, this.rechargeAt - now) / 1000}s`
          : ''
      return {
        name: this.cfg.name,
        level: this.cfg.level,
        state: ready ? `Space 放置参考书 · 充能 ${charges}` : `充能 ${charges}`,
        detail: `场上 ${this.books.length} 本${recharging}`,
        ready,
      }
    }
    if (this.buffUntil > now) {
      return {
        name: this.cfg.name,
        level: this.cfg.level,
        state: `生效中 · 攻速 +${Math.round(this.buffAttackSpeedPct)}%`,
        detail: `${Math.ceil((this.buffUntil - now) / 1000)} 秒`,
        ready: true,
      }
    }
    if (this.dash) {
      return {
        name: this.cfg.name,
        level: this.cfg.level,
        state: '突进中 · 无敌',
        detail: `${this.cfg.distance}px · 沿途伤害 ${this.cfg.dashDamage}`,
        ready: false,
      }
    }
    const remain = Math.max(0, this.nextReadyAt - now)
    return {
      name: this.cfg.name,
      level: this.cfg.level,
      state: remain > 0 ? `冷却 ${Math.ceil(remain / 1000)} 秒` : 'Space 可释放',
      detail:
        this.cfg.kind === 'haste'
          ? `攻速 +${this.cfg.attackSpeedPct}% · ${this.cfg.durationMs / 1000} 秒`
          : `突进 ${this.cfg.distance}px · 沿途伤害 ${this.cfg.dashDamage}`,
      ready: remain <= 0,
    }
  }

  isDashing(): boolean {
    return this.dash !== null
  }

  isPerforming(): boolean {
    return this.performance?.isActive ?? false
  }

  stopPerformance(): boolean {
    if (!this.performance?.isActive) return false
    this.performance.stop()
    this.syncPerformanceSupport()
    return true
  }

  /** 一次红/蓝歌曲输入。命中节拍才会叠层；未命中只结算该歌曲的保底效果。 */
  playSong(color: SongColor): SongEffect | null {
    const performance = this.performance
    if (!performance) return null
    const now = this.deps.clock.nowMs
    if (!performance.canPress(color, now)) return null
    const available = this.deps.player.stamina
    if (available <= 0) {
      this.stopPerformance()
      return null
    }
    const spent = songManaSpend(available, this.cfg.manaCost)
    if (!this.deps.player.spendStamina(spent)) return null
    const effect = performance.press(color, now)
    if (!effect) return null

    if (effect.color === 'red') {
      const player = this.deps.player
      for (const target of this.deps.enemies.targets()) {
        if (
          Math.hypot(target.x - player.x, target.y - player.y) >
          effect.radius
        ) continue
        this.deps.enemies.hit(target.id, allocActorId(), effect.damage, null)
      }
      this.flashSong(
        0xff5a5a,
        effect.radius,
        player.x,
        player.y,
      )
    } else {
      if (effect.shieldRestore > 0) this.deps.restoreSkillShield(effect.shieldRestore)
      this.flashSong(
        0x58b8ff,
        54,
        this.deps.player.x,
        this.deps.player.y,
      )
    }
    if (this.deps.player.stamina <= 0) this.performance?.stop()
    this.syncPerformanceSupport()
    return effect
  }

  performanceSnapshot(nowMs: number): PerformanceSnapshot | null {
    return this.performance?.snapshot(nowMs) ?? null
  }

  destroy(): void {
    this.performance?.reset()
    this.performance = null
    this.syncPerformanceSupport()
    this.clearRoom()
    this.buffUntil = 0
    this.buffAttackSpeedPct = 0
    this.deps.setTemporaryAttackSpeed(0)
  }

  private activateHaste(now: number): boolean {
    this.buffAttackSpeedPct = this.cfg.attackSpeedPct
    this.buffUntil = now + this.cfg.durationMs
    this.nextReadyAt = now + this.cfg.cooldownMs * this.cooldownScale
    this.deps.setTemporaryAttackSpeed(this.buffAttackSpeedPct)
    return true
  }

  private activateDash(aim: { x: number; y: number }, now: number): boolean {
    const player = this.deps.player
    const dx = aim.x - player.x
    const dy = aim.y - player.feetY
    const length = Math.hypot(dx, dy)
    const dirX = length > 0.001 ? dx / length : 1
    const dirY = length > 0.001 ? dy / length : 0
    const start = { x: player.x, y: player.feetY }
    let safeDistance = 0
    const steps = 12
    for (let i = 1; i <= steps; i++) {
      const distance = (this.cfg.distance * i) / steps
      const candidate = {
        x: start.x + dirX * distance,
        y: start.y + dirY * distance,
      }
      if (this.deps.crossesSolid(start, candidate, player.model.stats.radius)) break
      safeDistance = distance
    }
    this.dash = {
      dirX,
      dirY,
      distance: safeDistance,
      startedAt: now,
      hitIds: new Set(),
      lastX: start.x,
      lastY: start.y,
      travelled: 0,
      updatedAt: now,
    }
    player.body.stop()
    player.model.protectedUntilMs = Math.max(
      player.model.protectedUntilMs,
      now + this.cfg.iframeMs,
    )
    this.nextReadyAt = now + this.cfg.cooldownMs * this.cooldownScale
    this.flashDash(start, {
      x: start.x + dirX * safeDistance,
      y: start.y + dirY * safeDistance,
    })
    return true
  }

  private updateDash(now: number): void {
    const dash = this.dash
    if (!dash) return
    const t = Phaser.Math.Clamp((now - dash.startedAt) / this.cfg.dashMs, 0, 1)
    const travelled = dash.distance * t
    const from = { x: dash.lastX, y: dash.lastY }
    const step = advanceDashMovement(
      from,
      { x: dash.dirX * (travelled - dash.travelled), y: dash.dirY * (travelled - dash.travelled) },
      this.externalVelocity,
      Math.max(0, Math.min(now, dash.startedAt + this.cfg.dashMs) - dash.updatedAt) / 1000,
      (start, end) => this.deps.crossesSolid(start, end, this.deps.player.model.stats.radius),
    )
    const to = step.position
    for (const target of this.deps.enemies.targets()) {
      if (dash.hitIds.has(target.id)) continue
      if (segmentHit(from, to, target, this.deps.player.model.stats.radius) === null) continue
      dash.hitIds.add(target.id)
      this.deps.enemies.hit(target.id, allocActorId(), this.cfg.dashDamage, null)
    }
    this.deps.player.body.reset(to.x, to.y)
    dash.lastX = to.x
    dash.lastY = to.y
    dash.travelled = travelled
    dash.updatedAt = now
    if (t < 1 && !step.blocked) return

    this.dash = null
    if (this.cfg.level >= 4 && dash.hitIds.size > 0) {
      const counted = Math.min(dash.hitIds.size, this.cfg.maxMechanicEnemies)
      this.buffAttackSpeedPct = counted * this.cfg.attackSpeedPerEnemyPct
      this.buffUntil = now + this.cfg.durationMs
      this.deps.setTemporaryAttackSpeed(this.buffAttackSpeedPct)
    }
  }

  private activateSummon(aim: { x: number; y: number }, now: number): boolean {
    if (this.charges <= 0) return false
    this.charges -= 1
    if (this.charges < this.cfg.maxCharges && this.rechargeAt === Infinity) {
      this.rechargeAt = now + this.cfg.cooldownMs * this.cooldownScale
    }
    const image = this.deps.scene.add
      .image(aim.x, aim.y, textureKeyFor(this.deps.scene, SKILL_ART.referenceBook))
      .setDisplaySize(38, 38)
      .setDepth(1600)
      .setTint(0xffe0a3)
    const halo = this.deps.scene.add
      .circle(aim.x, aim.y, 24, 0xf0d18b, 0.18)
      .setStrokeStyle(1, 0xf0d18b, 0.65)
      .setDepth(1599)
    this.books.push({ image, halo, expiresAt: now + this.cfg.durationMs, nextFireAt: now + 250 })
    return true
  }

  private updateCharges(now: number): void {
    if (this.charges >= this.cfg.maxCharges || now < this.rechargeAt) return
    this.charges += 1
    this.rechargeAt = this.charges < this.cfg.maxCharges ? now + this.cfg.cooldownMs * this.cooldownScale : Infinity
  }

  private nearestTarget(x: number, y: number): WeaponTarget | null {
    let best: WeaponTarget | null = null
    let bestDistance = this.cfg.range
    for (const target of this.deps.enemies.targets()) {
      const distance = Math.hypot(target.x - x, target.y - y)
      if (distance > bestDistance) continue
      best = target
      bestDistance = distance
    }
    return best
  }

  private destroyBook(index: number): void {
    const book = this.books[index]
    if (!book) return
    book.image.destroy()
    book.halo.destroy()
    this.books.splice(index, 1)
  }

  private flashPage(x0: number, y0: number, x1: number, y1: number): void {
    const g = this.deps.scene.add.graphics().setDepth(1700)
    g.lineStyle(3, 0xf3dfb5, 0.9).lineBetween(x0, y0, x1, y1)
    this.deps.scene.tweens.add({
      targets: g,
      alpha: 0,
      duration: 120,
      onComplete: () => g.destroy(),
    })
  }

  private flashDash(
    start: { x: number; y: number },
    end: { x: number; y: number },
  ): void {
    const g = this.deps.scene.add.graphics().setDepth(1500)
    g.lineStyle(8, 0xf2dfb0, 0.55).lineBetween(start.x, start.y, end.x, end.y)
    this.deps.scene.tweens.add({
      targets: g,
      alpha: 0,
      duration: 160,
      onComplete: () => g.destroy(),
    })
  }

  private syncPerformanceSupport(): void {
    const performance = this.performance
    const moveSpeed = performance
      ? performance.blueStacks * this.cfg.moveSpeedPctPerStack
      : 0
    const damage = performance
      ? performance.redStacks * this.cfg.damageBonusPctPerStack
      : 0
    const shieldCapacity = performance
      ? performance.blueStacks * this.cfg.shieldPerStack
      : 0
    if (moveSpeed !== this.performanceMoveSpeedPct) {
      this.performanceMoveSpeedPct = moveSpeed
      this.deps.setTemporaryMoveSpeed(moveSpeed)
    }
    if (damage !== this.performanceDamagePct) {
      this.performanceDamagePct = damage
      this.deps.setTemporaryDamage(damage)
    }
    if (shieldCapacity !== this.performanceShieldCapacity) {
      this.performanceShieldCapacity = shieldCapacity
      this.deps.setSkillShieldCapacity(shieldCapacity)
    }
  }

  private flashSong(
    color: number,
    radius: number,
    x: number,
    y: number,
  ): void {
    const ring = this.deps.scene.add
      .circle(x, y, Math.max(8, radius), color, 0.05)
      .setStrokeStyle(3, color, 0.72)
      .setDepth(1700)
    this.deps.scene.tweens.add({
      targets: ring,
      scale: 1.06,
      alpha: 0,
      duration: 180,
      onComplete: () => ring.destroy(),
    })
  }
}
