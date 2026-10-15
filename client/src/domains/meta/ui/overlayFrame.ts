/**
 * 弹层的外框：压暗层 + 面板 + 标题 +（可选）关闭按钮 + 底部提示行。
 *
 * ## 为什么值得单独抽出来
 *
 * 主菜单、暂停菜单、以及它们各自的说明 / 设置子弹层，**一共六七处**都是这个形状。
 * 更要命的是它里面藏着一条**踩过的坑**（见下面分层那段）：
 * 每个弹层各写一遍，就等于把那个坑复制六七份，而它复制出来的症状
 * （按钮全部点不中、渲染上还看不出来）根本没法从截图里发现。
 * 抽成一个地方，那个坑只需要在这里讲一次、也只需要在这里修一次。
 *
 * ## ⚠️ 三层怎么叠：靠**创建顺序**，不是深度值
 *
 * ```
 * 宿主自己的画面  →  压暗层（挡住下层点击）  →  弹层自己的控件
 * ```
 *
 * Phaser 的命中判定取"显示列表里最靠后的那个"（`topOnly` 默认开着），
 * 而同深度下列表顺序就是创建顺序。所以这三层天然叠对 —— 前提是
 * **别给压暗层或面板加正的 `setDepth()`**：一加，它们就跑到弹层控件上面去了，
 * 症状是"弹层里的按钮全都点不中"，而且**看起来完全正常**（渲染上也被盖住，
 * 两边又都是深色，截图上都看不出来）。这个坑真踩过，见 `docs/UI规范.md` §三。
 *
 * ## 调用的顺序要求
 *
 * `buildOverlayFrame()` 必须**在宿主画完自己的东西之后**调用，
 * 否则压暗层会挡不住那些后画出来的控件。
 */

import type Phaser from 'phaser'
import { Button } from './Button'
import { THEME, fontPx } from './theme'

/** 收集本次创建的显示对象与控件，交给宿主统一销毁 */
export interface OverlaySink {
  track(obj: Phaser.GameObjects.GameObject): void
  button(button: Button): void
}

export interface OverlayFrameLayout {
  screenWidth: number
  screenHeight: number
  title: string
  panelWidth?: number
  panelHeight?: number
  /** 要不要右上角那个「关闭」按钮。默认要 —— 暂停菜单本体不需要（它有「继续游戏」） */
  showClose?: boolean
}

export interface OverlayFrame {
  cx: number
  cy: number
  panelWidth: number
  panelHeight: number
  /** 内容区左边缘（已经算好内边距） */
  contentLeft: number
  /** 内容区顶部（已经在标题下方） */
  contentTop: number
  /** 底部提示行。**不在所有弹层里都用**，用不到就当它不存在 */
  notice: Phaser.GameObjects.Text
}

export function buildOverlayFrame(
  scene: Phaser.Scene,
  sink: OverlaySink,
  layout: OverlayFrameLayout,
  onClose: () => void,
): OverlayFrame {
  const { screenWidth: W, screenHeight: H } = layout
  // 压暗层。它同时挡掉下层的点击 —— 弹层开着的时候宿主画面还在，它的按钮必须点不到。
  sink.track(scene.add.rectangle(W / 2, H / 2, W, H, THEME.color.dim, 0.55).setInteractive())

  const panelWidth = layout.panelWidth ?? Math.min(W - THEME.space.xl * 2, THEME.overlay.maxWidth)
  const panelHeight = layout.panelHeight ?? Math.min(H - THEME.space.xl * 2, 360)
  const cx = W / 2
  const cy = H / 2

  sink.track(
    scene.add
      .rectangle(cx, cy, panelWidth, panelHeight, THEME.color.panel)
      .setStrokeStyle(2, THEME.color.border),
  )

  sink.track(
    scene.add
      .text(cx, cy - panelHeight / 2 + THEME.space.lg, layout.title, {
        fontFamily: THEME.font.family,
        fontSize: fontPx(THEME.font.heading),
        color: THEME.text.body,
      })
      .setOrigin(0.5),
  )

  if (layout.showClose ?? true) {
    sink.button(
      new Button(scene, cx, cy + panelHeight / 2 - THEME.space.lg - 6, '关闭', onClose, {
        width: 140,
        height: 38,
        fontSize: THEME.font.body,
      }),
    )
  }

  const notice = scene.add
    .text(cx, cy + panelHeight / 2 - THEME.space.sm, '', {
      fontFamily: THEME.font.family,
      fontSize: fontPx(THEME.font.small),
      color: THEME.text.accent,
    })
    .setOrigin(0.5, 1)
  sink.track(notice)

  return {
    cx,
    cy,
    panelWidth,
    panelHeight,
    contentLeft: cx - panelWidth / 2 + THEME.space.lg,
    contentTop: cy - panelHeight / 2 + 70,
    notice,
  }
}
