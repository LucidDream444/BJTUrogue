import { ANIMS } from '@/core/assetManifest'
import { ArchiveUI } from '../ui/ArchiveUI'
import { ARCHIVE_THEME as A } from '../ui/theme'
import { codexAnimationKey, moveCodexIndex, type CodexEntry } from './codexCatalog'

export interface CodexPanelOptions {
  entries: readonly CodexEntry[]
  selectedId?: string
  difficultyLabel: string
  detail?: boolean
  onSelect?: (entry: CodexEntry) => void
  onDetail?: (detail: boolean) => void
  /** 战斗内首次遭遇可提示关闭后继续战斗；主菜单保持原来的导航提示。 */
  footerHint?: string
}

/** A pale illustrated field notebook, backed by the actual enemy catalogue. */
export class CodexPanel {
  private selected = 0
  private filter: '全部' | '普通敌人' | '首领' = '全部'
  private detail = false
  private readonly start: number
  constructor(
    private readonly ui: ArchiveUI,
    private readonly options: CodexPanelOptions,
  ) {
    this.start = ui.root.list.length
    this.selected = Math.max(
      0,
      options.entries.findIndex((e) => e.id === options.selectedId),
    )
    this.detail = options.detail ?? false
    this.render()
  }
  private get entries(): readonly CodexEntry[] {
    return this.options.entries.filter((e) => this.filter === '全部' || e.category === this.filter)
  }
  moveSelection(delta: number): void {
    if (!this.entries.length) return
    this.selected = moveCodexIndex(this.selected, delta, this.entries.length)
    this.options.onSelect?.(this.entries[this.selected]!)
    this.render()
  }
  activate(): void {
    this.detail = !this.detail
    this.options.onDetail?.(this.detail)
    this.render()
  }
  back(): boolean {
    if (!this.detail) return false
    this.detail = false
    this.options.onDetail?.(false)
    this.render()
    return true
  }
  private render(): void {
    const ui = this.ui
    ui.root.list.slice(this.start).forEach((obj) => obj.destroy())
    const entry = this.entries[this.selected]
    if (!entry) {
      ui.label(110, 240, '暂无怪物档案')
      return
    }
    if (this.detail) this.buildNotes(entry)
    else this.buildRoster()
    this.buildPortrait(entry)
    ui.label(111, 839, `可查阅档案  ${this.options.entries.length} 条`, A.size.micro, A.pageMuted)
    ui.label(1460, 837, this.options.footerHint ?? '方向键切换 · Enter 详情 · Esc 返回', A.size.micro, A.pageMuted).setOrigin(
      1,
      0,
    )
  }
  private buildRoster(): void {
    const ui = this.ui
    ;(['全部', '普通敌人', '首领'] as const).forEach((category, i) => {
      const x = 157 + i * 133
      ui.button(x, 195, 119, 43, category, () => {
        this.filter = category
        this.selected = 0
        this.options.onSelect?.(this.entries[0]!)
        this.render()
      })
      if (this.filter === category)
        ui.add(ui.scene.add.graphics())
          .lineStyle(3, A.cyan)
          .lineBetween(x - 50, 217, x + 50, 217)
    })
    const page = Math.floor(this.selected / 6)
    this.entries.slice(page * 6, page * 6 + 6).forEach((entry, i) => {
      const x = 100 + (i % 2) * 199,
        y = 238 + Math.floor(i / 2) * 174,
        selected = page * 6 + i === this.selected
      const g = ui.add(ui.scene.add.graphics())
      g.fillStyle(A.ink, selected ? 0.95 : 0.86).fillRoundedRect(x, y, 181, 158, 5)
      if (selected) g.lineStyle(8, A.cyan, 0.16).strokeRoundedRect(x, y, 181, 158, 5)
      g.lineStyle(selected ? 2 : 1, selected ? A.cyan : A.brass).strokeRoundedRect(
        x,
        y,
        181,
        158,
        5,
      )
      ui.label(x + 12, y + 8, String(page * 6 + i + 1).padStart(2, '0'), A.size.micro, A.muted)
      this.portrait(entry, x + 90, y + 67, 91, false)
      ui.label(x + 90, y + 116, entry.name, A.size.small, A.paper, undefined, true).setOrigin(0.5)
      ui.label(x + 90, y + 142, entry.variant, A.size.micro, A.muted).setOrigin(0.5)
      ui.add(
        ui.scene.add
          .rectangle(x + 90, y + 79, 181, 158, A.ink, 0.001)
          .setInteractive({ useHandCursor: true }),
      ).on('pointerup', () => {
        this.selected = page * 6 + i
        this.options.onSelect?.(entry)
        this.render()
      })
    })
    const pages = Math.ceil(this.entries.length / 6)
    ui.label(288, 789, `${page + 1} / ${pages}`, A.size.small, A.pageText).setOrigin(0.5)
    ui.button(
      159,
      789,
      115,
      38,
      '← 上页',
      () => {
        this.selected = (page - 1) * 6
        this.options.onSelect?.(this.entries[this.selected]!)
        this.render()
      },
      false,
      page === 0,
    )
    ui.button(
      420,
      789,
      115,
      38,
      '下页 →',
      () => {
        this.selected = (page + 1) * 6
        this.options.onSelect?.(this.entries[this.selected]!)
        this.render()
      },
      false,
      page + 1 >= pages,
    )
  }
  private buildNotes(entry: CodexEntry): void {
    const ui = this.ui
    ui.button(288, 197, 365, 44, '← 返回档案目录', () => this.back())
    ui.label(115, 259, '异界观察笔记', A.size.heading, A.pageText, undefined, true)
    ui.rule(115, 307, 350)
    const lore = entry.lorePlaceholder.startsWith('档案文案尚未')
      ? '档案整理中。右页战斗数值随当前难度显示。'
      : entry.lorePlaceholder
    ui.label(115, 338, lore, A.size.body, A.pageMuted, 350)
    ui.rule(115, 650, 350)
    ui.label(
      115,
      677,
      `分类：${entry.category}\n阶段：${entry.variant}\n难度：${this.options.difficultyLabel}`,
      A.size.small,
      A.pageText,
      350,
    )
    ui.button(195, 786, 160, 43, '← 上一条', () => this.moveSelection(-1))
    ui.button(390, 786, 160, 43, '下一条 →', () => this.moveSelection(1))
  }
  private buildPortrait(entry: CodexEntry): void {
    const ui = this.ui
    ui.label(575, 177, entry.name, 40, A.pageText, undefined, true)
    ui.label(577, 232, `${entry.category}  /  ${entry.variant}`, A.size.small, A.pageMuted)
    ui.rule(575, 273, 890)
    const halo = ui.add(ui.scene.add.graphics())
    for (let i = 7; i > 0; i--) halo.fillStyle(A.cyan, 0.025).fillCircle(810, 437, 90 + i * 11)
    ui.orbit(810, 536, 157, A.cyan)
    this.portrait(entry, 810, 421, 287, true)
    ui.label(
      810,
      582,
      `威胁  ${'◆'.repeat(entry.threatLevel)}${'◇'.repeat(5 - entry.threatLevel)}`,
      A.size.small,
      A.pageBlue,
    ).setOrigin(0.5)
    ui.label(575, 637, '战斗观察', A.size.body, A.pageText, undefined, true)
    ui.label(575, 681, entry.role, A.size.small, A.pageMuted, 475)

    ui.label(1110, 301, '战斗档案', A.size.heading, A.pageText, undefined, true)
    ui.label(1110, 344, `当前难度 · ${this.options.difficultyLabel}`, A.size.micro, A.pageMuted)
    const stats = this.detail ? entry.stats : entry.stats.slice(0, 5)
    if (!stats.length) ui.label(1110, 400, '数值尚未收录', A.size.small, A.pageMuted)
    stats.forEach((stat, i) => {
      const y = 393 + i * 48
      ui.label(1110, y, stat.label, A.size.micro, A.pageMuted)
      const value = ui.label(1460, y, stat.value, A.size.small, A.pageText).setOrigin(1, 0)
      if (value.width > 215) value.setScale(215 / value.width)
      ui.rule(1110, y + 33, 350)
    })
    if (!this.detail) {
      if (entry.stats.length > 5)
        ui.label(1110, 653, `另有 ${entry.stats.length - 5} 项战斗记录`, A.size.micro, A.pageMuted)
      ui.button(1285, 743, 350, 82, '查看完整档案', () => this.activate(), true)
    } else
      ui.label(1285, 786, '—  课后勇者 · 异界档案  —', A.size.micro, A.pageMuted).setOrigin(0.5)
  }
  private portrait(entry: CodexEntry, x: number, y: number, size: number, animated: boolean): void {
    if (!entry.hasArt) {
      this.ui.label(x, y, '形象待补', A.size.body, A.pageMuted).setOrigin(0.5)
      return
    }
    const sprite = this.ui.portrait(entry.textureKey, x, y, size)
    if (!animated) return
    const key = codexAnimationKey(entry.textureKey),
      scene = this.ui.scene
    if (!key) return
    if (!scene.anims.exists(key)) {
      const anim = ANIMS.find((a) => a.animKey === key)
      if (anim && anim.frames.every((f) => sprite.texture.has(String(f))))
        scene.anims.create({
          key,
          frames: anim.frames.map((frame) => ({ key: entry.textureKey, frame })),
          frameRate: anim.frameRate,
          repeat: anim.repeat,
          yoyo: anim.yoyo ?? false,
        })
    }
    if (scene.anims.exists(key)) sprite.play(key)
  }
}
