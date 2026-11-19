import Phaser from 'phaser'
import type { CombatSession } from './CombatSession'
import type { PerformanceSnapshot } from './GoosePerformance'

/** 屏幕底部的单技能状态条。所有角色共用同一种排版。 */
export class SkillHud {
  private readonly root: Phaser.GameObjects.Container
  private readonly panel: Phaser.GameObjects.Rectangle
  private readonly title: Phaser.GameObjects.Text
  private readonly state: Phaser.GameObjects.Text
  private readonly detail: Phaser.GameObjects.Text
  private readonly performanceRoot: Phaser.GameObjects.Container
  private readonly performancePanel: Phaser.GameObjects.Rectangle
  private readonly performanceTitle: Phaser.GameObjects.Text
  private readonly performanceTimer: Phaser.GameObjects.Text
  private readonly redStackText: Phaser.GameObjects.Text
  private readonly blueStackText: Phaser.GameObjects.Text
  private readonly performanceHint: Phaser.GameObjects.Text
  private readonly track: Phaser.GameObjects.Rectangle
  private readonly beat: Phaser.GameObjects.Arc
  private readonly target: Phaser.GameObjects.Arc

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly session: CombatSession,
  ) {
    // 屏幕 HUD 高于按世界 y 排序的实体、家具及世界标注。
    this.root = scene.add.container(0, 0).setScrollFactor(0).setDepth(5012)
    this.panel = scene.add
      .rectangle(0, 0, 330, 64, 0x15231b, 0.92)
      .setOrigin(0)
      .setStrokeStyle(1, 0x756144)
    this.title = scene.add.text(12, 9, '', {
      fontFamily: 'Microsoft YaHei',
      fontSize: '14px',
      color: '#eddfbf',
    })
    this.state = scene.add.text(12, 31, '', {
      fontFamily: 'Microsoft YaHei',
      fontSize: '12px',
      color: '#efd198',
    })
    this.detail = scene.add
      .text(318, 10, '', {
        fontFamily: 'Microsoft YaHei',
        fontSize: '11px',
        color: '#a8b69d',
        align: 'right',
      })
      .setOrigin(1, 0)
    this.root.add([this.panel, this.title, this.state, this.detail])

    const width = 560
    this.performanceRoot = scene.add.container(0, 0).setScrollFactor(0).setDepth(5013)
    this.performancePanel = scene.add
      .rectangle(0, 0, width, 106, 0x101822, 0.96)
      .setOrigin(0)
      .setStrokeStyle(2, 0x7bc7e8, 0.9)
    this.performanceTitle = scene.add.text(18, 10, '演奏', {
      fontFamily: 'Microsoft YaHei',
      fontSize: '17px',
      color: '#edf7ff',
    })
    this.performanceTimer = scene.add
      .text(width - 18, 10, '', {
        fontFamily: 'Microsoft YaHei',
        fontSize: '13px',
        color: '#9bc8dd',
      })
      .setOrigin(1, 0)
    this.redStackText = scene.add.text(18, 35, '', {
      fontFamily: 'Microsoft YaHei',
      fontSize: '13px',
      color: '#ff7777',
    })
    this.blueStackText = scene.add.text(200, 35, '', {
      fontFamily: 'Microsoft YaHei',
      fontSize: '13px',
      color: '#73c7ff',
    })
    this.performanceHint = scene.add
      .text(width - 18, 35, 'Space 红歌 · 左键 蓝歌', {
        fontFamily: 'Microsoft YaHei',
        fontSize: '12px',
        color: '#d7e4ec',
      })
      .setOrigin(1, 0)
    this.track = scene.add
      .rectangle(26, 78, width - 52, 7, 0x273846, 1)
      .setOrigin(0, 0.5)
    this.beat = scene.add.circle(26, 78, 10, 0xffdf8b, 1)
    this.target = scene.add
      .circle(width - 26, 78, 10, 0x000000, 0)
      .setStrokeStyle(3, 0xffdf8b, 0.9)
    this.performanceRoot.add([
      this.performancePanel,
      this.performanceTitle,
      this.performanceTimer,
      this.redStackText,
      this.blueStackText,
      this.performanceHint,
      this.track,
      this.beat,
      this.target,
    ])
    this.performanceRoot.setVisible(false)
  }

  update(): void {
    const status = this.session.skillStatus()
    if (!status) {
      this.root.setVisible(false)
      this.performanceRoot.setVisible(false)
      return
    }
    const performance = status.performance
    if (performance?.active) {
      this.root.setVisible(false)
      this.performanceRoot.setVisible(true)
      this.layoutPerformance()
      this.updatePerformance(performance, status.performanceMana)
      return
    }
    this.performanceRoot.setVisible(false)
    this.root.setVisible(true)
    const camera = this.scene.cameras.main
    const scale = Math.min(1, (camera.width - 36) / 690)
    this.root
      .setScale(scale / camera.zoom)
      .setPosition(
        camera.width * camera.originX * (1 - 1 / camera.zoom) +
          (camera.width - 330 * scale) / (2 * camera.zoom),
        camera.height * camera.originY * (1 - 1 / camera.zoom) +
          (camera.height - 16 - 64 * scale) / camera.zoom,
      )
    this.title.setText(`${status.name}  Lv.${status.level}`)
    this.state.setText(status.state)
    this.detail.setText(status.detail)
    this.state.setColor(status.ready ? '#efd198' : '#a8b69d')
    this.panel.setStrokeStyle(1, status.ready ? 0xd5b274 : 0x756144)
  }

  private layoutPerformance(): void {
    const camera = this.scene.cameras.main
    const width = 560
    const scale = Math.min(1, (camera.width - 32) / width)
    this.performanceRoot
      .setScale(scale / camera.zoom)
      .setPosition(
        camera.width * camera.originX * (1 - 1 / camera.zoom) +
          (camera.width - width * scale) / (2 * camera.zoom),
        camera.height * camera.originY * (1 - 1 / camera.zoom) +
          (camera.height - 16 - 106 * scale) / camera.zoom,
      )
  }

  private updatePerformance(
    performance: PerformanceSnapshot,
    mana: { current: number; maximum: number; songCost: number } | undefined,
  ): void {
    this.performanceTimer.setText(
      mana
        ? `魔力 ${Math.ceil(mana.current)}/${Math.ceil(mana.maximum)} · 每首 ${mana.songCost}`
        : '',
    )
    this.redStackText.setText(
      `红 ${performance.redStacks}/${performance.maxStacks}  ${this.stackTimer(performance.redRemainingMs)}`,
    )
    this.blueStackText.setText(
      `蓝 ${performance.blueStacks}/${performance.maxStacks}  ${this.stackTimer(performance.blueRemainingMs)}`,
    )
    const lastX = this.performancePanel.width - 26
    this.beat.setPosition(26 + (lastX - 26) * performance.beatProgress, 78)
    this.beat.setFillStyle(performance.onBeat ? 0xfff3ba : 0xffdf8b, 1)
    this.target.setStrokeStyle(
      performance.onBeat ? 4 : 3,
      performance.onBeat ? 0xffffff : 0xffdf8b,
      performance.onBeat ? 1 : 0.9,
    )
    this.performanceHint.setText(
      performance.onBeat
        ? '节拍命中 · Space 红歌 / 左键蓝歌 · F1 停止'
        : 'Space 红歌 · 左键蓝歌 · F1 停止',
    )
    this.performancePanel.setStrokeStyle(2, performance.onBeat ? 0xffffff : 0x7bc7e8, 0.9)
  }

  private stackTimer(remainingMs: number): string {
    return remainingMs > 0 ? `${(remainingMs / 1000).toFixed(1)}s` : '—'
  }

  destroy(): void {
    for (const child of [...this.root.list]) child.destroy()
    this.root.destroy()
    for (const child of [...this.performanceRoot.list]) child.destroy()
    this.performanceRoot.destroy()
  }
}
