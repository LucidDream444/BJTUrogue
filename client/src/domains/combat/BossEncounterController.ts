import Phaser from 'phaser'
import { Rng } from '@/core/rng'
import type { EnemyKind } from '@/core/events'
import { textureKeyFor } from '@/core/assets'
import { bossArt } from '@/domains/enemies/presentation/bossArt'
import { BossSkillRuntime, type BossSkillPort, type BossSkillsTable } from './BossSkillRuntime'
import { HeartDemonRuntime, type ShadowWeapon } from './HeartDemonRuntime'
import { BossHazardView } from './presentation/BossHazardView'
import type { CombatSession } from './CombatSession'
import { bossArenaContainsCircle, bossArenaPoint } from './BossArenaBounds'
import type { BossHazardCommand } from './BossHazards'

const LABELS: Readonly<Record<string, string>> = {
  campus_slow: '课业重压 · 全场减速',
  paper_summon: '作业堆积 · 纸团召唤',
  radial: '考卷环形弹幕',
  triangle: '三连瞬移 · 警惕连线',
  haste: '纸鸢加速',
  acid_pools: '酸蚀溶液 · 离开绿圈',
  water_pools: '湿滑水面 · 直线滑行',
  ricochet_charge: '无敌反弹冲撞',
  leap_slam: '预警跃击 · 躲开落点',
  clones: '分身点名 · 找出真身',
  transmute: '全场怪物变形',
  rally: '大笑 · 怪群加速',
  blue_barrage: '蓝色连环弹幕',
  mimic_chain: '心魔 · 借用梦魇',
  rewind: '时间倒转',
  player_shadow: '心魔 · 玩家之影',
}
export interface BossEncounterOptions {
  bounds(): { left: number; top: number; right: number; bottom: number }
  sfxVolume(): number
}

/** Scene adapter for boss skills. All timing and effects follow the existing game clock. */
export class BossEncounterController {
  readonly runtime: BossSkillRuntime
  readonly heart: HeartDemonRuntime
  readonly port: BossSkillPort
  private readonly view: BossHazardView
  private readonly screen: Phaser.GameObjects.Graphics
  private readonly caption: Phaser.GameObjects.Text
  private readonly weapon: Phaser.GameObjects.Image
  private readonly ghost: Phaser.GameObjects.Sprite
  private flight: {
    x: number
    y: number
    toX: number
    toY: number
    start: number
    end: number
    height: number
  } | null = null
  private lastAt = 0
  private bossId: number | null = null
  private redAlpha = 0
  private captionUntil = 0
  private weaponOwner: number | null = null
  private disposed = false
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly session: CombatSession,
    readonly config: BossSkillsTable,
    private readonly options: BossEncounterOptions,
  ) {
    const e = session.enemies.skills
    this.screen = scene.add.graphics().setDepth(9000)
    this.caption = scene.add
      .text(0, 0, '', {
        fontSize: 22,
        color: '#fff4d8',
        backgroundColor: '#241831',
        padding: { x: 12, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(8000)
      .setVisible(false)
    this.weapon = scene.add
      .image(0, 0, textureKeyFor(scene, session.weapon.artKey))
      .setVisible(false)
      .setDepth(8001)
    this.ghost = scene.add
      .sprite(0, 0, textureKeyFor(scene, bossArt(5, false).key), 0)
      .setVisible(false)
      .setDepth(8002)
    this.port = {
      rng: new Rng(session.cfg.arena.seed),
      damageMultiplier:
        session.bundle.difficulty.difficulties[session.difficulty].enemyDamage *
        session.cfg.encounter.bossDamageMultiplier,
      normalEnemyKinds: Object.keys(session.bundle.enemies.enemies) as EnemyKind[],
      units: () => e.skillUnits(),
      player: () => ({
        id: session.player.model.id,
        x: session.player.x,
        y: session.player.y,
        radius: session.player.model.stats.radius,
        alive: session.player.model.alive,
        player: true,
        vx: session.player.body.velocity.x,
        vy: session.player.body.velocity.y,
      }),
      bounds: options.bounds,
      safeSpawn: (x, y, r) => this.safePoint(x, y, r),
      projectileBlocked: (x1, y1, x2, y2, r) =>
        session.terrain.crossesSolid({ x: x1, y: y1 }, { x: x2, y: y2 }, r),
      setUnitPosition: (id, x, y) => this.placeUnit(id, x, y),
      setUnitHp: (id, hp) => e.setUnitHp(id, hp),
      setUnitSpeedBoost: (id, m, until) => {
        e.setUnitSpeedBoost(id, m, until)
      },
      setBossInvulnerable: (id, until) => {
        e.setBossInvulnerable(id, until)
      },
      setBossControlled: (id, until) => {
        e.setBossControlled(id, until)
      },
      setUnitStunned: (id, until) => {
        e.setUnitStunned(id, until)
      },
      setBossAppearance: (id, a) => {
        e.setBossAppearance(
          id,
          a.playerTextureKey && a.visualScale
            ? { ...a, visualScale: a.visualScale * Math.abs(session.player.sprite.scaleX) }
            : a,
        )
      },
      fireBossVolley: (id, volley) => e.fireBossVolley(id, volley),
      summonSkillEnemy: (kind, gen, x, y) => {
        const definitions = session.bundle.enemies.enemies
        const def = kind === 'splitter'
          ? definitions.splitter.generations[gen] ?? definitions.splitter.generations[0]!
          : definitions[kind]
        return this.canPlace(x, y, def.radius * def.visualScale)
          ? e.summonSkillEnemy(kind, gen, x, y) : null
      },
      spawnBossClone: (id, x, y, hp) => {
        const owner = e.skillUnits().find((unit) => unit.id === id)
        return owner && this.canPlace(x, y, owner.radius) ? e.spawnBossClone(id, x, y, hp) : null
      },
      despawnSkillUnit: (id) => e.despawnSkillUnit(id),
      transformMinions: (kind) => e.transformMinions(kind),
      playerSlow: (m, until) => {
        session.bossSpeedMultiplier = m
        session.bossSlowUntilMs = until
      },
      rallyMinion: (id, until) => {
        e.setUnitRally(id, until)
      },
      damage: (id, damage, sourceId, hitKey) => this.damage(id, damage, sourceId, hitKey),
      onCast: (id, floor, skillId, until) => {
        this.caption.setText(LABELS[skillId] ?? skillId).setVisible(true)
        this.captionUntil = Math.max(until, session.clock.nowMs + 1200)
        const u = e.skillUnits().find((u) => u.id === id)
        if (u) {
          this.caption.setPosition(u.x, u.y - u.radius - 95)
          if (!this.canPlace(u.x, u.y, u.radius)) {
            const safe = this.safePoint(u.x, u.y, u.radius)
            this.placeUnit(u.id, safe.x, safe.y)
          }
        }
        if (u && skillId === 'leap_slam') {
          const spec = config.bosses[String(floor)]!.skills.find((s) => s.id === skillId)!
          const slam = this.runtime.hazards.snapshot.find(
            (f) => f.kind === 'slam' && f.sourceId === id,
          )
          if (slam && slam.kind === 'slam') {
            this.flight = {
              x: u.x,
              y: u.y,
              toX: slam.x,
              toY: slam.y,
              start: session.clock.nowMs + Number(spec.warningMs),
              end: slam.activatesMs,
              height: Number(spec.flightHeight),
            }
            this.ghost
              .setTexture(textureKeyFor(scene, bossArt(floor, false).key), 0)
              .setScale(
                session.bundle.enemies.enemies.tank.visualScale *
                  session.cfg.encounter.bossVisualScaleMultiplier,
              )
              .setTint(u.bossStage === 8 ? 0x333333 : 0xffffff)
          }
        }
      },
      onLaugh: (id, until) => {
        e.setUnitLaugh(id, until)
        this.tone(false)
      },
    }
    this.runtime = new BossSkillRuntime(config, this.port)
    this.view = new BossHazardView(scene, this.runtime.hazards)
    this.heart = new HeartDemonRuntime(config, {
      ...this.port,
      weaponSnapshot: () => this.weaponSnapshot(),
      playerStun: (until) => {
        session.bossStunnedUntilMs = until === 0 ? 0 : Math.max(session.bossStunnedUntilMs, until)
      },
      screenRewind: (active, alpha) => {
        this.redAlpha = active ? alpha : 0
        if (active) {
          this.flight = null
          this.ghost.setVisible(false)
        }
        for (const u of e.skillUnits()) e.setUnitAnimationPaused(u.id, active)
      },
      tickSound: () => this.tone(true),
      shadowWeapon: (w, id) => {
        this.weaponOwner = w ? id : null
        this.weapon.setVisible(w !== null)
        if (w)
          this.weapon
            .setTexture(textureKeyFor(scene, w.artKey))
            .setTint(0xaaaaaa)
            .setDisplaySize(70, 35)
      },
      castBorrowed: (id, floor, skill, now) => this.runtime.castSkill(id, floor, skill, now),
      cancelBorrowed: () => this.runtime.clear(),
    })
  }
  update(stage: number): void {
    if (this.disposed) return
    const clock = this.session.clock,
      now = clock.nowMs
    if (clock.paused || clock.frozen) {
      this.lastAt = now
      return
    }
    const boss = this.port.units().find((u) => u.bossStage === stage)
    if (!boss) {
      if (this.bossId !== null) this.clear()
      this.lastAt = now
      return
    }
    this.bossId = boss.id
    const dt = Math.max(0, Math.min(1000 / 30, now - this.lastAt))
    this.lastAt = now
    this.session.bossForcedVelocity = null
    const commands = this.runtime.update(now, dt, boss.id, stage)
    for (const command of commands) this.apply(command)
    // The paper kite's basic ring is owned by the configured scheduler.
    if (stage === 3) this.session.enemies.skills.setBossManualAttacks(boss.id, true)
    if (stage === 8) this.heart.update(now, dt, boss.id)
    this.view.update(now)
    this.ghost.setVisible(false)
    if (this.flight && now >= this.flight.start && now < this.flight.end) {
      const f = this.flight,
        t = (now - f.start) / (f.end - f.start)
      this.ghost
        .setVisible(true)
        .setPosition(
          f.x + (f.toX - f.x) * t,
          f.y + (f.toY - f.y) * t - Math.sin(t * Math.PI) * f.height,
        )
    }
    if (this.flight && now >= this.flight.end) this.flight = null
    this.caption.setVisible(now < this.captionUntil)
    this.screen.clear()
    if (this.redAlpha > 0) {
      const camera = this.scene.cameras.main,
        p = camera.getWorldPoint(0, 0)
      this.screen.setPosition(p.x, p.y).setScale(1 / camera.zoom)
      this.screen
        .fillStyle(0xc01025, this.redAlpha)
        .fillRect(0, 0, this.scene.scale.width, this.scene.scale.height)
    }
    if (this.weaponOwner !== null) {
      const owner = this.port.units().find((u) => u.id === this.weaponOwner),
        p = this.port.player()
      if (owner) {
        const angle = Math.atan2(p.y - owner.y, p.x - owner.x)
        this.weapon
          .setPosition(owner.x + Math.cos(angle) * 45, owner.y + Math.sin(angle) * 45)
          .setRotation(angle)
          .setFlipY(Math.cos(angle) < 0)
      }
    }
  }
  private apply(command: BossHazardCommand): void {
    const player = this.session.player,
      now = this.session.clock.nowMs
    if (command.type === 'damage')
      this.damage(command.id, command.damage, command.sourceId, command.hitKey)
    else if (command.type === 'stun') {
      if (command.id === player.model.id)
        this.session.bossStunnedUntilMs = Math.max(this.session.bossStunnedUntilMs, command.untilMs)
      else this.port.setUnitStunned(command.id, command.untilMs)
    } else if (command.id === player.model.id) {
      // Arcade integrates the velocity; never also reset to the already integrated hazard point.
      this.session.bossForcedVelocity = { x: command.vx, y: command.vy }
    } else {
      this.port.setUnitStunned(command.id, now + 1000 / 30)
      const from = this.port.units().find((u) => u.id === command.id)
      if (from && !this.port.projectileBlocked(from.x, from.y, command.x, command.y, from.radius))
        this.port.setUnitPosition(command.id, command.x, command.y)
    }
  }
  private canPlace(x: number, y: number, radius: number): boolean {
    return bossArenaContainsCircle(x, y, radius, this.options.bounds()) &&
      this.session.terrain.isWalkable(x, y, radius)
  }
  private placeUnit(id: number, x: number, y: number): boolean {
    const unit = this.session.enemies.skills.skillUnits().find((unit) => unit.id === id)
    // Ground effects may use a smaller clear center. Entities never inherit that fallback:
    // an invalid landing or an old out-of-room rewind snapshot leaves the unit in place.
    return unit && this.canPlace(x, y, unit.radius)
      ? this.session.enemies.skills.setUnitPosition(id, x, y) : false
  }
  private safePoint(x: number, y: number, radius: number): { x: number; y: number } {
    const terrain = this.session.terrain,
      bounds = this.options.bounds()
    const point = bossArenaPoint(x, y, radius, bounds, terrain.cellSize, (px, py, r) =>
      terrain.isWalkable(px, py, r),
    )
    if (point) return point
    // Oversized ground fields may overlap furniture, while their center stays on the floor.
    const center = bossArenaPoint(
      x,
      y,
      this.session.player.model.stats.radius,
      bounds,
      terrain.cellSize,
      (px, py, r) => terrain.isWalkable(px, py, r),
    )
    return center ?? { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 }
  }
  private damage(id: number, amount: number, sourceId: number, hitKey: string): void {
    const { clock, player } = this.session
    if (id === player.model.id)
      player.model.takeHit({
        sourceId,
        amount,
        hitKey,
        mode: 'instant',
        sourceKind: 'aoe',
        frameId: clock.frameId,
        nowMs: clock.nowMs,
      })
    else this.session.enemies.skills.skillDamage(id, amount, sourceId, hitKey)
  }
  private weaponSnapshot(): ShadowWeapon {
    const s = this.session,
      w = s.weapon,
      stats = s.stats
    return {
      textureKey: this.playerSnapshot(),
      artKey: w.artKey,
      damage: stats.damage,
      cooldownMs: stats.cooldownMs,
      speed: stats.bulletSpeed,
      radius: s.cfg.projectiles.radius,
      lifetimeMs: stats.lifeMs,
      pellets: stats.pellets,
      spreadDeg: stats.spreadDeg,
      color: w.color,
    }
  }
  private playerSnapshot(): string {
    const player = this.session.player,
      layers = player.appearanceLayers()
    const boxes = layers.map((layer) => layer.getBounds())
    const left = Math.min(...boxes.map((b) => b.left)),
      top = Math.min(...boxes.map((b) => b.top))
    const right = Math.max(...boxes.map((b) => b.right)),
      bottom = Math.max(...boxes.map((b) => b.bottom))
    const scale = Math.abs(player.sprite.scaleX)
    const width = Math.max(1, Math.ceil((right - left) / scale)),
      height = Math.max(1, Math.ceil((bottom - top) / scale))
    const key = `${player.sprite.texture.key}__boss_body_snapshot`
    const texture = this.scene.textures.exists(key)
      ? (this.scene.textures.get(key) as Phaser.Textures.CanvasTexture)
      : this.scene.textures.createCanvas(key, width, height)
    if (!texture) return player.sprite.texture.key
    texture.setSize(width, height)
    const ctx = texture.context
    ctx.clearRect(0, 0, width, height)
    for (const layer of layers) {
      const frame = layer.frame
      ctx.save()
      ctx.translate((layer.x - left) / scale, (layer.y - top) / scale)
      ctx.rotate(layer.rotation)
      ctx.scale(
        (layer.scaleX / scale) * (layer.flipX ? -1 : 1),
        (layer.scaleY / scale) * (layer.flipY ? -1 : 1),
      )
      ctx.drawImage(
        frame.source.image as CanvasImageSource,
        frame.cutX,
        frame.cutY,
        frame.cutWidth,
        frame.cutHeight,
        -layer.displayOriginX,
        -layer.displayOriginY,
        frame.cutWidth,
        frame.cutHeight,
      )
      ctx.restore()
    }
    const image = ctx.getImageData(0, 0, width, height)
    for (let i = 0; i < image.data.length; i += 4) {
      const v =
        (image.data[i]! * 0.299 + image.data[i + 1]! * 0.587 + image.data[i + 2]! * 0.114) * 0.55
      image.data[i] = image.data[i + 1] = image.data[i + 2] = v
    }
    ctx.putImageData(image, 0, 0)
    texture.refresh()
    return key
  }
  private tone(tick: boolean): void {
    const sound = this.scene.sound as Phaser.Sound.WebAudioSoundManager
    if (this.scene.sound.locked || !('context' in sound) || this.options.sfxVolume() <= 0) return
    const context = sound.context,
      osc = context.createOscillator(),
      gain = context.createGain(),
      now = context.currentTime
    const feedback = (
      this.scene.cache.json.get('boss-skills.json') as {
        feedback: { tickHz: number; laughHz: number; toneDurationMs: number; toneGain: number }
      }
    ).feedback
    if (
      !feedback ||
      ![feedback.tickHz, feedback.laughHz, feedback.toneDurationMs, feedback.toneGain].every(
        Number.isFinite,
      )
    )
      return
    osc.type = tick ? 'square' : 'sine'
    osc.frequency.value = tick ? feedback.tickHz : feedback.laughHz
    gain.gain.setValueAtTime(feedback.toneGain * this.options.sfxVolume(), now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + feedback.toneDurationMs / 1000)
    osc.connect(gain)
    gain.connect(sound.destination)
    osc.start(now)
    osc.stop(now + feedback.toneDurationMs / 1000)
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
    }
  }
  clear(): void {
    this.runtime.clear()
    this.heart.clear()
    this.session.resetBossPlayerControl()
    this.view.update(this.session.clock.nowMs)
    this.bossId = null
    this.redAlpha = 0
    this.screen.clear()
    this.caption.setVisible(false)
    this.weapon.setVisible(false)
    this.weaponOwner = null
    this.flight = null
    this.ghost.setVisible(false)
  }
  destroy(): void {
    if (this.disposed) return
    this.clear()
    this.disposed = true
    this.view.destroy()
    this.screen.destroy()
    this.caption.destroy()
    this.weapon.destroy()
    this.ghost.destroy()
  }
}
