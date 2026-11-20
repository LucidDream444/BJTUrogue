import Phaser from 'phaser'
import { CONFIG_FILE_NAMES, configUrl, parseConfigBundle, type ConfigBundle } from '@/core/config'
import { preloadAssets, ensurePlaceholderTextures, registerAnimations } from '@/core/assets'
import { CombatSession } from '@/domains/combat/CombatSession'
import { parseCombatConfig, parseRewards, type CombatConfig, type RewardDef } from '@/domains/combat/config'
import { TALENT_KINDS, type TalentKind } from '@/domains/combat/TalentRun'
import type { StageCollisionConfig } from '@/domains/combat/StageGeometry'

const WORLD = { width: 1280, height: 720 } as const
const PAGE_SIZE = 8
const PAGES = Math.ceil(TALENT_KINDS.length / PAGE_SIZE)

/**
 * Talent-aura white-box arena. It shows the product `TalentAuraView`, not a
 * preview copy: the belt and acquisition burst are the same code the battle uses.
 *
 * `[` / `]` change page, `B` replays the acquisition burst, `0` clears, `P`
 * toggles invulnerability, `R` restarts.
 */
class TalentAuraArena extends Phaser.Scene {
  private session: CombatSession | null = null
  private cfg!: CombatConfig
  private bundle!: ConfigBundle
  private defs: RewardDef[] = []
  private hud!: Phaser.GameObjects.Text
  private page = 0
  private protectedMode = true

  constructor() {
    super('')
  }

  preload(): void {
    for (const name of CONFIG_FILE_NAMES) this.load.json(name, configUrl(name))
    this.load.json('combat.json', 'config/combat.json')
    this.load.json('rewards.json', 'config/rewards.json')
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
    this.defs = parseRewards(this.cache.json.get('rewards.json'))
    this.cameras.main.setBackgroundColor('#19232d')
    this.paintFloor()
    this.session = new CombatSession(
      this,
      this.bundle,
      this.cfg,
      this.defs,
      'normal',
      this.geometry(),
    )
    this.session.player.model.protectedUntilMs = Infinity
    this.session.setAudioVolumes(0, this.cfg.audio.shotVolume)
    this.buildHud()
    this.bindKeys()
    this.applyPage(0)
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this)
    this.layout()
  }

  private geometry(): StageCollisionConfig {
    return {
      schemaVersion: 1,
      navigationCellSize: this.cfg.terrain.navigationCellSize,
      sourceSize: { width: WORLD.width, height: WORLD.height },
      stages: [
        {
          stage: 1,
          playerSpawn: { x: WORLD.width / 2, y: WORLD.height / 2 },
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
    for (let x = 0; x <= WORLD.width; x += step) g.lineBetween(x, 0, x, WORLD.height)
    for (let y = 0; y <= WORLD.height; y += step) g.lineBetween(0, y, WORLD.width, y)
    g.lineStyle(3, 0xdce5df, 0.85).strokeRect(0, 0, WORLD.width, WORLD.height)
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
    keyboard.on('keydown-OPEN_BRACKET', () => this.applyPage(this.page - 1))
    keyboard.on('keydown-CLOSED_BRACKET', () => this.applyPage(this.page + 1))
    keyboard.on('keydown-B', () => {
      const kind = this.pageKinds()[0]
      if (kind) this.session?.talentAura?.acquire(kind)
    })
    keyboard.on('keydown-ZERO', () => this.clearTalents())
    keyboard.on('keydown-P', () => {
      this.protectedMode = !this.protectedMode
      if (this.session)
        this.session.player.model.protectedUntilMs = this.protectedMode ? Infinity : 0
    })
    keyboard.on('keydown-R', () => this.scene.restart())
  }

  private pageKinds(): TalentKind[] {
    return TALENT_KINDS.slice(this.page * PAGE_SIZE, this.page * PAGE_SIZE + PAGE_SIZE)
  }

  private applyPage(page: number): void {
    this.page = (page + PAGES) % PAGES
    this.clearTalents()
    const stacks = this.session?.talents.stacks as Map<string, number> | undefined
    if (!stacks) return
    for (const kind of this.pageKinds()) {
      const def = this.defs.find((reward) => reward.talent?.kind === kind)
      if (!def) continue
      stacks.set(def.id, 1)
      this.session?.talentAura?.acquire(kind)
    }
  }

  private clearTalents(): void {
    const stacks = this.session?.talents.stacks as Map<string, number> | undefined
    stacks?.clear()
    this.session?.talentAura?.clear()
  }

  override update(_time: number, delta: number): void {
    this.session?.update(delta)
    if (!this.session) return
    const model = this.session.player.model
    this.hud.setText([
      `天赋随身特效 · 第 ${this.page + 1}/${PAGES} 页`,
      `本页：${this.pageKinds().join(' / ')}`,
      `HP ${Math.ceil(model.hp)}/${model.maxHp}  护盾 ${Math.ceil(model.shield)}/${model.maxShield}  保护${this.protectedMode ? '开' : '关'}`,
      `WASD 移动 / [ ] 换页 / B 重播获得爆发 / 0 清空 / P 无敌 / R 重置`,
    ])
  }

  private layout(): void {
    this.cameras.main.setZoom(Math.min(this.scale.width / WORLD.width, this.scale.height / WORLD.height))
    this.cameras.main.centerOn(WORLD.width / 2, WORLD.height / 2)
  }

  private cleanup(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this)
    this.session?.destroy()
    this.session = null
  }
}

export const arena = {
  displayName: '天赋随身特效 · 白箱',
  description:
    '展示 34 种天赋的环带印记与获得爆发；[ ] 换页、B 重播、0 清空、P 无敌、R 重置。',
  scene: TalentAuraArena,
}
