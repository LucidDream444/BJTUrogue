/**
 * D2 的场子共用的那一小段接线。**下划线开头 = 不是测试场**，
 * 所以它不会出现在菜单里（`arenaCatalog.test.ts` 有测试钉着）。
 *
 * 但它仍然在 `test/arenas/D2/` 里，于是 `architecture.test.ts` 那条
 * 「D2 文件夹里的东西只许 import `domains/procgen`」**照样管着它**。
 * 这是应该的 —— 它是 D2 的场子的一部分，不是底座。
 *
 * ---
 *
 * ## ⚠️ 下面有六个函数在指着**已经删掉的场子**，那是历史，不是待办
 *
 * 2026-10-19 按用户要求删掉了 `d2_classroom` / `d2_floorplan` / `d2_room_flow` /
 * `d2_seed_sweep` / `joint/d1d2_rooms` 五个场子（菜单里的 2/3/4/5/17），
 * 今天 D2 只剩 `d2_seeds` 一个。**于是这个文件里有一多半的东西暂时没有用户**：
 *
 * | 函数 | 谁原来在用 | 现在 |
 * |---|---|---|
 * | `generateForArena` / `loadProcgenConfigs` / `summarise` / `elapsedText` | 五个场子都读 | **`d2_seeds` 在用** |
 * | `screenRect` / `collisionInBox` / `nearestSpawn` / `chooseClassroom` | 1:1 特写场子（`d2_classroom` / `d2_room_flow`） | 没有用户了 |
 * | `HUD_TOP_LEFT_BOTTOM` / `HUD_HINT_RIGHT` | 同上（摆版面时躲底座 HUD 用的） | 没有用户了 |
 *
 * （`loadRoomsConfig` 是 `loadProcgenConfigs` 的旧名，2026-10-20 跟着 v5 改的 ——
 * 它现在挂**两张**配置表，见那个函数的 ⚠️。）
 *
 * **留着不是忘了删。** 那几个函数每一个都钉着一条**踩过的坑**
 * （`screenRect` 是坐标约定写反、`collisionInBox` 是「筛」与「裁断」的区别、
 * `HUD_TOP_LEFT_BOTTOM` 是按字号推高度推出十几像素误差）——
 * 下一个 1:1 场子（平面图落地之后要重做的那一个）会照着它们写。
 * 而「没有用户」这件事本身是**暂时**的：删掉它们等于把教训连带删掉，
 * 为了让 `lint` 少两条 warning。
 *
 * 下面注释里出现的场子名（`d2_classroom` / `d2_floorplan` / `d2_room_flow` /
 * `joint/d1d2_rooms`）**都是这次删掉的那几个**。看到它们时读作
 * 「当初那个场子为什么这么写」，不要去 `arenas/` 里找文件 —— 找不到。
 *
 * ---
 *
 * ## 为什么生成地图要包一层，而不是让各个场子各自 `generateDungeon()`
 *
 * 三个场子要的读数是同一组：**配置、地图、耗时**。各自写一遍的话，
 * 「耗时怎么算」会有三个版本 —— 而生成耗时恰恰是这个场子要看的读数之一，
 * 三个版本意味着三个数不可比。取数只有一份，读数才可谈。
 */

import type Phaser from 'phaser'
import { WORLD_HEIGHT, WORLD_WIDTH } from '../../ArenaBase'
import type { ArenaCollision, WallSpec } from '../../ArenaBase'
import {
  ROOMS_CONFIG_NAME,
  ROOMS_CONFIG_URL,
  roomsConfigFromCache,
  type RoomsConfig,
} from '@/domains/procgen/config'
import {
  FLOOR_PLAN_FILES,
  FLOOR_PLAN_NAME,
  floorPlanFromCache,
  type FloorPlan,
} from '@/domains/procgen/gen/floorPlan'
import {
  ROOM_KINDS_EMITTED,
  ROOM_KIND_LABELS,
  type DungeonMap,
  type Point,
  type Rect,
  type Room,
  type RoomKind,
} from '@/domains/procgen/model/types'
import { collidersOf } from '@/domains/procgen/colliders'
import { generateDungeon } from '@/domains/procgen/gen/generate'
import { left, rectsIntersect, top } from '@/domains/procgen/model/rect'
import { roomViewBox } from '@/domains/procgen/presentation/framing'
import type { Mapper } from '@/domains/procgen/presentation/floorplan'

/** 换种子时按顺序翻的几张牌。**写死**是为了「同一个种子看到的永远是同一张图」。 */
export const D2_SEEDS = [1, 13, 42, 837, 20261013, 99991] as const

/**
 * ## 底座 HUD 占掉的那两块（场子摆版面时要躲的东西）
 *
 * `test/Hud.ts` 把三样东西钉在画布上，而它们**每一样都是活的**：
 *
 * | 谁 | 位置 | 为什么不能当常量猜 |
 * |---|---|---|
 * | 标题 + 读数 | 左上，**到 `y ≈ 190`、`x ≈ 310`** | 读数是固定 7 行，但行里会出现 `⚠️` 尾巴，把最宽的一行顶到 400px 开外 |
 * | 提示条（`setNotice`） | **居中**在 `y 44—68`，宽度跟着字数变 | 它由 `title.height` 顺下来 —— 标题写成两行还是三行，它会跟着动 |
 * | 按键说明 | 左下，**上沿 `y = 669`**、长约 600px | `y = 画布高 − 15×3.4`，是算出来的，不是摆出来的 |
 *
 * 这三个数是**在 1280×720 的无头截图里量出来的**（2026-10-14，`--window-size=1280,720`），
 * 不是从代码推的：按字号推出来的高度和实际的差十几像素，而**差的那十几像素
 * 正好会让两行字压在一起** —— 压在一起在现场看起来就是「场子的读数没印出来」，
 * 看场子的人会去查生成器。
 *
 * ⚠️ 这是**两个真值来源**（底座和这里），它们对不上时**不会报错**。
 * 谁动了 `Hud` 的行数、字号或那三段的高度，就要重新截一张图重量一次。
 * 取的都是**往上凑的整数**（190 → 210），留的余量是给「读数将来多一行」的。
 */
export const HUD_TOP_LEFT_BOTTOM = 210
/** 按键说明的右边界（最长那行约 40 个全角字，量到约 x 600）。 */
export const HUD_HINT_RIGHT = 620

/** 默认种子。`d2_classroom` 挑到的那间房好看不好看，全看它。 */
export const DEFAULT_SEED = D2_SEEDS[3]

export interface ArenaMap {
  map: DungeonMap
  cfg: RoomsConfig
  /**
   * 已解析的 `floor-plan.json` —— 这一层楼的**几何**（与种子无关）。
   *
   * ★ v5 新增。生成器的签名变成 `generateDungeon(seed, cfg, plan, now?)`：
   * 几何与内容分了家，种子只决定关别 / 障碍物 / 刷怪点。场子要拿它做
   * 「平面的那间房」到「关别那一间房」的对账（`room.id` 是唯一的钥匙），
   * 所以得跟着 `map` 一起交出去，不能解析完就扔。
   */
  plan: FloorPlan
  /** 生成一层楼的真实耗时（ms）。**是读数，不是常量** —— 见文件头。 */
  elapsedMs: number
}

/**
 * 从 Phaser 缓存里取 `rooms.json` + 一份平面图，按种子生成一层楼，并量出耗时。
 *
 * ★ **`roomCount` 参数没了（v5）**，连它一起删掉的是 `roomsConfigWithRoomCount` ——
 * 那两个功能是给 `joint/d1d2_rooms` 造「三间的短层」用的，而**短层在平面图下不成立**：
 * 几何是写死的一份（15 间编号教室 + 楼梯间），把教室数改成 3
 * 只会让 `parseFloorPlan` 的 `checkRoomCount` 当场抛「房数与房间表对不上」。
 * 「整层只有三间」这件事从「改配置」降级成「做不到」—— 而那是对的，
 * 因为房间数不再由配置决定，而是由那张画好的平面图决定。
 *
 * 配置取不到时 `roomsConfigFromCache` / `floorPlanFromCache` 会抛 `ConfigError`，
 * 那个错误会被 `ArenaBase.create()` 接住画在屏幕上（见 `showFatal`）——
 * 场景建不起来的时候，空白的画布和「配置写错了」在现场长得一模一样。
 *
 * ## ★ 改了两次，都是同一个方向：**几何从哪儿来**
 *
 * 1. （2026-10-22 上午）多了 `planOverride`：`D2/yf` 那一层当时是**从 6F 算出来的**
 *    （楼梯间左侧两间并成一间商店，见已删的 `_yfPlan.ts`），它自己解析好一份交进来。
 * 2. ★ （2026-10-22 下午）**`planOverride` 换成 `planName`**：那一层已经进了产品
 *    （`floor-plan-yf3.json`，一局的第 1 层），于是它不再需要「算」——
 *    与产品**同一份表、同一条取数路径**（`floorPlanFromCache` 从缓存里读）。
 *    这正是这一场想要的：**屏幕上画的就是玩家会走进的那一层**，
 *    而不是一个长得像它的东西。算出来的那份要是与产品那份分了岔，
 *    这一场会照样绿 —— 而那正是「测试场演的是另一层楼」这种坏法。
 * 3. ★ （2026-10-22 傍晚）**吃 `planName` 的那个场子从两个变成一个**：
 *    用户说「合并测试场 2 和 3」，于是 `D2/yf` 并进了 `D2/d2_seeds`
 *    （那场现在按 `C` 换层，默认就是 3F）。这个函数一个字节没改 ——
 *    **它本来就是把「哪一层」当参数收的**，两个场子合一只是少了一个调用方。
 */
export function generateForArena(
  scene: Phaser.Scene,
  seed: number,
  planName: string = FLOOR_PLAN_NAME,
): ArenaMap {
  assertConfigsLoaded(scene)
  const cfg = roomsConfigFromCache(scene.cache.json)
  const plan = floorPlanFromCache(scene.cache.json, cfg, planName)
  const t0 = performance.now()
  const map = generateDungeon(seed, cfg, plan, () => performance.now())
  return { map, cfg, plan, elapsedMs: performance.now() - t0 }
}

/**
 * 配置表都得在缓存里。**缺一张就当场抛**，报出来的是「没加载上」而不是
 * 「配置表写错了」—— 两者在屏幕上长得一模一样，而在代码里差得很远。
 *
 * 查的是 `FLOOR_PLAN_FILES` **整串**（不是只查 6F 那份）：今天有两张平面图，
 * 而场子切层时读的是另一张 —— 漏加载的那一张本该在切过去的那一下才炸，
 * 那时屏幕上已经是另一层楼了。这里一次全查，症状回到「开屏就说没加载上」。
 */
function assertConfigsLoaded(scene: Phaser.Scene): void {
  // ⚠️ `scene.cache.json`，不是 `scene.cache` —— `CacheManager` 上没有 `get()`。
  // 读之前先 `exists()`：直接 `get()` 拿到 `undefined` 的话，
  // 报出来的是配置校验器那句「要一个对象，拿到 undefined」，
  // 而它把人指向**配置表写错了**，真正的病因（根本没加载上）一个字都没提。
  //
  // 几张表**一起**查：`floor-plan.json` 漏了的话症状是「rooms.json 明明在，
  // 生成器却在抱怨拿到 undefined」，比只说一句「没加载上」难查得多。
  for (const name of [ROOMS_CONFIG_NAME, ...FLOOR_PLAN_FILES]) {
    if (scene.cache.json.exists(name)) continue
    throw new Error(
      `配置表 ${name} 没加载上（preload 里 load.json 失败了）。\n` +
        `如果是从 file:// 直接双击打开 html —— 那条路取不到 public/ 下的文件，` +
        `请走 npm run dev 或任意静态服务器。`,
    )
  }
}

/**
 * 一块几何从**地图坐标**换算到**屏幕坐标**，并换成底座认的 `WallSpec`。
 *
 * ⚠️ 两边的 `x` / `y` 都是**中心点**，而 `toScreen` 吃的是左上角 ——
 * 所以先取左上角去换算，再加上半个屏幕尺寸把中心点挪回去。写反了**不报错**，
 * 只是整块偏半个身位，看起来像「桌子画在这儿、人却撞在别处」。
 *
 * 这个函数存在的理由和 `Mapper` 那一行注释是同一条（`floorplan.ts`：
 * 「所有绘制都走它，别处不许再写一次平移公式」）：平移公式写第二遍，
 * 两份一分叉就是**一整张图偏移**，而偏移看起来永远像「生成器算歪了」。
 */
export function screenRect(r: Rect, m: Mapper): WallSpec {
  const p = m.toScreen(left(r), top(r))
  const width = r.width * m.scale
  const height = r.height * m.scale
  return { x: p.x + width / 2, y: p.y + height / 2, width, height }
}

/**
 * 把整层楼的碰撞几何**裁进这一场的取景框、换算到屏幕**，转成底座认的 `ArenaCollision`。
 *
 * 「哪一块该挡什么」不在这一层判 —— 那是 `collidersOf()` 算好的三张表，
 * 这里只做裁剪和搬运。三个列表**一起裁**，所以「椅子不在挡弹表里」这件事
 * 裁完还是成立的（分开裁就有机会裁出不一致）。
 *
 * ## ⚠️ 换算器是**参数**，不是这一层假定的事
 *
 * 两个场子一个 1:1、一个缩放过，几何该落在哪儿**只有调用方知道**。
 * 这里要是自己假定一个（比如「原样返回，反正是地图坐标」），
 * 缩放过的那一场会错得显而易见，而 **1:1 的那一场会错得看不出来** ——
 * 它的地图坐标恰好也是「一堆看起来挺合理的数」。
 *
 * 这不是假想的：`d2_classroom` 第一版就是这么写的（那时这里没有 `m` 这个参数），
 * 表现是**所有碰撞体整体平移**了几百像素 —— 墙、桌椅、8 块门挡板全都在画面上，
 * 只是**没有一块在那儿**。人撞上去不停、子弹穿墙过、按 `E` 什么都不会变，
 * 而没有一行报错。所以：**坐标系必须是传进来的，不能是假设的。**
 * （发现它的是无头截图：整张图扫不到一点挡板的绿色描边。）
 *
 * ## 为什么要裁
 *
 * `collidersOf()` 交的是**整层楼**的几何：一层有几百段墙，而 1:1 的场子里
 * 玩家走不出这 1280×720 —— 全喂进去就是几百块永远碰不到的静态体。
 * 裁一遍之后，读数里那个「造了几块」才和画面上看得见的东西对得上。
 *
 * ## 为什么是筛（`rectsIntersect`）而不是裁断（`clipRect`）
 *
 * `wallsNearRoom()` 交寻路的那一份是**裁断**的：墙被切在框边上，框外那一截消失。
 * 画面上看不出来（截掉的本就在框外），但**物理认得出来** —— 框的边缘会凭空
 * 多出一条本来不存在的通道。所以这里只筛不裁：整段留下。
 *
 * 筛用的是**地图坐标**的框（`box` 是 `roomViewBox()` 交的，本来就活在地图空间），
 * 所以「裁」和「换算」是两步、走的是两个空间 —— 别把 `box` 也换算了：
 * 换过之后框的位置和房间对不上，裁出来的会是一间**别的**房间里那些块。
 *
 * ⚠️ 于是「物理挡得住的墙」与「寻路认为堵的墙」在**框外那几十像素的边条上**
 * 有一点出入（一个整段、一个截断）。留着不修：修它要动 `makeNav`，
 * 那是 D3 的活（见 `d2_classroom.ts` 文件头那张表）。
 */
export function collisionInBox(
  map: DungeonMap,
  cfg: RoomsConfig,
  box: Rect,
  m: Mapper,
): ArenaCollision {
  const col = collidersOf(map, cfg)
  const inBox = (r: Rect): boolean => rectsIntersect(r, box)
  return {
    solids: col.solids.filter((c) => inBox(c.rect)).map((c) => screenRect(c.rect, m)),
    bulletStoppers: col.bulletStoppers.filter((c) => inBox(c.rect)).map((c) => screenRect(c.rect, m)),
    barriers: col.barriers.filter((b) => inBox(b.rect)).map((b) => screenRect(b.rect, m)),
  }
}

/**
 * 玩家该从哪儿进场：**这一间里离房间中心最近的那个刷怪点**（返回**地图坐标**）。
 *
 * 为什么用刷怪点，不再写一个「找一格空的」：刷怪点的「站得住」是生成器
 * **构造**出来的（`gen/spawns.ts`：房间内部 + 从门可达 + 网格上不堵），
 * 而这里再算一遍就是同一件事有两个真值来源 —— 两边一分岔，
 * 「玩家卡在桌子里」会变成两边各自都对。
 *
 * ## 为什么交**地图坐标**，不是屏幕坐标
 *
 * 交地图坐标的话，调用方要屏幕点时过一次 `mapper`，要问生成器那一侧
 * （`d2_classroom` 的出生点对账、`cellStateAt`）时**直接用** —— 不必再反着
 * 换算回去。上一版是交屏幕坐标的，于是 1:1 那一场得自己减掉平移量还原，
 * 而「反着算一遍」正是会在符号或次序上出错、又不会报错的那类代码。
 *
 * 「离房间中心最近」这条判据里**没有取景框**：房间中心是地图上的东西，
 * 两个场子读的是同一个数（拿画布中心去比会在缩放过的那一场里挑到另一个点）。
 *
 * `spawnPoints` 是空的话返回 `null`（非战斗关别就是空的），由场子决定怎么办 ——
 * 这里不兜底挑一个点，那会把「这一间本来就不该站人」伪装成「站得住」。
 */
export function nearestSpawn(room: Room): Point | null {
  let best: Point | null = null
  let bestDist = Infinity
  for (const p of room.spawnPoints) {
    const d = (p.x - room.rect.x) ** 2 + (p.y - room.rect.y) ** 2
    if (d < bestDist) {
      bestDist = d
      best = p
    }
  }
  return best
}

/**
 * 把生成器要的配置表挂进预加载。场子的 `preload()` 里调它。
 *
 * ★ 改了（v5）：原名 `loadRoomsConfig`，只挂 `rooms.json`。
 * 平面图落地之后生成器要两张表（`rooms.json` 给数值、平面图给几何），
 * **只挂一张的症状是一条看不懂的报错** —— 见 `generateForArena` 里那段一起查的注释。
 * 名字跟着改，是因为「调用方只需要记得调一次、且这一次必须把几张都挂上」
 * 这件事**没法靠名字提醒**：叫 `loadRoomsConfig` 而偷偷多挂一张，
 * 下一个人加第三张表时照样会漏。
 *
 * ★ 又改了（2026-10-22）：平面图那一头挂的是 `FLOOR_PLAN_FILES` **整串**
 * （今天两张：6F + 逸夫楼 3F）。**不在场子里手写文件名** ——
 * 一局里第几层走哪张图归 `floors.json`（产品）与那一串（加载清单）管，
 * 场子跟着走就永远是同一份；写死的话，产品加了第 3 张图时这一场看不见，
 * 而它看着一切正常。
 *
 * ⚠️ 必须走 **Phaser 的 loader**，不能 `fetch` —— 场景生命周期保证
 * `create()` 一定在所有加载完成之后才跑，所以 `create()` 里读 `cache.json`
 * 是同步的、一定拿得到。用 `fetch` 的话 `configure()` 会在文件到位之前跑完，
 * 表现是「场子建起来了，但地图是空的」，而控制台一声不吭。
 */
export function loadProcgenConfigs(scene: Phaser.Scene): void {
  scene.load.json(ROOMS_CONFIG_NAME, ROOMS_CONFIG_URL)
  for (const name of FLOOR_PLAN_FILES) scene.load.json(name, `config/${name}`)
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
 * - **面积最大**：这一场要看的是**格子级的对错**（桌子有没有压住门、
 *   红的格子和青的格子错没错开）。房间越大、桌子越多，能看出来的越多；
 *   教休室（`YF607` / `YF612` 是这一层最小的两张）只放得下两三张桌，
 *   一场几乎什么都看不出来。
 * - **放得下**：取景框 1:1 摆进世界之后不能超出，否则会画到屏幕外面去 ——
 *   而画到屏幕外面看起来和「生成器没生成这段墙」一模一样。
 * - **有课桌、有刷怪点**：没有这两样就看不出可走性判定的对错。
 * - **不是起点也不是首领**：楼梯间不是「编号教室」（没有 `id` 里的编号），
 *   首领的门是终点，两者的框都不典型。
 *
 * ★ 改了（v5）：原来的两条判据**跟着模型一起没了**，见文件头那张表。
 *
 * - `room.branch !== 'main'` —— `branch` 整个字段删掉了（用户要求：
 *   不要主干道，「可以随意在走廊走，随意选择房间进入挑战」）。
 *   现在 16 间房在几何上完全平等，**没有「主干/侧室」可筛**。
 * - `room.sizeTier` —— `sizeTier` 也删了。以前房间是**算出来**的，
 *   宽度只能取几个档位，于是「档位大的」是个离散的、好比的量；
 *   现在房间是**画**出来的，宽度是「平面图上量出来多少就是多少」。
 *   改成比 `rect.width * rect.height`：意思还是「挑最大的那间」，
 *   只是判据从「档位」换成「面积」。
 *
 * 挑不到就返回 `null`，由场子自己决定怎么报 —— 这里不猜、不兜底。
 *
 * ⚠️ **实测（2026-10-21）：它今天对所有种子都返回 `null`。**
 * 卡在「放得下」那一条上 —— 走廊在 v5 里是**一整条长矩形**，
 * `roomViewBox` 并进「门外的走廊」之后 16 间里有 10 间的框宽 **4840**
 * （> `WORLD_WIDTH` = 1280），全被筛掉；剩下的几间（如 `YF612`）又小到没有桌椅，
 * 被「有课桌」筛掉。**这一条不是 bug、也不用修**：那条判据的前提是
 * 「1:1 摆进屏幕」（缩放恒为 1，框大了就会画到屏幕外），
 * 而今天没有任何场子按 1:1 摆 —— `d2_seeds` 的「放大一间」是**按框缩放**的
 * （走 `drawFloorplan` 的 `world` 参数），框多大都装得进去，
 * 所以它自己挑房（桌椅最多的那一间），不经过这里。
 * 留着这个函数是因为它的**判据**（面积 → 桌椅 → 顺序定死）与那几条理由
 * 下一个按 1:1 摆的场子还要用；但**别照抄它去当「挑一间房」的通用工具**。
 */
export function chooseClassroom(map: DungeonMap, cfg: RoomsConfig): Room | null {
  const area = (r: Room): number => r.rect.width * r.rect.height
  const scored: { room: Room; box: Rect }[] = []
  for (const room of map.rooms) {
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
      area(b.room) - area(a.room) || // 面积大的优先
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

/**
 * 一层楼的整体读数。场子的抬头都读它，免得各写一份口径。
 *
 * ## ⚠️ 这里**不许**读 `room.branch` / `room.sizeTier`
 *
 * ★ 这条**赌赢了**，2026-10-20 记一笔，因为它是「先写成将来的样子」唯一一次
 * 真的兑了现：v5 落地时 `branch` / `sizeTier` / `anchoredTo` / `RoomBranch`
 * 一起被删掉，而 `summarise` **一个字都没改**（`tsc` 一声不吭）。
 * 反过来说，当初要是照着 v4 的字段写「主干 N · 侧室 M」，这一行就得跟着重构一起改，
 * 而它是个**读数** —— 读数和被读的东西一起改，等于这一天的读数没有参照物。
 *
 * 读 `kind` 就没这个问题：**关别才是这一层楼真正的分类**。
 * 「604 是本层最终关卡（首领）、教休室是道具房、其余按种子抽普通/精英」
 * 说的就是它 —— 平面图换掉的是**几何**，关别一个字都没动。
 *
 * ⚠️ `order` **还在**（v5 保留了它），但它**不是「离起点多远」**：
 * 它是「楼梯间占 0，其余按 id 升序」的编号（`gen/layout.ts` 的 `planLayout`）。
 * 所以别拿它排「先打哪一间」—— 那读出来是错的，而且是**看不出错**的那种错
 * （`YF601`…`YF615` 本来就是升序的，看起来完全像一条合理的路线）。
 * 真要「离起点多远」，用 `gen/layout.ts` 的 `hopDistances(plan)`（它按平面图那个图
 * 从楼梯间做 BFS），或者读契约校验报告的 `hopOf` —— **不是**读 `order`。
 *
 * 顺序照 `ROOM_KINDS_EMITTED`（起点在前、首领在后），不照出现次数排：
 * 同一个种子扫两遍，两遍的行序必须一样，否则「这行和上次不一样」会被误读成
 * 「生成结果变了」。**只列这一层真的出现过的关别**，恒为 0 的不占位置。
 */
export function summarise(a: ArenaMap): string[] {
  const counts = new Map<RoomKind, number>()
  for (const room of a.map.rooms) counts.set(room.kind, (counts.get(room.kind) ?? 0) + 1)
  // 门在房间上（`room.doors`），`DungeonMap` 上没有一份汇总 —— 别去 `map.doors` 找。
  const doors = a.map.rooms.reduce((n, r) => n + r.doors.length, 0)
  const kinds = ROOM_KINDS_EMITTED.filter((k) => counts.has(k))
    .map((k) => `${ROOM_KIND_LABELS[k]} ${counts.get(k)}`)
    .join(' · ')
  return [
    `seed ${a.map.seed}`,
    `房间 ${a.map.rooms.length} · 门 ${doors} 扇 · 墙 ${a.map.walls.length} 段`,
    `楼层 ${Math.round(a.map.bounds.width)}×${Math.round(a.map.bounds.height)}px · 生成 ${elapsedText(a.elapsedMs)}`,
    `关别 ${kinds}`,
  ]
}

/**
 * 一层楼的**桌椅**读数。**一行**，装在 `summarise` 后面。
 *
 * ★ 新增（2026-10-21）：用户报「换种子看不到桌椅随机生成情况」。
 * 一半的原因是这一场**根本没画**桌椅（`drawFloorplan` 的 `obstacles` 是 `false`），
 * 另一半是**光画也说不清「变了没有」**：缩略图缩到 0.12，一张 80px 的桌子只有
 * 10px —— 看得见形状，说不出数目，更比不了两个种子。所以除了把桌椅画出来，
 * 还要把**能在两个种子之间直接比**的数印出来。
 *
 * 三个数分开报，各有各的用处：
 *
 * - **件数**：一层楼的总量。六个种子实测 **114—132**（确实随种子变，不是常量）；
 * - **有桌椅的间数**：非战斗关（道具关 / 宝箱关 / 楼梯间）本来就该是空的
 *   （`gen/obstacles.ts`）。有这个数，「哪几间空着」与「生成器漏了」才分得开 ——
 *   前者是设计，后者是 bug，而在画面上两者都是**一片空地**；
 * - **最多的那一间**：缩略图上桌椅糊成一片时，这一条直接指出该放大看哪一间。
 *
 * ⚠️ 三个数都是**逐间数 `room.obstacles`** 数出来的，不是「按关别推」的：
 * 推的话就是第二份「哪几类关别该有桌椅」，与 `gen/obstacles.ts` 分岔时**不报错** ——
 * 只会让读数与画面各说各的，而两边的格式都"看起来对"。
 */
export function furnitureText(map: DungeonMap): string {
  const per = map.rooms.map((r) => r.obstacles.length)
  const total = per.reduce((a, b) => a + b, 0)
  const filled = per.filter((n) => n > 0).length
  const most = Math.max(0, ...per)
  // 并列时全都印出来：挑一个会让人以为「只有那间多」，而实际不是。
  const busiest = map.rooms.filter((r) => r.obstacles.length === most).map((r) => r.id)
  return (
    `桌椅 ${total} 件 · 有桌椅 ${filled} 间 · 单间 0—${most} 件` +
    (busiest.length ? `（${busiest.join('/')} 最多）` : '')
  )
}