/**
 * D2 三个场子共用的那一小段接线。**下划线开头 = 不是测试场**，
 * 所以它不会出现在菜单里（`arenaCatalog.test.ts` 有测试钉着）。
 *
 * 但它仍然在 `test/arenas/D2/` 里，于是 `architecture.test.ts` 那条
 * 「D2 文件夹里的东西只许 import `domains/procgen`」**照样管着它**。
 * 这是应该的 —— 它是 D2 的场子的一部分，不是底座。
 *
 * ---
 *
 * ## 为什么生成地图要包一层，而不是让三个场子各自 `generateDungeon()`
 *
 * 三个场子要的读数是同一组：**配置、地图、耗时**。各自写一遍的话，
 * 「耗时怎么算」会有三个版本 —— 而生成耗时恰恰是这个场子要看的读数之一，
 * 三个版本意味着三个数不可比。取数只有一份，读数才可谈。
 */

import type Phaser from 'phaser'
import { WORLD_HEIGHT, WORLD_WIDTH } from '../../ArenaBase'
import {
  ROOMS_CONFIG_NAME,
  ROOMS_CONFIG_URL,
  roomsConfigFromCache,
  type RoomsConfig,
} from '@/domains/procgen/config'
import type { DungeonMap, Rect, Room } from '@/domains/procgen/model/types'
import { generateDungeon } from '@/domains/procgen/gen/generate'
import { roomViewBox } from '@/domains/procgen/presentation/framing'

/** 换种子时按顺序翻的几张牌。**写死**是为了「同一个种子看到的永远是同一张图」。 */
export const D2_SEEDS = [1, 13, 42, 837, 20261013, 99991] as const

/** 默认种子。`d2_classroom` 挑到的那间房好看不好看，全看它。 */
export const DEFAULT_SEED = D2_SEEDS[3]

export interface ArenaMap {
  map: DungeonMap
  cfg: RoomsConfig
  /** 生成一层楼的真实耗时（ms）。**是读数，不是常量** —— 见文件头。 */
  elapsedMs: number
}

/**
 * 从 Phaser 缓存里取 `rooms.json`，按种子生成一层楼，并量出耗时。
 *
 * 配置取不到时 `roomsConfigFromCache` 会抛 `ConfigError`，
 * 那个错误会被 `ArenaBase.create()` 接住画在屏幕上（见 `showFatal`）——
 * 场景建不起来的时候，空白的画布和「配置写错了」在现场长得一模一样。
 */
export function generateForArena(scene: Phaser.Scene, seed: number): ArenaMap {
  // ⚠️ `scene.cache.json`，不是 `scene.cache` —— `CacheManager` 上没有 `get()`。
  // 读之前先 `exists()`：直接 `get()` 拿到 `undefined` 的话，
  // 报出来的是配置校验器那句「要一个对象，拿到 undefined」，
  // 而它把人指向**配置表写错了**，真正的病因（根本没加载上）一个字都没提。
  if (!scene.cache.json.exists(ROOMS_CONFIG_NAME)) {
    throw new Error(
      `配置表 ${ROOMS_CONFIG_NAME} 没加载上（preload 里 load.json 失败了）。\n` +
        `如果是从 file:// 直接双击打开 html —— 那条路取不到 public/ 下的文件，` +
        `请走 npm run dev 或任意静态服务器。`,
    )
  }
  const cfg = roomsConfigFromCache(scene.cache.json)
  const t0 = performance.now()
  const map = generateDungeon(seed, cfg, () => performance.now())
  return { map, cfg, elapsedMs: performance.now() - t0 }
}

/**
 * 把 `rooms.json` 挂进预加载。场子的 `preload()` 里调它。
 *
 * ⚠️ 必须走 **Phaser 的 loader**，不能 `fetch` —— 场景生命周期保证
 * `create()` 一定在所有加载完成之后才跑，所以 `create()` 里读 `cache.json`
 * 是同步的、一定拿得到。用 `fetch` 的话 `configure()` 会在文件到位之前跑完，
 * 表现是「场子建起来了，但地图是空的」，而控制台一声不吭。
 */
export function loadRoomsConfig(scene: Phaser.Scene): void {
  scene.load.json(ROOMS_CONFIG_NAME, ROOMS_CONFIG_URL)
}

/**
 * 挑一间「拿得出手」的教室给 1:1 场子的场子用。
 *
 * **`d2_classroom` 和 `d2_floorplan` 必须问同一份实现** —— 缩略图上圈出来的
 * 那一间，就是 1:1 场子要走的哪一间。各挑各的话，两块画面对不上，
 * 而「对不上」这件事本身没法判断是挑错了还是生成错了。
 *
 * 尺寸上限**封在这里、不由调用方传**：以前它是两个参数，于是缩略图那边传了
 * `WORLD_HEIGHT − 104`（给读数栏让位）、1:1 那边传整个 `WORLD_HEIGHT` ——
 * 差距正好卡在最大档教室的取景框边界上，**只在特定种子下**暴露成
 * 「两个场子圈的不是同一间」，而那时没人会想到去比对两个常量。
 *
 * 条件，按重要性排：
 *
 * - **档位最大**：这一场要看的是**格子级的对错**（桌子有没有压住门、
 *   红的格子和青的格子错没错开）。房间越大、桌子越多，能看出来的越多；
 *   最小的档位（400 宽）只放得下两三张桌，一场几乎什么都看不出来。
 * - **主干教室**：只有它同时有两扇开向**连廊**的 `v` 门（东、西墙上）
 *   和可能一扇通往侧室的 `h` 门 —— 「门开在哪条边上、门外是连廊还是侧室」
 *   正是要看的东西。侧室自己的门型单一，看不出来。
 * - **放得下**：取景框 1:1 摆进世界之后不能超出，否则会画到屏幕外面去 ——
 *   而画到屏幕外面看起来和「生成器没生成这段墙」一模一样。
 * - **有课桌、有刷怪点**：没有这两样就看不出可走性判定的对错。
 * - **不是起点也不是首领**：起点西边没有连廊（少一扇门），首领的门是终点，
 *   两者的框都不典型。
 *
 * 挑不到就返回 `null`，由场子自己决定怎么报 —— 这里不猜、不兜底。
 */
export function chooseClassroom(map: DungeonMap, cfg: RoomsConfig): Room | null {
  const scored: { room: Room; box: Rect }[] = []
  for (const room of map.rooms) {
    if (room.branch !== 'main') continue
    if (room.kind === 'start' || room.kind === 'boss') continue
    if (!room.obstacles.some((o) => o.kind === 'desk')) continue
    if (room.spawnPoints.length < 2) continue
    const box = roomViewBox(map, cfg, room)
    if (box.width > WORLD_WIDTH || box.height > WORLD_HEIGHT) continue
    scored.push({ room, box })
  }
  if (scored.length === 0) return null
  scored.sort(
    (a, b) =>
      b.room.sizeTier - a.room.sizeTier || // 档位大的优先
      b.room.obstacles.length - a.room.obstacles.length || // 再比障碍物多不多
      a.room.order - b.room.order, // 最后按顺序定死，保证同一个种子挑到同一间
  )
  return scored[0]!.room
}

/**
 * 生成耗时怎么印。
 *
 * **接近 0 的时候必须说清楚**，不能就印一个 `0.0ms` —— 无头浏览器截图走的是
 * `--virtual-time-budget`，虚拟时钟在**同步执行的这一段是冻住的**，
 * 所以 `performance.now()` 量出来恒为 0。裸印一个 `0.0` 会让人以为计时器坏了，
 * 于是转头去查生成器 —— 而生成器根本没毛病。
 *
 * 真浏览器里这个数才作数（生成一层楼是几毫秒这个量级）。
 */
export function elapsedText(ms: number): string {
  return ms < 0.05 ? '<0.1ms（截图用的无头浏览器时钟冻住了，真浏览器里看）' : `${ms.toFixed(1)}ms`
}

/** 一层楼的整体读数。三个场子的抬头都读它，免得各写一份口径。 */
export function summarise(a: ArenaMap): string[] {
  return [
    `seed ${a.map.seed}`,
    `房间 ${a.map.rooms.length}（主干 ${a.map.rooms.filter((r) => r.branch === 'main').length} · 侧室 ${a.map.rooms.filter((r) => r.branch === 'side').length}）`,
    `楼层 ${Math.round(a.map.bounds.width)}×${Math.round(a.map.bounds.height)}px · 生成 ${elapsedText(a.elapsedMs)}`,
  ]
}