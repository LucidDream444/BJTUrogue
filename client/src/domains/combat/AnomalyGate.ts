import Phaser from 'phaser'

/**
 * **「异常」层的传送阵** —— 第七层中间那块可活动区域上方的一个**圆形六芒星**。
 *
 * 用户 2026-11-04：「第八层进入只能靠第七层中间可活动区域上方的圆形六芒星传送阵进入，
 * 第七层至少通过三个房间解锁传送阵」；同一天又说「（八层）小房间是来的房间，放传送阵就行」——
 * 所以 **8F 的小落点房里也有同一块阵**（8F 平面图的 `anomalyGate`），它是回第 7 层的门。
 *
 * ## 它和楼梯间那两个方框（`FloorExit`）是同一类东西，但长得不一样
 *
 * | | `FloorExit`（楼梯间） | 这里（传送阵） |
 * |---|---|---|
 * | 形状 | 会呼吸的**方框** + 箭头 | 会呼吸的**圆** + **六芒星** |
 * | 什么时候能按 | 亮着就能按 | **解锁之后**才能按（走过 ≥ N 间房） |
 * | 不通时 | 不亮 | **亮着但是灰的**，并写「还需走过 N 间房」 |
 *
 * ⚠️ **锁着的时候也必须画出来**：玩家要先看到「这儿有个东西」，才知道该去凑房间数。
 * 藏起来的话，那条解锁条件就成了一条没人知道的规则 —— 而这一层没有别的出口，
 * 玩家会把整层翻遍（和「最后一层没有首领房」那个坑一模一样）。
 *
 * ## 白盒
 *
 * 按 AGENTS.md §五：没有美术，就用几何 + 文字。一个圆 + 两个叠起来的三边形成六芒星，
 * 锁着时灰色、解锁后换成紫色并加快呼吸；脚下那行字说清「按 F 去哪」或「还差几间」。
 */
export class AnomalyGate {
  /** 圆的半径（世界像素）。比玩家（半径 12）大得多，站进去一眼看得出来。 */
  static readonly RADIUS = 64

  private readonly gfx: Phaser.GameObjects.Graphics
  private readonly label: Phaser.GameObjects.Text
  private at: { x: number; y: number } | null = null
  private unlocked = false
  /** 还差几间房（锁着时写在脚下那行字里）。 */
  private remaining = 0
  /** 脚下那行字上次写的是什么 —— 传 `label` 时要靠它判断「真的变了没有」。 */
  private text = ''
  private disposed = false
  private readonly reach: number

  /**
   * @param opts.reach 「站到了」的距离门槛（世界像素），量的是到**圆边**的距离 ——
   *   与 `FloorExit.near()` 同一个口径（站在圆里就是 0）。
   */
  constructor(
    scene: Phaser.Scene,
    opts: { reach: number },
  ) {
    this.reach = opts.reach
    this.gfx = scene.add.graphics().setDepth(6)
    this.label = scene.add
      .text(0, 0, '', {
        fontFamily: 'Microsoft YaHei',
        fontSize: '14px',
        color: '#d9c8ff',
        stroke: '#0b1c22',
        strokeThickness: 4,
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(4000)
      .setVisible(false)
  }

  get visible(): boolean {
    return this.at !== null
  }

  get isUnlocked(): boolean {
    return this.unlocked
  }

  /**
   * 亮出传送阵。`unlocked` / `remaining` 每帧都可能变（玩家在跑图），所以它俩走
   * `setState()`，位置只在这里定一次。
   */
  show(x: number, y: number): void {
    this.at = { x, y }
    this.label.setVisible(true)
  }

  /**
   * 解锁状态与「还差几间」—— 每帧传一次也没关系（只在变化时改字）。
   *
   * `label` 可选：8F 小落点房里那一块是**回去的门**，脚下那行字得写
   * 「回到第 7 层」，不能沿用 7F 的「异常 · 走近按 F」（用户 2026-11-04）。
   */
  setState(unlocked: boolean, remaining: number, label?: string): void {
    const text = label ?? (unlocked ? '异常 · 走近按 F' : `异常 · 还需走过 ${remaining} 间房`)
    if (this.unlocked === unlocked && this.remaining === remaining && this.text === text) return
    this.unlocked = unlocked
    this.remaining = remaining
    this.text = text
    this.label.setText(text).setColor(unlocked ? '#e6d4ff' : '#9aa0b4')
  }

  hide(): void {
    this.at = null
    this.label.setVisible(false)
    this.gfx.clear()
  }

  /** 玩家（世界坐标）站到传送阵上了没有。 */
  near(x: number, y: number): boolean {
    const at = this.at
    if (at === null) return false
    const d = Math.hypot(x - at.x, y - at.y)
    return d <= AnomalyGate.RADIUS + this.reach
  }

  /**
   * 每帧画一遍。用**场景时间**驱动呼吸（暂停时场景时间会停，静止的画面才是对的）。
   */
  update(timeMs: number): void {
    if (this.disposed) return
    const at = this.at
    this.gfx.clear()
    if (at === null) return
    const r = AnomalyGate.RADIUS
    const pulse = this.unlocked ? 0.62 + 0.38 * Math.sin(timeMs / 200) : 0.35 + 0.1 * Math.sin(timeMs / 700)
    const color = this.unlocked ? 0xb07cff : 0x6b6f86
    // 圆
    this.gfx.fillStyle(color, 0.12 * pulse).fillCircle(at.x, at.y, r)
    this.gfx.lineStyle(3, color, pulse).strokeCircle(at.x, at.y, r)
    // 六芒星 = 两个**正三角形**叠起来（一个尖朝上、一个尖朝下），顶点落在圆上。
    // ⚠️ 半径取 `r * 0.86`：正三角形的顶点到中心就是外接圆半径，取 1 会把尖顶到圆线上、糊在一起。
    this.gfx.lineStyle(3, color, pulse)
    for (const flipped of [false, true]) {
      this.gfx.beginPath()
      for (let i = 0; i < 3; i++) {
        const angle = (Math.PI / 2) + (i * 2 * Math.PI) / 3 + (flipped ? Math.PI : 0)
        const px = at.x + Math.cos(angle) * r * 0.86
        const py = at.y - Math.sin(angle) * r * 0.86
        if (i === 0) this.gfx.moveTo(px, py)
        else this.gfx.lineTo(px, py)
      }
      this.gfx.closePath()
      this.gfx.strokePath()
    }
    // 那行字写在**圆下方**（圆上方留给中段大厅的说明文字）
    this.label.setPosition(at.x, at.y + r + 16)
  }

  destroy(): void {
    if (this.disposed) return
    this.disposed = true
    this.gfx.destroy()
    this.label.destroy()
  }
}
