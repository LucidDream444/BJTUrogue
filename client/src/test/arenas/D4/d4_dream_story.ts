import Phaser from 'phaser'
import { TypedBus, type GameEvents, type RunContext } from '@/core/events'
import type { ArenaConfig, ArenaContext, ArenaDefinition } from '../../ArenaBase'
import { ArenaBase } from '../../ArenaBase'
import { MENU_SCENE_KEY } from '../../arenaCatalog'
import { META_CONFIG_NAME, META_CONFIG_URL, parseMetaConfig } from '@/domains/meta/metaConfig'
import { ProfileStore } from '@/domains/meta/profile/ProfileStore'
import { MemoryProfileStorage } from '@/domains/meta/profile/storage'
import { D4StoryAdapter } from '@/domains/meta/story/D4StoryAdapter'
import { STORY_CONFIG_NAME, STORY_CONFIG_URL, parseStoryConfig } from '@/domains/meta/story/storyConfig'
import { Button } from '@/domains/meta/ui/Button'

const BRANCHES = [['student', '新生'], ['athlete', '大鹅'], ['scholar', '小红果']] as const

/** 只有 D4 与事件桩；不把战斗系统内部带进故事测试。 */
class D4DreamStoryArena extends ArenaBase {
  private adapter: D4StoryAdapter | null = null
  private readonly storyBus = new TypedBus<GameEvents>()
  private profile!: ProfileStore
  private context!: RunContext
  private serial = 0
  private selectedCharacter = 'student'
  private buttons: Button[] = []
  private statusText!: Phaser.GameObjects.Text
  private lastOutcome: 'cleared' | 'dead' | null = null
  private lastAction = '准备播放开场；跳过后可直接选择任一分支。'

  protected get definition(): ArenaDefinition { return arena }
  protected configure(): ArenaConfig { return { spawns: [] } }
  override preload(): void {
    super.preload()
    this.load.json(META_CONFIG_NAME, META_CONFIG_URL)
    this.load.json(STORY_CONFIG_NAME, STORY_CONFIG_URL)
  }

  protected override onArenaCreate(ctx: ArenaContext): void {
    this.resetProfile()
    this.add.rectangle(430, 416, 760, 478, 0x0b1622, 0.97).setDepth(50)
    this.add.text(70, 185, '剧情人工测试 · 内存档（不会读写正式存档）', {
      fontFamily: 'Microsoft YaHei', fontSize: '23px', color: '#ffffff',
    }).setDepth(60)
    this.statusText = this.add.text(70, 225, '', {
      fontFamily: 'Microsoft YaHei', fontSize: '17px', color: '#b5e2ff', lineSpacing: 8,
    }).setDepth(60)
    this.add.text(70, 310, '选角色重播开场（新局，5幕）', { fontSize: '17px', color: '#ffffff' }).setDepth(60)
    BRANCHES.forEach(([id, label], index) => {
      this.addButton(180 + index * 220, 350, label, () => {
        this.selectedCharacter = id
        this.startStory()
      })
    })
    this.add.text(70, 390, '直接预览对应结局（新局，先提交一次模拟胜利，再播3幕）', { fontSize: '17px', color: '#ffffff' }).setDepth(60)
    BRANCHES.forEach(([id, label], index) => {
      this.addButton(180 + index * 220, 430, `${label}结局`, () => {
        this.selectedCharacter = id
        this.startStory('ending')
      })
    })
    this.addButton(180, 490, '本局胜利 / 重复 V', () => this.finish('cleared'))
    this.addButton(400, 490, '本局死亡 / 重复 L', () => this.finish('dead'))
    this.addButton(620, 490, '重复结算请求', () => {
      this.storyBus.emit('settlement_requested', { runId: this.context.runId })
      this.lastAction = '已重复请求结算：不得再次增加币、局数或通关数。'
    })
    this.addButton(180, 550, '重播当前角色开场', () => this.startStory())
    this.addButton(400, 550, '清零内存收益与统计', () => {
      this.adapter?.destroy()
      this.adapter = null
      this.resetProfile()
      this.lastOutcome = null
      this.lastAction = '内存收益已清零；点上方角色开场或结局开始新用例。'
      this.refreshStatus()
    })
    this.addButton(620, 550, '返回测试菜单 Esc', () => this.returnToTestMenu())
    this.add.text(70, 590, '故事：Enter / Space / → 下一张，Esc 跳过；面板按Esc返回测试菜单。\n先跳过初始开场即可看到全部入口；结算返回按钮会重开当前分支。\nV / L 可在结局或结算后重复按核对收益；新分支会建立新runId。', {
      fontFamily: 'Microsoft YaHei', fontSize: '15px', color: '#cccccc', lineSpacing: 6,
    }).setDepth(60)
    this.input.keyboard?.off('keydown-ESC')
    this.input.keyboard?.off('keydown-SPACE')
    this.input.keyboard?.on('keydown-ESC', () => {
      if (!this.adapter?.storyOpen) this.returnToTestMenu()
    })
    this.input.keyboard?.on('keydown-V', () => this.finish('cleared'))
    this.input.keyboard?.on('keydown-L', () => this.finish('dead'))
    const offStory = this.storyBus.on('story_finished', (event) => {
      if (event.kind === 'intro') {
        this.lastAction = '开场已完成：选任一角色结局，或V胜利 / L死亡；也可重新选角色开场。'
        ctx.hud.setNotice('开场完成：下方面板可直接选三角色结局；V胜利 / L死亡')
      }
      else this.storyBus.emit('settlement_requested', { runId: event.runId })
      this.refreshStatus()
    })
    const offResult = this.storyBus.on('run_result_committed', (result) => {
      ctx.hud.setNotice(`本局 ${result.snapshot.outcome} · +${result.coinsEarned}币 · 档案局数${this.profile.profile.stats.runs}`)
      this.refreshStatus()
    })
    const offAction = this.storyBus.on('settlement_action_requested', () => this.startStory())
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offStory(); offResult(); offAction()
      this.adapter?.destroy()
      for (const button of this.buttons) button.destroy()
      this.buttons = []
      this.storyBus.clear()
    })
    this.startStory()
  }

  protected override onArenaUpdate(): void { this.refreshStatus() }

  private addButton(x: number, y: number, label: string, action: () => void): void {
    const button = new Button(this, x, y, label, action, { width: 204, height: 44, fontSize: 16 })
    for (const part of button.parts) (part as Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text).setDepth(60)
    this.buttons.push(button)
  }

  private returnToTestMenu(): void {
    this.adapter?.destroy()
    this.adapter = null
    const url = new URL(window.location.href)
    url.searchParams.delete('arena')
    window.history.replaceState(null, '', url)
    this.scene.start(MENU_SCENE_KEY)
  }

  private resetProfile(): void {
    this.profile = new ProfileStore({ storage: new MemoryProfileStorage() })
    this.profile.load()
  }

  private startStory(kind: 'intro' | 'ending' = 'intro'): void {
    this.adapter?.destroy()
    this.lastOutcome = null
    this.lastAction = kind === 'intro' ? '正在播放5幕开场；完成或跳过后进入测试面板。' : '直接模拟8F胜利：收益先提交一次，结局完成后仅展示结算。'
    this.context = Object.freeze({ runId: `story-whitebox-${++this.serial}`, characterId: this.selectedCharacter, difficulty: 'normal' })
    this.adapter = new D4StoryAdapter({
      scene: this, bus: this.storyBus, store: this.profile,
      meta: parseMetaConfig(this.cache.json.get(META_CONFIG_NAME)),
      story: parseStoryConfig(this.cache.json.get(STORY_CONFIG_NAME)),
    })
    if (kind === 'intro') this.storyBus.emit('story_requested', { ...this.context, requestId: `${this.context.runId}:intro`, kind: 'intro' })
    else this.finish('cleared')
    this.refreshStatus()
  }

  private finish(outcome: 'cleared' | 'dead'): void {
    if (!this.context || (this.adapter?.activeRequest?.kind === 'intro')) return
    if (!this.adapter) {
      this.lastAction = '当前内存收益已清零；先选一项角色开场或结局。'
      return
    }
    const repeated = this.lastOutcome !== null
    this.lastOutcome ??= outcome
    this.lastAction = repeated ? `重复提交${outcome === 'cleared' ? '胜利' : '死亡'}：本局第一份结果及收益应保持不变。` : outcome === 'cleared' ? '模拟心魔胜利：先记账，再播放结局，最后显示结算。' : '模拟死亡：直接显示死亡结算，不播放胜利结局。'
    this.storyBus.emit('run_result_ready', {
      ...this.context, outcome, depth: 8, kills: 10, clearedRooms: 6, elapsedMs: 20000,
      finalRewardId: outcome === 'cleared' ? 'heart_demon' : undefined,
    })
    if (outcome === 'cleared') this.storyBus.emit('story_requested', {
      ...this.context, requestId: `${this.context.runId}:ending`, kind: 'ending',
    })
    else this.storyBus.emit('settlement_requested', { runId: this.context.runId })
    this.refreshStatus()
  }

  private refreshStatus(): void {
    if (!this.statusText || !this.profile) return
    const role = BRANCHES.find(([id]) => id === this.context?.characterId)?.[1] ?? '未开始'
    const phase = this.adapter?.storyOpen ? this.adapter.activeRequest?.kind === 'intro' ? '开场' : '结局'
      : this.adapter?.settlementOpen ? '结算' : this.adapter ? '测试面板 / 可模拟结果' : '收益已清零 / 等待新用例'
    const stats = this.profile.profile.stats
    this.statusText.setText(`当前分支：${role} · 状态：${phase} · ${this.context?.runId ?? '—'}\n内存金币 ${this.profile.profile.currency.coins} · 局数 ${stats.runs} · 通关 ${stats.wins} · 死亡 ${stats.deaths}\n${this.lastAction}`)
  }
}

export const arena: ArenaDefinition = {
  displayName: 'D4 入梦与梦醒',
  description: '三角色开场/结局独立按钮，收益与统计清零，胜利/死亡/重复提交；内存档不碰真实存档。先跳过初始开场即可看到面板。',
  scene: D4DreamStoryArena,
}
