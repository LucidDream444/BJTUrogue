import Phaser from 'phaser'
import { preloadAssets, ensurePlaceholderTextures, registerAnimations } from '@/core/assets'
import { parseConfigBundle, type ConfigBundle, type Difficulty } from '@/core/config'
import {
  parseCombatConfig,
  parseRewards,
  type CombatConfig,
  type RewardDef,
} from '@/domains/combat/config'
import { CombatSession } from '@/domains/combat/CombatSession'
import { RewardPanel } from '@/domains/combat/RewardPanel'
import { roomPlan } from '@/domains/combat/balance'
import { AssetGallery } from './AssetGallery'
import { StatusHud } from '@/domains/combat/StatusHud'
import { GameCursor } from '@/domains/combat/GameCursor'
import { StageBackground } from './StageBackground'
import {
  parseStageCollisions,
  stageGeometry,
  type StageCollisionConfig,
} from './StageGeometry'
import {
  arenaOf,
  buildDungeonStages,
  chestSpotAtCenter,
  chestSpotIn,
  FLOOR_STAGE,
  floorSeeds,
  roomAt,
  roomIdsOf,
  type DungeonRoom,
  type DungeonStages,
} from './DungeonStages'
import { doorShouldBeClosed } from '@/domains/procgen/roomFlow'
import {
  FLOORS_CONFIG_NAME,
  ROOMS_CONFIG_NAME,
  roomHasChest,
  roomsConfigFromCache,
  type RoomsConfig,
} from '@/domains/procgen/config'
import {
  FLOOR_PLAN_FILES,
  floorPlansForRun,
  type FloorPlan,
} from '@/domains/procgen/gen/floorPlan'
import { ROOM_KIND_LABELS } from '@/domains/procgen/model/types'
import { containsPoint } from '@/domains/procgen/model/rect'
import { Minimap } from './Minimap'
import { FloorExit } from './FloorExit'
import { ElevatorPanel, type FloorRow } from './ElevatorPanel'
import { FloorProgress, stairPadSpots } from './Stairwell'
import { FirstBossLoot } from '@/domains/combat/FirstBossLoot'
import { LoadoutHud } from '@/domains/combat/LoadoutHud'
import { SkillHud } from '@/domains/combat/SkillHud'
// —— 局外成长（D4）的两个界面组件：暂停菜单、结算界面 ——
//
// 这两个都是**可复用组件**（不是场景），接法就是宿主给一个 `host` 对象：
// 「暂停语义」「这一局打了多少」由战斗场景提供，界面与规则归 D4。
// 它们本来只能在测试场里跑（`?arena=d4_pause` / `?arena=d4_settlement`），
// 这里接上之后才是产品里的那一份。
import {
  META_CONFIG_NAME,
  META_CONFIG_URL,
  parseMetaConfig,
  type MetaConfig,
} from '@/domains/meta/metaConfig'
import { CHARACTERS, characterById } from '@/domains/meta/catalog'
import { PauseOverlay } from '@/domains/meta/pause/PauseOverlay'
import { ProfileStore } from '@/domains/meta/profile/ProfileStore'
import {
  LocalStorageProfileStorage,
  MemoryProfileStorage,
} from '@/domains/meta/profile/storage'
import {
  effectiveMaxEnergy,
  effectiveMaxHp,
  effectiveMaxShield,
  effectiveStats,
  skillLevelOf,
  trackKey,
  type RunInput,
} from '@/domains/meta/progress/progress'
import { RunLedger } from '@/domains/meta/run/RunLedger'
import { SettlementOverlay } from '@/domains/meta/settlement/SettlementOverlay'

/**
 * 「够得着」的距离门槛（世界像素）。**量的是到目标矩形的最短距离**，贴着它才是 0。
 *
 * ★ 改了（2026-10-21，整层连续）：原来它量的是**门**（`DOOR_REACH`，站在门口按 F 过门）。
 * 现在门是**走过去就行**的实体（见 `DungeonStages.ts` 文件头），没有"门前按 F"这件事了，
 * 于是它只剩一个用处：**「下一层」的入口** —— 那个入口按设计就是要站上去的。
 */
const EXIT_REACH = 50

/** 刷怪时要求怪物中心离墙至少这么远（世界像素）。比怪物半径大一点，别一出生就嵌在墙里。 */
const ENEMY_CLEARANCE = 26

/**
 * 刷怪点离**玩家进这间房时站的位置**至少这么远（世界像素）。
 *
 * 4 格。比 `rooms.json` 的 `spawnPointMinGap`（80px，那是两个刷怪点之间）大一倍 ——
 * 玩家比怪胖、而且刚推门进来那一下是躲不开的，给的距离要比怪与怪之间宽。
 *
 * ★ 改了（2026-10-21）：量的是**玩家现在站的地方**，不再是 `spawnPoints[0]`。
 * `spawnPoints[0]` 是「离房间中心最近的那个点」，那是「一间房 = 一关」时期的写法 ——
 * 那时玩家被**空投**到那个点上，所以它等于玩家的位置。整层连续之后玩家是**走进来的**，
 * 从哪扇门进来就站在哪边，`spawnPoints[0]` 通常离他远远的。
 */
const SAFE_SPAWN_GAP = 160

const style = document.createElement('style')
style.textContent =
  '.d1-gallery{font-family:system-ui,sans-serif;color:#e9f2ff}.d1-gallery{position:fixed;inset:0;z-index:95;background:#091323f5;padding:22px;overflow:auto}.d1-gallery header{display:flex;justify-content:space-between}.d1-preview-canvas{display:block;max-width:100%;border:1px solid #376276}.d1-asset-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-top:14px}.d1-asset-card{display:flex;align-items:center;gap:8px;text-align:left;background:#13233a;color:#dcecff;border:1px solid #31516c;border-radius:8px;padding:6px;cursor:pointer;white-space:pre-line}.d1-asset-card img{width:56px;height:56px;object-fit:contain;background:#0a111d}.d1-asset-card span{font-size:11px}'
document.head.append(style)
/**
 * ## ★ 2026-10-21：从「一间房 = 一关」改成「**整层连续**」
 *
 * 这个场景原来把一个 `StageCollisionConfig` 的第 n 关读成「第 n 间房」，
 * 过门 = `enterStage(下一间)`：换一整张几何、把玩家空投到那一间的落脚点、
 * 相机钉死在那一间的取景框里。整层连续之后这些**全部没有了**：
 *
 * | | 上一版 | 现在 |
 * |---|---|---|
 * | `stage` | 「第几间」（1 起），是**状态** | 没了。几何整层一份、永不更换 |
 * | 玩家在哪 | 就是 `stage` | `roomOrder`，**每帧由 `roomAt()` 现算**，`-1` = 走廊 |
 * | 过门 | 站门口按 `F` | **走过去**。门是 `StageColliders` 里可开关的挡板 |
 * | 相机 | `fitCamera()` 把整张图塞进屏幕，`stopFollow()` | **1:1 跟随玩家**（`cfg.camera`） |
 * | 出生点 | 本间房中心附近那个刷怪点 | **楼梯间门外的走廊上**（`DungeonStages.spawn`） |
 * | 清房 | 「本间」= 当前 stage | 「**我站着的这一间**」= `roomAt()` 给的那一间 |
 * | 门什么时候开 | 选完强化 → `doorOpen = true` | 那一间**不在战斗**里（`doorShouldBeClosed`） |
 *
 * ⚠️ **最容易漏的一条：清房判定必须是「这一间里的怪」，不是「全图的怪」。**
 * 整层只有一间的怪是活的（进门才刷、出生点只有一个），所以今天两者数值上相同 ——
 * 但写成「全图」之后，一个被挤出墙外的怪的处置、以及将来任何一次「同时两间在打」
 * 都会把别的房间的怪算进来，表现是「这间明明清完了，门不开」。
 */
export interface BattleSceneData {
  difficulty?: Difficulty
  /** 测试场专用：使用内存档并开放角色 / 技能等级调试。 */
  skillLab?: boolean
  skillLabCharacterId?: string
  skillLabLevel?: number
}

export interface SkillLabState {
  characterId: string
  characterName: string
  skillName: string
  level: number
  lines: readonly string[]
}

export class BattleScene extends Phaser.Scene {
  private scenery!: StageBackground
  private loot!: FirstBossLoot
  private loadout!: LoadoutHud
  private skillHud!: SkillHud
  private bossLabel!: Phaser.GameObjects.Text
  private difficulty: Difficulty = 'normal'
  private skillLab = false
  private skillLabCharacterId: string | undefined
  private skillLabLevel = 1
  private session!: CombatSession
  private rewardPanel!: RewardPanel
  private cursor!: GameCursor
  private gallery!: AssetGallery
  private stageConfig!: StageCollisionConfig
  private cfg!: CombatConfig
  private bundle!: ConfigBundle
  private rewardDefs!: RewardDef[]
  private statusHud!: StatusHud
  private notice!: Phaser.GameObjects.Text
  private deathNotice!: Phaser.GameObjects.Text
  private gameWon = false
  /**
   * 玩家**现在在哪一间**（`Room.order`）。`-1` = **在走廊里**。
   *
   * ★ 改了（2026-10-21，整层连续）：原来是 `stage`（「第几间」，1 起），
   * 而它的作用不止是"在哪" —— `enterStage(stage)` 拿它**换整张几何**
   * （一间房一关）。整层连续之后几何**整层只有一份、永远不换**，
   * 于是它的含义缩回一件事：**玩家站在哪一间里**。而这件事每帧都变
   * （走过去就变了），所以它在 `update()` 里由 `roomAt()` 现算。
   *
   * ⚠️ **`-1` 而不是 `0`**：`0` 是楼梯间，是个真实存在的房间号。
   * 用 `0` 当「不在任何一间里」的话，玩家一出生（在走廊上）就会被判成
   * 「在楼梯间里」，而那会让楼梯间在第一帧就被标成「已进过」、
   * 顺带把它的门当成"打完了"。走廊里没有房间号，所以需要一个房间号之外的哨兵值。
   */
  private roomOrder = -1
  /**
   * 这一层楼的生成结果（D2）。**整层连续**：`stages` 里**只有一关**（整层），
   * `rooms` 是这一层**每一间房**的逐间信息（几间、什么关别、刷怪点在哪、门开在谁身上）。
   * 拆法见 `DungeonStages.ts` 的文件头。
   *
   * ⚠️ 一局有**多层**楼（`arena.maxStages`），所以它会被整个换掉 ——
   * `loadFloor()` 是唯一该改它的地方。
   */
  private dungeon!: DungeonStages
  /**
   * D2 的 `rooms.json`。★ 新增（v5）：原来是每层现算一份
   * （`roomsConfigWithRoomCount(缓存, 房间数, 侧室数)`），现在**整局一份就够** ——
   * 房间数不再是这里给的参数，几何全在 `floor-plan.json` 里。
   *
   * 三处用它：`buildFloor()` 交给 D2 的生成器、`Minimap` 用来问「这一间打不打架」
   * （`roomFillColor`）、`roomPlan()` 的强度倍数要 `budgetBase`。
   * **别在哪一层现读缓存** —— 那会多出一处「配置从哪儿来」。
   */
  private rooms!: RoomsConfig
  /**
   * **每一层**的平面图（已解析），按层号排 —— `plans[n - 1]` 是第 `n` 层。
   * 与种子无关：同一层每次生成长得一样，变的是内容。
   *
   * ★ 改了（2026-10-22）：原先是**一个** `plan` —— 「几何整局一份，换层只换内容」。
   * 用户要的是「进入游戏先是 YF3，下一层是 YF6」，于是换层**整层换掉几何**。
   * 哪一层走哪张图不在这里决定（那是配置：`floors.json`），这里只拿那一串。
   *
   * ⚠️ ★ 改了（2026-10-22 晚）：上一版这里写的是「第 2、3 层**是同一张图**，
   * 所以房号在两层之间会重复」—— 三层三张图之后那句话不成立了（1F / 3F / 6F
   * 的房号各是各的，三张都有的只剩楼梯间那一个 `STAIR`）。**但按房号的记账
   * 照旧要清**，理由换成了另一条，而且是更硬的一条：**同一层可以来回走**
   * （上了 3F 还能从楼梯间下回 1F），回到同一层时房号当然**一模一样**。
   * 清理（`loadFloor()`）与还原（`FloorProgress`）是同一件事的两半，
   * 见 `Stairwell.ts` 那个类头上「不还原的后果」。
   */
  private plans!: readonly FloorPlan[]
  /**
   * 现在在第几层（1 起）。**这一局打的是「第几层」**。
   *
   * ★ 改了（2026-10-21，整层连续）：原来是「每层自己有一张随机地图、自己的一串房间，
   * 最后一间是本层的首领」—— 三件都不成立了：**一层就是一层楼**，
   * **首领写死在平面图里**（6F 是 `YF604`，16 间里排第 5、离末位很远），
   * 每层变的只是**内容**（关别、障碍物、刷怪点）。
   *
   * ★ 又改了（2026-10-22）：上一句里「楼整局一份」也没了 —— **三层三张图**
   * （`floors.json`：1F → 2F → 3F → 4F → 5F → 6F），换层连**几何**一起换（`plans`）。
   * 首领房因此**逐层不同**（3F 是 `YF304`、6F 是 `YF604`），别再当成一个全局常量；
   * 而第 1 层（逸夫楼 1F）**一间首领房都没有**（13 间全空房），
   * 所以「本层首领」在这三层里是**可有可无**的 —— 见 `bossDown()`。
   */
  private floor = 1
  /**
   * 本局每一层的种子（长度 = `floors()`）。整局共用一条 `runSeed` 派生出来，
   * 于是**报出 `runSeed` 就能复现整局**（推导见 `DungeonStages.floorSeeds()`）。
   */
  private floorSeedList: number[] = []
  /**
   * 楼梯间里那个「**上一层**」入口 —— **它就是前进方向**：打完本层首领才亮，
   * 最后一层不亮（那是通关）。
   *
   * ★ 改了（2026-10-22 晚，用户：「原来的上下概念颠倒，不再是向下的地牢层数，
   * 而是向上的楼层」）：上一版前进 = **下**第 N+1 层（那时层号是「往下挖」的），
   * 现在前进 = **上**第 N+1 层。一局的层号与楼的层号从此是同一个方向
   * （`floors.json`：1F → 2F → 3F → 4F → 5F → 6F），所以「上楼」既是关卡前进、也是字面意思。
   *
   * 位置见 `stairPadSpots()` 的 `up`（那间房的**北半**，见 `refreshStairPads()`）。
   *
   * ★ 2026-10-21（用户报的）：它原来亮在**楼梯间门外的走廊上**（= 玩家出生的那个点）。
   * 用户的原话是「打完该层首领后去下一层的路应该出现在楼梯间里，而不是楼梯间门口」——
   * 楼梯间是这一层楼**唯一的上下楼口**，入口摆在门口等于把「中转站」这个名字
   * 挂在一个玩家路过都不必进去的门框上。
   */
  /**
   * ★ 新增（2026-10-22 晚·七）：**电梯能去第几层** —— 「已解锁」= 走到过的最高层。
   *
   * 用户：「可以在电梯间选择层数前往（**仅能前往当前已解锁层数**）」。
   * 解锁的口径就是**走过**：`loadFloor()` 每落一层把这里推到那一层，
   * 于是电梯只会亮起「你到过的地方」，不会把玩家直接送进没打过的楼。
   * `init()` 里回到 1（新的一局从第 1 层开始）。
   */
  private maxFloorReached = 1
  /**
   * ★ 2026-10-23：电梯的**楼层选择面板**（用户：「进去后可以选择楼层（之后楼层比较多），
   * 不然和楼梯没区别」）。原来电梯里摆的是一列方框 —— 和楼梯间同一个交互，
   * 而且楼层一多就摆不下。现在走进电梯间弹这个面板，点一下 / 按数字键就去。
   */
  private elevatorPanel!: ElevatorPanel
  private exitUp!: FloorExit
  /**
   * 楼梯间里那个「**下一层**」入口 —— **它就是回去的路**：**第 1 层没有**
   * （下面没有楼），其余每层一直在，**从不看首领**。
   *
   * 用户 2026-10-21：「如果有上一层，在楼梯间里可以回去」（那时方向还是反的），
   * ★ 2026-10-22 晚上下调了个个儿：这一格是「回去」的那一个，位置在
   * `stairPadSpots()` 的 `down`（那间房的**南半**）。
   *
   * ⚠️ **它和「上一层」是两件事，别合并成一个「换层」入口**：
   * 一个要打完首领才出现、一个从上一层楼那一刻起就在；一个把玩家送到没打过的楼层、
   * 一个送回去。合成一个「按 F 换层」的话，玩家在楼梯间里按下去是上还是下，
   * 只能靠代码里的顺序决定 —— 而那正是「一次按键同时满足两条判据」的经典写法
   * （见 `stairPadSpots()`：两个方框刻意离得比够得着的门槛远）。
   */
  private exitDown!: FloorExit
  /**
   * **每一层各自记着的进度**（进过哪些房、打完哪些房、开过哪些宝箱）。
   *
   * ★ 新增（2026-10-21）：有了「上一层」就必须有它 —— `loadFloor()` 每次换层都要把
   * 那三份记账清干净（换层的理由写在那个函数头上），于是回上一层时得**有地方取回来**。
   * 不取回来的三种表现（都不报错）见 `Stairwell.FloorProgress` 的类注释。
   */
  private readonly progress = new FloorProgress()
  /**
   * **正在战斗**的那些房间（`Room.order`）。门该不该关只读它
   * （判据是 D2 的 `doorShouldBeClosed`，这里是那份判据的输入）。
   *
   * ★ 取代了 v4 的 `doorOpen`（一个布尔：「本间的门开了没有」）。
   * 布尔值表达不了整层：16 间房各有各的门，而每扇门的开关是**按房**判的。
   *
   * 今天**最多只有一个元素**（进门才刷怪，而玩家进不了第二间 —— 门封着），
   * 用集合是因为判据的签名就是集合（`DoorStateInput.combatRooms`），
   * 而传一个「集合，但保证只有一个」比传一个 `order` 更贴判据、也少一处转译。
   */
  private combatRooms = new Set<number>()
  /**
   * 已经进过的房间（`Room.order`）。**回走的房间不该再刷一遍怪** ——
   * 没有这一条，回头再进门就是重打一遍，而「能回头」立刻变成惩罚。
   *
   * ⚠️ **它不等于「打完了」。** 一进门就写进来（封门与刷怪也在那一刻），
   * 而小地图那一行的「走过 N / M 间」问的正是「去过没有」—— 两份是一件事。
   * 「打完了没有」是下面那个 `cleared`，**别再把这一份喂给房号那行字**。
   */
  private visited = new Set<number>()
  /**
   * **打完的**房间（`Room.order`）。喂给观感层（地上的房号、门的颜色）。
   *
   * 与 `visited` 只差一件事，但差在**玩家一眼就能看见的地方**：
   * 普通关推门进去、一只怪都还没打的时候，`visited` 里已经有了、`cleared` 里还没有。
   * 2026-10-21 之前房号读的是 `visited`，于是那一刻地上写着「已清」（用户报的 bug）。
   *
   * **不用打的房（道具关 / 宝箱关）：宝箱开了才算清** —— 它们的「这一间做完了」
   * 就是「东西拿到了」，不是「走进来了」（见 `enterRoom()` 与 `trackChestOpened()`）。
   *
   * ★ 改了（2026-10-21，紧随用户报的「刚进普通关还没打怪就显示已清」）：
   * 原来是**一进门就算清**（理由是「不用打的房一进场就没有悬念了」）。可那几间的
   * 悬念不是打不打，是**箱子里那把武器**——玩家进门、箱子还没开，地上就写着「已清」，
   * 与用户报的那条是同一类错：**「已清」要读作「这间没别的事了」**。
   *
   * 楼梯间（`start`）**永远不进这一份**：它没有可做完的事，它是过道。
   */
  private cleared = new Set<number>()
  /**
   * 道具关 / 宝箱关的宝箱**开过没有**（`Room.order`）。
   *
   * 有它才能做到「宝箱是**这一间**的东西」：没开过 → 每次进来它都在原地；
   * 开过 → 不再出现。少了「开过」这一半就是**一台重抽武器的机器**
   * （出门再进门，宝箱里又是一把随机武器）—— 而房间里那把武器是随机的
   * （`FirstBossLoot.interact()` 走 `chooseRandomWeaponId()`）。
   */
  private lootedRooms = new Set<number>()
  /**
   * 现在场上那个宝箱属于哪一间（`Room.order`）。`null` = 场上没有宝箱。
   *
   * 只用来在离开时**结账**：走之前问一句「它开过没有」，记到 `lootedRooms` 里
   * （见 `settleChest()`）。宝箱是**世界里的东西**，它不属于「现在在哪一间」。
   */
  private chestRoom: number | null = null
  /** 右上角的一层缩略图。**整层走起来很容易走丢**，没有它玩家不知道还剩几间。 */
  private minimap!: Minimap
  /** 本局的楼层种子。**每局都换**，留在场上是为了能复现同一层。 */
  private runSeed = 0
  /**
   * 正在打的那一间（`combatRooms` 里那一个的房间数据）。
   *
   * **和 `roomOrder` 不是一回事**：`roomOrder` 是「我脚底下是哪间」（走出门就变），
   * 这个是「哪一间还没打完」（人走了也还在打）。分开存是为了清房判定有个稳定的主语 ——
   * 用它去数怪，就不会出现「玩家一只脚踏在门口，判据在数和走廊之间来回跳」。
   */
  private activeRoom: DungeonRoom | null = null
  /**
   * 「这一间已经清空」是从哪一刻开始成立的（游戏时钟毫秒）。`null` = 还没清空。
   *
   * ⚠️ **不能见到「怪全死了」就当清完**：最后一只分裂怪死掉时，子代还在
   * `enemies.json` 的 `splitDelayMs` 里等着，那一段「存活 0、队列 0」是真的。
   * 一空就开门会提前放行，而玩家走进隔壁之后子代才在原地冒出来 ——
   * 表现是「有一间永远清不掉」。晾 `rooms.json` 的 `settleMs` 再宣告
   * （那条判据由 `roomFlow.test.ts` 盯着「必须大于最大的 splitDelayMs」）。
   */
  private clearSince: number | null = null
  /** 这一间的清空**已经宣告过**了。同一间只发一次成长、只掉一次宝箱。 */
  private clearEmitted = false
  /** 调试键 `C` 请求过清房。见 `requestClear()`。 */
  private clearRequested = false
  /** 过「下一层」的键。**和暂停的 `ESC`、拾取的 `E` 错开**，别让人捡东西时误按。 */
  private passKey!: Phaser.Input.Keyboard.Key
  /** 抓取冻结已经持续了多久（毫秒，渲染时间）。**兜底用**：一直解不开就强制放人 */
  private grabFrozenMs = 0

  /* ---- 局外成长（D4）：一局的账本、结算界面、暂停菜单 ---- */

  private store!: ProfileStore
  /** 成长数值表。**读不出来时是 `null`**，那时这一局照常玩，只是结束时退回旧的那行文字 */
  private meta: MetaConfig | null = null
  private ledger!: RunLedger
  private settlement: SettlementOverlay | null = null
  private pauseMenu!: PauseOverlay
  /**
   * 这一局结算过没有。
   *
   * ⚠️ **必须有这道闸门**：死亡和通关在 `update()` 里是"每帧都成立"的条件，
   * 而 `R` 也会走同一条路 —— 没有它，币会按帧翻倍。
   * （`SettlementOverlay.show()` 自己也幂等，那是第二层保险，不是这一道的替代品。）
   */
  private runEnded = false
  private runOutcome: RunInput['outcome'] = 'dead'

  constructor(key = 'battle') {
    super(key)
  }
  /** 一局几层。**就是 `arena.maxStages`** —— 第 1..N 层各有一个首领。 */
  private get floors(): number {
    return this.cfg.arena.maxStages
  }
  init(data: BattleSceneData = {}): void {
    this.difficulty = data.difficulty ?? 'normal'
    this.skillLab = data.skillLab === true
    this.skillLabCharacterId = data.skillLabCharacterId
    this.skillLabLevel = Phaser.Math.Clamp(data.skillLabLevel ?? 1, 1, 4)
    this.floor = 1
    this.maxFloorReached = 1
    this.floorSeedList = []
    this.roomOrder = -1
    this.activeRoom = null
    this.combatRooms.clear()
    this.clearSince = null
    this.clearEmitted = false
    this.clearRequested = false
    this.gameWon = false
    this.visited.clear()
    this.cleared.clear()
    this.lootedRooms.clear()
    this.chestRoom = null
    // ⚠️ **每层的记性也要清**，否则重开的第二局一进楼梯间就能「回上一层」——
    // 回到的是**上一局**某一层的快照，而那一层的房号、门、宝箱全按老规矩亮着。
    this.progress.forget()
    // 场景实例是复用的，字段必须在这里回到初始值 —— 漏了 `runEnded` 的话，
    // 重开的第二局一上来就"已经结算过"，结算界面再也不会出现。
    this.runEnded = false
    this.settlement = null
  }
  preload(): void {
    preloadAssets(this)
    // ⚠️ **`stage-collisions.json` 与 `painted-rooms.json` 不在这一串里了**
    // （2026-10-21，整层连续）：关卡几何现在来自 **D2 的生成器**
    // （`buildDungeonStages()`），那两份手画的 JSON 是「一间房一关」时代的产物。
    // 前者还被 `StageGeometry.test.ts` 当作**校验器的夹具**直接从磁盘读（不经过这里），
    // 后者连同 `PaintedRooms.ts` 一起删了。
    for (const n of [
      'balance.json',
      'difficulty.json',
      'enemies.json',
      'combat.json',
      'rewards.json',
      // D2 的地牢生成配置：**数值 + 几何 + 楼层表**。
      // **必须走 Phaser 的 loader，不能 fetch** ——
      // 场景生命周期保证 `create()` 一定在所有加载完成之后才跑。
      ROOMS_CONFIG_NAME,
      // ★ 改了（2026-10-22）：平面图从**一张**变成 `FLOOR_PLAN_FILES` 那**一串**
      //   （今天三张：逸夫楼 1F + 3F + 6F）。**一局用哪几张，这里看不出来** ——
      //   加载清单必须是常量（`floors.json` 自己也是被加载进来的，先有鸡才有蛋），
      //   哪一层走哪张由下面那份 `FLOORS_CONFIG_NAME` 说。
      ...FLOOR_PLAN_FILES,
      FLOORS_CONFIG_NAME,
    ])
      this.load.json(n, `config/${n}`)
    // 文件名与路径走 D4 的常量，别在这里再写一遍字面量（`metaConfig.ts` 是唯一真值）
    this.load.json(META_CONFIG_NAME, META_CONFIG_URL)
  }
  create(): void {
    try {
      Object.defineProperty(window, '__d1', { value: this, configurable: true })
      ensurePlaceholderTextures(this)
      registerAnimations(this)
      this.bundle = parseConfigBundle({
        balance: this.cache.json.get('balance.json'),
        difficulty: this.cache.json.get('difficulty.json'),
        enemies: this.cache.json.get('enemies.json'),
      })
      this.cfg = parseCombatConfig(this.cache.json.get('combat.json'))
      this.rewardDefs = parseRewards(this.cache.json.get('rewards.json'))
      // 关卡几何来自 **D2 的生成器**：整层一张连续地图（房间 + 走廊 + 门），一局**多层楼**。
      // ⚠️ **v5 起房间数不由这里决定了。** 原来走 `roomsConfigWithRoomCount()` 把
      //    `totalRooms` / `mainRoomMin` / `mainRoomMax` 三个数一起改，是因为几何
      //    **算**出来的、房间数是个自由参数。现在几何是**画**出来的
      //    （`public/config/floor-plan-*.json`，照平面图照片量的），
      //    一间房几间、在哪儿 = 改那张图；而「这一层有几间」由平面图自己声明
      //    （`roomTotal`，★ 2026-10-22 从 `rooms.json` 搬过去的 —— 三层楼间数各不同）。
      // ⚠️ **种子必须每局换**。`combat.json` 里那个 `arena.seed` 是**固定值**
      //    （它本来是给测试场复现用的），拿它当每局的种子 = 每局都生成一模一样的楼，
      //    「随机生成」四个字就没了。下面把 `runSeed` 留在场上，方便复现整局。
      this.rooms = roomsConfigFromCache(this.cache.json)
      // **整局的每一层平面图一次取好**（★ 2026-10-22）：第 1 层是逸夫楼 1F、
      // 第 2 层是 3F、第 3 层是 6F，走的是 `floors.json` 那张表。
      // ⚠️ **顺序**：`floorPlansForRun` 第二个参数要一份 `FloorPlanMetrics`，
      //    而 `RoomsConfig` 结构上满足它（签名就是这么写的）。
      //    所以三个 `this.xxx` 之间是**有依赖的**，别为了「看着对称」把行换个位。
      // ⚠️ 三层校验（条数 = `arena.maxStages` / 文件都加载过 / 每份都解析得过）
      //    都在那个函数里，**取不到就当场抛** —— 不降级、不兜底（2.8）：
      //    「少一层就用上一层凑」会让这一局的几何与配置表说的不是一回事。
      this.plans = floorPlansForRun(this.cache.json, this.rooms, this.floors)
      this.runSeed = (Math.random() * 0x7fffffff) | 0
      // **整局的每一层种子先抽好**（不是每下一层现抽一个）：这样报出 `runSeed`
      // 就能把整局的每一层都复原出来，而不只是「当前这一层」。
      this.floorSeedList = floorSeeds(this.runSeed, this.floors)
      this.dungeon = this.buildFloor(1)
      // ⚠️ **竞技场 = 整层包围盒**，必须在 `new CombatSession()` **之前**写回去：
      //    物理世界边界、寻路网格的行列数、`TerrainMap` 的宽高全在构造函数里读它，
      //    之后再改就晚了（`TerrainMap.width` 还是 readonly）。见 `applyArena()`。
      this.applyArena()
      // 过 D1 自己的校验器。**不是形式**：关编号、标识唯一、矩形不越界、
      // 出生点不在墙里 —— 四条都是这个接法最容易错的地方，而错了都不报错。
      // ⚠️ 关卡数传 `FLOOR_STAGE`（= 1）：整层**只有一关**，见 `DungeonStages`。
      this.stageConfig = parseStageCollisions(this.dungeon.stages, FLOOR_STAGE)
      this.drawWorld()
      this.session = new CombatSession(
        this,
        this.bundle,
        this.cfg,
        this.rewardDefs,
        this.difficulty,
        this.stageConfig,
      )
      this.fitCamera()
      this.scale.on('resize', this.fitCamera, this)
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
        this.scale.off('resize', this.fitCamera, this),
      )
      this.minimap = new Minimap(this, this.dungeon.map, this.rooms, this.floor, this.floors)
      // 楼梯间里那两个入口（上楼 / 下楼）。**两个都要先建出来**，哪怕第 1 层
      // 下面没有楼 —— 「这一层有没有楼下」是 `refreshStairPads()` 每层现判的事。
      // ⚠️ `dir` 与字段名一一对应：`exitUp` 画朝上的箭头（暖黄，「上一层」），
      // `exitDown` 画朝下的（青绿，「下一层」）—— 见 `FloorExit.LOOKS`。
      this.exitUp = new FloorExit(this, { reach: EXIT_REACH, dir: 'up' })
      this.exitDown = new FloorExit(this, { reach: EXIT_REACH, dir: 'down' })
      // ★ 2026-10-23：电梯的楼层面板（走进去弹、走出去关）。选完直接换层。
      // ⚠️ **从电梯走的人，落地要出现在那一部电梯前**（用户 2026-10-23）——
      //    所以把「现在站在哪一部电梯里」一起带进 `goToFloor()`。
      this.elevatorPanel = new ElevatorPanel((floor) => {
        const here = this.roomOrder >= 0 ? this.dungeon.rooms[this.roomOrder] : undefined
        this.goToFloor(floor, here?.room.kind === 'elevator' ? here.room.id : null)
      })
      this.rewardPanel = new RewardPanel(this.session)
      this.gallery = new AssetGallery(this, () => this.toggleGallery())
      this.makeHud()
      this.cursor = new GameCursor(this)
      // 换层键（上 / 下都用它，按下去往哪边走看脚下踩着哪个方框）。
      // **和拾取的 `E`、暂停的 `ESC` 错开**，别让人捡东西时误按。
      this.passKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F)
      this.loot = new FirstBossLoot(this, this.session)
      this.loadout = new LoadoutHud(this, this.session)
      this.skillHud = new SkillHud(this, this.session)
      this.bossLabel = this.add
        .text(0, 0, '', {
          fontFamily: 'Microsoft YaHei',
          fontSize: '13px',
          color: '#ffd7a0',
          stroke: '#101426',
          strokeThickness: 4,
          align: 'center',
        })
        .setOrigin(0.5)
        .setDepth(4500)
      this.session.bus.on('entity_killed', (event) => {
        // 首领也不例外：**每一间都是「清完 → 开箱 → 门开」**，首领那间不再单独掉。
        if (event.bossStage === this.floor) this.notice.setText('首领已击败')
      })
      // 成长选完（或没有可选项）之后：**把这一间收尾**，再说清「接下来去哪儿」。
      //
      // ⚠️ 这一条是**按房**判的，不是按「第几间」——`event.roomId` 里装的是
      //    `Room.id`（`YF604` 这种），不是 v4 那个自己拼的 `d1-room-7`。
      this.session.bus.on('reward_finished', (event) => {
        if (
          event.runId !== this.session.runId ||
          this.gameWon ||
          !this.session.player.model.alive
        )
          return
        const unit = this.roomById(event.roomId)
        if (unit === null) return
        const bonus = this.session.grantRandomWeapon()
        const label = bonus ? '获得随机武器：' + bonus.name + ' · ' : ''
        if (unit.room.kind !== 'boss') {
          this.notice.setText(label + `强化已生效 · 门开了（绿色）· 走廊里随便走，挑一间推门进去`)
          return
        }
        // **本层的首领打完了**：层内没有"下一个首领"了，改亮「下一层」的入口。
        // 最后一层不亮 —— 那是通关，走 `finishRun()`。
        if (this.floor >= this.floors) {
          this.finishRun()
          return
        }
        this.showFloorExit(bonus)
      })
      // ---- 局外成长（D4）：这一局打的账、暂停菜单、结算界面 ----
      //
      // 战斗场景需要一份档（结算要发币），但**不是**在战斗里读它改它 ——
      // 档只在"这一局结束"和"打开暂停菜单"这两个时刻被碰，核心循环里一个字都没有。
      this.store = new ProfileStore({
        storage: this.skillLab
          ? new MemoryProfileStorage()
          : new LocalStorageProfileStorage(),
      })
      this.store.load()
      if (this.skillLab) {
        this.store.update((draft) => {
          draft.unlocks.characters = CHARACTERS.map((character) => character.id)
          const characterId =
            this.skillLabCharacterId ?? CHARACTERS[0]?.id ?? 'student'
          draft.selected.characterId = characterId
          draft.upgrades[trackKey(characterId, 'skill')] = this.skillLabLevel - 1
        })
        this.skillLabCharacterId = this.store.profile.selected.characterId
      }
      this.session.player.setCharacter(this.store.profile.selected.characterId)
      const syncAudio = (): void => {
        const { bgmVolume, sfxVolume } = this.store.profile.settings
        this.session.setAudioVolumes(bgmVolume, sfxVolume)
      }
      syncAudio()
      const unsubscribeAudio = this.store.subscribe(syncAudio)
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribeAudio)
      try {
        this.meta = parseMetaConfig(this.cache.json.get(META_CONFIG_NAME))
      } catch (err) {
        // 成长表读不出来**不该让这一局玩不下去**：战斗照常，结束时退回原来那行文字。
        // （与 `MainMenuScene` 对同一份表的态度一致：那个菜单也照常能用。）
        this.meta = null
        console.error('[meta] 成长配置读不出来：', err)
      }
      this.applyProfileToRun()
      this.ledger = new RunLedger(this.session.bus)
      if (this.meta) {
        this.settlement = new SettlementOverlay({
          scene: this,
          store: this.store,
          meta: this.meta,
          host: {
            // 击杀数由账本自己从总线上数（`entity_killed`）；层数与清房数由这里报。
            runInput: () => this.ledger.input(this.runOutcome),
            restart: () => this.restartRun(),
            // 结算的「返回主菜单」回**标题画面**（D1 的 `main-menu`），
            // 不是 D4 那个局外成长主菜单 —— 打完一局先看到的是标题。
            backToMenu: () => this.backToMenu(),
            goToUpgrade: () => this.goToUpgrade(),
          },
        })
      }
      this.pauseMenu = new PauseOverlay({
        scene: this,
        store: this.store,
        host: {
          // 需求 §4.3：「暂停后敌人、子弹、伤害与战斗计时一并停止」。
          // 时钟 + 物理世界**都要**冻，理由见 `PauseOverlay` 文件头。
          //
          // 用 `'user'` 这个 reason 而不是另起一个：`update()` 里"下一轮倒计时"
          // 那段本来就靠 `reasons.has('user')` 判断要不要暂停推进。
          pause: () => this.session.pause('user'),
          resume: () => {
            // ⚠️ **两种暂停都要清**，只清 'user' 会把玩家永久卡住：
            //
            // `'hidden'` 是 `CombatSession` 自己在 `window.blur` / 标签页切走时加的
            // （防的是"人不在的时候继续挨打"）。以前的唯一出口是空格上的
            // `session.togglePause()`，而那个键现在归暂停菜单了 —— 于是"切出去过一趟"
            // 之后再点「继续游戏」，`'hidden'` 还留在集合里，时钟永远不动。
            // （实测：blur 之后菜单开着也停、关掉还停。）
            //
            // 顺序无所谓：`resume()` 只在"集合空了"的时候才真的恢复时钟，
            // 所以两条都调，谁先谁后都对。
            this.session.resume('user')
            this.session.resume('hidden')
          },
          // 暂停菜单里的「返回主菜单」**不结算**：需求 §4.3 写的是
          // 「本局进度不会保存」，确认后直接回主菜单。
          quitToMenu: () => this.backToMenu(),
          // 暂停期间这些值不会变，所以 `PauseOverlay` 只在打开时取一次快照。
          //
          // 2026-10-16 补上「能量」与「装备技能」：它们原来一直显示「—」，
          // 因为这份快照**压根没给**这几个字段 —— 不是界面的问题。（原来的注释写
          // "护盾 / 能量 / 技能在 balance.json 里还没有字段"，早就过时了：玩家现在有护盾，
          // 能量就是 `combat.json` 的 `player.maxStamina`，也就是战斗 HUD 上那条「能量」。）
          //
          // ⚠️ 三个名字指同一个东西，是**历史遗留**而不是笔误，别照着一个去改另一个：
          // 界面写「能量」，D4 的快照字段叫 `magic`（局外成长里那条成长线的 id 也是 `magic`，
          // 显示名倒是「能量上限」），D1 这边叫 `stamina`。要统一是跨域改名，得先在群里说 ——
          // 这里只做映射。
          snapshot: () => ({
            characterId: this.store.profile.selected.characterId,
            hp: Math.round(this.session.player.model.hp),
            maxHp: this.session.player.model.maxHp,
            shield: Math.round(this.session.player.model.shield),
            maxShield: this.session.player.model.maxShield,
            magic: Math.round(this.session.player.stamina),
            maxMagic: this.session.player.maxStamina,
            weaponName: this.session.weapon.name,
            skillName: this.skillNames(),
          }),
        },
      })
      this.bindKeys()
      // 出生点就在楼梯间门外的走廊上（`DungeonStages.spawn`），一帧都不用进房。
      this.syncRoomState()
      // 开局这一屏也要走一遍 `refreshStairPads()`：上/下两个入口的可见性是它一处
      // 算的，别让"开局这一层"成为唯一一条不走它的路径（那正是「以后有人给第 1 层
      // 加了个入口、而它只在换层时才亮」这类错的温床）。
      // ★ 2026-10-22 晚起，第 1 层（逸夫楼 1F）**真的会亮一个**：它没有首领房 =
      // 没有门槛（`bossDown()`），所以一进游戏，楼梯间北半那个暖黄的「上一层」
      // 就已经亮着 —— 这正是用户要的「进去后先是 YF1，然后可以从楼梯间上一层」。
      this.refreshStairPads()
      // 电梯面板这时是关着的（玩家不在电梯间里），建出来就行 —— 走进去才弹。
      this.notice.setText(this.floorBrief())
    } catch (e) {
      this.showFatal(e)
    }
  }

  /** 把当前测试/正式档里的角色被动和技能重新应用到本局。 */
  private applyProfileToRun(): void {
    if (!this.meta) return
    const characterId = this.store.profile.selected.characterId
    const permanent = effectiveStats(this.store.profile, this.meta, characterId)
    this.session.player.setCharacter(characterId)
    this.session.applyPermanentRunStats({
      maxHp: effectiveMaxHp(this.bundle.balance.baseline.player.maxHp, permanent),
      maxStamina: effectiveMaxEnergy(this.cfg.player.maxStamina),
      maxShield: effectiveMaxShield(this.cfg.player.maxShield),
      attackSpeedPct: 0,
      moveSpeedPct: permanent.moveSpeedPct,
      energyRegenPct: permanent.energyRegenPct,
    })
    const characterSkill = this.meta.characters[characterId]?.skill
    const skillLevel = skillLevelOf(this.store.profile, this.meta, characterId)
    const rank = characterSkill?.levels[Math.max(0, skillLevel - 1)]
    if (!characterSkill || !rank) return
    this.session.configureCharacterSkill({
      id: characterSkill.id,
      name: characterSkill.name,
      kind: characterSkill.kind,
      level: skillLevel,
      cooldownMs: rank.cooldownMs,
      durationMs: rank.durationMs,
      attackSpeedPct: rank.attackSpeedPct,
      distance: rank.distance,
      dashMs: rank.dashMs,
      dashDamage: rank.dashDamage,
      iframeMs: rank.iframeMs,
      attackSpeedPerEnemyPct: rank.attackSpeedPerEnemyPct,
      maxMechanicEnemies: rank.maxMechanicEnemies,
      pageDamage: rank.pageDamage,
      fireIntervalMs: rank.fireIntervalMs,
      range: rank.range,
      maxCharges: rank.maxCharges,
    })
  }

  /** 测试场专用状态。正式入口始终返回 null。 */
  skillLabState(): SkillLabState | null {
    if (!this.skillLab || !this.meta) return null
    const characterId = this.store.profile.selected.characterId
    const character = this.meta.characters[characterId]
    if (!character) return null
    const level = skillLevelOf(this.store.profile, this.meta, characterId)
    const rank = character.skill.levels[Math.max(0, level - 1)]!
    return {
      characterId,
      characterName: characterById(characterId)?.name ?? characterId,
      skillName: character.skill.name,
      level,
      lines: this.skillLabLines(character.skill.kind, rank),
    }
  }

  /** 测试场专用角色切换。 */
  cycleSkillLabCharacter(delta: number): boolean {
    if (!this.skillLab) return false
    const ids = CHARACTERS.map((character) => character.id)
    const current = Math.max(0, ids.indexOf(this.store.profile.selected.characterId))
    const next = (current + delta + ids.length) % ids.length
    const characterId = ids[next]
    if (!characterId) return false
    this.skillLabCharacterId = characterId
    this.store.update((draft) => {
      if (!draft.unlocks.characters.includes(characterId)) {
        draft.unlocks.characters.push(characterId)
      }
      draft.selected.characterId = characterId
      draft.upgrades[trackKey(characterId, 'skill')] = this.skillLabLevel - 1
    })
    this.applyProfileToRun()
    return true
  }

  /** 测试场专用技能等级调整，范围为 1—4。 */
  changeSkillLabLevel(delta: number): boolean {
    if (!this.skillLab || !this.meta) return false
    const characterId = this.store.profile.selected.characterId
    const level = skillLevelOf(this.store.profile, this.meta, characterId)
    const next = Phaser.Math.Clamp(level + delta, 1, 4)
    if (next === level) return false
    this.skillLabLevel = next
    this.store.update((draft) => {
      draft.upgrades[trackKey(characterId, 'skill')] = next - 1
    })
    this.applyProfileToRun()
    return true
  }

  private skillLabLines(
    kind: 'haste' | 'dash' | 'summon',
    rank: {
      cooldownMs: number
      durationMs: number
      attackSpeedPct: number
      distance: number
      dashMs: number
      dashDamage: number
      iframeMs: number
      attackSpeedPerEnemyPct: number
      maxMechanicEnemies: number
      pageDamage: number
      fireIntervalMs: number
      range: number
      maxCharges: number
    },
  ): string[] {
    if (kind === 'haste') {
      return [
        `冷却 ${rank.cooldownMs / 1000}s`,
        `攻速 +${rank.attackSpeedPct}%`,
        `持续 ${rank.durationMs / 1000}s`,
      ]
    }
    if (kind === 'summon') {
      return [
        `冷却 ${rank.cooldownMs / 1000}s`,
        `参考书 ${rank.durationMs / 1000}s · 射程 ${rank.range}px`,
        `书页 ${rank.pageDamage} 伤害 / ${rank.fireIntervalMs}ms`,
        `充能 ${rank.maxCharges}`,
      ]
    }
    const lines = [
      `冷却 ${rank.cooldownMs / 1000}s`,
      `突进 ${rank.distance}px / ${rank.dashMs}ms`,
      `沿途伤害 ${rank.dashDamage} · 无敌 ${rank.iframeMs}ms`,
    ]
    if (rank.attackSpeedPerEnemyPct > 0) {
      lines.push(
        `穿敌 +${rank.attackSpeedPerEnemyPct}% 攻速/名，最多 ${rank.maxMechanicEnemies} 名`,
        `Buff ${rank.durationMs / 1000}s`,
      )
    }
    return lines
  }

  override update(_time: number, delta: number): void {
    if (!this.session) return
    this.driveGrab(delta)
    this.trackPlayerRoom()
    // `F` 只管**换层**（楼梯间里那两个入口）—— 门是走过去就行的，没有"过门键"了。
    // 人活着、没暂停才认 —— 也别在切走标签页的时候吃按键。
    if (
      Phaser.Input.Keyboard.JustDown(this.passKey) &&
      !this.session.reasons.has('hidden') &&
      !this.session.reasons.has('user') &&
      // 抓取期间只剩挣脱：换层键也不认（那时候人还挂在怪身上）
      !this.grabbing &&
      this.session.player.model.alive
    ) {
      // ⚠️ **两个入口各问各的**，顺序不代表优先级：两个方框之间隔得比
      //    「够得着」的门槛远（`stairPadSpots()`），所以**永远不会同时成立**。
      //    真要有一天同时成立了，说明有人把方框挪近了/把门槛调大了 ——
      //    那时该改的是那两个数，而不是在这里挑一个先判。
      const px = this.session.player.x,
        py = this.session.player.y
      // ★ 改了（2026-10-23）：**电梯不再用 `F`** —— 走进电梯间弹的是楼层面板，
      // 点一下 / 按数字键就走（`ElevatorPanel`）。`F` 只剩楼梯间那两个方框。
      if (this.exitUp.visible && this.exitUp.near(px, py)) this.goUp()
      else if (this.exitDown.visible && this.exitDown.near(px, py)) this.goDown()
      else if (this.exitUp.visible || this.exitDown.visible)
        this.notice.setText(this.stairHintWhenMissed())
    }
    this.exitUp.update(this.time.now)
    this.exitDown.update(this.time.now)
    this.trackChestOpened()
    // 门一开就换成亮绿 + 呼吸 —— 打完一间找不到门出不去是这一层最容易卡人的地方。
    // 用场景时间（`this.time.now`）而不是 `performance.now()`：暂停时场景时间会停，
    // 画面才是静的。
    this.scenery.update(this.time.now)
    this.session.update(delta)
    this.loot.update()
    this.loadout.update()
    this.skillHud.update()
    this.checkRoomCleared()
    // 首领血条：**按「层」查，不是按「房间」**。
    //
    // `bossStatus(n)` 查的是出生时推给那只怪的那个编号（`spawnBoss(tier)`），
    // 而首领现在带的是**层的序号**。早先这里查的是「第几间」，于是除了个别房间
    // 基本都查不到 —— 血条压根不显示，而且不报任何错。
    const boss = this.session.enemies.bossStatus(this.floor)
    this.bossLabel.setVisible(!!boss)
    if (boss)
      this.bossLabel
        .setPosition(boss.x, boss.y - (this.isBossRoom() ? 92 : 78))
        .setText(
          `第 ${this.floor} 层 · ${this.bossName(this.floor)}` +
            `\n${Math.ceil(boss.hp)} / ${boss.maxHp}`,
        )
    if (this.clearRequested && !this.session.clock.paused) this.session.enemies.simulateClear()
    this.layoutHud()
    this.updateHud()
    const ended = this.gameWon || !this.session.player.model.alive
    if (ended) this.endRun(this.gameWon ? 'cleared' : 'dead')
    // 结算面板铺上去之后就不需要这行兜底文字了（面板上的信息更全）。
    // 只有成长表读不出来、结算建不出来时，才退回原来那套"按 R 重新开始"。
    const fallbackNotice = ended && this.settlement === null
    this.deathNotice.setVisible(fallbackNotice)
    if (fallbackNotice) {
      this.deathNotice.setText(
        this.gameWon
          ? `${this.floors} 层通关！\n${this.bossName(this.floors)}已击败\n按 R 重新开始`
          : this.session.player.model.deathCause === 'water'
            ? '落水身亡\n按 R 重新开始'
            : '你倒下了\n按 R 重新开始',
      )
      const camera = this.cameras.main
      this.deathNotice.setPosition(camera.width / 2, camera.height / 2)
    }
    this.gallery?.update(delta)
  }

  /* ------------------------------------------------------------ 整层连续：一间房的生命周期 */

  /**
   * **每帧算一次「我站在哪一间」**，变了就转接。整层连续里这是唯一的"进度"来源。
   *
   * ⚠️ `inset` 取玩家半径，与 `roomAt()` 的文档说的同一件事：不取 inset 的话，
   * 人刚跨过门口那条线（身体还有一截在门洞里）就算「进来了」，
   * 而**封门与刷怪都发生在那一刻** —— 封门是把门洞那一格变成实体，
   * 玩家的身体正压在上面，物理会把他弹一下。
   */
  private trackPlayerRoom(): void {
    if (this.gameWon || !this.session.player.model.alive) return
    const radius = this.session.player.model.stats.radius
    const unit = roomAt(this.dungeon.rooms, this.session.player.x, this.session.player.y, radius)
    const order = unit?.order ?? -1
    if (order === this.roomOrder) return
    this.session.clearRoomSkillObjects()
    this.roomOrder = order
    // 走到走廊里：把「现在在哪一间」清掉（小地图的黄点本来就在那儿，见 `setPlayer`）。
    if (unit === null) {
      this.syncElevatorPanel(null)
      this.syncRoomState()
      return
    }
    this.enterRoom(unit)
  }

  /**
   * 进一间房。**第一次进和回走是两件事** —— 回走的房间不刷怪、不封门、
   * 也不重发成长（「能回头」不该变成惩罚，也不该变成刷怪机）。
   */
  private enterRoom(unit: DungeonRoom): void {
    // ⚠️ **离开这一间之前先把宝箱结账**（见 `settleChest()`）：出了这道门，
    //    下面任何一条分支都可能 `loot.reset()` 把它连同「开过没有」一起抹掉。
    this.settleChest()
    // ★ 2026-10-23：电梯面板**跟着「人现在在哪一间」开关** —— 走进电梯间弹、
    //    走进别的房（或走廊）关。放在最前面：后面每条分支都会 return。
    this.syncElevatorPanel(unit.room.kind)
    // ⚠️ **「还在打」要排在最前面，而且只看 `combatRooms`，不看 `visited`。**
    //
    // `roomAt()` 的判据是「身体整个进到房间里」（`inset = 玩家半径`），而门就开在房间的
    // 边界上 —— 于是**顶着封着的门站在门里的人**会被判成「不在任何一间房里」。
    // 玩家贴着门站、又走回来，就构成一次「重新进入」，而这时 `visited` 里已经有它了。
    //
    // 早先没有这一段，那么这一下会掉进下面的「回走」分支，通知栏印出
    // **「已清过，放心走」—— 而满屋子的怪就在他身边**。不抛错、不影响判定
    // （封门读的是 `combatRooms`，不是这里），只在画面上说反话。
    if (this.combatRooms.has(unit.order)) {
      this.syncRoomState()
      this.notice.setText(this.roomBrief(unit))
      return
    }
    const first = !this.visited.has(unit.order)
    this.visited.add(unit.order)
    if (!unit.needsFight) {
      // 不用打的房间：**一只都不刷**，门也不封。里面装的是什么，分两种 ——
      // 见下面的两支。**两支都要排在「回走」之前**（理由在下面那一段里）。
      if (roomHasChest(unit.room.kind)) {
        // 道具关 / 宝箱关：**要给宝箱** —— 不打怪的房间里如果连宝箱都没有，
        // 它就是个纯过道，玩家没有理由进来。（`chest` / `reward` 这类关别
        // 存在的意义就是「进来拿东西」。）
        //
        // ⚠️ 它**不发成长**：清房事件只从「打完怪」来。早先无条件发，玩家的体感是
        //    「打完怪给了一次，过一道门又给一次」，而那两间其实是**两件不同的事**。
        //
        // ⚠️ **这一段排在下面的「回走」之前，是 2026-10-21 改的。** 原来它排在后面，
        //    于是**回走的道具房再也拿不到宝箱**：第一次进来时宝箱生成了，出门去别的房
        //    那一趟 `loot.reset()` 把它销毁（宝箱只有一个位子），再回来时 `first === false`
        //    直接走「已清过，放心走」—— 宝箱**永久消失**，而且通知栏还说这间有宝箱。
        //    用户报的「宝箱生成和显示有问题」里就有这一半。
        //
        // ⚠️ **但「不用打」不是判据，「这一间装的是宝箱」才是。** 这一段原来是
        //    `if (!unit.needsFight)` 本身，于是**楼梯间也捞到了一个宝箱**
        //    （它的关别 `start` 同样不打架）—— 用户 2026-10-21 报的
        //    「进入楼梯间会生成一个宝箱，这不对」。判据搬回 D2 的 `roomHasChest()`，
        //    加新的非战斗关别时得在那里明确表态。
        //
        // 这一间的 `cleared` **不在这里写**：它的「做完」是**开箱**，见 `trackChestOpened()`。
        if (this.chestRoom !== unit.order) {
          // 宝箱**是这一间的东西**：开过就不再生（否则出门再进门 = 重抽武器），
          // 没开过则每次进来都摆回**同一个位置**（正中心）。`chestRoom` 已经等于
          // 这一间时什么都不做 —— 宝箱还在原地，连地上的武器都别动它。
          if (!this.lootedRooms.has(unit.order)) {
            this.loot.reset()
            const spot = chestSpotAtCenter(unit)
            this.loot.spawn(spot.x, spot.y)
            this.chestRoom = unit.order
          }
        }
        this.syncRoomState()
        this.notice.setText(
          `${unit.room.id} ${this.kindLabel(unit)} · 这间不用打 · ` +
            (this.lootedRooms.has(unit.order) ? '宝箱已开过' : '有宝箱（E 开）') +
            ' · 门一直开着',
        )
        return
      }
      // 楼梯间：**过道，不是一间内容房**（用户 2026-10-21：「楼梯间不算起点，
      // 应该是每层之间的中转站」）。里面没有怪、没有宝箱，**也不进 `cleared`** ——
      // 它没有"做完"这件事，房号那行字就一直读作「不用打」。
      //
      // 它有的是**上下楼的入口**（那两个方框），而那件事每层都可能不同
      // （第 1 层下面没有楼、没打完首领的层上不去），所以每进一次现算一遍。
      //
      // ★ 改了（2026-10-22 晚·七）：**这一支现在只给 `start`**。原来它接的是
      // 所有「不用打又没宝箱」的房 —— 空房、商店、以及新加的电梯间全挤进来，
      // 于是走进电梯间时通知栏写的是「每层之间的中转站 · 楼梯间里有下第 1 层的入口」
      // （那句是楼梯间的事，电梯里既没有楼梯也没有那两个方框）。
      if (unit.room.kind === 'start') {
        this.refreshStairPads()
        this.syncRoomState()
        this.notice.setText(this.stairBrief(unit))
        return
      }
      if (unit.room.kind === 'elevator') {
        this.syncRoomState()
        this.notice.setText(this.elevatorBrief(unit))
        return
      }
      // 其余「不用打又没宝箱」的房：空房 / 商店。门一直开着，里面什么都没有。
      this.syncRoomState()
      this.notice.setText(
        `${unit.room.id} ${this.kindLabel(unit)} · 这间不用打 · 门一直开着`,
      )
      return
    }
    if (!first) {
      this.syncRoomState()
      this.notice.setText(`${unit.room.id} ${this.kindLabel(unit)} · 已清过，放心走`)
      return
    }
    this.combatRooms.add(unit.order)
    this.activeRoom = unit
    this.clearSince = null
    this.clearEmitted = false
    this.clearRequested = false
    this.loot.reset()
    this.syncRoomState()
    this.spawnRoomEnemies(unit)
    this.notice.setText(this.roomBrief(unit))
  }

  /**
   * 把场上那个宝箱「开过没有」记到**它自己那一间**名下，然后放手。
   *
   * ⚠️ **必须在 `loot.reset()` 之前问** —— `reset()` 把 `state` 打回 `'absent'`，
   * 之后 `loot.opened` 就恒为假，再问也没有答案了。
   *
   * 只记「开过」的那一半：没开过的房间不进 `lootedRooms`，于是重进来时
   * 宝箱会照原样摆回去（`enterRoom()` 那一支），玩家不会因为出去绕了一圈就丢了它。
   */
  private settleChest(): void {
    if (this.chestRoom !== null && this.loot.opened) this.lootedRooms.add(this.chestRoom)
    this.chestRoom = null
  }

  /**
   * 宝箱**一开就算这一间做完了** —— 每帧看一眼，开了就结账。
   *
   * ⚠️ **为什么是每帧看，而不是「离开时结账」**：房号那行字（`StageBackground`）
   * 读的是 `cleared`，而玩家开完箱**不会立刻出门** —— 他要捡地上那把武器、读一读
   * 通知栏、再决定去哪儿。等他出门才变色的话，那一整段时间里地上都写着
   * 「不用打」，而箱子**已经空了**。（`settleChest()` 那条「离开时」的路径照旧保留：
   * 它是最后一道保险，万一有哪条路绕过了这里。）
   *
   * 判据是 `loot.opened`（只读），不是"宝箱还在不在" —— 开过的箱子仍然画在原地。
   */
  private trackChestOpened(): void {
    const order = this.chestRoom
    if (order === null || !this.loot.opened || this.lootedRooms.has(order)) return
    this.settleChest()
    // ⚠️ 写在 `syncRoomState()` **之前**：房号那行字读的是它。
    this.cleared.add(order)
    this.syncRoomState()
  }

  /**
   * 宝箱该摆在**这一间的哪儿**：玩家身前 60px，但**不许出这一间**。
   *
   * ⚠️ 那条「不许出这一间」不是保险，是**必需**的：`enterRoom()` 是在玩家**刚跨进门口**
   * 那一刻触发的（`roomAt()` 要求身体整个进到房里），这时玩家离门外的走廊只有十几像素 ——
   * 「玩家上面 60px」正好落在**墙外**。而走廊和房间里一样是可走地面，
   * `safeSpawn()` 看不出区别（它只认地面不认墙），于是宝箱就摆到门外去了。
   *
   * （另一半原因在 `TerrainMap.safeSpawn()` 的通行半径上，见那份注释。）
   */
  private chestSpot(unit: DungeonRoom): { x: number; y: number } {
    return chestSpotIn(
      unit,
      this.session.player.x,
      this.session.player.y,
      60,
      this.cfg.chest.visualSize / 2,
    )
  }

  /**
   * 把「走过哪些房」「封着哪些门」「现在在哪一间」一次同步给三个收件人。
   *
   * 三处**共用一个函数**，因为它们本来就是同一件事的三个投影：观感层（`StageBackground`）、
   * 缩略图（`Minimap`）、物理（`CombatSession.sealDoors`）。分成三个调用点的话，
   * 迟早有一处漏调 —— 而漏的那一处表现是「门看着开着、人却过不去」（或反过来），
   * 两个方向都不报错。
   *
   * 三个收件人**各自幂等**（`setSealed` / `setCleared` 都比对集合，`setState` 重画一次），
   * 所以每帧调也不会抖 —— 但调用点仍然只在**状态真的变了**的时候，
   * 因为 `setSealed` 会把**这一层的门**全部重画一遍。
   *
   * ⚠️ **「去过没有」和「打完没有」是两份，三个收件人要的不是同一份**：
   * 小地图的标题写着「走过 N / M 间」，问的是**去过**（`visited`）；
   * 而地上的房号和门的颜色说的是**这一间能不能走了**，问的是**打完**（`cleared`）。
   * 两边都喂 `visited` 就是用户 2026-10-21 报的那条：「刚进普通关还没打怪就显示已清」。
   */
  private syncRoomState(): void {
    const rooms = this.dungeon?.rooms ?? []
    const visited = roomIdsOf(this.visited, rooms)
    const cleared = roomIdsOf(this.cleared, rooms)
    const sealed = this.sealedDoors()
    this.scenery?.setCleared(cleared)
    this.scenery?.setSealed(sealed)
    this.minimap?.setState(this.currentRoomId(), visited)
    this.session?.sealDoors(sealed)
  }

  /**
   * 现在该封着哪些门。**判据在 D2 的 `doorShouldBeClosed()` 里**（纯函数、
   * `roomFlow.test.ts` 钉着），这里只做「把判据喂给它、把结论落到实处」。
   *
   * 今天这一条退化成 `combatRooms` 的复制（那正是判据的全部内容：**只有正在战斗的
   * 房间关门**）。仍然走一遍判据而不是直接传 `combatRooms`，是为了**只有一个地方
   * 知道那条规则** —— 规则改了（比如将来「首领房要打完才放行」）这里自动跟上。
   */
  private sealedDoors(): ReadonlySet<number> {
    const sealed = new Set<number>()
    for (const order of this.combatRooms)
      if (doorShouldBeClosed({ ownerOrder: order, combatRooms: this.combatRooms }))
        sealed.add(order)
    return sealed
  }

  /**
   * 这一间的怪还差几只（活着 + 排队还没出生的）。
   *
   * ⚠️ **起点是 `remaining`，不是 `targets().length`。**
   *
   * `remaining = 池子里活着的 + 排队还没出生的`；而 `targets()` 只有**已经出生**的。
   * 刷怪是带延迟的（第二批有 `phaseDelayMs`），所以进房间那一刻「已出生的」是 0 ——
   * 拿 `targets().length` 当判据就会**当帧判定清空**：宝箱立刻掉、门立刻开、
   * 一层楼一间房都没打就"通关"了。
   *
   * 然后从这里扣掉**不在这一间里 / 已经挤出墙外再也打不到**的那些：
   * 前者是位置判据（怪被物理推到隔壁去了），后者是 `reachableRemaining()` 原来那道
   * 兜底（重叠的静态体会把怪继续往外推，于是它卡在墙外，而清场判定数的是"还活着的"
   * → **这一间永远清不完，卡死**）。
   */
  private roomRemaining(unit: DungeonRoom): number {
    const enemies = this.session.enemies
    let outside = 0
    for (const t of enemies.targets()) {
      const r = unit.room.rect
      const inside =
        t.x >= r.x - r.width / 2 &&
        t.x <= r.x + r.width / 2 &&
        t.y >= r.y - r.height / 2 &&
        t.y <= r.y + r.height / 2
      if (!inside || !this.session.terrain.isWalkable(t.x, t.y, 4)) outside++
    }
    return Math.max(0, enemies.remaining - outside)
  }

  /**
   * 清房判定：**这一间的怪清完 + 安静够 `settleMs`**。
   *
   * 两个条件缺一不可，各自的理由见 `clearSince` 与 `roomRemaining()`。
   * 宣告只发一次（`clearEmitted`），而「回走」的房间根本不进这条路径
   * （`activeRoom` 是 `null`）。
   */
  private checkRoomCleared(): void {
    const unit = this.activeRoom
    if (unit === null || this.clearEmitted || this.gameWon) return
    if (!this.session.player.model.alive || this.session.clock.paused) return
    if (this.roomRemaining(unit) > 0) {
      this.clearSince = null
      return
    }
    const now = this.session.clock.nowMs
    if (this.clearSince === null) {
      this.clearSince = now
      return
    }
    if (now - this.clearSince < this.rooms.settleMs) return
    this.onRoomCleared(unit)
  }

  /**
   * 这一间清完了。**顺序是有讲究的**（三件事不能颠倒）：
   *
   * 1. **先解封**（`combatRooms.delete` + `syncRoomState`）—— 门开着是这一间的结果，
   *    而下一步发出去的事件会**当场暂停游戏**（`CombatSession` 收到 `room_cleared`
   *    会 `pause('reward')` 并弹三选一）。排在后面的话，暂停期间门还是封的，
   *    而玩家选完之后看到的是「强化生效了但门没开一下」。
   * 2. **宝箱**（只给精英关）—— 和 v4 一样：普通战斗房给三选一就够了，
   *    每一间都塞一个宝箱，宝箱就不值钱了。
   * 3. **最后才发 `room_cleared`** —— 它带着 `Room.id`（不是自己拼的房间号），
   *    因为奖励是**按房**记账的（`RewardRun.completedRooms`）：
   *    键撞了的话，重进一间已清过的房会再发一次成长。
   */
  private onRoomCleared(unit: DungeonRoom): void {
    this.clearEmitted = true
    this.clearRequested = false
    this.activeRoom = null
    this.combatRooms.delete(unit.order)
    // ⚠️ **写在 `syncRoomState()` 之前** —— 房号那行字和门的绿都读 `cleared`，
    //    排在后面的话要等下一次同步才变色（表现是「门开了但房号还写着没打」）。
    this.cleared.add(unit.order)
    this.syncRoomState()
    this.ledger.countClearedRoom()
    if (unit.room.kind === 'elite') {
      this.loot.reset()
      const spot = this.chestSpot(unit)
      this.loot.spawn(spot.x, spot.y)
    }
    this.session.bus.emit('room_cleared', {
      runId: this.session.runId,
      roomId: unit.room.id,
    })
    // ⚠️ **精英那一间也要更新通知栏。** 早先这一句套在 `kind !== 'elite'` 里，
    // 于是清完精英房之后屏幕上还留着一行「门已封上，清完才开」—— 门其实已经开了，
    // 而这一行正是玩家判断「现在能不能出去」的依据。（实测 2026-10-21 走一遍时看到。）
    this.notice.setText(
      unit.room.kind === 'elite'
        ? `${unit.room.id} ${this.kindLabel(unit)} · 清怪完成 · ★ 宝箱已出现（E 开）· 选择一项强化`
        : `${unit.room.id} ${this.kindLabel(unit)} · 清怪完成 · 选择一项强化`,
    )
  }

  /**
   * 在一间房里刷怪。**位置全部来自 D2 给的刷怪点**，不是「以玩家为圆心撒一圈」——
   * 后者是按旧的大竞技场调的，撒在一间教室里等于怪全糊在玩家脸上。
   */
  private spawnRoomEnemies(unit: DungeonRoom): void {
    const cx = this.session.player.x,
      cy = this.session.player.y
    // ⚠️ **离玩家进这间房时站的位置太近的刷怪点要跳过。**
    //    刚推门进来那一下是躲不开的，怪贴脸出生不是难度，是偷袭。
    //    落点全被滤掉时退回**最远的那个点**，而不是退回玩家脚下 ——
    //    宁可怪从房间那头走过来，也不要它长在玩家身上。
    const far = (q: { x: number; y: number }) => Math.hypot(q.x - cx, q.y - cy)
    const kept = unit.spawnPoints.filter((q) => far(q) >= SAFE_SPAWN_GAP)
    const spots = kept.length
      ? kept
      : unit.spawnPoints.length
        ? [unit.spawnPoints.reduce((a, b) => (far(b) > far(a) ? b : a))]
        : []
    // ⚠️ **刷怪点也要过 `safeSpawn()`。**
    //    D2 的刷怪点是从门可达的，但**不一定离墙够远** —— 怪的物理体一出生就
    //    和墙重叠，物理解算会把它**继续往外推**（已经重叠的静态体，推开方向由
    //    最小穿透轴决定，可能是墙外），于是它卡在墙外再也回不来，
    //    而清场判定数的是「还活着的怪」→ **这一间永远清不完，卡死**。
    const at = (i: number) => {
      const raw = spots.length === 0 ? { x: cx, y: cy } : spots[i % spots.length]!
      // ⚠️ 最后一个参数是**通行半径**（走得到那儿的是谁）= 玩家，不是怪的净空。
      //    见 `TerrainMap.safeSpawn()`：门洞比怪窄的房间（如种子 20261012 的 YF611），
      //    拿 26 去泛洪会把整间房判成「不可达」，刷怪点被扔到**隔壁房和走廊**。
      return this.session.terrain.safeSpawn(
        raw.x,
        raw.y,
        ENEMY_CLEARANCE,
        this.session.player.model.stats.radius,
      )
    }
    // 怪比刷怪点多时同一个点会叠人 —— 按序号错开一点，避免完全重合
    const offset = (i: number) => (spots.length && i >= spots.length ? (i % 3) * 26 - 26 : 0)
    // ⚠️ **强度按这一间的威胁预算来，不按层号。**
    //    `Room.budget` 由 D2 按「到楼梯间的跳数」算（`gen/budget.ts`），
    //    `budgetBase` 是 `t = 0`（出生点旁边那间）的值 —— 比值正好是强度倍数。
    const growth = unit.room.budget / this.rooms.budgetBase
    const p = roomPlan(this.bundle, this.cfg, this.difficulty, growth)
    for (let i = 0; i < p.splitters; i++) {
      const s = at(i)
      this.session.enemies.spawn(
        'splitter',
        0,
        s.x + offset(i),
        s.y + offset(i),
        i >= Math.ceil(p.splitters * p.secondPhaseFraction) ? p.phaseDelayMs : 0,
      )
    }
    // 抓取怪：第三个轴（`arena.initialGrabbers`，可以是小数 = 概率）。
    // 靠近楼梯间的那几间算出来是 0 只 —— 先让玩家在别处认识「!」，再让它来抓人。
    for (let i = 0; i < p.grabbers; i++) {
      const k = p.splitters + p.tanks + i
      const s = at(k)
      this.session.enemies.spawn('grabber', 0, s.x + offset(k), s.y + offset(k))
    }
    for (let i = 0; i < p.tanks; i++) {
      const s = at(p.splitters + i)
      this.session.enemies.spawn(
        'tank',
        0,
        s.x + offset(p.splitters + i),
        s.y + offset(p.splitters + i),
      )
    }
    // 首领：**只有 `kind === 'boss'` 那一间出**。别的房间一只都不出 ——
    // 一局三层，三个首领，一层一个。
    //
    // ★ 改了（v5）：v4 这里写的是「只有本层的**最后一间**出（D2 只把它放在末间、
    // 而且不放侧室里）」—— 「末间」是进度轴的说法，「侧室」随 `Room.branch` 删了。
    // v5 里 D2 在平面图上**写死**是哪一间：YF604（一层 16 间里排第 5）。
    //
    // ⚠️ **别改回「主干上每一间都出一个」。** 那是「一局只有一层」时期的写法
    //    （那时一层十几间，隔几间摆一个首领才像有节奏）；现在一局三层、
    //    每层十六间房，再按主干摆就是一层两三个首领 —— 首领贬值成路障，
    //    而三个真正的首领（蘑菇 / 霜翼使徒 / 终焉蛛王）该各自守一层。
    //
    // 档位 = **层的序号**，不是房间进度：第 1 档是蘑菇首领（肉盾模板）、
    // 第 2 档是远程的霜翼使徒、第 3 档（最后一层）是终焉蛛王。`requestBoss()` 按这个号挑模板，
    // 末层那位走 `finalBoss: true`（不用远程模板 —— 那是「还没到最终战」的区分）。
    //
    // ⚠️ ★ 2026-10-22 晚：一局里第 1 档**今天不会出现** —— 第 1 层是逸夫楼 1F，
    //    它一间首领房都没有（13 间全空房），所以「蘑菇首领」这一局碰不到；
    //    真正要打的是第 2 层的霜翼使徒与第 3 层的终焉蛛王。
    //    **这是这一局的形状，不是 bug**：档位仍按层的序号取，改的是哪一层有首领。
    if (unit.room.kind === 'boss') {
      const tier = this.floor
      // 首领摆在**离房间中心最近的那个刷怪点**（`spawnPoints[0]`），再往上让 40px：
      // 首领体形大，摆在格子中心会有一截压在墙/课桌上。
      const spot = unit.spawnPoints[0] ?? { x: cx, y: cy }
      this.session.enemies.spawnBoss(
        tier,
        spot.x,
        spot.y - 40,
        this.cfg.encounter.bossHp + (tier - 1) * this.cfg.encounter.bossHpPerStage,
        tier >= this.floors,
      )
    }
  }

  /** 一间房在通知栏里的那一行：房号、关别、尺寸、刷了什么。 */
  private roomBrief(unit: DungeonRoom): string {
    const r = unit.room.rect
    return (
      `${unit.room.id} ${this.kindLabel(unit)} · ${r.width}×${r.height} · ${this.label()} · ` +
      `门已封上，清完才开`
    )
  }
  private kindLabel(unit: DungeonRoom): string {
    return ROOM_KIND_LABELS[unit.room.kind] ?? unit.room.kind
  }
  /** 按 `Room.id` 找一间，找不到给 `null`。 */
  private roomById(id: string): DungeonRoom | null {
    return this.dungeon?.rooms.find((r) => r.room.id === id) ?? null
  }
  /** 玩家现在在哪一间（`Room.id`）。拿不到时 `null` —— 小地图把 `null` 读作「不在任何一间房里」。 */
  private currentRoomId(): string | null {
    return this.dungeon?.rooms.find((r) => r.order === this.roomOrder)?.room.id ?? null
  }
  /** 现在这一间是不是首领房（`Room.kind === 'boss'`）。只影响血条往上让多少。 */
  private isBossRoom(): boolean {
    return this.dungeon?.rooms.find((r) => r.order === this.roomOrder)?.room.kind === 'boss'
  }

  /* ------------------------------------------------------------ 换层 */

  /**
   * 生成第 `n` 层（1 起）。**一层楼一份几何**：`buildFloor()` 交出来的
   * `DungeonStages.stages` 里只有一关（整层），内容（关别 / 桌椅 / 刷怪点）随种子变。
   *
   * 种子取的是**开局就抽好的那一串**（`floorSeedList`），不是现抽一个 ——
   * 这样 `runSeed` 能复现整局，而不只是「回到某一层再生成一次」。
   *
   * ★ 改了（2026-10-22）：平面图是**按层取的**（`plans[n - 1]`）—— 第 1 层是逸夫楼 1F、
   * 第 2 层是 3F、第 3 层是 6F。
   * 越界由 `floorPlansForRun()` 那层校验挡在前面（条数 = `arena.maxStages` = `floors`），
   * 所以这里的 `!` 是在断言一件**已经被验过**的事。
   */
  private buildFloor(n: number): DungeonStages {
    const seed = this.floorSeedList[n - 1] ?? this.runSeed
    return buildDungeonStages(seed, this.rooms, this.plans[n - 1]!, this.cfg)
  }
  /**
   * 把**整层的包围盒**写回 `cfg.arena`。
   *
   * ⚠️ **这一步不是可有可无的**：`DungeonStages` 交出的几何是**地图坐标、1:1**
   * （它的 `sourceSize` 就是整层尺寸），而 `stageGeometry()` 的取景框是
   * `fitMapFrame(arena.width, arena.height, sourceSize…)` —— 两个数不相等时
   * 整层会被缩到七分之一并居中，而且**什么都不报**（看起来像「地图没加载」）。
   * `TerrainMap` 的宽高、物理世界的边界、寻路网格的行列数读的也是这一对。
   *
   * ⚠️ **换层时它必须是不变的**，尽管 ★ 2026-10-22 起**几何本身是逐层不同的**
   * （三层三张图：逸夫楼 1F / 3F / 6F）：`TerrainMap.width`（readonly）和物理世界边界
   * 都在 `CombatSession` 构造时定死了，改不了 —— 所以三层的**包围盒必须一样**，
   * 换层只换内容、不换尺寸。三张图逐格量出来的差别都不小（1F 是两块分开的、
   * 3F 把西头两间并成了商店），但整层 **0..263 × 0..73 格**一模一样，
   * 所以今天成立；不成立时这里**当场抛**，而不是让它以「第二层的墙全在错位」的形式出现。
   */
  private applyArena(): void {
    const arena = arenaOf(this.dungeon.map)
    if (
      this.session !== undefined &&
      (arena.width !== this.cfg.arena.width || arena.height !== this.cfg.arena.height)
    )
      throw new Error(
        `第 ${this.floor} 层的包围盒（${arena.width}×${arena.height}）与上一层` +
          `（${this.cfg.arena.width}×${this.cfg.arena.height}）不一样 —— 换层换的应该是内容，` +
          `不是尺寸（物理世界边界在 CombatSession 构造时就定死了）。` +
          `若这两层是**故意**不同大小，那要动的是那边，不是这里。` +
          `见 BattleScene.applyArena() 与 floors.json 的 _box_comment。`,
      )
    this.cfg.arena.width = arena.width
    this.cfg.arena.height = arena.height
  }
  /**
   * **上一层**（`floor++`）—— 前进方向。**只在 `exitUp` 亮着、且玩家站在上面时调用**
   * （见 `update()` 里那一段）。
   *
   * ★ 改名（2026-10-22 晚）：原叫 `descend()`，因为那时前进 = 往下走（地牢层数）。
   * 上下颠倒之后 `floor++` 就是**上楼**，名字跟着走 —— 留着旧名字的话，
   * `exitUp` 里调 `descend()` 会让每个人都在这一行上停一下。
   */
  private goUp(): void {
    if (this.floor >= this.floors) return
    // ★ 改了（2026-10-22 晚·七）：走 `goToFloor()` —— 上层永远已解锁
    // （刚站着的这一层就是往上走的起点），所以行为与原来逐字一样。
    this.goToFloor(this.floor + 1)
  }
  /**
   * **下一层**（`floor--`）—— 回去的路。**只在 `exitDown` 亮着、而玩家站在上面时调用**
   * （见 `update()`）；★ 原名 `ascend()`，与 `goUp()` 一起改名，理由同它。
   *
   * 与 `goUp()` 只差一个方向，但**两件事都要做对**：
   * ① 走之前把这一层的进度**存下来**（`leaveFloor()`）；
   * ② 落地之后 `loadFloor()` 会把那一层那份**取回来**（`progress.restore()`）。
   * 少了①，回去的那层会以「没打过」的样子长回来（怪重刷、宝箱重生、首领复活 ——
   * 而首领复活意味着**那一层的出口没了**，卡死）。少了②同理，方向相反。
   */
  private goDown(): void {
    if (this.floor <= 1) return
    this.goToFloor(this.floor - 1)
  }
  /**
   * 记下**现在这一层**的进度，然后才准换层。
   *
   * ⚠️ **必须在 `this.floor` 被改掉之前调**：存的是"刚才那一层"，用改过之后的
   * 层号去存就把第 1 层的进度记到第 2 层名下了 —— 而两个方向（上/下）都会中招。
   */
  private leaveFloor(): void {
    this.progress.save(this.floor, {
      visited: this.visited,
      cleared: this.cleared,
      lootedRooms: this.lootedRooms,
    })
  }
  /**
   * 换上**当前 `this.floor` 那一层**的几何与观感。
   *
   * ⚠️ **顺序有讲究。**几何要在 `session.loadFloor()` 之前换好（那一趟里
   * `enterStage()` 按新的 `stageConfig` 重算寻路网格与落脚点）；观感层里
   * `Minimap` 是「换一份排布」，而 `StageBackground`（和 v4 一样）**没有
   * 「换一层」这个动作**（它构造时就吃下了一层的房间表），所以只能整个重建。
   *
   * ⚠️ **所有「按房的记账」必须一起清**：`visited`（哪间进过）、`cleared`（哪间打完）、
   * `combatRooms`（哪间在打）、`lootedRooms`（哪间的宝箱开过）。不清前两个的话，
   * 新层的第 3 间会被当成「回走」—— 一进门就门大开、一只怪不刷、房号还写着「已清」；
   * 不清 `combatRooms` 的话，上一层那扇封着的门会指到新层**同一个房号**上去，
   * 表现是「刚下楼就有一间进不去」；不清 `lootedRooms` 的话，新层同号码那间
   * 的宝箱会莫名其妙地不出现。
   *
   * ⚠️ ★ 2026-10-22 晚：**三层的房号现在互不重复了**（第 1 层是 `YF1xx`、
   * 第 2 层是 `YF3xx` + `SHOP`、第 3 层是 `YF6xx`），**但这不表示这一整段可以删** ——
   * 房号只是这套记账里的两个 key 之一，另一个是 `order`：
   *
   * - `visited` / `cleared` / `combatRooms` 记的是 **`order`**，而 `order` 是
   *   「楼梯间 + 其余按 id 升序」的**每层重排的序号**（见 `model/types.ts` 的
   *   `Room.order`）—— 每一层都是 0、1、2、…，三层**逐层撞号**。
   *   不在这里换成新集合的话，第 2 层的第 1 间会顶着第 1 层第 1 间的记性上场：
   *   一进门就门大开、一只怪不刷、房号还写着「已清」。
   * - `lootedRooms` 与 `RewardRun` 记的是 **`Room.id`**，那时才轮到房号不撞这件事。
   *   房号不撞**只是**去掉了「同名」那一半风险（上一版第 2、3 层是同一张图，
   *   房号一模一样，`forgetFloor()` 是**唯一**挡着卡死的东西），
   *   `order` 那一半照旧，所以两处都留着。
   */
  private loadFloor(fromElevator: string | null = null): void {
    this.dungeon = this.buildFloor(this.floor)
    this.applyArena()
    this.stageConfig = parseStageCollisions(this.dungeon.stages, FLOOR_STAGE)
    this.scenery.destroy()
    this.drawWorld()
    this.minimap.setFloor(this.dungeon.map, this.floor, this.floors)
    // 换层：先清空**这一层**的记账，再把**这一层上次的记账**取回来
    // （没来过这一层则取回来的是 `null`，那就是一层全新的楼）。
    // 取回来之后 `visited` / `cleared` / `lootedRooms` 是三个**新集合**，
    // `progress.restore()` 给的就是副本 —— 之后这里怎么改都不会脏到快照。
    const past = this.progress.restore(this.floor)
    this.visited = past === null ? new Set() : new Set(past.visited)
    this.cleared = past === null ? new Set() : new Set(past.cleared)
    this.lootedRooms = past === null ? new Set() : new Set(past.lootedRooms)
    this.chestRoom = null
    this.combatRooms.clear()
    this.activeRoom = null
    this.roomOrder = -1
    this.clearSince = null
    this.clearEmitted = false
    this.clearRequested = false
    this.loot.reset()
    // ⚠️ **强化账本也要按层清。** 它记的是 `Room.id`。★ 2026-10-22 晚三层换成
    //    三张不同的图之后，房号不再撞了 —— 但这条**照旧要清**，理由从「同名」
    //    换成了「同一间房在上一层给过强化」这件事本身：
    //    不清的话再上一层时 `offer()` 对那一间返回 `null`，
    //    于是：三选一不弹、**那一间拿不到强化**、而「亮出下一层入口」正挂在
    //    `reward_finished` 上 ⇒ **下楼口不亮，卡在那一层**。
    //    上一版（第 2、3 层同一张图）实测过一次，见 `RewardRun.forgetFloor()`
    //    的注释（`downLit=false`）—— 那次的症状与今天的形状一样，只是触发条件
    //    从「房号相同」变成「上楼又下楼回到同一间」。
    this.session.rewards.forgetFloor()
    this.session.loadFloor(this.stageConfig)
    // ★ 2026-10-23（用户：「从电梯去其它层应该是出现在对应电梯前，而不是楼梯间前」）：
    // `session.loadFloor()` 的落脚点恒是**楼梯间门口**（`dungeon.spawn`）——
    // 坐电梯上来的人却被扔在楼梯间，等于「电梯白坐了」。所以落地之后**再挪一次**：
    // 目标层上**同 id 的那一部电梯**（`E_A` / `E_B` / `E_C` 四层同名）的正中间。
    // 找不到那部电梯（比如新的一层少了一部）就什么都不做，退回楼梯间门口 ——
    // 不抛：那是「地图少画了一个电梯间」，不该让整局崩在这里。
    if (fromElevator !== null) this.spawnAtElevator(fromElevator)
    this.syncRoomState()
    // ★ 新增（2026-10-22 晚·七）：落地即**解锁这一层**（电梯只去走到过的楼）。
    this.maxFloorReached = Math.max(this.maxFloorReached, this.floor)
    // 楼梯间里那两个入口：**每层都要重算**（第 1 层下面没楼、没打完首领的层
    // 上不去、走回来的层则是「首领早就打完了」，而第 1 层根本没有首领）。
    // 它自己会先 `hide()`。
    this.refreshStairPads()
    // ★ 换层了：电梯面板必须关掉 —— 它列的是**上一层**能去哪儿。
    this.syncElevatorPanel(null)
    // ⚠️ **通知栏必须在这里重写。** 它是「我现在在哪、该往哪走」的唯一说明，
    // 而换层之后它还留着**上一层**的话 —— 实测上到第 2 层时屏幕上写的是
    // 「第 1 层通关 · …已击败 · 回楼梯间，走到方框上按 F 到第 2 层」，
    // 而那个方框已经隐藏了（新层的首领还没打），玩家会站在出生点找它。
    this.notice.setText(this.floorBrief())
  }
  /**
   * 刚换上一层时通知栏那行字。**`create()` 与 `loadFloor()` 共用一份** ——
   * 两处各写一遍的话，改了其中一处就会出现「开局那次和下楼那次说法不一致」。
   *
   * ★ 改了（2026-10-21）：原来说的是「出生在楼梯间外的走廊上」。
   * 上/下楼都能走之后，同一句话要同时说清**两次**落地：
   * 出生、以及从楼上/楼下回来（`enterStage()` 每次都把人放回走廊上那个点）。
   * 「出生」只对第一次成立，于是换成「站在」。尾上那一截说的是楼梯间里有什么。
   */
  private floorBrief(): string {
    const stairs = this.stairHint()
    return (
      `第 ${this.floor} / ${this.floors} 层 · 站在楼梯间外的走廊上 · ` +
      `走廊里随便走，推开哪扇门就打哪一间（${this.dungeon.rooms.length} 间）` +
      (stairs === '' ? '' : ` · ${stairs}`)
    )
  }
  /**
   * 走进**电梯间**时通知栏那一行（★ 2026-10-22 晚·七）。
   *
   * 说的是「这儿能去哪」：已经解锁的层**有几个就报几个**（方框就摆在电梯里，
   * 一个已解锁的层一个）；一层都还没解锁时说明白**为什么**没有 ——
   * 不然玩家会以为电梯坏了。
   */
  private elevatorBrief(unit: DungeonRoom): string {
    const unlocked: number[] = []
    for (let n = 1; n <= this.maxFloorReached; n++) if (n !== this.floor) unlocked.push(n)
    const here = unlocked.length
      ? `面板里选一层（第 ${unlocked.join(' / ')} 层），或按数字键`
      : '别的层还没解锁 —— 先从楼梯间往上走，或打完这层的首领'
    return `${unit.room.id} ${this.kindLabel(unit)} · 电梯 · ${here}`
  }
  /**
   * 楼梯间那一间（`kind === 'start'`）。三层三张平面图（`floors.json`），
   * 但那三张把楼梯间画在**逐格相同**的位置上（`x38 y25 11×18`，见各份的
   * `_source.stairwell`）—— 所以它每层都是同一间房。**这是刻意的**：
   * 换层之后玩家落在楼梯间的同一处，方位感不用重建。
   * 但它的**内容**（要不要摆入口、摆几个）逐层不同。
   */
  private stairwellUnit(): DungeonRoom | null {
    return this.dungeon?.rooms.find((r) => r.room.kind === 'start') ?? null
  }
  /**
   * 本层首领倒下了没有。**它就是「前进方向能不能走」**（打完首领那个入口才亮）。
   * 前进是**上楼**（`exitUp`，暖黄）—— 见 `refreshStairPads()`。
   *
   * ★ 改了（2026-10-22 晚，D2 提的需求）：**这一层没有首领房 = 没有门槛**，
   * 返回 `true`。用户给第 1 层（逸夫楼 1F）的要求是「所有房间都是空房间，
   * 不生成任何东西」—— 那一层因此一间 `kind === 'boss'` 都没有，而它排在一局的
   * **第 1 层**（`floors.json`：1F → 2F → 3F → 4F → 5F → 6F），玩家进来就得能从楼梯间上第 2 层（3F）。
   *
   * 上一版是 `unit !== undefined && cleared.has(unit.order)` —— 找不到首领房就
   * 返回 `false`，于是那一层**永远**没有前进的入口：屏幕上什么都不缺、
   * 没有任何报错，只是楼梯间里少一个青绿的箭头，而玩家会把整层翻遍找一间
   * 根本不存在的首领房。**「没有首领」与「首领还活着」是两件事，
   * 上一版把它们写成了同一件。**
   *
   * ⚠️ 上界那一侧没变：一个平面图**至多**一间首领房（`validate/contract.ts`），
   * 「最后一层必须有首领房」由 `floors.test.ts` 盯着 —— 那是**一局**的性质
   * （最后一层打不出首领就永远通不了关），不是单张图的性质。
   */
  private bossDown(): boolean {
    const unit = this.dungeon?.rooms.find((r) => r.room.kind === 'boss')
    if (unit === undefined) return true
    return this.cleared.has(unit.order)
  }
  /**
   * 重算楼梯间里那两个入口的可见性与位置。**`loadFloor()` / `create()` /
   * 打完首领 / 走进楼梯间**都走它 —— 一处算，别处只读结果。
   *
   * | | 什么时候亮 | 位置 |
   * |---|---|---|
   * | **上一层**（暖黄，`exitUp`）= **前进** | 本层首领已倒下，**且**不是最后一层（最后一层是通关，走 `finishRun()`） | 楼梯间**北半**（`spots.up`） |
   * | **下一层**（青绿，`exitDown`）= **回去** | `floor > 1`。**不看首领** —— 回去不该有任何门槛，那是玩家自己走过的楼 | 楼梯间**南半**（`spots.down`） |
   *
   * ★ 改了（2026-10-22 晚）：两行的**含义**对调了（前进从「下一层」变成「上一层」），
   * 位置也跟着对调 —— 北半 = 上楼、南半 = 下楼，与 `FloorExit` 画的箭头一个方向。
   * 一局的层号现在与楼的层号同向（1F → 2F → 3F → 4F → 5F → 6F），所以「上」既是屏幕上的上方、
   * 也是关卡前进的方向、也是楼的层数，三个意思第一次对上了。
   *
   * ⚠️ 位置**不是** `dungeon.spawn`（楼梯间门外的走廊），是**楼梯间里面**
   * （用户 2026-10-21：「去下一层的路应该出现在楼梯间里，而不是楼梯间门口」）。
   * 两个入口的位置由 `stairPadSpots()` 按楼梯间的**大小**算，再过一遍
   * `safeSpawn()` —— 楼梯间是非战斗房、里面没有桌椅（`obstacles.ts` 对非战斗房
   * 直接返回空），所以这一步今天必然落在原地；留着他管的是**将来**。
   */
  /**
   * ★ 新增（2026-10-22 晚·七）：**电梯间里那几个方框**。
   *
   * 用户：「每层添加三个电梯间，可以在电梯间选择层数前往（**仅能前往当前已解锁层数**）」。
   *
   * | | 什么时候亮 | 摆在哪 |
   * |---|---|---|
   * | 第 N 层那个方框 | `N ≤ maxFloorReached` 且 `N ≠ 当前层` | 电梯间**竖着**排（第 1 层在最上、第 3 层在最下），与楼梯间两个方框同一个画法 |
   *
   * ⚠️ **三个电梯间各一套方框**（同一层里三处都能坐电梯），不是只认某一个。
   * 方框的 `dir` 只决定**颜色与箭头**：目标更高 = 暖黄朝上、更低 = 青绿朝下 ——
   * 与楼梯间那两个入口同一套色，玩家不用重新学。
   *
   * ⚠️ 位置那次 `safeSpawn()` 与楼梯间同理：电梯间今天是非战斗房、里面没有桌椅，
   * 所以今天必然落在原地；留着它管的是**将来**（电梯间里摆了东西的那天）。
   */
  /**
   * ★ 新增（2026-10-23）：**电梯允许去的层**。
   *
   * - **来过的层**（`≤ maxFloorReached`）：随便去 —— 回下层看看是应该的。
   * - **前进的下一层**：与楼梯间**同一个门槛**（本层首领已倒，或本层根本没有首领房）。
   *   用户：「YF1 开局……可以直接**楼梯或电梯**上 YF3」—— 1F 没有首领房 ⇒ 一进游戏，
   *   电梯里就该亮着「第 2 层」那个方框，而不是要先去楼梯间走一趟才「解锁」。
   *
   * ⚠️ 两条合起来才是「已解锁」：只按 `maxFloorReached` 算的话，开局电梯是个摆设
   * （实测就是这么发现的：第 1 层一个方框都没有，只能走楼梯）。
   * 而**再往上跳**（3F 没打完首领就想坐电梯去 6F）两条都不满足 ⇒ 没有方框。
   */
  private elevatorTargets(): number[] {
    const out: number[] = []
    for (let n = 1; n <= this.floors; n++) {
      if (n === this.floor) continue
      if (n <= this.maxFloorReached) out.push(n)
      else if (n === this.floor + 1 && this.bossDown()) out.push(n)
    }
    return out
  }
  /**
   * ★ 2026-10-23：**电梯面板现在该摆什么**（用户：「进去后可以选择楼层」）。
   *
   * 一列 `第 1..N 层`：当前层标「当前」、能去的标「前往」、其余标「未解锁」。
   * **能去哪些层由 `elevatorTargets()` 一处判定**（来过的 + 楼梯间那一步能到的下一层）。
   */
  private elevatorRows(): FloorRow[] {
    const targets = new Set(this.elevatorTargets())
    const rows: FloorRow[] = []
    for (let n = 1; n <= this.floors; n++) {
      rows.push({ floor: n, here: n === this.floor, unlocked: targets.has(n) })
    }
    return rows
  }
  /** 玩家走进 / 走出电梯间时开关面板。**一处在判定，别处只读结果。** */
  private syncElevatorPanel(kind: DungeonRoom['room']['kind'] | null): void {
    if (kind === 'elevator') {
      this.elevatorPanel.show(this.elevatorRows())
      return
    }
    this.elevatorPanel.hide()
  }
  /**
   * ★ 新增（2026-10-22 晚·七）：**坐电梯去第 `target` 层**。
   *
   * 与 `goUp()` / `goDown()` 是同一件事（存下这一层 → 换层号 → `loadFloor()`），
   * 只是**跨几步**而不是一步 —— 所以它俩现在是它的特例。
   *
   * ⚠️ **这里不判「解锁」**：`goUp()` 走的也是这条路，而**往上走一层**永远该通
   * （楼梯间就是前进的路，解锁是到达之后才发生的事）—— 在函数里拦一道的话，
   * 第 1 层上第 2 层会被 `maxFloorReached = 1` 挡死。电梯的门槛在
   * `elevatorTargets()`（面板里**没解锁的层是灰的**，点不动）。
   */
  /**
   * 把玩家放到**目标层上同 id 那部电梯的门口**（走廊里，不是电梯里面）。
   *
   * ★ 改了（2026-10-23，用户：「出电梯应该在电梯门口（像之前楼梯口门口一样），
   * 不然会被层数选择硬控」）：上一版落在**电梯正中间** —— 落地那一帧
   * `roomAt()` 就判「你在电梯里」，于是**楼层选择面板立刻弹出来**把玩家按住。
   * 楼梯间那条路一直是落在**门外**（`DungeonStages.corridorPointAt`），
   * 这里照同一条：从门口往走廊迈**两格**（80px，比玩家半径 16 大得多）。
   *
   * 找不到走廊（那部电梯的门两侧都不是走廊）就退回**房间正中** —— 不抛：
   * 那是「这一层的电梯间画得不对」，不该让换层崩在这儿。
   */
  private spawnAtElevator(id: string): void {
    const unit = this.dungeon.rooms.find((r) => r.room.id === id && r.room.kind === 'elevator')
    if (unit === undefined) return
    const radius = this.session.player.model.stats.radius
    const cell = this.dungeon.map.navCellSize
    const door = unit.doors[0]
    let spot: { x: number; y: number } | null = null
    if (door !== undefined) {
      // 门是「墙上挖掉的那几格」，`x` / `y` 是它的**左上角** —— 从中点往外迈。
      const cx = door.x + door.width / 2
      const cy = door.y + door.height / 2
      // `axis === 'v'`（门开在竖直墙上）→ 人沿 x 穿过；否则沿 y 穿过。
      const alongX = door.axis === 'v'
      for (const step of [2, 1, 3]) {
        for (const sign of [1, -1]) {
          const p = alongX
            ? { x: cx + sign * step * cell, y: cy }
            : { x: cx, y: cy + sign * step * cell }
          if (this.dungeon.map.passages.some((q) => containsPoint(q.rect, p.x, p.y))) {
            spot = p
            break
          }
        }
        if (spot !== null) break
      }
    }
    const from = spot ?? { x: unit.room.rect.x, y: unit.room.rect.y }
    const at = this.session.terrain.safeSpawn(from.x, from.y, radius, radius)
    this.session.player.body.reset(at.x, at.y)
  }
  private goToFloor(target: number, fromElevator: string | null = null): void {
    if (target < 1 || target > this.floors || target === this.floor) return
    this.leaveFloor()
    this.floor = target
    this.loadFloor(fromElevator)
  }
  private refreshStairPads(): void {
    this.exitUp.hide()
    this.exitDown.hide()
    const stair = this.stairwellUnit()
    if (stair === null) return
    const spots = stairPadSpots(stair.room.rect, FloorExit.SIZE)
    const player = this.session.player.model.stats.radius
    // 净空取**半个方框**（方框不是实体，玩家要走进去）；通行半径（第四个参数）取玩家。
    const place = (p: { x: number; y: number }) =>
      this.session.terrain.safeSpawn(p.x, p.y, FloorExit.SIZE / 2, player)
    if (this.bossDown() && this.floor < this.floors) {
      const at = place(spots.up)
      this.exitUp.show(at.x, at.y)
    }
    if (this.floor > 1) {
      const at = place(spots.down)
      this.exitDown.show(at.x, at.y)
    }
  }
  /**
   * 通知栏里「楼梯间现在能做什么」那一截。**`floorBrief()` 与走进楼梯间那一下共用** ——
   * 两处各写一遍的话，改了一处就会出现「走廊里说的和进门前台说的不一样」。
   *
   * 没有可说的时给**空串**（第 1 层、这一层又有首领而且还没打完 —— 两个方向都去不了），
   * 让调用方自己决定怎么拼。
   */
  private stairHint(): string {
    const parts: string[] = []
    if (this.exitDown.visible) parts.push(`楼梯间里有下第 ${this.floor - 1} 层的入口`)
    if (this.exitUp.visible) parts.push(`楼梯间里已有上第 ${this.floor + 1} 层的入口`)
    return parts.join(' · ')
  }
  /**
   * 走进楼梯间时通知栏那一行。
   *
   * 楼梯间**没有宝箱、也不进 `cleared`**（见 `enterRoom()` 那一支），
   * 所以这一行要说的是**它有什么**：两个入口（有几个说几个），
   * 以及「还没打完首领时，楼下那个为什么没亮」—— 不然玩家会以为这一层没有出口。
   */
  private stairBrief(unit: DungeonRoom): string {
    const parts = [`${unit.room.id} ${this.kindLabel(unit)}`, '每层之间的中转站']
    const here = this.stairHint()
    parts.push(here === '' ? '门一直开着' : here)
    if (!this.exitUp.visible && this.floor < this.floors && !this.bossDown())
      parts.push(`打倒这层的首领，上第 ${this.floor + 1} 层的入口才亮在这儿`)
    return parts.join(' · ')
  }
  /**
   * 入口亮着、但玩家没站上去时按了 `F` 的那句话。
   *
   * ⚠️ 两个入口都亮时要**把两个方向都说出来**（还带颜色）：它们在同一个房间里，
   * 只说「走到方框上」的话，玩家得自己猜哪个是哪个 —— 而按错的代价是**整层楼**。
   */
  private stairHintWhenMissed(): string {
    const where = '（都在楼梯间里）'
    if (this.exitUp.visible && this.exitDown.visible)
      return `要走到方框上才能换层：暖黄 = 上第 ${this.floor + 1} 层、青绿 = 下第 ${this.floor - 1} 层${where}`
    if (this.exitUp.visible) return `要走到暖黄方框上才能上楼（第 ${this.floor + 1} 层）${where}`
    return `要走到青绿方框上才能下楼（第 ${this.floor - 1} 层）${where}`
  }
  /**
   * 在**楼梯间里**亮出「上一层」入口（前进那一个），并把话说清楚。
   *
   * ★ 改了（2026-10-22 晚）：方位一词从上到下翻了个个儿（前进 = 上楼），
   * 方框颜色跟着从青绿改成暖黄 —— 换的是**哪一个入口**，不是那一句话的写法。
   *
   * ★ 改了（2026-10-21，用户报的）：位置从 `dungeon.spawn`（楼梯间**门外**的走廊）
   * 换成 `dungeon.stairwell`（那一间房本身）。楼梯间是这一层楼唯一的上下楼口 ——
   * 入口摆在门口，等于把「中转站」挂在一个路过都不必进去的门框上；
   * 而且玩家要原地站着按两次 `F` 的语义（一次在门口、一次在下一层的门口）也说不过去。
   */
  private showFloorExit(bonus: { name: string } | null): void {
    this.refreshStairPads()
    // ★ 2026-10-23：**电梯面板也一样**，首领倒下之后「下一层」对电梯同样开门
    //（`elevatorTargets()` 读的就是 `bossDown()`）—— 玩家这时要是正站在电梯里，
    // 面板得当场多出那一层。不在电梯里时这一步只是「按当前状态刷一遍」。
    this.syncElevatorPanel(this.roomOrder >= 0 ? this.dungeon.rooms[this.roomOrder]?.room.kind ?? null : null)
    this.notice.setText(
      (bonus ? '获得随机武器：' + bonus.name + ' · ' : '') +
        `第 ${this.floor} 层通关 · ${this.bossName(this.floor)}已击败 · ` +
        `回楼梯间，走到暖黄方框上按 F 上到第 ${this.floor + 1} 层`,
    )
  }
  private finishRun(): void {
    if (this.gameWon) return
    this.gameWon = true
    this.session.weapons.clear()
    this.session.pause('victory')
    this.notice.setText(`全部 ${this.floors} 层已通关 · 按 R 开始新一局`)
  }
  /**
   * 第 `tier` 层首领的中文名。**和 `requestBoss()` 挑模板的规则是同一张表**：
   * 第 1 档是肉盾模板的首领、第 2 档是远程的霜翼使徒（名字从 `enemies.json` 读）、
   * 第 3 档（最后一层）是最终首领。
   */
  private bossName(tier: number): string {
    if (tier >= 3) return '终焉蛛王'
    if (tier === 2) return this.bundle.enemies.stage2Boss.displayName
    return '蘑菇首领'
  }

  /* ------------------------------------------------------------ 相机与观感层 */

  /**
   * 整层的**观感层**：地面、墙、门、房号，一次画完。
   *
   * ⚠️ 画的矩形与**物理撞的是同一批**（走 `stageGeometry()` 出来的那一份，
   * 不带 `frame_*` 那四块世界外沿）—— 观感与碰撞各推一遍的失败模式是
   * 「看得见的墙能穿过去、看不见的地方走不动」，两边都画得出来，而玩家只会说
   * 「这游戏碰撞坏了」。
   */
  private drawWorld(): void {
    const layout = stageGeometry(
      this.stageConfig,
      FLOOR_STAGE,
      this.cfg.arena.width,
      this.cfg.arena.height,
    )
    this.scenery = new StageBackground(
      this,
      this.dungeon.map,
      this.dungeon.rooms,
      this.rooms,
      layout.solids,
    )
  }
  /**
   * 相机：**1:1 跟着玩家走**（整层 10520×2920，塞不进屏幕）。
   *
   * ⚠️ 缩放读的是 `cfg.camera.viewWidth / viewHeight`（**相机窗口在世界里有多大**），
   * 不是屏幕分辨率 —— 这样「看得见多大一片」与分辨率无关，大屏上东西更大、
   * 看得见的范围一样（推导见 `config.ts` 的 `camera` 那一段）。
   * 原来这里算的是 `min(1, 画布 / 竞技场)`：整张图塞进屏幕。
   * 那个式子在整层连续下会得到 **0.12 倍**，画面变成一张蚂蚁大的平面图。
   */
  private fitCamera(): void {
    // ⚠️ 抓取特写期间**不许重算**：这个函数是「整层按配置取景」，
    //    挂在窗口 resize 上 —— 特写时拖一下窗口，镜头就会被拍回全景，
    //    而玩家正被按在原地连点，画面却已经拉远（看起来像卡住了）。
    if (this.grabbing) return
    const cam = this.cameras.main
    cam.setZoom(
      Math.min(
        this.scale.width / this.cfg.camera.viewWidth,
        this.scale.height / this.cfg.camera.viewHeight,
      ),
    )
    // 世界边界 = 整层。`setBounds` 之后相机不会跟出地图外（露出黑边）。
    cam.setBounds(0, 0, this.cfg.arena.width, this.cfg.arena.height)
    cam.startFollow(
      this.session.player.anchor,
      true,
      this.cfg.camera.followLerp,
      this.cfg.camera.followLerp,
    )
  }
  /**
   * 抓取特写：拉近到玩家身上。**不管 HUD** —— 所有 HUD 与覆盖层每帧都按 `1/zoom`
   * 反算自己的位置，改 zoom 它们自动跟住。
   */
  private cameraCloseUp(): void {
    const cam = this.cameras.main
    const zoom = Math.min(2.2, Math.max(1.6, cam.zoom * 2.4))
    cam.setZoom(zoom).centerOn(this.session.player.x, this.session.player.y)
  }
  private layoutHud(): void {
    const camera = this.cameras.main
    this.minimap.layout(camera)
    const uiScale = Math.min(1, Math.max(0.3, (camera.width - 36) / 450))
    this.notice
      .setScale(uiScale / camera.zoom)
      .setPosition(
        camera.width * camera.originX * (1 - 1 / camera.zoom) + 18 / camera.zoom,
        camera.height * camera.originY * (1 - 1 / camera.zoom) + (16 + 132 * uiScale) / camera.zoom,
      )
    this.deathNotice.setScale(Math.min(1, (camera.width - 32) / 320) / camera.zoom)
  }

  /* ------------------------------------------------------------ 杂项 */

  /** 现在是不是「被抓着」—— 一处的判据，别在五个地方各写一遍 `reasons.has('grab')` */
  private get grabbing(): boolean {
    return this.session?.reasons.has('grab') ?? false
  }
  /**
   * **抓取驱动**：每渲染帧跑一次。冻结世界、推近镜头、把 delta 喂给 D3 的抓取电影时间。
   *
   * ⚠️ 为什么解冻在这里按：抓取期间世界是冻结的，**敌人系统整体停机**
   * （AI、攻击、伤害账本全挂在物理 `WORLD_STEP` 上），它不可能自己解冻自己。
   * 所以「什么时候结束」这件事必须由冻结它的那一方负责，而且要有无条件兜底 ——
   * 一个解不开的抓取就是永久卡死。
   *
   * 喂给 D3 的是**渲染帧的 delta**（不是 `clock.nowMs`）：冻结时逻辑时钟停着，
   * 用它算咬人节拍永远到不了点；而渲染 delta 在切走标签页时会停（rAF 停），
   * 玩家不会在看不见的时候被咬。
   */
  private driveGrab(deltaMs: number): void {
    const status = this.session.enemies.grabStatus()
    if (status) {
      if (!this.grabbing) {
        // 抓取刚开始（扑向那一帧）：冻结 + 特写 + 玩家失去操作，**同时发生**
        this.session.pause('grab')
        this.grabFrozenMs = 0
        this.cameraCloseUp()
      }
      this.grabFrozenMs += deltaMs
      // 兜底一：拿不到结束信号就自己放人（硬上限的 4 倍 —— 正常路径早该结束了）
      const cfg = this.bundle.enemies.enemies.grabber.grab
      if (this.grabFrozenMs > cfg.biteIntervalMs * 4) {
        this.session.enemies.abortGrab()
        this.session.resume('grab')
        this.grabFrozenMs = 0
        this.notice.setText('抓取超时，已强制挣脱（这一条不该出现，出现了说明有 bug）')
        return
      }
      this.session.enemies.tickGrab(deltaMs)
      return
    }
    if (this.grabbing) {
      // 结束了（挣脱 / 超时 / 玩家死）：解冻 + 镜头还原
      this.session.resume('grab')
      this.grabFrozenMs = 0
      this.fitCamera()
    }
  }
  private makeHud(): void {
    this.statusHud = new StatusHud(this)
    this.deathNotice = this.add
      .text(0, 0, '', {
        fontFamily: 'Microsoft YaHei, sans-serif',
        fontSize: '30px',
        color: '#ffffff',
        backgroundColor: '#091522dd',
        padding: { x: 26, y: 18 },
        align: 'center',
        lineSpacing: 12,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(10000)
      .setVisible(false)
    this.notice = this.add
      .text(28, 145, '', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#9fe8c8',
        wordWrap: { width: 900 },
      })
      .setScrollFactor(0)
      .setDepth(1001)
  }
  private updateHud(): void {
    const p = this.session.player
    this.statusHud.update(
      p.model.hp,
      p.model.maxHp,
      p.stamina,
      p.maxStamina,
      p.model.shield,
      p.model.maxShield,
    )
  }
  /**
   * 暂停面板「装备技能」那一行要显示的名字。
   *
   * 每个角色只有一个固定技能；名字来自 meta，等级来自统一 skill 存档。
   */
  private skillNames(): string | undefined {
    const characterId = this.store.profile.selected.characterId
    const skill = this.meta?.characters[characterId]?.skill
    if (!skill || !this.meta) return undefined
    return `${skill.name} Lv.${skillLevelOf(this.store.profile, this.meta, characterId)}`
  }
  private toggleGallery(): void {
    if (this.gallery.root.hidden) {
      this.session.pause('preview')
      this.gallery.show()
    } else {
      this.gallery.hide()
      this.session.resume('preview')
    }
  }
  /**
   * 调试键 `C`：**请求清房**（把这一间剩下的怪全杀掉）。
   *
   * 标志位而不是直接调一次 `simulateClear()`：击杀是**异步回收**的（分裂链要等
   * `splitDelayMs`、尸体还占着池槽位），调一下走不完，得每帧推一把直到清房判定成立。
   * `clearRequested` 在 `onRoomCleared()` 里落回 false。
   */
  private requestClear(): void {
    if (this.session.clock.paused) return
    if (this.activeRoom === null || this.clearEmitted) return
    this.clearRequested = true
    this.notice.setText('已请求清房：等待死亡/分裂链回收')
  }
  private bindKeys(): void {
    const k = this.input.keyboard
    k?.on('keydown-H', () => {
      if (this.grabbing) return
      this.demoHit()
    })
    k?.on('keydown-C', () => {
      if (this.grabbing) return
      this.requestClear()
    })
    k?.on('keydown-V', () => {
      if (this.grabbing) return
      this.toggleGallery()
    })
    // `R` = **先结算、再重开**（见 `restartRun`）—— 不再是"把这一局白扔"的调试键
    k?.on('keydown-R', () => {
      if (this.grabbing) return
      this.restartRun()
    })
    k?.on('keydown-E', () => this.loot.interact())
    k?.on('keydown-ONE', () =>
      this.loot.replacementPending ? this.loot.chooseReplacement(0) : this.session.equipSlot(0),
    )
    k?.on('keydown-TWO', () =>
      this.loot.replacementPending ? this.loot.chooseReplacement(1) : this.session.equipSlot(1),
    )
    k?.on('keydown-X', () => this.session.cycleWeapon())
    if (k) {
      // 这几个键默认会让页面滚动（`Scale.RESIZE` 下画布就是整页）—— 不捕获的话
      // 按一下空格整页就跳。
      k.addCapture(['SPACE', 'ESC', 'UP', 'DOWN', 'ENTER', 'X'])
      // ⚠️ 暂停的键盘入口**只有这一处**（`togglePauseMenu`）。宿主自己再绑一个
      // "Esc 关菜单"，按一下就会同时又关又开 —— 见 `PauseOverlay` 文件头。
      k.on('keydown-ESC', () => {
        if (this.grabbing) return
        if (this.loot.replacementPending) this.loot.cancelReplacement()
        else this.togglePauseMenu()
      })
      k.on('keydown-SPACE', () => {
        if (this.grabbing || this.session.clock.paused) return
        const pointer = this.input.activePointer
        const aim = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
        this.session.activateSkill({ x: aim.x, y: aim.y })
      })
      k.on('keydown-UP', () => this.pauseMenu.handleMoveFocus(-1))
      k.on('keydown-DOWN', () => this.pauseMenu.handleMoveFocus(1))
      k.on('keydown-ENTER', () => this.pauseMenu.handleActivate())
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      k?.removeAllListeners()
      // 退订要**显式**做：`SettlementOverlay` 没订阅什么，但 `PauseOverlay`
      // 在构造里订了 `RESIZE` —— 漏掉的话重启三次就留三个重建回调。
      this.ledger?.dispose()
      this.settlement?.destroy()
      this.pauseMenu?.destroy()
      this.rewardPanel?.destroy()
      // 两个换层入口（`FloorExit` 自己画 Graphics、自己挂 Text，得显式收）。
      this.exitUp?.destroy()
      this.exitDown?.destroy()
      this.cursor?.destroy()
      this.skillHud?.destroy()
      this.loot?.destroy()
      this.gallery?.destroy()
      this.session?.destroy()
    })
  }
  /**
   * Esc / 空格的**唯一**入口（需求 §4.6：暂停按钮 / Esc → 暂停菜单）。
   *
   * 优先级是排过的，三件事不能颠倒：
   *
   * 1. **结算面板开着** → 什么都不做。结算是死胡同（需求 §4.6 只给了
   *    「重新开始」和「返回主菜单」两条路），能按 Esc 溜掉的话，
   *    玩家会在没看清"这一局得了多少币"的时候回到菜单。
   * 2. **正在选武器替换** → 这一下 Esc 是"取消"（原有的行为）。
   * 3. 其余交给 `PauseOverlay` —— 顶着菜单时它是"继续游戏"，否则是"打开菜单"。
   */
  private togglePauseMenu(): void {
    if (this.settlement?.isOpen) return
    if (this.loot.replacementPending) {
      this.loot.reset()
      return
    }
    // 只被「切走窗口」暂停时（`'hidden'`，菜单没开），这一下就是**继续** ——
    // 旧版空格走的就是这条路。不这么做的话，玩家为了回到游戏得先开一次菜单、
    // 再关掉（多按一次），而屏幕上本来就没有菜单可关，看起来就是"暂停后恢复不了"。
    // 还有一处更隐蔽的：奖励三选一的时候切走窗口，`reasons` 是 `[reward, hidden]` ——
    // 这里把 `'hidden'` 清掉之后 `'reward'` 仍然挡着，选完奖励自然就继续了。
    if (!this.pauseMenu.isOpen && this.session.reasons.has('hidden')) {
      this.session.resume('hidden')
      return
    }
    this.pauseMenu.handleToggleKey()
  }

  /**
   * 这一局结束了：**先记账，再把结算面板铺上去**
   * （需求 §4.6：血量归零 / 通关 → 结算界面 → 重新开始 / 返回主菜单）。
   *
   * ⚠️ **幂等**，见 `runEnded` 那段注释。
   */
  private endRun(outcome: RunInput['outcome']): void {
    if (this.runEnded) return
    this.runEnded = true
    this.runOutcome = outcome
    this.ledger.setDepth(this.floor)
    if (!this.settlement) return
    this.settlement.show()
  }

  /**
   * `R`：**先结算、再重开**。一次按键不再把这一局白扔。
   *
   * - 死亡 / 通关之后（面板已经开着）：结算早就发生过了，直接重开；
   * - 局进行中：记一次「主动退出」的账再重开 —— 面板在同一个 tick 里就被场景
   *   重启拆掉了，所以看不到它，但这一局的收益已经进了档。
   */
  private restartRun(): void {
    if (!this.runEnded) this.endRun('quit')
    this.settlement?.hide()
    this.restartDifficulty(this.difficulty)
  }

  /**
   * 回**标题画面**（D1 的 `main-menu`），不是 D4 那个局外成长主菜单。
   *
   * **不结算**：暂停菜单里那条「返回主菜单」按需求 §4.3 是"本局进度不会保存"，
   * 结算只有"这一局打完了"（死亡 / 通关）才发生。
   */
  private backToMenu(): void {
    this.session.destroy()
    if (this.scene.manager.keys['main-menu']) this.scene.start('main-menu')
  }

  /** 结算后的「去升级」：直接进入 D4 主菜单，并让升级弹层预先打开。 */
  private goToUpgrade(): void {
    this.session.destroy()
    if (this.scene.manager.keys['MainMenu']) {
      this.scene.start('MainMenu', { initialScreen: 'upgrade' })
    } else if (this.scene.manager.keys['main-menu']) {
      // D1 单独启动、没有注册 D4 主菜单时退回标题画面，避免静默停在结算层。
      this.scene.start('main-menu')
    }
  }

  private demoHit(): void {
    const c = this.session.clock
    this.session.player.model.takeHit({
      sourceId: -2,
      hitKey: 'd1-hurt',
      mode: 'instant',
      sourceKind: 'aoe',
      amount: this.cfg.arena.demoDamage,
      frameId: c.frameId,
      nowMs: c.nowMs,
    })
  }
  private restartDifficulty(d: Difficulty): void {
    this.session.destroy()
    this.scene.restart({
      difficulty: d,
      skillLab: this.skillLab,
      skillLabCharacterId: this.skillLabCharacterId,
      skillLabLevel: this.skillLabLevel,
    })
  }
  private label(): string {
    return this.difficulty === 'easy' ? '入门' : this.difficulty === 'hard' ? '困难' : '普通'
  }
  private showFatal(e: unknown): void {
    const m = e instanceof Error ? e.message : String(e)
    console.error(e)
    this.add.text(40, 40, `D1 初始化失败\n${m}`, {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ff8b8b',
      wordWrap: { width: 1200 },
    })
  }
}
