import type Phaser from 'phaser'
import { D1_ART } from '@/core/d1AssetManifest'
import { findAsset, imageUrl } from '@/core/assetManifest'
import { PLAYER_ART } from '@/domains/combat/Player'
type Art = (typeof D1_ART)[number]
/** Preview time advances only UI, never feeds gameplay or damage timers. */
export class AssetGallery {
  readonly root = document.createElement('section')
  private art: Art = PLAYER_ART.run
  private frame = 0
  private uiMs = 0
  private playing = true
  private flip = false
  private fallback: 'none' | 'hurt' | 'dead' = 'none'
  private readonly canvas = document.createElement('canvas')
  private readonly caption = document.createElement('p')
  private readonly slider = document.createElement('input')
  constructor(
    private readonly scene: Phaser.Scene,
    close: () => void,
  ) {
    this.root.className = 'd1-gallery'
    this.root.hidden = true
    this.root.innerHTML =
      '<header><h2>人物与素材实验室</h2><button data-close>返回战斗 · V</button></header><p>保留原始尺寸 · 方向姿势独立选择 · 受击、死亡为临时变换</p>'
    this.root.querySelector<HTMLButtonElement>('[data-close]')!.onclick = close
    const controls = document.createElement('div')
    controls.className = 'd1-controls'
    const choices: [string, Art, 'none' | 'hurt' | 'dead'][] = [
      ['待机', PLAYER_ART.idle[6]!, 'none'],
      ['移动', PLAYER_ART.run, 'none'],
      ['攻击', PLAYER_ART.shoot, 'none'],
      ['移动攻击', PLAYER_ART.runGun, 'none'],
      ['挥剑展示', PLAYER_ART.sword, 'none'],
      ['受击（临时）', PLAYER_ART.idle[6]!, 'hurt'],
      ['死亡（临时）', PLAYER_ART.idle[6]!, 'dead'],
    ]
    for (const [name, art, fallback] of choices)
      this.button(controls, name, () => {
        this.select(art)
        this.fallback = fallback
      })
    this.button(controls, '播放 / 暂停', () => {
      this.playing = !this.playing
    })
    this.button(controls, '逐帧 +1', () => {
      this.playing = false
      this.frame = (this.frame + 1) % this.art.count
      this.slider.value = String(this.frame)
    })
    this.button(controls, '左右翻转', () => {
      this.flip = !this.flip
    })
    this.slider.type = 'range'
    this.slider.min = '0'
    this.slider.max = '15'
    this.slider.value = '0'
    this.slider.setAttribute('aria-label', '预览帧')
    this.slider.oninput = () => {
      this.playing = false
      this.frame = Number(this.slider.value)
    }
    controls.append(this.slider)
    this.canvas.width = 600
    this.canvas.height = 320
    this.canvas.className = 'd1-preview-canvas'
    this.root.append(controls, this.canvas, this.caption)
    const grid = document.createElement('div')
    grid.className = 'd1-asset-grid'
    for (const art of D1_ART) {
      const card = document.createElement('button')
      card.className = 'd1-asset-card'
      card.dataset.assetKey = art.key
      const img = document.createElement('img')
      img.src = imageUrl(findAsset(art.key)!)
      img.alt = art.key
      const label = document.createElement('span')
      label.textContent = `${art.group} · ${art.key.replace('player_student_', '').replace('ui_campus_', '')}\n${art.frameWidth}×${art.frameHeight} / ${art.count} 帧`
      card.append(img, label)
      card.onclick = () => this.select(art)
      grid.append(card)
    }
    this.root.append(grid)
    document.body.append(this.root)
  }
  private button(root: HTMLElement, label: string, action: () => void): void {
    const b = document.createElement('button')
    b.textContent = label
    b.onclick = action
    root.append(b)
  }
  private select(art: Art): void {
    this.art = art
    this.frame = 0
    this.uiMs = 0
    this.fallback = 'none'
    this.slider.max = String(art.count - 1)
    this.slider.value = '0'
  }
  show(): void {
    this.root.hidden = false
  }
  hide(): void {
    this.root.hidden = true
  }
  update(delta: number): void {
    if (this.root.hidden) return
    if (this.playing) {
      this.uiMs += delta
      this.frame = Math.floor(this.uiMs / 125) % this.art.count
      this.slider.value = String(this.frame)
    }
    const ctx = this.canvas.getContext('2d')!
    const a = this.art
    ctx.clearRect(0, 0, 600, 320)
    ctx.fillStyle = '#101c2d'
    ctx.fillRect(0, 0, 600, 320)
    ctx.strokeStyle = '#376276'
    ctx.beginPath()
    ctx.moveTo(0, 260)
    ctx.lineTo(600, 260)
    ctx.moveTo(300, 0)
    ctx.lineTo(300, 320)
    ctx.stroke()
    const source = this.scene.textures.get(a.key).getSourceImage() as HTMLImageElement
    const fw = a.frameWidth,
      fh = a.frameHeight,
      cols = Math.floor(source.width / fw),
      anchor = a.anchors[this.frame] ?? a.anchors[0]!
    const character = fw < 100,
      scale = character ? 3 : Math.min(570 / fw, 290 / fh)
    ctx.save()
    ctx.translate(300, character ? 260 : 160)
    ctx.scale(this.flip ? -1 : 1, 1)
    if (this.fallback === 'dead') {
      ctx.rotate(-Math.PI / 2)
      ctx.globalAlpha = 0.45
    }
    const dx = character ? -anchor[0] * fw * scale : (-fw * scale) / 2,
      dy = character ? -anchor[1] * fh * scale : (-fh * scale) / 2
    ctx.drawImage(
      source,
      (this.frame % cols) * fw,
      Math.floor(this.frame / cols) * fh,
      fw,
      fh,
      dx,
      dy,
      fw * scale,
      fh * scale,
    )
    if (this.fallback === 'hurt') {
      ctx.globalCompositeOperation = 'source-atop'
      ctx.fillStyle = '#ff999980'
      ctx.fillRect(dx, dy, fw * scale, fh * scale)
    }
    ctx.restore()
    this.caption.textContent = `${a.key} · 帧 ${this.frame + 1}/${a.count} · ${a.count > 1 ? '8 fps / 循环' : '单帧，非连续方向动画'} · 脚底十字参考线${this.fallback !== 'none' ? ' · 缺失动作：临时表现' : ''}`
  }
  destroy(): void {
    this.root.remove()
  }
}
