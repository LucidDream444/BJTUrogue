import type Phaser from 'phaser'
import type { ArenaConfig, ArenaContext, ArenaDefinition } from '../../ArenaBase'
import { ArenaBase } from '../../ArenaBase'
import { chargeSolidHitTime } from '@/domains/enemies/charge/ChargeSweep'
import { deflectVortexVelocity, vortexPullVelocity, type VortexSnapshot } from '@/core/vortex'

const WALL = { x: 650, y: 360, width: 40, height: 270 }
interface ProbeShot { view: Phaser.GameObjects.Arc; x: number; y: number; vx: number; vy: number; bornMs: number }

class CampusAnimalsArena extends ArenaBase {
  private readonly labels = new Map<number, Phaser.GameObjects.Text>()
  private readonly fields = new Map<number, VortexSnapshot>()
  private readonly probes: ProbeShot[] = []
  protected get definition(): ArenaDefinition { return arena }
  protected configure(): ArenaConfig {
    const wall = WALL
    return {
      playerSpawn: { x: 470, y: 370 },
      walls: [wall], collision: { solids: [wall], bulletStoppers: [wall] },
      spawns: [
        { kind: 'muscovy', gen: 0, count: 1, x: 200, y: 370 },
        { kind: 'tank', gen: 0, count: 1, x: 350, y: 370 },
        { kind: 'nightmare_cat', gen: 0, count: 1, x: 1000, y: 280 },
        { kind: 'nightmare_cat', gen: 0, count: 1, x: 1100, y: 430 },
        { kind: 'tank', gen: 0, count: 1, x: 900, y: 360 },
      ],
    }
  }
  protected override onArenaCreate(ctx: ArenaContext): void {
    this.fields.clear()
    this.probes.length = 0
    const solids = [{ x: WALL.x - WALL.width / 2, y: WALL.y - WALL.height / 2, width: WALL.width, height: WALL.height }]
    ctx.enemies.setChargeGeometryQuery((x0, y0, x1, y1, radius) => chargeSolidHitTime({ x: x0, y: y0 }, { x: x1, y: y1 }, radius, solids))
    ctx.player.setInvulnerable(true)
    const off = ctx.bus.on('enemy_attack_requested', (request) => {
      if (request.targetId === ctx.player.id && request.targetSpawnSeq === ctx.player.spawnSeq) ctx.player.takeHit(request)
    })
    const started = ctx.bus.on('enemy_vortex_started', (field) => this.fields.set(field.fieldId, field))
    const ended = ctx.bus.on('enemy_vortex_ended', ({ fieldId }) => this.fields.delete(fieldId))
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
    this.events.once('shutdown', () => { off(); started(); ended(); this.input.keyboard?.off('keydown-B', shoot) })
    ctx.hud.setNotice('I切换无敌；左侧番鸭穿课本/墙前停止；右侧双猫互伤/轻吸。B同时发蓝色假玩家弹与真实敌弹看偏轨；R重置。')
    this.add.text(160, 220, '固定线预警 → 展翅冲刺 → 完整冷却', { fontSize: '15px', color: '#ffe1ba' })
    this.add.text(820, 160, '双旋风：固定圆心 / 互伤 / 轻吸 / 独立撤场', { fontSize: '15px', color: '#d3bfff' })
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
      label.setPosition(view.x - 40, view.y - 48).setText(`#${model.id} ${model.enemyKind}\n${model.state} · ${Math.ceil(Math.max(0, model.attackReadyAtMs - ctx.clock.nowMs))}ms`)
    }
    for (const [id, label] of this.labels) if (!active.has(id)) { label.destroy(); this.labels.delete(id) }
  }
}
export const arena: ArenaDefinition = {
  displayName: '番鸭与黑化猫白箱',
  description: '固定直线冲刺、墙前截断、沿途互伤；双猫固定旋风、范围与倒计时。真实玩家吸引/双方偏弹见产品联调。',
  scene: CampusAnimalsArena,
}
