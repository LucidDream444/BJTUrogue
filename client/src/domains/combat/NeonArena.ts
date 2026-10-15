import Phaser from 'phaser'

/** Code-drawn arena: luminous campus paving, observatory gates and restrained ambient motion. */
export class NeonArena {
  private readonly glow: Phaser.GameObjects.Graphics
  private readonly motes: Phaser.GameObjects.Graphics
  private readonly center: { x: number; y: number }
  constructor(
    scene: Phaser.Scene,
    private readonly width: number,
    private readonly height: number,
  ) {
    const w = width,
      h = height,
      cx = w * 0.5,
      cy = h * 0.53
    this.center = { x: cx, y: cy }
    const g = scene.add.graphics().setDepth(-100)
    g.fillStyle(0x060b18).fillRect(0, 0, w, h)
    g.fillGradientStyle(0x142a3d, 0x10172f, 0x080e1b, 0x171c36, 1).fillRoundedRect(
      28,
      28,
      w - 56,
      h - 56,
      24,
    )
    // Large beveled floor panels, alternating subtle tones. The center is uncluttered combat space.
    for (let row = 0; row < 10; row++)
      for (let col = 0; col < 16; col++) {
        const x = 42 + (col * (w - 84)) / 16,
          y = 74 + (row * (h - 138)) / 10,
          pw = (w - 84) / 16 - 3,
          ph = (h - 138) / 10 - 3
        g.fillStyle((row + col) % 2 ? 0x142333 : 0x172b3b, 0.85).fillRect(x, y, pw, ph)
        g.lineStyle(1, 0x48637a, 0.2)
          .lineBetween(x, y, x + pw, y)
          .lineBetween(x, y, x, y + ph)
        g.lineStyle(1, 0x040b16, 0.8).lineBetween(x, y + ph, x + pw, y + ph)
        if ((row * 7 + col) % 11 === 0) g.fillStyle(0x3896ba, 0.32).fillRect(x + 7, y + 5, 14, 2)
      }
    // Border conduits and inlaid paths.
    g.lineStyle(10, 0x03121d, 0.8).strokeRoundedRect(33, 40, w - 66, h - 80, 16)
    g.lineStyle(2, 0x43d9ef, 0.62).strokeRoundedRect(34, 40, w - 68, h - 80, 16)
    g.lineStyle(1, 0x9b6bee, 0.4).strokeRoundedRect(44, 51, w - 88, h - 102, 12)
    for (const y of [h * 0.29, h * 0.77]) {
      g.fillStyle(0x081623, 0.9).fillRect(45, y, w - 90, 18)
      g.fillStyle(0x123b4b).fillRect(45, y + 5, w - 90, 6)
      for (let x = 54; x < w - 54; x += 54) g.fillStyle(0x71eff5, 0.65).fillRect(x, y + 7, 23, 2)
    }
    for (const x of [w * 0.24, w * 0.76]) {
      g.fillStyle(0x0b1728).fillRect(x - 11, 72, 22, h - 142)
      g.lineStyle(1, 0x28738f, 0.65)
        .lineBetween(x - 7, 73, x - 7, h - 73)
        .lineBetween(x + 7, 73, x + 7, h - 73)
    }
    // Central star-core seal.
    g.fillStyle(0x0a1527, 0.95).fillCircle(cx, cy, 149)
    for (const [radius, color, alpha] of [
      [148, 0x387086, 0.5],
      [139, 0x66dff3, 0.4],
      [126, 0x555cac, 0.35],
      [90, 0x1f6080, 0.55],
    ] as const)
      g.lineStyle(2, color, alpha).strokeCircle(cx, cy, radius)
    for (let i = 0; i < 24; i++) {
      const a = (i * Math.PI) / 12
      g.lineStyle(i % 3 === 0 ? 3 : 1, 0x67cbe1, 0.6).lineBetween(
        cx + Math.cos(a) * 130,
        cy + Math.sin(a) * 130,
        cx + Math.cos(a) * 139,
        cy + Math.sin(a) * 139,
      )
    }
    const star = Array.from({ length: 12 }, (_, i) => {
      const a = (i * Math.PI) / 6 - Math.PI / 2,
        r = i % 2 ? 35 : 83
      return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }
    })
    g.fillStyle(0x183951, 0.55)
      .fillPoints(star, true)
      .lineStyle(2, 0x70ddef, 0.55)
      .strokePoints(star, true)
    g.lineStyle(1, 0x6976c6, 0.6).strokeCircle(cx, cy, 33)
    g.fillStyle(0x65e9ff, 0.35).fillCircle(cx, cy, 10)
    // Observatory facade; architectural decoration stays at the map edge.
    for (const x of [64, 310, w - 474, w - 226]) {
      g.fillStyle(0x030916).fillRect(x + 7, 13, 169, 71)
      g.fillStyle(0x182b42).fillRect(x, 7, 169, 64)
      g.fillStyle(0x28415b).fillRect(x - 5, 5, 179, 12)
      g.lineStyle(2, 0x456382, 0.7).strokeRect(x, 17, 169, 54)
      for (let i = 0; i < 5; i++) {
        g.fillStyle(0x060d22).fillRect(x + 12 + i * 30, 26, 22, 33)
        g.fillStyle(i % 2 ? 0x4994b6 : 0x8963b4, 0.8).fillRect(x + 15 + i * 30, 29, 16, 23)
        g.fillStyle(0xbaf5ff, 0.5).fillRect(x + 15 + i * 30, 30, 16, 2)
      }
    }
    const gateX = cx
    g.fillStyle(0x020812).fillRoundedRect(gateX - 92, 3, 184, 81, 14)
    g.lineStyle(4, 0x293e62).strokeRoundedRect(gateX - 89, 4, 178, 78, 12)
    g.lineStyle(2, 0x79e1f3, 0.7).strokeRoundedRect(gateX - 75, 14, 150, 58, 9)
    g.fillGradientStyle(0x285380, 0x285380, 0x091226, 0x091226, 0.8).fillRect(
      gateX - 68,
      21,
      136,
      45,
    )
    scene.add
      .text(gateX, 29, '星 核 校 园', {
        fontFamily: 'Microsoft YaHei',
        fontSize: '18px',
        color: '#b6f5ff',
        stroke: '#0c1730',
        strokeThickness: 4,
      })
      .setOrigin(0.5, 0)
      .setDepth(-80)
    // Crystal pylons provide landmarks; their soft halos don't obscure enemies.
    for (const [x, y, color] of [
      [83, 145, 0x71e6ef],
      [w - 83, 145, 0xa481ff],
      [83, h - 95, 0xa481ff],
      [w - 83, h - 95, 0x71e6ef],
    ] as const) {
      g.fillStyle(0x020814, 0.75).fillEllipse(x + 3, y + 14, 70, 29)
      g.fillStyle(0x29334e).fillEllipse(x, y + 8, 52, 24)
      g.lineStyle(2, 0x4f6585).strokeEllipse(x, y + 8, 52, 24)
      g.fillStyle(color, 0.16).fillCircle(x, y - 12, 32)
      const crystal = [
        { x, y: y - 40 },
        { x: x + 13, y: y - 15 },
        { x, y: y + 6 },
        { x: x - 13, y: y - 15 },
      ]
      g.fillStyle(color, 0.85)
        .fillPoints(crystal, true)
        .lineStyle(1, 0xdffcff, 0.8)
        .strokePoints(crystal, true)
      g.lineStyle(1, 0xf1ffff, 0.7).lineBetween(x, y - 39, x, y + 5)
    }
    for (let x = 150; x < w - 140; x += 158) {
      g.fillStyle(0x243a4e).fillRect(x, h - 55, 78, 17)
      g.fillStyle(0x526579, 0.7).fillRect(x, h - 55, 78, 3)
      g.fillStyle(0x060d1a)
        .fillRect(x + 8, h - 38, 6, 9)
        .fillRect(x + 64, h - 38, 6, 9)
    }
    this.glow = scene.add.graphics().setDepth(-85)
    this.motes = scene.add.graphics().setDepth(-75)
  }
  update(now: number): void {
    const { x, y } = this.center
    this.glow
      .clear()
      .lineStyle(3, 0x5febff, 0.2 + 0.1 * Math.sin(now / 1500))
      .strokeCircle(x, y, 145)
    for (let i = 0; i < 3; i++) {
      const a = now / 9000 + (i * Math.PI * 2) / 3
      this.glow
        .lineStyle(4, 0x55ddee, 0.35)
        .beginPath()
        .arc(x, y, 138, a, a + 0.3)
        .strokePath()
    }
    this.motes.clear()
    for (let i = 0; i < 28; i++) {
      const px = 50 + ((i * 137 + Math.sin(now / 5000 + i) * 12) % (this.width - 100))
      const py =
        90 +
        ((((i * 79 - now / 110) % (this.height - 180)) + (this.height - 180)) % (this.height - 180))
      this.motes
        .fillStyle(i % 3 ? 0x70daff : 0xc39aff, 0.15 + 0.2 * (0.5 + 0.5 * Math.sin(now / 1300 + i)))
        .fillRect(px, py, 2, 2)
    }
  }
}
