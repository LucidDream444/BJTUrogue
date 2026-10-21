import type { RngLike } from '@/core/rng'
import type { RewardDef, WeaponId } from './config'
/** Pure run state. No independent timer, damage model or RNG. */
export class RewardRun {
  readonly stacks = new Map<string, number>()
  readonly completedRooms = new Set<string>()
  offered: readonly RewardDef[] = []
  roomId: string | null = null
  constructor(
    readonly defs: readonly RewardDef[],
    readonly rng: RngLike,
  ) {}
  legal(weapon: WeaponId, hp: number, maxHp: number): RewardDef[] {
    return this.defs.filter(
      (r) =>
        (r.maxStacks === 0 || (this.stacks.get(r.id) ?? 0) < r.maxStacks) &&
        (!r.weapons.length || r.weapons.includes(weapon)) &&
        r.requires.every((id) => (this.stacks.get(id) ?? 0) > 0) &&
        !r.excludes.some((id) => (this.stacks.get(id) ?? 0) > 0) &&
        !this.defs.some(
          (other) => (this.stacks.get(other.id) ?? 0) > 0 && other.excludes.includes(r.id),
        ) &&
        (!r.effects.every((e) => e.stat === 'heal') || hp < maxHp),
    )
  }
  offer(
    roomId: string,
    weapon: WeaponId,
    hp: number,
    maxHp: number,
    hasBenefit: (reward: RewardDef) => boolean = () => true,
  ): readonly RewardDef[] | null {
    if (this.roomId !== null || this.completedRooms.has(roomId)) return null
    this.roomId = roomId
    const candidates = this.legal(weapon, hp, maxHp).filter(hasBenefit),
      result: RewardDef[] = []
    while (result.length < 3 && candidates.length) {
      let draw = this.rng.next() * candidates.reduce((s, r) => s + r.weight, 0)
      let index = candidates.length - 1
      for (let i = 0; i < candidates.length; i++) {
        draw -= candidates[i]!.weight
        if (draw < 0) {
          index = i
          break
        }
      }
      result.push(candidates.splice(index, 1)[0]!)
    }
    this.offered = result
    if (!result.length) this.finish()
    return result
  }
  /**
   * **换一层楼**：把「哪几间已经给过强化」这一份作废。**升级本身留着。**
   *
   * ## 为什么必须有它（2026-10-21，实测逮到的）
   *
   * `completedRooms` 是按 **`Room.id`** 记的，而**一局几层共用同一张平面图**
   * （`public/config/floor-plan.json`）—— 第 2 层的 `YF604` 和第 1 层的 `YF604`
   * 是**同一个字符串**。换层不作废的话，第 2 层清完同一间时 `offer()` 直接
   * `return null`（"这间给过了"），于是**三选一根本不弹**：
   *
   * | 谁 | 表现 |
   * |---|---|
   * | 玩家 | 通知栏写着「清怪完成 · 选择一项强化」，而面板永远不出现 |
   * | 成长 | 第 2 层整层**一个强化都拿不到**（房号与第 1 层重合的那些全被吃掉了） |
   * | 关卡 | `reward_finished` 不发 → `BattleScene` 里「亮出下一层入口」那一步不跑 → **下楼口不亮，那一局卡死在第 2 层** |
   *
   * 实测（`reward2.mjs`，真无头浏览器）：第 1 层清完首领 `completedRooms=[]`、
   * 三选一 `lunch,tempo,sharp`；下到第 2 层时账本**原样带着** `["YF604"]`；
   * 第 2 层清完首领 `offered=[]`、`downLit=false`。
   *
   * ⚠️ **`stacks` 绝不能清**：那是这一局攒下来的强化（`deriveStats` 读的就是它），
   * 清了等于"换层把成长全掉了"。
   *
   * ⚠️ 顺手把**没选完的那一份**也丢掉：它记的房号属于**上一层**，留着会让新一层的
   * 第一间房问不出选项（`offer()` 见到 `roomId !== null` 就返回 `null`）。
   * 正常玩法下换层时人动不了、面板不可能开着 —— 这一句管的是"将来某条路绕开了这个前提"。
   */
  forgetFloor(): void {
    this.completedRooms.clear()
    this.roomId = null
    this.offered = []
  }

  choose(id: string): RewardDef | null {
    const r = this.offered.find((r) => r.id === id)
    if (!r || this.roomId === null) return null
    this.stacks.set(id, (this.stacks.get(id) ?? 0) + 1)
    this.finish()
    return r
  }
  private finish(): void {
    if (this.roomId !== null) this.completedRooms.add(this.roomId)
    this.roomId = null
    this.offered = []
  }
}
