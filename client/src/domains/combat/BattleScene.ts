import Phaser from 'phaser'
import { preloadAssets, ensurePlaceholderTextures, registerAnimations } from '@/core/assets'
import { parseConfigBundle, type ConfigBundle, type Difficulty } from '@/core/config'
import {
  parseCombatConfig,
  parseRewards,
  type CombatConfig,
  type RewardDef,
} from '@/domains/combat/config'
import { CombatSession } from '@/domains/combat/CombatSession'
import { RewardPanel } from '@/domains/combat/RewardPanel'
import { stagePlan } from '@/domains/combat/balance'
import { AssetGallery } from './AssetGallery'
import { StatusHud } from '@/domains/combat/StatusHud'
import { GameCursor } from '@/domains/combat/GameCursor'
import { StageBackground } from './StageBackground'
import { parseStageCollisions, type StageCollisionConfig } from './StageGeometry'
import { FirstBossLoot } from '@/domains/combat/FirstBossLoot'
import { LoadoutHud } from '@/domains/combat/LoadoutHud'

const style = document.createElement('style')
style.textContent =
  '.d1-gallery{font-family:system-ui,sans-serif;color:#e9f2ff}.d1-gallery{position:fixed;inset:0;z-index:95;background:#091323f5;padding:22px;overflow:auto}.d1-gallery header{display:flex;justify-content:space-between}.d1-preview-canvas{display:block;max-width:100%;border:1px solid #376276}.d1-asset-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-top:14px}.d1-asset-card{display:flex;align-items:center;gap:8px;text-align:left;background:#13233a;color:#dcecff;border:1px solid #31516c;border-radius:8px;padding:6px;cursor:pointer;white-space:pre-line}.d1-asset-card img{width:56px;height:56px;object-fit:contain;background:#0a111d}.d1-asset-card span{font-size:11px}'
document.head.append(style)
export class BattleScene extends Phaser.Scene {
  private scenery!: StageBackground
  private loot!: FirstBossLoot
  private loadout!: LoadoutHud
  private bossLabel!: Phaser.GameObjects.Text
  private difficulty: Difficulty = 'normal'
  private session!: CombatSession
  private rewardPanel!: RewardPanel
  private cursor!: GameCursor
  private nextRoundAtMs: number | null = null
  private gallery!: AssetGallery
  private stageConfig!: StageCollisionConfig
  private cfg!: CombatConfig
  private bundle!: ConfigBundle
  private rewardDefs!: RewardDef[]
  private statusHud!: StatusHud
  private notice!: Phaser.GameObjects.Text
  private deathNotice!: Phaser.GameObjects.Text
  private clearAt = -1
  private clearEmitted = false
  private stage = 1
  private spawned = false
  private gameWon = false
  constructor(key = 'battle') {
    super(key)
  }
  init(data: { difficulty?: Difficulty } = {}): void {
    this.difficulty = data.difficulty ?? 'normal'
    this.stage = 1
    this.clearAt = -1
    this.clearEmitted = false
    this.spawned = false
    this.gameWon = false
    this.nextRoundAtMs = null
  }
  preload(): void {
    preloadAssets(this)
    for (const n of [
      'balance.json',
      'difficulty.json',
      'enemies.json',
      'combat.json',
      'stage-collisions.json',
      'rewards.json',
    ])
      this.load.json(n, `config/${n}`)
  }
  create(): void {
    try {
      Object.defineProperty(window, '__d1', { value: this, configurable: true })
      ensurePlaceholderTextures(this)
      registerAnimations(this)
      this.bundle = parseConfigBundle({
        balance: this.cache.json.get('balance.json'),
        difficulty: this.cache.json.get('difficulty.json'),
        enemies: this.cache.json.get('enemies.json'),
      })
      this.cfg = parseCombatConfig(this.cache.json.get('combat.json'))
      this.rewardDefs = parseRewards(this.cache.json.get('rewards.json'))
      this.stageConfig = parseStageCollisions(
        this.cache.json.get('stage-collisions.json'),
        this.cfg.arena.maxStages,
      )
      this.drawWorld()
      this.session = new CombatSession(
        this,
        this.bundle,
        this.cfg,
        this.rewardDefs,
        this.difficulty,
        this.stageConfig,
      )
      this.cameras.main.stopFollow().removeBounds().setBackgroundColor(0x050916)
      this.fitCamera()
      this.scale.on('resize', this.fitCamera, this)
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
        this.scale.off('resize', this.fitCamera, this),
      )
      this.rewardPanel = new RewardPanel(this.session)
      this.gallery = new AssetGallery(this, () => this.toggleGallery())
      this.makeHud()
      this.cursor = new GameCursor(this)
      this.loot = new FirstBossLoot(this, this.session)
      this.loadout = new LoadoutHud(this, this.session)
      this.bossLabel = this.add
        .text(0, 0, '', {
          fontFamily: 'Microsoft YaHei',
          fontSize: '13px',
          color: '#ffd7a0',
          stroke: '#101426',
          strokeThickness: 4,
          align: 'center',
        })
        .setOrigin(0.5)
        .setDepth(4500)
      this.session.bus.on('entity_killed', (event) => {
        if (event.bossStage === this.stage) {
          this.loot.reset()
          this.loot.spawn(event.x, event.y)
          this.notice.setText('Boss 已击败 · 找到宝箱，按 E 开启并拾取随机武器')
        }
      })
      this.session.bus.on('reward_finished', (event) => {
        if (
          event.runId !== this.session.runId ||
          event.roomId !== 'd1-room-' + this.stage ||
          !this.clearEmitted ||
          this.gameWon ||
          this.nextRoundAtMs !== null ||
          !this.session.player.model.alive
        )
          return
        this.session.weapons.clear()
        if (this.stage >= this.cfg.arena.maxStages) {
          this.finishRun()
          return
        }
        this.session.pause('intermission')
        this.nextRoundAtMs = this.time.now + this.cfg.arena.intermissionMs
        const bonus = this.session.grantRandomWeapon()
        this.notice.setText(
          bonus ? '获得随机武器：' + bonus.name + ' · 准备下一轮' : '强化已生效 · 准备下一轮',
        )
      })
      this.bindKeys()
      this.spawnStage()
    } catch (e) {
      this.showFatal(e)
    }
  }
  override update(_time: number, delta: number): void {
    if (!this.session) return
    if (
      this.nextRoundAtMs !== null &&
      !this.session.reasons.has('hidden') &&
      !this.session.reasons.has('user') &&
      this.session.player.model.alive
    ) {
      const remaining = Math.max(0, this.nextRoundAtMs - this.time.now)
      this.notice.setText('下一轮即将开始 · ' + Math.ceil(remaining / 1000))
      if (remaining === 0) {
        this.nextRoundAtMs = null
        if (this.stage >= this.cfg.arena.maxStages) {
          this.finishRun()
          return
        }
        this.stage++
        this.session.resume('intermission')
        this.spawnStage()
      }
    }
    this.session.update(delta)
    this.loot.update()
    this.loadout.update()
    const boss = this.session.enemies.bossStatus(this.stage)
    this.bossLabel.setVisible(!!boss)
    if (boss)
      this.bossLabel
        .setPosition(boss.x, boss.y - (this.stage === this.cfg.arena.maxStages ? 92 : 78))
        .setText(
          '第 ' +
            this.stage +
            ' 层 · ' +
            (this.stage === this.cfg.arena.maxStages ? '终焉蛛王' : '蘑菇首领') +
            '\n' +
            Math.ceil(boss.hp) +
            ' / ' +
            boss.maxHp,
        )
    if (this.clearAt >= 0 && !this.clearEmitted && !this.session.clock.paused)
      this.session.enemies.simulateClear()
    if (
      this.spawned &&
      !this.gameWon &&
      this.session.player.model.alive &&
      !this.clearEmitted &&
      this.session.enemies.remaining === 0 &&
      (this.stage !== 1 || this.loot.completed) &&
      this.session.clock.nowMs > 500
    ) {
      this.clearEmitted = true
      this.session.bus.emit('room_cleared', {
        runId: this.session.runId,
        roomId: `d1-room-${this.stage}`,
      })
      this.notice.setText('第 ' + this.stage + ' 轮完成 · 选择一项强化')
    }
    this.layoutHud()
    this.updateHud()
    this.deathNotice.setVisible(this.gameWon || !this.session.player.model.alive)
    if (this.gameWon || !this.session.player.model.alive) {
      this.deathNotice.setText(
        this.gameWon
          ? '三层通关！\n终焉蛛王已击败\n按 R 重新开始'
          : this.session.player.model.deathCause === 'water'
            ? '落水身亡\n按 R 重新开始'
            : '你倒下了\n按 R 重新开始',
      )
      const camera = this.cameras.main
      this.deathNotice.setPosition(camera.width / 2, camera.height / 2)
    }
    this.gallery?.update(delta)
  }
  private drawWorld(): void {
    this.scenery = new StageBackground(
      this,
      this.cfg.arena.width,
      this.cfg.arena.height,
      this.stageConfig,
    )
  }
  private layoutHud(): void {
    const camera = this.cameras.main
    const uiScale = Math.min(1, Math.max(0.3, (camera.width - 36) / 450))
    this.notice
      .setScale(uiScale / camera.zoom)
      .setPosition(
        camera.width * camera.originX * (1 - 1 / camera.zoom) + 18 / camera.zoom,
        camera.height * camera.originY * (1 - 1 / camera.zoom) + (16 + 132 * uiScale) / camera.zoom,
      )
    this.deathNotice.setScale(Math.min(1, (camera.width - 32) / 320) / camera.zoom)
  }
  private fitCamera(): void {
    const zoom = Math.min(
      1,
      this.scale.width / this.cfg.arena.width,
      this.scale.height / this.cfg.arena.height,
    )
    this.cameras.main.setZoom(zoom).centerOn(this.cfg.arena.width / 2, this.cfg.arena.height / 2)
  }
  private finishRun(): void {
    if (this.gameWon) return
    this.gameWon = true
    this.nextRoundAtMs = null
    this.session.weapons.clear()
    this.session.pause('victory')
    this.notice.setText('全部三层已通关 · 按 R 开始新一局')
  }
  private spawnStage(): void {
    if (this.gameWon || this.stage > this.cfg.arena.maxStages) return
    this.loot.reset()
    this.session.enterStage(this.stage)
    this.scenery.setStage(this.stage)
    const p = stagePlan(this.bundle, this.cfg, this.difficulty, this.stage),
      cx = this.session.player.x,
      cy = this.session.player.y
    for (let i = 0; i < p.splitters; i++) {
      const a = (i / Math.max(1, p.splitters)) * Math.PI * 2
      this.session.enemies.spawn(
        'splitter',
        0,
        cx + Math.cos(a) * 250,
        cy + Math.sin(a) * 190,
        i >= Math.ceil(p.splitters * p.secondPhaseFraction) ? p.phaseDelayMs : 0,
      )
    }
    this.session.enemies.spawnBoss(
      this.stage,
      this.cfg.encounter.bossX,
      this.cfg.encounter.bossY,
      this.cfg.encounter.bossHp + (this.stage - 1) * this.cfg.encounter.bossHpPerStage,
      this.stage === this.cfg.arena.maxStages,
    )
    for (let i = 1; i < p.tanks; i++)
      this.session.enemies.spawn('tank', 0, cx + 360, cy - 180 + i * 140)
    this.spawned = true
    this.clearAt = -1
    this.clearEmitted = false
    this.notice.setText(
      `第 ${this.stage} / ${this.cfg.arena.maxStages} 层：${this.label()} · ${p.splitters} 分裂怪 + ${p.tanks} 肉盾`,
    )
  }
  private makeHud(): void {
    this.statusHud = new StatusHud(this)
    this.deathNotice = this.add
      .text(0, 0, '', {
        fontFamily: 'Microsoft YaHei, sans-serif',
        fontSize: '30px',
        color: '#ffffff',
        backgroundColor: '#091522dd',
        padding: { x: 26, y: 18 },
        align: 'center',
        lineSpacing: 12,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(10000)
      .setVisible(false)
    this.notice = this.add
      .text(28, 145, '', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#9fe8c8',
        wordWrap: { width: 900 },
      })
      .setScrollFactor(0)
      .setDepth(1001)
  }
  private updateHud(): void {
    const p = this.session.player
    this.statusHud.update(
      p.model.hp,
      p.model.maxHp,
      p.stamina,
      p.maxStamina,
      p.model.shield,
      p.model.maxShield,
    )
  }
  private toggleGallery(): void {
    if (this.gallery.root.hidden) {
      this.session.pause('preview')
      this.gallery.show()
    } else {
      this.gallery.hide()
      this.session.resume('preview')
    }
  }
  private requestClear(): void {
    if (this.session.clock.paused) return
    if (this.clearEmitted) return
    if (this.clearAt >= 0) return
    this.session.enemies.simulateClear()
    this.clearAt = this.session.clock.nowMs
    this.notice.setText('已请求清房：等待死亡/分裂链回收')
  }
  private bindKeys(): void {
    const k = this.input.keyboard
    k?.on('keydown-H', () => this.demoHit())
    k?.on('keydown-C', () => this.requestClear())
    k?.on('keydown-V', () => this.toggleGallery())
    k?.on('keydown-SPACE', () => this.session.togglePause())
    k?.on('keydown-R', () => this.restartDifficulty(this.difficulty))
    k?.on('keydown-E', () => this.loot.interact())
    k?.on('keydown-ONE', () =>
      this.loot.replacementPending ? this.loot.chooseReplacement(0) : this.session.equipSlot(0),
    )
    k?.on('keydown-TWO', () =>
      this.loot.replacementPending ? this.loot.chooseReplacement(1) : this.session.equipSlot(1),
    )
    k?.on('keydown-Q', () => this.session.cycleWeapon())
    k?.on('keydown-ESC', () => {
      if (this.loot.replacementPending) this.loot.reset()
      else if (this.scene.manager.keys['main-menu']) {
        this.session.destroy()
        this.scene.start('main-menu')
      }
    })
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      k?.removeAllListeners()
      this.rewardPanel?.destroy()
      this.cursor?.destroy()
      this.loot?.destroy()
      this.gallery?.destroy()
      this.session?.destroy()
    })
  }
  private demoHit(): void {
    const c = this.session.clock
    this.session.player.model.takeHit({
      sourceId: -2,
      hitKey: 'd1-hurt',
      mode: 'instant',
      sourceKind: 'aoe',
      amount: this.cfg.arena.demoDamage,
      frameId: c.frameId,
      nowMs: c.nowMs,
    })
  }
  private restartDifficulty(d: Difficulty): void {
    this.session.destroy()
    this.scene.restart({ difficulty: d })
  }
  private label(): string {
    return this.difficulty === 'easy' ? '入门' : this.difficulty === 'hard' ? '困难' : '普通'
  }
  private showFatal(e: unknown): void {
    const m = e instanceof Error ? e.message : String(e)
    console.error(e)
    this.add.text(40, 40, `D1 初始化失败\n${m}`, {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ff8b8b',
      wordWrap: { width: 1200 },
    })
  }
}
