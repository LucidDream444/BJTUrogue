/**
 * 种子的 salt 派生。**纯函数，零依赖。**
 *
 * ---
 *
 * ## 为什么不拿一条随机流用到底
 *
 * 最省事的写法是 `const rng = new Rng(seed)`，然后一路 `rng.between(...)` 取下去。
 * 它有一个**只在改代码时才暴露**的问题：整条流是串起来的，所以在第 3 间房那里
 * 多问一次随机数，后面每一间房的布局都会跟着变。
 *
 * 而「同一个种子 → 同一张地图」这条承诺，恰恰是在**天天改代码**的时候要成立的：
 * 调平衡、加一种障碍物、改个尺寸档位，都会动到某处调用随机数的次数。
 * 一条流下，这些改动会让所有历史种子全部失效 —— 玩家报「种子 12345 有问题」时，
 * 你复跑出来的是另一张图，而且**看不出是哪次改动弄丢的**。
 *
 * salt 派生把流切开：`derive(seed, 'obstacles', 3)` 只受「种子 + 用途 + 房间号」
 * 影响。于是改障碍物生成**不会**动到房间尺寸，两者各自可复现。
 *
 * ## 用途名是字符串，不是数字编号
 *
 * 数字编号（`derive(seed, 0, 3)`）省不了多少事，但加一类用途时容易撞号，
 * 而撞号的后果是**两类东西的随机序列完全相同**（比如每间房的尺寸和它门口的
 * 净空永远同步变化）—— 这不报错，只是地图变得莫名其妙地规整。
 * 字符串走一遍哈希，撞号的概率可以忽略。
 */

import { Rng } from '@/core/rng'

/**
 * 种子派生的**用途**。加一个用途就在这里加一个名字。
 *
 * 命名刻意带 `Salt` 后缀，免得和房间的 `kind` / `DoorKind` 那类概念混起来。
 */
export type SaltName =
  /** 主干教室数取多少 */
  | 'mainCount'
  /** 每间房用几号尺寸档位 */
  | 'sizeTier'
  /** 每间主干教室的宽度用几号档位（与侧室的 `sizeTier` 分开，改一个不动另一个） */
  | 'mainWidth'
  /** 哪些主干教室挂侧室 */
  | 'sideAnchors'
  /** 一间侧室挂在上方还是下方 */
  | 'bands'
  /** 一间房里的课桌排布 */
  | 'desks'
  /** 一间房里的椅子 */
  | 'chairs'
  /** 一间房的刷怪点数 */
  | 'spawnCount'
  /** 一间房里刷怪点的位置 */
  | 'spawnPlaces'

/**
 * FNV-1a 走一遍字符串，再和种子、序号混两轮。
 *
 * 用哈希而不是 `seed + hash(salt) + index` 那种加法：加法下
 * `(salt='a', i=1)` 和 `(salt='b', i=0)` 会算出同一个数（ASCII 相邻 + 序号差一），
 * 于是两类用途在相邻房间上**共用同一个流**。hash 之后不会有这种巧合。
 */
export function deriveSeed(seed: number, salt: SaltName, index = 0): number {
  let h = (0x811c9dc5 ^ (seed >>> 0)) >>> 0
  for (let i = 0; i < salt.length; i++) {
    h = Math.imul(h ^ salt.charCodeAt(i), 0x01000193) >>> 0
  }
  h = Math.imul(h ^ ((index + 0x9e3779b9) >>> 0), 0x85ebca6b) >>> 0
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35) >>> 0
  h ^= h >>> 16
  return h >>> 0
}

/** 为某个用途、某个下标开一条独立的随机流。 */
export function rngFor(seed: number, salt: SaltName, index = 0): Rng {
  return new Rng(deriveSeed(seed, salt, index))
}

/**
 * 从 `items` 里确定性地取一个。
 *
 * ⚠️ `index` 默认 0，所以**同一用途在不同房间上必须显式传房间号**，
 * 否则每间房会取到同一个值（表现是「所有教室的桌子摆得一模一样」）。
 */
export function pickIn<T>(seed: number, salt: SaltName, index: number, items: readonly T[]): T {
  return rngFor(seed, salt, index).pick(items)
}