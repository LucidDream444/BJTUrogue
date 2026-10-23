import type { ArenaConfig, ArenaContext, ArenaDefinition } from '../../ArenaBase'
import { ArenaBase } from '../../ArenaBase'

/** Visual regression arena: normal enemies, all boss identities, and paper split timing. */
class CampusArtArena extends ArenaBase {
  protected get definition(): ArenaDefinition {
    return arena
  }

  protected configure(): ArenaConfig {
    return {
      playerSpawn: { x: 640, y: 340 },
      spawns: [
        { kind: 'splitter', gen: 0, count: 1, x: 240, y: 250 },
        { kind: 'splitter', gen: 1, count: 1, x: 390, y: 250 },
        { kind: 'splitter', gen: 2, count: 1, x: 520, y: 250 },
        { kind: 'tank', gen: 0, count: 1, x: 1000, y: 270 },
      ],
    }
  }

  protected override onArenaCreate(ctx: ArenaContext): void {
    ctx.player.setInvulnerable(true)
    const maxHp = ctx.enemies.specFor('tank', 0).stats.maxHp
    ctx.enemies.requestBoss(1, 240, 560, maxHp)
    ctx.enemies.requestBoss(2, 640, 560, maxHp)
    ctx.enemies.requestBoss(3, 1040, 560, maxHp, true)
    ctx.hud.setNotice('P：击杀当前纸团观察展开分裂；R：重置。首领：白 / 蓝 / 紫。')
    this.add.text(195, 190, '纸团：三代逐次缩小', { color: '#f6f0d9', fontSize: '16px' })
    this.add.text(945, 190, '厚课本《计组》', { color: '#a9d6d4', fontSize: '16px' })
    this.add.text(180, 665, '蘑菇首领 · 白', { color: '#ffffff', fontSize: '16px' })
    this.add.text(580, 665, '霜翼领主 · 蓝', { color: '#4da6ff', fontSize: '16px' })
    this.add.text(980, 665, '蜘蛛女皇 · 紫', { color: '#a855f7', fontSize: '16px' })
    const killPaper = () => {
      for (const { model } of ctx.enemies.liveEnemies) {
        if (model.alive && model.enemyKind === 'splitter') {
          ctx.enemies.weaponHit(model.id, -1, model.maxHp, null)
        }
      }
    }
    this.input.keyboard?.on('keydown-P', killPaper)
    this.events.once('shutdown', () => this.input.keyboard?.off('keydown-P', killPaper))
  }
}

export const arena: ArenaDefinition = {
  displayName: '校园敌人美术与占位',
  description: '纸团展开分裂、厚课本跳跃、三个首领的白蓝紫占位；P 击杀纸团，R 重置。',
  scene: CampusArtArena,
}
