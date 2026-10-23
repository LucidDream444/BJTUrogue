import Phaser from 'phaser'
import { CAMPAIGN_ART } from '@/core/assetManifest'
import { COLORS } from '@/domains/procgen/presentation/floorplan'
import { ROOM_KIND_LABELS } from '@/domains/procgen/model/types'
import type { DungeonMap } from '@/domains/procgen/model/types'
import type { RoomsConfig } from '@/domains/procgen/config'
import { left, top } from '@/domains/procgen/model/rect'
import type { SolidRect } from './StageGeometry'
import type { DungeonRoom, DoorBrief } from './DungeonStages'
import { CampusMapArt } from './CampusMapArt'

/**
 * 三张参考画。★ **整层连续之后战斗里已经不用它们了**，但 `joint/_d1Scenes.ts`
 * 还在按它取图，而且「一间的底色 = 关别」那个映射本身没错 —— 留着这一份导出，
 * 不去动别人的场子。
 */
export const STAGE_BACKGROUNDS = [
  CAMPAIGN_ART.level1,
  CAMPAIGN_ART.level2,
  CAMPAIGN_ART.level3,
] as const

/** 房号字号。整层 1:1，所以这是**世界像素**，不是屏幕像素。 */
const LABEL_FONT = 20

/**
 * 房号那行字从房间中心**往上抬**多少。
 *
 * ⚠️ **它不是审美，是避让。** 非战斗房（道具关 / 宝箱关）的宝箱 2026-10-21 改成
 * 摆在**房间正中心**（`chestSpotAtCenter()`），而房号原来也画在正中心 ——
 * 于是那行字**正好横穿过宝箱**（截图里「道具」两个字被箱子压掉），
 * 而两条都在同一层画面上，谁先谁后只由 `depth` 决定，看起来就是"字缺了一半"。
 *
 * 抬 72 = 宝箱的半高 28 + 描边 5 + 一点余量，抬完那行字仍在房里
 * （最小的一间房 `YF612` 是 360×320，半高 160）。
 */
const LABEL_LIFT = 72

/** 挡板本来就有厚度，描边再往外这点像素才看得出来。**只用在观感上**，与物理无关。 */
const DOOR_INSET = 3

/**
 * The real continuous floor uses CampusMapArt materials and cropped furniture.
 * Static artwork is rebuilt on floor changes; door seals and room progress keep
 * their existing independent Graphics/state. No physics geometry is changed.
 */
export class StageBackground {
  private readonly floor: Phaser.GameObjects.Graphics
  private readonly art: CampusMapArt
  private readonly doors: Phaser.GameObjects.Graphics
  private readonly labels: Phaser.GameObjects.Text[] = []
  /** 房号 → 那个 Text。`setCleared` 要按房号改字，不靠下标对齐。 */
  private readonly labelOf = new Map<string, Phaser.GameObjects.Text>()
  private sealed: ReadonlySet<number> = new Set()
  /**
   * **打完的**那些房（按 `Room.id`）。
   *
   * ⚠️ **不是「进过的」** —— 2026-10-21 之前这里收的是 `BattleScene.visited`，
   * 而那个集合在**人刚跨进门口**那一刻就被写进去了（封门和刷怪也在那一刻）。
   * 于是普通关一进门、一只怪都没打，地上那行字就写着「已清」。
   * 用户当天报的就是这个：「刚进普通关还没打怪就显示已清」。
   */
  private cleared: ReadonlySet<string> = new Set()
  private lastPulse = -1

  constructor(
    private readonly scene: Phaser.Scene,
    map: DungeonMap,
    private readonly rooms: readonly DungeonRoom[],
    _cfg: RoomsConfig,
    /**
     * 整层的碰撞矩形 —— **与玩家撞的那一份**（`DungeonStages` 交出来的
     * `stages[0].solids`）。画的就是它，不再从 `map.walls` 另推一遍。
     *
     * `kind` 从 **id 前缀**读（`wall-1` / `desk-2` / `chair-3`）——
     * `DungeonStages` 造 id 时按种类加了前缀，那正是为了这里能分开上色。
     */
    solids: readonly SolidRect[],
  ) {
    const b = map.bounds
    this.floor = scene.add.graphics().setDepth(-120)
    this.floor.fillStyle(COLORS.outside, 1).fillRect(left(b), top(b), b.width, b.height)
    this.art = new CampusMapArt(scene, map, solids)
    this.doors = scene.add.graphics().setDepth(-101)
    this.makeLabels()
    this.refresh()
  }

  private makeLabels(): void {
    for (const unit of this.rooms) {
      const r = unit.room.rect
      const label = this.scene.add
        .text(r.x, r.y - LABEL_LIFT, '', {
          fontFamily: 'Microsoft YaHei, sans-serif',
          fontSize: `${LABEL_FONT}px`,
          color: '#e9f2ff',
          stroke: '#0b0b10',
          strokeThickness: 5,
          align: 'center',
        })
        .setOrigin(0.5)
        // Room annotations stay above world-y-sorted furniture and actors.
        .setDepth(4000)
      this.labels.push(label)
      this.labelOf.set(unit.room.id, label)
    }
  }

  /**
   * 房号那一行字。**没打过的房要说清它是什么** —— 整层连续之后「进哪一间」是玩家
   * 自己挑的（用户 2026-10-19：「可以随意在走廊走，随意选择房间进入挑战」），
   * 而挑的依据只能是门上和房里的这几个字。不写关别，玩家就是闭着眼推门。
   *
   * ⚠️ **「已清」读的是 `cleared`（打完了），不是「进过了」。** 正在打的那一间
   * 退回只写关别 —— 和「压根没进去过」长得一样。**这是对的**：`enterRoom()` 一进门
   * 就把门封上，玩家在打完之前出不去，而门封着这件事门自己会说话（橙色呼吸）。
   * 换成一个「战斗中」的话，字和门说的是两件事，改一处漏一处。
   */
  private labelText(unit: DungeonRoom): string {
    const kind = ROOM_KIND_LABELS[unit.room.kind] ?? unit.room.kind
    const done = this.cleared.has(unit.room.id)
    if (done) return `${unit.room.id} ${kind} · 已清`
    // 楼梯间：**它不打架，也不会「清」**（`BattleScene.enterRoom()` 不让它进 `cleared`），
    // 所以给它一句自己的话。用户 2026-10-21 说的是「楼梯间不算起点，应该是每层之间的
    // 中转站」—— 而这行字正是玩家在走廊上挑门时读的那一行，它得说这个。
    if (unit.room.kind === 'start') return `${unit.room.id} ${kind} · 中转站`
    if (!unit.needsFight) return `${unit.room.id} ${kind} · 不用打`
    return `${unit.room.id} ${kind}`
  }

  /** 门与房号现在长什么样，**全都按这两个集合算**。 */
  private refresh(): void {
    for (const unit of this.rooms) {
      const label = this.labelOf.get(unit.room.id)
      if (label)
        label
          .setText(this.labelText(unit))
          .setColor(this.cleared.has(unit.room.id) ? '#9ff0bd' : '#e9f2ff')
    }
    this.paintDoors(this.scene.time.now)
    // ⚠️ 记下画的是哪一帧的脉搏，`update()` 靠它决定要不要重画 ——
    //    不记的话「封着的门在呼吸」会变成「每帧重画 16 扇门」，
    //    而这里重画的是 Graphics（`clear()` + 重建全部绘制指令），不是改一个颜色值。
    this.lastPulse = this.pulseBucket(this.scene.time.now)
  }

  private pulseBucket(timeMs: number): number {
    return Math.floor(timeMs / 120)
  }

  private paintDoors(timeMs: number): void {
    const g = this.doors
    g.clear()
    // 呼吸：**只有封着的门在动**。它是「你被关在这儿」唯一会动的信号，
    // 而「哪扇门封着」这件事每打完一间就变一次 —— 静态色块容易被忽略。
    const pulse = 0.55 + Math.sin(timeMs / 260) * 0.3
    for (const door of this.doorList) {
      const closed = this.sealed.has(door.ownerOrder)
      const done = this.cleared.has(this.ownerId(door.ownerOrder))
      const color = closed ? 0xe0663a : done ? 0x8ff0b4 : COLORS.door
      g.fillStyle(color, closed ? pulse : 0.08).fillRect(
        door.x + DOOR_INSET,
        door.y + DOOR_INSET,
        door.width - DOOR_INSET * 2,
        door.height - DOOR_INSET * 2,
      )
      if (!closed) g.lineStyle(2, color, 0.7).strokeRect(door.x, door.y, door.width, door.height)
      // 封着的门再描一圈更外的边 —— 门洞只有 40px 厚，1:1 下那一条线在砖色的墙上
      // 并不显眼，而「这扇门现在过不去」是这一刻唯一要知道的事。
      if (closed)
        g.lineStyle(3, 0xffb08a, pulse).strokeRect(
          door.x - 6,
          door.y - 6,
          door.width + 12,
          door.height + 12,
        )
    }
  }

  private ownerId(order: number): string {
    return this.doorOwner.get(order) ?? ''
  }

  private get doorList(): readonly DoorBrief[] {
    return this.doorListCache ?? (this.doorListCache = this.rooms.flatMap((r) => r.doors))
  }
  private doorListCache: readonly DoorBrief[] | null = null

  private get doorOwner(): ReadonlyMap<number, string> {
    if (!this._doorOwner) {
      const m = new Map<number, string>()
      for (const r of this.rooms) m.set(r.order, r.room.id)
      this._doorOwner = m
    }
    return this._doorOwner
  }
  private _doorOwner: ReadonlyMap<number, string> | null = null

  /* ------------------------------------------------------------ 每帧的接口 */

  /**
   * 哪些门封着。传的是**应该封着的那些房号**（与 `CombatSession.sealDoors` 同一个入参），
   * 所以调用方不必记住上一帧的状态 —— 重复传同一个集合不会重画。
   */
  setSealed(sealed: ReadonlySet<number>): void {
    if (sameSet(this.sealed, sealed)) return
    this.sealed = sealed
    this.refresh()
  }

  /**
   * **打完的**房（按 `Room.id`）。喂进来的是 `roomIdsOf(this.cleared, …)` 那一份，
   * **不是** `roomIdsOf(this.visited, …)` —— 这两个集合在 `BattleScene` 里是**两份**，
   * 分别回答「打完了没有」和「去过没有」。混成一个的表现就是这条 bug：一进门就印「已清」。
   */
  setCleared(cleared: ReadonlySet<string>): void {
    if (sameSet(this.cleared, cleared)) return
    this.cleared = cleared
    this.refresh()
  }

  /**
   * 每帧一次。**只在封着的门该换一个亮度时才重画** —— 见 `lastPulse`。
   */
  update(timeMs: number): void {
    if (!this.sealed.size) return
    const bucket = this.pulseBucket(timeMs)
    if (bucket === this.lastPulse) return
    this.lastPulse = bucket
    this.paintDoors(timeMs)
  }

  destroy(): void {
    this.art.destroy()
    this.floor.destroy()
    this.doors.destroy()
    for (const label of this.labels) label.destroy()
    this.labels.length = 0
    this.labelOf.clear()
  }
}

/** 两个集合内容一样吗。用来把「每帧都传一遍」变成「变了才重画」。 */
function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false
  for (const v of b) if (!a.has(v)) return false
  return true
}
