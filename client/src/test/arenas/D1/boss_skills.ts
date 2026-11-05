import { BattleScene, type BattleSceneData } from '@/domains/combat/BattleScene'
import type { CombatSession } from '@/domains/combat/CombatSession'
import type { DungeonStages } from '@/domains/combat/DungeonStages'
import type { BossEncounterController } from '@/domains/combat/BossEncounterController'

interface DemoControls {
  session: CombatSession
  dungeon: DungeonStages
  bossSkills: BossEncounterController
  goToFloor(floor: number, elevator?: string | null, anomaly?: boolean): void
  floor: number
}
/** An isolated memory-save battle demo. N cycles seven actual boss rooms. */
class BossSkillsArena extends BattleScene {
  private demoFloor = 2
  private demoProtected = false
  constructor() {
    super('')
  }
  override init(data: BattleSceneData = {}): void {
    super.init({ ...data, skillLab: true })
  }
  override create(): void {
    super.create()
    const controls = this as unknown as DemoControls
    const status = this.add.text(0, 0, '', {
      fontSize: '16px',
      color: '#fff4d8',
      backgroundColor: '#241831',
      padding: { x: 12, y: 6 },
    }).setOrigin(0.5, 0).setDepth(15000)
    const refreshStatus = (): void => {
      const camera = this.cameras.main
      const top = camera.getWorldPoint(this.scale.width / 2, 112)
      status.setPosition(top.x, top.y).setScale(1 / camera.zoom)
      status.setText(this.demoProtected
        ? '首领验收：无敌已开启 · P 关闭无敌 · N 下一位'
        : '首领验收：可受到伤害 · P 开启无敌 · N 下一位')
    }
    this.events.on('postupdate', refreshStatus)
    this.events.once('shutdown', () => this.events.off('postupdate', refreshStatus))
    refreshStatus()
    const enter = (): void => {
      controls.goToFloor(this.demoFloor, null, this.demoFloor === 8)
      const room = controls.dungeon.rooms.find((r) => r.room.kind === 'boss')
      if (!room) return
      const p = controls.session.terrain.safeSpawn(
        room.room.rect.x,
        room.room.rect.y + room.room.rect.height / 4,
        controls.session.player.model.stats.radius,
      )
      controls.session.player.body.reset(p.x, p.y)
      controls.session.player.model.protectedUntilMs = this.demoProtected ? Infinity : 0
    }
    this.time.delayedCall(0, enter)
    this.input.keyboard?.on('keydown-N', () => {
      this.demoFloor = this.demoFloor === 8 ? 2 : this.demoFloor + 1
      enter()
    })
    this.input.keyboard?.on('keydown-P', () => {
      this.demoProtected = !this.demoProtected
      controls.session.player.model.protectedUntilMs = this.demoProtected ? Infinity : 0
      refreshStatus()
    })
    this.input.keyboard?.on('keydown-K', () => {
      const boss = controls.session.enemies.skills
        .skillUnits()
        .find((u) => u.bossStage === controls.floor)
      if (!boss || controls.session.clock.paused) return
      const skills = controls.bossSkills.config.bosses[String(controls.floor)]!.skills
      const selected = skills[Math.floor(controls.session.clock.nowMs / 1000) % skills.length]!
      if (controls.floor === 8)
        controls.bossSkills.heart.castSkill(selected.id, controls.session.clock.nowMs, boss.id)
      else
        controls.bossSkills.runtime.castSkill(
          boss.id,
          controls.floor,
          selected.id,
          controls.session.clock.nowMs,
        )
    })
  }
}
export const arena = {
  displayName: 'D1 七位首领技能验收',
  description:
    '真实首领房与独立内存存档：默认可受到伤害，N 切换下一位首领，P 切换玩家无敌，K 提前试放技能；Tab 查看本次新首领图鉴。',
  scene: BossSkillsArena,
}
