import Phaser from 'phaser'

interface Pulse {
  gfx: Phaser.GameObjects.Graphics
  bornAtMs: number
  x: number
  y: number
  radius: number
  seed: number
}

/** 甩落爆炸的电磁脉冲表现：青蓝扫描环 + 分段电弧，纯绘制、不参与碰撞。 */
export class EmpBlastFx {
  private readonly pool: Pulse[] = []
  private sequence = 0

  constructor(private readonly scene: Phaser.Scene, private readonly capacity = 8) {}

  play(x: number, y: number, radius: number, nowMs: number): void {
    let pulse = this.pool.find((item) => !item.gfx.active)
    if (!pulse) {
      if (this.pool.length >= this.capacity) return
      pulse = {
        gfx: this.scene.add.graphics().setDepth(4650),
        bornAtMs: 0,
        x: 0,
        y: 0,
        radius: 0,
        seed: 0,
      }
      this.pool.push(pulse)
    }
    pulse.bornAtMs = nowMs
    pulse.x = x
    pulse.y = y
    pulse.radius = Math.max(24, radius)
    pulse.seed = this.sequence++ * 0.29
    pulse.gfx.setActive(true).setVisible(true)
  }

  update(nowMs: number): void {
    for (const pulse of this.pool) {
      if (!pulse.gfx.active) continue
      const t = Math.max(0, Math.min(1, (nowMs - pulse.bornAtMs) / 620))
      if (t >= 1) {
        pulse.gfx.clear().setActive(false).setVisible(false)
        continue
      }
      const eased = 1 - (1 - t) * (1 - t)
      const r = pulse.radius * eased
      const alpha = (1 - t) * 0.9
      const g = pulse.gfx.clear()

      // A translucent core reads as an EMP discharge instead of an orange damage decal.
      g.fillStyle(0x2bcbff, alpha * 0.13).fillCircle(pulse.x, pulse.y, Math.max(4, r * 0.45))
      g.lineStyle(4, 0x42e8ff, alpha)
      g.strokeCircle(pulse.x, pulse.y, r)
      g.lineStyle(2, 0xe5ffff, alpha * 0.9)
      g.strokeCircle(pulse.x, pulse.y, Math.max(2, r * 0.62))
      g.lineStyle(1, 0x579bff, alpha * 0.75)
      g.strokeCircle(pulse.x, pulse.y, Math.max(2, r * 0.82))

      // Twelve broken arcs / antenna-like bolts communicate an electromagnetic wave.
      for (let i = 0; i < 12; i++) {
        const angle = i * (Math.PI * 2 / 12) + t * 2.2 + pulse.seed
        const inner = r * (0.76 + (i % 2) * 0.06)
        const outer = r + 10 + (i % 3) * 6
        const x0 = pulse.x + Math.cos(angle) * inner
        const y0 = pulse.y + Math.sin(angle) * inner
        const x1 = pulse.x + Math.cos(angle + 0.1) * outer
        const y1 = pulse.y + Math.sin(angle + 0.1) * outer
        g.lineStyle(i % 3 === 0 ? 3 : 2, i % 3 === 0 ? 0xe5ffff : 0x68c7ff, alpha)
        g.lineBetween(x0, y0, x1, y1)
        if (i % 2 === 0) {
          g.fillStyle(0xd8ffff, alpha * 0.85).fillRect(x1 - 2, y1 - 2, 4, 4)
        }
      }

      const cross = Math.max(3, 12 * (1 - t))
      g.lineStyle(2, 0xf3ffff, alpha * 0.8)
      g.lineBetween(pulse.x - cross, pulse.y, pulse.x + cross, pulse.y)
      g.lineBetween(pulse.x, pulse.y - cross, pulse.x, pulse.y + cross)
    }
  }

  destroy(): void {
    for (const pulse of this.pool) pulse.gfx.destroy()
    this.pool.length = 0
  }
}
