import { applyPaintedRooms, parsePaintedRoomConfig, paintedGateSide } from './PaintedRooms'
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
import { parseStageCollisions, stageGeometry, type StageCollisionConfig } from './StageGeometry'
import { buildDungeonStages, type DungeonStages } from './DungeonStages'
import { ROOMS_CONFIG_NAME, parseRoomsConfig } from '@/domains/procgen/config'
import { ROOM_KIND_LABELS } from '@/domains/procgen/model/types'
import { Minimap } from './Minimap'
import { FirstBossLoot } from '@/domains/combat/FirstBossLoot'
import { LoadoutHud } from '@/domains/combat/LoadoutHud'
// —— 局外成长（D4）的两个界面组件：暂停菜单、结算界面 ——
//
// 这两个都是**可复用组件**（不是场景），接法就是宿主给一个 `host` 对象：
// 「暂停语义」「这一局打了多少」由战斗场景提供，界面与规则归 D4。
// 它们本来只能在测试场里跑（`?arena=d4_pause` / `?arena=d4_settlement`），
// 这里接上之后才是产品里的那一份。
import {
  META_CONFIG_NAME,
  META_CONFIG_URL,
  parseMetaConfig,
  type MetaConfig,
} from '@/domains/meta/metaConfig'
import { PauseOverlay } from '@/domains/meta/pause/PauseOverlay'
import { ProfileStore } from '@/domains/meta/profile/ProfileStore'
import { LocalStorageProfileStorage } from '@/domains/meta/profile/storage'
import type { RunInput } from '@/domains/meta/progress/progress'
import { RunLedger } from '@/domains/meta/run/RunLedger'
import { SettlementOverlay } from '@/domains/meta/settlement/SettlementOverlay'

/**
 * 一局的楼层参数。**三个数要一起给** —— `totalRooms` / `mainRoomMin` / `mainRoomMax`
 * 互相约束，写歪一个校验器就拒。
 *
 * ⚠️ **别把三个数设成同一个值**（那是我犯过的错）：那样侧室数是
 * `totalRooms − 主干数 = 0`，一层就是**一条直线**，没有任何路线决策 ——
 * 而那正是随机生成的全部意义。这里 7 间 = **4 间主干 + 3 间侧室**：
 * 侧室挂在主干某一间的侧墙上，于是那一间就有**三个门**（前、后、侧）,
 * 走到那儿要选往哪边走。
 */
const ROOMS_PER_RUN = { totalRooms: 7, mainRoomMin: 4, mainRoomMax: 4 }

/** 「站在门口」的距离门槛（世界像素）。**量的是到门矩形的最短距离**，贴着门就是 0。 */
const DOOR_REACH = 50

/** 刷怪时要求怪物中心离墙至少这么远（世界像素）。比怪物半径大一点，别一出生就嵌在墙里。 */
const ENEMY_CLEARANCE = 26

/**
 * 刷怪点离**玩家出生点**至少这么远（世界像素）。
 *
 * 4 格。比 `rooms.json` 的 `spawnPointMinGap`（80px，那是两个刷怪点之间）大一倍 ——
 * 玩家比怪胖、而且一进房间是站着不动的，给的距离要比怪与怪之间宽。
 */
const SAFE_SPAWN_GAP = 160

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
  /**
   * 这一层的生成结果（D2）。**「一间房 = 一关」** —— `this.stage` 就是
   * 「第几间」（1 起），`enterStage(stage)` 换的就是那一间的几何。
   * 拆法见 `DungeonStages.ts` 的文件头。
   */
  private dungeon!: DungeonStages
  /** 本间的门开了没有。开了才让按 `F` 过门。 */
  private doorOpen = false
  /**
   * 已经进过的房间（0 起）。**回走的房间不该再刷一遍怪** ——
   * 没有这一条，回头再进门就是重打一遍，而「能回头」立刻变成惩罚。
   */
  private visited = new Set<number>()
  /** 局内成长选完了没有。和 `loot.completed` 一起决定门什么时候开。 */
  private rewardDone = false
  /** 右上角的一层缩略图。**层内走门很容易走丢**，没有它玩家不知道还剩几间。 */
  private minimap!: Minimap
  /** 本局的楼层种子。**每局都换**，留在场上是为了能复现同一层。 */
  private runSeed = 0
  /** 过门的键。**和暂停的 `ESC`、拾取的 `E` 错开**，别让人捡东西时误过门。 */
  private passKey!: Phaser.Input.Keyboard.Key

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
  /**
   * 这一层有几间。**取代原来写死的 `arena.maxStages`（3）** ——
   * 现在几间由 D2 生成器按 `rooms.json` 决定。
   *
   * `arena.maxStages` 仍是配置里的字段（校验器要它），但运行时不再读：
   * 两个数并存就是第二份会漂的事实。
   */
  private get roomCount(): number {
    return this.dungeon?.rooms.length ?? this.cfg.arena.maxStages
  }
  init(data: { difficulty?: Difficulty } = {}): void {
    this.difficulty = data.difficulty ?? 'normal'
    this.stage = 1
    this.clearAt = -1
    this.clearEmitted = false
    this.spawned = false
    this.gameWon = false
    this.visited.clear()
    this.rewardDone = false
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
      'painted-rooms.json',
      'rewards.json',
      // D2 的地牢生成配置。**必须走 Phaser 的 loader，不能 fetch** ——
      // 场景生命周期保证 `create()` 一定在所有加载完成之后才跑。
      ROOMS_CONFIG_NAME,
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
      // 关卡几何来自 **D2 的生成器**：一层楼拆成「一间房 = 一关」。
      // ⚠️ 房间数要走 `roomsConfigWithRoomCount()` 把 `totalRooms` / `mainRoomMin` /
      //    `mainRoomMax` **三个数一起改**，直接写死一个会被校验器拒（那三个数互相约束）。
      // ⚠️ **种子必须每局换**。`combat.json` 里那个 `arena.seed` 是**固定值**
      //    （它本来是给测试场复现用的），拿它当每局的种子 = 每局都生成一模一样的一层楼，
      //    「随机生成」四个字就没了。下面把用到的种子留在场上，方便复现同一层。
      this.runSeed = (Math.random() * 0x7fffffff) | 0
      this.dungeon = applyPaintedRooms(
        buildDungeonStages(
          this.runSeed,
          parseRoomsConfig({
            ...(this.cache.json.get(ROOMS_CONFIG_NAME) as object),
            ...ROOMS_PER_RUN,
          }),
          this.cfg,
        ),
        parseStageCollisions(this.cache.json.get('stage-collisions.json'), 3),
        parsePaintedRoomConfig(this.cache.json.get('painted-rooms.json')),
        this.cfg,
      )
      // 过 D1 自己的校验器。**不是形式**：关编号、标识唯一、矩形不越界、
      // 出生点不在墙里 —— 四条都是这个接法最容易错的地方，而错了都不报错。
      this.stageConfig = parseStageCollisions(this.dungeon.stages, this.roomCount)
      this.doorOpen = false
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
      this.minimap = new Minimap(
        this,
        this.dungeon.rooms.map((r) => r.room),
        this.dungeon.rooms.map((r) => r.doorTargets),
      )
      this.rewardPanel = new RewardPanel(this.session)
      this.gallery = new AssetGallery(this, () => this.toggleGallery())
      this.makeHud()
      this.cursor = new GameCursor(this)
      // 过门的键。**和拾取的 `E`、暂停的 `ESC` 错开**，别让人捡东西时误过门。
      this.passKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F)
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
        // 首领也不例外：**每一间都是「清完 → 开箱 → 门开」**，首领那间不再单独掉。
        if (event.bossStage === this.stage) this.notice.setText('首领已击败')
      })
      this.session.bus.on('reward_finished', (event) => {
        if (
          event.runId !== this.session.runId ||
          event.roomId !== 'd1-room-' + this.stage ||
          !this.clearEmitted ||
          this.gameWon ||
          this.doorOpen ||
          !this.session.player.model.alive
        )
          return
        this.session.weapons.clear()
        if (this.stage >= this.roomCount) {
          this.finishRun()
          return
        }
        // 门开了，**不倒计时**：这一层的下一间要玩家自己走过去按 F。
        // （原来这里 `pause('intermission')` + 1.6 秒后自动进下一关 ——
        //  一层楼变成「一间房一关」之后，层内是走门，不是等表。）
        this.rewardDone = true
        this.tryOpenDoor()
        const bonus = this.session.grantRandomWeapon()
        // **报出下一间是什么**：门开了但不知道推门之后是什么，是这一层第二个卡人的地方。
        const next = this.roomLabel(this.stage + 1)
        this.notice.setText(
          (bonus ? '获得随机武器：' + bonus.name + ' · ' : '强化已生效 · ') +
            `门开了（绿色）· 下一间：${next} · 按 F 过门`,
        )
      })
      // ---- 局外成长（D4）：这一局打的账、暂停菜单、结算界面 ----
      //
      // 战斗场景需要一份档（结算要发币），但**不是**在战斗里读它改它 ——
      // 档只在"这一局结束"和"打开暂停菜单"这两个时刻被碰，核心循环里一个字都没有。
      this.store = new ProfileStore({ storage: new LocalStorageProfileStorage() })
      this.store.load()
      const syncAudio = (): void => {
        const { bgmVolume, sfxVolume } = this.store.profile.settings
        this.session.setAudioVolumes(bgmVolume, sfxVolume)
      }
      syncAudio()
      const unsubscribeAudio = this.store.subscribe(syncAudio)
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribeAudio)
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
          //
          // 2026-10-16 补上「能量」与「装备技能」：它们原来一直显示「—」，
          // 因为这份快照**压根没给**这几个字段 —— 不是界面的问题。（原来的注释写
          // "护盾 / 能量 / 技能在 balance.json 里还没有字段"，早就过时了：玩家现在有护盾，
          // 能量就是 `combat.json` 的 `player.maxStamina`，也就是战斗 HUD 上那条「能量」。）
          //
          // ⚠️ 三个名字指同一个东西，是**历史遗留**而不是笔误，别照着一个去改另一个：
          // 界面写「能量」，D4 的快照字段叫 `magic`（局外成长里那条成长线的 id 也是 `magic`，
          // 显示名倒是「能量上限」），D1 这边叫 `stamina`。要统一是跨域改名，得先在群里说 ——
          // 这里只做映射。
          snapshot: () => ({
            characterId: this.store.profile.selected.characterId,
            hp: Math.round(this.session.player.model.hp),
            maxHp: this.session.player.model.maxHp,
            shield: Math.round(this.session.player.model.shield),
            maxShield: this.session.player.model.maxShield,
            magic: Math.round(this.session.player.stamina),
            maxMagic: this.session.player.maxStamina,
            weaponName: this.session.weapon.name,
            skillName: this.skillNames(),
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
    // 过门：门开着（这一间打完了）、人活着、没暂停 —— 按 F 进下一间。
    // **不需要站在门口**：门已经开着的语义是「这一间结束了」，
    // 逼人先走回门口没有任何信息量，只会让捡完东西还得跑一趟。
    if (
      this.doorOpen &&
      Phaser.Input.Keyboard.JustDown(this.passKey) &&
      !this.session.reasons.has('hidden') &&
      !this.session.reasons.has('user') &&
      this.session.player.model.alive
    ) {
      if (this.stage >= this.roomCount) {
        this.finishRun()
        return
      }
      const to = this.doorAhead()
      if (to === null) {
        // 尽头那扇门（`toOrder === null`）：不是「回不去」，是**门外没有房间**。
        this.notice.setText('要走到门口才能过门（门开着是绿色的）')
      } else {
        this.enterRoom(to)
      }
    }
    // 门一开就换成亮绿 + 呼吸 + 箭头 —— 打完一间找不到门出不去是这一层最容易卡人的地方。
    // 用场景时间（`this.time.now`）而不是 `performance.now()`：暂停时场景时间会停，
    // 画面才是静的。
    this.tryOpenDoor()
    this.scenery.setDoorOpen(this.doorOpen)
    this.scenery.update(this.time.now)
    this.session.update(delta)
    this.loot.update()
    this.loadout.update()
    const boss = this.session.enemies.bossStatus(this.stage)
    this.bossLabel.setVisible(!!boss)
    if (boss)
      this.bossLabel
        .setPosition(boss.x, boss.y - (this.stage === this.roomCount ? 92 : 78))
        .setText(
          '第 ' +
            this.stage +
            ' 层 · ' +
            (this.stage === this.roomCount
              ? '终焉蛛王'
              : this.stage === 2
                ? this.bundle.enemies.stage2Boss.displayName
                : '蘑菇首领') +
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
      this.reachableRemaining() === 0 &&
      // ⚠️ **这里不能要求 `loot.completed`。** 宝箱是**清空的那一刻**才掉的，
      //    把它写进清空条件就成了「要开箱才判清空、要判清空才掉箱」——
      //    一个永远满足不了的前置，表现是「打完怪什么都不发生」。
      //    「开完箱」是**开门**的条件（见 `tryOpenDoor`），不是「清场」的条件。
      this.session.clock.nowMs > 500
    ) {
      this.clearEmitted = true
      // 清房数由宿主报：C1 的 `GameEvents` 里还没有 `room_cleared`（D2 的改动日志
      // 点过名），而账本只订阅总线上已有的事件。事件一进 C1，这行就可以换成订阅。
      this.ledger.countClearedRoom()
      if (this.needsFight()) {
        // **成长只从「打完怪」来。**
        //
        // ⚠️ 这里原来是无条件发的，于是不用打的房间（道具关 / 宝箱关）一进门就
        //    当帧判清空、也发一次成长 —— 玩家的体感是「打完怪给了一次，
        //    过一道门又给一次」，而那两间其实是**两件不同的事**：
        //    前者是「清了场」，后者是「这间本来就没怪」。
        this.session.bus.emit('room_cleared', {
          runId: this.session.runId,
          roomId: `d1-room-${this.stage}`,
        })
        // **宝箱只给主干线**（以及不打怪的侧室，见下面那一支）。
        // 侧室里的普通战斗房是支线，打完给三选一就够了 —— 每条支线都塞一个宝箱，
        // 宝箱就不值钱了。
        if (this.onMainLine()) {
          this.loot.reset()
          this.loot.spawn(this.session.player.x, this.session.player.y - 60)
          this.notice.setText(
            '第 ' + this.stage + ' 间完成 · 选择一项强化 · 地上有宝箱（E 开，不开也能走）',
          )
        } else {
          this.notice.setText('第 ' + this.stage + ' 间完成（支线）· 选择一项强化')
        }
      } else {
        // 不用打的房间：门直接开，**不给成长**，但**要给宝箱** ——
        // 不打怪的房间如果连宝箱都没有，它就是个纯过道，玩家没有理由进来。
        // （`chest` / `reward` 这类关别存在的意义就是「进来拿东西」。）
        this.loot.reset()
        this.loot.spawn(this.session.player.x, this.session.player.y - 60)
        this.doorOpen = true
        const next = this.roomLabel(this.stage + 1)
        this.notice.setText(`本间不用打 · 门开着 · 有宝箱（E 开）· 下一间：${next}`)
      }
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
      // 关别定本间底色；`rectInBox` / `doorTargets` 让观感层把「墙外」和
      // 「门那边是第几间、什么关别」一起画出来 —— 玩家从门洞看进去就能看见下一间。
      this.dungeon.rooms.map((r) => ({
        kind: r.room.kind,
        rectInBox: r.rectInBox,
        doorTargets: r.doorTargets,
        gateSides: r.doorTargets.map((_, i) => paintedGateSide(r, i)),
      })),
    )
  }
  private layoutHud(): void {
    const camera = this.cameras.main
    this.minimap.layout(camera)
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
    this.session.weapons.clear()
    this.session.pause('victory')
    this.notice.setText('全部三层已通关 · 按 R 开始新一局')
  }
  /**
   * 本间在第几档难度上。
   *
   * D1 的 `stagePlan()` **只认 1..`arena.maxStages`（3），超了直接抛**。
   * 一层楼有十几间，所以把「第几间」按进度映射回那三档 —— 前半层是一档、
   * 后半层是三档。**不改成按房间预算刷怪**：那会让 D1 调好的数量曲线作废，
   * 而这次要换的是几何，不是战斗节奏。
   */
  private stageTier(): number {
    const n = Math.max(1, this.roomCount),
      top = this.cfg.arena.maxStages
    const t = 1 + Math.round(((this.stage - 1) / Math.max(1, n - 1)) * (top - 1))
    return Math.min(top, Math.max(1, t))
  }
  /** 第 `n` 间（1 起）的中文关别名。越界给「—」。 */
  private roomLabel(n: number): string {
    const k = this.dungeon?.rooms[n - 1]?.room.kind
    return k ? (ROOM_KIND_LABELS[k] ?? k) : '—'
  }
  /**
   * 还活着、而且**站在本间可走地面上**的怪有几只。
   *
   * 清场判定用它，不用 `enemies.remaining` —— 后者把「被挤到墙外、再也打不到的怪」
   * 也算在内，于是**那一间永远清不完，玩家卡死**。
   * 挤出墙外本身是物理的锅（已经重叠的静态体会把它继续往外推），
   * 刷怪那一侧已经用 `safeSpawn()` 堵住了大头；这里是不让它变成死锁的兜底。
   */
  private reachableRemaining(): number {
    if (this.session === undefined) return 0
    const enemies = this.session.enemies
    // ⚠️ **起点是 `remaining`，不是 `targets().length`。**
    //
    // `remaining = 池子里活着的 + 排队还没出生的`；而 `targets()` 只有**已经出生**的。
    // 刷怪是带延迟的（第二批有 `phaseDelayMs`），所以进房间那一刻「已出生的」是 0 ——
    // 拿 `targets().length` 当判据就会**当帧判定清空**：宝箱立刻掉、门立刻开、
    // 一局七间房连怪都没见着就"通关"了。
    //
    // 这里只做一件事：把**已经挤出墙外、再也打不到**的那些从 `remaining` 里扣掉。
    let escaped = 0
    for (const t of enemies.targets()) {
      if (!this.session.terrain.isWalkable(t.x, t.y, 4)) escaped++
    }
    return Math.max(0, enemies.remaining - escaped)
  }

  /**
   * 门什么时候开：**成长选完 + 这一间的宝箱开完**。
   *
   * 两件事都做完才开 —— 少等一件就会出现「门开了但宝箱还没捡」，
   * 而回头去捡又得绕一圈。
   */
  private tryOpenDoor(): void {
    // ⚠️ **只看成长选完没有，不看宝箱。**
    //    早先要求「宝箱也开完」，于是清完怪还得去开箱捡一把武器才能过门 ——
    //    而宝箱现在是**每间都掉的额外奖励**，不是通关条件。捡不捡随你。
    if (this.rewardDone) this.doorOpen = true
  }
  /**
   * 玩家最近的那扇门通向第几间（0 起）；`null` = 那扇门通向墙外（尽头）。
   *
   * **按最近的算**，不按"哪扇都行" —— 一间房有三个门的时候，
   * "哪扇都行"就等于把另外两个门作废，那正是原来那个 bug。
   */
  private doorAhead(): number | null {
    const brief = this.dungeon.rooms[this.stage - 1]
    if (brief === undefined) return null
    // ⚠️ **必须走 `stageGeometry()` 转换后的坐标。**
    //    `stageConfig.stages[n].solids` 是**取景框坐标**（0~760），而玩家的位置是
    //    **竞技场坐标**（0~1344，已经 `fitMapFrame` 缩放 + 居中）—— 两者差了 2 倍
    //    还多一个平移。直接拿原始坐标比，距离永远是个巨大的数，**怎么走都判不过**。
    //    物理和寻路读的都是这里返回的这一份，所以它才是「门在世界里的位置」。
    const layout = stageGeometry(
      this.stageConfig,
      this.stage,
      this.cfg.arena.width,
      this.cfg.arena.height,
    )
    let best: number | null = null
    let bestDist = Infinity
    const doors = layout.solids.filter((z) => z.id.startsWith('door'))
    doors.forEach((d, i) => {
      // ⚠️ 量的是**玩家到这个矩形的距离**，不是到它的中心点。
      //    门洞长边 120（框坐标）× 缩放后在世界里是 250px —— 按中心点量，
      //    站在门的一端时离中心 125px，会被判成「没站在门口」而过不去。
      const dx = Math.max(d.x - this.session.player.x, 0, this.session.player.x - (d.x + d.width))
      const dy = Math.max(d.y - this.session.player.y, 0, this.session.player.y - (d.y + d.height))
      const dist = Math.hypot(dx, dy)
      if (dist < bestDist) {
        bestDist = dist
        best = brief.doorTargets[i] ?? null
      }
    })
    // ⚠️ **必须站在门口。**
    //
    // 早先只挑「离得最近的那扇」，站在房间中间按 F 也能过 —— 于是走去哪一间
    // 由距离决定，**看起来就像随机**：明明想走左门，结果因为右门近一点就去了右边那间。
    // 现在要求贴着门（到矩形 50px 以内），站房间中间按 F 只会提示「走到门口」。
    return bestDist <= DOOR_REACH ? best : null
  }
  /** 本间在不在主干线上（`Room.branch === 'main'`）。宝箱只给主干线。 */
  private onMainLine(): boolean {
    return this.dungeon?.rooms[this.stage - 1]?.room.branch === 'main'
  }
  /** 本间是不是首领房（`Room.kind === 'boss'`，D2 只放在最后一间）。 */
  private isBossRoom(): boolean {
    return this.dungeon?.rooms[this.stage - 1]?.room.kind === 'boss'
  }
  /** 本间要不要打（D2 的 `roomNeedsFight`：关别要打 **且** 有刷怪点）。 */
  private needsFight(): boolean {
    return this.dungeon?.rooms[this.stage - 1]?.needsFight ?? true
  }
  /**
   * 进第 `order` 间（0 起）。**门指向哪一间就进哪一间** —— 不是 `stage + 1`。
   *
   * ⚠️ 原来过门是 `this.stage++`，于是在一间有两个门的房间里，**选哪扇门都去同一间**，
   * 多出来的门完全没有意义。现在按门的 `toOrder` 走：往前、往后、往侧室，都由门自己说了算。
   */
  private enterRoom(order: number): void {
    if (order < 0 || order >= this.roomCount) return
    const first = !this.visited.has(order)
    this.stage = order + 1
    this.spawnStage(!first)
  }
  private spawnStage(revisit = false): void {
    if (this.gameWon || this.stage > this.roomCount) return
    this.visited.add(this.stage - 1)
    // ⚠️ **进新的一间必须把门关回去。**
    //    `doorOpen` 是上一间的状态，不清的话会跟着带进来 ——
    //    表现是「新房间的怪还没打完，门就能过」。
    //    只有回走（`revisit`，那间已经清过了）和不用打的房间才直接开着。
    this.doorOpen = revisit
    this.rewardDone = revisit
    this.loot.reset()
    this.session.enterStage(this.stage, revisit)
    this.scenery.setStage(this.stage)
    // ⚠️ 第二参数是**必须给的**，别退回 `setState(this.stage)`：
    //    小地图上「这间走过没有」不能用「间号比当前小」推 —— 门是按 `toOrder` 走的
    //    （能回头、也能拐进侧室再出来），于是老推理在两个方向都会说假话：
    //    拐进侧室时宿主右边的房间根本没进过却被画成绿的。
    //    真值是 `visited`，这里正好刚把它更新过（上面那行 `visited.add`）。
    this.minimap.setState(this.stage, this.visited)
    const p = stagePlan(this.bundle, this.cfg, this.difficulty, this.stageTier()),
      cx = this.session.player.x,
      cy = this.session.player.y
    // 不用打的房间（道具关 / 宝箱关）：**一只都不刷**。下方 `remaining === 0`
    // 于是当帧就判清空、门立刻开 —— 照 `roomNeedsFight()` 的原话，
    // 不这么做它们会把玩家关在里面（没有可清的怪，门永远不会开）。
    // 回走的房间已经清过了：**不再刷怪**，门直接开着。
    if (this.needsFight() && !revisit) {
      // ⚠️ **刷怪用 D2 给的刷怪点，不要「以玩家为圆心撒一圈」。**
      //    原来那套（`cx ± 250`）是按 1344×832 的大竞技场调的，而 D2 的房间只有
      //    520×280 —— 250px 的半径直接把怪撒在玩家脸上，开局被围死、跑都跑不掉。
      //    `spawnPoints[0]` 是玩家出生的那一个（见 `DungeonStages`），跳过它。
      // ⚠️ **离玩家出生点太近的刷怪点要跳过。**
      //    `spawnPoints[0]` 是玩家自己站的那个（`DungeonStages` 按距离排过序），
      //    但**第二近的那个可能只有一步远** —— 一进房间就被打一下，那不是难度，是偷袭。
      //    门槛取两倍的 `spawnPointMinGap`（那是「两个刷怪点之间」的最小间距）。
      const p0 = this.dungeon?.rooms[this.stage - 1]?.spawnPoints[0]
      const spots = (this.dungeon?.rooms[this.stage - 1]?.spawnPoints ?? [])
        .slice(1)
        .filter((q) => {
          if (p0 === undefined) return true
          const far = Math.hypot(q.x - p0.x, q.y - p0.y)
          return far >= SAFE_SPAWN_GAP
        })
      // ⚠️ **刷怪点也要过 `safeSpawn()`。**
      //    D2 的刷怪点是从门可达的，但**不一定离墙够远** —— 怪的物理体一出生就
      //    和墙重叠，物理解算会把它**继续往外推**（已经重叠的静态体，推开方向由
      //    最小穿透轴决定，可能是墙外），于是它卡在墙外再也回不来，
      //    而清场判定数的是「还活着的怪」→ **这一间永远清不完，卡死**。
      const at = (i: number) => {
        const raw = spots.length === 0 ? { x: cx, y: cy } : spots[i % spots.length]!
        return this.session.terrain.safeSpawn(raw.x, raw.y, ENEMY_CLEARANCE)
      }
      // 怪比刷怪点多时同一个点会叠人 —— 按序号错开一点，避免完全重合
      const offset = (i: number) => (spots.length && i >= spots.length ? (i % 3) * 26 - 26 : 0)
      for (let i = 0; i < p.splitters; i++) {
        const s = at(i)
        this.session.enemies.spawn(
          'splitter',
          0,
          s.x + offset(i),
          s.y + offset(i),
          i >= Math.ceil(p.splitters * p.secondPhaseFraction) ? p.phaseDelayMs : 0,
        )
      }
      for (let i = 0; i < p.tanks; i++) {
        const s = at(p.splitters + i)
        this.session.enemies.spawn(
          'tank',
          0,
          s.x + offset(p.splitters + i),
          s.y + offset(p.splitters + i),
        )
      }
      // 首领：**主干线上每一间都出一个**（侧室不出）。
      //
      // ⚠️ 早先我把它收成「只在 `kind: 'boss'` 那一间」—— 一层只有一间是 boss，
      //    于是**第二关的霜翼使徒再也没出过场**（那套图集白做了）。
      //    现在按**难度档位**（`stageTier()`，1~3）挑首领，第 1 档是蘑菇首领、
      //    第 2 档是霜翼使徒、第 3 档是终焉蛛王 —— 和原来「一关一个」的节奏一致。
      //    侧室（分支 `side`）不出首领：它们是支线，不该挡住主线。
      const onMainLine = this.dungeon?.rooms[this.stage - 1]?.room.branch === 'main'
      if (this.isBossRoom() || onMainLine) {
        const tier = this.stageTier()
        this.session.enemies.spawnBoss(
          tier,
          this.dungeon?.rooms[this.stage - 1]?.spawnPoints[0]?.x ?? cx,
          (this.dungeon?.rooms[this.stage - 1]?.spawnPoints[0]?.y ?? cy) - 40,
          this.cfg.encounter.bossHp + (tier - 1) * this.cfg.encounter.bossHpPerStage,
          this.isBossRoom(),
        )
      }
    }
    this.spawned = true
    this.clearAt = -1
    this.clearEmitted = revisit
    if (revisit) this.doorOpen = true
    // 到达层数：结算的「到达进度」用它，也是币的主要来源（`coinsPerDepth`）
    this.ledger.setDepth(this.stage)
    const room = this.dungeon?.rooms[this.stage - 1]?.room
    this.notice.setText(
      `第 ${this.stage} / ${this.roomCount} 间：${room?.kind ?? '?'} ` +
        `${room ? room.rect.width + '×' + room.rect.height : ''} · ${this.label()} · ` +
        (this.needsFight() ? p.splitters + ' 分裂怪 + ' + p.tanks + ' 肉盾' : '不用打'),
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
  /**
   * 暂停面板「装备技能」那一行要显示的名字。
   *
   * 技能是**档里的东西**（`profile.unlocks.skills`，名字在 `meta.json`），
   * 而 `this.meta` 正好是这一局已经加载好的那份配置 —— 顺手就取了，
   * 不用为一行字再把配置往 D4 的面板里传一份。
   *
   * ⚠️ 这只是**显示**。技能的**效果**还没接进战斗：`progress.ts` 算出来的那几条
   * 派生属性目前没有任何战斗代码去读（D1 / D4 之间的缺口，见改动日志）。
   * 所以这一行说明的是"档里有这个技能"，**不等于**"这一局它在生效"。
   */
  private skillNames(): string | undefined {
    const ids = this.store.profile.unlocks.skills
    if (!ids.length) return undefined
    return ids.map((id) => this.meta?.skills[id]?.name ?? id).join('、')
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
      k.on('keydown-ESC', () => {
        if (this.loot.replacementPending) this.loot.cancelReplacement()
        else this.togglePauseMenu()
      })
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
