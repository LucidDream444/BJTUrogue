import Phaser from 'phaser'
import { CONFIG_FILE_NAMES, configUrl, parseConfigBundle, type ConfigBundle } from '@/core/config'
import { preloadAssets, ensurePlaceholderTextures, registerAnimations } from '@/core/assets'
import { Rng } from '@/core/rng'
import { CombatSession } from '@/domains/combat/CombatSession'
import { parseCombatConfig, parseRewards, type CombatConfig } from '@/domains/combat/config'
import { parseBossSkillsTable, type BossSkillsTable } from '@/domains/combat/BossSkillRuntime'
import { BossEncounterController } from '@/domains/combat/BossEncounterController'
import type { StageCollisionConfig } from '@/domains/combat/StageGeometry'

const LAB = { width: 1344, height: 832 } as const
/** Profile 2—8 are the seven regular bosses; 9 is the final Nailong. */
const BOSS_PROFILES = [2, 3, 4, 5, 6, 7, 8, 9] as const

/**
 * Continuous boss rush: one open arena, one boss at a time, no map reload and
 * no full heal between fights. `N` skips, `M` toggles shuffle, `E` toggles elite
 * mode, `K` casts the current boss skill, `P` invincibility, `R` restart.
 */
class BossRushArena extends Phaser.Scene {
  private session: CombatSession | null = null
  private bossSkills: BossEncounterController | null = null
  private cfg!: CombatConfig
  private bundle!: ConfigBundle
  private bosses!: BossSkillsTable
  private hud!: Phaser.GameObjects.Text
  private protectedMode = true
  private eliteMode = false
  private randomMode = false
  private order: number[] = [...BOSS_PROFILES]
  private index = 0
  private currentProfile: number | null = null
  private currentBossId: number | null = null
  private nextSpawnAt = 0
  private weaponIndex = 0
  private readonly rng = new Rng(0xb055)
  private readonly unsubs: (() => void)[] = []

  constructor() {
    super('')
  }

  preload(): void {
    for (const name of CONFIG_FILE_NAMES) this.load.json(name, configUrl(name))
    this.load.json('combat.json', 'config/combat.json')
    this.load.json('rewards.json', 'config/rewards.json')
    this.load.json('boss-skills.json', 'config/boss-skills.json')
    preloadAssets(this)
  }

  create(): void {
    ensurePlaceholderTextures(this)
    registerAnimations(this)
    this.bundle = parseConfigBundle({
      balance: this.cache.json.get('balance.json'),
      difficulty: this.cache.json.get('difficulty.json'),
      enemies: this.cache.json.get('enemies.json'),
    })
    this.cfg = parseCombatConfig(this.cache.json.get('combat.json'))
    this.bosses = parseBossSkillsTable(this.cache.json.get('boss-skills.json'))
    this.cameras.main.setBackgroundColor('#19232d').setZoom(1)
    this.paintFloor()
    this.session = new CombatSession(
      this,
      this.bundle,
      this.cfg,
      parseRewards(this.cache.json.get('rewards.json')),
      'normal',
      this.geometry(),
    )
    this.session.inventory.splice(
      0,
      this.session.inventory.length,
      ...this.cfg.weapons.map((weapon) => weapon.id),
    )
    this.session.setAudioVolumes(this.cfg.audio.bgmVolume, this.cfg.audio.shotVolume)
    this.session.player.model.protectedUntilMs = Infinity
    this.bossSkills = new BossEncounterController(
      this,
      this.session,
      this.bosses,
      {
        bounds: () => ({ left: 0, top: 0, right: LAB.width, bottom: LAB.height }),
        sfxVolume: () => this.cfg.audio.shotVolume,
      },
    )
    this.unsubs.push(
      this.session.bus.on('entity_killed', (event) => {
        if (event.kind !== 'enemy' || event.bossStage === undefined) return
        if (this.currentProfile === null || event.bossStage !== this.currentProfile) return
        this.currentBossId = null
        this.nextSpawnAt = this.session!.clock.nowMs + 850
      }),
    )
    this.buildHud()
    this.bindKeys()
    this.buildOrder()
    this.spawnCurrent()
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this)
    this.layout()
  }

  private geometry(): StageCollisionConfig {
    return {
      schemaVersion: 1,
      navigationCellSize: this.cfg.terrain.navigationCellSize,
      sourceSize: { width: LAB.width, height: LAB.height },
      stages: [
        {
          stage: 1,
          playerSpawn: { x: LAB.width * 0.68, y: LAB.height * 0.56 },
          solids: [],
          furniture: [],
        },
      ],
    }
  }

  private paintFloor(): void {
    const g = this.add.graphics().setDepth(-1)
    g.clear().lineStyle(1, 0x34424a, 0.65)
    const step = this.cfg.terrain.navigationCellSize
    for (let x = 0; x <= LAB.width; x += step) g.lineBetween(x, 0, x, LAB.height)
    for (let y = 0; y <= LAB.height; y += step) g.lineBetween(0, y, LAB.width, y)
    g.lineStyle(3, 0xdce5df, 0.85).strokeRect(0, 0, LAB.width, LAB.height)
  }

  private buildHud(): void {
    this.hud = this.add
      .text(14, 10, '', {
        fontFamily: 'Microsoft YaHei, monospace',
        fontSize: '14px',
        color: '#eef3e9',
        lineSpacing: 5,
        backgroundColor: '#0c141ccc',
        padding: { x: 10, y: 8 },
      })
      .setScrollFactor(0)
      .setDepth(10000)
  }

  private bindKeys(): void {
    const keyboard = this.input.keyboard
    if (!keyboard) return
    keyboard.on('keydown-N', () => this.skipCurrent())
    keyboard.on('keydown-M', () => {
      this.randomMode = !this.randomMode
      this.buildOrder()
      this.index = 0
    })
    keyboard.on('keydown-E', () => {
      this.eliteMode = !this.eliteMode
    })
    keyboard.on('keydown-P', () => {
      this.protectedMode = !this.protectedMode
      if (this.session)
        this.session.player.model.protectedUntilMs = this.protectedMode ? Infinity : 0
    })
    keyboard.on('keydown-R', () => this.scene.restart())
    keyboard.on('keydown-COMMA', () => this.cycleWeapon(-1))
    keyboard.on('keydown-PERIOD', () => this.cycleWeapon(1))
    keyboard.on('keydown-K', () => this.castNextSkill())
  }

  private buildOrder(): void {
    this.order = [...BOSS_PROFILES]
    if (!this.randomMode) return
    for (let i = this.order.length - 1; i > 0; i--) {
      const j = this.rng.between(0, i)
      ;[this.order[i], this.order[j]] = [this.order[j]!, this.order[i]!]
    }
  }

  private currentBoss() {
    if (this.currentProfile === null) return null
    return this.bosses.bosses[String(this.currentProfile)] ?? null
  }

  private spawnCurrent(): void {
    if (!this.session || this.index >= this.order.length) {
      this.currentProfile = null
      this.currentBossId = null
      return
    }
    const profile = this.order[this.index]!
    const definition = this.bosses.bosses[String(profile)]
    if (!definition) return
    const finalBoss = profile === 9
    const baseHp = finalBoss
      ? this.cfg.arena.finale.heartDemonHp
      : this.cfg.encounter.bossHp + this.index * this.cfg.encounter.bossHpPerStage
    const hp = this.eliteMode ? Math.max(1, Math.round(baseHp * this.cfg.encounter.eliteBossHpScale)) : baseHp
    this.session.enemies.spawnBoss(
      profile,
      2,
      definition.id,
      LAB.width * 0.34,
      LAB.height * 0.45,
      hp,
      finalBoss,
      this.cfg.encounter.bossDamageMultiplier,
      this.eliteMode,
    )
    const boss = this.session.enemies.skills
      .skillUnits()
      .find((unit) => unit.bossStage === profile)
    this.currentProfile = profile
    this.currentBossId = boss?.id ?? null
    this.nextSpawnAt = 0
  }

  private locateBossId(): number | null {
    if (!this.session || this.currentProfile === null) return null
    return (
      this.session.enemies.skills
        .skillUnits()
        .find((unit) => unit.bossStage === this.currentProfile)?.id ?? null
    )
  }

  private despawnCurrent(): void {
    if (!this.session) return
    const id = this.currentBossId ?? this.locateBossId()
    if (id !== null) this.session.enemies.skills.despawnSkillUnit(id)
    this.currentBossId = null
    this.currentProfile = null
  }

  private skipCurrent(): void {
    this.despawnCurrent()
    this.index++
    this.spawnCurrent()
  }

  private cycleWeapon(direction: number): void {
    if (!this.session) return
    const total = this.cfg.weapons.length
    this.weaponIndex = (this.weaponIndex + direction + total) % total
    this.session.equip(this.cfg.weapons[this.weaponIndex]!.id, true)
  }

  private castNextSkill(): void {
    const session = this.session
    if (!session || !this.bossSkills || session.clock.paused) return
    if (this.currentProfile === null || this.eliteMode) return
    const boss = session.enemies.skills
      .skillUnits()
      .find((unit) => unit.bossStage === this.currentProfile)
    if (!boss) return
    const skills = this.bosses.bosses[String(this.currentProfile)]?.skills ?? []
    if (!skills.length) return
    const skill = skills[this.index % skills.length]!
    this.bossSkills.runtime.castSkill(boss.id, this.currentProfile, skill.id, session.clock.nowMs)
  }

  override update(_time: number, delta: number): void {
    this.session?.update(delta)
    if (this.session && this.nextSpawnAt > 0 && this.session.clock.nowMs >= this.nextSpawnAt) {
      this.nextSpawnAt = 0
      this.index++
      this.spawnCurrent()
    }
    if (this.currentProfile !== null) {
      if (this.currentBossId === null) this.currentBossId = this.locateBossId()
      this.bossSkills?.update(this.currentProfile)
    }
    if (!this.session) return
    const model = this.session.player.model
    const definition = this.currentBoss()
    const current = definition
      ? `${this.index + 1}/${this.order.length} · ${definition.name}`
      : this.index >= this.order.length
        ? '全部击败'
        : '等待下一只'
    this.hud.setText([
      `Boss Rush · ${current}`,
      `模式：${this.randomMode ? '随机' : '顺序'}${this.eliteMode ? ' · 精英（半血/无技能）' : ''}    ${this.protectedMode ? '无敌开' : '正常受伤'}`,
      `玩家 HP ${Math.ceil(model.hp)}/${model.maxHp}  护盾 ${Math.ceil(model.shield)}/${model.maxShield}  能量 ${Math.ceil(this.session.player.stamina)}/${this.session.player.maxStamina}`,
      `WASD 移动 / 左键开火 / , . 换武器 / K 试放技能`,
      `N 下一只 / M 随机·顺序 / E 精英模式 / P 无敌 / R 重置 / Esc 菜单`,
    ])
  }

  private layout(): void {
    this.cameras.main.setZoom(
      Math.min(this.scale.width / LAB.width, this.scale.height / LAB.height),
    )
    this.cameras.main.centerOn(LAB.width / 2, LAB.height / 2)
  }

  private cleanup(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this)
    for (const off of this.unsubs.splice(0)) off()
    this.bossSkills?.destroy()
    this.bossSkills = null
    this.session?.destroy()
    this.session = null
  }
}

export const arena = {
  displayName: 'Boss Rush · 连续首领连战',
  description:
    '开放场地连续挑战 7 位常规首领 + 最终奶龙，击破自动下一只，不回满血；N 跳过、M 随机/顺序、E 精英模式、K 技能、P 无敌、R 重置。',
  scene: BossRushArena,
}
