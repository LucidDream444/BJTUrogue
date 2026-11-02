import Phaser from 'phaser'
import { CONFIG_FILE_NAMES, configUrl, parseConfigBundle, type ConfigBundle } from '@/core/config'
import { preloadAssets, ensurePlaceholderTextures, registerAnimations } from '@/core/assets'
import type { EnemyKind, Unsubscribe } from '@/core/events'
import type { VortexSnapshot } from '@/core/vortex'
import { CombatSession } from '@/domains/combat/CombatSession'
import { parseCombatConfig, parseRewards, type CombatConfig } from '@/domains/combat/config'
import type { StageCollisionConfig, SolidRect } from '@/domains/combat/StageGeometry'
import { MENU_SCENE_KEY } from '../../arenaCatalog'
import type { ArenaDefinition } from '../../ArenaBase'

type Scenario = 'muscovy' | 'cats' | 'mixed'
interface LabData { character?: number; weapon?: number; scenario?: Scenario; protected?: boolean; obstacles?: boolean }
interface EnemyLabel { kind: EnemyKind; text: Phaser.GameObjects.Text; hp: number | null }
interface LabButton { box: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text }
const CHARACTERS = [
  { id: 'student', name: '新生' }, { id: 'athlete', name: '大鹅' }, { id: 'scholar', name: '小红果' },
] as const

/** Real D1 player/weapons and the public EnemyBridge; no profile or product-scene edits. */
class DreamCombatArena extends Phaser.Scene {
  private session: CombatSession | null = null
  private cfg!: CombatConfig
  private bundle!: ConfigBundle
  private character = 2
  private weapon = 0
  private scenario: Scenario = 'mixed'
  private protectedMode = true
  private obstacles = true
  private readonly fields = new Map<number, VortexSnapshot>()
  private readonly units = new Map<number, EnemyLabel>()
  private readonly subscriptions: Unsubscribe[] = []
  private ui!: Phaser.GameObjects.Container
  private uiCamera!: Phaser.Cameras.Scene2D.Camera
  private hud!: Phaser.GameObjects.Text
  private notice!: Phaser.GameObjects.Text
  private obstacleInk!: Phaser.GameObjects.Graphics
  private buttons: LabButton[] = []
  private unitHits = 0
  private playerHits = 0

  constructor() { super('') }

  init(data: LabData = {}): void {
    this.character = data.character ?? 2
    this.weapon = data.weapon ?? 0
    this.scenario = data.scenario ?? 'mixed'
    this.protectedMode = data.protected ?? true
    this.obstacles = data.obstacles ?? true
    this.fields.clear()
    this.units.clear()
    this.buttons = []
    this.subscriptions.length = 0
    this.unitHits = this.playerHits = 0
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
      balance: this.cache.json.get('balance.json'), difficulty: this.cache.json.get('difficulty.json'),
      enemies: this.cache.json.get('enemies.json'),
    })
    this.cfg = parseCombatConfig(this.cache.json.get('combat.json'))
    this.cameras.main.setBackgroundColor('#19232d')
    this.obstacleInk = this.add.graphics().setDepth(-1)
    this.paintFloor()
    this.session = new CombatSession(this, this.bundle, this.cfg,
      parseRewards(this.cache.json.get('rewards.json')), 'normal', this.geometry())
    // Debug inventory only; each gun still equips through the real session path.
    this.session.inventory.splice(0, this.session.inventory.length, ...this.cfg.weapons.map((weapon) => weapon.id))
    this.session.player.setCharacter(CHARACTERS[this.character]!.id)
    this.session.equip(this.cfg.weapons[this.weapon]!.id, true)
    this.applyProtection()
    this.session.setAudioVolumes(this.cfg.audio.bgmVolume, this.cfg.audio.shotVolume)
    this.buildHud()
    this.subscribe()
    this.bindKeys()
    this.refreshScenario(this.scenario)
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this)
    this.layout()
  }

  private solids(): SolidRect[] {
    if (!this.obstacles) return []
    const { width: w, height: h } = this.cfg.arena
    const thickness = this.cfg.terrain.navigationCellSize
    return [
      { id: 'dream_lab_wall_n', x: w * 0.5, y: h * 0.14, width: thickness, height: h * 0.29 },
      { id: 'dream_lab_wall_s', x: w * 0.5, y: h * 0.65, width: thickness, height: h * 0.23 },
      { id: 'dream_lab_desk', x: w * 0.76, y: h * 0.7, width: w * 0.13, height: thickness },
    ]
  }

  private geometry(): StageCollisionConfig {
    return {
      schemaVersion: 1, navigationCellSize: this.cfg.terrain.navigationCellSize,
      sourceSize: { width: this.cfg.arena.width, height: this.cfg.arena.height },
      stages: [{ stage: 1, playerSpawn: this.spawnPoint(), solids: this.solids(), furniture: [] }],
    }
  }

  private spawnPoint(): { x: number; y: number } {
    return { x: this.cfg.arena.width * 0.36, y: this.cfg.arena.height * 0.52 }
  }

  private paintFloor(): void {
    const g = this.obstacleInk, { width: w, height: h } = this.cfg.arena
    g.clear().lineStyle(1, 0x34424a, 0.65)
    const step = this.cfg.terrain.navigationCellSize
    for (let x = 0; x <= w; x += step) g.lineBetween(x, 0, x, h)
    for (let y = 0; y <= h; y += step) g.lineBetween(0, y, w, y)
    g.lineStyle(3, 0xdce5df, 0.85).strokeRect(0, 0, w, h)
    for (const wall of this.solids()) {
      g.fillStyle(0xdce5df).fillRect(wall.x, wall.y, wall.width, wall.height)
      g.lineStyle(2, 0x758e92).strokeRect(wall.x, wall.y, wall.width, wall.height)
    }
  }

  private buildHud(): void {
    const panel = this.add.rectangle(0, 0, this.scale.width, 150, 0x0c141c, 0.98).setOrigin(0)
    this.hud = this.add.text(14, 10, '', {
      fontFamily: 'Microsoft YaHei, monospace', fontSize: '14px', color: '#eef3e9', lineSpacing: 5,
    })
    this.notice = this.add.text(14, 0, '', {
      fontFamily: 'Microsoft YaHei, monospace', fontSize: '13px', color: '#f6d69a',
      backgroundColor: '#0c141c', padding: { x: 9, y: 7 }, wordWrap: { width: this.scale.width - 44 },
    })
    this.ui = this.add.container(0, 0, [panel, this.hud, this.notice]).setDepth(10000)
    const actions: [string, () => void][] = [
      ['番鸭 B', () => this.refreshScenario('muscovy')],
      ['双猫 C', () => this.refreshScenario('cats')],
      ['混合 M', () => this.refreshScenario('mixed')],
      ['换角色 Tab', () => this.selectCharacter(1)],
      ['保护 I', () => this.toggleProtection()],
      ['障碍 O', () => this.toggleObstacles()],
      ['回满重置 R', () => this.restartLab()],
      ['菜单 Esc', () => this.leaveLab()],
    ]
    for (const [title, action] of actions) {
      const box = this.add.rectangle(0, 0, 100, 28, 0x233849).setStrokeStyle(1, 0x718f95)
        .setInteractive({ useHandCursor: true })
      const label = this.add.text(0, 0, title, {
        fontFamily: 'Microsoft YaHei, monospace', fontSize: '13px', color: '#eff2db',
      }).setOrigin(0.5)
      box.on('pointerdown', (_pointer: Phaser.Input.Pointer, _x: number, _y: number,
        event: Phaser.Types.Input.EventData) => {
        // Stop the UI click before CombatSession treats it as the first shot.
        event.stopPropagation()
        action()
      })
      this.buttons.push({ box, label })
      this.ui.add([box, label])
    }
    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height, false, 'dreamLabHud')
    this.uiCamera.ignore(this.children.list.filter((object) => object !== this.ui))
    this.cameras.main.ignore(this.ui)
  }

  private subscribe(): void {
    const session = this.session!
    this.subscriptions.push(
      session.bus.on('entity_spawned', (event) => {
        if (event.kind !== 'enemy' || !event.enemyKind) return
        const kind = event.enemyKind
        const text = this.add.text(event.x, event.y, '', {
          fontFamily: 'Microsoft YaHei, monospace', fontSize: '13px', color: '#ffffff',
          backgroundColor: '#101922cc', padding: { x: 3, y: 2 }, align: 'center',
        }).setOrigin(0.5, 1).setDepth(5000)
        this.uiCamera.ignore(text)
        this.units.set(event.id, { kind, text, hp: null })
      }),
      session.bus.on('entity_damaged', (event) => {
        if (event.targetKind === 'player') { this.playerHits++; return }
        this.unitHits++
        const unit = this.units.get(event.targetId)
        if (unit) unit.hp = event.hpAfter
      }),
      session.bus.on('entity_killed', (event) => {
        const unit = this.units.get(event.id)
        if (unit) { unit.text.destroy(); this.units.delete(event.id) }
        if (event.kind === 'player') this.notice.setText('玩家已倒下：按 H 或 R 原地重建测试场，保留当前角色、武器和场景选择。')
      }),
      session.bus.on('enemy_vortex_started', (field) => this.fields.set(field.fieldId, field)),
      session.bus.on('enemy_vortex_ended', ({ fieldId }) => this.fields.delete(fieldId)),
    )
  }

  private bindKeys(): void {
    const keyboard = this.input.keyboard!
    keyboard.addCapture(['SPACE', 'TAB', 'OPEN_BRACKET', 'CLOSED_BRACKET'])
    const keys = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX']
    keys.forEach((key, index) => keyboard.on(`keydown-${key}`, () => this.equip(index)))
    keyboard.on('keydown-OPEN_BRACKET', () => this.selectCharacter(-1))
    keyboard.on('keydown-CLOSED_BRACKET', () => this.selectCharacter(1))
    keyboard.on('keydown-TAB', () => this.selectCharacter(1))
    keyboard.on('keydown-B', () => this.refreshScenario('muscovy'))
    keyboard.on('keydown-C', () => this.refreshScenario('cats'))
    keyboard.on('keydown-M', () => this.refreshScenario('mixed'))
    keyboard.on('keydown-ZERO', () => { this.clearEnemies(); this.notice.setText('清场完成；B 番鸭 / C 双猫 / M 混合，可重新生成。') })
    keyboard.on('keydown-O', () => this.toggleObstacles())
    keyboard.on('keydown-I', () => this.toggleProtection())
    keyboard.on('keydown-H', () => this.restartLab())
    keyboard.on('keydown-R', () => this.restartLab())
    keyboard.on('keydown-P', () => this.session?.togglePause())
    keyboard.on('keydown-SPACE', () => this.session?.togglePause())
    keyboard.on('keydown-ESC', () => this.leaveLab())
  }

  private equip(index: number): void {
    const weapon = this.cfg.weapons[index]
    if (weapon && this.session?.equip(weapon.id, true)) this.weapon = index
  }

  private selectCharacter(direction: number): void {
    if (!this.session?.player.model.alive) return
    this.character = (this.character + direction + CHARACTERS.length) % CHARACTERS.length
    this.session.player.setCharacter(CHARACTERS[this.character]!.id)
    this.notice.setText(`已切换为${CHARACTERS[this.character]!.name}；三角色均使用正式身体与武器，测试场不修改局外存档。`)
  }

  private applyProtection(): void {
    const session = this.session
    if (!session) return
    session.player.model.protectedUntilMs = this.protectedMode ? Infinity : session.clock.nowMs
  }

  private toggleProtection(): void {
    this.protectedMode = !this.protectedMode
    this.applyProtection()
  }

  private toggleObstacles(): void {
    this.obstacles = !this.obstacles
    this.clearEnemies()
    this.session?.loadFloor(this.geometry())
    this.paintFloor()
    this.refreshScenario(this.scenario)
  }

  private leaveLab(): void {
    this.releaseSession()
    const location = new URL(window.location.href)
    location.searchParams.delete('arena')
    window.history.replaceState(null, '', location)
    this.scene.start(MENU_SCENE_KEY)
  }

  private clearEnemies(): void {
    this.session?.enemies.despawnAll()
    this.session?.weapons.clear()
    this.session?.clearRoomSkillObjects()
    this.session?.drops.clear()
    this.fields.clear()
    for (const unit of this.units.values()) unit.text.destroy()
    this.units.clear()
    this.unitHits = this.playerHits = 0
  }

  private refreshScenario(scenario: Scenario): void {
    const session = this.session
    if (!session || !session.player.model.alive) return
    this.scenario = scenario
    this.clearEnemies()
    const { width: w, height: h } = this.cfg.arena
    const spawn = (kind: EnemyKind, x: number, y: number, gen = 0) => session.enemies.spawn(kind, gen, w * x, h * y)
    if (scenario !== 'cats') {
      spawn('muscovy', 0.14, 0.34)
      spawn('tank', 0.29, 0.34)
    }
    if (scenario !== 'muscovy') {
      spawn('nightmare_cat', 0.72, 0.34)
      spawn('nightmare_cat', 0.84, 0.49)
      spawn('tank', 0.71, 0.51)
    }
    if (scenario === 'mixed') {
      spawn('splitter', 0.23, 0.73)
      spawn('sprayer', 0.79, 0.83)
    }
    const summary = scenario === 'muscovy' ? '番鸭＋课本：站在课本后方引导直冲，观察互伤、固定方向与墙前停下。'
      : scenario === 'cats' ? '双猫＋课本：靠近触发旋风，观察轻吸、互伤和真实子弹弯曲；击杀猫看正常猫遁入虚空。'
        : '混合对照：左侧番鸭与课本，右侧双猫与课本，下方纸团和喷灌器；中央墙保留宽通路。'
    this.notice.setText(summary)
  }

  override update(_time: number, delta: number): void {
    const session = this.session
    if (!session) return
    this.applyProtection()
    session.update(delta)
    // Newly spawned runtime sprites and effects must be absent from the HUD camera.
    this.uiCamera.ignore(this.children.list.filter((object) => object !== this.ui))
    for (const [id, unit] of this.units) {
      const position = session.enemies.position(id)
      if (!position) continue
      const definition = this.bundle.enemies.enemies[unit.kind]
      const phase = [...this.fields.values()].some((field) => field.ownerId === id) ? '旋风中' : ''
      unit.text.setPosition(position.x, position.y - 42).setText(
        `${definition.displayName} #${id}${phase ? ` · ${phase}` : ''}\n${unit.hp === null ? '满血' : `HP ${Math.ceil(unit.hp)}`}`,
      )
    }
    const player = session.player, model = player.model
    const scenario = this.scenario === 'muscovy' ? '番鸭' : this.scenario === 'cats' ? '双猫' : '混合'
    this.hud.setText([
      `D1 梦境实战场 · ${CHARACTERS[this.character]!.name} · ${session.weapon.name} · ${scenario} · frame ${session.clock.frameId}`,
      `HP ${Math.ceil(model.hp)}/${model.maxHp}  护盾 ${Math.ceil(model.shield)}/${model.maxShield}  能量 ${Math.ceil(player.stamina)}/${player.maxStamina}  保护${this.protectedMode ? '开' : '关'}  障碍${this.obstacles ? '开' : '关'}  ${session.clock.paused ? '已暂停（P继续）' : '运行中'}`,
      `WASD 移动 / 鼠标左键射击    1–6 六把枪    [ ] 或 Tab 三角色    P/空格 暂停/继续`,
      `B 番鸭＋课本    C 双猫＋课本    M 混合    0 清场    O 障碍开关    I 保护开关    H/R 回满重置    Esc 菜单`,
      `存活/待生成 ${session.enemies.remaining}  旋风场 ${this.fields.size}  敌方受伤事件 ${this.unitHits}  玩家受伤 ${this.playerHits}  账本 ${session.enemies.ledgerPairs}  真实物理体 ${this.physics.world.bodies.size}`,
    ])
  }

  private layout(): void {
    const { width: w, height: h } = this.scale
    const header = 162, footer = 56, fieldHeight = Math.max(80, h - header - footer)
    this.cameras.main.setViewport(0, header, w, fieldHeight)
      .setZoom(Math.min(w / this.cfg.arena.width, fieldHeight / this.cfg.arena.height))
      .centerOn(this.cfg.arena.width / 2, this.cfg.arena.height / 2)
    this.uiCamera.setViewport(0, 0, w, h)
    const panel = this.ui.first as Phaser.GameObjects.Rectangle
    panel.setSize(w, header)
    this.hud.setFontSize(w < 900 ? 11 : 14)
    this.notice.setPosition(10, h - footer).setWordWrapWidth(w - 40)
    const gap = 7, buttonWidth = (w - 28 - gap * (this.buttons.length - 1)) / this.buttons.length
    this.buttons.forEach((button, index) => {
      const x = 14 + buttonWidth / 2 + index * (buttonWidth + gap)
      button.box.setPosition(x, 140).setSize(buttonWidth, 28)
      if (button.box.input) (button.box.input.hitArea as Phaser.Geom.Rectangle).setSize(buttonWidth, 28)
      button.label.setPosition(x, 140).setFontSize(w < 900 ? 10 : 13)
    })
  }

  private restartLab(): void {
    this.releaseSession()
    this.scene.restart({ character: this.character, weapon: this.weapon, scenario: this.scenario,
      protected: this.protectedMode, obstacles: this.obstacles } satisfies LabData)
  }

  private releaseSession(): void {
    for (const off of this.subscriptions.splice(0)) off()
    this.session?.destroy()
    this.session = null
  }

  private cleanup(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this)
    this.input.keyboard?.removeAllListeners()
    // Normal exits release CombatSession before Phaser shuts down its StaticGroups.
    this.releaseSession()
  }
}

export const arena: ArenaDefinition = {
  displayName: 'D1 小红果与梦境新敌人实战',
  description: '真实角色/六枪/番鸭/双旋风猫；1–6换枪、Tab换角色、B/C/M刷新、O障碍、I保护、H/R回满重置。',
  scene: DreamCombatArena,
}
