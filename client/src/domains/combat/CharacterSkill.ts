import Phaser from 'phaser'
import { allocActorId } from '@/core/actor/ActorModel'
import { SKILL_ART } from '@/core/assetManifest'
import { textureKeyFor } from '@/core/assets'
import type { GameClock } from '@/core/time'
import type { CharacterSkillConfig } from './config'
import type { EnemyBridge } from './EnemyBridge'
import type { Player } from './Player'
import type { TerrainMap } from './TerrainMap'
import { segmentHit, type WeaponTarget } from './WeaponMechanics'

export interface SkillStatus {
  name: string
  level: number
  state: string
  detail: string
  ready: boolean
}

interface SkillBook {
  image: Phaser.GameObjects.Image
  halo: Phaser.GameObjects.Arc
  expiresAt: number
  nextFireAt: number
}

interface DashState {
  startX: number
  startY: number
  dirX: number
  dirY: number
  distance: number
  startedAt: number
  hitIds: Set<number>
  lastX: number
  lastY: number
}

interface SkillDeps {
  scene: Phaser.Scene
  clock: GameClock
  player: Player
  enemies: EnemyBridge
  terrain: TerrainMap
  setTemporaryAttackSpeed: (pct: number) => void
}

/**
 * 三个角色共用的主动技能运行时。
 *
 * 技能等级只决定当前传入的数值和是否拥有最终机制；这里不认识 D4 的存档结构。
 */
export class CharacterSkill {
  private nextReadyAt = 0
  private buffUntil = 0
  private buffAttackSpeedPct = 0
  private charges = 1
  private rechargeAt = Infinity
  private readonly books: SkillBook[] = []
  private dash: DashState | null = null

  constructor(
    private readonly deps: SkillDeps,
    private readonly cfg: CharacterSkillConfig,
  ) {
    if (cfg.kind === 'summon') this.charges = Math.max(1, cfg.maxCharges)
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
    if (this.cfg.kind === 'summon') return this.activateSummon(aim, now)
    if (now < this.nextReadyAt) return false
    if (this.cfg.kind === 'haste') return this.activateHaste(now)
    return this.activateDash(aim, now)
  }

  update(nowMs: number): void {
    if (this.deps.clock.paused || this.deps.clock.frozen) return
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
    while (this.books.length > 0) this.destroyBook(this.books.length - 1)
  }

  status(): SkillStatus {
    const now = this.deps.clock.nowMs
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

  destroy(): void {
    this.clearRoom()
    this.buffUntil = 0
    this.buffAttackSpeedPct = 0
    this.deps.setTemporaryAttackSpeed(0)
  }

  private activateHaste(now: number): boolean {
    this.buffAttackSpeedPct = this.cfg.attackSpeedPct
    this.buffUntil = now + this.cfg.durationMs
    this.nextReadyAt = now + this.cfg.cooldownMs
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
      if (this.deps.terrain.crossesSolid(start, candidate, player.model.stats.radius)) break
      safeDistance = distance
    }
    this.dash = {
      startX: start.x,
      startY: start.y,
      dirX,
      dirY,
      distance: safeDistance,
      startedAt: now,
      hitIds: new Set(),
      lastX: start.x,
      lastY: start.y,
    }
    player.body.stop()
    player.model.protectedUntilMs = Math.max(
      player.model.protectedUntilMs,
      now + this.cfg.iframeMs,
    )
    this.nextReadyAt = now + this.cfg.cooldownMs
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
    const x = dash.startX + dash.dirX * travelled
    const y = dash.startY + dash.dirY * travelled
    const from = { x: dash.lastX, y: dash.lastY }
    const to = { x, y }
    for (const target of this.deps.enemies.targets()) {
      if (dash.hitIds.has(target.id)) continue
      if (segmentHit(from, to, target, this.deps.player.model.stats.radius) === null) continue
      dash.hitIds.add(target.id)
      this.deps.enemies.hit(target.id, allocActorId(), this.cfg.dashDamage, null)
    }
    this.deps.player.body.reset(x, y)
    dash.lastX = x
    dash.lastY = y
    if (t < 1) return

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
      this.rechargeAt = now + this.cfg.cooldownMs
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
    this.rechargeAt = this.charges < this.cfg.maxCharges ? now + this.cfg.cooldownMs : Infinity
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
}
