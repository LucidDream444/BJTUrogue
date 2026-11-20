import Phaser from 'phaser'
import { Rng } from '@/core/rng'
import type { EnemyKind } from '@/core/events'
import { textureKeyFor } from '@/core/assets'
import { BOSS_ROSTER_ART, NAILONG_SKILL_AUDIO } from '@/core/assetManifest'
import { bossArt } from '@/domains/enemies/presentation/bossArt'
import {
  BossSkillRuntime,
  type BossBarrageConfig,
  type BossBarrageSpec,
  type BossSkillPort,
  type BossVolleyShot,
  type BossSkillUnit,
  type BossSkillVolley,
  type BossSkillsTable,
} from './BossSkillRuntime'
import { HeartDemonRuntime, type ShadowWeapon } from './HeartDemonRuntime'
import { BossHazardView } from './presentation/BossHazardView'
import type { CombatSession } from './CombatSession'
import { bossArenaContainsCircle, bossArenaPoint } from './BossArenaBounds'
import type { BossHazardCommand } from './BossHazards'

/** Sampled outline of 妈 used by 牛来's character-shaped barrage. */
const MA_GLYPH_POINTS: readonly (readonly [number, number])[] = [
  [-0.583,-0.75],[-0.417,-0.75],[-0.583,-0.583],[-0.083,-0.583],[0.083,-0.583],[0.25,-0.583],[0.417,-0.583],[0.583,-0.583],
  [-0.75,-0.417],[-0.583,-0.417],[-0.417,-0.417],[-0.25,-0.417],[-0.083,-0.417],[0.083,-0.417],[0.417,-0.417],[0.583,-0.417],
  [-0.583,-0.25],[-0.25,-0.25],[-0.083,-0.25],[0.083,-0.25],[0.417,-0.25],[0.583,-0.25],
  [-0.583,-0.083],[-0.417,-0.083],[-0.25,-0.083],[-0.083,-0.083],[0.083,-0.083],[0.25,-0.083],[0.417,-0.083],[0.583,-0.083],
  [-0.75,0.083],[-0.583,0.083],[-0.417,0.083],[0.583,0.083],
  [-0.583,0.25],[-0.417,0.25],[-0.083,0.25],[0.083,0.25],[0.25,0.25],[0.417,0.25],[0.583,0.25],
  [-0.583,0.417],[-0.417,0.417],[-0.25,0.417],[0.583,0.417],
  [-0.75,0.583],[-0.583,0.583],[-0.25,0.583],[0.25,0.583],[0.417,0.583],[0.583,0.583],
]
const GUGUGAGA_GLYPH_POINTS: readonly (readonly [number, number])[] = [
  [-0.312,-0.812],[0.688,-0.812],[-0.812,-0.688],[-0.688,-0.688],[-0.562,-0.688],[-0.438,-0.688],[-0.312,-0.688],[-0.188,-0.688],[0.188,-0.688],[0.312,-0.688],[0.438,-0.688],[0.562,-0.688],[0.688,-0.688],[0.812,-0.688],
  [-0.812,-0.562],[-0.688,-0.562],[-0.312,-0.562],[0.188,-0.562],[0.312,-0.562],[0.688,-0.562],[-0.812,-0.438],[-0.688,-0.438],[-0.438,-0.438],[-0.312,-0.438],[-0.188,-0.438],[0.188,-0.438],[0.312,-0.438],[0.562,-0.438],[0.688,-0.438],[0.812,-0.438],
  [-0.812,-0.312],[-0.688,-0.312],[-0.188,-0.312],[0.188,-0.312],[0.312,-0.312],[0.812,-0.312],[-0.438,-0.188],[-0.312,-0.188],[-0.188,-0.188],[0.562,-0.188],[0.688,-0.188],[0.812,-0.188],
  [-0.812,0.188],[-0.688,0.188],[-0.562,0.188],[-0.438,0.188],[-0.312,0.188],[-0.188,0.188],[0.188,0.188],[0.312,0.188],[0.438,0.188],[0.562,0.188],[0.688,0.188],[0.812,0.188],
  [-0.812,0.312],[-0.688,0.312],[-0.562,0.312],[-0.188,0.312],[0.188,0.312],[0.312,0.312],[0.438,0.312],[0.812,0.312],[-0.812,0.438],[-0.688,0.438],[-0.562,0.438],[-0.438,0.438],[-0.312,0.438],[-0.188,0.438],[0.188,0.438],[0.312,0.438],[0.438,0.438],[0.562,0.438],[0.688,0.438],[0.812,0.438],
  [-0.812,0.562],[-0.688,0.562],[-0.438,0.562],[-0.312,0.562],[0.188,0.562],[0.312,0.562],[0.562,0.562],[0.688,0.562],[-0.812,0.688],[-0.688,0.688],[-0.562,0.688],[-0.438,0.688],[0.188,0.688],[0.312,0.688],[0.438,0.688],[0.562,0.688],
  [-0.562,0.812],[-0.438,0.812],[-0.312,0.812],[-0.188,0.812],[0.438,0.812],[0.562,0.812],[0.688,0.812],[0.812,0.812],
]

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
  /** 独立弹幕调度：与技能 `busyUntil` 无关，固定间隔轮换三种弹幕。 */
  private barrageIndex = 0
  private nextBarrageAtMs = 0
  /** 当前弹幕内的连发轮次；与全局间隔分开，避免一整串被长帧吞掉。 */
  private barrageBurst: {
    pattern: BossBarrageSpec
    remaining: number
    fired: number
    nextAt: number
  } | null = null
  /** Clone ids have their own slower barrage clock and rotation. */
  private readonly cloneBarrageNext = new Map<number, number>()
  private readonly cloneBarrageIndex = new Map<number, number>()
  private readonly delayedBarrages: {
    bossId: number
    atMs: number
    followUp: NonNullable<BossBarrageSpec['followUp']>
    color: number
  }[] = []
  /** Final Nailong borrows one random regular boss's barrage table per sequence. */
  private activeBorrowedBarrage: BossBarrageConfig | null = null
  private redAlpha = 0
  private rewindActive = false
  private activeStage = 0
  private weaponOwner: number | null = null
  private disposed = false
  /** 奶龙三段技能语音；每次释放技能随机一段。 */
  private readonly nailongVoices: Phaser.Sound.BaseSound[] = []
  /** 常规首领的技能音效，按 asset key 分组。 */
  private readonly bossSkillAudio = new Map<string, Phaser.Sound.BaseSound[]>()
  private readonly unsubPause: () => void
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly session: CombatSession,
    readonly config: BossSkillsTable,
    private readonly options: BossEncounterOptions,
  ) {
    const e = session.enemies.skills
    this.screen = scene.add.graphics().setDepth(9000)
    this.weapon = scene.add
      .image(0, 0, textureKeyFor(scene, session.weapon.artKey))
      .setVisible(false)
      .setDepth(8001)
    this.ghost = scene.add
      .sprite(0, 0, textureKeyFor(scene, bossArt(5).key), 0)
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
        const u = e.skillUnits().find((u) => u.id === id)
        if (u) {
          if (u.bossStage === 9) this.playNailongSkillVoice()
          else this.playBossSkillAudio(u.bossStage ?? floor)
          const castSpec = this.config.bosses[String(floor)]?.skills.find((entry) => entry.id === skillId)
          const castAnimationMs = skillId === 'clones'
            ? Number(castSpec?.castAnimationMs ?? 1100)
            : Math.max(0, until - session.clock.nowMs)
          if (castAnimationMs > 0) e.setBossSkillAnimation(id, session.clock.nowMs + castAnimationMs)
          // Final Nailong: only rewind borrows the laugh GIF; every other cast keeps the normal art.
          if (u.bossStage === 9 && skillId === 'rewind') e.setUnitLaugh(id, until)
        }
        if (u) {
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
              .setTexture(textureKeyFor(scene, bossArt(floor).key), 0)
              .setScale(bossArt(floor).scale)
              .setTint(0xffffff)
          }
        }
      },
      onLaugh: (id, until) => {
        e.setUnitLaugh(id, until)
        // 奶龙本尊改用三段 mp3 技能语音；其他首领/借用心魔仍用合成笑声。
        const unit = e.skillUnits().find((u) => u.id === id)
        if (unit?.bossStage !== 9) this.tone(false)
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
        this.rewindActive = active
        if (active) {
          this.flight = null
          this.ghost.setVisible(false)
          // Time rewind must give the player a clean screen: remove all boss bullets
          // and suppress every barrage until rewind ends.
          e.clearBossShots()
          this.barrageBurst = null
          this.delayedBarrages.length = 0
          this.cloneBarrageNext.clear()
          this.cloneBarrageIndex.clear()
        } else {
          const interval = this.config.barrages[String(this.activeStage)]?.intervalMs ?? 0
          this.nextBarrageAtMs = this.session.clock.nowMs + interval
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
    for (const key of NAILONG_SKILL_AUDIO)
      if (scene.cache.audio.exists(key)) this.nailongVoices.push(scene.sound.add(key))
    for (const art of Object.values(BOSS_ROSTER_ART)) {
      if (!scene.cache.audio.exists(art.audio)) continue
      const sounds: Phaser.Sound.BaseSound[] = []
      for (let i = 0; i < 2; i++) sounds.push(scene.sound.add(art.audio))
      this.bossSkillAudio.set(art.audio, sounds)
    }
    this.unsubPause = session.bus.on('app_paused', () => {
      this.stopNailongVoices()
      this.stopBossSkillAudio()
    })
  }

  private playNailongSkillVoice(): void {
    if (this.disposed || this.scene.sound.locked || this.options.sfxVolume() <= 0) return
    if (!this.nailongVoices.length) return
    this.stopNailongVoices()
    const voice =
      this.nailongVoices[Math.floor(Math.random() * this.nailongVoices.length)]!
    voice.play({ volume: this.options.sfxVolume() })
  }

  private stopNailongVoices(): void {
    for (const voice of this.nailongVoices) voice.stop()
  }

  private playBossSkillAudio(stage: number): void {
    if (this.disposed || this.scene.sound.locked || this.options.sfxVolume() <= 0) return
    const art = bossArt(stage)
    if (!art.audio) return
    let sounds = this.bossSkillAudio.get(art.audio)
    // Lazy fallback: if the cache was not ready when the controller was built, add
    // the sound at the first cast instead of silently staying mute.
    if (!sounds && this.scene.cache.audio.exists(art.audio)) {
      sounds = [this.scene.sound.add(art.audio), this.scene.sound.add(art.audio)]
      this.bossSkillAudio.set(art.audio, sounds)
    }
    if (!sounds?.length) return
    this.stopBossSkillAudio()
    const sound = sounds[Math.floor(Math.random() * sounds.length)]!
    sound.play({ volume: Math.min(1, this.options.sfxVolume() * (art.audioGain ?? 1)) })
  }

  private stopBossSkillAudio(): void {
    for (const sounds of this.bossSkillAudio.values()) for (const sound of sounds) sound.stop()
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
    let barrages = stage === 9 ? this.activeBorrowedBarrage : this.config.barrages[String(stage)]
    if (this.bossId !== boss.id) {
      this.bossId = boss.id
      const visualScale = this.config.bosses[String(stage)]?.visualScale
      if (visualScale !== undefined)
        this.session.enemies.skills.setBossAppearance(boss.id, { visualScale })
      if (stage === 9) {
        barrages = this.pickBorrowedBarrage()
        this.activeBorrowedBarrage = barrages
      }
      this.barrageIndex = stage === 9 && barrages
        ? this.port.rng.between(0, Math.max(0, barrages.patterns.length - 1))
        : 0
      this.nextBarrageAtMs = now + (barrages?.initialDelayMs ?? 0)
      this.barrageBurst = null
      this.cloneBarrageNext.clear()
      this.cloneBarrageIndex.clear()
      this.delayedBarrages.length = 0
    }
    const dt = Math.max(0, Math.min(1000 / 30, now - this.lastAt))
    this.lastAt = now
    this.session.bossForcedVelocity = null
    this.activeStage = stage
    const elite = this.session.enemies.isEliteBoss(boss.id)
    if (!elite && stage === 9) this.heart.update(now, dt, boss.id)
    const commands = elite ? [] : this.runtime.update(now, dt, boss.id, stage)
    for (const command of commands) this.apply(command)
    // Delayed second formation (e.g. shield → sword).
    if (!this.rewindActive && this.delayedBarrages.length) {
      const due = this.delayedBarrages.filter((item) => item.atMs <= now)
      for (let i = this.delayedBarrages.length - 1; i >= 0; i--)
        if (this.delayedBarrages[i]!.atMs <= now) this.delayedBarrages.splice(i, 1)
      for (const item of due) {
        const target = this.port.units().find((unit) => unit.id === item.bossId)
        if (!target) continue
        const f = item.followUp
        this.fireBarrage(target, {
          id: 'follow-up',
          pattern: 'formation',
          formation: f.formation,
          count: f.count,
          spreadDeg: 0,
          speed: f.speed,
          radius: f.radius,
          damage: f.damage,
          lifetimeMs: 3600,
          spawnRadius: 55,
        }, 0, item.color)
      }
    }
    // 弹幕独立于技能冷却：技能正在释放时这里照样按自己的固定间隔开火。
    const clonePhase = this.port.units().some((unit) => unit.cloneBossStage === stage)
    if (barrages && !clonePhase && !this.rewindActive) {
      // 先开新的一串；同一帧再放第一轮，避免初始延迟被多算一帧。
      if (!this.barrageBurst && now >= this.nextBarrageAtMs) {
        if (stage === 9) {
          barrages = this.pickBorrowedBarrage()
          this.activeBorrowedBarrage = barrages
          this.barrageIndex = this.port.rng.between(0, Math.max(0, barrages.patterns.length - 1))
        }
        const pattern = barrages.patterns[this.barrageIndex % barrages.patterns.length]!
        this.barrageBurst = {
          pattern,
          remaining: Math.max(1, pattern.bursts ?? 1),
          fired: 0,
          nextAt: now,
        }
        this.barrageIndex = (this.barrageIndex + 1) % barrages.patterns.length
        this.nextBarrageAtMs = now + barrages.intervalMs
      }
      // 只追一轮；长帧不补发整串，否则切标签页回来会瞬间铺满屏幕。
      if (this.barrageBurst && now >= this.barrageBurst.nextAt) {
        const burst = this.barrageBurst
        this.fireBarrage(boss, burst.pattern, burst.fired, barrages.color)
        burst.fired++
        burst.remaining--
        if (burst.remaining <= 0) this.barrageBurst = null
        else burst.nextAt = now + (burst.pattern.burstIntervalMs ?? 0)
      }
    }
    // Clones (耄耋猫影分身) each own a slower barrage clock. The hidden boss does not
    // fire while the clone phase is active.
    if (barrages && clonePhase && !this.rewindActive) {
      this.barrageBurst = null
      const clones = this.port.units().filter((unit) => unit.cloneBossStage === stage)
      const alive = new Set(clones.map((unit) => unit.id))
      for (const id of [...this.cloneBarrageNext.keys()])
        if (!alive.has(id)) {
          this.cloneBarrageNext.delete(id)
          this.cloneBarrageIndex.delete(id)
        }
      const interval = barrages.intervalMs
      for (const clone of clones) {
        if (!this.cloneBarrageNext.has(clone.id))
          // Fire the first clone volley immediately; the 4× interval applies after it.
          this.cloneBarrageNext.set(clone.id, now)
        if (now < (this.cloneBarrageNext.get(clone.id) ?? Infinity)) continue
        const index = this.cloneBarrageIndex.get(clone.id) ?? 0
        const pattern = barrages.patterns[index % barrages.patterns.length]!
        this.fireBarrage(clone, pattern, 0, barrages.color)
        this.cloneBarrageIndex.set(clone.id, (index + 1) % barrages.patterns.length)
        this.cloneBarrageNext.set(clone.id, now + interval)
      }
    }
    // The paper kite's basic ring is owned by the configured scheduler.
    if (stage === 3 && !elite) this.session.enemies.skills.setBossManualAttacks(boss.id, true)
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
  /** Fire one burst; `burstIndex` rotates fan/ring/line patterns. */
  private pickBorrowedBarrage(): BossBarrageConfig {
    const choices = [2, 3, 4, 5, 6, 7, 8]
    const floor = choices[this.port.rng.between(0, choices.length - 1)]!
    return this.config.barrages[String(floor)] ?? this.config.barrages['2']!
  }

  private fireBarrage(
    boss: BossSkillUnit,
    pattern: BossBarrageSpec,
    burstIndex: number,
    color: number,
  ): void {
    const player = this.session.player
    const rotate = ((pattern.angleStepDeg ?? 0) * burstIndex * Math.PI) / 180
    const aimedBase = Math.atan2(player.y - boss.y, player.x - boss.x)
    const aimed = aimedBase + rotate
    const spreadRad = (pattern.spreadDeg * Math.PI) / 180
    const angles: number[] = []
    if (pattern.pattern === 'ring' || pattern.pattern === 'ring_gap') {
      const gap = pattern.pattern === 'ring_gap' ? (pattern.gapDeg ?? 60) : (pattern.gapDeg ?? 0)
      const halfGap = (gap * Math.PI) / 360
      for (let i = 0; i < pattern.count; i++) {
        const angle = rotate + (i * Math.PI * 2) / pattern.count
        if (gap <= 0) {
          angles.push(angle)
          continue
        }
        const delta = Math.abs(Math.atan2(Math.sin(angle - aimedBase), Math.cos(angle - aimedBase)))
        if (delta >= halfGap) angles.push(angle)
      }
    } else if (pattern.pattern === 'fan') {
      for (let i = 0; i < pattern.count; i++)
        angles.push(aimed + (i - (pattern.count - 1) / 2) * spreadRad)
    } else if (pattern.pattern === 'line') {
      for (let i = 0; i < pattern.count; i++) angles.push(aimed)
    } else if (pattern.pattern === 'custom') {
      for (const degree of pattern.anglesDeg ?? [])
        angles.push(aimed + (degree * Math.PI) / 180)
    } else {
      // Scatter: independent random directions inside the declared spread.
      for (let i = 0; i < pattern.count; i++)
        angles.push(aimed + this.port.rng.floatBetween(-spreadRad, spreadRad))
    }
    let shots: BossVolleyShot[] | undefined
    if (pattern.pattern === 'formation') {
      shots = this.formationShots(pattern, aimed)
      if (!shots.length) return
    }
    if (!angles.length && !shots?.length) return
    const speedScale = 1 + (pattern.speedStepPct ?? 0) * (burstIndex % 2 === 0 ? 1 : -1)
    const volley: BossSkillVolley = {
      count: shots?.length ?? angles.length,
      speed: pattern.speed * speedScale,
      radius: pattern.radius,
      damage: Math.round(pattern.damage * this.port.damageMultiplier),
      lifetimeMs: pattern.lifetimeMs,
      color,
      ...(shots ? { shots } : { anglesRad: angles }),
      ...(pattern.spawnRadius !== undefined ? { spawnRadius: pattern.spawnRadius } : {}),
      ...(pattern.spawnAngleDeg !== undefined
        ? { spawnAngleOffsetRad: (pattern.spawnAngleDeg * Math.PI) / 180 }
        : {}),
      ...(pattern.speedEnd !== undefined ? { speedEnd: pattern.speedEnd * speedScale } : {}),
      ...(pattern.speedRampMs !== undefined ? { speedRampMs: pattern.speedRampMs } : {}),
      ...(pattern.bounceCount !== undefined ? { bounceCount: pattern.bounceCount } : {}),
      ...(pattern.splitAfterMs !== undefined ? { splitAfterMs: pattern.splitAfterMs } : {}),
      ...(pattern.splitCount !== undefined ? { splitCount: pattern.splitCount } : {}),
      ...(pattern.splitSpeedScale !== undefined ? { splitSpeedScale: pattern.splitSpeedScale } : {}),
      ...(pattern.splitDamageRatio !== undefined ? { splitDamageRatio: pattern.splitDamageRatio } : {}),
      ...(pattern.splitSpreadDeg !== undefined
        ? { splitSpreadRad: (pattern.splitSpreadDeg * Math.PI) / 180 }
        : {}),
      ...(pattern.pulseMin !== undefined ? { pulseMin: pattern.pulseMin } : {}),
      ...(pattern.pulseMax !== undefined ? { pulseMax: pattern.pulseMax } : {}),
      ...(pattern.pulsePeriodMs !== undefined ? { pulsePeriodMs: pattern.pulsePeriodMs } : {}),
      ...(pattern.pattern === 'line' && pattern.lineSpacingPx !== undefined
        ? { lineSpacingPx: pattern.lineSpacingPx }
        : {}),
    }
    this.session.enemies.skills.fireBossVolley(boss.id, volley)
    if (pattern.followUp)
      this.delayedBarrages.push({
        bossId: boss.id,
        atMs: this.session.clock.nowMs + pattern.followUp.delayMs,
        followUp: pattern.followUp,
        color,
      })
  }

  /** Arrange formation bullets in space; their velocity is the aimed direction. */
  private formationShots(
    pattern: BossBarrageSpec,
    aimed: number,
  ): BossVolleyShot[] {
    const count = Math.max(1, pattern.count)
    const spacing = Math.max(1, pattern.formationSpacing ?? 26)
    const start = pattern.spawnRadius ?? 50
    const open = ((pattern.formationAngleDeg ?? 60) * Math.PI) / 180
    const fx = Math.cos(aimed), fy = Math.sin(aimed)
    const px = -fy, py = fx
    const shots: BossVolleyShot[] = []
    const push = (forward: number, side: number): void => {
      shots.push({ x: fx * forward + px * side, y: fy * forward + py * side, angleRad: aimed })
    }
    if (pattern.formation === 'v') {
      const arm = Math.ceil(count / 2)
      for (let i = 0; i < count; i++) {
        const step = i % arm
        const sideSign = i < arm ? -1 : 1
        // Tip leads the formation; the two arms trail behind it.
        push(start + (arm - 1 - step) * spacing, sideSign * step * spacing * Math.tan(open / 2))
      }
    } else if (pattern.formation === 'cross') {
      push(start, 0)
      for (let i = 1; i < count; i++) {
        const arm = (i - 1) % 4
        const step = Math.floor((i - 1) / 4) + 1
        const side = arm % 2 === 0 ? (arm === 0 ? 1 : -1) : 0
        const forward = arm % 2 === 1 ? (arm === 1 ? 1 : -1) : 0
        push(start + forward * step * spacing, side * step * spacing)
      }
    } else if (pattern.formation === 'arc') {
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0 : (i / (count - 1) - 0.5) * open
        shots.push({ x: Math.cos(aimed + t) * start, y: Math.sin(aimed + t) * start, angleRad: aimed })
      }
    } else if (pattern.formation === 'wall') {
      for (let i = 0; i < count; i++) push(start, (i - (count - 1) / 2) * spacing)
    } else if (pattern.formation === 'star') {
      const outer = start + spacing * 1.6
      const inner = Math.max(8, spacing * 0.65)
      for (let i = 0; i < count; i++) {
        const angle = aimed + (i * Math.PI * 2) / count
        const radius = i % 2 === 0 ? outer : inner
        shots.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, angleRad: aimed })
      }
    } else if (pattern.formation === 'ma') {
      const scale = Math.max(1, spacing * 2)
      const centerX = fx * start
      const centerY = fy * start
      for (const [gx, gy] of MA_GLYPH_POINTS)
        shots.push({ x: centerX + gx * scale, y: centerY + gy * scale, angleRad: aimed })
    } else if (pattern.formation === 'gugugaga') {
      const scale = Math.max(1, spacing * 2)
      const centerX = fx * start
      const centerY = fy * start
      for (const [gx, gy] of GUGUGAGA_GLYPH_POINTS)
        shots.push({ x: centerX + gx * scale, y: centerY + gy * scale, angleRad: aimed })
    } else if (pattern.formation === 'rectangle') {
      const width = spacing * 2.4
      const height = spacing * 1.4
      const per = Math.max(1, Math.ceil(count / 4))
      for (let i = 0; i < count; i++) {
        const side = Math.min(3, Math.floor(i / per))
        const t = (i % per) / Math.max(1, per - 1) - 0.5
        let along = 0
        let across = 0
        if (side === 0) { along = t * width; across = -height / 2 }
        else if (side === 1) { along = width / 2; across = t * height }
        else if (side === 2) { along = -t * width; across = height / 2 }
        else { along = -width / 2; across = -t * height }
        shots.push({ x: fx * (start + along) + px * across, y: fy * (start + along) + py * across, angleRad: aimed })
      }
    } else if (pattern.formation === 'spiral') {
      const turns = Math.PI * 2.4
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0 : i / (count - 1)
        const angle = aimed + t * turns
        const radius = start * 0.35 + t * spacing * Math.max(2, count * 0.45)
        shots.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, angleRad: aimed })
      }
    } else if (pattern.formation === 'orbit') {
      const radius = start
      for (let i = 0; i < count; i++) {
        const shape = (i * Math.PI * 2) / count
        const angle = aimed + shape
        shots.push({
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          angleRad: angle + Math.PI / 2,
        })
      }
    } else {
      // big: one oversized slow projectile; count > 1 puts them in a tight cluster.
      for (let i = 0; i < count; i++) {
        const side = (i - (count - 1) / 2) * spacing * 0.15
        push(start, side)
      }
    }
    return shots
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
      { weapon: w, stats } = s.shadowWeapon()
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
    this.stopNailongVoices()
    this.stopBossSkillAudio()
    this.session.resetBossPlayerControl()
    this.view.update(this.session.clock.nowMs)
    this.bossId = null
    this.barrageIndex = 0
    this.nextBarrageAtMs = 0
    this.barrageBurst = null
    this.cloneBarrageNext.clear()
    this.cloneBarrageIndex.clear()
    this.delayedBarrages.length = 0
    this.activeBorrowedBarrage = null
    this.redAlpha = 0
    this.rewindActive = false
    this.activeStage = 0
    this.screen.clear()
    this.weapon.setVisible(false)
    this.weaponOwner = null
    this.flight = null
    this.ghost.setVisible(false)
  }
  destroy(): void {
    if (this.disposed) return
    this.clear()
    this.disposed = true
    this.unsubPause()
    for (const voice of this.nailongVoices) voice.destroy()
    this.nailongVoices.length = 0
    for (const sounds of this.bossSkillAudio.values()) for (const sound of sounds) sound.destroy()
    this.bossSkillAudio.clear()
    this.view.destroy()
    this.screen.destroy()
    this.weapon.destroy()
    this.ghost.destroy()
  }
}
