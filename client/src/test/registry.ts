/**
 * 测试场目录的**接线**：把 `arenas/` 目录下的文件抓进来，交给 `arenaCatalog` 整理。
 *
 * ⚠️ **加一个场子不需要改这个文件，也不需要改 `main.ts`、不需要改任何别的文件。**
 * 在 `src/test/arenas/<你的域>/` 下新建一个 `.ts`（抄 `_ArenaTemplate.ts`），
 * 它自动出现在菜单里 —— 这一条是 `AGENTS.md` §五的硬要求，
 * 因为五个域各写各的，谁都不该为了让自己的测试场能跑，去改一个**所有人共用**的文件。
 *
 * 这个文件不写单测（它 import 了 Phaser，而 vitest 跑在 node 环境）。
 * 它的全部逻辑都在 `arenaCatalog.ts` 里，那边有测试。
 */

import { buildRegistry, type ArenaEntry } from './arenaCatalog'

/**
 * 目录内容。**`eager: true` 是必须的。**
 *
 * 懒加载（默认）会给出 `() => import(...)`，于是启动时得先 await 一遍才知道
 * 有哪些场子；而 Phaser 的场景注册是同步的。场子总共只有几个，
 * 全部打进去比拆成异步块省事得多。
 *
 * ## 为什么是 `**` 而不是 `*`
 *
 * 场子按域分文件夹（`arenas/D3/basic_hit.ts`），所以要能往下走一层。
 * `**` 同时匹配「零层」和「任意层」：`arenas/_ArenaTemplate.ts`（模板，在顶层）
 * 和 `arenas/D3/basic_hit.ts` 都会被抓到 —— 模板再被 `_` 前缀规则挡掉，
 * 见 `arenaCatalog.ts`。
 *
 * ⚠️ **别把中间那两个 `*` 减成一个**（那是「只要子文件夹里的」的意思）。
 * 那样 `arenas/` 顶层的 `.ts` 就抓不到了。模板抓不到是**看不出来的**
 * —— 它本来就不进目录，所以这个改动不会当场暴露；
 * 一直到有人往顶层直接丢了个场子，而菜单里没有它。
 * **静默漏掉一个场子，比报错难查一个量级。**
 */
const modules = import.meta.glob('./arenas/**/*.ts', { eager: true }) as Record<string, unknown>

/** 全部场子，按 id 排序（`buildRegistry` 里排的，所以菜单顺序稳定） */
export const ARENAS: readonly ArenaEntry[] = buildRegistry(modules)

/** 按 id 找。找不到返回 `undefined`，由调用方决定怎么报错 */
export function findArena(id: string): ArenaEntry | undefined {
  return ARENAS.find((a) => a.id === id)
}