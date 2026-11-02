import type Phaser from 'phaser'
import type { ArenaConfig, ArenaContext, ArenaDefinition } from '../../ArenaBase'
import { ArenaBase } from '../../ArenaBase'
import { ANIMS, BOSS_FIRST_ART, FINAL_BOSS_ART, MUSCOVY_ART, NIGHTMARE_CAT_ART, STAGE2_BOSS_ART } from '@/core/assetManifest'
import { textureKeyFor } from '@/core/assets'
import { campusButton, campusMenuButton, campusText, clearCampusArenaQuery } from './_campusControls'

type Subject = 'overview' | 'muscovy' | 'cat' | 'first' | 'second' | 'final'
type Action = 'idle' | 'walk' | 'windup' | 'attack' | 'recover' | 'hit' | 'death'
interface Clip { texture: string; frames: readonly number[]; frameRate: number; loop: boolean }
const SUBJECTS: readonly { id: Subject; key: string; label: string }[] = [
  { id: 'muscovy', key: 'ONE', label: '1 番鸭动画' },
  { id: 'cat', key: 'TWO', label: '2 黑化猫动画' },
  { id: 'first', key: 'THREE', label: '3 菌菇首领' },
  { id: 'second', key: 'FOUR', label: '4 霜翼使徒' },
  { id: 'final', key: 'FIVE', label: '5 最终心魔' },
  { id: 'overview', key: 'SIX', label: '6 原实战总览' },
]
const ACTIONS: readonly { id: Action; label: string }[] = [
  { id: 'idle', label: '待机' }, { id: 'walk', label: '移动' }, { id: 'windup', label: '蓄力' },
  { id: 'attack', label: '攻击' }, { id: 'recover', label: '收招' }, { id: 'hit', label: '受击' }, { id: 'death', label: '退场' },
]
const DIRECTIONS = ['right', 'down', 'left', 'up'] as const

/** Real combat overview plus bodyless frame previews; neither mode changes product logic. */
class CampusArtArena extends ArenaBase {
  private subject: Subject = 'overview'
  private action: Action = 'idle'
  private direction = 0
  private playing = true
  private elapsedMs = 0
  private frameIndex = 0
  private preview: Phaser.GameObjects.Sprite | null = null
  private effect: Phaser.GameObjects.Sprite | null = null
  private details!: Phaser.GameObjects.Text
  private playback!: Phaser.GameObjects.Text

  protected get definition(): ArenaDefinition { return arena }

  protected configure(): ArenaConfig {
    return {
      playerSpawn: { x: 640, y: 340 },
      spawns: this.subject === 'overview' ? [
        { kind: 'splitter', gen: 0, count: 1, x: 240, y: 250 },
        { kind: 'splitter', gen: 1, count: 1, x: 390, y: 250 },
        { kind: 'splitter', gen: 2, count: 1, x: 520, y: 250 },
        { kind: 'muscovy', gen: 0, count: 1, x: 690, y: 290 },
        { kind: 'nightmare_cat', gen: 0, count: 1, x: 830, y: 290 },
        { kind: 'tank', gen: 0, count: 1, x: 1000, y: 270 },
      ] : [],
    }
  }

  protected override onArenaCreate(ctx: ArenaContext): void {
    this.preview = null
    this.effect = null
    this.elapsedMs = 0
    this.frameIndex = 0
    this.playing = true
    ctx.player.setInvulnerable(true)
    const handlers: { event: string; callback: () => void }[] = []
    const bind = (key: string, callback: () => void): void => {
      const event = `keydown-${key}`
      this.input.keyboard?.on(event, callback)
      handlers.push({ event, callback })
    }
    campusMenuButton(this)
    bind('ESC', clearCampusArenaQuery)
    SUBJECTS.forEach((subject, index) => {
      const select = (): void => { this.subject = subject.id; this.action = 'idle'; this.scene.restart() }
      campusButton(this, 782 + index % 3 * 162, 65 + Math.floor(index / 3) * 37, 155, subject.label, select)
      bind(subject.key, select)
    })
    const killPaper = (): void => {
      for (const { model } of ctx.enemies.liveEnemies)
        if (model.alive && model.enemyKind === 'splitter') ctx.enemies.weaponHit(model.id, -1, model.maxHp, null)
    }
    bind('P', killPaper)
    if (this.subject === 'overview') {
      const maxHp = ctx.enemies.specFor('tank', 0).stats.maxHp
      ctx.enemies.requestBoss(1, 240, 560, maxHp)
      ctx.enemies.requestBoss(2, 640, 560, maxHp)
      ctx.enemies.requestBoss(3, 1040, 560, maxHp, true)
      campusButton(this, 782, 143, 236, 'P 击杀纸团看分裂', killPaper)
      campusButton(this, 1026, 143, 237, 'R 重开实战总览', () => this.scene.restart())
      campusText(this, 782, 185, '总览使用真实AI与伤害。点1—5单独预览动作，支持暂停、逐帧、重播。', 467)
      this.add.text(195, 200, '纸团：三代逐次缩小', { color: '#f6f0d9', fontSize: '16px' })
      this.add.text(684, 240, '番鸭 / 黑化猫', { color: '#f6f0d9', fontSize: '16px' })
      this.add.text(945, 245, '厚课本《计组》', { color: '#a9d6d4', fontSize: '16px' })
      this.add.text(180, 630, '校园菌菇首领', { color: '#ffffff', fontSize: '16px' })
      this.add.text(580, 630, '霜翼使徒', { color: '#4da6ff', fontSize: '16px' })
      this.add.text(980, 630, '最终心魔', { color: '#a855f7', fontSize: '16px' })
      ctx.hud.setNotice('P 看纸团分裂；右上1—5单独查看动画')
    } else {
      // Keep the hidden dummy body's world-step sentinel, but previews have no physics bodies.
      ctx.player.gameObject.setVisible(false)
      this.add.ellipse(600, 545, 260, 46, 0x000000, 0.25)
      this.preview = this.add.sprite(600, 430, textureKeyFor(this, this.clip().texture)).setDepth(20)
      this.preview.setScale(this.subject === 'first' ? 2 : 2.4)
      this.effect = this.add.sprite(600, 474, textureKeyFor(this, NIGHTMARE_CAT_ART.vortex)).setScale(3.2).setDepth(19).setVisible(false)
      ACTIONS.forEach((action, index) => {
        campusButton(this, 782 + index % 4 * 122, 143 + Math.floor(index / 4) * 37, 115, action.label, () => {
          this.action = action.id; this.elapsedMs = 0; this.frameIndex = 0; this.playing = true
          this.renderPreview()
        })
      })
      const toggle = (): void => { this.playing = !this.playing }
      const step = (): void => {
        this.playing = false
        const clip = this.clip()
        this.frameIndex = (this.frameIndex + 1) % clip.frames.length
        this.elapsedMs = this.frameIndex * 1000 / clip.frameRate
        this.renderPreview()
      }
      const replay = (): void => { this.elapsedMs = 0; this.frameIndex = 0; this.playing = true }
      const turn = (): void => { this.direction = (this.direction + 1) % DIRECTIONS.length; this.renderPreview() }
      campusButton(this, 782, 225, 155, 'V 播放 / 暂停', toggle)
      campusButton(this, 944, 225, 155, 'N 下一帧', step)
      campusButton(this, 1106, 225, 157, 'O 重播动作', replay)
      if (this.subject === 'muscovy') campusButton(this, 782, 263, 155, 'D 切换四向', turn)
      bind('V', toggle); bind('N', step); bind('O', replay)
      if (this.subject === 'muscovy') bind('D', turn)
      this.details = campusText(this, 782, 310, '', 465)
      this.playback = campusText(this, 450, 575, '', 470)
      ctx.hud.setNotice('独立无物理动画预览；动作可暂停、逐帧、重播')
      this.renderPreview()
    }
    this.events.once('shutdown', () => {
      for (const handler of handlers) this.input.keyboard?.off(handler.event, handler.callback)
    })
  }

  private clip(): Clip {
    if (this.subject === 'muscovy') {
      const state = MUSCOVY_ART.states[this.action === 'attack' ? 'dash' : this.action]
      const offset = MUSCOVY_ART.directions[DIRECTIONS[this.direction]!]
      return { texture: MUSCOVY_ART.texture, frames: Array.from({ length: state.count }, (_, index) => offset + state.start + index), frameRate: state.frameRate, loop: state.loop }
    }
    if (this.subject === 'cat') {
      if (this.action === 'death') {
        const purify = NIGHTMARE_CAT_ART.states.purify, vanish = NIGHTMARE_CAT_ART.states.vanish
        return { texture: NIGHTMARE_CAT_ART.texture, frames: Array.from({ length: purify.count + vanish.count }, (_, index) => purify.start + index), frameRate: purify.frameRate, loop: false }
      }
      const state = NIGHTMARE_CAT_ART.states[this.action === 'attack' ? 'spin' : this.action]
      return { texture: NIGHTMARE_CAT_ART.texture, frames: Array.from({ length: state.count }, (_, index) => state.start + index), frameRate: state.frameRate, loop: state.loop }
    }
    if (this.subject === 'first') {
      const state = BOSS_FIRST_ART.states[this.action]
      return { texture: BOSS_FIRST_ART.texture, frames: Array.from({ length: state.count }, (_, index) => state.start + index), frameRate: state.frameRate, loop: state.loop }
    }
    const art = this.subject === 'final' ? FINAL_BOSS_ART : STAGE2_BOSS_ART
    const attacking = this.action === 'windup' || this.action === 'attack' || this.action === 'recover'
    const texture = attacking ? art.attack : this.subject === 'final' && this.action === 'walk' ? FINAL_BOSS_ART.walk : art.idle
    const animation = ANIMS.find((item) => item.textureKey === texture)!
    const half = Math.floor(animation.frames.length / 2)
    const frames = !attacking ? animation.frames : this.action === 'windup' ? animation.frames.slice(0, half) : animation.frames.slice(half)
    return { texture, frames, frameRate: animation.frameRate, loop: !attacking }
  }

  private renderPreview(): void {
    if (!this.preview) return
    const clip = this.clip()
    const index = Math.min(this.frameIndex, clip.frames.length - 1)
    this.preview.setTexture(textureKeyFor(this, clip.texture), clip.frames[index])
    const catSpin = this.subject === 'cat' && this.action === 'attack'
    const catVanish = this.subject === 'cat' && this.action === 'death' && index >= NIGHTMARE_CAT_ART.states.purify.count
    this.effect?.setVisible(catSpin || catVanish)
    if (catSpin || catVanish) {
      const key = catVanish ? NIGHTMARE_CAT_ART.void : NIGHTMARE_CAT_ART.vortex
      this.effect?.setTexture(textureKeyFor(this, key), Math.floor(this.elapsedMs * NIGHTMARE_CAT_ART.fxFrameRate / 1000) % NIGHTMARE_CAT_ART.fxFrameCount)
    }
    const limited = (this.subject === 'second' || this.subject === 'final') && (this.action === 'hit' || this.action === 'death')
    const note = limited ? '该首领现有图集没有独立受击/死亡序列；当前显示待机。实际命中反馈请切6总览开枪观察。'
      : this.subject === 'cat' && this.action === 'death' ? '黑化消退 → 正常猫 → 虚空消失；这里是无物理副本预览，不产生击杀/奖励。'
        : this.subject === 'muscovy' ? '四方向共用相同动作槽；D按顺序切右/下/左/上。行为与受伤验证请回番鸭猫白箱场。'
          : '展示资源清单中的正式序列帧。预览不会移动实体或触发战斗伤害。'
    this.details.setText(`${SUBJECTS.find((item) => item.id === this.subject)!.label}\n动作：${ACTIONS.find((item) => item.id === this.action)!.label}${this.subject === 'muscovy' ? ` · ${['右', '下', '左', '上'][this.direction]}` : ''}\n${note}`)
    this.playback.setText(`${this.playing ? '播放中' : '已暂停'} · ${index + 1}/${clip.frames.length}帧 · 图集帧 ${clip.frames[index]}\nV 暂停/继续  N 下一帧  O 从头重播`)
  }

  protected override onArenaUpdate(dtMs: number): void {
    if (!this.preview) return
    const clip = this.clip()
    if (this.playing && !this.clock.paused) {
      this.elapsedMs += Math.min(dtMs, 1000 / 30)
      const frame = Math.floor(this.elapsedMs * clip.frameRate / 1000)
      this.frameIndex = clip.loop ? frame % clip.frames.length : Math.min(frame, clip.frames.length - 1)
      if (!clip.loop && frame >= clip.frames.length) this.playing = false
    }
    this.renderPreview()
  }
}

export const arena: ArenaDefinition = {
  displayName: '校园敌人与首领动画',
  description: '1番鸭 / 2猫 / 3菌菇 / 4霜翼 / 5心魔逐帧预览；6实战总览，P纸团分裂。',
  scene: CampusArtArena,
}
