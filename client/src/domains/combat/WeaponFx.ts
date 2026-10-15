import Phaser from 'phaser'
import type { GameClock } from '@/core/time'
import type { WeaponDef, WeaponEffectsConfig, WeaponId } from './config'
import type { WeaponTarget } from './WeaponMechanics'

type Special = Exclude<WeaponId, 'pencil'>
interface Particle {
  alive: boolean
  born: number
  life: number
  x: number
  y: number
  vx: number
  vy: number
  size: number
  spin: number
  kind: Special
}
interface Burst {
  kind: Special
  x: number
  y: number
  born: number
  life: number
  radius: number
  angle: number
  muzzle: boolean
}
interface Beam {
  kind: 'pulse' | 'rail'
  x: number
  y: number
  tx: number
  ty: number
  born: number
  life: number
  seed: number
}
const PALETTE: Record<Special, { core: number; glow: number; accent: number }> = {
  pulse: { core: 0xe6ffff, glow: 0x37dfff, accent: 0x9465ff },
  venom: { core: 0xd6ff91, glow: 0x85ee41, accent: 0xac45ed },
  flare: { core: 0xfff6c7, glow: 0xffad23, accent: 0xff4b18 },
  rail: { core: 0xffffe4, glow: 0xffdd82, accent: 0xb484ff },
  smg: { core: 0xe3ffff, glow: 0x55d5ff, accent: 0x9baaff },
}

/** Bounded procedural particle pool. Every animation uses the pausable gameplay clock. */
export class WeaponFx {
  private readonly glow: Phaser.GameObjects.Graphics
  private readonly ground: Phaser.GameObjects.Graphics
  private readonly ink: Phaser.GameObjects.Graphics
  private readonly particles: Particle[]
  private bursts: Burst[] = []
  private beams: Beam[] = []
  private cursor = 0
  constructor(
    scene: Phaser.Scene,
    private readonly clock: GameClock,
    private readonly cfg: WeaponEffectsConfig,
  ) {
    this.ground = scene.add.graphics().setDepth(2)
    this.ink = scene.add.graphics().setDepth(2500)
    this.glow = scene.add.graphics().setDepth(2501).setBlendMode(Phaser.BlendModes.ADD)
    this.particles = Array.from({ length: cfg.maxParticles }, () => ({
      alive: false,
      born: 0,
      life: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      size: 0,
      spin: 0,
      kind: 'pulse',
    }))
  }
  private scatter(
    kind: Special,
    x: number,
    y: number,
    count: number,
    angle?: number,
    scale = 1,
  ): void {
    for (let i = 0; i < count; i++) {
      const p = this.particles[this.cursor++ % this.particles.length]!
      const a =
        angle === undefined ? Math.random() * Math.PI * 2 : angle + (Math.random() - 0.5) * 1.1
      const speed = this.cfg.particleSpeed * (0.2 + Math.random() * 0.8) * scale
      Object.assign(p, {
        alive: true,
        born: this.clock.nowMs,
        life: this.cfg.particleLifeMs * (0.55 + Math.random() * 0.7),
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        size: (1.5 + Math.random() * 2.6) * Math.max(0.65, scale),
        spin: Math.random() * 6.28,
        kind,
      })
    }
  }
  muzzle(w: WeaponDef, x: number, y: number, angle: number): void {
    if (w.id === 'pencil') return
    this.scatter(w.id, x, y, this.cfg.muzzleParticles, angle, w.id === 'smg' ? 0.65 : 1)
    this.burst({
      kind: w.id,
      x,
      y,
      born: this.clock.nowMs,
      life: Math.min(180, w.effectMs),
      radius: w.id === 'pulse' ? 26 : 18,
      angle,
      muzzle: true,
    })
  }
  trail(w: WeaponDef, x: number, y: number, angle: number): void {
    if (w.id === 'pencil') return
    this.scatter(w.id, x, y, this.cfg.trailParticles, angle + Math.PI, 0.22)
  }
  impact(w: WeaponDef, x: number, y: number, angle: number): void {
    if (w.id === 'pencil') return
    this.scatter(
      w.id,
      x,
      y,
      w.id === 'smg' ? Math.ceil(this.cfg.burstParticles * 0.4) : this.cfg.burstParticles,
      undefined,
      w.id === 'flare' ? 1.35 : 1,
    )
    const radius =
      w.id === 'flare'
        ? w.splashRadius!
        : w.id === 'pulse'
          ? 64
          : w.id === 'venom'
            ? 40
            : w.id === 'rail'
              ? 30
              : 25
    this.burst({
      kind: w.id,
      x,
      y,
      born: this.clock.nowMs,
      life: w.effectMs,
      radius,
      angle,
      muzzle: false,
    })
  }
  private burst(b: Burst): void {
    if (this.bursts.length >= this.cfg.maxBursts) this.bursts.shift()
    this.bursts.push(b)
  }
  beam(kind: Beam['kind'], x: number, y: number, tx: number, ty: number): void {
    if (this.beams.length >= this.cfg.maxBeams) this.beams.shift()
    this.beams.push({
      kind,
      x,
      y,
      tx,
      ty,
      born: this.clock.nowMs,
      life: kind === 'pulse' ? 260 : 180,
      seed: Math.random() * 10,
    })
  }
  poisonTick(t: WeaponTarget): void {
    this.scatter('venom', t.x, t.y, 8, -Math.PI / 2, 0.45)
  }
  draw(statuses: {
    poison: { target: WeaponTarget; remaining: number; duration: number }[]
    chill: WeaponTarget[]
  }): void {
    const now = this.clock.nowMs,
      g = this.glow,
      d = this.ground,
      ink = this.ink
    g.clear()
    d.clear()
    ink.clear()
    this.bursts = this.bursts.filter((b) => now - b.born < b.life)
    for (const b of this.bursts) {
      const t = (now - b.born) / b.life,
        fade = (1 - t) ** 2,
        p = PALETTE[b.kind],
        r = b.radius * (0.2 + 0.8 * Math.sqrt(t))
      if (b.muzzle) {
        g.fillStyle(p.glow, 0.18 * fade).fillCircle(b.x, b.y, r)
        g.lineStyle(3, p.core, fade)
        for (let i = 0; i < 4; i++) {
          const a = b.angle + (i * Math.PI) / 2
          g.lineBetween(
            b.x + Math.cos(a) * 3,
            b.y + Math.sin(a) * 3,
            b.x + Math.cos(a) * r,
            b.y + Math.sin(a) * r,
          )
        }
        continue
      }
      if (b.kind === 'pulse') {
        g.lineStyle(5, p.glow, fade).strokeEllipse(b.x, b.y, r * 2, r * 1.35)
        g.lineStyle(2, p.accent, fade).strokeCircle(b.x, b.y, r * 0.7)
        g.fillStyle(p.glow, 0.11 * fade).fillCircle(b.x, b.y, r)
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3 + t * 1.7
          g.lineStyle(2, p.core, fade).lineBetween(
            b.x + Math.cos(a) * r * 0.35,
            b.y + Math.sin(a) * r * 0.35,
            b.x + Math.cos(a + 0.2) * r,
            b.y + Math.sin(a + 0.2) * r,
          )
        }
      } else if (b.kind === 'venom') {
        d.fillStyle(0x2e143d, 0.35 * fade).fillEllipse(b.x, b.y + 10, r * 2, r)
        g.lineStyle(2, p.accent, fade).strokeEllipse(b.x, b.y + 8, r * 2, r * 0.9)
        for (let i = 0; i < 7; i++) {
          const a = i * 2.4 + t * 3
          const px = b.x + Math.cos(a) * r * 0.7,
            py = b.y + Math.sin(a) * r * 0.4 - t * 20
          g.fillStyle(p.glow, 0.18 * fade).fillCircle(px, py, 8 * (1 - t))
          g.lineStyle(1, p.core, fade * 0.8).strokeCircle(px, py, 4 * (1 - t))
        }
      } else if (b.kind === 'flare') {
        d.fillStyle(0x382012, 0.4 * (1 - t)).fillEllipse(b.x, b.y + 8, r * 1.4, r * 0.7)
        g.fillStyle(p.accent, 0.16 * fade).fillCircle(b.x, b.y, r)
        g.lineStyle(5 * (1 - t) + 1, p.glow, fade).strokeCircle(b.x, b.y, r)
        g.lineStyle(2, p.core, fade).strokeCircle(b.x, b.y, r * 0.78)
        for (let i = 0; i < 10; i++) {
          const a = (i * Math.PI) / 5
          g.lineStyle(3, p.accent, fade).lineBetween(
            b.x + Math.cos(a) * r * 0.72,
            b.y + Math.sin(a) * r * 0.72,
            b.x + Math.cos(a) * r * 1.15,
            b.y + Math.sin(a) * r * 1.15,
          )
        }
      } else if (b.kind === 'rail') {
        g.lineStyle(2, p.glow, fade).strokeCircle(b.x, b.y, r)
        const dx = Math.cos(b.angle),
          dy = Math.sin(b.angle)
        g.lineStyle(3, p.core, fade).lineBetween(
          b.x - dx * r,
          b.y - dy * r,
          b.x + dx * r,
          b.y + dy * r,
        )
        g.lineStyle(1, p.accent, fade).lineBetween(
          b.x - dy * r * 0.7,
          b.y + dx * r * 0.7,
          b.x + dy * r * 0.7,
          b.y - dx * r * 0.7,
        )
      } else {
        g.lineStyle(2, p.glow, fade).strokeCircle(b.x, b.y, r)
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3 + t
          g.lineStyle(2, p.core, fade).lineBetween(
            b.x + Math.cos(a) * r * 0.25,
            b.y + Math.sin(a) * r * 0.25,
            b.x + Math.cos(a) * r,
            b.y + Math.sin(a) * r,
          )
        }
      }
      if (t < 0.25)
        g.fillStyle(p.core, (1 - t * 4) * 0.9).fillCircle(b.x, b.y, Math.max(2, 12 * (1 - t * 4)))
    }
    for (const p of this.particles) {
      if (!p.alive) continue
      const age = now - p.born,
        t = age / p.life
      if (t >= 1) {
        p.alive = false
        continue
      }
      const sec = age / 1000,
        drag = 1 - 0.4 * t
      const x = p.x + p.vx * sec * drag,
        y = p.y + p.vy * sec * drag + (p.kind === 'venom' ? -32 : 24) * sec * sec
      const c = PALETTE[p.kind],
        alpha = (1 - t) ** 1.5,
        size = p.size * (1 - 0.5 * t)
      g.fillStyle(c.glow, alpha * this.cfg.glowAlpha).fillCircle(x, y, size * 2.8)
      if (p.kind === 'venom') {
        ink.fillStyle(c.accent, 0.6 * alpha).fillCircle(x, y, size * 1.3)
        g.lineStyle(1, c.glow, alpha).strokeCircle(x, y, size)
      } else if (p.kind === 'smg' || p.kind === 'rail') {
        const a = p.spin + t * 4,
          dx = Math.cos(a) * size,
          dy = Math.sin(a) * size
        g.fillStyle(c.core, alpha).fillTriangle(
          x + dx * 1.8,
          y + dy * 1.8,
          x - dy,
          y + dx,
          x + dy,
          y - dx,
        )
      } else {
        g.lineStyle(Math.max(1, size * 0.65), c.core, alpha).lineBetween(
          x,
          y,
          x - p.vx * 0.025,
          y - p.vy * 0.025,
        )
      }
    }
    this.beams = this.beams.filter((b) => now - b.born < b.life)
    for (const b of this.beams) {
      const fade = 1 - (now - b.born) / b.life,
        dx = b.tx - b.x,
        dy = b.ty - b.y,
        len = Math.max(1, Math.hypot(dx, dy)),
        c = PALETTE[b.kind]
      for (const [width, alpha, color] of [
        [8, 0.12, c.glow],
        [3, 0.65, c.glow],
        [1, 1, c.core],
      ]) {
        g.lineStyle(width!, color!, alpha! * fade)
          .beginPath()
          .moveTo(b.x, b.y)
        for (let i = 1; i <= 10; i++) {
          const q = i / 10,
            k = b.kind === 'pulse' && i < 10 ? Math.sin(i * 7 + b.seed) * 11 : 0
          g.lineTo(b.x + dx * q - (dy / len) * k, b.y + dy * q + (dx / len) * k)
        }
        g.strokePath()
      }
    }
    for (const { target: t, remaining, duration } of statuses.poison) {
      const r = t.radius + 8,
        phase = now / 430
      d.fillStyle(0x702b9c, 0.2).fillEllipse(t.x, t.y + r * 0.5, r * 2, r * 0.7)
      g.lineStyle(2, 0x98f25a, 0.75)
        .beginPath()
        .arc(
          t.x,
          t.y,
          r,
          -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * Math.max(0, remaining / duration),
        )
        .strokePath()
      for (let i = 0; i < 4; i++) {
        const a = phase + (i * Math.PI) / 2
        g.fillStyle(0xb4ff70, 0.8).fillCircle(
          t.x + Math.cos(a) * r * 0.75,
          t.y + Math.sin(a) * r * 0.5 - 8,
          2.8,
        )
      }
    }
    for (const t of statuses.chill) {
      g.lineStyle(1, 0x9befff, 0.6).strokeEllipse(
        t.x,
        t.y + t.radius * 0.5,
        t.radius * 2.2,
        t.radius,
      )
      for (let i = 0; i < 3; i++) {
        const x = t.x + (i - 1) * 10,
          y = t.y - t.radius - 12 + Math.sin(now / 240 + i) * 2
        g.fillStyle(0xcaffff, 0.9).fillTriangle(x, y - 4, x - 2, y + 3, x + 2, y + 3)
      }
    }
  }
  clear(): void {
    for (const p of this.particles) p.alive = false
    this.bursts = []
    this.beams = []
    this.glow.clear()
    this.ground.clear()
    this.ink.clear()
  }
  destroy(): void {
    this.clear()
    this.glow.destroy()
    this.ground.destroy()
    this.ink.destroy()
  }
}
