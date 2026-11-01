import Phaser from 'phaser'
import { TypedBus, type GameEvents, type RunContext } from '@/core/events'
import type { ArenaConfig, ArenaContext, ArenaDefinition } from '../../ArenaBase'
import { ArenaBase } from '../../ArenaBase'
import { META_CONFIG_NAME, META_CONFIG_URL, parseMetaConfig } from '@/domains/meta/metaConfig'
import { ProfileStore } from '@/domains/meta/profile/ProfileStore'
import { MemoryProfileStorage } from '@/domains/meta/profile/storage'
import { D4StoryAdapter } from '@/domains/meta/story/D4StoryAdapter'
import { STORY_CONFIG_NAME, STORY_CONFIG_URL, parseStoryConfig } from '@/domains/meta/story/storyConfig'
import { Button } from '@/domains/meta/ui/Button'

/** 只有 D4 与事件桩；不把战斗系统内部带进故事测试。 */
class D4DreamStoryArena extends ArenaBase {
  private adapter: D4StoryAdapter | null = null
  private readonly storyBus = new TypedBus<GameEvents>()
  private profile!: ProfileStore
  private context!: RunContext
  private serial = 0
  private selectedCharacter = 'student'
  private buttons: Button[] = []

  protected get definition(): ArenaDefinition { return arena }
  protected configure(): ArenaConfig { return { spawns: [] } }
  override preload(): void {
    super.preload()
    this.load.json(META_CONFIG_NAME, META_CONFIG_URL)
    this.load.json(STORY_CONFIG_NAME, STORY_CONFIG_URL)
  }

  protected override onArenaCreate(ctx: ArenaContext): void {
    this.profile = new ProfileStore({ storage: new MemoryProfileStorage() })
    this.profile.load()
    this.add.text(70, 150, '故事流程事件桩（内存存档）\n选角色 → 开场 → 模拟8F胜利 → 结局 → 结算\nV胜利 / L死亡；结局期间重复V不重复发币。', {
      fontFamily: 'Microsoft YaHei', fontSize: '20px', color: '#ffffff', lineSpacing: 12,
    })
    const choices = [ ['student', '新生'], ['athlete', '大鹅'], ['scholar', '小红果'] ] as const
    choices.forEach(([id, label], index) => {
      this.buttons.push(new Button(this, 180 + index * 220, 300, label, () => {
        this.selectedCharacter = id
        this.startStory()
      }))
    })
    this.buttons.push(new Button(this, 180, 370, '重播本局开场', () => this.startStory()))
    this.buttons.push(new Button(this, 400, 370, '模拟胜利 V', () => this.finish('cleared')))
    this.buttons.push(new Button(this, 620, 370, '模拟死亡 L', () => this.finish('dead')))
    this.input.keyboard?.off('keydown-ESC')
    this.input.keyboard?.off('keydown-SPACE')
    this.input.keyboard?.on('keydown-V', () => this.finish('cleared'))
    this.input.keyboard?.on('keydown-L', () => this.finish('dead'))
    const offStory = this.storyBus.on('story_finished', (event) => {
      if (event.kind === 'intro') ctx.hud.setNotice('开场完成：V=8F心魔胜利，L=死亡；结算金币只提交一次')
      else this.storyBus.emit('settlement_requested', { runId: event.runId })
    })
    const offResult = this.storyBus.on('run_result_committed', (result) => {
      ctx.hud.setNotice(`本局 ${result.snapshot.outcome} · +${result.coinsEarned}币 · 档案局数${this.profile.profile.stats.runs}`)
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

  private startStory(): void {
    this.adapter?.destroy()
    this.context = Object.freeze({ runId: `story-whitebox-${++this.serial}`, characterId: this.selectedCharacter, difficulty: 'normal' })
    this.adapter = new D4StoryAdapter({
      scene: this, bus: this.storyBus, store: this.profile,
      meta: parseMetaConfig(this.cache.json.get(META_CONFIG_NAME)),
      story: parseStoryConfig(this.cache.json.get(STORY_CONFIG_NAME)),
    })
    this.storyBus.emit('story_requested', { ...this.context, requestId: `${this.context.runId}:intro`, kind: 'intro' })
  }

  private finish(outcome: 'cleared' | 'dead'): void {
    if (!this.context || (this.adapter?.activeRequest?.kind === 'intro')) return
    this.storyBus.emit('run_result_ready', {
      ...this.context, outcome, depth: 8, kills: 10, clearedRooms: 6, elapsedMs: 20000,
      finalRewardId: outcome === 'cleared' ? 'heart_demon' : undefined,
    })
    if (outcome === 'cleared') this.storyBus.emit('story_requested', {
      ...this.context, requestId: `${this.context.runId}:ending`, kind: 'ending',
    })
    else this.storyBus.emit('settlement_requested', { runId: this.context.runId })
  }
}

export const arena: ArenaDefinition = {
  displayName: 'D4 入梦与梦醒',
  description: '事件桩验三角色5幕开场/3幕结局，下一张、跳过、后台停表和重复胜利只记账一次；图片未到位仍可跳过。',
  scene: D4DreamStoryArena,
}
