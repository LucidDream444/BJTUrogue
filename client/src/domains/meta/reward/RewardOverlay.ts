/**
 * 奖励选择界面（需求 UC04：清房后三选一）。**这一版只搭壳子。**
 *
 * ## 为什么只有壳子
 *
 * 「局内三选一奖励池」是 D1 的设计输出（《人员分工方案》§三），而分工方案又把
 * **奖励选择界面**列在 D4 的实现输出里。所以分工是：**D4 定界面吃什么形状，D1 填内容**。
 * 这一版把形状定下来（`RewardCandidate[]`），并做了"先选中、再确认"两步 ——
 * 需求原文是「可先查看效果说明再确认选择」，一步点掉就不是那个意思了。
 *
 * ## 宿主只提供两个回调
 *
 * 选项从哪来、选完之后怎么算，都是 D1 的事。这里不订阅事件、不碰战斗状态。
 */

import type Phaser from 'phaser'
import { Button } from '../ui/Button'
import { buildOverlayFrame, type OverlaySink } from '../ui/overlayFrame'
import { THEME, fontPx } from '../ui/theme'

/** 一个候选奖励。**字段定义由 D4 起草、内容归 D1**（奖励池设计） */
export interface RewardCandidate {
  id: string
  name: string
  /** 效果说明。需求要求"先查看效果说明再确认选择"，所以它是必填的 */
  description: string
}

export interface RewardOverlayOptions {
  scene: Phaser.Scene
  /** 本次要展示哪三个（数量由宿主决定，界面按数量平分宽度） */
  offer: () => RewardCandidate[]
  /** 玩家确认之后。宿主负责把效果落到这一局上 */
  pick: (id: string) => void
}

export class RewardOverlay {
  private readonly scene: Phaser.Scene
  private readonly offer: () => RewardCandidate[]
  private readonly onPick: (id: string) => void

  private opened = false
  private candidates: RewardCandidate[] = []
  private selected: string | null = null
  private lastPickedId: string | null = null

  private objects: Phaser.GameObjects.GameObject[] = []
  private buttons: Button[] = []
  private optionButtons = new Map<string, Button>()
  private confirmButton: Button | null = null

  constructor(options: RewardOverlayOptions) {
    this.scene = options.scene
    this.offer = options.offer
    this.onPick = options.pick
  }

  get isOpen(): boolean {
    return this.opened
  }

  /** 上一次选了哪个（测试场读数用） */
  get lastPicked(): string | null {
    return this.lastPickedId
  }

  show(): void {
    if (this.opened) return
    this.opened = true
    this.selected = null
    this.candidates = this.offer()
    this.rebuild()
  }

  hide(): void {
    this.opened = false
    this.clear()
  }

  destroy(): void {
    this.clear()
    this.opened = false
  }

  private rebuild(): void {
    this.clear()
    const sink: OverlaySink = {
      track: (obj) => this.objects.push(obj),
      button: (button) => this.buttons.push(button),
    }
    const frame = buildOverlayFrame(
      this.scene,
      sink,
      {
        screenWidth: this.scene.scale.width,
        screenHeight: this.scene.scale.height,
        title: '选择一项奖励',
        panelWidth: Math.min(this.scene.scale.width - 64, 760),
        panelHeight: 400,
        // 奖励必须选一个才继续，所以没有「关闭」。
        showClose: false,
      },
      () => undefined,
    )

    const count = Math.max(1, this.candidates.length)
    const gap = THEME.space.md
    const cardW = Math.min(200, (frame.panelWidth - THEME.space.lg * 2 - gap * (count - 1)) / count)
    const firstX = frame.cx - ((cardW + gap) * (count - 1)) / 2

    this.candidates.forEach((c, i) => {
      const button = new Button(
        this.scene,
        firstX + i * (cardW + gap),
        frame.contentTop + 70,
        `${c.name}\n\n${c.description}`,
        () => this.select(c.id),
        { width: cardW, height: 170, fontSize: THEME.font.small },
      )
      sink.button(button)
      this.optionButtons.set(c.id, button)
    })

    this.confirmButton = new Button(
      this.scene,
      frame.cx,
      frame.cy + frame.panelHeight / 2 - 70,
      '确认选择',
      () => this.confirm(),
      { width: 180, height: 40, fontSize: THEME.font.body },
    )
    this.confirmButton.setDisabled(true)
    sink.button(this.confirmButton)

    sink.track(
      this.scene.add
        .text(frame.cx, frame.cy + frame.panelHeight / 2 - 30, '先点一项看说明，再点「确认选择」', {
          fontFamily: THEME.font.family,
          fontSize: fontPx(THEME.font.small),
          color: THEME.text.dim,
        })
        .setOrigin(0.5),
    )
  }

  private select(id: string): void {
    this.selected = id
    for (const [candidateId, button] of this.optionButtons) {
      button.setSelected(candidateId === id)
    }
    this.confirmButton?.setDisabled(false)
  }

  private confirm(): void {
    if (this.selected === null) return
    const id = this.selected
    this.lastPickedId = id
    this.hide()
    this.onPick(id)
  }

  private clear(): void {
    for (const b of this.buttons) b.destroy()
    for (const o of this.objects) o.destroy()
    this.buttons = []
    this.objects = []
    this.optionButtons.clear()
    this.confirmButton = null
  }
}
