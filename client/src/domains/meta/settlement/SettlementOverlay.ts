/** 结算面板只展示已提交结果。记账由 RunResultCommitter 按 runId 防重，面板可反复打开。 */

import type Phaser from 'phaser'
import type { MetaConfig } from '../metaConfig'
import type { ProfileStore } from '../profile/ProfileStore'
import type { RunInput, SettleOutcome } from '../progress/progress'
import { Button } from '../ui/Button'
import { buildOverlayFrame, type OverlaySink } from '../ui/overlayFrame'
import { OverlayLayer } from '../ui/overlayLayer'
import { SaveStatusBanner } from '../ui/SaveStatusBanner'
import { THEME, fontPx } from '../ui/theme'

/** 宿主（D1 的战斗场景）必须提供这四件事。 */
export interface SettlementHost {
  /** 本局的原始计数。谁统计由宿主决定 —— 见 `run/RunLedger.ts` */
  runInput?(): RunInput
  /** 「重新开始」：宿主重开一局 */
  restart(): void
  /** 「返回主菜单」：宿主切回主菜单 */
  backToMenu(): void
  /** 「去升级」：宿主结束本局并直接打开主菜单里的升级页 */
  goToUpgrade(): void
}

export interface SettlementOverlayOptions {
  scene: Phaser.Scene
  store: ProfileStore
  meta: MetaConfig
  host: SettlementHost
}

const OUTCOME_TEXT: Readonly<Record<RunInput['outcome'], string>> = {
  dead: '阵亡',
  cleared: '通关',
  quit: '主动退出',
}

/** 只暴露一个结果给外面看 */
export interface SettlementResult extends SettleOutcome {
  input: RunInput
  runCoinsEarned: number
  runCoinsSpent: number
  runCoinsConverted: number
}

export class SettlementOverlay {
  private readonly scene: Phaser.Scene
  private readonly store: ProfileStore
  private readonly host: SettlementHost

  private opened = false
  private settled: SettlementResult | null = null
  /** 这一屏的所有显示对象（**含控件内部那些**），顺序 = 创建顺序，见 `ui/overlayLayer.ts` */
  private parts: Phaser.GameObjects.GameObject[] = []
  private objects: Phaser.GameObjects.GameObject[] = []
  private buttons: Button[] = []
  private layer: OverlayLayer | null = null
  private saveBanner: SaveStatusBanner | null = null
  private readonly unsubscribeStore: () => void

  constructor(options: SettlementOverlayOptions) {
    this.scene = options.scene
    this.store = options.store
    this.host = options.host
    this.unsubscribeStore = this.store.subscribe(() => this.saveBanner?.refresh())
  }

  get isOpen(): boolean {
    return this.opened
  }

  /** 上一次结算的结果（币 + 那份输入）。测试场拿它做读数 */
  get lastSettlement(): SettlementResult | null {
    return this.settled
  }

  /** 只展示已提交结果；隐藏、重建、重复展示不会触碰存档。 */
  show(result?: SettlementResult): SettlementResult {
    if (result) this.settled = result
    if (!this.settled) throw new Error('结算面板需要先提交的结果')
    if (this.opened) return this.settled
    this.opened = true
    // 弹层整块要有自己的坐标系：宿主那台相机怎么缩放平移都不该影响它（见 OverlayLayer）
    this.layer ??= new OverlayLayer(this.scene)
    this.rebuild()
    return this.settled
  }

  hide(): void {
    this.opened = false
    this.clear()
  }

  destroy(): void {
    this.clear()
    this.opened = false
    this.unsubscribeStore()
    this.layer?.destroy()
    this.layer = null
  }

  private rebuild(): void {
    this.clear()
    const sink: OverlaySink = {
      track: (obj) => {
        this.objects.push(obj)
        this.parts.push(obj)
      },
      button: (button) => {
        this.buttons.push(button)
        // 控件的内部对象也要一起搬（见 `Button.parts` 的说明）
        this.parts.push(...button.parts)
      },
    }
    const frame = buildOverlayFrame(
      this.scene,
      sink,
      {
        screenWidth: this.scene.scale.width,
        screenHeight: this.scene.scale.height,
        title: '本局结束',
        panelWidth: 560,
        panelHeight: 400,
        // 结算是个死胡同：只有「重新开始」和「返回主菜单」两条路，没有"关闭"。
        showClose: false,
      },
      () => this.host.backToMenu(),
    )

    const s = this.settled
    const input = s?.input

    sink.track(
      this.scene.add
        .text(frame.cx, frame.contentTop, input ? OUTCOME_TEXT[input.outcome] : '—', {
          fontFamily: THEME.font.family,
          fontSize: fontPx(THEME.font.title),
          color: THEME.text.body,
        })
        .setOrigin(0.5, 0),
    )

    const rows = [
      ['到达进度', `第 ${input?.depth ?? 0} 层`],
      ['击杀', `${input?.kills ?? 0}`],
      ['清房', `${input?.clearedRooms ?? 0}`],
      [
        '局内金币',
        `${s?.runCoinsEarned ?? 0} · 花费 ${s?.runCoinsSpent ?? 0} · 折算 +${s?.runCoinsConverted ?? 0}`,
      ],
      ['本次所得', `+${s?.coinsEarned ?? 0} 币`],
      ['当前总计', `${s?.coinsTotal ?? 0} 币`],
    ]
    rows.forEach(([label, value], i) => {
      const y = frame.contentTop + 62 + i * 26
      sink.track(
        this.scene.add.text(frame.contentLeft + 20, y, label, {
          fontFamily: THEME.font.family,
          fontSize: fontPx(THEME.font.body),
          color: THEME.text.dim,
        }),
      )
      sink.track(
        this.scene.add
          .text(frame.cx + 200, y, value, {
            fontFamily: THEME.font.family,
            fontSize: fontPx(THEME.font.body),
            color: THEME.text.body,
          })
          .setOrigin(1, 0),
      )
    })

    sink.track(
      this.scene.add
        .text(frame.cx, frame.cy + 92, '永久解锁与升级不受死亡影响', {
          fontFamily: THEME.font.family,
          fontSize: fontPx(THEME.font.small),
          color: THEME.text.dim,
        })
        .setOrigin(0.5),
    )

    const actions = [
      {
        label: '去升级',
        onClick: () => this.host.goToUpgrade(),
      },
      {
        label: '重新开始',
        onClick: () => this.host.restart(),
      },
      {
        label: '返回主菜单',
        onClick: () => this.host.backToMenu(),
      },
    ] as const
    actions.forEach((action, index) => {
      sink.button(
        new Button(
          this.scene,
          frame.cx + (index - 1) * 166,
          frame.cy + 140,
          action.label,
          () => {
            this.hide()
            action.onClick()
          },
          { width: 158, height: 40, fontSize: THEME.font.body },
        ),
      )
    })

    this.saveBanner = new SaveStatusBanner(
      this.scene,
      this.store,
      this.scene.scale.width / 2,
      44,
      this.scene.scale.width,
    )
    this.parts.push(this.saveBanner.root)
    this.layer?.attach(this.parts)
  }

  private clear(): void {
    this.saveBanner?.destroy()
    this.saveBanner = null
    for (const b of this.buttons) b.destroy()
    for (const o of this.objects) o.destroy()
    this.buttons = []
    this.objects = []
    this.parts = []
    this.layer?.detach()
  }
}
