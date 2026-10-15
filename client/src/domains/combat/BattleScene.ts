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
// —— 局外成长（D4）的两个界面组件：暂停菜单、结算界面 ——
//
// 这两个都是**可复用组件**（不是场景），接法就是宿主给一个 `host` 对象：
// 「暂停语义」「这一局打了多少」由战斗场景提供，界面与规则归 D4。
// 它们本来只能在测试场里跑（`?arena=d4_pause` / `?arena=d4_settlement`），
// 这里接上之后才是产品里的那一份。
import { META_CONFIG_NAME, META_CONFIG_URL, parseMetaConfig, type MetaConfig } from '@/domains/meta/metaConfig'
import { PauseOverlay } from '@/domains/meta/pause/PauseOverlay'
import { ProfileStore } from '@/domains/meta/profile/ProfileStore'
import { LocalStorageProfileStorage } from '@/domains/meta/profile/storage'
import type { RunInput } from '@/domains/meta/progress/progress'
import { RunLedger } from '@/domains/meta/run/RunLedger'
import { SettlementOverlay } from '@/domains/meta/settlement/SettlementOverlay'

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

  /* ---- 局外成长（D4）：一局的账本、结算界面、暂停菜单 ---- */

  private store!: ProfileStore
  /** 成长数值表。**读不出来时是 `null`**，那时这一局照常玩，只是结束时退回旧的那行文字 */
  private meta: MetaConfig | null = null
  private ledger!: RunLedger
  private settlement: SettlementOverlay | null = null
  private pauseMenu!: PauseOverlay
  /**
   * 这一局结算过没有。
   *
   * ⚠️ **必须有这道闸门**：死亡和通关在 `update()` 里是"每帧都成立"的条件，
   * 而 `R` 也会走同一条路 —— 没有它，币会按帧翻倍。
   * （`SettlementOverlay.show()` 自己也幂等，那是第二层保险，不是这一道的替代品。）
   */
  private runEnded = false
  private runOutcome: RunInput['outcome'] = 'dead'

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
    // 场景实例是复用的，字段必须在这里回到初始值 —— 漏了 `runEnded` 的话，
    // 重开的第二局一上来就"已经结算过"，结算界面再也不会出现。
    this.runEnded = false
    this.settlement = null
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
    // 文件名与路径走 D4 的常量，别在这里再写一遍字面量（`metaConfig.ts` 是唯一真值）
    this.load.json(META_CONFIG_NAME, META_CONFIG_URL)
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
      // ---- 局外成长（D4）：这一局打的账、暂停菜单、结算界面 ----
      //
      // 战斗场景需要一份档（结算要发币），但**不是**在战斗里读它改它 ——
      // 档只在"这一局结束"和"打开暂停菜单"这两个时刻被碰，核心循环里一个字都没有。
      this.store = new ProfileStore({ storage: new LocalStorageProfileStorage() })
      this.store.load()
      try {
        this.meta = parseMetaConfig(this.cache.json.get(META_CONFIG_NAME))
      } catch (err) {
        // 成长表读不出来**不该让这一局玩不下去**：战斗照常，结束时退回原来那行文字。
        // （与 `MainMenuScene` 对同一份表的态度一致：那个菜单也照常能用。）
        this.meta = null
        console.error('[meta] 成长配置读不出来：', err)
      }
      this.ledger = new RunLedger(this.session.bus)
      if (this.meta) {
        this.settlement = new SettlementOverlay({
          scene: this,
          store: this.store,
          meta: this.meta,
          host: {
            // 击杀数由账本自己从总线上数（`entity_killed`）；层数与清房数由这里报。
            runInput: () => this.ledger.input(this.runOutcome),
            restart: () => this.restartRun(),
            // 结算的「返回主菜单」回**标题画面**（D1 的 `main-menu`），
            // 不是 D4 那个局外成长主菜单 —— 打完一局先看到的是标题。
            backToMenu: () => this.backToMenu(),
          },
        })
      }
      this.pauseMenu = new PauseOverlay({
        scene: this,
        store: this.store,
        host: {
          // 需求 §4.3：「暂停后敌人、子弹、伤害与战斗计时一并停止」。
          // 时钟 + 物理世界**都要**冻，理由见 `PauseOverlay` 文件头。
          //
          // 用 `'user'` 这个 reason 而不是另起一个：`update()` 里"下一轮倒计时"
          // 那段本来就靠 `reasons.has('user')` 判断要不要暂停推进。
          pause: () => this.session.pause('user'),
          resume: () => {
            // ⚠️ **两种暂停都要清**，只清 'user' 会把玩家永久卡住：
            //
            // `'hidden'` 是 `CombatSession` 自己在 `window.blur` / 标签页切走时加的
            // （防的是"人不在的时候继续挨打"）。以前的唯一出口是空格上的
            // `session.togglePause()`，而那个键现在归暂停菜单了 —— 于是"切出去过一趟"
            // 之后再点「继续游戏」，`'hidden'` 还留在集合里，时钟永远不动。
            // （实测：blur 之后菜单开着也停、关掉还停。）
            //
            // 顺序无所谓：`resume()` 只在"集合空了"的时候才真的恢复时钟，
            // 所以两条都调，谁先谁后都对。
            this.session.resume('user')
            this.session.resume('hidden')
          },
          // 暂停菜单里的「返回主菜单」**不结算**：需求 §4.3 写的是
          // 「本局进度不会保存」，确认后直接回主菜单。
          quitToMenu: () => this.backToMenu(),
          // 暂停期间这些值不会变，所以 `PauseOverlay` 只在打开时取一次快照。
          // 护盾 / 能量 / 技能在 `balance.json` 里还没有字段，不给就是「—」。
          snapshot: () => ({
            characterId: this.store.profile.selected.characterId,
            hp: Math.round(this.session.player.model.hp),
            maxHp: this.session.player.model.maxHp,
            shield: Math.round(this.session.player.model.shield),
            maxShield: this.session.player.model.maxShield,
            weaponName: this.session.weapon.name,
          }),
        },
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
      // 清房数由宿主报：C1 的 `GameEvents` 里还没有 `room_cleared`（D2 的改动日志
      // 点过名），而账本只订阅总线上已有的事件。事件一进 C1，这行就可以换成订阅。
      this.ledger.countClearedRoom()
      this.notice.setText('第 ' + this.stage + ' 轮完成 · 选择一项强化')
    }
    this.layoutHud()
    this.updateHud()
    const ended = this.gameWon || !this.session.player.model.alive
    if (ended) this.endRun(this.gameWon ? 'cleared' : 'dead')
    // 结算面板铺上去之后就不需要这行兜底文字了（面板上的信息更全）。
    // 只有成长表读不出来、结算建不出来时，才退回原来那套"按 R 重新开始"。
    const fallbackNotice = ended && this.settlement === null
    this.deathNotice.setVisible(fallbackNotice)
    if (fallbackNotice) {
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
    // 到达层数：结算的「到达进度」用它，也是币的主要来源（`coinsPerDepth`）
    this.ledger.setDepth(this.stage)
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
    // `R` = **先结算、再重开**（见 `restartRun`）—— 不再是"把这一局白扔"的调试键
    k?.on('keydown-R', () => this.restartRun())
    k?.on('keydown-E', () => this.loot.interact())
    k?.on('keydown-ONE', () =>
      this.loot.replacementPending ? this.loot.chooseReplacement(0) : this.session.equipSlot(0),
    )
    k?.on('keydown-TWO', () =>
      this.loot.replacementPending ? this.loot.chooseReplacement(1) : this.session.equipSlot(1),
    )
    k?.on('keydown-Q', () => this.session.cycleWeapon())
    if (k) {
      // 这几个键默认会让页面滚动（`Scale.RESIZE` 下画布就是整页）—— 不捕获的话
      // 按一下空格整页就跳。
      k.addCapture(['SPACE', 'ESC', 'UP', 'DOWN', 'ENTER'])
      // ⚠️ 暂停的键盘入口**只有这一处**（`togglePauseMenu`）。宿主自己再绑一个
      // "Esc 关菜单"，按一下就会同时又关又开 —— 见 `PauseOverlay` 文件头。
      k.on('keydown-ESC', () => this.togglePauseMenu())
      k.on('keydown-SPACE', () => this.togglePauseMenu())
      k.on('keydown-UP', () => this.pauseMenu.handleMoveFocus(-1))
      k.on('keydown-DOWN', () => this.pauseMenu.handleMoveFocus(1))
      k.on('keydown-ENTER', () => this.pauseMenu.handleActivate())
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      k?.removeAllListeners()
      // 退订要**显式**做：`SettlementOverlay` 没订阅什么，但 `PauseOverlay`
      // 在构造里订了 `RESIZE` —— 漏掉的话重启三次就留三个重建回调。
      this.ledger?.dispose()
      this.settlement?.destroy()
      this.pauseMenu?.destroy()
      this.rewardPanel?.destroy()
      this.cursor?.destroy()
      this.loot?.destroy()
      this.gallery?.destroy()
      this.session?.destroy()
    })
  }
  /**
   * Esc / 空格的**唯一**入口（需求 §4.6：暂停按钮 / Esc → 暂停菜单）。
   *
   * 优先级是排过的，三件事不能颠倒：
   *
   * 1. **结算面板开着** → 什么都不做。结算是死胡同（需求 §4.6 只给了
   *    「重新开始」和「返回主菜单」两条路），能按 Esc 溜掉的话，
   *    玩家会在没看清"这一局得了多少币"的时候回到菜单。
   * 2. **正在选武器替换** → 这一下 Esc 是"取消"（原有的行为）。
   * 3. 其余交给 `PauseOverlay` —— 顶着菜单时它是"继续游戏"，否则是"打开菜单"。
   */
  private togglePauseMenu(): void {
    if (this.settlement?.isOpen) return
    if (this.loot.replacementPending) {
      this.loot.reset()
      return
    }
    // 只被「切走窗口」暂停时（`'hidden'`，菜单没开），这一下就是**继续** ——
    // 旧版空格走的就是这条路。不这么做的话，玩家为了回到游戏得先开一次菜单、
    // 再关掉（多按一次），而屏幕上本来就没有菜单可关，看起来就是"暂停后恢复不了"。
    // 还有一处更隐蔽的：奖励三选一的时候切走窗口，`reasons` 是 `[reward, hidden]` ——
    // 这里把 `'hidden'` 清掉之后 `'reward'` 仍然挡着，选完奖励自然就继续了。
    if (!this.pauseMenu.isOpen && this.session.reasons.has('hidden')) {
      this.session.resume('hidden')
      return
    }
    this.pauseMenu.handleToggleKey()
  }

  /**
   * 这一局结束了：**先记账，再把结算面板铺上去**
   * （需求 §4.6：血量归零 / 通关 → 结算界面 → 重新开始 / 返回主菜单）。
   *
   * ⚠️ **幂等**，见 `runEnded` 那段注释。
   */
  private endRun(outcome: RunInput['outcome']): void {
    if (this.runEnded) return
    this.runEnded = true
    this.runOutcome = outcome
    this.ledger.setDepth(this.stage)
    if (!this.settlement) return
    this.settlement.show()
  }

  /**
   * `R`：**先结算、再重开**。一次按键不再把这一局白扔。
   *
   * - 死亡 / 通关之后（面板已经开着）：结算早就发生过了，直接重开；
   * - 局进行中：记一次「主动退出」的账再重开 —— 面板在同一个 tick 里就被场景
   *   重启拆掉了，所以看不到它，但这一局的收益已经进了档。
   */
  private restartRun(): void {
    if (!this.runEnded) this.endRun('quit')
    this.settlement?.hide()
    this.restartDifficulty(this.difficulty)
  }

  /**
   * 回**标题画面**（D1 的 `main-menu`），不是 D4 那个局外成长主菜单。
   *
   * **不结算**：暂停菜单里那条「返回主菜单」按需求 §4.3 是"本局进度不会保存"，
   * 结算只有"这一局打完了"（死亡 / 通关）才发生。
   */
  private backToMenu(): void {
    this.session.destroy()
    if (this.scene.manager.keys['main-menu']) this.scene.start('main-menu')
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
