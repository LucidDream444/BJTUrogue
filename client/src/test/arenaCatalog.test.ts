/**
 * 测试场目录的纯逻辑测试。**跑在 node 环境**（见 `vite.config.ts`），
 * 所以这个文件里不能出现 Phaser，也不能真的 import 任何场子。
 *
 * 这里测的三件事都有同一个性质：**坏掉之后没人会注意到。**
 *
 * | 函数 | 坏掉的样子 |
 * |---|---|
 * | `arenaIdFromPath` | 菜单里的 id 变成 `tank_grind.ts`，`?arena=tank_grind` 就没用了 |
 * | `buildRegistry` | 菜单里**少一个场子** —— 大家只会以为那个场子还没写 |
 * | `parseArenaQuery` | 直接开某个场子的链接失效，退回菜单（看起来「就是没做」） |
 *
 * 所以这里的用例都是「把那个坏掉的样子钉住」，而不是「把实现抄一遍」。
 */

import { describe, expect, it } from 'vitest'
import {
  ARENA_QUERY_KEY,
  buildRegistry,
  formatArenaIds,
  arenaIdFromPath,
  isCataloguedId,
  parseArenaQuery,
  type ArenaEntry,
} from './arenaCatalog'

/** 造一个形状正确的场子模块。`scene` 只要是个函数就行，这里不 import 真的场景类。 */
function fakeModule(displayName = '假场子', description = '说明') {
  return {
    arena: {
      displayName,
      description,
      scene: class FakeScene {},
    },
  }
}

describe('arenaIdFromPath', () => {
  it('去掉目录和扩展名', () => {
    expect(arenaIdFromPath('./arenas/tank_grind.ts')).toBe('tank_grind')
    expect(arenaIdFromPath('arenas/tank_grind.ts')).toBe('tank_grind')
  })

  it('不假设 glob 给的是哪种路径前缀', () => {
    // Vite 给的是相对路径，但测试里手工传进来的可能是绝对的。
    // 三行结果必须一样，否则「换个调用方式 id 就变了」。
    const variants = [
      './arenas/tank_grind.ts',
      'src/test/arenas/tank_grind.ts',
      '/abs/path/src/test/arenas/tank_grind.ts',
      '..\\arenas\\tank_grind.ts',
    ]
    for (const v of variants) expect(arenaIdFromPath(v)).toBe('tank_grind')
  })

  it('只有最后一个点算扩展名', () => {
    // 场子文件名里出现点不是不可能（`v2.tank.ts`），取错了整条目录都会乱。
    expect(arenaIdFromPath('./arenas/v2.tank.ts')).toBe('v2.tank')
  })

  it('没有扩展名也不炸', () => {
    expect(arenaIdFromPath('./arenas/plain')).toBe('plain')
  })
})

describe('isCataloguedId', () => {
  it('下划线开头的不进目录（模板）', () => {
    expect(isCataloguedId('_ArenaTemplate')).toBe(false)
    expect(isCataloguedId('_anything')).toBe(false)
  })

  it('其它都进', () => {
    expect(isCataloguedId('tank_grind')).toBe(true)
    // 下划线在中间不算 —— 这条容易写错成 `includes('_')`。
    expect(isCataloguedId('tank_grind')).toBe(true)
    expect(isCataloguedId('snake_case_name')).toBe(true)
  })

  it('空 id 不进', () => {
    expect(isCataloguedId('')).toBe(false)
  })
})

describe('buildRegistry', () => {
  it('认出所有非模板场子，按 id 排序', () => {
    const reg = buildRegistry({
      './arenas/tank_grind.ts': fakeModule(),
      './arenas/basic_hit.ts': fakeModule(),
      './arenas/_ArenaTemplate.ts': fakeModule('模板'),
    })
    // 排序是**刻意的**：菜单里的顺序取决于 `Object.keys(glob 结果)` 的顺序，
    // 而那是打包器决定的。不排的话，某次重构之后菜单顺序会莫名变。
    expect(reg.map((e) => e.id)).toEqual(['basic_hit', 'tank_grind'])
  })

  it('模板被排除', () => {
    const reg = buildRegistry({ './arenas/_ArenaTemplate.ts': fakeModule() })
    expect(reg).toEqual([])
  })

  it('id 就是文件名', () => {
    const reg = buildRegistry({ './arenas/swarm_stress.ts': fakeModule() })
    expect(reg[0]!.id).toBe('swarm_stress')
  })

  it('保留元信息', () => {
    const reg = buildRegistry({ './arenas/x.ts': fakeModule('名字', '说明') })
    expect(reg[0]!.displayName).toBe('名字')
    expect(reg[0]!.description).toBe('说明')
    expect(typeof reg[0]!.scene).toBe('function')
  })

  // ---- 下面这些是「写错了要当场炸」的那几条 ----
  //
  // 全都用 `toThrow` 而不是「返回空数组」：跳过一个写错的场子，
  // 表现是菜单里少一项，而少一项不会有人报 bug —— 大家只会以为那个场子还没写。

  it('没导出 arena 就抛，并且指名道姓', () => {
    expect(() => buildRegistry({ './arenas/broken.ts': {} })).toThrow(/broken\.ts/)
  })

  it('导出的不是对象也抛', () => {
    expect(() => buildRegistry({ './arenas/broken.ts': { arena: 'nope' } })).toThrow(/broken\.ts/)
  })

  it('displayName 缺失 / 空串都抛', () => {
    const bad = { arena: { description: '说明', scene: class {} } }
    expect(() => buildRegistry({ './arenas/a.ts': bad })).toThrow(/displayName/)
    const empty = { arena: { displayName: '', description: '说明', scene: class {} } }
    expect(() => buildRegistry({ './arenas/a.ts': empty })).toThrow(/displayName/)
  })

  it('description 缺失也抛', () => {
    const bad = { arena: { displayName: '名字', scene: class {} } }
    expect(() => buildRegistry({ './arenas/a.ts': bad })).toThrow(/description/)
  })

  it('scene 不是类也抛', () => {
    const bad = { arena: { displayName: '名字', description: '说明', scene: {} } }
    expect(() => buildRegistry({ './arenas/a.ts': bad })).toThrow(/scene/)
  })

  it('id 重复要抛', () => {
    // 正常情况下不可能（文件名唯一），但 `import.meta.glob` 的 glob
    // 换个写法就可能同时收到 `./arenas/x.ts` 和 `./arenas/x.tsx` ——
    // 两者的 id 都是 `x`。那时候菜单里会出现两个同名项，点哪个都对，
    // 与其猜不如炸。
    expect(() =>
      buildRegistry({
        './arenas/x.ts': fakeModule(),
        './arenas/x.tsx': fakeModule(),
      }),
    ).toThrow(/重复/)
  })

  it('空目录给空数组，不抛', () => {
    expect(buildRegistry({})).toEqual([])
  })
})

describe('parseArenaQuery', () => {
  it('摘出指定的场子', () => {
    expect(parseArenaQuery('?arena=tank_grind')).toBe('tank_grind')
  })

  it('和其它参数混在一起也能摘出来', () => {
    expect(parseArenaQuery('?debug=1&arena=basic_hit&x=2')).toBe('basic_hit')
    // 参数顺序反过来，结果必须一样
    expect(parseArenaQuery('?arena=basic_hit&debug=1')).toBe('basic_hit')
  })

  it('没写就是 null（意思是「开菜单」）', () => {
    expect(parseArenaQuery('')).toBeNull()
    expect(parseArenaQuery('?other=1')).toBeNull()
  })

  it('写了但是空的，也算没写', () => {
    // `?arena=` 会给出空串。返回 `''` 的话调用方会拿空串去查目录，
    // 查到 undefined 然后报「认不出 ?arena=」—— 用户看到的是自己没写过的东西。
    expect(parseArenaQuery('?arena=')).toBeNull()
    expect(parseArenaQuery('?arena=%20%20')).toBeNull()
  })

  it('前后空格去掉', () => {
    // 从聊天软件里复制链接经常带空格。
    expect(parseArenaQuery('?arena=%20tank_grind%20')).toBe('tank_grind')
  })

  it('参数名是大小写敏感的（认 ARENA_QUERY_KEY 这一个写法）', () => {
    expect(parseArenaQuery('?ARENA=tank_grind')).toBeNull()
    expect(ARENA_QUERY_KEY).toBe('arena')
  })

  it('没有 ? 前缀也能用', () => {
    // `URLSearchParams` 对两种形式都成立，测试里不用假装只有一种。
    expect(parseArenaQuery('arena=basic_hit')).toBe('basic_hit')
  })

  it('重复的 arena 参数取第一个', () => {
    // 不是「随便取一个」—— 取第一个是 `URLSearchParams.get` 的既定行为，
    // 这里把它钉住，免得将来换实现时悄悄变成取最后一个。
    expect(parseArenaQuery('?arena=a&arena=b')).toBe('a')
  })
})

describe('formatArenaIds', () => {
  it('列出 id，逗号分隔', () => {
    const reg = buildRegistry({
      './arenas/a.ts': fakeModule(),
      './arenas/b.ts': fakeModule(),
    }) as ArenaEntry[]
    expect(formatArenaIds(reg)).toBe('a, b')
  })

  it('空目录给出空串而不是报错', () => {
    // 调用点是「认不出 ?arena=xxx 时把可用列表印出来」。
    // 空目录已经由菜单另外处理（那是 glob 路径写错了），这里不该再炸一次。
    expect(formatArenaIds([])).toBe('')
  })
})