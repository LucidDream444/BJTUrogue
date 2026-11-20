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
    // 直达某位首领：?arena=boss_skills&floor=7 → 奶龙
    const floor = Number(new URLSearchParams(window.location.search).get('floor'))
    if (Number.isInteger(floor) && floor >= 2 && floor <= 9) this.demoFloor = floor
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
      const boss = controls.bossSkills.config.bosses[String(this.demoFloor)]
      status.setText(
        `第 ${this.demoFloor} 层首领：${boss?.name ?? '—'} · ` +
          (this.demoProtected
            ? '无敌已开启 · P 关闭无敌'
            : '可受到伤害 · P 开启无敌') +
          ' · N 下一位 · K 试放技能',
      )
    }
    this.events.on('postupdate', refreshStatus)
    this.events.once('shutdown', () => this.events.off('postupdate', refreshStatus))
    refreshStatus()
    const enter = (): void => {
      const demoLayer = this.demoFloor <= 5 ? 1 : 2
      controls.goToFloor(demoLayer)
      const bossRoom = controls.dungeon.rooms.find((r) => r.room.kind === 'boss')
      // 7F 的平面图暂时没有 boss 房：退到面积最大的一间房，手动把奶龙放进去。
      const room =
        bossRoom ??
        [...controls.dungeon.rooms].sort(
          (a, b) =>
            b.room.rect.width * b.room.rect.height - a.room.rect.width * a.room.rect.height,
        )[0]
      if (!room) return
      // 直接落到房间中心。**不要走 safeSpawn**：它会按「从楼梯间可达」泛洪，
      // 首领房的门在开战前可能还没联通，兜底会把玩家扔回楼梯间（实测 floor=7 就是这样）。
      // 落地后场景的 syncRoomState 会把这一间认成当前房并触发 enterRoom。
      const p = {
        x: room.room.rect.x + room.room.rect.width / 2,
        y: room.room.rect.y + room.room.rect.height / 2,
      }
      // 奶龙体形极大：首领放在房间中偏左，玩家放在右侧同一高度，
      // 让弹幕有横向空间飞出去（上下叠会让中间那堵墙/课桌把弹幕全吃掉）。
      // 切到中轴线左侧：房间正中有一道竖墙/柱子，首领和玩家分居两侧时弹幕会全部撞墙。
      let bossPoint = {
        x: p.x - room.room.rect.width * 0.3,
        y: p.y,
      }
      let playerPoint = {
        x: Math.max(room.room.rect.x + 48, p.x - room.room.rect.width * 0.05),
        y: Math.min(room.room.rect.y + room.room.rect.height - 48, p.y + room.room.rect.height * 0.05),
      }
      // 7F 没有首领房：不要塞进任意教室（课桌/竖墙会把弹幕全吃掉），
      // 在整层里找一块横向净空 ≥ 220px 的通道/空地，首领和玩家一左一右放进去。
      if (!bossRoom) {
        const terrain = controls.session.terrain
        const step = 64
        let found = false
        for (let y = 110; y <= terrain.height - 110 && !found; y += step) {
          for (let x = 110; x <= terrain.width - 330; x += step) {
            if (
              terrain.isWalkable(x, y, 110) &&
              terrain.isWalkable(x + 220, y, 60) &&
              !terrain.crossesSolid({ x, y }, { x: x + 220, y }, 40)
            ) {
              bossPoint = { x, y }
              playerPoint = { x: x + 220, y }
              found = true
              break
            }
          }
        }
      }
      controls.session.player.body.reset(playerPoint.x, playerPoint.y)
      controls.session.player.model.protectedUntilMs = this.demoProtected ? Infinity : 0
      if (!bossRoom) {
        const { cfg, enemies } = controls.session
        const bossIds = ['coursework', 'paper_kite', 'acid_sprinkler', 'sports_gear', 'roll_call', 'banana_cat', 'fat_cat', 'nailong']
        const demoLayer = this.demoFloor <= 5 ? 1 : 2
        const finalBoss = this.demoFloor === 9
        enemies.spawnBoss(
          this.demoFloor,
          demoLayer,
          bossIds[this.demoFloor - 2] ?? 'coursework',
          bossPoint.x,
          bossPoint.y,
          finalBoss
            ? cfg.arena.finale.heartDemonHp
            : cfg.encounter.bossHp + (demoLayer - 1) * cfg.encounter.bossHpPerStage,
          finalBoss,
          cfg.encounter.bossDamageMultiplier,
        )
      }
    }
    this.time.delayedCall(0, enter)
    this.input.keyboard?.on('keydown-N', () => {
      this.demoFloor = this.demoFloor === 9 ? 2 : this.demoFloor + 1
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
      if (controls.floor === 9)
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
  displayName: 'D1 八位首领技能验收（含最终奶龙）',
  description:
    '真实首领房与独立内存存档：默认可受到伤害，N 切换下一位首领，P 切换玩家无敌，K 提前试放技能；Tab 查看本次新首领图鉴。最终奶龙直达：?arena=boss_skills&floor=9。',
  scene: BossSkillsArena,
}
