/**
 * 结算界面（需求 §4.6 那一支：血量归零 → 结算 → 重新开始 / 返回主菜单）。
 *
 * ## 它只做两件事
 *
 * 1. **把这一局的结果记进档**（发币 + 更新统计）—— 调 `settleRun()`，只此一处；
 * 2. **把结果画出来**给玩家看。
 *
 * 所以它**不订阅任何事件**。谁来判断"这一局结束了"是宿主的事（战斗场景在玩家
 * 血量归零时调 `show()`），这样它就不会卡在 C1 的 `run_ended` 还没定稿上 ——
 * 事件定稿后只是宿主多一行 `bus.on('run_ended', () => settlement.show())`。
 *
 * ## ⚠️ `show()` 是幂等的
 *
 * 加币只能发生一次。玩家死的那一刻可能有好几条路径都想弹结算（血量归零、
 * 落水、超时……），每一条都调一次 `show()` 的话，币会翻倍 —— 而这种 bug
 * 只在"碰巧两条路径同时触发"时出现，测都难测。所以里面有个 `settled` 闸门。
 */

import type Phaser from 'phaser'
import type { MetaConfig } from '../metaConfig'
import type { ProfileStore } from '../profile/ProfileStore'
import { settleRun, type RunInput, type SettleOutcome } from '../progress/progress'
import { Button } from '../ui/Button'
import { buildOverlayFrame, type OverlaySink } from '../ui/overlayFrame'
import { OverlayLayer } from '../ui/overlayLayer'
import { THEME, fontPx } from '../ui/theme'

/** 宿主（D1 的战斗场景）必须提供这四件事。 */
export interface SettlementHost {
  /** 本局的原始计数。谁统计由宿主决定 —— 见 `run/RunLedger.ts` */
  runInput(): RunInput
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
}

export class SettlementOverlay {
  private readonly scene: Phaser.Scene
  private readonly store: ProfileStore
  private readonly meta: MetaConfig
  private readonly host: SettlementHost

  private opened = false
  private settled: SettlementResult | null = null
  /** 这一屏的所有显示对象（**含控件内部那些**），顺序 = 创建顺序，见 `ui/overlayLayer.ts` */
  private parts: Phaser.GameObjects.GameObject[] = []
  private objects: Phaser.GameObjects.GameObject[] = []
  private buttons: Button[] = []
  private layer: OverlayLayer | null = null

  constructor(options: SettlementOverlayOptions) {
    this.scene = options.scene
    this.store = options.store
    this.meta = options.meta
    this.host = options.host
  }

  get isOpen(): boolean {
    return this.opened
  }

  /** 上一次结算的结果（币 + 那份输入）。测试场拿它做读数 */
  get lastSettlement(): SettlementResult | null {
    return this.settled
  }

  /** 结算并显示。**重复调用不会重复加币**（见文件头）。 */
  show(): SettlementResult {
    if (this.opened && this.settled) return this.settled

    const input = this.host.runInput()
    let earned: SettleOutcome = { coinsEarned: 0, coinsTotal: this.store.profile.currency.coins }
    // 加币与写统计一起走 `update()`：它是"先克隆再改、改完才落盘"的那条路，
    // 所以落盘失败也不会留下一个改到一半的档（见 ProfileStore 的三条不变式）。
    this.store.update((draft) => {
      earned = settleRun(draft, this.meta, input)
    })

    this.settled = { ...earned, input }
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

    this.layer?.attach(this.parts)
  }

  private clear(): void {
    for (const b of this.buttons) b.destroy()
    for (const o of this.objects) o.destroy()
    this.buttons = []
    this.objects = []
    this.parts = []
    this.layer?.detach()
  }
}
