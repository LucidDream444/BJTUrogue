/** 战斗中的首次遭遇提示和图鉴；战斗暂停、键盘入口均由宿主统一管理。 */
import Phaser from 'phaser'
import type { ConfigBundle, Difficulty } from '@/core/config'
import type { GameEvents } from '@/core/events'
import { DIFFICULTY_LABELS } from '../catalog'
import type { ProfileStore } from '../profile/ProfileStore'
import { Button } from '../ui/Button'
import { buildOverlayFrame, type OverlaySink } from '../ui/overlayFrame'
import { OverlayLayer } from '../ui/overlayLayer'
import { SaveStatusBanner } from '../ui/SaveStatusBanner'
import { THEME, fontPx } from '../ui/theme'
import { CodexPanel } from './CodexPanel'
import { buildCodexEntries, type CodexEntry } from './codexCatalog'
import { EnemyEncounterQueue } from './enemyEncounterQueue'

export interface EncounterCodexHost {
  /** 同时暂停游戏逻辑、物理和战斗输入。 */
  pause(): void
  resume(): void
  /** 战斗进行中且无其他弹层时才允许提示和打开。 */
  canOpen(): boolean
}

export interface EncounterCodexOverlayOptions {
  scene: Phaser.Scene
  bus: {
    on(event: 'entity_spawned', handler: (event: GameEvents['entity_spawned']) => void): () => void
  }
  store: ProfileStore
  bundle: ConfigBundle
  difficulty: Difficulty
  host: EncounterCodexHost
}

export class EncounterCodexOverlay {
  private readonly scene: Phaser.Scene
  private readonly store: ProfileStore
  private readonly host: EncounterCodexHost
  private readonly difficulty: Difficulty
  private readonly entries: readonly CodexEntry[]
  private readonly queue: EnemyEncounterQueue
  private readonly promptLayer: OverlayLayer
  private readonly prompt: Phaser.GameObjects.Container
  private readonly promptPanel: Phaser.GameObjects.Rectangle
  private readonly promptName: Phaser.GameObjects.Text
  private readonly promptCount: Phaser.GameObjects.Text
  private readonly promptTitle: Phaser.GameObjects.Text
  private readonly promptHint: Phaser.GameObjects.Text
  private readonly onPreUpdate: () => void
  private readonly onResize: () => void
  private readonly unsubscribeSpawn: () => void
  private readonly unsubscribeStore: () => void

  private opened = false
  private selectedId: string | undefined
  private panel: CodexPanel | null = null
  private modalLayer: OverlayLayer | null = null
  private objects: Phaser.GameObjects.GameObject[] = []
  private buttons: Button[] = []
  private parts: Phaser.GameObjects.GameObject[] = []
  private saveBanner: SaveStatusBanner | null = null

  constructor(options: EncounterCodexOverlayOptions) {
    this.scene = options.scene
    this.store = options.store
    this.host = options.host
    this.difficulty = options.difficulty
    this.entries = buildCodexEntries(options.bundle, options.difficulty)
    this.queue = new EnemyEncounterQueue(this.store.profile.encounteredEnemyKinds)

    this.promptLayer = new OverlayLayer(this.scene)
    this.prompt = this.scene.add.container(0, 0).setVisible(false)
    this.promptPanel = this.scene.add
      .rectangle(0, 0, 296, 92, THEME.color.panel, 0.98)
      .setOrigin(0)
      .setStrokeStyle(2, THEME.color.accent)
    this.promptTitle = this.promptText(12, 12, '首次遭遇', THEME.font.small, THEME.text.accent)
    this.promptCount = this.promptText(284, 12, '', THEME.font.small, THEME.text.dim)
      .setOrigin(1, 0)
    this.promptName = this.promptText(12, 34, '', THEME.font.body, THEME.text.body)
    this.promptHint = this.promptText(12, 62, '按 Tab 查看该怪物图鉴', THEME.font.small, THEME.text.accent)
    this.prompt.add([
      this.promptPanel, this.promptTitle, this.promptCount, this.promptName, this.promptHint,
    ])
    this.promptLayer.attach([this.prompt])

    this.unsubscribeSpawn = options.bus.on('entity_spawned', (event) => {
      const encounter = this.queue.discover(event)
      if (!encounter) return
      this.store.recordEnemyEncounter(encounter.kind)
      this.refreshPrompt()
    })
    this.unsubscribeStore = this.store.subscribe(() => this.saveBanner?.refresh())
    this.onPreUpdate = () => this.refreshPrompt()
    this.onResize = () => {
      this.layoutPrompt()
      if (this.opened) this.rebuildModal()
    }
    this.scene.events.on(Phaser.Scenes.Events.PRE_UPDATE, this.onPreUpdate)
    this.scene.scale.on(Phaser.Scale.Events.RESIZE, this.onResize)
    this.layoutPrompt()
  }

  get isOpen(): boolean {
    return this.opened
  }

  get hasPending(): boolean {
    return this.queue.next !== null
  }

  /** 宿主只在唯一的 Tab 入口调用，并过滤 KeyboardEvent.repeat。 */
  handleTab(): boolean {
    if (this.opened) return this.handleEscape()
    if (!this.host.canOpen()) return false
    const encounter = this.queue.openNext()
    if (!encounter) return false
    this.selectedId = encounter.entryId
    this.opened = true
    this.prompt.setVisible(false)
    this.host.pause()
    this.modalLayer ??= new OverlayLayer(this.scene)
    this.rebuildModal()
    return true
  }

  handleEscape(): boolean {
    if (!this.opened) return false
    this.opened = false
    this.queue.close()
    this.clearModal()
    this.host.resume()
    this.refreshPrompt()
    return true
  }

  handleMoveSelection(delta: number): void {
    if (this.opened) this.panel?.moveSelection(delta)
  }

  /** 场景销毁时仅退订和清理，绝不恢复已经被引擎销毁的物理世界。 */
  destroy(): void {
    this.unsubscribeSpawn()
    this.unsubscribeStore()
    this.scene.events.off(Phaser.Scenes.Events.PRE_UPDATE, this.onPreUpdate)
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.onResize)
    this.clearModal()
    this.modalLayer?.destroy()
    this.modalLayer = null
    this.promptLayer.destroy()
    this.opened = false
  }

  private promptText(x: number, y: number, value: string, size: number, color: string): Phaser.GameObjects.Text {
    return this.scene.add.text(x, y, value, {
      fontFamily: THEME.font.family,
      fontSize: fontPx(size),
      color,
    })
  }

  private layoutPrompt(): void {
    const width = Math.min(296, this.scene.scale.width - THEME.space.md * 2)
    this.promptPanel.setSize(width, 92)
    this.promptCount.setX(width - 12)
    this.promptName.setWordWrapWidth(width - 24)
    this.prompt.setPosition(this.scene.scale.width - width - THEME.space.md, THEME.space.md)
  }

  private refreshPrompt(): void {
    const next = this.queue.next
    this.prompt.setVisible(!this.opened && next !== null && this.host.canOpen())
    if (!next) return
    const entry = this.entries.find((candidate) => candidate.id === next.entryId)
    this.promptName.setText(entry ? `${entry.name} · ${entry.variant}` : next.entryId)
    this.promptCount.setText(this.queue.pendingCount > 1 ? `待阅 ${this.queue.pendingCount} 种` : '')
  }

  private rebuildModal(): void {
    this.clearModal()
    const sink: OverlaySink = {
      track: (obj) => {
        this.objects.push(obj)
        this.parts.push(obj)
      },
      button: (button) => {
        this.buttons.push(button)
        this.parts.push(...button.parts)
      },
    }
    const frame = buildOverlayFrame(this.scene, sink, {
      screenWidth: this.scene.scale.width,
      screenHeight: this.scene.scale.height,
      title: '怪物图鉴 · 首次遭遇',
      panelWidth: Math.min(this.scene.scale.width - THEME.space.xl, 980),
      panelHeight: Math.min(this.scene.scale.height - THEME.space.xl, 660),
    }, () => this.handleEscape())
    this.panel = new CodexPanel(this.scene, sink, frame, {
      entries: this.entries,
      selectedId: this.selectedId,
      difficultyLabel: DIFFICULTY_LABELS[this.difficulty],
      onSelect: (entry) => { this.selectedId = entry.id },
    })
    frame.notice.setText('战斗已暂停 · ↑↓ 切换档案 · Tab / Esc 关闭并继续')
    this.saveBanner = new SaveStatusBanner(
      this.scene, this.store, this.scene.scale.width / 2, 44, this.scene.scale.width,
    )
    this.parts.push(this.saveBanner.root)
    this.modalLayer?.attach(this.parts)
  }

  private clearModal(): void {
    this.saveBanner?.destroy()
    this.saveBanner = null
    for (const button of this.buttons) button.destroy()
    for (const object of this.objects) object.destroy()
    this.modalLayer?.detach()
    this.buttons = []
    this.objects = []
    this.parts = []
    this.panel = null
  }
}
