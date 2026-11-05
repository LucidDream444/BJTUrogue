import Phaser from 'phaser'
import type { BossHazards, BossHazardSnapshot } from '../BossHazards'

/** 单个 Graphics 绘制所有地面技能；没有粒子、贴图、物理体或独立计时器。 */
export class BossHazardView {
  private readonly graphics: Phaser.GameObjects.Graphics
  private destroyed = false
  private readonly onShutdown = (): void => this.destroy()

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly hazards: Pick<BossHazards, 'snapshot'>,
  ) {
    this.graphics = scene.add.graphics().setDepth(-20)
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown)
  }

  /** 与 hazards.update 使用同一个游戏时间；暂停时传入的时间保持不变。 */
  update(nowMs: number): void {
    if (this.destroyed) return
    const g = this.graphics
    g.clear()
    for (const field of this.hazards.snapshot) {
      if (nowMs >= field.expiresMs) continue
      const warning = nowMs < field.activatesMs
      const pulse = 0.65 + Math.sin(nowMs / 100) * 0.25
      if (field.kind === 'line') {
        g.lineStyle(field.width + 6, warning ? 0xffd789 : 0x7136d5, warning ? 0.14 : 0.35)
        g.lineBetween(field.x1, field.y1, field.x2, field.y2)
        g.lineStyle(warning ? 3 : field.width, warning ? 0xffd789 : 0xb885ff, warning ? pulse : 0.6)
        g.lineBetween(field.x1, field.y1, field.x2, field.y2)
        g.lineStyle(2, warning ? 0xfff1be : 0xf2e3ff, 0.9)
        g.lineBetween(field.x1, field.y1, field.x2, field.y2)
        g.fillStyle(warning ? 0xffd789 : 0xe8d0ff, pulse)
        g.fillCircle(field.x1, field.y1, 6)
        g.fillCircle(field.x2, field.y2, 6)
        continue
      }
      if (warning) {
        this.warning(field, nowMs, pulse)
        continue
      }
      if (field.kind === 'acid') {
        g.fillStyle(0x78af27, 0.26).fillCircle(field.x, field.y, field.radius)
        g.lineStyle(3, 0xc4ef50, 0.7).strokeCircle(field.x, field.y, field.radius)
        // 点状图案与水面波纹区分，颜色辨别困难时也能认出酸液。
        g.fillStyle(0xc4ef50, 0.48)
        for (let i = 0; i < 5; i++) {
          const angle = (i * Math.PI * 2) / 5 + 0.3
          const spread = field.radius * 0.52
          g.fillCircle(field.x + Math.cos(angle) * spread, field.y + Math.sin(angle) * spread, 5)
        }
      } else if (field.kind === 'water') {
        g.fillStyle(0x2088c5, 0.24).fillCircle(field.x, field.y, field.radius)
        g.lineStyle(3, 0x86ddff, 0.65).strokeCircle(field.x, field.y, field.radius)
        g.lineStyle(2, 0xa4eaff, 0.55)
        for (let row = -1; row <= 1; row++) {
          const y = field.y + row * field.radius * 0.36
          const half = field.radius * (row === 0 ? 0.65 : 0.5)
          const drift = Math.sin(nowMs / 350 + row) * field.radius * 0.06
          g.beginPath()
          g.moveTo(field.x - half, y)
          g.lineTo(field.x - half / 3, y + drift)
          g.lineTo(field.x + half / 3, y - drift)
          g.lineTo(field.x + half, y)
          g.strokePath()
        }
      } else {
        const remaining = (field.expiresMs - nowMs) / (field.expiresMs - field.activatesMs)
        g.fillStyle(0xff8c42, 0.22 * remaining).fillCircle(field.x, field.y, field.radius)
        g.lineStyle(5, 0xffc185, 0.85 * remaining).strokeCircle(field.x, field.y, field.radius)
        g.lineStyle(2, 0xffe0ae, 0.7 * remaining).strokeCircle(field.x, field.y, field.radius * (1 - remaining * 0.55))
      }
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown)
    if (this.graphics.scene) this.graphics.destroy()
  }

  private warning(field: Exclude<BossHazardSnapshot, { kind: 'line' }>, nowMs: number, pulse: number): void {
    const g = this.graphics
    const progress = Math.max(0, Math.min(1,
      (nowMs - field.createdMs) / Math.max(1, field.activatesMs - field.createdMs),
    ))
    const color = field.kind === 'water' ? 0x86ddff : field.kind === 'acid' ? 0xc4ef50 : 0xff9b73
    g.fillStyle(color, 0.08).fillCircle(field.x, field.y, field.radius)
    g.lineStyle(3, color, pulse).strokeCircle(field.x, field.y, field.radius)
    g.lineStyle(5, color, 0.95)
    g.beginPath()
    g.arc(field.x, field.y, field.radius + 7, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2)
    g.strokePath()
    const marker = Math.min(14, field.radius * 0.2)
    g.lineStyle(3, color, pulse)
    g.lineBetween(field.x - marker, field.y - marker, field.x + marker, field.y + marker)
    g.lineBetween(field.x - marker, field.y + marker, field.x + marker, field.y - marker)
  }
}
