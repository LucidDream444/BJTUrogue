/**
 * 测试场目录的**纯逻辑**：文件名 → id、模块表 → 目录、URL 查询串 → 选了哪个场子。
 *
 * ⚠️ **这个文件绝对不能 import Phaser**（连带也不能 import 任何场子）。
 *
 * 它要能在 `node` 环境下被单测（`vitest` 的 environment 被钉死成 `node`，
 * 见 `vite.config.ts`）。一旦它间接 import 了 `ArenaBase`，整条测试就废了 ——
 * 而「目录能不能正确认出四个场子」恰好是**最该被测**的那部分，
 * 因为它的失败模式是「菜单里少了一个场子」，没人会注意到。
 *
 * 所以这里只有类型（`import type`，编译后完全消失）和字符串运算。
 * 真正去摸文件系统的是 `registry.ts`，那一个文件不测。
 */

import type { ArenaDefinition } from './ArenaBase'

/** 启动参数里指定场子的键名：`test.html?arena=tank_grind` */
export const ARENA_QUERY_KEY = 'arena'

/** 菜单场景的 key。`ArenaBase` 按 Esc 会回到它。 */
export const MENU_SCENE_KEY = 'ArenaMenu'

/**
 * 目录条目的**前缀约定**：文件名以 `_` 开头的**不进目录**。
 *
 * 所以 `_ArenaTemplate.ts` 是模板，玩家永远看不到它。
 * 用前缀而不是「一个要手工维护的忽略列表」：加模板的人只要记得加下划线，
 * 而忽略列表是**加新场子时要想起去改**的东西 —— 那种约定一定会漂。
 *
 * ## 它同时是「我的文件夹里想放非场子文件」的唯一出口
 *
 * `registry.ts` 会抓 `arenas/` **及其所有子文件夹**里的每个 `.ts` ——
 * 也就是说**你文件夹里的每个 `.ts` 都会被当成一个场子**，
 * 没有 `arena` 导出就当众抛异常。要在自己文件夹里放工具函数 / 假数据 / 类型文件，
 * 文件名加 `_` 开头即可（`_helpers.ts`）。
 *
 * 不这么做的话，那个文件会在**别人**打开测试页时把整个菜单炸掉 ——
 * 报错还写着别人的名字。
 */
export const TEMPLATE_PREFIX = '_'

/** 一个场子在目录里的样子 */
export interface ArenaEntry extends ArenaDefinition {
  /** 等于文件名去掉扩展名，也是 `?arena=` 的值。**全局唯一**（见 `arenaIdFromPath`） */
  id: string
  /**
   * 来源文件（`glob` 给的那个 key，例如 `./arenas/D3/tank_grind.ts`）。
   *
   * 留着是为了**报错时能指名道姓**：id 重复要说清是哪两个文件撞了
   * （见 `buildRegistry`）。报错说不清位置的话，人会去猜，猜错一次就不信这条报了。
   */
  path: string
}

/** 场子模块必须有的导出。没导出或导出错了会在 `buildRegistry` 里当场炸。 */
export interface ArenaModule {
  arena?: unknown
}

/**
 * `arenas/D3/tank_grind.ts` → `tank_grind`。
 *
 * 只取**最后一段**再剥扩展名，所以 `./arenas/foo.ts` / `/abs/arenas/foo.ts` /
 * `../test/arenas/D3/foo.ts` 都给 `foo` —— 既不假设 glob 会给出哪种前缀，
 * 也不把域文件夹编进 id。
 *
 * ## ⚠️ 代价：文件名必须**全局唯一**，跨域也算
 *
 * id 里没有文件夹，所以 `arenas/D1/basic_hit.ts` 和 `arenas/D3/basic_hit.ts`
 * 会撞成同一个 id。这是**刻意选的**：`?arena=tank_grind` 这种短链接好用，
 * 而「加域前缀」会让每个已有链接都变长、还得记住自己那一长串。
 * 撞了不会静默 —— `buildRegistry` 当场抛，并且把**两个文件**都印出来。
 *
 * 顺带：`?arena=` 的值也就是**文件名**，所以给场子起名时挑个带域色彩的
 * （`d1_weapon_swing` 而不是 `test`），撞不上别人。
 */
export function arenaIdFromPath(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const file = slash >= 0 ? path.slice(slash + 1) : path
  const dot = file.lastIndexOf('.')
  return dot > 0 ? file.slice(0, dot) : file
}

/** 这个 id 该不该进目录（模板不进） */
export function isCataloguedId(id: string): boolean {
  return id.length > 0 && !id.startsWith(TEMPLATE_PREFIX)
}

/**
 * 把 `import.meta.glob` 的结果整理成目录。
 *
 * ## 为什么错的东西要**抛**，不能跳过
 *
 * 跳过一个「导出写错了」的场子，表现是**菜单里少一项**。
 * 少一项不会有人报 bug —— 大家只会以为那个场子还没写。
 * 抛出来的话，下一个打开测试页的人立刻看到是哪个文件、缺了什么。
 *
 * @throws 导出缺失 / 导出不是对象 / id 重复
 */
export function buildRegistry(modules: Record<string, unknown>): ArenaEntry[] {
  const entries: ArenaEntry[] = []

  for (const path of Object.keys(modules).sort()) {
    const id = arenaIdFromPath(path)
    if (!isCataloguedId(id)) continue

    const mod = modules[path] as ArenaModule | undefined
    const def = mod?.arena
    if (!def || typeof def !== 'object') {
      throw new Error(`[test] ${path} 没有导出 \`arena\`（每个场子都要有，见 _ArenaTemplate.ts）`)
    }

    const { displayName, description, scene } = def as Partial<ArenaDefinition>
    if (typeof displayName !== 'string' || displayName.length === 0) {
      throw new Error(`[test] ${path} 的 \`arena.displayName\` 缺失或不是非空字符串`)
    }
    if (typeof description !== 'string' || description.length === 0) {
      throw new Error(`[test] ${path} 的 \`arena.description\` 缺失或不是非空字符串`)
    }
    if (typeof scene !== 'function') {
      throw new Error(`[test] ${path} 的 \`arena.scene\` 不是一个场景类`)
    }

    entries.push({ id, path, displayName, description, scene })
  }

  // id 就是文件名，而场子按域分文件夹之后，**两个域各写一个同名文件是很容易发生的**
  // （`basic_hit` 这种名字 D1 也很有可能选）。所以这条报错必须把**两个路径**都印出来：
  // 只说「id 重复：basic_hit」的话，出事的那个人的第一反应是去翻自己的文件，
  // 而冲突在**别人的文件夹**里 —— 他会找不到，然后把这条报错当成误报。
  const seenAt = new Map<string, string>()
  for (const e of entries) {
    const before = seenAt.get(e.id)
    if (before !== undefined) {
      throw new Error(`[test] 场子 id 重复：${e.id}\n  两个文件：${before}\n            ${e.path}\n  换个文件名即可 —— id 取的是文件名（不含文件夹），见 arenaCatalog.ts`)
    }
    seenAt.set(e.id, e.path)
  }

  return entries
}

/**
 * `location.search` → 想开哪个场子。
 *
 * 返回 `null` 表示**没指定**（开菜单）。指定了但不认识由调用方处理 ——
 * 这个函数不认识目录，只管把字符串摘出来，这样它才能在 node 里被测。
 *
 * 用 `URLSearchParams` 而不是手撕字符串：`?arena=` 会给出空串，
 * `?ARENA=x` 大小写不同，`?arena=foo+bar` 要解码 —— 这些自己写全是坑。
 */
export function parseArenaQuery(search: string): string | null {
  const raw = new URLSearchParams(search).get(ARENA_QUERY_KEY)
  if (raw === null) return null
  const id = raw.trim()
  return id.length > 0 ? id : null
}

/** 目录 → 提示用的 id 列表。**不认识的 id 报错时要把它列出来** */
export function formatArenaIds(entries: readonly ArenaEntry[]): string {
  return entries.map((e) => e.id).join(', ')
}