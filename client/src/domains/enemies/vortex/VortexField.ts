import type { NightmareCatDef } from '@/core/config'
import type { VortexSnapshot } from '@/core/vortex'
import type { HitRequest } from '@/core/actor/damage'

export interface VortexTarget {
  id: number
  spawnSeq: number
  x: number
  y: number
  radius: number
  alive: boolean
}
export interface VortexDamage extends HitRequest { targetId: number; targetSpawnSeq: number }
interface ActiveVortex {
  snapshot: VortexSnapshot
  center: { x: number; y: number }
  damage: number
  tickMs: number
  lastTick: number
  /** Spawn identity + frame identity protects every pair without limiting the whole field. */
  settledFrames: Map<string, number>
}

/** Bounded fields and phase-anchored ticks. No Phaser, timer, or legacy contact TTL. */
export class VortexField {
  private readonly fields = new Map<number, ActiveVortex>()
  constructor(private readonly capacity: number) {}

  get snapshots(): readonly VortexSnapshot[] {
    return [...this.fields.values()].map((field) => field.snapshot).sort((a, b) => a.fieldId - b.fieldId)
  }

  start(fieldId: number, sourceId: number, ownerId: number, x: number, y: number, nowMs: number, cfg: NightmareCatDef['vortex'], damage: number): VortexSnapshot | null {
    if (this.fields.size >= this.capacity || this.fields.has(fieldId)) return null
    const center = { x, y }
    const snapshot: VortexSnapshot = Object.freeze({
      fieldId, sourceId, ownerId,
      // Consumers retain the started-event reference. Read-only coordinates follow
      // the owner without sending duplicate lifecycle events or changing C1.
      get x() { return center.x },
      get y() { return center.y },
      startedAtMs: nowMs,
      endsAtMs: nowMs + cfg.durationMs,
      damageRadius: cfg.damageRadius,
      pullRadius: cfg.pullRadius,
      pullSpeed: cfg.pullSpeed,
      maxPullSpeed: cfg.maxPullSpeed,
      projectileRadius: cfg.projectileRadius,
      turnRateRadPerSec: cfg.turnRateRadPerSec,
      maxTurnRateRadPerSec: cfg.maxTurnRateRadPerSec,
      rotationSign: cfg.rotationSign,
    })
    this.fields.set(fieldId, { snapshot, center, damage, tickMs: cfg.damageTickMs, lastTick: -1, settledFrames: new Map() })
    return snapshot
  }

  /** Move only with the owner's resolved physical position, never integrate force twice. */
  moveOwner(ownerId: number, x: number, y: number): void {
    for (const field of this.fields.values()) {
      if (field.snapshot.ownerId !== ownerId) continue
      field.center.x = x
      field.center.y = y
    }
  }

  /** Call only from WORLD_STEP. Skipped slots are dropped rather than burst-replayed. */
  step(nowMs: number, frameId: number, targets: readonly VortexTarget[], apply: (request: VortexDamage) => void): void {
    for (const field of [...this.fields.values()].sort((a, b) => a.snapshot.fieldId - b.snapshot.fieldId)) {
      const snapshot = field.snapshot
      if (!this.fields.has(snapshot.fieldId) || nowMs < snapshot.startedAtMs || nowMs >= snapshot.endsAtMs) continue
      // Epsilon only absorbs floating point sums of 1000/Hz, not additional game time.
      const tick = Math.floor((nowMs - snapshot.startedAtMs) / field.tickMs + 1e-9)
      if (tick <= field.lastTick) continue
      field.lastTick = tick
      for (const target of targets) {
        if (!this.fields.has(snapshot.fieldId)) break
        if (!target.alive || target.id === snapshot.ownerId) continue
        if (Math.hypot(target.x - snapshot.x, target.y - snapshot.y) > snapshot.damageRadius + target.radius) continue
        const identity = `${target.id}:${target.spawnSeq}`
        if (field.settledFrames.get(identity) === frameId) continue
        field.settledFrames.set(identity, frameId)
        apply({
          targetId: target.id,
          targetSpawnSeq: target.spawnSeq,
          sourceId: snapshot.sourceId,
          hitKey: `vortex:${snapshot.fieldId}:${tick}`,
          mode: 'tick', sourceKind: 'aoe', amount: field.damage,
          nowMs, frameId,
        })
      }
    }
  }

  removeOwner(ownerId: number): readonly VortexSnapshot[] {
    const removed: VortexSnapshot[] = []
    for (const [id, field] of this.fields) {
      if (field.snapshot.ownerId !== ownerId) continue
      removed.push(field.snapshot)
      this.fields.delete(id)
    }
    return removed
  }

  clear(): readonly VortexSnapshot[] {
    const removed = this.snapshots
    this.fields.clear()
    return removed
  }
}
