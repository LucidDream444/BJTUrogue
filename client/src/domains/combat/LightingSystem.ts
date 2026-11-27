import Phaser from 'phaser'
import type { CombatConfig } from './config'
import type { Player } from './Player'
import {
  castRayDistances,
  isPointLit,
  type LightRect,
  type LightSource,
} from './lighting'

/** 能挂 GeometryMask 的表现对象 —— Graphics / Sprite / Text 都满足。 */
export interface LightMaskTarget {
  setMask(mask: Phaser.Display.Masks.GeometryMask | null): unknown
}

/** 纯接口供 D3 使用，避免 D3 反向依赖 D1 的 Phaser 类。 */
export interface LightPort {
  isLit(x: number, y: number): boolean
}

/**
 * 黑暗滤镜的绘制层，压在**所有世界物体之上、HUD 之下**。
 *
 * 3999 是刻意的：世界物体的深度是 `y`（整层最高约 2920），
 * 4000 那一层是房号文字 / 传送阵 / 宝箱等交互物，4600+ 才是 HUD。
 * 把滤镜放在 3999，既盖住所有实体与技能，又不会把交互物和 HUD 一起压黑。
 */
const LIGHTING_DEPTH = 3999

/**
 * 光边渐变的分级数。
 *
 * 之前只画「外圈 65% 擦除 + 内圈全擦除」两级，外圈会留下一条固定的灰色环带。
 * 现在把柔化区拆成多级同心多边形，每级的擦除强度按目标暗度递推出来，
 * 肉眼看是渐变而不是灰圈。级数越高越细，代价是多边形填充次数线性增加。
 */
const PLAYER_EDGE_STEPS = 32
const BULLET_EDGE_STEPS = 10
/** 子弹只是“少量光源”，中心最多擦掉 65%，不要擦成全亮。 */
const BULLET_MAX_ERASE = 0.65

export class LightingSystem implements LightPort {
  private readonly rt: Phaser.GameObjects.RenderTexture
  /** 只用于往 RT 上擦除光洞，不进入场景显示列表。 */
  private readonly eraseGraphics: Phaser.GameObjects.Graphics
  /** 世界坐标的可见光多边形；所有敌方技能/弹幕共用这一张遮罩。 */
  private readonly maskShape: Phaser.GameObjects.Graphics
  private readonly mask: Phaser.Display.Masks.GeometryMask
  private readonly playerSource: LightSource
  /** 复用的子弹光源对象，避免每帧建 20+ 个小对象。 */
  private readonly bulletPool: LightSource[] = []
  private readonly bulletSources: LightSource[] = []
  private readonly nearby: LightRect[] = []
  /** 每帧只向宿主取一次遮挡几何（`isLit` 会被每只敌人调用，不能每次都重建）。 */
  private currentOccluders: readonly LightRect[] = []
  private rayDistances: Float32Array
  private destroyed = false
  /** 第零层：整层不做黑暗滤镜，实体也全部可见。 */
  private fullBright = false
  /** 商店房等固定亮区：即使玩家在走廊，房间本身也保持照亮。 */
  private alwaysLitRects: LightRect[] = []

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly cfg: CombatConfig['lighting'],
    private readonly player: Player,
    private readonly occluders: () => readonly LightRect[],
  ) {
    const camera = scene.cameras.main
    this.rayDistances = new Float32Array(cfg.rays)
    this.playerSource = { x: player.x, y: player.y, radius: cfg.playerRadius }
    // ⚠️ `scrollFactor(0)` 只管“不跟着滚动”，**相机 zoom 仍会缩放它**；
    // 所以每帧按 `1/zoom` 反向缩放并放到「屏幕 (0,0) 对应的位置」——
    // 和 `LiquidFx.label` 那几个固定 HUD 用的是同一套换算。
    this.rt = scene.add
      .renderTexture(0, 0, Math.ceil(camera.width), Math.ceil(camera.height))
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(LIGHTING_DEPTH)
    this.eraseGraphics = scene.make.graphics({ x: 0, y: 0 }, false)
    this.maskShape = scene.make.graphics({ x: 0, y: 0 }, false)
    this.mask = this.maskShape.createGeometryMask()
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.resize, this)
  }

  /**
   * 每渲染帧调用一次。`bullets` 是**玩家**当前在飞行的子弹中心点。
   *
   * 一次 update 同时做两件事：
   * 1. 重画屏幕上的黑暗滤镜（玩家 + 子弹的光洞）；
   * 2. 重画世界坐标的 GeometryMask，敌方弹幕/技能共用这张遮罩。
   */
  /** 第零层使用全亮：不画黑暗滤镜，所有带光罩的表现也整块放行。 */
  setFullBright(fullBright: boolean): void {
    this.fullBright = fullBright
  }

  /** 设置固定亮区（世界坐标，左上角 + 宽高）。商店房用它保持常亮。 */
  setAlwaysLitRects(rects: readonly LightRect[]): void {
    this.alwaysLitRects = rects.map((rect) => ({ ...rect }))
  }

  update(bullets: readonly { x: number; y: number }[]): void {
    if (this.destroyed) return
    if (!this.cfg.enabled) {
      this.rt.setVisible(false)
      return
    }
    if (this.fullBright) {
      this.rt.setVisible(false)
      // 敌方弹幕/技能挂着共享 GeometryMask：全亮时把遮罩填满整层，
      // 否则它们仍会被上一次 shape 裁掉。
      const b = this.scene.physics.world.bounds
      this.maskShape.clear().fillStyle(0xffffff, 1).fillRect(
        b.x - 1000,
        b.y - 1000,
        b.width + 2000,
        b.height + 2000,
      )
      return
    }
    this.rt.setVisible(true)

    const camera = this.scene.cameras.main
    const width = Math.ceil(camera.width)
    const height = Math.ceil(camera.height)
    if (this.rt.width !== width || this.rt.height !== height) this.rt.resize(width, height)
    // 屏幕左上角在 zoom 后的逆变换：位置 = 画布中心 × (1 − 1/zoom)。
    const inverseZoom = 1 / camera.zoom
    this.rt
      .setScale(inverseZoom)
      .setPosition(
        camera.width * camera.originX * (1 - inverseZoom),
        camera.height * camera.originY * (1 - inverseZoom),
      )

    const px = this.player.x
    const py = this.player.y
    this.playerSource.x = px
    this.playerSource.y = py
    this.playerSource.radius = this.cfg.playerRadius
    this.collectBullets(bullets, camera)

    this.currentOccluders = this.occluders()
    const rects = this.currentOccluders
    this.rt.clear().fill(0x000000, this.cfg.darknessAlpha, 0, 0, width, height)
    this.eraseGraphics.clear()
    this.maskShape.clear()

    // 固定亮区（商店房）：直接按矩形擦除，不受玩家光圈半径限制。
    for (const room of this.alwaysLitRects) {
      this.maskShape.fillStyle(0xffffff, 1).fillRect(room.x, room.y, room.width, room.height)
      const sx = this.screenX(camera, room.x)
      const sy = this.screenY(camera, room.y)
      this.eraseGraphics
        .fillStyle(0xffffff, 1)
        .fillRect(sx, sy, room.width * camera.zoom, room.height * camera.zoom)
    }

    this.drawLight(px, py, this.cfg.playerRadius, this.cfg.rays, rects, camera, true)
    for (let i = 0; i < this.bulletSources.length; i++) {
      const bullet = this.bulletSources[i]!
      this.drawLight(bullet.x, bullet.y, bullet.radius, this.cfg.bulletRays, rects, camera, false)
    }

    this.rt.erase(this.eraseGraphics)
  }

  /** 敌我实体可见性判据：玩家光或任意玩家子弹光，且中间没有墙。 */
  isLit(x: number, y: number): boolean {
    if (!this.cfg.enabled || this.fullBright) return true
    for (const room of this.alwaysLitRects) {
      if (
        x >= room.x &&
        x <= room.x + room.width &&
        y >= room.y &&
        y <= room.y + room.height
      )
        return true
    }
    return isPointLit(x, y, this.playerSource, this.bulletSources, this.currentOccluders)
  }

  /**
   * 给一个绘图面挂上共享光罩。
   *
   * ⚠️ **这就是“全覆盖”的入口**：敌方弹幕、地面技能、喷酸池等只要把绘制放进
   * 同一块 Graphics，调用一次本方法后，以后往里面加的任何东西都会自动被光罩裁掉，
   * 不需要再逐个特效判断。新增敌方表现类时，在创建 Graphics / Sprite 后调一次。
   */
  applyMask(target: Phaser.GameObjects.GameObject): void {
    if (!this.cfg.enabled) return
    ;(target as Phaser.GameObjects.GameObject & LightMaskTarget).setMask(this.mask)
  }

  private collectBullets(
    bullets: readonly { x: number; y: number }[],
    camera: Phaser.Cameras.Scene2D.Camera,
  ): void {
    this.bulletSources.length = 0
    if (this.cfg.maxBulletLights <= 0) return
    const view = camera.worldView
    const margin = this.cfg.bulletRadius
    const px = this.playerSource.x
    const py = this.playerSource.y
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i]!
      if (
        b.x < view.x - margin ||
        b.x > view.right + margin ||
        b.y < view.y - margin ||
        b.y > view.bottom + margin
      )
        continue
      let source = this.bulletPool[this.bulletSources.length]
      if (!source) {
        source = { x: 0, y: 0, radius: this.cfg.bulletRadius }
        this.bulletPool.push(source)
      }
      source.x = b.x
      source.y = b.y
      source.radius = this.cfg.bulletRadius
      this.bulletSources.push(source)
    }
    if (this.bulletSources.length <= this.cfg.maxBulletLights) return
    this.bulletSources.sort((a, b) => {
      const da = (a.x - px) ** 2 + (a.y - py) ** 2
      const db = (b.x - px) ** 2 + (b.y - py) ** 2
      return da - db
    })
    this.bulletSources.length = this.cfg.maxBulletLights
  }

  /**
   * 画一盏灯：世界多边形进遮罩，屏幕多边形进暗色 RT 的擦除层。
   * 玩家灯多画一圈内环，让外缘有一点柔化；子弹灯只画一圈。
   */
  private drawLight(
    ox: number,
    oy: number,
    radius: number,
    rays: number,
    rects: readonly LightRect[],
    camera: Phaser.Cameras.Scene2D.Camera,
    isPlayer: boolean,
  ): void {
    this.nearby.length = 0
    const minX = ox - radius
    const maxX = ox + radius
    const minY = oy - radius
    const maxY = oy + radius
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]!
      if (r.x > maxX || r.x + r.width < minX || r.y > maxY || r.y + r.height < minY) continue
      this.nearby.push(r)
    }
    if (this.rayDistances.length < rays) this.rayDistances = new Float32Array(rays)
    const distances = this.rayDistances
    castRayDistances(
      { x: ox, y: oy },
      radius,
      this.nearby,
      rays,
      distances,
      this.cfg.furnitureMarginPx,
    )

    const step = (Math.PI * 2) / rays
    // 世界坐标：共享遮罩只认一圈完整光域，柔化只影响“压多黑”，不改变“看不看得见”。
    this.maskShape.fillStyle(0xffffff, 1).beginPath()
    for (let i = 0; i < rays; i++) {
      const angle = i * step
      const distance = distances[i]!
      const x = ox + Math.cos(angle) * distance
      const y = oy + Math.sin(angle) * distance
      if (i === 0) this.maskShape.moveTo(x, y)
      else this.maskShape.lineTo(x, y)
    }
    this.maskShape.closePath().fillPath()

    // 屏幕坐标：柔化区拆成多级同心多边形。
    // 目标累计擦除 F_k = maxErase × (k+1)/steps；每级只补足到目标的差额，
    // 从外到内叠加后就是一条近似线性的明暗过渡，而不是一圈固定灰带。
    // 最外一级也从很小的擦除开始，所以「光半径边缘」不会先留一圈全暗。
    const maxErase = isPlayer ? 1 : BULLET_MAX_ERASE
    const softness = this.cfg.softness
    if (softness <= 0) {
      this.erasePolygon(ox, oy, distances, rays, radius, camera, maxErase)
      return
    }
    const steps = isPlayer ? PLAYER_EDGE_STEPS : BULLET_EDGE_STEPS
    const inner = radius * (1 - softness)
    const bandWidth = (radius - inner) / steps
    let previousRemaining = 1
    for (let stepIndex = 0; stepIndex < steps; stepIndex++) {
      const target = (maxErase * (stepIndex + 1)) / steps
      const remaining = 1 - target
      const alpha = 1 - remaining / previousRemaining
      previousRemaining = remaining
      this.erasePolygon(
        ox,
        oy,
        distances,
        rays,
        radius - stepIndex * bandWidth,
        camera,
        alpha,
      )
    }
  }

  /** 按给定半径上限画一圈屏幕坐标光多边形并擦除；`cap` 之外的部分被墙截断。 */
  private erasePolygon(
    ox: number,
    oy: number,
    distances: Float32Array,
    rays: number,
    cap: number,
    camera: Phaser.Cameras.Scene2D.Camera,
    alpha: number,
  ): void {
    const step = (Math.PI * 2) / rays
    this.eraseGraphics.fillStyle(0xffffff, alpha).beginPath()
    for (let i = 0; i < rays; i++) {
      const angle = i * step
      const distance = Math.min(distances[i]!, cap)
      const x = this.screenX(camera, ox + Math.cos(angle) * distance)
      const y = this.screenY(camera, oy + Math.sin(angle) * distance)
      if (i === 0) this.eraseGraphics.moveTo(x, y)
      else this.eraseGraphics.lineTo(x, y)
    }
    this.eraseGraphics.closePath().fillPath()
  }

  private screenX(camera: Phaser.Cameras.Scene2D.Camera, worldX: number): number {
    return camera.x + (worldX - camera.worldView.x) * camera.zoom
  }

  private screenY(camera: Phaser.Cameras.Scene2D.Camera, worldY: number): number {
    return camera.y + (worldY - camera.worldView.y) * camera.zoom
  }

  private resize(): void {
    if (this.destroyed) return
    const camera = this.scene.cameras.main
    this.rt.resize(Math.ceil(camera.width), Math.ceil(camera.height))
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.resize, this)
    this.rt.destroy()
    this.eraseGraphics.destroy()
    this.maskShape.destroy()
  }
}
