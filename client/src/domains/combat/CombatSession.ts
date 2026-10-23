import Phaser from 'phaser'
import { GameClock } from '@/core/time'
import { Rng } from '@/core/rng'
import { TypedBus, type Unsubscribe } from '@/core/events'
import { allocActorId } from '@/core/actor/ActorModel'
import type { ConfigBundle, Difficulty } from '@/core/config'
import { Player } from './Player'
import { planReplacement } from './WeaponInventory'
import { TerrainMap } from './TerrainMap'
import { StageColliders } from './StageColliders'
import { stageGeometry, type StageCollisionConfig } from './StageGeometry'
import { EnemyBridge } from './EnemyBridge'
import { Weapons } from './Weapons'
import { CombatFeedback } from './CombatFeedback'
import { CombatAudio } from './CombatAudio'
import { RewardRun } from './RewardRun'
import { RecoveryDrops } from './RecoveryDrops'
import {
  deriveStats,
  type CombatConfig,
  type RewardDef,
  type WeaponDef,
  type WeaponId,
  type EffectiveStats,
  type PermanentRunStats,
  type CharacterSkillConfig,
} from './config'
import type { CombatEvents } from './events'
import { CharacterSkill, type SkillStatus } from './CharacterSkill'
export type PauseReason =
  | 'user'
  | 'hidden'
  | 'reward'
  | 'preview'
  | 'death'
  | 'intermission'
  | 'victory'
  /**
   * **抓取怪抓住了玩家**：世界冻结、镜头特写、只留挣脱连点。
   *
   * 它和其他 reason 的关键区别是**没有自动到期** —— 解冻时机由抓取序列决定
   * （挣脱 / 硬上限 / 玩家死亡），所以 D1 侧必须有一条无条件兜底，
   * 否则任何一条路径漏掉就是永久卡死（见 `BattleScene` 的抓取驱动）。
   */
  | 'grab'
/** Gameplay component: no imports from the arena/test harness. */
export class CombatSession {
  readonly clock = new GameClock()
  readonly bus = new TypedBus<CombatEvents>()
  readonly runId = `run-${allocActorId()}`
  readonly terrain: TerrainMap
  private readonly stageColliders: StageColliders
  readonly player: Player
  readonly enemies: EnemyBridge
  readonly weapons: Weapons
  readonly drops: RecoveryDrops
  readonly rewards: RewardRun
  readonly feedback: CombatFeedback
  private readonly audio: CombatAudio
  readonly reasons = new Set<PauseReason>()
  private readonly unsubs: Unsubscribe[] = []
  private readonly waterZones: Phaser.GameObjects.Zone[] = []
  private readonly waterColliders: Phaser.Physics.Arcade.Collider[] = []
  private previousFeet!: { x: number; y: number }
  private readonly playerCollider: Phaser.Physics.Arcade.Collider
  private readonly aim = new Phaser.Math.Vector2()
  readonly inventory: WeaponId[] = ['pencil']
  private readonly weaponRng = new Rng((20261014 ^ (Date.now() >>> 0)) >>> 0)
  weapon: WeaponDef
  stats: EffectiveStats
  private permanent: PermanentRunStats
  private temporaryAttackSpeedPct = 0
  private skill: CharacterSkill | null = null
  kills = 0
  private dead = false
  private disposed = false
  constructor(
    private readonly scene: Phaser.Scene,
    readonly bundle: ConfigBundle,
    readonly cfg: CombatConfig,
    readonly rewardDefs: RewardDef[],
    readonly difficulty: Difficulty,
    private stageConfig: StageCollisionConfig,
  ) {
    this.terrain = new TerrainMap(cfg, stageConfig.navigationCellSize)
    const firstRoom = stageGeometry(stageConfig, 1, cfg.arena.width, cfg.arena.height)
    this.terrain.setStage(firstRoom)
    const spawn = this.terrain.safeSpawn(
      firstRoom.playerSpawn.x,
      firstRoom.playerSpawn.y,
      bundle.balance.baseline.player.radius,
    )
    this.weapon = cfg.weapons[0]!
    this.rewards = new RewardRun(rewardDefs, new Rng(cfg.arena.seed))
    this.permanent = {
      maxHp: bundle.balance.baseline.player.maxHp,
      maxStamina: cfg.player.maxStamina,
      maxShield: cfg.player.maxShield,
      attackSpeedPct: 0,
      moveSpeedPct: 0,
      energyRegenPct: 0,
    }
    this.stats = deriveStats(
      bundle.balance,
      cfg,
      this.weapon,
      rewardDefs,
      this.rewards.stacks,
      this.permanent,
      0,
    )
    scene.physics.world.resume()
    scene.physics.world.setBounds(0, 0, cfg.arena.width, cfg.arena.height)
    this.player = new Player(scene, this.clock, cfg, bundle.balance, this.bus, spawn.x, spawn.y)
    this.previousFeet = { x: this.player.x, y: this.player.feetY }
    const largestEnemyRadius = Math.max(
      bundle.enemies.enemies.tank.radius,
      bundle.enemies.stage2Boss.radius,
      ...bundle.enemies.enemies.splitter.generations.map((g) => g.radius),
    )
    this.player.setWeapon(this.weapon)
    this.enemies = new EnemyBridge(
      scene,
      this.bus,
      this.clock,
      bundle,
      difficulty,
      () => this.player.view(),
      cfg.arena.seed,
      {
        originX: 0,
        originY: 0,
        cellSize: this.terrain.cellSize,
        cols: Math.ceil(cfg.arena.width / this.terrain.cellSize),
        rows: Math.ceil(cfg.arena.height / this.terrain.cellSize),
        isWalkable: (x, y) => this.terrain.isWalkable(x, y, largestEnemyRadius),
        // ⚠️ 第四个参数是**通行半径**（能走到那儿的是谁），不是摆放净空 ——
        //    见 `TerrainMap.safeSpawn()` 上那段：只传 `radius` 的话，
        //    比门洞粗的东西会把整间房判成「不可达」，落点被扔到走廊去。
        //    怪刷在自己的房间里，但**要能走到它跟前的是玩家**，所以取玩家半径。
        safeSpawn: (x, y, radius) =>
          this.terrain.safeSpawn(x, y, radius, bundle.balance.baseline.player.radius),
        projectileBlocked: (x0, y0, x1, y1, radius) =>
          x1 < radius ||
          y1 < radius ||
          x1 > this.terrain.width - radius ||
          y1 > this.terrain.height - radius ||
          this.terrain.crossesSolid({ x: x0, y: y0 }, { x: x1, y: y1 }, radius),
      },
    )
    for (const rect of this.terrain.water) {
      const zone = scene.add.zone(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
        rect.width,
        rect.height,
      )
      scene.physics.add.existing(zone, true)
      this.waterZones.push(zone)
      this.waterColliders.push(scene.physics.add.collider(this.enemies.group, zone))
    }
    // Non-pushable by enemies, but still separable from static desks and walls.
    this.player.body.setImmovable(false)
    this.player.body.pushable = false
    this.stageColliders = new StageColliders(
      scene,
      this.player.anchor,
      this.enemies.group,
      // ⚠️ **挡板也算在这个上限里**（`StageColliders.rebuild` 把两者加进同一个组）。
      //    漏掉它的话，整层那一份几何（~190 块墙 + 16 扇门）会在**组满之后**把门
      //    一扇扇地丢掉 —— 而 `Group.add()` 满了是**静默返回**的（不抛、不警告），
      //    表现是「最后几扇门永远关不上」。`+ 64` 是给门留的余量，比今天实际用的多。
      Math.max(...stageConfig.stages.map((s) => s.solids.length)) +
        Math.max(...stageConfig.stages.map((s) => s.barriers?.length ?? 0)) +
        64,
    )
    // ⚠️ **挡板必须在这里一起建出来，漏了它的失败模式是「门封不上，而且不报错」。**
    //
    // 整层连续（2026-10-21）之后门不再是「换一张几何」而是**原地开关的挡板**
    // （见 `StageColliders.doorZones`），而这道开关要能按，挡板就得先在物理世界里存在。
    // 早先这一行是 `rebuild(this.terrain)` —— 少了第二个参数，`barriers` 走默认值 `[]`，
    // 于是 16 扇门**一块挡板都没建**：`setSealed()` 遍历一个空数组（什么都不做）、
    // `sealedOrders()` 恒返回 `[]`。表现是**玩家在战斗中可以随时走出房间**
    // （于是能带着满屋子的怪跑到走廊里、再走回来），而控制台**一个字都没有**。
    //
    // `enterStage()` 那一头本来就是对的（它传了 `layout.barriers ?? []`），
    // 所以这个错**只在「刚进场景、还没换过层」那一段存在** —— 更难被发现。
    this.stageColliders.rebuild(this.terrain, firstRoom.barriers ?? [])
    this.playerCollider = scene.physics.add.collider(
      this.player.anchor,
      this.enemies.group,
      (_player, enemy) => this.enemies.touchPlayer(enemy as Phaser.GameObjects.GameObject),
    )
    this.audio = new CombatAudio(scene, this.bus, cfg.audio)
    this.weapons = new Weapons(
      scene,
      this.clock,
      cfg,
      new Rng(cfg.arena.seed + 1),
      this.enemies,
      this.player,
      this.terrain,
      () => this.audio.fire(),
    )
    this.feedback = new CombatFeedback(scene, this.bus, this.clock, cfg, (id) =>
      id === this.player.model.id
        ? { x: this.player.x, y: this.player.y }
        : this.enemies.position(id),
    )
    this.drops = new RecoveryDrops(
      scene,
      this.clock,
      cfg.drops,
      this.player,
      new Rng(cfg.arena.seed + 2),
    )
    this.unsubs.push(
      this.bus.on('room_cleared', (e) => {
        if (e.runId !== this.runId || !this.player.model.alive) return
        const options = this.rewards.offer(
          e.roomId,
          this.weapon.id,
          this.player.model.hp,
          this.player.model.maxHp,
          (reward) => this.rewardChanges(reward).length > 0,
        )
        if (options === null) return
        if (options.length) this.pause('reward')
        this.bus.emit('reward_offered', { ...e, ids: options.map((r) => r.id) })
        if (!options.length) this.bus.emit('reward_finished', { ...e, reason: 'empty' })
      }),
      this.bus.on('entity_killed', (e) => {
        if (e.kind === 'enemy') {
          this.kills++
          this.drops.enemyDefeated(e.id, e.x, e.y)
        } else this.dead = true
      }),
    )
    scene.events.on(Phaser.Scenes.Events.PRE_UPDATE, this.beforePhysics, this)
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this)
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this)
    window.addEventListener('blur', this.onBlur)
    document.addEventListener('visibilitychange', this.onVisibility)
  }
  /**
   * **换一整层楼**：外层的几何整份换掉（`stageConfig` 是 D2 另一次生成的产物），
   * 落到新层的第 1 间。
   *
   * 一层楼一张图，层与层之间连房间数都可能一样、但**每个坐标都不一样** ——
   * 所以这不是 `enterStage()` 那种「同一份几何里的第 n 关」，
   * 而是「把几何换掉再进第 1 关」。`enterStage(1)` 那三步（寻路网格、碰撞体、
   * 玩家落脚点）本来就是按 `stageConfig` 重算的，所以换完几何再走一遍就全对了。
   *
   * `keepLoadout` 走默认的 `false`：枪和强化**跨层保留**（那是局内成长，`inventory`
   * 和强化都不在这里清），清掉的只是这一层留下的**子弹与地面掉落物** ——
   * 那些东西的坐标属于旧那一层，带下去只会散在新房间的地板上。
   */
  loadFloor(stageConfig: StageCollisionConfig): void {
    this.stageConfig = stageConfig
    this.enterStage(1)
  }

  /**
   * 封门。`sealed` 是**应该封着的那些房号**（`Room.order`），不是开关指令 ——
   * 重传同一个集合不会抖（见 `StageColliders.setSealed`）。
   *
   * 「哪些该封」是关卡的规则、归宿主（`BattleScene` 按 `roomFlow.doorShouldBeClosed`
   * 判）；这里只把结论落到物理上。**判定与执行分开**是为了那条规则能在 node 里单测
   * —— 它已经测过了，`roomFlow.test.ts`。
   *
   * ⚠️ `enterStage()` 里那次 `rebuild()` 结尾已经把所有的门**打开**了
   * （新的一层，没有哪一间在打）。所以从上一层带下来的"封着"不会串到这一层。
   */
  sealDoors(sealed: ReadonlySet<number>): void {
    this.stageColliders.setSealed(sealed)
  }
  /**
   * 转接：换几何 → 重建碰撞 → 找落脚点 → 清输入 → 挪人。
   *
   * `keepLoadout`：**回走**到一间打过的房间时用。清装备是「进入新的一关」的语义，
   * 而回走不是新关 —— 把玩家手里的枪洗掉只会让人不敢往回走，
   * 而回走正是这一层想要的「地牢感」。
   */
  enterStage(stage: number, keepLoadout = false): void {
    const layout = stageGeometry(
      this.stageConfig,
      stage,
      this.cfg.arena.width,
      this.cfg.arena.height,
    )
    if (!keepLoadout) {
      this.weapons.clear()
      this.drops.clear()
    }
    this.terrain.setStage(layout)
    // ⚠️ 挡板**只给碰撞体、不给 `terrain`**：`terrain.setStage(layout)` 只吃
    //    `solids`，而门洞必须留在寻路网格之外（进了网格整层就变成一间间孤岛，
    //    见 `StageGeometry.StageLayout.barriers`）。
    this.stageColliders.rebuild(this.terrain, layout.barriers ?? [])
    const spawn = this.terrain.safeSpawn(
      layout.playerSpawn.x,
      layout.playerSpawn.y,
      this.player.model.stats.radius,
    )
    this.player.clearInput()
    this.player.body.reset(spawn.x, spawn.y)
    this.player.draw()
    this.previousFeet = { x: this.player.x, y: this.player.feetY }
  }

  private onDown(pointer: Phaser.Input.Pointer): void {
    if (!pointer.leftButtonDown()) return
    // ⚠️ **抓取期间这一条必须排在暂停守卫之前。** 世界是冻结的，下面那句
    //    `!this.clock.paused` 会把按键整条吃掉 —— QTE 就永远收不到输入，
    //    表现是「连点没反应」，而且不报任何错。
    //    转的是**按下边沿**（`POINTER_DOWN` 本身就是离散事件），按住只算一次。
    if (this.reasons.has('grab')) {
      this.enemies.grabPress()
      return
    }
    if (!this.clock.paused && this.player.model.alive) this.weapons.firing = true
  }
  private onUp(): void {
    this.weapons.stopFiring()
  }
  private readonly onBlur = (): void => this.pause('hidden')
  private readonly onVisibility = (): void => {
    if (document.hidden) this.pause('hidden')
  }
  private beforePhysics(_time: number, delta: number): void {
    if (!this.clock.paused) this.checkWater()
    const before = this.clock.nowMs
    this.clock.advance(delta)
    if (this.dead) this.pause('death')
    if (this.clock.paused || this.clock.frozen) {
      this.scene.physics.world.pause()
      return
    }
    this.scene.physics.world.resume()
    const pointer = this.scene.input.activePointer
    this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y, this.aim)
    if (!this.skill?.isDashing()) this.player.move(this.clock.nowMs - before, true)
    this.player.aim(this.aim.x, this.aim.y, this.weapons.firing)
    this.player.advanceStamina(this.clock.nowMs - before, this.weapons.firing)
    this.weapons.update(this.stats, this.weapon)
  }
  update(delta: number): void {
    if (!this.clock.paused) this.checkWater()
    if (this.dead) {
      this.pause('death')
      this.weapons.clear()
    }
    this.enemies.update(delta)
    this.skill?.update(this.clock.nowMs)
    this.drops.update()
    this.player.draw()
    this.weapons.resolveTerrain()
    this.weapons.draw()
    this.feedback.update()
  }
  private checkWater(): void {
    const feet = { x: this.player.x, y: this.player.feetY }
    if (this.player.model.alive && this.terrain.crossesWater(this.previousFeet, feet)) {
      this.player.model.fallIntoWater()
      this.weapons.clear()
      this.pause('death')
    }
    this.previousFeet = feet
  }

  setAudioVolumes(bgm: number, sfx: number): void {
    this.audio.setVolumes(bgm, sfx)
  }

  pause(reason: PauseReason): void {
    if (this.reasons.has(reason)) return
    const already = this.reasons.size > 0
    this.reasons.add(reason)
    this.clock.pause()
    this.scene.physics.world.pause()
    this.player.clearInput()
    this.weapons.stopFiring()
    if (!already) this.bus.emit('app_paused', { reason: reason === 'hidden' ? 'hidden' : 'user' })
  }
  resume(reason: PauseReason): void {
    if (!this.reasons.delete(reason) || this.reasons.size) return
    this.player.clearInput()
    this.weapons.stopFiring()
    this.clock.resume()
    this.scene.physics.world.resume()
    this.bus.emit('app_resumed', {})
  }
  togglePause(): void {
    if (this.reasons.has('hidden')) {
      this.resume('hidden')
      return
    }
    if (this.reasons.has('user')) this.resume('user')
    else this.pause('user')
  }
  equip(id: WeaponId, allowDuringReward = false): boolean {
    if (
      // 抓取期间不换枪：世界冻着，换成大威力武器就能秒脱身 ——
      // 那正是「除了挣脱，其他都不能动」要堵掉的口子
      this.reasons.has('grab') ||
      !this.inventory.includes(id) ||
      (!allowDuringReward && this.rewards.roomId) ||
      !this.player.model.alive
    )
      return false
    const weapon = this.cfg.weapons.find((w) => w.id === id)
    if (!weapon) return false
    this.weapons.stopFiring()
    this.weapon = weapon
    this.player.setWeapon(weapon)
    this.recompute()
    return true
  }
  chooseRandomWeaponId(): WeaponId | null {
    const available = this.cfg.weapons.filter((w) => !this.inventory.includes(w.id))
    return available.length ? available[this.weaponRng.between(0, available.length - 1)]!.id : null
  }
  replaceWeapon(slot: number, id: WeaponId): boolean {
    if (!this.player.model.alive || this.clock.paused || this.clock.frozen) return false
    const plan = planReplacement(
      this.inventory,
      slot,
      id,
      this.cfg.weapons.map((w) => w.id),
    )
    if (!plan) return false
    this.weapons.stopFiring()
    this.inventory[slot] = id
    if (!this.equip(id, true)) {
      this.inventory[slot] = plan.dropped
      return false
    }
    this.bus.emit('weapon_replaced', {
      dropped: plan.dropped,
      equipped: id,
      slot,
      x: this.player.x,
      y: this.player.y,
    })
    return true
  }
  equipSlot(slot: number): boolean {
    return this.equip(this.inventory[slot]!)
  }
  cycleWeapon(): boolean {
    if (this.inventory.length < 2) return false
    const next = (this.inventory.indexOf(this.weapon.id) + 1) % this.inventory.length
    return this.equip(this.inventory[next]!)
  }

  pickupWeapon(id: WeaponId): boolean {
    return this.grantWeapon(id)
  }
  pickupPulse(): boolean {
    return this.grantWeapon('pulse')
  }
  grantRandomWeapon(): WeaponDef | null {
    const available = this.cfg.weapons.filter((w) => !this.inventory.includes(w.id))
    if (this.inventory.length >= 2 || !available.length) return null
    const weapon = available[this.weaponRng.between(0, available.length - 1)]!
    this.grantWeapon(weapon.id)
    return weapon
  }
  private grantWeapon(id: WeaponId): boolean {
    if (!this.player.model.alive || this.inventory.length >= 2 || this.inventory.includes(id))
      return false
    const weapon = this.cfg.weapons.find((w) => w.id === id)
    if (!weapon) return false
    this.inventory.push(id)
    this.equip(id, true)
    return true
  }
  /**
   * 进入一局时应用 D4 永久成长。
   *
   * 这一步发生在第一帧之前；局内核心循环不会再次读取存档。
   * 生命、能量和护盾都以成长后的上限“满状态”开始，随后局内奖励只提高上限，
   * 不会顺手回满。
   */
  applyPermanentRunStats(permanent: PermanentRunStats): void {
    this.permanent = {
      maxHp: Math.max(1, Math.round(permanent.maxHp)),
      maxStamina: Math.max(1, Math.round(permanent.maxStamina)),
      maxShield: Math.max(0, Math.round(permanent.maxShield)),
      attackSpeedPct: Math.max(0, permanent.attackSpeedPct),
      moveSpeedPct: Math.max(0, permanent.moveSpeedPct),
      energyRegenPct: Math.max(0, permanent.energyRegenPct),
    }
    this.stats = deriveStats(
      this.bundle.balance,
      this.cfg,
      this.weapon,
      this.rewardDefs,
      this.rewards.stacks,
      this.permanent,
      this.temporaryAttackSpeedPct,
    )
    this.player.model.applyRunStartStats(
      this.stats.maxHp,
      this.stats.moveSpeed,
      this.stats.iframeMs,
    )
    this.player.applyRunStartStaminaLimit(this.stats.maxStamina)
    this.player.applyEnergyRegenBonus(this.permanent.energyRegenPct)
    this.player.model.applyMaxShield(this.permanent.maxShield)
  }
  configureCharacterSkill(config: CharacterSkillConfig): void {
    this.skill?.destroy()
    this.temporaryAttackSpeedPct = 0
    this.skill = new CharacterSkill(
      {
        scene: this.scene,
        clock: this.clock,
        player: this.player,
        enemies: this.enemies,
        terrain: this.terrain,
        setTemporaryAttackSpeed: (pct) => {
          this.temporaryAttackSpeedPct = pct
          this.recompute()
        },
      },
      config,
    )
  }
  activateSkill(aim: { x: number; y: number }): boolean {
    return this.skill?.activate(aim) ?? false
  }
  clearRoomSkillObjects(): void {
    this.skill?.clearRoom()
  }
  skillStatus(): SkillStatus | null {
    return this.skill?.status() ?? null
  }
  private recompute(): void {
    this.stats = deriveStats(
      this.bundle.balance,
      this.cfg,
      this.weapon,
      this.rewardDefs,
      this.rewards.stacks,
      this.permanent,
      this.temporaryAttackSpeedPct,
    )
    this.player.model.applyStats(this.stats.maxHp, this.stats.moveSpeed, this.stats.iframeMs)
    this.player.applyStaminaLimit(this.stats.maxStamina)
  }
  choose(id: string): boolean {
    if (!this.player.model.alive || !this.reasons.has('reward')) return false
    const roomId = this.rewards.roomId,
      r = this.rewards.choose(id)
    if (!r || roomId === null) return false
    this.recompute()
    this.bus.emit('reward_selected', {
      runId: this.runId,
      roomId,
      rewardId: id,
      stacks: this.rewards.stacks.get(id)!,
    })
    this.resume('reward')
    this.bus.emit('reward_finished', { runId: this.runId, roomId, reason: 'selected' })
    return true
  }
  rewardChanges(r: RewardDef): { label: string; before: string; after: string }[] {
    const next = new Map(this.rewards.stacks)
    next.set(r.id, (next.get(r.id) ?? 0) + 1)
    const after = deriveStats(
      this.bundle.balance,
      this.cfg,
      this.weapon,
      this.rewardDefs,
      next,
      this.permanent,
      this.temporaryAttackSpeedPct,
    )
    const display = (value: number) => Number(value.toFixed(2)).toString()
    const metrics: {
      key: keyof EffectiveStats
      label: string
      format: (value: number) => string
    }[] = [
      { key: 'maxHp', label: '生命上限', format: display },
      { key: 'damage', label: '单颗伤害', format: display },
      { key: 'cooldownMs', label: '每秒攻击次数', format: (v) => display(1000 / v) + ' 次/秒' },
      { key: 'pellets', label: '每次射击弹丸', format: (v) => display(v) + ' 颗' },
      { key: 'maxStamina', label: '能量上限', format: display },
      { key: 'moveSpeed', label: '移动速度', format: (v) => display(v) + ' px/s' },
      { key: 'iframeMs', label: '受击保护', format: (v) => display(v / 1000) + ' 秒' },
      { key: 'bulletSpeed', label: '弹丸速度', format: display },
      { key: 'spreadDeg', label: '散布', format: (v) => display(v) + '°' },
    ]
    return metrics
      .filter((m) => after[m.key] !== this.stats[m.key])
      .map((m) => ({
        label: m.label,
        before: m.format(this.stats[m.key]),
        after: m.format(after[m.key]),
      }))
  }
  rewardDescription(r: RewardDef): string {
    const changes = this.rewardChanges(r).map((c) => c.label + ' ' + c.before + ' → ' + c.after)
    return r.description + '\n' + changes.join('；')
  }
  destroy(): void {
    if (this.disposed) return
    this.disposed = true
    this.skill?.destroy()
    this.skill = null
    this.scene.events.off(Phaser.Scenes.Events.PRE_UPDATE, this.beforePhysics, this)
    this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this)
    this.scene.input.off(Phaser.Input.Events.POINTER_UP, this.onUp, this)
    window.removeEventListener('blur', this.onBlur)
    document.removeEventListener('visibilitychange', this.onVisibility)
    for (const off of this.unsubs) off()
    this.playerCollider.destroy()
    this.stageColliders.destroy()
    for (const collider of this.waterColliders) collider.destroy()
    for (const zone of this.waterZones) zone.destroy()
    this.audio.destroy()
    this.weapons.destroy()
    this.drops.destroy()
    this.feedback.destroy()
    this.enemies.destroy()
    this.player.destroy()
    this.bus.clear()
  }
}
