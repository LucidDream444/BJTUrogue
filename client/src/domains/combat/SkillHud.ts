import Phaser from 'phaser'
import { ARCHIVE_ART } from '@/core/assetManifest'
import { textureKeyFor } from '@/core/assets'
import { ARCHIVE_THEME as A } from '../meta/ui/theme'
import type { CombatSession } from './CombatSession'
import type { PerformanceSnapshot } from './GoosePerformance'
import { BOTTOM_HUD, bottomHudLayout } from './bottomHudLayout'
import { hudText, paintHudPlate, placeHud } from './CombatHudSkin'

/** Three dedicated text rows keep skill name, state and effects from colliding. */
export class SkillHud {
  private readonly root: Phaser.GameObjects.Container
  private readonly panel: Phaser.GameObjects.Graphics
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

  private readonly level: Phaser.GameObjects.Text
  private readonly key: Phaser.GameObjects.Rectangle
  private readonly icon: Phaser.GameObjects.Image
  private readonly keyLabel: Phaser.GameObjects.Text
  private signature = ''
  private ready: boolean | null = null
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly session: CombatSession,
  ) {
    this.root = scene.add.container(0, 0).setScrollFactor(0).setDepth(5012)
    this.panel = scene.add.graphics()
    this.icon = scene.add
      .image(33, 30, textureKeyFor(scene, ARCHIVE_ART.book))
      .setDisplaySize(36, 38)
    this.key = scene.add.rectangle(34, 63, 48, 19, A.ink).setStrokeStyle(1, A.brass)
    this.keyLabel = hudText(scene, 34, 63, 'SPACE', 10, A.muted).setOrigin(0.5)
    this.title = hudText(scene, 70, 12, '', 15, A.paper)
    this.level = hudText(scene, 338, 13, '', 12, A.muted).setOrigin(1, 0)
    this.state = hudText(scene, 70, 37, '', 13, A.energy)
    this.detail = hudText(scene, 70, 60, '', 11, A.muted)
    this.root.add([
      this.panel,
      this.icon,
      this.key,
      this.keyLabel,
      this.title,
      this.level,
      this.state,
      this.detail,
    ])
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
    this.track = scene.add.rectangle(26, 78, width - 52, 7, 0x273846, 1).setOrigin(0, 0.5)
    this.beat = scene.add.circle(26, 78, 10, 0xffdf8b, 1)
    this.target = scene.add.circle(width - 26, 78, 10, 0x000000, 0).setStrokeStyle(3, 0xffdf8b, 0.9)
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
    this.update()
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
    const c = this.scene.cameras.main
    placeHud(this.root, c, bottomHudLayout(c.width, c.height).skill)
    const signature = JSON.stringify(status)
    if (signature === this.signature) return
    this.signature = signature
    if (this.ready !== status.ready) {
      this.ready = status.ready
      paintHudPlate(this.panel, 0, BOTTOM_HUD.skillWidth, BOTTOM_HUD.height, status.ready)
      this.key.setStrokeStyle(1, status.ready ? A.cyan : A.brass)
      this.icon.setAlpha(status.ready ? 1 : 0.5)
      this.keyLabel.setColor(status.ready ? A.energy : A.muted)
    }
    this.title.setText(status.name)
    this.title.setScale(Math.min(1, 210 / Math.max(1, this.title.width)))
    this.level.setText(`Lv.${status.level}`)
    this.state.setText(status.state.replace(/^Space\s*/, ''))
    this.state
      .setScale(Math.min(1, 267 / Math.max(1, this.state.width)))
      .setColor(status.ready ? A.energy : A.muted)
    // Presentation rounding only: prevents fractional recharge seconds spilling beyond the panel.
    this.detail.setText(
      status.detail.replace(
        /(\d+)\.(\d{2,})s/g,
        (_, whole: string, fraction: string) => `${Number(`${whole}.${fraction}`).toFixed(1)}s`,
      ),
    )
    this.detail.setScale(Math.min(1, 267 / Math.max(1, this.detail.width)))
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
    this.root.destroy()
    for (const child of [...this.performanceRoot.list]) child.destroy()
    this.performanceRoot.destroy()
  }
}
