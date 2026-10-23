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
 * 影响。于是改障碍物生成**不会**动到刷怪点、也不会动到关别，各自可复现。
 *
 * ⚠️ 这里原举的例子是「改障碍物生成不会动到**房间尺寸**」—— v5 起房间尺寸
 * **根本不来自种子**（几何画在 `floor-plan.json` 里），拿它当例子会让人以为
 * 尺寸还是抽出来的。要举例就举两个**内容**之间：关别 / 桌椅 / 刷怪点。
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
 * 命名刻意带 `Salt` 后缀，免得和房间的 `kind` 那类概念混起来。
 *
 * ⚠️ 原来还并列举了 `DoorKind` —— 那个类型随 v5 删了（`model/types.ts`），
 * 今天全仓库没有它。
 */
export type SaltName =
  /**
   * 12 间按种子抽关别的教室，各是哪一类（普通 / 精英 / 道具 / 宝箱）。
   *
   * ⚠️ 这里**只用一条流**（`index = 0`，见 `layout.ts` 的洗牌）：
   * 关别是「发一副正好 12 张的牌」，一副牌只有一个洗牌顺序。
   * 按房间号各开一条流会退化成 12 次独立抽签 —— 那正是
   * 「抽出 10 间道具房」的来源。
   */
  | 'roomKind'
  /**
   * 一间房里的**桌椅组**：组数、每组的桌长与位置，连**椅子贴在桌子跨度的哪一格**
   * 都从这条流里抽（见 `obstacles.ts`）。
   *
   * ⚠️ 这里原有一条独立的 `'chairs'`，2026-10-21 删了：**一个消费者都没有**
   * （全仓库 grep 只命中它自己的定义），而椅子本来就跟桌组一起抽 ——
   * 留着它，下一个人会以为椅子另有一条流。
   */
  | 'desks'
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

/**
 * 从一张「值 → 权重」的表里**按权重**抽一个。
 *
 * 权重不必凑成 1：内部归一化，所以配置表里写 `{elite: 2, reward: 3, chest: 2}`
 * 和写 `{elite: 0.28, reward: 0.43, chest: 0.28}` 是同一件事 ——
 * 前者改起来不用担心总和。
 *
 * **顺序敏感**：同一张表里键的先后决定随机数落在哪个区间，所以表是按
 * 配置文件里的书写顺序读的，抽签结果因此可复现（`Object.entries` 对
 * 非数字键保持插入顺序）。调整权重的**数值**会改变分布，
 * 调整**顺序**也会 —— 后者看起来无害，其实等于换了一张表。
 */
export function weightedPickIn<K extends string>(
  seed: number,
  salt: SaltName,
  index: number,
  weights: Readonly<Partial<Record<K, number>>>,
): K {
  const entries = Object.entries(weights) as [K, number][]
  if (entries.length === 0) throw new Error(`weightedPickIn(${salt}): 权重表是空的`)

  let total = 0
  for (const [, w] of entries) total += w
  if (!(total > 0)) throw new Error(`weightedPickIn(${salt}): 权重总和为 ${total}，抽不出东西`)

  const r = rngFor(seed, salt, index).floatBetween(0, total)
  let acc = 0
  for (const [key, w] of entries) {
    acc += w
    if (r < acc) return key
  }
  // 浮点累加可能差一个 ulp 落在总和上。兜底返回最后一个，
  // 而不是抛 —— 这里抛的话，表现是「某个种子画不出地图」，而它其实是取整误差。
  return entries[entries.length - 1]![0]
}