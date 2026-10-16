import Phaser from 'phaser'

/**
 * **一层楼打通之后，出现在首领房里的「下一层」入口。**
 *
 * ## 为什么它必须是个看得见的东西，而不是「自动下一层」
 *
 * 一局现在有三层，层与层之间是**两个不同的事件**：一层打完了（首领死了）和
 * 「我准备好下去了」。自动下去会把后者吃掉 —— 玩家还在捡宝箱、还在想选哪个强化，
 * 画面一黑就到了新地方。所以入口是**一个要自己走过去的点**，和门（`F` 过门）同一套肌肉记忆。
 *
 * 一层只有一间（首领房）会出现它，所以它平时是隐藏的 —— `show()` 之前
 * `visible` 是 false，`update()` 什么都不画。
 *
 * ## 白盒
 *
 * 按 §五的约定：没有美术，就用几何 + 文字说清楚自己是什么。
 * 一个会呼吸的方框 + 一行字，颜色刻意用**青绿**（和门的亮绿、宝箱的蓝都不一样）——
 * 「可以往下走」和「可以往旁边走」在画面上不该长得一样。
 */
export class FloorExit {
  private readonly gfx: Phaser.GameObjects.Graphics
  private readonly label: Phaser.GameObjects.Text
  /** 入口的位置（**竞技场坐标**）。`null` = 还没出现。 */
  private at: { x: number; y: number } | null = null
  private disposed = false

  /** 方框的边长（世界像素）。比玩家（半径 12）大一圈，站进去一眼看得出来。 */
  static readonly SIZE = 92

  /**
   * @param reach 「站到了」的距离门槛（世界像素），**量的是到方框边缘的距离**，
   *   和门那套（`DOOR_REACH`）同一个口径 —— 站在框里就是 0。
   */
  constructor(
    scene: Phaser.Scene,
    private readonly reach: number,
  ) {
    this.gfx = scene.add.graphics().setDepth(6)
    this.label = scene.add
      .text(0, 0, '下一层 · 走近按 F', {
        fontFamily: 'Microsoft YaHei',
        fontSize: '14px',
        color: '#b8fff0',
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
    this.gfx.fillStyle(0x1de0b8, 0.16 * pulse).fillRect(at.x - half, at.y - half, half * 2, half * 2)
    this.gfx.lineStyle(3, 0x1de0b8, pulse).strokeRect(at.x - half, at.y - half, half * 2, half * 2)
    // 中间一个向下的箭头：白盒也要让人一眼看懂「这是往下走」。
    const s = 18
    this.gfx.lineStyle(4, 0xb8fff0, pulse)
    this.gfx.beginPath()
    this.gfx.moveTo(at.x - s, at.y - s / 2)
    this.gfx.lineTo(at.x, at.y + s / 2)
    this.gfx.lineTo(at.x + s, at.y - s / 2)
    this.gfx.strokePath()
  }

  destroy(): void {
    if (this.disposed) return
    this.disposed = true
    this.gfx.destroy()
    this.label.destroy()
  }
}
