import type Phaser from 'phaser'
import type { ArenaConfig, ArenaContext, ArenaDefinition } from '../../ArenaBase'
import { ArenaBase } from '../../ArenaBase'
import { chargeSolidHitTime } from '@/domains/enemies/charge/ChargeSweep'
import { deflectVortexVelocity, vortexPullVelocity, type VortexSnapshot } from '@/core/vortex'
import { campusButton, campusMenuButton, campusText, clearCampusArenaQuery } from './_campusControls'

const WALL = { x: 650, y: 360, width: 40, height: 270 }
interface ProbeShot { view: Phaser.GameObjects.Arc; x: number; y: number; vx: number; vy: number; bornMs: number }
type AnimalMode = 'mixed' | 'duck' | 'cat' | 'cats' | 'wall' | 'friendly'
const MODES: readonly { id: AnimalMode; key: string; label: string; player: { x: number; y: number }; goal: string }[] = [
  { id: 'duck', key: 'ONE', label: '1 单只番鸭', player: { x: 470, y: 370 }, goal: '蓄力时移动：预警方向应保持不变；冲刺时开枪：仍可受伤。结束后等待完整冷却。' },
  { id: 'cat', key: 'TWO', label: '2 单只黑化猫', player: { x: 1030, y: 400 }, goal: '走入内圈关掉无敌观察周期伤害；外圈观察轻吸。B 发双方探针，K 击杀猫查看正常化退场。' },
  { id: 'cats', key: 'THREE', label: '3 双猫叠场', player: { x: 1080, y: 390 }, goal: '两猫距离接近时会互伤，圆心固定；K 只杀一猫，另一场继续；T 撤场观察范围立即消失。' },
  { id: 'wall', key: 'FOUR', label: '4 墙前后靶', player: { x: 550, y: 370 }, goal: '站着等待：番鸭穿过墙前课本后在墙前停下，墙后课本不掉血。靶子不主动移动或下砸。' },
  { id: 'friendly', key: 'FIVE', label: '5 敌方互伤', player: { x: 1070, y: 420 }, goal: '番鸭沿途命中课本、猫和玩家；猫旋风持续伤害其他敌人。观察单位旁的受伤次数与累计掉血。' },
  { id: 'mixed', key: 'SIX', label: '6 原混合场', player: { x: 470, y: 370 }, goal: '原始左右混合布局，保留 I / B / R 及自动复跑入口。右侧双猫，左侧番鸭与墙前课本。' },
]
const STATE_NAMES: Record<string, string> = {
  spawning: '出生', idle: '待机', patrol: '巡逻', chase: '接近', windup: '蓄力预警',
  dash: '直线冲刺', spin: '原地旋风', recover: '收招', cooldown: '冷却', dead: '死亡',
}

class CampusAnimalsArena extends ArenaBase {
  private mode: AnimalMode = 'mixed'
  private readonly labels = new Map<number, Phaser.GameObjects.Text>()
  private readonly fields = new Map<number, VortexSnapshot>()
  private readonly probes: ProbeShot[] = []
  private readonly damage = new Map<number, { hits: number; total: number }>()
  private readonly targets = new Set<number>()
  private summary!: Phaser.GameObjects.Text
  private modeInfo!: Phaser.GameObjects.Text
  private requests = 0
  protected get definition(): ArenaDefinition { return arena }
  protected configure(): ArenaConfig {
    const wall = WALL
    const preset = MODES.find((mode) => mode.id === this.mode)!
    const spawns: NonNullable<ArenaConfig['spawns']> = this.mode === 'mixed' ? [
      { kind: 'muscovy', gen: 0, count: 1, x: 200, y: 370 },
      { kind: 'tank', gen: 0, count: 1, x: 350, y: 370 },
      { kind: 'nightmare_cat', gen: 0, count: 1, x: 1000, y: 280 },
      { kind: 'nightmare_cat', gen: 0, count: 1, x: 1100, y: 430 },
      { kind: 'tank', gen: 0, count: 1, x: 900, y: 360 },
    ] : this.mode === 'duck' ? [{ kind: 'muscovy', gen: 0, count: 1, x: 200, y: 370 }]
      : this.mode === 'cat' ? [{ kind: 'nightmare_cat', gen: 0, count: 1, x: 870, y: 400 }]
        : this.mode === 'cats' ? [
          { kind: 'nightmare_cat', gen: 0, count: 1, x: 890, y: 370 },
          { kind: 'nightmare_cat', gen: 0, count: 1, x: 970, y: 430 },
        ] : this.mode === 'wall' ? [
          { kind: 'muscovy', gen: 0, count: 1, x: 200, y: 370 },
          { kind: 'tank', gen: 0, count: 1, x: 350, y: 370 },
          { kind: 'tank', gen: 0, count: 1, x: 740, y: 370 },
        ] : [
          { kind: 'muscovy', gen: 0, count: 1, x: 760, y: 420 },
          { kind: 'tank', gen: 0, count: 1, x: 850, y: 420 },
          { kind: 'nightmare_cat', gen: 0, count: 1, x: 950, y: 420 },
        ]
    return {
      playerSpawn: preset.player,
      walls: [wall], collision: { solids: [wall], bulletStoppers: [wall] },
      spawns,
    }
  }
  protected override onArenaCreate(ctx: ArenaContext): void {
    this.fields.clear()
    this.probes.length = 0
    this.labels.clear()
    this.damage.clear()
    this.targets.clear()
    this.requests = 0
    const solids = [{ x: WALL.x - WALL.width / 2, y: WALL.y - WALL.height / 2, width: WALL.width, height: WALL.height }]
    ctx.enemies.setChargeGeometryQuery((x0, y0, x1, y1, radius) => chargeSolidHitTime({ x: x0, y: y0 }, { x: x1, y: y1 }, radius, solids))
    ctx.player.setInvulnerable(true)
    const off = ctx.bus.on('enemy_attack_requested', (request) => {
      if (request.targetId === ctx.player.id && request.targetSpawnSeq === ctx.player.spawnSeq) {
        this.requests++
        ctx.player.takeHit(request)
      }
    })
    const started = ctx.bus.on('enemy_vortex_started', (field) => this.fields.set(field.fieldId, field))
    const ended = ctx.bus.on('enemy_vortex_ended', ({ fieldId }) => this.fields.delete(fieldId))
    const damaged = ctx.bus.on('entity_damaged', (event) => {
      const record = this.damage.get(event.targetId) ?? { hits: 0, total: 0 }
      record.hits++; record.total += event.amount
      this.damage.set(event.targetId, record)
    })
    const spawned = ctx.bus.on('entity_spawned', (event) => {
      if (event.kind !== 'enemy' || (this.mode !== 'wall' && this.mode !== 'friendly')) return
      const entry = ctx.enemies.entryOf(event.id)
      if (entry?.model.enemyKind !== 'tank') return
      this.targets.add(event.id)
      // Stationary test fixtures; actual HP, radius and incoming damage stay configuration-driven.
      entry.model.baseSpeed = 0
      entry.model.slamReadyAtMs = Infinity
    })
    const shoot = (): void => {
      if (this.probes.length >= ctx.bundle.enemies.stage2Boss.projectile.maxActive) return
      const target = ctx.enemies.liveEnemies.find((entry) => entry.model.alive && entry.model.enemyKind === 'nightmare_cat')
      if (!target) return
      const center = target.view.body.center
      const angle = Math.atan2(center.y - ctx.player.y, center.x - ctx.player.x)
      const speed = ctx.bundle.balance.baseline.bullet.speed
      this.probes.push({ view: this.add.circle(ctx.player.x, ctx.player.y, ctx.tune.bulletRadius, 0x83dbff).setDepth(500), x: ctx.player.x, y: ctx.player.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, bornMs: ctx.clock.nowMs })
      ctx.enemies.radialShots.emit(target.model.id, center.x, center.y, ctx.clock.nowMs, ctx.bundle.enemies.stage2Boss.projectile.damage)
    }
    this.input.keyboard?.on('keydown-B', shoot)
    const handlers: { event: string; callback: () => void }[] = []
    const bind = (key: string, callback: () => void): void => {
      const event = `keydown-${key}`
      this.input.keyboard?.on(event, callback)
      handlers.push({ event, callback })
    }
    campusMenuButton(this)
    bind('ESC', clearCampusArenaQuery)
    MODES.forEach((mode, index) => {
      const select = (): void => { this.mode = mode.id; this.scene.restart() }
      campusButton(this, 782 + index % 3 * 162, 65 + Math.floor(index / 3) * 37, 155, mode.label, select)
      bind(mode.key, select)
    })
    const killCat = (): void => {
      const cat = ctx.enemies.liveEnemies.find((entry) => entry.model.alive && entry.model.enemyKind === 'nightmare_cat')
      if (cat) ctx.enemies.weaponHit(cat.model.id, -22, cat.model.maxHp, null)
    }
    const hitAnimal = (): void => {
      const animal = ctx.enemies.liveEnemies.find((entry) => entry.model.alive && (entry.model.enemyKind === 'muscovy' || entry.model.enemyKind === 'nightmare_cat'))
      if (animal) ctx.enemies.weaponHit(animal.model.id, -23, ctx.tune.bulletDamage, null)
    }
    const resetPlayer = (): void => {
      ctx.player.revive()
      const point = MODES.find((mode) => mode.id === this.mode)!.player
      ctx.player.gameObject.body!.reset(point.x, point.y)
    }
    campusButton(this, 782, 143, 115, 'B 双方偏弹', shoot)
    campusButton(this, 904, 143, 115, 'H 打一枪', hitAnimal)
    campusButton(this, 1026, 143, 115, 'K 击杀一猫', killCat)
    campusButton(this, 1148, 143, 115, 'T 撤去旋风', () => ctx.enemies.clearVortices())
    campusButton(this, 782, 181, 155, 'I 切换无敌', () => ctx.player.setInvulnerable(!ctx.player.isInvulnerable))
    campusButton(this, 944, 181, 155, 'F 满血回站位', resetPlayer)
    campusButton(this, 1106, 181, 157, 'R 重开当前组', () => this.scene.restart())
    bind('H', hitAnimal); bind('K', killCat); bind('T', () => ctx.enemies.clearVortices()); bind('F', resetPlayer)
    this.summary = campusText(this, 782, 220, '', 470)
    this.modeInfo = campusText(this, 18, 230, `${MODES.find((mode) => mode.id === this.mode)!.label}：${MODES.find((mode) => mode.id === this.mode)!.goal}`, 710)
    ctx.hud.setNotice('点右上按钮或按1—6换组；默认无敌开启')
    this.add.text(607, 510, '实体墙\nx=630起', { fontSize: '13px', color: '#cbd5df' })
    this.events.once('shutdown', () => {
      off(); started(); ended(); damaged(); spawned()
      this.input.keyboard?.off('keydown-B', shoot)
      for (const handler of handlers) this.input.keyboard?.off(handler.event, handler.callback)
    })
  }
  protected override onArenaUpdate(_dtMs: number, ctx: ArenaContext): void {
    if (!ctx.clock.paused && !ctx.clock.frozen) {
      const fields = [...this.fields.values()]
      const body = ctx.player.gameObject.body as Phaser.Physics.Arcade.Body
      const pull = vortexPullVelocity(body.center, fields)
      body.velocity.x += pull.x
      body.velocity.y += pull.y
      for (let index = this.probes.length - 1; index >= 0; index--) {
        const shot = this.probes[index]!
        const velocity = deflectVortexVelocity(shot, { x: shot.vx, y: shot.vy }, fields, _dtMs / 1000)
        shot.vx = velocity.x; shot.vy = velocity.y
        const to = { x: shot.x + shot.vx * _dtMs / 1000, y: shot.y + shot.vy * _dtMs / 1000 }
        const wall = chargeSolidHitTime(shot, to, ctx.tune.bulletRadius, [{ x: WALL.x - WALL.width / 2, y: WALL.y - WALL.height / 2, width: WALL.width, height: WALL.height }])
        if (wall !== null || ctx.clock.nowMs - shot.bornMs >= ctx.bundle.enemies.stage2Boss.projectile.lifetimeMs) {
          shot.view.destroy(); this.probes.splice(index, 1)
        } else { shot.x = to.x; shot.y = to.y; shot.view.setPosition(shot.x, shot.y) }
      }
    }
    const active = new Set<number>()
    for (const { model, view } of ctx.enemies.liveEnemies) {
      if (!model.alive) continue
      active.add(model.id)
      let label = this.labels.get(model.id)
      if (!label) {
        label = this.add.text(0, 0, '', { fontSize: '12px', color: '#ffffff', backgroundColor: '#101727' }).setDepth(5000)
        this.labels.set(model.id, label)
      }
      const record = this.damage.get(model.id)
      const age = model.stateAgeMs(ctx.clock.nowMs)
      const duration = model.enemyKind === 'muscovy' ? ctx.bundle.enemies.enemies.muscovy.charge
        : model.enemyKind === 'nightmare_cat' ? ctx.bundle.enemies.enemies.nightmare_cat.vortex : null
      const phaseMs = model.state === 'windup' ? Math.max(0, (duration?.windupMs ?? 0) - age)
        : model.state === 'spin' ? Math.max(0, ctx.bundle.enemies.enemies.nightmare_cat.vortex.durationMs - age)
          : model.state === 'recover' ? Math.max(0, (duration?.recoverMs ?? 0) - age) : null
      const name = model.enemyKind === 'muscovy' ? '番鸭' : model.enemyKind === 'nightmare_cat' ? '黑化猫' : this.targets.has(model.id) ? view.x < WALL.x ? '墙前靶' : '墙后/互伤靶' : '课本'
      label.setPosition(view.x - 46, view.y - 72).setText(`#${model.id} ${name}  HP ${Math.ceil(model.hp)}/${model.maxHp}\n${STATE_NAMES[model.state] ?? model.state}${phaseMs === null ? '' : ` ${(phaseMs / 1000).toFixed(1)}s`} · 冷却 ${(Math.max(0, model.attackReadyAtMs - ctx.clock.nowMs) / 1000).toFixed(1)}s\n受伤 ${record?.hits ?? 0}次 / ${Math.round(record?.total ?? 0)}点`)
    }
    for (const [id, label] of this.labels) if (!active.has(id)) { label.destroy(); this.labels.delete(id) }
    const hurt = [...this.damage.values()].reduce((total, item) => total + item.total, 0)
    this.summary.setText(`当前：${MODES.find((mode) => mode.id === this.mode)!.label} | 玩家${ctx.player.isInvulnerable ? '无敌 ON' : '可受伤'}\n旋风 ${this.fields.size} 个 · C1请求 ${this.requests} 次 · 敌方掉血 ${Math.round(hurt)}点`)
    this.modeInfo.setAlpha(ctx.clock.paused ? 0.65 : 1)
  }
}
export const arena: ArenaDefinition = {
  displayName: '番鸭与黑化猫白箱',
  description: '1番鸭 / 2单猫 / 3双猫 / 4墙前后靶 / 5互伤 / 6原混合；支持右上按钮。',
  scene: CampusAnimalsArena,
}
