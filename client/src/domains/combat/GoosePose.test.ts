import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { ANIMS, ASSETS, GOOSE_ART, findAsset } from '@/core/assetManifest'
import { gooseDirection, gooseFrame, goosePose, type GooseDirection } from './GoosePose'

describe('大鹅四向躯干与独立鹅嘴瞄准', () => {
  it('四向躯干与共用头颈图集已交付为透明 PNG，所有动作帧均在图内', () => {
    const keys = [...Object.values(GOOSE_ART.directions).map((d) => d.body), GOOSE_ART.neck.texture]
    for (const key of keys) {
      const entry = findAsset(key)!
      const png = readFileSync(new URL('../../../public/assets/' + entry.path, import.meta.url))
      expect(png.subarray(1, 4).toString()).toBe('PNG')
      expect(png[25]).toBe(6)
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([384, 576])
      const count = (png.readUInt32BE(16) / entry.frameWidth!) * (png.readUInt32BE(20) / entry.frameHeight!)
      for (const a of ANIMS.filter((a) => a.textureKey === key)) {
        expect(a.frames.every((f) => f >= 0 && f < count), a.animKey).toBe(true)
      }
    }
  })
  it('资源与动画仅注册一套头颈，目录内没有遗留的四向头颈 PNG', () => {
    const neck = GOOSE_ART.neck.texture
    expect(ASSETS.filter((a) => a.key.startsWith(neck)).map((a) => a.key)).toEqual([neck])
    expect(ANIMS.filter((a) => a.textureKey.startsWith(neck))).toHaveLength(Object.keys(GOOSE_ART.states).length)
    const files = readdirSync(new URL('../../../public/assets/sprites/player/goose/', import.meta.url))
    expect(files.filter((f) => f.startsWith(neck))).toEqual([`${neck}.png`])
  })
  it('移动选择四向，停步保留方向，鼠标不参与躯干朝向', () => {
    expect(gooseDirection(0, -1, 'right')).toBe('up')
    expect(gooseDirection(0, 1, 'up')).toBe('down')
    expect(gooseDirection(-1, 0, 'down')).toBe('left')
    expect(gooseDirection(1, 0, 'left')).toBe('right')
    expect(gooseDirection(0, 0, 'up')).toBe('up')
  })

  it('直颈每个视角完整转一圈：嘴巴符合图层变换，枪口与远处鼠标共线', () => {
    for (const direction of Object.keys(GOOSE_ART.directions) as GooseDirection[]) {
      const neck = GOOSE_ART.neck
      for (let i = 0; i < 32; i++) {
        const a = i * Math.PI / 16
        const scale = 0.65
        const aim = { x: 125 + Math.cos(a) * 500, y: 246 + Math.sin(a) * 500 }
        const p = goosePose({ x: 125, y: 246 }, direction, scale, aim)
        const localX = (neck.mouth[0] - neck.pivot[0]) * scale
        const localY = (neck.mouth[1] - neck.pivot[1]) * scale
        expect(p.rotation).toBe(p.angle)
        expect(p.pivot.x + Math.cos(p.rotation) * localX - Math.sin(p.rotation) * localY).toBeCloseTo(p.mouth.x, 9)
        expect(p.pivot.y + Math.sin(p.rotation) * localX + Math.cos(p.rotation) * localY).toBeCloseTo(p.mouth.y, 9)
        const barrelX = p.muzzle.x - p.mouth.x
        const barrelY = p.muzzle.y - p.mouth.y
        expect(barrelX).toBeCloseTo(Math.cos(p.angle) * 32 * scale, 9)
        expect(barrelY).toBeCloseTo(Math.sin(p.angle) * 32 * scale, 9)
        const targetX = aim.x - p.muzzle.x, targetY = aim.y - p.muzzle.y
        expect(barrelX * targetY - barrelY * targetX).toBeCloseTo(0, 8)
        expect(barrelX * targetX + barrelY * targetY).toBeGreaterThan(0)
      }
    }
  })

  it('鼠标靠近颈根、位于颈根或处于补偿临界点时，嘴与枪管仍有限且共用角度', () => {
    for (const direction of Object.keys(GOOSE_ART.directions) as GooseDirection[]) {
      const seed = goosePose({ x: 0, y: 0 }, direction, 1, { x: 0, y: 0 })
      const limit = Math.abs(GOOSE_ART.neck.mouth[1] - GOOSE_ART.neck.pivot[1])
      for (const distance of [0, 0.001, 5, 20, Math.max(0, limit - 0.001), limit, limit + 0.001, 90]) {
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4
          const p = goosePose({ x: 0, y: 0 }, direction, 1,
            { x: seed.pivot.x + Math.cos(a) * distance, y: seed.pivot.y + Math.sin(a) * distance })
          expect([p.angle, p.rotation, p.mouth.x, p.mouth.y, p.muzzle.x, p.muzzle.y].every(Number.isFinite)).toBe(true)
          expect(p.muzzle.x - p.mouth.x).toBeCloseTo(Math.cos(p.angle) * 32, 9)
          expect(p.muzzle.y - p.mouth.y).toBeCloseTo(Math.sin(p.angle) * 32, 9)
        }
      }
    }
  })

  it('受击帧匹配现有受击时间，死亡播完停末帧；走路循环', () => {
    expect(gooseFrame('hurt', 0, 450)).toBe(16)
    expect(gooseFrame('hurt', 225, 450)).toBe(18)
    expect(gooseFrame('hurt', 450, 450)).toBe(19)
    expect(gooseFrame('death', 99999)).toBe(23)
    expect(gooseFrame('run', 0)).toBe(4)
    expect(gooseFrame('run', 800)).toBe(4)
  })
})
