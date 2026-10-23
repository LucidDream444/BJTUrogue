import Phaser from 'phaser'

/**
 * **换层的入口：一层楼打通之后亮在楼梯间里的「上一层」（前进），以及两层以上时一直在的「下一层」（回去）。**
 *
 * ## 为什么它必须是个看得见的东西，而不是「自动上一层」
 *
 * 一局现在有三层，层与层之间是**两个不同的事件**：一层打完了（首领死了）和
 * 「我准备好上去了」。自动上去会把后者吃掉 —— 玩家还在捡宝箱、还在想选哪个强化，
 * 画面一黑就到了新地方。所以入口是**一个要自己走过去的点**，按 `F` 才走。
 *
 * ★ 改了（2026-10-22 晚，用户：「原来的上下概念颠倒，不再是向下的地牢层数，
 * 而是向上的楼层」）：**前进方向从「下一层」变成「上一层」** —— 一局的层号
 * 与楼的层号从此同向（`floors.json`：1F → 3F → 6F），所以打通一层之后要上楼梯，
 * 服务器是这么长的，楼也是这么长的。这个类本身只画方框与箭头，
 * 「哪个方向算前进」在 `BattleScene.refreshStairPads()` 里判。
 *
 * ★ 改了（2026-10-21，用户三句话）：这个类原来只画「下一层」，位置在**楼梯间门外的走廊上**。
 * 现在：
 *
 * | | 上一版 | 现在 |
 * |---|---|---|
 * | 摆在哪 | 楼梯间**门外**的走廊 | **楼梯间里面**（两个入口都在，见 `stairPadSpots()`） |
 * | 方向 | 只有向下 | **两个方向**（`dir`），`up` 是「上一层」（★ 2026-10-22 起 = 前进） |
 * | 什么时候亮 | 打完本层首领 | 向上（前进）：打完本层首领 · 向下（回去）：**下面还有楼就一直在** |
 *
 * `F` 键今天只剩这一个用途（它以前是「站门口按 F 过门」）—— 门改成**走过去就行**的
 * 物理挡板了，所以换层这一个是 `F` 的**唯一**含义，不是和其他动作共用的那个。
 *
 * ## 白盒
 *
 * 按 §五的约定：没有美术，就用几何 + 文字说清楚自己是什么。
 * 一个会呼吸的方框 + 一行字 + 一个箭头。
 *
 * ⚠️ **两个方向的颜色必须不一样**（青绿 = 下、暖黄 = 上）：它们**就摆在同一个房间里**，
 * 中间只隔 340px。同色的话玩家要走到跟前读那行小字才知道按下去是上楼还是下楼 ——
 * 而按错了是**整个人被送到另一层**，不是走错一步。
 * 这两个色也刻意避开门（亮绿）与宝箱（蓝）。
 */
export type FloorExitDir = 'down' | 'up'

/** 两个方向各自的画法与字。**一处定义**：颜色、说明文字、箭头朝向都从这里取。 */
const LOOKS: Record<FloorExitDir, { color: number; textColor: string; label: string }> = {
  down: { color: 0x1de0b8, textColor: '#b8fff0', label: '下一层 · 走近按 F' },
  up: { color: 0xffc46b, textColor: '#ffe6b8', label: '上一层 · 走近按 F' },
}

export class FloorExit {
  private readonly gfx: Phaser.GameObjects.Graphics
  private readonly label: Phaser.GameObjects.Text
  /** 入口的位置（**竞技场坐标**）。`null` = 还没出现。 */
  private at: { x: number; y: number } | null = null
  private disposed = false
  private readonly look: (typeof LOOKS)[FloorExitDir]
  private readonly reach: number
  private readonly dir: FloorExitDir

  /** 方框的边长（世界像素）。比玩家（半径 12）大一圈，站进去一眼看得出来。 */
  static readonly SIZE = 92

  /**
   * @param opts.reach 「站到了」的距离门槛（世界像素），**量的是到方框边缘的距离**，
   *   和门那套（`DOOR_REACH`）同一个口径 —— 站在框里就是 0。
   * @param opts.dir 往**哪儿**走：`down` = 下一层、`up` = 上一层。只影响画法
   *   （颜色 / 箭头朝向 / 那行字），两边的判据与手感**完全一样**。
   */
  constructor(
    scene: Phaser.Scene,
    opts: { reach: number; dir: FloorExitDir },
  ) {
    this.reach = opts.reach
    this.dir = opts.dir
    this.look = LOOKS[opts.dir]
    this.gfx = scene.add.graphics().setDepth(6)
    this.label = scene.add
      .text(0, 0, this.look.label, {
        fontFamily: 'Microsoft YaHei',
        fontSize: '14px',
        color: this.look.textColor,
        stroke: '#0b1c22',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(4000)
      .setVisible(false)
  }

  get visible(): boolean {
    return this.at !== null
  }

  /** 在第 `(x, y)` 处亮出入口（竞技场坐标。**调用方要先 `safeSpawn()`**，别摆进墙里）。 */
  show(x: number, y: number): void {
    this.at = { x, y }
    this.label.setPosition(x, y - FloorExit.SIZE / 2 - 16).setVisible(true)
  }

  hide(): void {
    this.at = null
    this.label.setVisible(false)
    this.gfx.clear()
  }

  /** 玩家（世界坐标）站到入口上了没有。 */
  near(x: number, y: number): boolean {
    const at = this.at
    if (at === null) return false
    const half = FloorExit.SIZE / 2
    // 和门一样量「到这个矩形的距离」，不是到中心点 —— 框有 92px 宽，
    // 按中心点量会让「站在框的一角」变成「还差 65px」，手感上就是「我明明站上去了」。
    const dx = Math.max(at.x - half - x, 0, x - (at.x + half))
    const dy = Math.max(at.y - half - y, 0, y - (at.y + half))
    return Math.hypot(dx, dy) <= this.reach
  }

  /**
   * 每帧画一遍。用**场景时间**（`this.time.now`）驱动呼吸，不用 `performance.now()` ——
   * 暂停时场景时间会停，静止的画面才是对的（小地图和门那一套同理）。
   */
  update(timeMs: number): void {
    if (this.disposed) return
    const at = this.at
    this.gfx.clear()
    if (at === null) return
    const half = FloorExit.SIZE / 2
    const pulse = 0.55 + 0.35 * Math.sin(timeMs / 260)
    this.gfx
      .fillStyle(this.look.color, 0.16 * pulse)
      .fillRect(at.x - half, at.y - half, half * 2, half * 2)
    this.gfx
      .lineStyle(3, this.look.color, pulse)
      .strokeRect(at.x - half, at.y - half, half * 2, half * 2)
    // 中间一个箭头：白盒也要让人一眼看懂「这是往上还是往下走」。
    // ⚠️ **画面坐标里 y 向下增长** —— `up` 那一支的尖在**小 y** 那一侧，别照抄。
    const s = 18
    const tip = this.dir === 'down' ? at.y + s / 2 : at.y - s / 2
    const tail = this.dir === 'down' ? at.y - s / 2 : at.y + s / 2
    this.gfx.lineStyle(4, this.look.color, pulse)
    this.gfx.beginPath()
    this.gfx.moveTo(at.x - s, tail)
    this.gfx.lineTo(at.x, tip)
    this.gfx.lineTo(at.x + s, tail)
    this.gfx.strokePath()
  }

  destroy(): void {
    if (this.disposed) return
    this.disposed = true
    this.gfx.destroy()
    this.label.destroy()
  }
}
