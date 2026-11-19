import type { ConfigBundle, Difficulty, DifficultyModifiers } from '@/core/config'
import {
  deriveGrabber,
  deriveSplitterGeneration,
  deriveTank,
  roundHalfUp,
} from '@/core/config'
import type { EnemyKind } from '@/core/events'
import { Rng } from '@/core/rng'
import { deriveStats, type CombatConfig } from './config'
const MONSTER_KINDS: readonly EnemyKind[] = [
  'splitter',
  'tank',
  'grabber',
  'sprayer',
  'muscovy',
  'nightmare_cat',
]

export interface MonsterSpawn {
  readonly kind: EnemyKind
  readonly gen: 0
  readonly delayMs: number
}

export interface RoomMonsterPlan {
  readonly pointBudget: number
  readonly pointSpent: number
  readonly units: readonly MonsterSpawn[]
  readonly counts: Readonly<Record<EnemyKind, number>>
  readonly phaseDelayMs: number
  readonly secondPhaseFraction: number
}

/**
 * 把 D2 的房间深度预算换成**本层本难度的怪物点数总预算**。
 *
 * `room.budget` 只表达“离楼梯间多远”；楼层倍率与难度再次缩放它。
 * 单只怪的成本不在这里乘任何东西，保证点数表是稳定面额。
 */
export function roomPointBudget(
  cfg: CombatConfig,
  difficulty: Difficulty,
  roomBudget: number,
  floor: number,
  enemyCountMultiplier: number,
): number {
  if (!Number.isFinite(roomBudget) || roomBudget < 0)
    throw new Error(`房间怪物点数非法：${roomBudget}`)
  if (!Number.isInteger(floor) || floor < 1 || floor > cfg.arena.maxStages)
    throw new Error(`楼层 ${floor} 超出 1..${cfg.arena.maxStages}，房间点数无法计算`)
  if (!Number.isFinite(enemyCountMultiplier) || enemyCountMultiplier < 0)
    throw new Error(`难度 enemyCount 非法：${enemyCountMultiplier}（${difficulty}）`)
  const floorScale = cfg.arena.monsterPointFloorScale[floor - 1]
  if (floorScale === undefined || !Number.isFinite(floorScale) || floorScale <= 0)
    throw new Error(`第 ${floor} 层没有合法的怪物点数倍率`)
  return Math.max(0, roundHalfUp(roomBudget * floorScale * enemyCountMultiplier))
}

/**
 * 楼层是在玩家所选难度之上再叠一层固定成长。
 *
 * 点数预算负责“来多少怪”，这里负责“每只怪有多强”。两者必须分开，
 * 否则后期只能靠堆数量制造难度。第 1 层三个倍率恒为 1。
 */
export function effectiveDifficultyModifiers(
  bundle: ConfigBundle,
  cfg: CombatConfig,
  difficulty: Difficulty,
  floor: number,
): DifficultyModifiers {
  if (!Number.isInteger(floor) || floor < 1 || floor > cfg.arena.maxStages)
    throw new Error(`楼层 ${floor} 超出 1..${cfg.arena.maxStages}，敌人强度无法计算`)
  const base = bundle.difficulty.difficulties[difficulty]
  const hp = cfg.arena.floorEnemyHpScale[floor - 1]
  const damage = cfg.arena.floorEnemyDamageScale[floor - 1]
  const speed = cfg.arena.floorEnemySpeedScale[floor - 1]
  if (hp === undefined || damage === undefined || speed === undefined)
    throw new Error(`第 ${floor} 层缺少敌人强度倍率`)
  return {
    enemyHp: base.enemyHp * hp,
    enemyDamage: base.enemyDamage * damage,
    enemySpeed: base.enemySpeed * speed,
    // 数量轴由 roomPointBudget 单独消费，避免同一层被乘两次。
    enemyCount: base.enemyCount,
  }
}

function weightedPick<T extends { weight: number }>(items: readonly T[], rng: Rng): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0)
  let roll = rng.floatBetween(0, total)
  for (const item of items) {
    roll -= item.weight
    if (roll < 0) return item
  }
  return items[items.length - 1]!
}

/**
 * **一间房**的刷怪计划。
 *
 * 2026-11-13 起采用“怪物点数购买”：
 *
 * 1. 房间先拿到一个固定总点数；
 * 2. 每种怪在 `enemies.json.monsterPoints` 有固定成本；
 * 3. 按权重选当前买得起的怪并立即扣点，点数花完或没有可负担目标时停止。
 *
 * 分裂后的子代、首领本体和首领增援**不再扣房间点数**：它们分别是同一只怪的
 * 战斗阶段、单独首领预算和遭遇机制，而不是房间初始出怪名单。
 */
export function roomPlan(
  bundle: ConfigBundle,
  cfg: CombatConfig,
  difficulty: Difficulty,
  pointBudget: number,
  floor: number,
  seed = cfg.arena.seed,
): RoomMonsterPlan {
  if (!Number.isInteger(pointBudget) || pointBudget < 0)
    throw new Error(`房间怪物点数预算必须是非负整数：${pointBudget}`)
  if (!Number.isInteger(floor) || floor < 1 || floor > cfg.arena.maxStages)
    throw new Error(`楼层 ${floor} 超出 1..${cfg.arena.maxStages}，刷怪计划无法生成`)
  if (!Number.isFinite(seed)) throw new Error(`房间刷怪种子非法：${seed}`)

  const d = bundle.difficulty.difficulties[difficulty]
  const a = cfg.arena
  const costs = Object.fromEntries(
    MONSTER_KINDS.map((kind) => [kind, bundle.enemies.enemies[kind].monsterPoints]),
  ) as Record<EnemyKind, number>
  const candidates = MONSTER_KINDS.flatMap((kind) => {
    if (floor < a.monsterPointUnlockFloors[kind]) return []
    return [{ kind, cost: costs[kind], weight: a.monsterPointWeights[kind] ?? 0 }]
  })
  for (const candidate of candidates)
    if (!Number.isInteger(candidate.cost) || candidate.cost <= 0 || candidate.weight <= 0)
      throw new Error(`怪物点数配置非法：${candidate.kind}`)

  const rng = new Rng(seed >>> 0)
  const counts = Object.fromEntries(MONSTER_KINDS.map((kind) => [kind, 0])) as Record<
    EnemyKind,
    number
  >
  const kinds: EnemyKind[] = []
  let pointSpent = 0
  let splitterPoints = 0
  const splitterCap = pointBudget * a.monsterPointSplitterShareCap

  while (pointSpent < pointBudget) {
    const remaining = pointBudget - pointSpent
    const affordable = candidates.filter((candidate) => candidate.cost <= remaining)
    if (affordable.length === 0) break
    const preferred = affordable.filter(
      (candidate) =>
        candidate.kind !== 'splitter' ||
        splitterPoints + candidate.cost <= splitterCap,
    )
    const pick = weightedPick(preferred.length ? preferred : affordable, rng)
    kinds.push(pick.kind)
    counts[pick.kind]++
    pointSpent += pick.cost
    if (pick.kind === 'splitter') splitterPoints += pick.cost
  }

  const phaseDelayMs = a.phaseBaseMs / d.enemySpeed
  const secondPhaseFraction = a.phaseCountScale
  const immediate = Math.ceil(kinds.length * (1 - secondPhaseFraction))
  const units = kinds.map((kind, i) => ({
    kind,
    gen: 0 as const,
    delayMs: i < immediate ? 0 : phaseDelayMs,
  }))
  return {
    pointBudget,
    pointSpent,
    units,
    counts,
    phaseDelayMs,
    secondPhaseFraction,
  }
}
export function balanceReport(bundle: ConfigBundle, cfg: CombatConfig, difficulty: Difficulty) {
  const d = bundle.difficulty.difficulties[difficulty]
  const tank = deriveTank(bundle.enemies.enemies.tank, d, bundle.balance)
  const grabber = deriveGrabber(bundle.enemies.enemies.grabber, d, bundle.balance)
  const small = deriveSplitterGeneration(
    bundle.enemies.enemies.splitter.generations[0]!,
    d,
    bundle.balance,
  )
  return cfg.weapons.map((w) => {
    const s = deriveStats(bundle.balance, cfg, w, [], new Map())
    const directDps = (s.damage * s.pellets * 1000) / s.cooldownMs
    // One crossing tick is a stated estimate, not a second damage formula used by combat.
    const crossingDps =
      directDps * (1 + bundle.enemies.enemies.tank.frameDamage.bullet.tickDamageRatio)
    return {
      name: w.name,
      ...s,
      directDps,
      tankHp: tank.maxHp,
      smallHp: small.maxHp,
      tankDirectTtk: tank.maxHp / directDps,
      tankOneTickTtk: tank.maxHp / crossingDps,
      smallVolleys: Math.ceil(small.maxHp / s.damage),
      lethalSlams: Math.ceil(bundle.balance.baseline.player.maxHp / tank.slamDamage),
      // 抓取怪：一眼看清「预警窗口里打不打得死」与「要连点几下」「会被咬几口」
      grabberHp: grabber.maxHp,
      grabberPressesToEscape: grabber.pressesToEscape,
      grabberBitesToKillPlayer: grabber.bitesToKillPlayer,
      slamDamage: tank.slamDamage,
    }
  })
}
