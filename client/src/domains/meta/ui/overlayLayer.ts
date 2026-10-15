/**
 * 弹层的「屏幕坐标」适配层：**让弹层在别人的相机下也落在屏幕上，而且不动那台相机。**
 *
 * ## 它解决什么
 *
 * D4 的弹层都是按**一屏屏幕坐标**画的（拿 `scene.scale.width / height` 当屏幕、
 * 屏幕中心当原点），在测试场里这永远是对的 —— 那边的相机是 1:1。
 * 但弹层是要被**宿主场景**用的：D1 的战斗相机会按地图适配缩放并居中
 * （`fitCamera`：地图 1344×832 比窗口大的时候 zoom < 1）。直接铺上去的表现是
 * 面板变小、偏离中心、压暗层盖不满屏，**而且按钮点不中** ——
 * 点击落点要按相机反算成世界坐标，和画出来的位置差一截。
 *
 * ## 为什么不是「把宿主相机拉平」
 *
 * 那是把问题推给宿主：弹层一弹出来，那局画面的取景就跟着缩放、跳动，玩家看得见。
 * 弹层只是盖在上面而已，不该动别人的相机。（10.15 的第一版就是这么绕的，现在改掉了。）
 *
 * ## 做法
 *
 * 屏幕坐标 = (世界坐标 − scroll) × zoom。所以把弹层整块塞进一个容器，令
 * `scale = 1 / zoom`、`position = 屏幕原点对应的世界点`，容器里的对象就恰好按 1:1
 * 落在屏幕上 —— 相机怎么缩放、怎么平移都不影响弹层，而战场保持原样。
 *
 * ⚠️ 那个位置**不能**写成 `(scrollX, scrollY)`：相机还有 `origin`（我们用的是默认的
 * 0.5），屏幕坐标里因此多出一项 `宽 × origin × (1 − zoom)` 的偏移 —— 1264×705 的
 * 视口在 zoom 0.847 下就是 96px 的错位，而且它只在"相机 1:1"时恰好为 0，
 * 也就是**只有在测试场里看不出来**。所以这里问 Phaser 要"屏幕左上角对应哪个世界点"
 * （`getWorldPoint(0, 0)`），不自己推矩阵。
 *
 * ## 两个必须知道的点
 *
 * 1. **`attach()` 要在这一屏的东西都建好之后调**，而且要把控件内部的对象一起交进来
 *    （`Button.parts` / `Bar.parts` / `Slider.parts`）。漏掉一个，那一个就留在原来的
 *    坐标系里 —— 症状是"别的都对了，就它歪着"，比整块都歪更难查。
 * 2. **`sync()` 是每帧做的**：相机在弹层开着的期间仍可能变（窗口一 resize 就会触发
 *    宿主的 `fitCamera`），所以这里自己挂在场景的 `PRE_UPDATE` 上同步，
 *    不指望调用方记得这件事。
 */

import Phaser from 'phaser'

/**
 * 弹层整块的深度。战斗 HUD 那几层是 1001 / 1010 / 4500 / 10000，
 * 所以这里要压在它们**之上** —— 否则弹层弹出时状态条、血条还会亮在压暗层上面。
 */
const OVERLAY_DEPTH = 20000

export class OverlayLayer {
  private readonly scene: Phaser.Scene
  private readonly container: Phaser.GameObjects.Container
  private readonly onPreUpdate: () => void
  /** `getWorldPoint` 的输出参数：每帧都算，别每次都新建对象 */
  private readonly scratch = new Phaser.Math.Vector2()
  private attached = false

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.container = scene.add.container(0, 0).setDepth(OVERLAY_DEPTH)
    this.onPreUpdate = () => this.sync()
    scene.events.on(Phaser.Scenes.Events.PRE_UPDATE, this.onPreUpdate)
  }

  /** 把这一屏建好的对象整块搬进来（顺序就是传进来的顺序，所以要按创建顺序给）。 */
  attach(parts: readonly Phaser.GameObjects.GameObject[]): void {
    if (parts.length) this.container.add([...parts])
    this.attached = parts.length > 0
    this.sync()
  }

  /** 这一屏要重画了：先把自己腾空（**对象由调用方销毁**，这里只管父子关系）。 */
  detach(): void {
    this.container.removeAll(false)
    this.attached = false
  }

  /** 按相机反变换摆自己。幂等，可以每帧调。 */
  sync(): void {
    if (!this.attached) return
    const camera = this.scene.cameras.main
    const topLeft = camera.getWorldPoint(0, 0, this.scratch)
    this.container.setScale(1 / camera.zoom).setPosition(topLeft.x, topLeft.y)
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.PRE_UPDATE, this.onPreUpdate)
    this.container.destroy()
    this.attached = false
  }
}
