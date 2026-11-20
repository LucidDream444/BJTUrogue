import Phaser from 'phaser'
import { CONFIG_FILE_NAMES, configUrl, parseConfigBundle, type ConfigBundle } from '@/core/config'
import { preloadAssets, ensurePlaceholderTextures, registerAnimations } from '@/core/assets'
import { CombatSession } from '@/domains/combat/CombatSession'
import { parseCombatConfig, parseRewards, type CombatConfig } from '@/domains/combat/config'
import { parseBossSkillsTable } from '@/domains/combat/BossSkillRuntime'
import { BossEncounterController } from '@/domains/combat/BossEncounterController'
import type { StageCollisionConfig } from '@/domains/combat/StageGeometry'

const LAB = { width: 1344, height: 832 } as const
const BOSS_STAGE = 9

/**
 * 奶龙（第七层首领）专用白箱场。
 *
 * 7F 的正式平面图暂时没有首领房，把奶龙塞进普通教室时，课桌和竖墙会把弹幕
 * 整片吃掉（实测红色扇形 9 发只有 1 发飞出来）。这里用一块**没有障碍**的
 * 1344×832 场地，让技能与三段弹幕都能完整展开。
 */
class NailongBossArena extends Phaser.Scene {
  private session: CombatSession | null = null
  private bossSkills: BossEncounterController | null = null
  private cfg!: CombatConfig
  private bundle!: ConfigBundle
  private hud!: Phaser.GameObjects.Text
  private protectedMode = true
  private weaponIndex = 0
  private skillIndex = 0
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
    this.cameras.main.setBackgroundColor('#19232d').setZoom(1)
    this.cameras.main.centerOn(LAB.width / 2, LAB.height / 2)
    this.paintFloor()
    this.session = new CombatSession(
      this,
      this.bundle,
      this.cfg,
      parseRewards(this.cache.json.get('rewards.json')),
      'normal',
      this.geometry(),
    )
    // 调试库存：全部 36 把武器可直接切。
    this.session.inventory.splice(
      0,
      this.session.inventory.length,
      ...this.cfg.weapons.map((weapon) => weapon.id),
    )
    this.session.setAudioVolumes(this.cfg.audio.bgmVolume, this.cfg.audio.shotVolume)
    this.session.player.model.protectedUntilMs = Infinity
    const bossX = LAB.width * 0.34
    const bossY = LAB.height * 0.45
    this.session.enemies.spawnBoss(
      BOSS_STAGE,
      2,
      'nailong',
      bossX,
      bossY,
      this.cfg.arena.finale.heartDemonHp,
      true,
      this.cfg.encounter.bossDamageMultiplier,
    )
    this.bossSkills = new BossEncounterController(
      this,
      this.session,
      parseBossSkillsTable(this.cache.json.get('boss-skills.json')),
      {
        bounds: () => ({ left: 0, top: 0, right: LAB.width, bottom: LAB.height }),
        sfxVolume: () => this.cfg.audio.shotVolume,
      },
    )
    this.buildHud()
    this.bindKeys()
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
          playerSpawn: { x: LAB.width * 0.66, y: LAB.height * 0.58 },
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

  private cycleWeapon(direction: number): void {
    if (!this.session) return
    const total = this.cfg.weapons.length
    this.weaponIndex = (this.weaponIndex + direction + total) % total
    this.session.equip(this.cfg.weapons[this.weaponIndex]!.id, true)
  }

  private castNextSkill(): void {
    const session = this.session
    if (!session || !this.bossSkills || session.clock.paused) return
    const boss = session.enemies.skills.skillUnits().find((u) => u.bossStage === BOSS_STAGE)
    if (!boss) return
    const skills = this.bossSkills.config.bosses[String(BOSS_STAGE)]!.skills
    const skill = skills[this.skillIndex++ % skills.length]!
    this.bossSkills.runtime.castSkill(boss.id, BOSS_STAGE, skill.id, session.clock.nowMs)
  }

  override update(_time: number, delta: number): void {
    this.session?.update(delta)
    this.bossSkills?.update(BOSS_STAGE)
    if (this.session) {
      const model = this.session.player.model
      this.hud.setText([
        `最终奶龙 · 弹幕与心魔机制测试（开放场地）`,
        `HP ${Math.ceil(model.hp)}/${model.maxHp}  护盾 ${Math.ceil(model.shield)}/${model.maxShield}  能量 ${Math.ceil(this.session.player.stamina)}/${this.session.player.maxStamina}  保护${this.protectedMode ? '开' : '关'}`,
        `当前武器：${this.session.weapon.name}    WASD 移动 / 左键开火    , . 换武器`,
        `K 试放一次技能（技能与红色弹幕各自独立计时）    P 无敌开关    R 重置    Esc 菜单`,
      ])
    }
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
  displayName: '最终奶龙 · 弹幕与终局机制测试',
  description:
    '开放场地（无课桌/竖墙）：最终奶龙自动释放技能与红色弹幕；WASD 移动、左键开火、, . 换武器、K 试放技能、P 无敌、R 重置。',
  scene: NailongBossArena,
}
