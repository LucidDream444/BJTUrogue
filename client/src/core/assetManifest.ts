/**
 * 资源清单 —— **纯数据，零依赖**。
 *
 * 为什么和 `assets.ts` 拆成两个文件：清单的消费者里有一个是**纯逻辑**的
 * （`core/config.ts` 要校验配置表里的 `textureKey` 是否存在）。如果把清单和生成占位纹理的代码
 * 放在一起，纯逻辑就被拖进了 Phaser —— 而 `import('phaser')` 在 node 下会直接
 * `ReferenceError: window is not defined`，所有不需要浏览器的单测当场全崩。
 *
 * 所以：**清单（本文件）零依赖；加载与占位生成（`assets.ts`）才允许 import Phaser。**
 *
 * ---
 *
 * ## 占位纹理：为什么用独立 key 而不是「和真图同 key」
 *
 * `[源码]` `gameobjects/graphics/Graphics.js`：`generateTexture(key, w, h)` 在 key 已存在、
 * 且源是 canvas 纹理时，**是往同一张 canvas 上再画一次** —— 不替换、不报错。
 *
 * 「同 key」方案看起来更省事（占位期和正式期共用一个 key，什么都不用解析），但真美术到位后
 * 只要漏掉一道守卫，**真图会被白方块静默覆盖**，而且**只有到接入真美术那天才会发现**。
 *
 * 独立 key 的失败方式相反：谁硬编码了真 key，占位期立刻显示 `__MISSING` 纹理，
 * **开发时当场看得见**。用一次当场报错，换掉一次三个月后的静默失效。
 *
 * 代价是必须走 `resolveTextureKey()`，由 `architecture.test.ts` 的字面量扫描兜住。
 */

export type AssetKind = 'image' | 'spritesheet' | 'audio'

export interface AssetEntry {
  /** 逻辑 key。游戏代码只用它，从不写路径。 */
  key: string
  /** 相对 `public/assets/` 的路径；`kind: 'audio'` 时是**不含扩展名的基名** */
  path: string
  /** `true` = 运行时生成白色方块 / 播放时静默返回，不发起网络加载 */
  placeholder: boolean
  kind: AssetKind
  /** 占位方块的尺寸（也是真图应有的尺寸约定） */
  width?: number
  height?: number
  /** `kind: 'spritesheet'` 时必填 */
  frameWidth?: number
  frameHeight?: number
  /** `kind: 'audio'` 时列出所有格式，按优先级排列（Safari 不支持 ogg） */
  codecs?: readonly string[]
}

/**
 * 命名规范见 `client/public/assets/README.md`（**那份文件是唯一真值，owner 是 D4**）：
 * `<域>_<对象>_<变体>[_<帧号>]`，全小写下划线，按 `sprites/` `audio/sfx/` 分层。
 *
 * ⚠️ 改这里 = 改共用层（`core/`），《人员分工方案》要求全员同意。
 */
export const ASSETS: readonly AssetEntry[] = [
  // ---- 敌人：分裂怪三代。画布由大到小 48 / 32 / 24 ----
  {
    key: 'enemy_splitter_t1_idle',
    path: 'sprites/enemies/enemy_splitter_t1_idle.png',
    placeholder: true,
    kind: 'image',
    width: 48,
    height: 48,
  },
  {
    key: 'enemy_splitter_t2_idle',
    path: 'sprites/enemies/enemy_splitter_t2_idle.png',
    placeholder: true,
    kind: 'image',
    width: 32,
    height: 32,
  },
  {
    key: 'enemy_splitter_t3_idle',
    path: 'sprites/enemies/enemy_splitter_t3_idle.png',
    placeholder: true,
    kind: 'image',
    width: 24,
    height: 24,
  },

  // ---- 敌人：巨型肉盾怪 ----
  {
    key: 'enemy_tank_idle',
    path: 'sprites/enemies/enemy_tank_idle.png',
    placeholder: true,
    kind: 'image',
    width: 96,
    height: 96,
  },

  // ---- 玩家与抛射物（占位期测试场要用，正式资源归 D1 / D4）----
  {
    key: 'player_idle',
    path: 'sprites/player/player_idle.png',
    placeholder: true,
    kind: 'image',
    width: 24,
    height: 24,
  },
  {
    key: 'bullet_default',
    path: 'sprites/projectiles/bullet_default.png',
    placeholder: true,
    kind: 'image',
    width: 8,
    height: 8,
  },

  // ---- 特效 ----
  {
    key: 'fx_spark',
    path: 'sprites/fx/fx_spark.png',
    placeholder: true,
    kind: 'image',
    width: 8,
    height: 8,
  },

  // ---- 音效。path 是不含扩展名的基名，codecs 按优先级排列 ----
  audio('sfx_enemy_splitter_hit', 'audio/sfx/enemies/sfx_enemy_splitter_hit'),
  audio('sfx_enemy_splitter_pop', 'audio/sfx/enemies/sfx_enemy_splitter_pop'),
  audio('sfx_enemy_tank_hit', 'audio/sfx/enemies/sfx_enemy_tank_hit'),
  audio('sfx_enemy_tank_grind', 'audio/sfx/enemies/sfx_enemy_tank_grind'),
  audio('sfx_enemy_tank_windup', 'audio/sfx/enemies/sfx_enemy_tank_windup'),
  audio('sfx_enemy_tank_slam', 'audio/sfx/enemies/sfx_enemy_tank_slam'),
  audio('sfx_enemy_tank_stagger', 'audio/sfx/enemies/sfx_enemy_tank_stagger'),
  audio('sfx_enemy_tank_death', 'audio/sfx/enemies/sfx_enemy_tank_death'),
  audio('sfx_kill_flourish', 'audio/sfx/ui/sfx_kill_flourish'),
]

function audio(key: string, path: string): AssetEntry {
  return { key, path, placeholder: true, kind: 'audio', codecs: ['ogg', 'mp3'] }
}

/**
 * 动画表 —— **占位期不加载也不注册**。
 *
 * 为什么要单独一张表：清单如果只有 `kind: 'image' | 'audio'`，美术交付序列帧时
 * 只改 `placeholder` 是**不生效**的 —— 还得改加载代码（帧尺寸）并新增 `anims.create`。
 * 那就等于「美术丢文件即生效」这句承诺只在单帧资源上成立。
 *
 * 有了这张表，美术交付图集时只需把 `kind` 改成 `'spritesheet'`、填 `frameWidth/frameHeight`，
 * 再加一条动画条目，**加载与注册代码一行不改**。
 */
export interface AnimDef {
  animKey: string
  /** 指向 `ASSETS` 里的 key，且那条必须是 `kind: 'spritesheet'` */
  textureKey: string
  /** 帧序号（`spritesheet` 的第几格） */
  frames: readonly number[]
  /** 每秒播放帧数 */
  frameRate: number
  /** -1 = 无限循环 */
  repeat: number
  yoyo?: boolean
}

export const ANIMS: readonly AnimDef[] = []

export const PLACEHOLDER_SUFFIX = '__placeholder'
/** 真资源加载失败时的统一兜底，一眼能看出「这里缺东西」 */
export const PLACEHOLDER_MISSING_KEY = '__placeholder_missing'

const byKey = new Map<string, AssetEntry>(ASSETS.map((a) => [a.key, a]))

/** 某个 key 在清单里的定义。 */
export function findAsset(key: string): AssetEntry | undefined {
  return byKey.get(key)
}

/** 清单里所有合法的 key。契约测试拿它校验配置表。 */
export function assetKeys(): readonly string[] {
  return ASSETS.map((a) => a.key)
}

/**
 * 把一个**逻辑 key** 解析成当前**实际该用的 texture key**。
 *
 * 游戏代码永远调它，永远不直接写 texture key。
 * 占位期返回 `${key}__placeholder`；真资源到位（`placeholder: false`）后返回 `key` 本身。
 */
export function resolveTextureKey(key: string): string {
  const entry = byKey.get(key)
  if (!entry) return PLACEHOLDER_MISSING_KEY
  if (entry.kind === 'audio') return key
  return entry.placeholder ? key + PLACEHOLDER_SUFFIX : key
}

/** 音效文件的实际 URL（按 codecs 顺序给候选，浏览器挑第一个能播的）。 */
export function audioUrls(entry: AssetEntry): string[] {
  const codecs = entry.codecs ?? ['ogg', 'mp3']
  return codecs.map((c) => `assets/${entry.path}.${c}`)
}

/** 图片文件的实际 URL。 */
export function imageUrl(entry: AssetEntry): string {
  return `assets/${entry.path}`
}