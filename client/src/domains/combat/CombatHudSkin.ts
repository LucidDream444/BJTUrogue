import type Phaser from 'phaser'
import { ARCHIVE_THEME as A, THEME } from '../meta/ui/theme'
import type { HudBox } from './bottomHudLayout'

/** Small beveled notebook plates; drawn only on state changes, not every game frame. */
export function paintHudPlate(
  g: Phaser.GameObjects.Graphics,
  x: number,
  width: number,
  height: number,
  selected: boolean,
): void {
  g.clear()
  g.fillStyle(A.ink, 0.4).fillRoundedRect(x + 2, 3, width, height, 6)
  g.fillGradientStyle(A.glass, A.ink, A.ink, A.glass, 0.96).fillRect(x, 0, width, height)
  g.lineStyle(1, selected ? A.cyan : A.brass, selected ? 0.92 : 0.7).strokeRect(x, 0, width, height)
  g.lineStyle(1, A.light, 0.12).lineBetween(x + 5, 5, x + width - 5, 5)
  g.lineStyle(1, A.brass, 0.3).lineBetween(x + 5, height - 5, x + width - 5, height - 5)
  if (selected) g.fillStyle(A.cyan, 0.85).fillRect(x, 10, 3, height - 20)
  g.lineStyle(2, A.light, selected ? 0.85 : 0.4)
  for (const [px, py, sx, sy] of [
    [x, 0, 1, 1],
    [x + width, 0, -1, 1],
    [x, height, 1, -1],
    [x + width, height, -1, -1],
  ]) {
    g.lineBetween(px!, py! + sy! * 9, px!, py!)
    g.lineBetween(px!, py!, px! + sx! * 9, py!)
  }
}
export function hudText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  size: number,
  color: string,
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text, { fontFamily: THEME.font.family, fontSize: size, color })
}
export function placeHud(
  root: Phaser.GameObjects.Container,
  camera: Phaser.Cameras.Scene2D.Camera,
  box: HudBox,
): void {
  root
    .setScale(box.scale / camera.zoom)
    .setPosition(
      camera.width * camera.originX * (1 - 1 / camera.zoom) + box.x / camera.zoom,
      camera.height * camera.originY * (1 - 1 / camera.zoom) + box.y / camera.zoom,
    )
}
