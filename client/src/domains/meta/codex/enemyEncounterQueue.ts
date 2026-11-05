/** 首次生成 → 物种去重 → 顺序待阅。纯逻辑，不依赖 Phaser 或存储。 */
import type { EnemyKind, GameEvents } from '@/core/events'

export type EncounterKind = EnemyKind | 'first-boss' | 'stage2-boss' | 'heart-demon'

export interface EnemyEncounter {
  /** 跨代际去重的物种身份。 */
  kind: EncounterKind
  /** 本次实际遇到的图鉴页，例如 splitter-2。 */
  entryId: string
}

/** 首领底层沿用肉盾模板，所以必须先认首领、再认普通怪。 */
export function identifyEnemyEncounter(
  event: GameEvents['entity_spawned'],
): EnemyEncounter | null {
  if (event.kind !== 'enemy') return null
  if (event.finalBoss) return { kind: 'heart-demon', entryId: 'heart-demon' }
  if (event.bossStage !== undefined) {
    const kind = event.bossStage === 2 ? 'stage2-boss' : 'first-boss'
    return { kind, entryId: kind }
  }
  if (!event.enemyKind) return null
  return {
    kind: event.enemyKind,
    entryId:
      event.enemyKind === 'splitter' ? `splitter-${event.gen ?? 0}` : event.enemyKind,
  }
}

export class EnemyEncounterQueue {
  private readonly seen: Set<string>
  private readonly pending: EnemyEncounter[] = []
  private reading: EnemyEncounter | null = null

  constructor(seen: readonly string[] = []) {
    this.seen = new Set(seen)
  }

  /** 一种怪物第一次生成就标记，避免同帧其他实例和后续子代重复入队。 */
  discover(event: GameEvents['entity_spawned']): EnemyEncounter | null {
    const encounter = identifyEnemyEncounter(event)
    if (!encounter || this.seen.has(encounter.kind)) return null
    this.seen.add(encounter.kind)
    this.pending.push(encounter)
    return encounter
  }

  get next(): EnemyEncounter | null {
    return this.pending[0] ?? null
  }

  get active(): EnemyEncounter | null {
    return this.reading
  }

  get pendingCount(): number {
    return this.pending.length
  }

  /** 只有玩家按 Tab 时调用；关闭上一页绝不自动打开下一页。 */
  openNext(): EnemyEncounter | null {
    if (this.reading) return this.reading
    this.reading = this.pending.shift() ?? null
    return this.reading
  }

  close(): void {
    this.reading = null
  }
}
