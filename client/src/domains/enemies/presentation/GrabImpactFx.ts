import Phaser from 'phaser'

interface Impact {
  gfx: Phaser.GameObjects.Graphics
  bornAtMs: number
  x: number
  y: number
  seed: number
}

/**
 * 抓取 QTE 每次命中的代码特效；贴图只负责笔记本本体。
 *
 * 这是一个可重叠的像素冲击层：厚边框、中心闪白、八向碎片和交错圆环都由
 * Graphics 在运行时绘制，不把任何受击边框烘焙进动作图集。
 */
export class GrabImpactFx {
  private readonly pool: Impact[] = []
  private sequence = 0

  constructor(private readonly scene: Phaser.Scene, private readonly capacity = 24) {}

  play(x: number, y: number, nowMs: number): void {
    let impact = this.pool.find((item) => !item.gfx.active)
    if (!impact) {
      if (this.pool.length >= this.capacity) return
      impact = {
        gfx: this.scene.add.graphics().setDepth(4700),
        bornAtMs: 0,
        x: 0,
        y: 0,
        seed: 0,
      }
      this.pool.push(impact)
    }
    impact.bornAtMs = nowMs
    impact.x = x
    impact.y = y
    impact.seed = this.sequence++ * 0.37
    impact.gfx.setActive(true).setVisible(true)
  }

  update(nowMs: number): void {
    for (const impact of this.pool) {
      if (!impact.gfx.active) continue
      const t = Math.max(0, Math.min(1, (nowMs - impact.bornAtMs) / 220))
      if (t >= 1) {
        impact.gfx.clear().setActive(false).setVisible(false)
        continue
      }
      const ease = 1 - (1 - t) * (1 - t)
      const fade = 1 - t
      const ringRadius = 10 + ease * 20
      const g = impact.gfx.clear()

      // Flashing outline is generated here, rather than stored in the hurt frame.
      g.lineStyle(4, 0xfff3b0, fade * 0.9)
      g.strokeRoundedRect(impact.x - 23 - ease * 2, impact.y - 17 - ease * 2, 46 + ease * 4, 34 + ease * 4, 4)
      g.lineStyle(2, 0xff477e, fade * 0.95)
      g.strokeRoundedRect(impact.x - 27 - ease * 3, impact.y - 20 - ease * 3, 54 + ease * 6, 40 + ease * 6, 5)

      // Two thick rings make rapid QTE presses read as separate impacts.
      g.lineStyle(4, 0xffe36d, fade * 0.85)
      g.strokeCircle(impact.x, impact.y, ringRadius)
      g.lineStyle(2, 0xff5d86, fade * 0.9)
      g.strokeCircle(impact.x, impact.y, Math.max(2, ringRadius * 0.62))

      // Bright pixel core and eight directional shards.
      const core = 3 + (1 - t) * 4
      g.fillStyle(0xffffff, fade * 0.95).fillRect(impact.x - core, impact.y - core, core * 2, core * 2)
      for (let i = 0; i < 8; i++) {
        const angle = i * (Math.PI / 4) + impact.seed
        const wobble = ((i * 17) % 5) - 2
        const inner = ringRadius + 2
        const outer = inner + 8 + (i % 3) * 4 + wobble
        const x0 = impact.x + Math.cos(angle) * inner
        const y0 = impact.y + Math.sin(angle) * inner
        const x1 = impact.x + Math.cos(angle + 0.08) * outer
        const y1 = impact.y + Math.sin(angle + 0.08) * outer
        g.lineStyle(i % 2 === 0 ? 3 : 2, i % 2 === 0 ? 0xfff6c2 : 0xff4f86, fade)
        g.lineBetween(x0, y0, x1, y1)
        g.fillStyle(i % 2 === 0 ? 0xfff6c2 : 0xff4f86, fade * 0.8)
        g.fillRect(x1 - 2, y1 - 2, 4, 4)
      }
    }
  }

  destroy(): void {
    for (const impact of this.pool) impact.gfx.destroy()
    this.pool.length = 0
  }
}
