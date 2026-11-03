import Phaser from 'phaser'
import { BattleScene, type BattleSceneData } from '@/domains/combat/BattleScene'
import type { CombatSession } from '@/domains/combat/CombatSession'
import type { CombatConfig } from '@/domains/combat/config'
import type { DungeonStages } from '@/domains/combat/DungeonStages'
import type { RunFlow } from '@/domains/combat/RunFlow'
import { MENU_SCENE_KEY } from '../../arenaCatalog'

const CHARACTERS = [['student', '新生'], ['athlete', '大鹅'], ['scholar', '小红果']] as const
type TestAction = 'boss' | 'player' | 'boss-player' | 'player-boss'

/**
 * Test-only seam: the product scene has no test hooks or dependency on this file.
 * skillLab is forced during construction to guarantee MemoryProfileStorage. The
 * same adapter/session are then exercised through the normal result and death events.
 */
interface FinaleTestSeam {
  session: CombatSession
  cfg: CombatConfig
  flow: RunFlow | null
  skillLab: boolean
  floor: number
  dungeon: DungeonStages
  roomOrder: number
  settlementAdapter: { readonly settlementOpen: boolean } | null
  store: { readonly profile: { currency: { coins: number }; stats: { runs: number; wins: number; deaths: number } } }
  goToFloor(target: number): void
}

class DreamFinaleArena extends BattleScene {
  private testCharacterId = 'student'
  private testPanel: HTMLDivElement | null = null
  private testStatus: HTMLDivElement | null = null
  private testAction: TestAction | null = null
  private testGodMode = true
  private testMessage = '每次出发直接进入8F最终首领房；胜利或死亡后直接结算。'

  constructor() { super('') }

  override init(data: BattleSceneData = {}): void {
    this.testCharacterId = data.characterId ?? data.skillLabCharacterId ?? this.testCharacterId
    this.testAction = null
    this.testGodMode = true
    super.init({ ...data, characterId: this.testCharacterId, skillLabCharacterId: this.testCharacterId, skillLab: true })
  }

  private get testSeam(): FinaleTestSeam { return this as unknown as FinaleTestSeam }

  override create(): void {
    super.create()
    const seam = this.testSeam
    if (!seam.session || !seam.flow || !seam.settlementAdapter) return
    // super.create() already built an isolated memory profile and a playing flow.
    // Keep its profile backend and runId, then enable normal battle/result behavior.
    seam.skillLab = false
    this.enterFinaleRoom()
    const offSettlement = seam.session.bus.on('settlement_action_requested', (event) => {
      if (event.runId === seam.session.runId && event.action !== 'restart') this.returnToTestMenu()
    })
    this.createTestPanel()
    this.input.keyboard?.on('keydown-B', () => this.queueTestAction('boss'))
    this.input.keyboard?.on('keydown-K', () => this.queueTestAction('player'))
    this.input.keyboard?.on('keydown-T', () => this.queueTestAction('boss-player'))
    this.input.keyboard?.on('keydown-Y', () => this.queueTestAction('player-boss'))
    this.input.keyboard?.on('keydown-G', () => this.toggleTestGodMode())
    this.input.keyboard?.addCapture(['B', 'K', 'T', 'Y', 'G'])
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offSettlement()
      this.testPanel?.remove()
      this.testPanel = null
      this.testStatus = null
    })
  }

  override update(time: number, delta: number): void {
    const seam = this.testSeam
    if (seam.session && seam.flow) {
      if (seam.flow.phase === 'playing') {
        seam.session.player.model.protectedUntilMs = this.testGodMode ? Infinity : seam.session.player.model.protectedUntilMs
        if (!seam.session.clock.paused && !seam.session.clock.frozen) {
          const action = this.testAction
          this.testAction = null
          if (action) this.executeTestAction(action)
        }
      }
    }
    super.update(time, delta)
    this.refreshTestStatus()
  }

  private enterFinaleRoom(): void {
    const seam = this.testSeam
    seam.session.resume('hidden')
    seam.goToFloor(seam.cfg.arena.finale.floor)
    const room = seam.dungeon.rooms.find((unit) => unit.room.kind === 'boss')
    const point = room?.spawnPoints.at(-1)
    if (!point) {
      this.testMessage = '错误：第八层最终首领房没有合法出生点。'
      return
    }
    seam.session.player.body.reset(point.x, point.y)
    seam.roomOrder = -1
    this.testMessage = '已到8F最终首领房；可正常战斗，或B快速胜利结算。T/Y应直接死亡结算。'
  }

  private queueTestAction(action: TestAction): void {
    if (this.testSeam.flow?.phase !== 'playing') {
      this.testMessage = '本局结果已确定；选角色按钮可直接进入8F开始新局。'
      return
    }
    this.testSeam.session.resume('hidden')
    if (this.testSeam.session.clock.paused) {
      this.testMessage = '当前战斗处于暂停；先关闭暂停/奖励面板再触发结果。'
      return
    }
    this.testAction = action
  }

  private executeTestAction(action: TestAction): void {
    const seam = this.testSeam
    const player = seam.session.player.model
    const boss = seam.session.enemies.bossStatus(seam.cfg.arena.finale.floor)
    if (action !== 'player' && !boss) {
      this.testMessage = '心魔尚未生成或已被击败；先等待进入房间，或选角色重开。'
      return
    }
    const killBoss = (): void => {
      if (boss) seam.session.enemies.hit(boss.id, player.id, boss.maxHp, null)
    }
    const killPlayer = (): void => {
      player.protectedUntilMs = 0
      player.takeHit({
        sourceId: boss?.id ?? -1,
        hitKey: `${seam.session.runId}:test-death:${seam.session.clock.frameId}`,
        mode: 'instant', sourceKind: 'aoe', amount: player.maxHp + player.maxShield,
        frameId: seam.session.clock.frameId, nowMs: seam.session.clock.nowMs,
      })
    }
    // Executed immediately before the product update adjudicates this frame.
    // Both orders use normal damage/death callbacks, never assign hp or endRun.
    if (action === 'boss' || action === 'boss-player') killBoss()
    if (action === 'player' || action === 'boss-player' || action === 'player-boss') killPlayer()
    if (action === 'player-boss') killBoss()
    this.testMessage = action === 'boss' ? '已通过正式伤害入口击败最终首领：应直接胜利结算。'
      : action === 'player' ? '已通过正式伤害入口击败玩家：应直接死亡结算。'
        : `同帧${action === 'boss-player' ? '首领→玩家' : '玩家→首领'}死亡：应为dead，直接死亡结算。`
  }

  private toggleTestGodMode(): void {
    this.testGodMode = !this.testGodMode
    if (!this.testGodMode) this.testSeam.session.player.model.protectedUntilMs = 0
    this.testMessage = this.testGodMode ? '测试保护已开启；仅防普通战斗伤害，死亡/同死按钮仍有效。' : '测试保护已关闭，可正常挨打。'
    this.refreshTestStatus()
  }

  private restartTestCharacter(characterId: string): void {
    this.testSeam.session.destroy()
    this.scene.restart({ characterId, difficulty: 'normal', skillLab: true, skillLabCharacterId: characterId })
  }

  private returnToTestMenu(): void {
    this.testSeam.session.destroy()
    const url = new URL(window.location.href)
    url.searchParams.delete('arena')
    window.history.replaceState(null, '', url)
    this.scene.start(MENU_SCENE_KEY)
  }

  private createTestPanel(): void {
    const root = document.createElement('div')
    root.style.cssText = 'position:fixed;right:10px;top:82px;width:300px;padding:12px;border:1px solid #6989a1;border-radius:8px;background:#071421ed;color:#e8f2ff;font:13px/1.5 system-ui;z-index:100;box-sizing:border-box;max-height:calc(100vh - 96px);overflow:auto'
    const title = document.createElement('strong')
    title.textContent = '梦境8F · 正式流程联调'
    root.append(title)
    const note = document.createElement('p')
    note.textContent = '独立内存档；不读写真实存档。角色按钮会新开一局并清零收益，直接进入8F最终首领房。'
    root.append(note)
    this.testStatus = document.createElement('div')
    this.testStatus.style.cssText = 'white-space:pre-wrap;color:#b5e2ff;margin:8px 0'
    root.append(this.testStatus)
    const add = (label: string, action: () => void): void => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = label
      button.style.cssText = 'display:inline-block;margin:3px;padding:6px 8px;cursor:pointer;border:1px solid #6d90af;border-radius:4px;background:#17364d;color:white;font:inherit'
      button.onclick = () => { action(); button.blur() }
      root.append(button)
    }
    for (const [id, name] of CHARACTERS) add(`${name}开新局`, () => this.restartTestCharacter(id))
    add('B 击败首领→胜利结算', () => this.queueTestAction('boss'))
    add('K 玩家死亡', () => this.queueTestAction('player'))
    add('T 同帧首领→玩家死', () => this.queueTestAction('boss-player'))
    add('Y 同帧玩家→首领死', () => this.queueTestAction('player-boss'))
    add('G 切换测试保护', () => this.toggleTestGodMode())
    add('当前角色重新开局 / 清零', () => this.restartTestCharacter(this.testCharacterId))
    add('返回测试菜单', () => this.returnToTestMenu())
    const help = document.createElement('p')
    help.textContent = '战斗：WASD移动、鼠标射击、空格技能。胜利或死亡后直接展示结算；本局收益只提交一次，角色按钮可直接开新局。'
    root.append(help)
    root.addEventListener('keydown', (event) => event.stopPropagation())
    document.body.append(root)
    this.testPanel = root
    this.refreshTestStatus()
  }

  private refreshTestStatus(): void {
    if (!this.testStatus) return
    const seam = this.testSeam
    const profile = seam.store.profile
    const role = CHARACTERS.find(([id]) => id === seam.flow?.context.characterId)?.[1] ?? this.testCharacterId
    const boss = seam.session.enemies.bossStatus(seam.cfg.arena.finale.floor)
    this.testStatus.textContent = `${role} · ${seam.flow?.phase} · ${seam.session.runId}\n楼层 ${seam.floor}/8 · 心魔 ${boss ? Math.ceil(boss.hp) : '未存活'}\n测试保护 ${this.testGodMode ? '开' : '关'} · 金币 ${profile.currency.coins}\n局数 ${profile.stats.runs} / 通关 ${profile.stats.wins} / 死亡 ${profile.stats.deaths}\n${this.testMessage}`
  }
}

export const arena = {
  displayName: '联调 梦境8F：三角色首领战→结算',
  description: '8F首领战与结算联调，内存档隔离；角色按钮直接开新局，B胜利、K死亡、T/Y同帧两种顺序、G测试保护。',
  scene: DreamFinaleArena,
}
