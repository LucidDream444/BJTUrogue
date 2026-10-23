/**
 * 落地爆炸的半径筛选。**零 Phaser**，node 下可直接单测。
 *
 * ⚠️ **它只筛敌人。** 玩家不在这个列表里 —— 这是刻意的，不是遗漏：
 * 被挣脱的敌人炸到玩家会把「挣脱」这件好事变成惩罚，而这条机制的全部意义
 * 是给被抓住的玩家一个正反馈（规格里专门有一条「玩家在范围内也不掉血」）。
 * 所以这个文件**不接受**玩家坐标，调用方也没法「顺手」把他塞进来。
 *
 * 爆炸**不做视线判定**：隔着课桌的敌人也照炸。理由是它本质上是「一个尸体炸开」，
 * 不是弹道；而且落地那一刻世界刚解冻，多一次寻路查询只会让手感更钝。
 */

import type { Point2 } from './fling'

export interface BlastTarget extends Point2 {
  id: number
  /** 已经死掉的不该被再打一次（调用方传进来的列表里通常已经滤过） */
  alive?: boolean
}

/**
 * 落点 `radius` 内的敌人 id。
 *
 * 判定用「距离 ≤ 半径 + 目标半径」——靶心的距离对胖敌人太苛刻（肉盾半径 40，
 * 擦着边站的它其实半个身子在爆炸里）。
 */
export function targetsInBlast(
  origin: Point2,
  radius: number,
  targets: readonly BlastTarget[],
): number[] {
  const out: number[] = []
  for (const t of targets) {
    if (t.alive === false) continue
    const targetRadius = (t as BlastTarget & { radius?: number }).radius ?? 0
    if (Math.hypot(t.x - origin.x, t.y - origin.y) <= radius + targetRadius) out.push(t.id)
  }
  return out
}
