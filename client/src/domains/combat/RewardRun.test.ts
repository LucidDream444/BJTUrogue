import { describe, expect, it } from 'vitest'
import type { RngLike } from '@/core/rng'
import { RewardRun } from './RewardRun'
import type { RewardDef, WeaponId } from './config'

/**
 * 「一间房只给一次强化」这条规矩，在一局几层之后**必须按层算**。
 *
 * 起因是实测逮到的一条死路：`completedRooms` 按 `Room.id` 记，而两层楼**共用同一张
 * 平面图**（房号一模一样）—— 第 1 层打完 `YF604` 之后，第 2 层的 `YF604` 清完
 * `offer()` 直接返回 `null`：三选一不弹、`reward_finished` 不发，
 * 而「亮出下一层入口」正挂在那条事件上 ⇒ **第 2 层打完首领，下楼口不亮**。
 * 详见 `RewardRun.forgetFloor()` 的注释。
 */

/** 一条**能重复选**的强化。判据只关心"有没有选项"，所以效果填个最小的。 */
const def = (id: string): RewardDef => ({
  id,
  name: id,
  description: id,
  weight: 1,
  maxStacks: 0,
  weapons: [],
  requires: [],
  excludes: [],
  effects: [{ stat: 'damage', amount: 1 }],
})

const DEFS = [def('a'), def('b'), def('c')]
const WEAPON: WeaponId = 'pencil'
/** 固定的"随机"：只要权重都是 1，抽出来的就是 `a,b,c` 三个。 */
const rng: RngLike = {
  seed: 1,
  next: () => 0.5,
  between: (min) => min,
  floatBetween: (min) => min,
  pick: (items) => items[0]!,
}

const run = () => new RewardRun(DEFS, rng)

describe('强化账本是按层的（一局几层共用同一张平面图）', () => {
  it('同一层里，一间房只给一次 —— 清完再问就是 `null`', () => {
    const r = run()
    expect(r.offer('YF604', WEAPON, 50, 60)?.length).toBe(3)
    expect(r.choose('a')?.id).toBe('a')
    expect(r.offer('YF604', WEAPON, 50, 60)).toBeNull()
  })

  it('**换层之后同一间房又能给一次** —— 不还这一条，第 2 层整层拿不到强化', () => {
    const r = run()
    r.offer('YF604', WEAPON, 50, 60)
    r.choose('a')
    r.forgetFloor()
    const again = r.offer('YF604', WEAPON, 50, 60)
    expect(again).not.toBeNull()
    // ⚠️ 判据要**数出真的拿到几个选项**，不然「返回了空数组」也会绿 ——
    //    而空数组在三选一那条路上等于"面板不弹"（`reward_finished` 走的是
    //    `reason: 'empty'` 那条分支）。
    expect(again!.length).toBe(3)
  })

  it('换层**不动已选的强化** —— 那是这一局的，不是这一层的', () => {
    const r = run()
    r.offer('YF604', WEAPON, 50, 60)
    r.choose('a')
    r.offer('YF505', WEAPON, 50, 60)
    r.choose('b')
    r.forgetFloor()
    expect([...r.stacks]).toEqual([
      ['a', 1],
      ['b', 1],
    ])
    expect(r.completedRooms.size).toBe(0)
  })

  it('换层会把**没选完的那一份**丢掉 —— 它记的房号属于上一层', () => {
    const r = run()
    r.offer('YF604', WEAPON, 50, 60)
    expect(r.roomId).toBe('YF604')
    r.forgetFloor()
    expect(r.roomId).toBeNull()
    expect(r.offered).toEqual([])
    // 留着的话，新一层的第一间房问不出选项（`offer()` 见到 `roomId !== null` 就返回 null）。
    expect(r.offer('YF601', WEAPON, 50, 60)?.length).toBe(3)
  })

  it('对照：**没换层**时，另一间房本来就该给（判据不是"什么都不给"）', () => {
    const r = run()
    r.offer('YF604', WEAPON, 50, 60)
    r.choose('a')
    expect(r.offer('YF601', WEAPON, 50, 60)?.length).toBe(3)
  })
})