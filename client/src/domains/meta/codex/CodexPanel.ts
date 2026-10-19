/**
 * 主菜单里的怪物图鉴面板。
 *
 * 这里只负责画图和把点击换成选择；条目与数值由 `codexCatalog.ts` 生成。
 * 图鉴使用公共 `Button` / `THEME` / 弹层外框，保持与升级页、设置页同一套视觉语言。
 *
 * 动画规则：
 * - 真美术到位时播放资源清单 `ANIMS` 里的循环待机动画；
 * - 首领占位期不伪造动画，在同一个预览位明确写「形象占位」；
 * - 重新选择条目只替换预览与文字，不重建整块面板，避免动画闪一下。
 */

import type Phaser from 'phaser'
import { textureKeyFor } from '@/core/assets'
import { ANIMS, PLACEHOLDER_MISSING_KEY, findAsset } from '@/core/assetManifest'
import { Button } from '../ui/Button'
import { dashRect } from '../ui/dashed'
import type { OverlayFrame, OverlaySink } from '../ui/overlayFrame'
import { THEME, fontPx } from '../ui/theme'
import { codexAnimationKey, moveCodexIndex, type CodexEntry } from './codexCatalog'

export interface CodexPanelOptions {
  entries: readonly CodexEntry[]
  selectedId?: string
  difficultyLabel: string
  onSelect?: (entry: CodexEntry) => void
}

interface StatParts {
  bg: Phaser.GameObjects.Rectangle
  label: Phaser.GameObjects.Text
  value: Phaser.GameObjects.Text
}

export class CodexPanel {
  private readonly entries: readonly CodexEntry[]
  private readonly scene: Phaser.Scene
  private readonly sink: OverlaySink
  private readonly frame: OverlayFrame
  private readonly options: CodexPanelOptions
  private readonly navButtons: Button[] = []
  private readonly statParts: StatParts[] = []

  private currentSelectedId: string | undefined
  private detailWidth = 0
  private previewHeight = 0
  private nameText!: Phaser.GameObjects.Text
  private variantText!: Phaser.GameObjects.Text
  private roleText!: Phaser.GameObjects.Text
  private threatText!: Phaser.GameObjects.Text
  private previewArt!: Phaser.GameObjects.Sprite
  private previewShadow!: Phaser.GameObjects.Ellipse
  private previewNote!: Phaser.GameObjects.Text
  private animationText!: Phaser.GameObjects.Text
  private loreText!: Phaser.GameObjects.Text

  constructor(
    scene: Phaser.Scene,
    sink: OverlaySink,
    frame: OverlayFrame,
    options: CodexPanelOptions,
  ) {
    this.scene = scene
    this.sink = sink
    this.frame = frame
    this.options = options
    this.entries = options.entries
    this.currentSelectedId = options.selectedId

    if (this.entries.length === 0) {
      sink.track(
        scene.add
          .text(frame.cx, frame.cy, '图鉴配置为空：没有可展示的怪物档案。', {
            fontFamily: THEME.font.family,
            fontSize: fontPx(THEME.font.body),
            color: THEME.text.danger,
          })
          .setOrigin(0.5),
      )
      return
    }

    const top = frame.contentTop
    const left = frame.contentLeft
    const navWidth = Math.max(172, Math.min(224, frame.panelWidth * 0.27))
    const detailX = left + navWidth + THEME.space.md
    const detailW = frame.panelWidth - (detailX - left) - THEME.space.lg

    this.buildList(left, top, navWidth)
    this.buildDetail(detailX, top, detailW)

    const requested = options.selectedId
      ? this.entries.findIndex((entry) => entry.id === options.selectedId)
      : 0
    this.selectByIndex(requested >= 0 ? requested : 0, false)
  }

  /** 键盘上下选择档案；鼠标点击仍然走列表按钮。 */
  moveSelection(delta: number): void {
    this.selectByIndex(moveCodexIndex(this.selectedIndex(), delta, this.entries.length), true)
  }

  private buildList(left: number, top: number, width: number): void {
    this.text(left, top, '档案目录', THEME.font.heading, THEME.text.accent)
    this.text(
      left,
      top + 26,
      `${String(this.entries.length).padStart(2, '0')} 份记录 · 配置自动同步`,
      THEME.font.small,
      THEME.text.dim,
    )

    const firstY = top + 58
    const buttonH = this.frame.panelHeight < 570 ? 32 : 36
    const gap = THEME.space.sm
    this.entries.forEach((entry, index) => {
      const label = `${String(index + 1).padStart(2, '0')}  ${entry.name} · ${entry.variant}`
      const button = new Button(
        this.scene,
        left + width / 2,
        firstY + index * (buttonH + gap),
        label,
        () => this.selectByIndex(index, true),
        {
          width,
          height: buttonH,
          fontSize: THEME.font.small,
        },
      )
      this.navButtons.push(button)
      this.sink.button(button)
    })

    const dividerY = this.frame.cy + this.frame.panelHeight / 2 - 92
    const guide = this.scene.add.graphics()
    guide.lineStyle(1, THEME.color.border, 0.4).lineBetween(left, dividerY, left + width, dividerY)
    this.sink.track(guide)
    this.text(
      left,
      dividerY + THEME.space.sm,
      '选择档案后，右侧会实时播放待机动画。',
      THEME.font.small,
      THEME.text.dim,
    )
  }

  private buildDetail(left: number, top: number, width: number): void {
    const narrow = width < 520
    this.detailWidth = width
    this.nameText = this.text(left, top, '', THEME.font.heading, THEME.text.body)
    this.variantText = this.text(left, top + 27, '', THEME.font.small, THEME.text.dim)
    this.roleText = this.text(left, top + 48, '', THEME.font.body, THEME.text.dim)
    this.threatText = this.text(left + width, top, '', THEME.font.small, THEME.text.accent)
    this.threatText.setOrigin(1, 0)

    const previewTop = top + 76
    const previewH = narrow ? 126 : 158
    this.previewHeight = previewH
    const preview = this.scene.add.graphics()
    preview
      .fillStyle(THEME.color.disabled, 0.82)
      .fillRoundedRect(left, previewTop, width, previewH, 8)
      .lineStyle(1, THEME.color.border, 0.65)
      .strokeRoundedRect(left, previewTop, width, previewH, 8)
      .lineStyle(1, THEME.color.border, 0.16)
    for (let x = left + 32; x < left + width; x += 32) {
      preview.lineBetween(x, previewTop + 1, x, previewTop + previewH - 1)
    }
    for (let y = previewTop + 32; y < previewTop + previewH; y += 32) {
      preview.lineBetween(left + 1, y, left + width - 1, y)
    }
    this.sink.track(preview)

    const firstArt = textureKeyFor(this.scene, this.entries[0]!.textureKey)
    this.previewShadow = this.scene.add.ellipse(
      left + width / 2,
      previewTop + previewH - 28,
      Math.min(150, width * 0.42),
      18,
      THEME.color.dim,
      0.38,
    )
    this.sink.track(this.previewShadow)
    this.previewArt = this.scene.add.sprite(left + width / 2, previewTop + previewH / 2, firstArt)
    this.sink.track(this.previewArt)
    this.previewNote = this.text(
      left + width / 2,
      previewTop + previewH / 2 - 8,
      '首领形象待补',
      THEME.font.body,
      THEME.text.disabled,
    ).setOrigin(0.5)
    this.animationText = this.text(
      left + THEME.space.md,
      previewTop + previewH - THEME.space.sm,
      '',
      THEME.font.small,
      THEME.text.accent,
    ).setOrigin(0, 1)

    const statsTitleY = previewTop + previewH + 18
    this.text(left, statsTitleY, '战斗数值', THEME.font.body, THEME.text.accent)
    const cols = narrow ? 2 : 3
    const cardGap = THEME.space.sm
    const cardW = (width - cardGap * (cols - 1)) / cols
    const cardH = 40
    const cardsTop = statsTitleY + 26
    for (let i = 0; i < 5; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const x = left + col * (cardW + cardGap)
      const y = cardsTop + row * (cardH + cardGap)
      const bg = this.scene.add.rectangle(x, y, cardW, cardH, THEME.color.panel).setOrigin(0)
      bg.setStrokeStyle(1, THEME.color.border)
      this.sink.track(bg)
      const label = this.text(x + THEME.space.sm, y + 5, '', THEME.font.small, THEME.text.dim)
      const value = this.text(
        x + cardW - THEME.space.sm,
        y + 19,
        '',
        THEME.font.body,
        THEME.text.body,
      ).setOrigin(1, 0)
      this.statParts.push({ bg, label, value })
    }

    const rows = Math.ceil(5 / cols)
    const cardsBottom = cardsTop + rows * (cardH + cardGap)
    const panelBottom = this.frame.cy + this.frame.panelHeight / 2 - 74
    const loreTop = cardsBottom + 8
    const loreH = Math.max(70, panelBottom - loreTop)
    const lore = this.scene.add.graphics()
    lore.fillStyle(THEME.color.panel, 0.42).fillRoundedRect(left, loreTop, width, loreH, 6)
    lore.lineStyle(1, THEME.color.border, 0.55)
    dashRect(lore, left + 1, loreTop + 1, width - 2, loreH - 2, 7, 5)
    this.sink.track(lore)
    this.text(
      left + THEME.space.sm,
      loreTop + THEME.space.sm,
      '怪物档案文案',
      THEME.font.small,
      THEME.text.accent,
    )
    this.loreText = this.scene.add.text(left + THEME.space.sm, loreTop + 30, '', {
      fontFamily: THEME.font.family,
      fontSize: fontPx(THEME.font.small),
      color: THEME.text.dim,
      lineSpacing: 4,
      wordWrap: { width: width - THEME.space.md },
    })
    this.sink.track(this.loreText)
  }

  private selectByIndex(index: number, notify: boolean): void {
    if (this.entries.length === 0) return
    const entry = this.entries[index]!
    this.currentSelectedId = entry.id

    this.navButtons.forEach((button, i) => button.setSelected(i === index))
    this.nameText?.setText(entry.name)
    this.variantText?.setText(`${entry.category} · ${entry.variant}`)
    this.roleText?.setText(entry.role)
    this.threatText?.setText(
      `威胁 ${entry.threatLevel} / 5    当前难度 · ${this.options.difficultyLabel}`,
    )
    this.loreText?.setText(entry.lorePlaceholder)

    this.statParts.forEach((parts, i) => {
      const stat = entry.stats[i]
      const visible = stat !== undefined
      parts.bg.setVisible(visible)
      parts.label.setVisible(visible)
      parts.value.setVisible(visible)
      if (!stat) return
      parts.label.setText(stat.label)
      parts.value.setText(stat.value)
    })

    this.refreshPreview(entry)
    if (notify) this.options.onSelect?.(entry)
  }

  private selectedIndex(): number {
    return Math.max(
      0,
      this.entries.findIndex((entry) => entry.id === this.currentSelectedId),
    )
  }

  private refreshPreview(entry: CodexEntry): void {
    this.animationText.setText('')
    this.previewNote.setVisible(false)
    this.previewArt.setVisible(entry.hasArt)
    this.previewShadow.setVisible(entry.hasArt)

    if (!entry.hasArt) {
      this.previewNote.setVisible(true)
      this.animationText.setText('形象占位 · 动画待美术接入')
      return
    }

    const textureKey = textureKeyFor(this.scene, entry.textureKey)
    this.previewArt.setTexture(textureKey)
    this.previewArt.stop()
    this.previewArt.setFrame(0)

    if (textureKey === PLACEHOLDER_MISSING_KEY) {
      this.animationText.setText('资源缺失 · 已显示洋红兜底方块')
      return
    }

    const asset = findAsset(entry.textureKey)
    const frameWidth = asset?.frameWidth ?? asset?.width ?? 64
    const frameHeight = asset?.frameHeight ?? asset?.height ?? 64
    const fit = Math.min(
      (this.detailWidth - 40) / frameWidth,
      (this.previewHeight - 30) / frameHeight,
    )
    this.previewArt.setScale(Math.max(0.35, fit * entry.visualScale))

    const animKey = codexAnimationKey(entry.textureKey)
    if (animKey && this.ensureAnimation(entry.textureKey, animKey)) {
      this.previewArt.play(animKey)
      this.animationText.setText('动画预览 · 待机循环')
    } else {
      this.animationText.setText('静态形象 · 尚无待机动画')
    }
  }

  private ensureAnimation(textureKey: string, animKey: string): boolean {
    if (this.scene.anims.exists(animKey)) return true
    const anim = ANIMS.find((item) => item.animKey === animKey)
    const asset = findAsset(textureKey)
    if (!anim || !asset || asset.placeholder) return false

    const texture = this.scene.textures.get(textureKey)
    if (!anim.frames.every((frame) => texture.has(String(frame)))) return false
    this.scene.anims.create({
      key: anim.animKey,
      frames: anim.frames.map((frame) => ({ key: textureKey, frame })),
      frameRate: anim.frameRate,
      repeat: anim.repeat,
      yoyo: anim.yoyo ?? false,
    })
    return true
  }

  private text(
    x: number,
    y: number,
    value: string,
    size: number,
    color: string,
  ): Phaser.GameObjects.Text {
    const obj = this.scene.add.text(x, y, value, {
      fontFamily: THEME.font.family,
      fontSize: fontPx(size),
      color,
    })
    this.sink.track(obj)
    return obj
  }
}
