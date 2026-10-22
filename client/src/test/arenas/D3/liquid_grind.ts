import Phaser from 'phaser'
import {
  ArenaBase,
  type ArenaConfig,
  type ArenaContext,
  type ArenaDefinition,
} from '../../ArenaBase'

class LiquidGrindArena extends ArenaBase {
  protected get definition(): ArenaDefinition {
    return arena
  }
  protected configure(): ArenaConfig {
    return {
      playerSpawn: { x: 440, y: 420 },
      spawns: [
        { kind: 'sprayer', gen: 0, count: 1, x: 720, y: 420 },
        { kind: 'tank', gen: 0, count: 1, x: 980, y: 420 },
      ],
    }
  }

  private readout!: Phaser.GameObjects.Text
  private drainTotal = 0
  private ramHits = 0

  protected override onArenaCreate(ctx: ArenaContext): void {
    ctx.hud.setNotice(
      '催化液：踩过即消失 · 加速撞怪 · 移动耗血 · 静止累计三秒清除 · P 脚下喷液 · G 重新摆场',
    )
    this.readout = this.add
      .text(24, 135, '', {
        fontFamily: 'Microsoft YaHei, sans-serif',
        fontSize: '15px',
        color: '#e3f7d7',
        backgroundColor: '#18252f',
        padding: { x: 10, y: 8 },
      })
      .setScrollFactor(0)
      .setDepth(5000)
    const off = [
      ctx.bus.on('player_liquid_changed', (e) => {
        if (e.playerId === ctx.player.id) ctx.player.setMovementMultiplier(e.speedMultiplier)
      }),
      ctx.bus.on('player_liquid_drain', (e) => {
        if (e.playerId !== ctx.player.id) return
        const hit = ctx.player.takeHit({
          ...e,
          mode: 'tick',
          sourceKind: 'aoe',
          hitKey: `liquid-drain:${e.frameId}`,
        })
        this.drainTotal += hit.applied
      }),
      ctx.bus.on('entity_damaged', (e) => {
        if (e.targetKind === 'enemy' && e.sourceKind === 'contact' && e.amount > 0) this.ramHits++
      }),
    ]
    const puddle = (x = ctx.player.x, y = ctx.player.y) =>
      ctx.enemies.liquid.spray(-30, x, y, ctx.clock.nowMs, () => true)
    const reset = () => {
      ctx.enemies.killAll()
      ctx.enemies.spawns.clear()
      ctx.enemies.clearLiquid()
      ctx.player.revive()
      ctx.player.gameObject.body?.reset(440, 420)
      ctx.enemies.requestSpawn('sprayer', 0, 720, 420, 'debug')
      ctx.enemies.requestSpawn('tank', 0, 980, 420, 'debug')
      this.drainTotal = this.ramHits = 0
    }
    this.input.keyboard?.on('keydown-P', () => puddle())
    this.input.keyboard?.on('keydown-G', reset)
    const debug = {
      ctx,
      puddle,
      reset,
      snapshot: () => ({
        frame: ctx.clock.frameId,
        paused: ctx.clock.paused,
        now: ctx.clock.nowMs,
        hp: ctx.player.hp,
        x: ctx.player.x,
        y: ctx.player.y,
        coated: ctx.enemies.liquid.active,
        moving: ctx.enemies.liquid.moving,
        stillMs: ctx.enemies.liquid.stillMs,
        drained: this.drainTotal,
        ramHits: this.ramHits,
        puddles: ctx.enemies.liquid.puddles
          .filter((p) => p.active)
          .map((p) => ({ x: p.x, y: p.y })),
        enemies: ctx.enemies.liveEnemies.map((e) => ({
          id: e.model.id,
          kind: e.model.enemyKind,
          x: e.view.x,
          y: e.view.y,
          hp: e.model.hp,
          state: e.model.state,
        })),
      }),
    }
    const w = window as unknown as { __liquidArena?: typeof debug }
    w.__liquidArena = debug
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const unsubscribe of off) unsubscribe()
      if (w.__liquidArena === debug) delete w.__liquidArena
    })
  }

  protected override onArenaUpdate(_dt: number, ctx: ArenaContext): void {
    const field = ctx.enemies.liquid
    this.readout.setText([
      `催化喷洒怪 · 前摇 ${field.cfg.spray.windupMs / 1000} 秒后落液`,
      `液滩 ${field.puddles.filter((p) => p.active).length} / ${field.cfg.spray.maxPuddles}  ·  玩家 ${Math.ceil(ctx.player.hp)} / ${ctx.player.maxHp}`,
      `状态 ${field.active ? '沾液' : '干净'}  ·  累计静止 ${(field.stillMs / 1000).toFixed(2)} 秒`,
      `累计移动耗血 ${this.drainTotal}  ·  实际冲撞命中 ${this.ramHits}`,
      'WASD 移动 · 左键射击 · P 脚下喷液 · G 重摆 · SPACE 暂停 · R 重启',
    ])
  }
}

export const arena: ArenaDefinition = {
  displayName: '催化喷洒怪 · 沾液与冲撞',
  description: '躲落液预警，或踩液加速撞怪；移动耗血，静止累计三秒清除。P 立即体验，G 重摆。',
  scene: LiquidGrindArena,
}
