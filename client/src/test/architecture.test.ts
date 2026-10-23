/**
 * 架构守卫测试。**它不测功能，它测「约定有没有被违反」。**
 *
 * 为什么需要它：下面每一条的违反方式都是**无声的**——
 * 代码照常跑、测试照常绿、代码评审也看不出来，代价在几周之后才付。
 * 这种约定写在文档里等于没写（`AGENTS.md` 里那几条红线就是这类），
 * 所以用测试钉住。
 *
 * | 守卫 | 违反之后的样子 |
 * |---|---|
 * | `core/` 不依赖 `domains/` | 循环依赖，表现为某个模块初始化顺序一变就 `undefined` |
 * | 纯逻辑不 import `phaser`（传递闭包） | 单测只在 node 环境跑，某天开始报 `document is not defined` |
 * | 资产路径不写在清单之外 | 开发时好好的，改一次目录结构就 404 |
 * | `__placeholder` 不写在 assets 之外 | 真美术到位后真图被白方块**静默覆盖**（§六） |
 * | 产品代码不 import `test/` | 测试场变成产品的运行时依赖（§五明确禁止） |
 * | 平衡数值不写进代码 | 每改一次平衡就得重新构建（§三 红线 2） |
 * | 场子按域分文件夹、只碰自己那个域 | 跨域调用悄悄长出来，某天删一个字段就弄坏**别人文件夹里**的场子 |
 *
 * ## 这个文件自己的约束
 *
 * 它跑在 **node** 环境，**只读文件、不 import 任何被测代码** ——
 * 否则它自己就会成为上面第二条的违反者。
 *
 * ## 注释不算数
 *
 * 所以下面所有扫描都先过一遍 `stripComments()`。这不是洁癖：
 * 这个仓库的注释里**大量引用**配置值、纹理 key、设计数值（那正是注释该干的事），
 * 不剥掉的话守卫会被自己的文档吵死 —— 而一个总在误报的守卫，
 * 下场是被人加一行 `skip` 然后永远失效。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('..', import.meta.url))
const PROJECT = fileURLToPath(new URL('../..', import.meta.url))

/**
 * 显式豁免标记。**必须带理由**，这样它在代码评审里是一句能被反驳的话，
 * 而不是一个静默的开关。
 *
 * 用法：在被豁免的那一行加 `// arch-lint-allow: 理由`。
 */
const ALLOW_MARKER = 'arch-lint-allow'

/** `src/` 下所有 `.ts` 文件（不含 `.d.ts`） */
function listSources(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (!name.endsWith('.ts') || name.endsWith('.d.ts')) continue
      out.push(relative(SRC, full).split('\\').join('/'))
    }
  }
  walk(SRC)
  return out.sort()
}

const SOURCES = listSources()

const FILE_CACHE = new Map<string, string>()
function sourceOf(rel: string): string {
  let hit = FILE_CACHE.get(rel)
  if (hit === undefined) {
    hit = readFileSync(join(SRC, rel), 'utf8')
    FILE_CACHE.set(rel, hit)
  }
  return hit
}

/**
 * 去掉**注释**，留下代码和字符串字面量。
 *
 * 为什么只抹注释、不抹字符串：`'xxx__placeholder'` 这种**正是**要被抓住的东西，
 * 抹掉字符串会把守卫变成瞎子。
 *
 * ## ⚠️ 正则字面量必须单独处理
 *
 * 不处理的话会**反向失效**：像 `/['"][^'"]*\.(png)['"]/` 这种正则里有引号，
 * 朴素扫描器会把那个引号当成字符串开头，于是**从这里往后整份文件的边界全错位**，
 * 甚至把注释里的文字当成代码拼出一条根本不存在的 `import`。
 *
 * 这个坑是真踩过的 —— 它把一个假依赖加进了闭包，报出来的是
 * 「`architecture.test.ts` 依赖了 `ArenaBase`」，而那个文件一个相对 import 都没有。
 *
 * 判断「这个 `/` 是不是正则开头」用通行的启发式：**看前一个非空白字符**。
 * 它是标识符/数字/`)`/`]` 时，`/` 是除号；否则（`=`、`(`、`,`、`:`、
 * `!`、`&`、`|`、`?`、`{`、`;`、行首……）是正则开头。
 */
function stripComments(source: string): string {
  let out = ''
  let i = 0
  const n = source.length

  /** 已输出内容里最后一个非空白字符。行首返回 '' */
  const prevNonSpace = (): string => {
    for (let k = out.length - 1; k >= 0; k--) {
      const ch = out[k]!
      if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') return ch
    }
    return ''
  }

  while (i < n) {
    const c = source[i]!
    const next = source[i + 1]

    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === '/') {
      const prev = prevNonSpace()
      if (prev === '' || '=(,:[!&|?{};+-*%<>~^'.includes(prev)) {
        // 正则字面量：扫到未被转义、且不在字符组里的 `/` 为止
        out += c
        i++
        let inClass = false
        while (i < n) {
          const ch = source[i]!
          if (ch === '\\') {
            out += ch
            i++
            if (i < n) {
              out += source[i]!
              i++
            }
            continue
          }
          if (ch === '[') inClass = true
          else if (ch === ']') inClass = false
          else if (ch === '/' && !inClass) break
          out += ch
          i++
        }
        out += '/'
        i++
        // 标志位（`gimsu`）
        while (i < n && /[a-z]/.test(source[i]!)) {
          out += source[i]!
          i++
        }
        continue
      }
    }
    if (c === '"' || c === "'" || c === '`') {
      out += c
      i++
      while (i < n && source[i] !== c) {
        if (source[i] === '\\') {
          out += source[i]!
          i++
        }
        if (i < n) out += source[i]!
        i++
      }
      out += c
      i++
      continue
    }
    out += c
    i++
  }
  return out
}

const CODE_CACHE = new Map<string, string>()
function codeOf(rel: string): string {
  let hit = CODE_CACHE.get(rel)
  if (hit === undefined) {
    hit = stripComments(sourceOf(rel))
    CODE_CACHE.set(rel, hit)
  }
  return hit
}

/**
 * 去掉被豁免的部分。两种粒度：
 *
 * - **文件级**：标记出现在文件**前 30 行**内 → 整个文件豁免。
 *   用于「这个文件的性质就是数字随便写」，比如造测试替身的工厂。
 * - **行级**：标记在某一行上 → 那一行豁免。
 *
 * 为什么要有文件级：没有它的话，「整个文件都是测试替身」这种文件
 * 得在每一行都贴一次标记，而那些重复的标记会**淹没掉真正需要看的那几条**。
 * 30 行这个数字不神秘：它大致就是「文件头注释 + import 区」的长度，
 * 也就是人会把这类说明写在的位置。
 */
function codeWithoutAllowances(rel: string): string {
  if (isFileExempt(rel)) return ''
  const kept = sourceOf(rel)
    .split('\n')
    .filter((line) => !line.includes(ALLOW_MARKER))
    .join('\n')
  return stripComments(kept)
}

/**
 * 这个文件是否声明了文件级豁免。
 *
 * ⚠️ 读的是**原始源码**（`sourceOf`），不是剥完注释的 `codeOf`。
 * 标记按定义就写在注释里，读剥完注释的版本永远找不到它 ——
 * 那会让豁免机制**看起来在工作，实际完全没生效**，
 * 表现是「加了标记但守卫还在报」。
 */
function isFileExempt(rel: string): boolean {
  if (rel === GUARD_FILE) return false
  return sourceOf(rel)
    .split('\n')
    .slice(0, 30)
    .some((line) => line.includes(ALLOW_MARKER))
}

/**
 * 守卫自己。**它不能扫描自己**：上面这段关于标记的说明里就写着那两个字，
 * 于是文件级豁免会命中守卫自身，而那是没有任何意义的、纯粹的自指。
 */
const GUARD_FILE = 'test/architecture.test.ts'

// ---------------------------------------------------------------- import 图

interface Imp {
  spec: string
  /** `import type` / 整段都是 `type` —— 编译后消失，运行时不产生依赖 */
  typeOnly: boolean
}

function parseImports(code: string): Imp[] {
  const out: Imp[] = []
  const re = /\bimport\s+(type\s+)?([^'"]*?)from\s*['"]([^'"]+)['"]/g
  for (const m of code.matchAll(re)) {
    const clause = m[2] ?? ''
    const brace = /\{([^}]*)\}/.exec(clause)
    const inlineTypeOnly =
      brace !== null &&
      brace[1]!
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .every((s) => s.startsWith('type '))
    out.push({ spec: m[3]!, typeOnly: m[1] !== undefined || inlineTypeOnly })
  }
  return out
}

const IMPORT_CACHE = new Map<string, Imp[]>()
function importsOf(rel: string): Imp[] {
  let hit = IMPORT_CACHE.get(rel)
  if (!hit) {
    hit = parseImports(codeOf(rel))
    IMPORT_CACHE.set(rel, hit)
  }
  return hit
}

/** 相对 / `@/` 说明符 → `src/` 下的路径。外部包（`phaser`、`vitest`…）返回 null */
function resolveSpec(fromRel: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = spec.slice(2)
  else if (spec.startsWith('.')) base = join(dirname(fromRel), spec).split('\\').join('/')
  else return null
  for (const c of [`${base}.ts`, `${base}/index.ts`]) if (SOURCES.includes(c)) return c
  return null
}

/**
 * 从 `start` 出发能到达的所有 `src/` 内文件（含自己）。
 *
 * ⚠️ **跳过 `import type` 的边**：这类 import 编译后完全消失，
 * 运行时不存在这条依赖。不跳的话，一个纯逻辑文件仅仅因为
 * `import type { ... } from './ArenaBase'` 就会被判成依赖了 Phaser ——
 * 而「用类型共享形状、不用代码共享实现」正是这个项目想要的做法。
 */
function closure(start: string): Set<string> {
  const seen = new Set<string>()
  const queue = [start]
  while (queue.length > 0) {
    const cur = queue.pop()!
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const imp of importsOf(cur)) {
      if (imp.typeOnly) continue
      const next = resolveSpec(cur, imp.spec)
      if (next !== null && !seen.has(next)) queue.push(next)
    }
  }
  return seen
}

const NOT_TEST = (rel: string): boolean => !rel.endsWith('.test.ts')

// ---------------------------------------------------------------- 守卫

describe('守卫自身有效', () => {
  it('源文件都被读到了', () => {
    // 没有这一条的话，`listSources()` 返回空数组时**下面所有守卫都会「通过」**。
    // 一个全绿的、什么都没检查的守卫，比没有守卫更糟。
    expect(SOURCES.length).toBeGreaterThan(15)
    expect(SOURCES).toContain('core/time.ts')
    expect(SOURCES).toContain('domains/enemies/EnemySystem.ts')
  })

  it('import 扫描器认得出真的 import', () => {
    // 正向自检：拿两个**确定**有 import 的文件去问扫描器。
    // 只断言「大部分文件都有 import」是不够的 —— 正则坏掉时那种断言会通过。
    const assets = importsOf('core/assets.ts')
    expect(assets.some((i) => i.spec === 'phaser')).toBe(true)

    const system = importsOf('domains/enemies/EnemySystem.ts')
    expect(system.length).toBeGreaterThan(5)
    expect(system.some((i) => i.spec.startsWith('@/core/'))).toBe(true)

    // 反向自检：`core/time.ts` 是**刻意**零依赖的纯逻辑（它要能在 node 下被测）
    expect(importsOf('core/time.ts')).toEqual([])
  })

  it('注释剥掉了，字符串没剥掉', () => {
    // 这一条保证 `stripComments` 不是「把所有东西都抹掉」——
    // 全抹掉的话，下面几条守卫会安静地全绿。
    const code = codeOf('core/actor/Actor.ts')
    expect(code).not.toContain('清单里的逻辑 key') // 注释没了
    expect(code).toContain('PLACEHOLDER_MISSING_KEY') // 标识符还在
    expect(code).toContain('class Actor') // 代码还在
  })

  it('正则字面量没有把扫描器带偏', () => {
    // 这条是上面那个「正则里有引号 → 边界错位 → 拼出一条不存在的 import」
    // 那个真实踩过的坑的回归测试。
    //
    // 用**守卫自己**当样本：它是全仓库里正则最多、引号最多的文件，
    // 而它**一个相对 import 都没有**（它刻意不 import 任何被测代码）。
    // 所以只要扫描器在这里解析出任何能落到 `src/` 里的 import，
    // 那就一定是错位拼出来的。
    for (const imp of importsOf(GUARD_FILE)) {
      expect(resolveSpec(GUARD_FILE, imp.spec)).toBeNull()
    }
    // 而且它确实解析出了那 4 个外部包 —— 否则上面那个循环空转就绿了
    expect(importsOf(GUARD_FILE).map((i) => i.spec)).toEqual([
      'node:fs',
      'node:path',
      'node:url',
      'vitest',
    ])
  })
})

describe('core/ 是共用层，不能依赖任何域', () => {
  it('core 下没有文件 import domains 或 test', () => {
    const bad: string[] = []
    for (const rel of SOURCES.filter((r) => r.startsWith('core/'))) {
      for (const imp of importsOf(rel)) {
        const target = resolveSpec(rel, imp.spec)
        if (target !== null && (target.startsWith('domains/') || target.startsWith('test/'))) {
          bad.push(`${rel} → ${target}`)
        }
      }
    }
    // 违反的后果不是编译错，是**循环依赖**：`core` 被所有域依赖，
    // 一旦它反过来依赖某个域，那个域的模块初始化顺序就变成了隐式约束，
    // 表现为「某个字段偶尔是 undefined」，而且换个 import 顺序就好了。
    expect(bad).toEqual([])
  })
})

describe('纯逻辑不碰 Phaser（传递闭包）', () => {
  it('每个 *.test.ts 的依赖闭包里都没有 phaser', () => {
    const bad: string[] = []
    for (const rel of SOURCES.filter((r) => r.endsWith('.test.ts'))) {
      for (const dep of closure(rel)) {
        if (importsOf(dep).some((i) => i.spec === 'phaser' && !i.typeOnly)) {
          bad.push(`${rel} → ${dep} → phaser`)
        }
      }
    }
    // `vite.config.ts` 把 Vitest 的环境钉死成 `node`。任何一个测试文件的
    // 传递闭包里出现 `phaser`，那个测试就跑不起来，而报错是
    // `document is not defined` 之类的 —— 离真正的原因很远。
    //
    // 用**传递闭包**而不是「文件里有没有写 import phaser」：直接 import 的那层
    // 一眼能看见，真正的坑是间接的 —— 某个纯逻辑文件 import 了一个
    // 顺手 import 了 Phaser 的工具，测试就悄悄坏了。
    expect(bad).toEqual([])
  })
})

describe('资产引用必须走清单（AGENTS.md §六）', () => {
  /** 允许出现资产路径字面量的文件：清单自己和它的加载器 */
  const ASSET_ALLOWED = ['core/assetManifest.ts', 'core/assets.ts']

  it('清单之外没有图片 / 音频的路径字面量', () => {
    const pattern = /['"`][^'"`]*\.(png|jpg|jpeg|webp|ogg|mp3|wav)['"`]/
    const bad = SOURCES.filter((rel) => NOT_TEST(rel) && !ASSET_ALLOWED.includes(rel))
      .map((rel) => ({ rel, hit: pattern.exec(codeWithoutAllowances(rel)) }))
      .filter((x) => x.hit !== null)
      .map((x) => `${x.rel}: ${x.hit![0]}`)
    // 硬编码路径在开发时**永远是对的**（文件就在那儿），只有资源管线换目录、
    // 或者要打包到子路径下时才 404。那时候已经没人记得上下文了。
    expect(bad).toEqual([])
  })

  it('`__placeholder` 只在清单和加载器里出现', () => {
    const bad = SOURCES.filter(
      (rel) => NOT_TEST(rel) && !ASSET_ALLOWED.includes(rel),
    ).filter((rel) => codeWithoutAllowances(rel).includes('__placeholder'))
    // 这条是 §六 里「为什么不用同一个 key」那段话的直接执行：
    // 谁硬编码了 `xxx__placeholder`，就绕过了 `resolveTextureKey()`，
    // 于是真美术到位之后他那条路径拿到的还是白方块 —— 而且不报错。
    //
    // 宁可当场炸，不要三个月后静默。
    expect(bad).toEqual([])
  })
})

describe('`public/` 下的文件不许被 import', () => {
  /**
   * `public/` 里的东西由 Vite **原样拷贝**、不参与打包。指向它的 import 不会报错，
   * 只会被**静默**替换成空模块，终端上只留一行 warning。
   *
   * 这个坑真踩过一次：测试场用 `import.meta.glob('../../public/config/*.json')`
   * 读配置表，三份 JSON 全变成 `undefined`，`parseConfigBundle` 抛在场景 `create()` 里，
   * 表现是「进得去场子、但一片黑、一个敌人也没有」—— 而 `tsc`、ESLint、`npm run build`
   * **全都是干净的**。能通过所有静态检查的失败，只有这种守卫拦得住。
   *
   * 允许的读法：`fetch()` / Phaser 的 loader / 测试里的 `node:fs`
   *（后者写的是 `fileURLToPath(new URL(...))`，不是静态 import，匹配不到）。
   */
  const FORBIDDEN_PUBLIC_IMPORT = [
    /\bfrom\s*['"`][^'"`]*\/public\//,
    /\bimport\s*\(\s*['"`][^'"`]*\/public\//,
    /\bimport\.meta\.glob\s*\(\s*['"`][^'"`]*public\//,
  ]

  it('守卫本身认得出来（别写成永远匹配不到的空守卫）', () => {
    // ⚠️ `IM` 拆开拼是**故意的**：直接写 `import(` 或 `import ... from '…'` 的话，
    // 本文件自己的源码里就出现了一个真的 import 形状，会被上面的 import 扫描器
    // 当成一条依赖边（`守卫自身有效` 里那条「解析出的 import 恰好是这四个包」
    // 立刻就会红）。绕开它，同时照样验到三条正则。
    const IM = 'im' + 'port'
    const target = `'../../public/config/enemies.json'`
    expect(FORBIDDEN_PUBLIC_IMPORT[0].test(`from ${target}`)).toBe(true)
    expect(FORBIDDEN_PUBLIC_IMPORT[1].test(`${IM}(${target})`)).toBe(true)
    expect(FORBIDDEN_PUBLIC_IMPORT[2].test(`${IM}.meta.glob(${target})`)).toBe(true)
    // 反向：正常的相对 import 不该被误伤
    expect(FORBIDDEN_PUBLIC_IMPORT[0].test(`from './DummyPlayer'`)).toBe(false)
  })

  it('没有 import / import.meta.glob 指向 public/', () => {
    const bad = SOURCES.filter((rel) => rel !== GUARD_FILE)
      .map((rel) => {
        const code = codeWithoutAllowances(rel)
        const hit = FORBIDDEN_PUBLIC_IMPORT.map((p) => p.exec(code)).find((m) => m !== null)
        return hit ? `${rel}: ${hit[0]}` : null
      })
      .filter((x): x is string => x !== null)
    expect(bad).toEqual([])
  })
})

describe('测试场不能变成产品的运行时依赖（AGENTS.md §五）', () => {
  it('src/test/ 之外没有文件 import 测试场', () => {
    const bad: string[] = []
    for (const rel of SOURCES.filter((r) => !r.startsWith('test/'))) {
      for (const imp of importsOf(rel)) {
        const target = resolveSpec(rel, imp.spec)
        if (target !== null && target.startsWith('test/')) bad.push(`${rel} → ${target}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('index.html 不引用测试场的入口', () => {
    const html = readFileSync(join(PROJECT, 'index.html'), 'utf8')
    expect(htmlScripts(html)).toEqual(['/src/main.ts'])
  })

  it('test.html 只引用测试场的入口', () => {
    const html = readFileSync(join(PROJECT, 'test.html'), 'utf8')
    // 只看 `<script src>`，**不看整份 HTML**：这两个文件的注释里会互相提到对方
    // （那正是它们该解释的事），全文匹配会把文档当成违规。
    expect(htmlScripts(html)).toEqual(['/src/test/launcherMain.ts'])
  })
})

/** 取 `<script src="...">` 里的 src */
function htmlScripts(html: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/g)) out.push(m[1]!)
  return out
}

/**
 * `arenas/<这个文件夹>` → 它**允许** import 哪个域。
 *
 * 场子按域分文件夹之后，「测试场只许用 D3 的域」这条旧规矩就不成立了：
 * D1 写自己的场子当然要碰 `domains/combat`。真正的规矩变成了
 * **「一个域的场子只许碰自己那个域」** —— 跨域还是要走事件总线。
 *
 * ⚠️ **这张表和豁免清单一样是显式的：加一个文件夹就必须来这里加一行。**
 * 不这么钉的话，新来的场子会安静地什么都 import 得到，
 * 「只走事件总线」就退化成一句没人执行的口号了。
 */
const ARENA_FOLDER_DOMAINS: Record<string, readonly string[]> = {
  D1: ['combat'],
  D2: ['procgen'],
  D3: ['enemies'],
  D4: ['meta'],
  // `joint/` 是**跨域联调**的场子：它的货就是「两个域接在一起」，
  // 所以它按定义要同时碰两个域 —— 放进去任何一边的文件夹都会当场红。
  // ⚠️ 这一行是**例外**，不是先例：新场子照旧按自己的域放；
  // 要来加行的人先问一句「这个场子是不是只为联调存在」。
  joint: ['combat', 'procgen'],
}

/**
 * 测试场的**底座**（`test/` 下不在 `arenas/` 里的那几个共用文件）允许碰的域。
 *
 * 现在只绑 D3 一个：底座是 D3 建的，它要替所有场子造一个 `EnemySystem`。
 * 等别的域真的需要底座替他们造自己的系统时，这条会变成一次需要全员同意的改动
 * —— 那正是它该是的样子。
 */
const HARNESS_DOMAINS: readonly string[] = ['enemies']

/** `test/arenas/D3/basic_hit.ts` → `'D3'`。不在域文件夹里则 `null` */
function arenaFolderOf(rel: string): string | null {
  const m = /^test\/arenas\/([^/]+)\//.exec(rel)
  return m ? m[1]! : null
}

/** 这个源文件（运行时）import 到的域，已去重排序 */
function domainsImportedBy(rel: string): string[] {
  const out = new Set<string>()
  for (const imp of importsOf(rel)) {
    const target = resolveSpec(rel, imp.spec)
    if (target === null) continue
    const m = /^domains\/([^/]+)\//.exec(target)
    if (m) out.add(m[1]!)
  }
  return [...out].sort()
}

describe('域之间只走事件总线（AGENTS.md §四）', () => {
  it('测试场的底座只依赖共用层和 D3 的域', () => {
    const allowed = new Set(HARNESS_DOMAINS)
    const bad = SOURCES.filter((r) => r.startsWith('test/') && !r.startsWith('test/arenas/')).flatMap(
      (rel) =>
        domainsImportedBy(rel)
          .filter((d) => !allowed.has(d))
          .map((d) => `${rel} → domains/${d}/`),
    )
    // 底座必须**只**用 D3 自己的域和共用层。依赖 D1 的战斗实现会让
    // 「底座能跑」变成 D1 的进度问题，而它存在的整个意义就是让 D3
    // 能在 D1 还没开工时先把敌人做完。
    expect(bad).toEqual([])
  })

  it('每个域文件夹里的场子，只许碰自己那个域', () => {
    const bad: string[] = []
    for (const rel of SOURCES) {
      const folder = arenaFolderOf(rel)
      if (folder === null) continue
      const allowed = ARENA_FOLDER_DOMAINS[folder]
      if (allowed === undefined) {
        bad.push(`${rel}：文件夹 ${folder} 不在 ARENA_FOLDER_DOMAINS 表里，加一行`)
        continue
      }
      for (const d of domainsImportedBy(rel)) {
        if (!allowed.includes(d)) {
          bad.push(`${rel} → domains/${d}/（${folder} 的场子只许碰 ${allowed.join(' / ')}）`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('场子必须放进一个域文件夹，顶层只留模板', () => {
    // 顶层的场子绕过了上面那条「只许碰自己那个域」的检查（它没有文件夹），
    // 所以这里把「场子不许放顶层」也钉住。`_` 开头的（模板）不算。
    const loose = SOURCES.filter(
      (rel) =>
        /^test\/arenas\/[^/]+\.ts$/.test(rel) &&
        !(rel.split('/').pop() ?? '').startsWith('_'),
    )
    expect(loose).toEqual([])
  })

  it('磁盘上出现的每个域文件夹都要在表里有条目', () => {
    // 单向的：**表里可以有磁盘上还没有的文件夹**（当初写这张表时 D1/D2/D4 还没开工，
    // 提前写好是为了让「这个文件夹归谁、能碰什么」在有人开工之前就是明确的；
    // 2026-10-21 四个域**都已开工**，但这条单向性留着 —— 下一个开域的照旧先加行），
    // 但**反过来的那个方向不能有**：凭空冒出一个文件夹而表里没它，
    // 那个文件夹里的场子会掉进上一段代码的 `allowed === undefined` 分支
    // —— 那里是故意的，会直接报出来，而不是当成「没限制」放行。
    const onDisk = new Set(SOURCES.map(arenaFolderOf).filter((f): f is string => f !== null))
    expect([...onDisk].filter((f) => !(f in ARENA_FOLDER_DOMAINS))).toEqual([])
    expect(onDisk.has('D3')).toBe(true) // 反向证据：没扫到 D3 的话这条会空转
  })

  it('测试场碰到的每个域都在这张表里（防止表里写错字）', () => {
    // 前面几条都是「不许碰表外的域」。反过来的那种错法也要堵：
    // 表里把 `enemies` 写成 `enemy`，或者某个域被整个漏掉 ——
    // 那时候前面的检查会「通过」，因为它们查的是表，而表是错的。
    const known = new Set([...Object.values(ARENA_FOLDER_DOMAINS).flat(), ...HARNESS_DOMAINS])
    const touched = new Set(
      SOURCES.filter((rel) => rel.startsWith('test/')).flatMap((rel) => domainsImportedBy(rel)),
    )
    expect([...touched].filter((d) => !known.has(d))).toEqual([])
    expect(touched.has('enemies')).toBe(true) // 底座确实在用 D3 的域（反向证据）
  })
})

describe('平衡数值不写进代码（AGENTS.md §三 红线 2）', () => {
  /**
   * 这条**没法**做得滴水不漏 —— 什么算「平衡数值」是判断题。
   *
   * 所以只钉最能自动判定、也最典型的那一类：**把血量 / 速度 / 半径 / 伤害
   * 直接写成数字字面量**。写成 `speed: 200` 而不是从 `spec` 里取，
   * 几乎一定是从配置表里抄了一份出来。
   *
   * 允许 `0` 和 `1`：那是「空值/占位」的习惯写法（`hp = 0` 表示已死、
   * `radius: 0` 表示还没设置），不是从配置表抄来的数。
   *
   * **凡是例外都要带 `// arch-lint-allow: 理由`。** 现在有三处，
   * 都是「一个类自己的默认值」而不是「游戏平衡」——
   * 看下面 `ALLOW_MARKER` 的注释。
   */
  it('敌人域里没有把 hp / speed / radius / damage 写成字面量', () => {
    const pattern =
      /\b(maxHp|hp|speed|radius|damage|cooldownMs|tickMs|windupMs|contactDamagePerTick)\s*[:=]\s*([0-9][0-9_]*(?:\.[0-9]+)?)/
    const bad: string[] = []
    for (const rel of SOURCES.filter((r) => NOT_TEST(r) && r.startsWith('domains/enemies/'))) {
      for (const line of codeWithoutAllowances(rel).split('\n')) {
        const m = pattern.exec(line)
        if (m && m[2] !== '0' && m[2] !== '1') bad.push(`${rel}: ${line.trim()}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('文件级豁免清单是固定的（加一个就必须在这里也写一句）', () => {
    // ⚠️ 这一条是豁免机制**唯一**的刹车。
    //
    // `codeWithoutAllowances()` 对一个声明了文件级豁免的文件返回空串 ——
    // 也就是说那个文件**上面所有守卫都不再看它**。这是个很强的开关，
    // 如果加了标记就没人发现，那它迟早会被贴到一个不该贴的文件上。
    //
    // 钉死成一张显式的表之后，「给某个文件开豁免」这件事必然出现在
    // 一次代码评审里，而且理由写在 `testSupport.ts` 的文件头。
    expect(SOURCES.filter(isFileExempt)).toEqual(['domains/enemies/testSupport.ts'])
  })

  it('敌人表和基线表里的数确实是被读出来的（反向证据）', () => {
    // 上一条只能证明「代码里没写死」，不能证明「代码在读配置」——
    // 两边都空着也能通过。这一条补上另一半：确实有地方在读这些表。
    const system = codeOf('domains/enemies/EnemySystem.ts')
    expect(system).toContain('this.bundle.enemies')
    expect(system).toContain('this.bundle.balance')

    // 而且读的是**字段**而不是整个对象直接当数值用。
    const config = codeOf('core/config.ts')
    expect(config).toContain('export function parseConfigBundle')
    expect(config).toContain('deriveSplitterGeneration')
    expect(config).toContain('deriveTank')
  })
})