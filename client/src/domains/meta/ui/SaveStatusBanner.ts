import Phaser from 'phaser'
import type { ProfileStore } from '../profile/ProfileStore'
import { Button } from './Button'
import { THEME, fontPx } from './theme'

/**
 * 存档写入失败的全局提示。
 *
 * 它只消费 `ProfileStore.lastError`，不自己判断存储类型。以后接云存档时，
 * “本地写入失败”和“已保存但尚未上传”可以复用同一块提示区域，但两条状态必须
 * 分开：本地没写成功时不能显示“已保存到云端”。
 */
export class SaveStatusBanner {
  readonly root: Phaser.GameObjects.Container
  private readonly title: Phaser.GameObjects.Text
  private readonly detail: Phaser.GameObjects.Text
  private readonly retry: Button
  private readonly width: number

  constructor(
    scene: Phaser.Scene,
    private readonly store: ProfileStore,
    x: number,
    y: number,
    screenWidth: number,
  ) {
    this.width = Math.max(280, Math.min(560, screenWidth - 32))
    this.root = scene.add.container(x, y).setVisible(false)

    const panel = scene.add
      .rectangle(0, 0, this.width, 68, THEME.color.panel, 0.98)
      .setStrokeStyle(2, THEME.color.danger)
    this.title = scene.add.text(-this.width / 2 + THEME.space.md, -22, '⚠ 存档未保存', {
      fontFamily: THEME.font.family,
      fontSize: fontPx(THEME.font.heading),
      color: THEME.text.danger,
    })
    this.detail = scene.add.text(
      -this.width / 2 + THEME.space.md,
      4,
      '',
      {
        fontFamily: THEME.font.family,
        fontSize: fontPx(THEME.font.small),
        color: THEME.text.body,
        wordWrap: { width: this.width - 154 },
      },
    )
    this.retry = new Button(
      scene,
      this.width / 2 - 62,
      0,
      '重试保存',
      () => this.retrySave(),
      { width: 104, height: 36, fontSize: THEME.font.small },
    )
    this.root.add([panel, this.title, this.detail, ...this.retry.parts])
    this.refresh()
  }

  refresh(retryFailed = false): void {
    const error = this.store.lastError
    const visible = error !== null
    this.root.setVisible(visible)
    // 即使容器隐藏，也不让不可见的“重试保存”截获顶部点击。
    this.retry.setDisabled(!visible)
    if (error === null) return
    this.detail.setText(
      retryFailed
        ? `重试仍未成功。刷新或关闭页面可能丢失本次改动：${error}`
        : `本次改动只在当前页面有效，刷新或关闭页面可能丢失：${error}`,
    )
  }

  destroy(): void {
    this.root.destroy(true)
  }

  private retrySave(): void {
    this.refresh(!this.store.save())
  }
}
